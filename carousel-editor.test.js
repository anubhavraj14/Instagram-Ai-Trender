import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { buildCarouselHookPrompt, buildCarouselPrompt, CAROUSEL_HOOK_GUIDE } from "./lib/prompt.js";

const source = await readFile(new URL("./public/app.js", import.meta.url), "utf8");
const editor = source.slice(source.indexOf("function carouselDraftKey("), source.indexOf("/* ---------- top-3"));

class Element {
  constructor() { this.nodes = new Map(); this.children = []; this.events = {}; this.style = {}; this.value = ""; }
  querySelector(selector) {
    if (!this.nodes.has(selector)) this.nodes.set(selector, new Element());
    return this.nodes.get(selector);
  }
  appendChild(node) { this.children.push(node); }
  replaceChildren(...nodes) { this.children = nodes; }
  before() {}
  remove() {}
  setAttribute() {}
  addEventListener(name, handler) { this.events[name] = handler; }
  async fire(name) { await this.events[name]?.(); }
}

function setup({ generate = async () => "ai.jpg" } = {}) {
  const created = [];
  const renders = [];
  const drafts = {};
  let aiCalls = 0;
  let saves = 0;
  const context = vm.createContext({
    editsMap: drafts,
    carouselSelectedArt: new WeakMap(),
    document: { createElement(tag) { const el = new Element(); el.tag = tag; created.push(el); return el; } },
    $: () => ({ content: { cloneNode: () => new Element() } }),
    esc: (value) => value,
    slideCanvas: async (slide) => { renders.push({ heading: slide.heading, body: slide.body }); slide._img = "stock.jpg"; return new Element(); },
    loadCarouselArtwork: async () => { aiCalls++; return generate(); },
    loadImageEl: async () => ({}),
    slideImgCache: new Map(),
    persistEdits: async () => { saves++; }, persistIfSaved() {}, wireSave() {},
    downloadSlide() {}, downloadSlides() {}, postToInstagram() {}, copyText() {}, carouselCaptionText() {},
    passHeaders: () => ({}), AbortSignal, alert() {},
  });
  vm.runInContext(editor, context);
  const data = { id: "same-id", topic: "Reel openings", slides: [
    { type: "cover", heading: "Old hook", body: "Old body", imageQuery: "camera" },
    { type: "point", heading: "Show the result", body: "Put the result before your introduction", imageQuery: "spotlight" },
  ] };
  const card = context.buildCarouselCard(data);
  return { context, data, card, created, renders, drafts, aiCalls: () => aiCalls, saves: () => saves,
    slides: created.filter((el) => el.tag === "section") };
}

test("building a carousel never automatically generates AI images", async () => {
  const app = setup();
  await Promise.resolve();
  assert.equal(app.slides.length, 2);
  assert.equal(app.aiCalls(), 0);
  assert.equal(app.renders.length, 2);
});

test("AI is opt-in for one slide and can be switched back to stock", async () => {
  const app = setup();
  const slide = app.slides[0];
  await slide.querySelector(".slide-ai").fire("click");
  assert.equal(app.aiCalls(), 1);
  assert.equal(app.context.carouselSelectedArt.get(app.data.slides[0]), "ai.jpg");
  assert.equal(app.context.carouselSelectedArt.has(app.data.slides[1]), false);
  await slide.querySelector(".slide-stock").fire("click");
  assert.equal(app.context.carouselSelectedArt.has(app.data.slides[0]), false);
});

test("failed AI keeps stock available and restores the controls", async () => {
  const app = setup({ generate: async () => { throw new Error("Free AI is busy"); } });
  await app.slides[0].querySelector(".slide-ai").fire("click");
  assert.equal(app.data.slides[0]._img, "stock.jpg");
  assert.equal(app.context.carouselSelectedArt.has(app.data.slides[0]), false);
  assert.equal(app.slides[0].querySelector(".slide-ai").disabled, false);
  assert.match(app.slides[0].querySelector(".slide-image-status").textContent, /busy/);
});

test("text editing persists and redraws the same slide without an AI request", async () => {
  const app = setup();
  const slide = app.slides[0];
  slide.querySelector(".slide-heading").value = "Tumhara intro viewers bhaga raha hai";
  slide.querySelector(".slide-body").value = "Result pehle dikhao. Intro baad mein.";
  await slide.querySelector(".slide-apply").fire("click");
  assert.equal(app.data.slides[0].heading, "Tumhara intro viewers bhaga raha hai");
  assert.equal(app.renders.at(-1).body, "Result pehle dikhao. Intro baad mein.");
  assert.equal(app.aiCalls(), 0);
  assert.equal(app.saves(), 1);
  const draft = app.drafts[app.data._editKey];
  assert.equal(draft.slides[0].heading, app.data.slides[0].heading);
  assert.equal(draft.slides[0]._img, undefined);
  const reopened = { ...app.data, slides: app.data.slides.map((s) => ({ ...s, heading: "old" })) };
  app.context.restoreCarouselDraft(reopened);
  assert.equal(reopened.slides[0].heading, app.data.slides[0].heading);
});

test("draft keys distinguish different carousels with the same generated id", () => {
  const app = setup();
  const other = { ...app.data, _editKey: undefined, topic: "Editing audio" };
  assert.notEqual(app.context.carouselDraftKey(app.data), app.context.carouselDraftKey(other));
});

test("cover alternatives fill editable fields without silently applying them", async () => {
  const app = setup();
  app.data.hookOptions = [{ heading: "Better topic hook", body: "A concrete promise" }];
  app.context.buildCarouselCard(app.data);
  const slide = app.created.filter((el) => el.tag === "section")[2];
  await slide.querySelector(".slide-hook-options").children[0].fire("click");
  assert.equal(slide.querySelector(".slide-heading").value, "Better topic hook");
  assert.equal(app.data.slides[0].heading, "Old hook");
});

test("caption and hashtag edits update the saved draft and share data", async () => {
  const app = setup();
  const caption = app.created.find((el) => el.className === "slide-editor carousel-caption-editor");
  caption.querySelector("textarea").value = "A better caption";
  caption.querySelector("input").value = "creators, #reels";
  await caption.querySelector("button").fire("click");
  assert.equal(app.data.caption, "A better caption");
  assert.equal(Array.from(app.data.hashtags).join(" "), "#creators #reels");
  assert.equal(app.card.querySelector(".s-caption").textContent, "A better caption");
  assert.equal(app.drafts[app.data._editKey].caption, "A better caption");
});

test("hook generation is grounded in topic and actual slide content", () => {
  const prompt = buildCarouselHookPrompt("Reel openings", [{ heading: "Result first", body: "Use a before/after example" }]);
  assert.match(prompt, /TOPIC: Reel openings/);
  assert.match(prompt, /before\/after example/);
  assert.match(prompt, /No invented statistics/);
  assert.match(prompt, /5-10 natural Hinglish words/);
  assert.ok(buildCarouselPrompt("creators").includes(CAROUSEL_HOOK_GUIDE));
});
