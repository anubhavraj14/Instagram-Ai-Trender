import "dotenv/config";
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { researchTrends, researchViral, researchPlan, researchCarousels } from "./lib/gemini.js";
import { searchPexelsImage, hasPexelsKey } from "./lib/pexels.js";
import { DEFAULT_NICHE } from "./lib/prompt.js";
import { getSavedList, setSavedList, getCache, setCache, getEditsMap, setEditsMap, storageMode } from "./lib/storage.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const NICHE = process.env.CREATOR_NICHE || DEFAULT_NICHE;
const PASSCODE = process.env.APP_PASSCODE || "";

app.use(express.json({ limit: "2mb" }));
app.use(express.static(join(__dirname, "public")));

// Gate the private saved-list routes behind the passcode (if one is configured).
function requirePass(req, res, next) {
  if (!PASSCODE) return next(); // no passcode set (e.g. local dev) => open
  const given = req.get("x-app-passcode") || "";
  if (given && given === PASSCODE) return next();
  return res.status(401).json({ error: "Invalid or missing passcode", code: "AUTH" });
}

// Persistent cache + request-coalescing wrapper.
// Content is generated once and stored (in Upstash), then served on every visit —
// even after the server sleeps/restarts. It ONLY regenerates when ?force=1 (Refresh button).
function makeCachedRoute(name, worker) {
  const key = name.toLowerCase();
  let inflight = null;
  return async (req, res) => {
    const force = req.query.force === "1";
    try {
      if (!force) {
        const cached = await getCache(key).catch(() => null);
        if (cached) return res.json({ ...cached, cached: true });
      }
      if (!inflight) {
        inflight = worker(NICHE)
          .then(async (data) => {
            const stored = { ...data, cachedAt: Date.now() };
            await setCache(key, stored).catch((e) => console.warn(`cache save failed: ${e.message}`));
            return stored;
          })
          .finally(() => {
            inflight = null;
          });
      }
      const data = await inflight;
      res.json({ ...data, cached: false });
    } catch (err) {
      console.error(`${name} failed:`, err.message);
      res.status(err.code === "NO_API_KEY" ? 400 : 500).json({
        error: err.message,
        code: err.code || "RESEARCH_FAILED",
      });
    }
  };
}

app.get("/api/config", (_req, res) =>
  res.json({ niche: NICHE, requiresPass: !!PASSCODE, storage: storageMode, images: hasPexelsKey() })
);
app.get("/api/trends", makeCachedRoute("Trends", researchTrends));
app.get("/api/viral", makeCachedRoute("Viral", researchViral));
app.get("/api/plan", makeCachedRoute("Plan", researchPlan));
app.get("/api/carousels", makeCachedRoute("Carousels", researchCarousels));

// Per-slide REAL photo lookup via Pexels, cached by query+mood (Upstash or memory).
// The browser loads the returned Pexels URL directly (fast, CORS-clean for canvas export).
const imgInflight = new Map();
app.get("/api/slide-image", async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 200);
  const mood = String(req.query.mood || "").trim().slice(0, 20);
  if (!q) return res.status(400).json({ error: "Missing image query", code: "BAD_QUERY" });
  const key = "slideimg:" + createHash("sha1").update(`${q}|${mood}`).digest("hex");
  try {
    const cached = await getCache(key).catch(() => null);
    if (cached?.url) return res.json({ ...cached, cached: true });
    if (!imgInflight.has(key)) {
      imgInflight.set(
        key,
        searchPexelsImage(q, { mood })
          .then(async (out) => {
            await setCache(key, { ...out, cachedAt: Date.now() }).catch(() => {});
            return out;
          })
          .finally(() => imgInflight.delete(key))
      );
    }
    const out = await imgInflight.get(key);
    res.json({ ...out, cached: false });
  } catch (err) {
    const status = err.code === "NO_PEXELS_KEY" ? 400 : err.code === "PEXELS_RATE_LIMIT" ? 429 : 500;
    if (status >= 500) console.error("slide-image failed:", err.message);
    res.status(status).json({ error: err.message, code: err.code || "IMG_FAILED" });
  }
});

// Login just validates the passcode (client then stores it and sends it as a header).
app.post("/api/login", (req, res) => {
  if (!PASSCODE) return res.json({ ok: true });
  if ((req.body?.passcode || "") === PASSCODE) return res.json({ ok: true });
  res.status(401).json({ ok: false, error: "Wrong passcode" });
});

// Synced saved-ideas list (shared across devices, gated by passcode).
app.get("/api/saved", requirePass, async (_req, res) => {
  try {
    res.json({ items: await getSavedList() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.put("/api/saved", requirePass, async (req, res) => {
  try {
    await setSavedList(req.body?.items || []);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Synced per-script edits (custom user versions of generated scripts) — same
// passcode gate as the saved list, so edits follow you across devices.
app.get("/api/edits", requirePass, async (_req, res) => {
  try {
    res.json({ items: await getEditsMap() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.put("/api/edits", requirePass, async (req, res) => {
  try {
    await setEditsMap(req.body?.items || {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n  Reel Studio running -> http://localhost:${PORT}`);
  console.log(`  Storage: ${storageMode}${PASSCODE ? " · passcode ON" : " · passcode OFF (open)"}\n`);
});
