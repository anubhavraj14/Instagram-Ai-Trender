import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { buildCarouselPrompt } from "./lib/prompt.js";

const source = await readFile(new URL("./public/app.js", import.meta.url), "utf8");
const wrap = source.slice(source.indexOf("function wrapLines("), source.indexOf("/* slide images:"));
const render = source.slice(source.indexOf("async function slideCanvas("), source.indexOf("function canvasToBlob("));

function renderer({ photo = false } = {}) {
  const text = [];
  const fills = [];
  const ctx = {
    font: "", textAlign: "left",
    measureText(value) {
      const size = Number(this.font.match(/([\d.]+)px/)[1]);
      return { width: value.length * size * 0.55 };
    },
    fillText(value, x, y, maxWidth) { text.push({ value, x, y, maxWidth, font: this.font, color: this.fillStyle }); },
    fillRect(x, y, width, height) { fills.push({ x, y, width, height, color: this.fillStyle }); },
    drawImage() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    createLinearGradient() { return { addColorStop() {} }; },
  };
  const canvas = { getContext: () => ctx };
  const context = vm.createContext({
    document: { createElement: () => canvas },
    loadSlideImage: async () => photo ? "bright-photo.jpg" : null,
    loadImageEl: async () => ({ width: 1080, height: 1350 }),
    carouselSelectedArt: new WeakMap(),
  });
  vm.runInContext(`${wrap}\n${render}`, context);
  return { draw: context.slideCanvas, text, canvas, fills };
}

for (const type of ["cover", "point", "cta"]) {
  test(`${type} renders a portrait poster with full copy and navigation`, async () => {
    const { draw, text, canvas } = renderer();
    const body = "Pehle 3 seconds mein result dikhao. Phir ek clear example se apna process samjhao.";
    await draw({ type, heading: "Reach kaise badhaye", body }, 2, 8);
    assert.equal(canvas.width, 1080);
    assert.equal(canvas.height, 1350);
    assert.ok(text.some((t) => t.value === "03 / 08"));
    const headline = text.filter((t) => t.font.startsWith("800"));
    assert.equal(headline.map((t) => t.value).join(" "), "Reach kaise badhaye");
    assert.ok(headline.every((t) => t.x === 540 && t.y < 780));
    const copy = text.filter((t) => t.font.startsWith("400"));
    assert.equal(copy.map((t) => t.value).join(" "), body);
    assert.ok(text.every((t) => t.y > 0 && t.y < 1350));
  });
}

test("legacy longer copy is not silently truncated", async () => {
  const { draw, text } = renderer();
  const body = Array.from({ length: 65 }, (_, i) => `step${i}`).join(" ");
  await draw({ heading: "A practical creator guide", body }, 0, 6);
  assert.equal(text.filter((t) => t.font.startsWith("400")).map((t) => t.value).join(" "), body);
});

test("edited cover text and manual line breaks render without losing words", async () => {
  const { draw, text } = renderer();
  await draw({ type: "cover", heading: "Tumhara intro hi viewers bhaga raha hai", body: "Result pehle dikhao.\nIntro baad mein." }, 0, 6);
  assert.equal(text.filter((t) => t.font.startsWith("400")).map((t) => t.value).join("\n"), "Result pehle dikhao.\nIntro baad mein.");
  assert.ok(text.every((t) => t.y > 0 && t.y < 1350));
});

test("unrenderable edited text fails explicitly rather than clipping silently", async () => {
  const { draw } = renderer();
  await assert.rejects(draw({ heading: "Cover", body: "line\n".repeat(100) }, 0, 6), /too long to fit/);
});

test("bright photos get a strong text backing with no decorative header clutter", async () => {
  const { draw, text, fills } = renderer({ photo: true });
  await draw({ type: "cover", heading: "A useful lesson", body: "Specific advice the audience can use." }, 0, 6);
  const panel = fills.find((fill) => fill.color === "rgba(8,12,20,0.92)");
  assert.ok(panel, "A high-opacity text backing is required even when the image is bright");
  const components = [8, 12, 20].map((channel) => (channel * 0.92 + 255 * 0.08) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = components[0] * 0.2126 + components[1] * 0.7152 + components[2] * 0.0722;
  assert.ok(1.05 / (luminance + 0.05) >= 7, "White text must retain at least 7:1 contrast over a white image");
  const copy = text.filter((t) => t.font.startsWith("800") || t.font.startsWith("400"));
  assert.ok(copy.every((t) => t.color === "#ffffff" && t.y > panel.y && t.y < panel.y + panel.height));
  assert.ok(!text.some((t) => ["CREATOR NOTES", "THE FIELD GUIDE", "PUT IT INTO PRACTICE"].includes(t.value)));
});

test("batch carousel prompt uses cinematic direction and stock-search keywords", () => {
  const prompt = buildCarouselPrompt("creators", []);
  assert.match(prompt, /cinematic editorial posters/);
  assert.match(prompt, /CUSTOM AI ARTWORK/);
  assert.match(prompt, /"imagePrompt"/);
  assert.match(prompt, /"artDirection"/);
  assert.match(prompt, /not image-generation instructions/);
  assert.doesNotMatch(prompt, /each slide is a full-bleed REAL PHOTO/);
});
