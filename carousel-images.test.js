import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { buildCarouselImagePrompt, createFreeImageGenerator } from "./lib/carouselImages.js";

const image = () => new Response(Buffer.alloc(2048), { headers: { "content-type": "image/jpeg" } });

test("art prompt reserves text space and includes series direction and scene", () => {
  const prompt = buildCarouselImagePrompt({ prompt: "A glowing cinema lifted by a giant hook", direction: "amber and obsidian" });
  assert.match(prompt, /lower 45 percent/);
  assert.match(prompt, /amber and obsidian/);
  assert.match(prompt, /giant hook/);
  assert.match(prompt, /No text/);
});

test("free generator returns export-safe data and never sends payment or credentials", async () => {
  let called;
  const generate = createFreeImageGenerator({ fetchImage: async (url, options) => {
    called = { url, options };
    return image();
  } });
  const out = await generate("giant glass eye");
  assert.equal(out.generated, true);
  assert.equal(out.source, "pollinations");
  assert.match(out.url, /^data:image\/jpeg;base64,/);
  assert.equal(called.url.origin, "https://image.pollinations.ai");
  assert.equal(called.url.searchParams.get("safe"), "true");
  assert.equal(called.options.headers, undefined);
  assert.equal(called.url.searchParams.get("key"), null);
});

test("free generation serializes requests and enforces cooldown", async () => {
  let time = 0;
  let finish;
  const generate = createFreeImageGenerator({ now: () => time, fetchImage: () => new Promise((resolve) => { finish = resolve; }) });
  const first = generate("one");
  await assert.rejects(generate("two"), { code: "IMAGE_BUSY", retryAfter: 46 });
  finish(image());
  await first;
  await assert.rejects(generate("two"), { code: "IMAGE_BUSY" });
  time = 46000;
  const second = generate("two");
  finish(image());
  await second;
});

test("402 is treated as a free-tier cooldown, never a payment instruction", async () => {
  let calls = 0;
  const generate = createFreeImageGenerator({ fetchImage: async () => {
    calls++;
    return new Response("payment required", { status: 402, headers: { "Retry-After": "60" } });
  } });
  await assert.rejects(generate("one"), { code: "IMAGE_BUSY", retryAfter: 60 });
  assert.equal(calls, 1);
});

test("provider HTML and undersized responses are rejected", async () => {
  const html = createFreeImageGenerator({ fetchImage: async () => new Response("<html>error</html>") });
  await assert.rejects(html("scene"), /did not return an image/);
  const small = createFreeImageGenerator({ fetchImage: async () => new Response("bad", { headers: { "content-type": "image/jpeg" } }) });
  await assert.rejects(small("scene"), /invalid image size/);
});

const source = await readFile(new URL("./public/app.js", import.meta.url), "utf8");
const loader = source.slice(source.indexOf("const carouselArtCache"), source.indexOf("function loadSlideImage("));
function client(fetch) {
  const context = vm.createContext({ fetch, passHeaders: () => ({}), AbortSignal,
    setTimeout: (resolve) => { resolve(); }, });
  vm.runInContext(loader, context);
  return context.loadCarouselArtwork;
}

test("client deduplicates artwork and does not save base64 onto slide records", async () => {
  let calls = 0;
  const load = client(async () => {
    calls++;
    return Response.json({ url: "data:image/jpeg;base64,test", generated: true });
  });
  const a = { imagePrompt: "eye" }, b = { imagePrompt: "eye" };
  await Promise.all([load(a), load(b)]);
  assert.equal(calls, 1);
  assert.equal(a._imageSource, undefined);
  assert.equal(b._imageSource, undefined);
  assert.equal(a._img, undefined);
});

test("manual AI throttling fails promptly without sleeping or replacing stock", async () => {
  let calls = 0;
  const load = client(async () => {
    calls++;
    return new Response("busy", { status: 429, headers: { "Retry-After": "46" } });
  });
  const slide = { imagePrompt: "eye", _img: "stock.jpg" };
  await assert.rejects(load(slide), /46 seconds/);
  assert.equal(calls, 1);
  assert.equal(slide._img, "stock.jpg");
});

test("initial carousel image loading uses stock even when an AI prompt exists", async () => {
  const calls = [];
  const context = vm.createContext({
    fetch: async (url) => { calls.push(url); return Response.json({ url: "stock.jpg" }); },
    passHeaders: () => ({}), AbortSignal, setTimeout,
  });
  vm.runInContext(source.slice(source.indexOf("const slideImgCache"), source.indexOf("function loadImageEl(")), context);
  const slide = { imagePrompt: "a dramatic eye", imageQuery: "spotlight stage" };
  assert.equal(await context.loadSlideImage(slide), "stock.jpg");
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^\/api\/slide-image\?/);
});

test("AI selection is used by rendering without issuing another generation request", async () => {
  let calls = 0;
  const context = vm.createContext({ fetch: async () => { calls++; throw new Error("Unexpected fetch"); }, passHeaders: () => ({}), AbortSignal, setTimeout });
  vm.runInContext(source.slice(source.indexOf("const slideImgCache"), source.indexOf("function loadImageEl(")), context);
  context.slide = { imageQuery: "camera", imagePrompt: "eye", _img: "stock.jpg" };
  vm.runInContext('carouselSelectedArt.set(slide, "ai.jpg")', context);
  assert.equal(await context.loadSlideImage(context.slide), "ai.jpg");
  assert.equal(calls, 0);
  vm.runInContext("carouselSelectedArt.delete(slide)", context);
  assert.equal(await context.loadSlideImage(context.slide), "stock.jpg");
  assert.equal(calls, 0);
});

test("an unexpected stock response cannot replace an image during manual AI generation", async () => {
  const load = client(async () => Response.json({ url: "stock.jpg", generated: false }));
  await assert.rejects(load({ imagePrompt: "eye", _img: "original.jpg" }), /current photo is unchanged/);
});

test("client allows retry after a failed generation rather than caching failure", async () => {
  let calls = 0;
  const load = client(async () => ++calls === 1
    ? new Response("unavailable", { status: 503 })
    : Response.json({ url: "data:image/jpeg;base64,test", generated: true }));
  const slide = { imagePrompt: "eye" };
  await assert.rejects(load(slide), /Artwork unavailable/);
  await load(slide);
  assert.equal(calls, 2);
});
