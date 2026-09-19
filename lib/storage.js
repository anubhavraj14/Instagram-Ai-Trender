// Persistent storage for the saved-ideas list.
// Uses Upstash Redis (free, no card) via its REST API when configured;
// falls back to in-memory storage for local dev so the app still runs.

const REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = process.env.SAVED_KEY || "reelstudio:saved";

export const storageMode = REST_URL && REST_TOKEN ? "upstash" : "memory";

const mem = new Map();

async function redis(command) {
  const res = await fetch(REST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upstash error ${res.status}: ${text.slice(0, 120)}`);
  }
  const json = await res.json();
  return json.result;
}

export async function getSavedList() {
  if (storageMode === "memory") return mem.get(KEY) || [];
  const raw = await redis(["GET", KEY]);
  try {
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function setSavedList(list) {
  const safe = Array.isArray(list) ? list.slice(0, 500) : [];
  if (storageMode === "memory") {
    mem.set(KEY, safe);
    return;
  }
  await redis(["SET", KEY, JSON.stringify(safe)]);
}

// Persistent cache for generated research (trends/viral/plan) so content survives
// server restarts/sleep and only changes when the user explicitly refreshes.
const CACHE_PREFIX = "reelstudio:cache:";

export async function getCache(name) {
  if (storageMode === "memory") return mem.get(CACHE_PREFIX + name) || null;
  const raw = await redis(["GET", CACHE_PREFIX + name]);
  return raw ? JSON.parse(raw) : null;
}

export async function setCache(name, data) {
  if (storageMode === "memory") {
    mem.set(CACHE_PREFIX + name, data);
    return;
  }
  await redis(["SET", CACHE_PREFIX + name, JSON.stringify(data)]);
}

// Synced per-script edits map (custom user versions of generated scripts),
// stored alongside the saved list so edits follow you across devices.
const EDITS_KEY = "reelstudio:edits";

export async function getEditsMap() {
  if (storageMode === "memory") return mem.get(EDITS_KEY) || {};
  const raw = await redis(["GET", EDITS_KEY]);
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function setEditsMap(map) {
  const safe = typeof map === "object" && map ? map : {};
  if (storageMode === "memory") {
    mem.set(EDITS_KEY, safe);
    return;
  }
  await redis(["SET", EDITS_KEY, JSON.stringify(safe)]);
}
