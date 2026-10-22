import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { buildCarouselPrompt } from "./lib/prompt.js";

const source = await readFile(new URL("./public/app.js", import.meta.url), "utf8");
const wrap = source.slice(source.indexOf("function wrapLines("), source.indexOf("/* slide images:"));
const render = source.slice(source.indexOf("async function slideCanvas("), source.indexOf("function canvasToBlob("));

function renderer() {
  const text = [];
  const ctx = {
    font: "", textAlign: "left",
    measureText(value) {
      const size = Number(this.font.match(/([\d.]+)px/)[1]);
      return { width: value.length * size * 0.55 };
    },
    fillText(value, x, y, maxWidth) { text.push({ value, x, y, maxWidth, font: this.font }); },
    fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    createLinearGradient() { return { addColorStop() {} }; },
  };
  const canvas = { getContext: () => ctx };
  const context = vm.createContext({
    document: { createElement: () => canvas },
    loadSlideImage: async () => null,
  });
  vm.runInContext(`${wrap}\n${render}`, context);
  return { draw: context.slideCanvas, text, canvas };
}

for (const type of ["cover", "point", "cta"]) {
  test(`${type} renders a portrait poster with full copy and navigation`, async () => {
    const { draw, text, canvas } = renderer();
    const body = "Pehle 3 seconds mein result dikhao. Phir ek clear example se apna process samjhao.";
    await draw({ type, heading: "Reach kaise badhaye", body }, 2, 8);
    assert.equal(canvas.width, 1080);
    assert.equal(canvas.height, 1350);
    assert.ok(text.some((t) => t.value === "03 / 08"));
    const headline = text.filter((t) => t.font.includes("900"));
    assert.equal(headline.map((t) => t.value).join(" "), "REACH KAISE BADHAYE");
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

test("batch carousel prompt uses cinematic direction and stock-search keywords", () => {
  const prompt = buildCarouselPrompt("creators", []);
  assert.match(prompt, /cinematic editorial posters/);
  assert.match(prompt, /not image-generation instructions/);
  assert.doesNotMatch(prompt, /each slide is a full-bleed REAL PHOTO/);
});
