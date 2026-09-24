// Instagram Reel Analyzer — download a Reel, then run ONE Gemini vision pass that
// transcribes the speech and breaks down structure + visuals. Falls back to
// Whisper transcription + a text-only pass when the video can't be uploaded.
//
// Video download uses yt-dlp: a system `yt-dlp` if present, otherwise a
// standalone binary fetched once into cache/bin (no Python needed).
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generateJson, generateJsonWithFile, uploadFileForAnalysis } from "./gemini.js";
import { extractAudio, probeMedia } from "./editor.js";
import { transcribeAudio, hasWhisperKey } from "./whisper.js";
import {
  buildReelAnalysisPrompt,
  buildReelAnalysisFromTranscriptPrompt,
  buildOriginalScriptPrompt,
  buildRephrasePrompt,
  DEFAULT_NICHE,
} from "./prompt.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN_DIR = join(__dirname, "..", "cache", "bin");
const YTDLP_URL =
  process.platform === "win32"
    ? "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    : process.platform === "darwin"
    ? "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
    : "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";

// Validate + normalize an Instagram Reel/post URL.
export function normalizeReelUrl(raw = "") {
  const u = String(raw).trim();
  const m = /^https?:\/\/(www\.)?instagram\.com\/(reel|reels|p)\/([\w-]+)/i.exec(u);
  if (!m) return null;
  return `https://www.instagram.com/${m[2]}/${m[3]}/`;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (c) => (c === 0 ? resolve(out) : reject(new Error(err.slice(-400) || `exit ${c}`))));
  });
}

let binPromise = null;
// Resolve a working yt-dlp binary: system install first, else download once.
async function ensureYtDlp() {
  if (binPromise) return binPromise;
  binPromise = (async () => {
    try {
      await run("yt-dlp", ["--version"]);
      return "yt-dlp";
    } catch {}
    fs.mkdirSync(BIN_DIR, { recursive: true });
    const dest = join(BIN_DIR, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
    if (!fs.existsSync(dest)) {
      const res = await fetch(YTDLP_URL);
      if (!res.ok || !res.body) throw new Error(`yt-dlp download failed (${res.status})`);
      const { Readable } = await import("node:stream");
      const { pipeline } = await import("node:stream/promises");
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
      fs.chmodSync(dest, 0o755);
    }
    // Verify it actually runs (some envs lack a compatible python for zipapp builds).
    try {
      await run(dest, ["--version"]);
      return dest;
    } catch {
      fs.rmSync(dest, { force: true });
      const err = new Error("No usable yt-dlp. Install it (`brew install yt-dlp`) or upload the Reel video file instead.");
      err.code = "NO_YTDLP";
      throw err;
    }
  })().catch((e) => {
    binPromise = null;
    throw e;
  });
  return binPromise;
}

// Download the reel video + metadata. Returns { file, meta }.
export async function downloadReel(url, dir) {
  const bin = await ensureYtDlp();
  fs.mkdirSync(dir, { recursive: true });
  const outTpl = join(dir, "reel.%(ext)s");
  // Optional: point IG_COOKIES at a Netscape-format cookies.txt exported from a
  // logged-in browser for reels Instagram gates behind auth.
  const cookieArgs = process.env.IG_COOKIES ? ["--cookies", process.env.IG_COOKIES] : [];
  await run(bin, [
    "--no-playlist",
    "--no-warnings",
    ...cookieArgs,
    "-f", "mp4/best[ext=mp4]/best",
    "--merge-output-format", "mp4",
    "-o", outTpl,
    "--print-json",
    url,
  ]).then((json) => json).catch((e) => {
    const err = new Error(
      /login|rate|private|429|authentication|cookies|sign in/i.test(e.message)
        ? "Instagram blocked the download (login required). Download the Reel yourself and upload the file instead."
        : `Reel download failed: ${e.message}`
    );
    err.code = "DOWNLOAD_FAILED";
    throw err;
  });
  const file = join(dir, "reel.mp4");
  if (!fs.existsSync(file)) {
    const any = fs.readdirSync(dir).find((f) => f.startsWith("reel."));
    if (!any) { const e = new Error("Download produced no video file."); e.code = "DOWNLOAD_FAILED"; throw e; }
    fs.renameSync(join(dir, any), file);
  }
  // Metadata via a second cheap pass (no download) — title/uploader/duration.
  let meta = {};
  try {
    const json = await run(bin, ["--no-playlist", "--skip-download", "--print-json", url]);
    const d = JSON.parse(json);
    meta = { title: d.title || d.description?.slice(0, 300) || "", author: d.uploader || d.channel || "", duration: d.duration || 0, webpage: d.webpage_url || url };
  } catch {}
  return { file, meta };
}

// Main analysis: prefer ONE Gemini vision pass over the actual video; fall back
// to Whisper transcript + text pass if video upload isn't possible.
export async function analyzeReel({ file, meta = {}, onStep = () => {} }) {
  let duration = meta.duration || 0;
  try {
    const p = await probeMedia(file);
    if (p.duration) duration = p.duration;
  } catch {}
  meta = { ...meta, duration };

  const sizeMb = fs.statSync(file).size / 1e6;
  if (sizeMb <= 90) {
    try {
      onStep("Uploading video to Gemini");
      const fileData = await uploadFileForAnalysis(file, "video/mp4");
      onStep("Analyzing speech + visuals (Gemini)");
      const out = await generateJsonWithFile(buildReelAnalysisPrompt(meta), fileData);
      out._mode = "vision";
      return out;
    } catch (e) {
      console.warn("vision analysis failed, falling back to transcript:", e.message);
    }
  }

  // Fallback: audio -> Whisper -> text analysis (visuals inferred).
  if (!hasWhisperKey()) {
    const err = new Error("Video upload to Gemini failed and no GROQ_API_KEY for the transcript fallback.");
    err.code = "NO_GROQ_KEY";
    throw err;
  }
  onStep("Transcribing audio (Whisper)");
  const audioPath = file + ".mp3";
  await extractAudio(file, audioPath);
  const tx = await transcribeAudio(audioPath);
  if (!tx.text) throw new Error("No speech detected in the video.");
  onStep("Analyzing script (Gemini)");
  const out = await generateJson(buildReelAnalysisFromTranscriptPrompt(tx.text, tx.segments, meta));
  out._mode = "transcript";
  if (!out.segments?.length && tx.segments?.length) {
    out.segments = tx.segments.map((s) => ({ start: s.start, end: s.end, part: "value", text: s.text, onScreen: "" }));
  }
  return out;
}

// Genuinely-new version of the analyzed script.
export async function makeOriginalScript(analysis, currentScriptText, niche = DEFAULT_NICHE) {
  return generateJson(buildOriginalScriptPrompt(analysis, currentScriptText, niche));
}

// Rephrase a single selected part, preserving meaning.
export async function rephrasePart(text, context = "") {
  const out = await generateJson(buildRephrasePrompt(text, context));
  return out.rephrased || "";
}
