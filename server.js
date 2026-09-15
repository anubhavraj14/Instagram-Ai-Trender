import "dotenv/config";
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { researchTrends, researchViral, researchPlan } from "./lib/gemini.js";
import { DEFAULT_NICHE } from "./lib/prompt.js";
import { getSavedList, setSavedList, getCache, setCache, storageMode } from "./lib/storage.js";

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
  res.json({ niche: NICHE, requiresPass: !!PASSCODE, storage: storageMode })
);
app.get("/api/trends", makeCachedRoute("Trends", researchTrends));
app.get("/api/viral", makeCachedRoute("Viral", researchViral));
app.get("/api/plan", makeCachedRoute("Plan", researchPlan));

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

app.listen(PORT, () => {
  console.log(`\n  Reel Studio running -> http://localhost:${PORT}`);
  console.log(`  Storage: ${storageMode}${PASSCODE ? " · passcode ON" : " · passcode OFF (open)"}\n`);
});
