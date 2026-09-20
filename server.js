import "dotenv/config";
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { researchTrends, researchViral, researchPlan, researchCarousels } from "./lib/gemini.js";
import { searchPexelsImage, searchPexelsVideo, hasPexelsKey } from "./lib/pexels.js";
import { transcribeAudio, hasWhisperKey } from "./lib/whisper.js";
import { planEdit } from "./lib/gemini.js";
import { probeMedia, extractAudio } from "./lib/editor.js";
import busboy from "busboy";
import fs from "node:fs";
import path from "node:path";
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
  res.json({ niche: NICHE, requiresPass: !!PASSCODE, storage: storageMode, images: hasPexelsKey(), editor: hasWhisperKey() })
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

// ---------------- Reel Editor ----------------
// Upload raw talking-head video -> transcribe (Groq Whisper) -> Gemini edit plan
// -> fetch Pexels B-roll -> ffmpeg render -> downloadable 1080x1920 mp4.
// Jobs are in-memory (single process); files live in data/uploads|outputs.

const UPLOADS = join(__dirname, "data", "uploads");
const OUTPUTS = join(__dirname, "data", "outputs");
for (const d of [UPLOADS, OUTPUTS]) fs.mkdirSync(d, { recursive: true });

const jobs = new Map(); // id -> {status, step, error, output, file, transcript, plan}
const newJobId = () => createHash("sha1").update(`${Date.now()}:${Math.random()}`).digest("hex").slice(0, 12);

// Multipart upload (max ~120MB, video only). Creates a job in "uploaded" state.
app.post("/api/reel/upload", (req, res) => {
  const bb = busboy({ headers: req.headers, limits: { fileSize: 120 * 1024 * 1024, files: 1 } });
  const id = newJobId();
  let saved = null;
  bb.on("file", (_name, file, info) => {
    const mime = info.mimeType || "";
    if (!mime.startsWith("video/") && !/\.(mp4|mov|webm|m4v)$/i.test(info.filename || "")) {
      file.resume();
      return;
    }
    saved = join(UPLOADS, `${id}.mp4`);
    file.pipe(fs.createWriteStream(saved));
    file.on("limit", () => {
      fs.unlink(saved, () => {});
      saved = null;
      if (!res.headersSent) res.status(413).json({ error: "Video too large (max 120MB)", code: "TOO_BIG" });
    });
  });
  bb.on("finish", () => {
    if (res.headersSent) return;
    if (!saved || !fs.existsSync(saved)) {
      return res.status(400).json({ error: "No video file received", code: "NO_FILE" });
    }
    jobs.set(id, { status: "uploaded", step: "Uploaded", file: saved, createdAt: Date.now() });
    res.json({ id });
  });
  req.pipe(bb);
});

// Kick off the render pipeline. Runs async; poll /api/reel/:id/status.
app.post("/api/reel/:id/render", async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found", code: "NOT_FOUND" });
  if (job.status === "rendering") return res.json({ ok: true });
  if (!hasWhisperKey()) {
    return res.status(400).json({
      error: "Speech timing needs a free Groq key — add GROQ_API_KEY (console.groq.com).",
      code: "NO_GROQ_KEY",
    });
  }
  job.status = "rendering";
  job.error = null;
  job.script = String(req.body?.script || "").trim().slice(0, 8000);
  res.json({ ok: true });
  runRenderJob(req.params.id, job).catch((e) => {
    job.status = "failed";
    job.error = e.message;
    console.error("reel render failed:", e);
  });
});

// PLAN PHASE — the server never decodes video frames anymore (that is what OOMed
// the 512MB instance). It only: probes headers, extracts audio, runs Whisper for
// timing, asks Gemini for an edit plan, and resolves Pexels media URLs. The
// browser renders pixels on-device (MediaPipe segmentation + canvas + WebCodecs),
// then uploads the silent render to /mux which just copies in the audio track.
async function runRenderJob(id, job) {
  const step = (s) => { job.step = s; };
  const dir = join(UPLOADS, id);
  fs.mkdirSync(dir, { recursive: true });

  step("Reading video");
  const meta = await probeMedia(job.file);
  if (!meta.duration || meta.duration < 2) throw new Error("Could not read video — try an mp4/mov file.");
  job.duration = Math.min(meta.duration, 95);

  // Whisper is used for TIMING ONLY (when each part is spoken) — no captions are
  // burned; the user adds subtitles themselves afterwards.
  step("Analyzing speech timing (Whisper)");
  const audioPath = join(dir, "audio.mp3");
  await extractAudio(job.file, audioPath);
  const tx = await transcribeAudio(audioPath);
  job.transcript = tx.text;
  job.audioPath = audioPath;
  if (!tx.segments?.length && !tx.text) throw new Error("No speech detected in the video.");

  step("Planning the edit (Gemini)");
  // The creator's own script is the primary source; Whisper transcript is the fallback.
  const plan = await planEdit(job.script || tx.text, tx.segments, meta.duration);
  const edits = (Array.isArray(plan.edits) ? plan.edits : []).filter(
    (e) => e && typeof e.start === "number"
  );
  job.plan = { title: plan.title || "Reel", edits: edits.length };

  step("Finding B-roll & visuals");
  for (const e of edits) {
    if (e.type !== "broll" || !e.query) continue;
    try {
      if (e.media === "image") {
        const img = await searchPexelsImage(e.query, {});
        e.mediaUrl = img.url;
      } else {
        const clip = await searchPexelsVideo(e.query);
        if (clip) e.mediaUrl = clip.url;
      }
    } catch (err) {
      console.warn(`b-roll "${e.query}" skipped: ${err.message}`);
    }
  }

  job.planData = { title: plan.title || "Reel", edits, duration: job.duration };
  job.status = "planned"; // browser picks it up and renders on-device
  job.step = "Plan ready — rendering on your device";
}

// Browser sends back the silently-rendered video; we copy in the audio track.
// (-c:v copy = no re-encode, near-zero memory.)
app.post("/api/reel/:id/mux", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found", code: "NOT_FOUND" });
  const bb = busboy({ headers: req.headers, limits: { fileSize: 200 * 1024 * 1024, files: 1 } });
  const dir = join(UPLOADS, req.params.id);
  fs.mkdirSync(dir, { recursive: true });
  let saved = null;
  bb.on("file", (_n, file) => {
    saved = join(dir, "rendered.mp4");
    file.pipe(fs.createWriteStream(saved));
  });
  bb.on("finish", async () => {
    if (!saved || !fs.existsSync(saved)) return res.status(400).json({ error: "No video received" });
    try {
      job.step = "Adding audio";
      const out = join(OUTPUTS, `${req.params.id}.mp4`);
      const args = ["-y", "-i", saved];
      if (job.audioPath && fs.existsSync(job.audioPath)) args.push("-i", job.audioPath);
      args.push("-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest",
        "-movflags", "+faststart", out);
      await runFfmpegSimple(args);
      job.output = `/api/reel/${req.params.id}/output`;
      job.status = "done";
      job.step = "Done";
      res.json({ ok: true, output: job.output });
    } catch (e) {
      job.status = "failed";
      job.error = e.message;
      res.status(500).json({ error: e.message });
    }
  });
  req.pipe(bb);
});

// Minimal ffmpeg runner for the cheap mux step (reuses editor's binary).
import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
function runFfmpegSimple(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", reject);
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`mux failed: ${err.slice(-300)}`))));
  });
}

// Optional media proxy in case a Pexels URL lacks CORS headers in some browser.
app.get("/api/reel-media", async (req, res) => {
  const url = String(req.query.url || "");
  if (!/^https:\/\/(images|videos|player)\.pexels\.com\//.test(url)) {
    return res.status(400).json({ error: "Bad url" });
  }
  try {
    const r = await fetch(url);
    if (!r.ok) return res.status(502).end();
    res.set("Content-Type", r.headers.get("content-type") || "application/octet-stream");
    res.set("Access-Control-Allow-Origin", "*");
    const { Readable } = await import("node:stream");
    Readable.fromWeb(r.body).pipe(res);
  } catch (e) {
    res.status(502).end();
  }
});

app.get("/api/reel/:id/status", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found", code: "NOT_FOUND" });
  res.json({
    status: job.status, step: job.step, error: job.error,
    output: job.output, duration: job.duration, plan: job.plan,
    transcript: job.transcript, planData: job.planData,
  });
});

app.get("/api/reel/:id/output", (req, res) => {
  const f = join(OUTPUTS, `${req.params.id}.mp4`);
  if (!fs.existsSync(f)) return res.status(404).json({ error: "Not ready", code: "NOT_READY" });
  res.sendFile(f);
});

app.listen(PORT, () => {
  console.log(`\n  Reel Studio running -> http://localhost:${PORT}`);
  console.log(`  Storage: ${storageMode}${PASSCODE ? " · passcode ON" : " · passcode OFF (open)"}\n`);
});
