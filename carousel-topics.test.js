import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { CAROUSEL_PILLARS, planCarouselTopics, topicsOverlap, validateCarouselTopics, createCarouselResearch } from "./lib/carouselTopics.js";
import { buildCarouselPrompt } from "./lib/prompt.js";

function batch(plan, suffix = "") {
  return { carousels: plan.map((p) => ({ pillarId: p.id, topic: `${p.angle}${suffix}`, title: `${p.label}${suffix}`, slides: [{ heading: p.angle, body: "Practical example" }] })) };
}

test("rotation covers twelve distinct pillars before reusing any", () => {
  const ids = [0, 3, 6, 9].flatMap((cursor) => planCarouselTopics(cursor).map((p) => p.id));
  assert.equal(new Set(ids).size, CAROUSEL_PILLARS.length);
  assert.notEqual(planCarouselTopics(0)[0].angle, planCarouselTopics(12)[0].angle);
  assert.ok(ids.every((id) => !["hooks", "carousels"].includes(id)));
});

test("prompt separates the format from subjects and excludes recent topics", () => {
  const plan = planCarouselTopics(0);
  const prompt = buildCarouselPrompt("creator growth", [], { plan, recent: [{ topic: "A previous lighting tutorial" }] });
  assert.match(prompt, /TOPIC ASSIGNMENTS/);
  assert.match(prompt, /A previous lighting tutorial/);
  assert.match(prompt, /Phone filming and production/);
  assert.match(prompt, /format, NOT the subject/);
});

test("topic fingerprints reject renamed duplicates but allow different lessons", () => {
  assert.equal(topicsOverlap("How to record clean audio at home", "Record clean audio at home!"), true);
  assert.equal(topicsOverlap("Phone lighting setup", "Clean voice recordings"), false);
});

test("batches must cover the assigned pillars and avoid recent topics", () => {
  const plan = planCarouselTopics(0);
  const good = batch(plan);
  assert.equal(validateCarouselTopics(good, plan).length, 3);
  assert.throws(() => validateCarouselTopics(good, plan, [{ topic: good.carousels[0].topic }]), /repeats/);
  const wrong = batch(plan);
  wrong.carousels[1].pillarId = plan[0].id;
  assert.throws(() => validateCarouselTopics(wrong, plan), /exactly once/);
});

test("successful refreshes persist history and advance the next batch", async () => {
  const cache = new Map();
  const plans = [];
  let current;
  const options = {
    getCache: async (key) => cache.get(key), setCache: async (key, value) => cache.set(key, value),
    fetchSignals: async (plan) => { current = plan; plans.push(plan); return []; },
    generate: async () => batch(current),
  };
  const research = createCarouselResearch(options);
  await research("creators");
  await research("creators");
  assert.notEqual(plans[0][0].id, plans[1][0].id);
  const restarted = createCarouselResearch(options);
  await restarted("creators");
  assert.notEqual(plans[1][0].id, plans[2][0].id);
  assert.equal([...cache.values()][0].recent.length, 9);
});

test("meta-topics are rejected even if the model labels them as an assigned pillar", () => {
  const plan = planCarouselTopics(0);
  const data = batch(plan);
  data.carousels[0].topic = "Write better carousel hooks";
  assert.throws(() => validateCarouselTopics(data, plan), /not carousel creation/);
});

test("invalid topic batches get one bounded revision, not an endless retry loop", async () => {
  let calls = 0;
  const research = createCarouselResearch({
    getCache: async () => null, setCache: async () => {}, fetchSignals: async () => [],
    generate: async () => { calls++; return { carousels: [] }; },
  });
  await assert.rejects(research("creators"), /exactly three/);
  assert.equal(calls, 2);
});

const server = await readFile(new URL("./server.js", import.meta.url), "utf8");
const routeSource = server.slice(server.indexOf("function makeCachedRoute("), server.indexOf('app.get("/api/config"'));
function response() {
  return { status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; return this; } };
}

test("normal visits reuse the current batch, while Refresh bypasses it and uses the new cache version", async () => {
  const cache = new Map([["carousels", { legacy: true }]]);
  let calls = 0;
  const context = vm.createContext({ NICHE: "creators", console,
    getCache: async (key) => cache.get(key), setCache: async (key, data) => cache.set(key, data) });
  vm.runInContext(routeSource, context);
  const route = context.makeCachedRoute("Carousels", async () => ({ batch: ++calls }), "carousels-v2");
  const first = response();
  await route({ query: {} }, first);
  assert.equal(first.data.batch, 1);
  assert.equal(first.data.legacy, undefined);
  const cached = response();
  await route({ query: {} }, cached);
  assert.equal(cached.data.cached, true);
  assert.equal(calls, 1);
  const fresh = response();
  await route({ query: { force: "1" } }, fresh);
  assert.equal(fresh.data.batch, 2);
  assert.equal(fresh.data.cached, false);
  assert.equal(cache.get("carousels-v2").batch, 2);
});

test("simultaneous refreshes share one generation", async () => {
  let calls = 0;
  let finish;
  const context = vm.createContext({ NICHE: "creators", console, getCache: async () => null, setCache: async () => {} });
  vm.runInContext(routeSource, context);
  const route = context.makeCachedRoute("Carousels", () => { calls++; return new Promise((resolve) => { finish = resolve; }); });
  const a = response(), b = response();
  const first = route({ query: { force: "1" } }, a);
  const second = route({ query: { force: "1" } }, b);
  finish({ batch: 1 });
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(a.data.batch, b.data.batch);
});

test("failed generation does not advance or overwrite topic history", async () => {
  const cache = new Map();
  let current;
  let fail = false;
  const research = createCarouselResearch({
    getCache: async (key) => cache.get(key), setCache: async (key, value) => cache.set(key, value),
    fetchSignals: async (plan) => { current = plan; return []; },
    generate: async () => { if (fail) throw new Error("quota"); return batch(current); },
  });
  await research("creators");
  const before = JSON.stringify([...cache.values()]);
  fail = true;
  await assert.rejects(research("creators"), /quota/);
  assert.equal(JSON.stringify([...cache.values()]), before);
});
