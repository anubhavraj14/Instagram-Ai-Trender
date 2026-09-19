// Reel render engine — turns a raw talking-head video into an edited 1080x1920
// Reel using ffmpeg: punch-in zooms, B-roll cutaways, dynamic captions, text cards.
//
// Approach:
//  - Captions + text cards are burned via a generated .ass subtitle file
//    (libass handles styling, positioning, outlines — no font gymnastics needed
//    beyond locating a fonts dir).
//  - Zooms are a crop expression driven by the edit plan's timestamps.
//  - B-roll clips are looped/trimmed, scaled to full frame, and overlaid with
//    enable=between(t,start,end) so they replace the speaker briefly.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

const W = 1080, H = 1920;

function runFfmpeg(args, label = "ffmpeg") {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve(err);
      else reject(new Error(`${label} exited ${code}: ${err.slice(-800)}`));
    });
  });
}

// ffmpeg-static ships no ffprobe — probe duration via `ffmpeg -i` stderr.
export async function probeMedia(file) {
  const out = await new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ["-i", file], { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", reject);
    p.on("close", () => resolve(err)); // always exits non-zero; info is in stderr
  });
  const dur = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(out);
  const vid = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(out);
  return {
    duration: dur ? +dur[1] * 3600 + +dur[2] * 60 + +dur[3] : 0,
    width: vid ? +vid[1] : 0,
    height: vid ? +vid[2] : 0,
  };
}

export async function extractAudio(input, output) {
  await runFfmpeg([
    "-y", "-i", input,
    "-vn", "-ac", "1", "-ar", "16000",
    "-codec:a", "libmp3lame", "-b:a", "48k",
    output,
  ], "extract audio");
}

// ---- ASS caption generation ----

const FONT_CANDIDATES = [
  // project-bundled font first (if user drops one in)
  path.join(process.cwd(), "assets", "fonts"),
  // macOS
  "/System/Library/Fonts/Supplemental",
  "/System/Library/Fonts",
  "/Library/Fonts",
  // Linux (Render/Docker base images ship DejaVu + fontconfig)
  "/usr/share/fonts/truetype/dejavu",
  "/usr/share/fonts",
];

export function findFontsDir() {
  for (const dir of FONT_CANDIDATES) {
    try {
      if (fs.readdirSync(dir).some((f) => /\.(ttf|otf|ttc)$/i.test(f))) return dir;
    } catch {}
  }
  return null;
}

const esc = (t) => t.replace(/[{}\\]/g, "").replace(/\n/g, "\\N");
const tAss = (s) => {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), sec = (cs % 6000) / 100;
  return `${h}:${String(m).padStart(2, "0")}:${sec.toFixed(2).padStart(5, "0")}`;
};

// Build an .ass file: word-grouped captions (bottom) + text cards (upper third).
export function buildAss(words = [], textcards = []) {
  const CAP_WORDS = 4; // words per caption line — punchy, readable
  const events = [];
  for (let i = 0; i < words.length; i += CAP_WORDS) {
    const group = words.slice(i, i + CAP_WORDS);
    if (!group.length) continue;
    events.push({
      start: group[0].start,
      end: group[group.length - 1].end + 0.08,
      style: "Cap",
      text: group.map((w) => w.word).join(" ").toUpperCase(),
    });
  }
  for (const tc of textcards) {
    events.push({
      start: tc.start,
      end: tc.start + (tc.duration || 1.5),
      style: "Card",
      text: (tc.text || "").toUpperCase(),
    });
  }
  events.sort((a, b) => a.start - b.start);
  const lines = events
    .map((e) => `Dialogue: 0,${tAss(e.start)},${tAss(e.end)},${e.style},,0,0,0,,${esc(e.text)}`)
    .join("\n");
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Arial,72,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,6,0,2,60,60,170,1
Style: Card,Arial,110,&H0000FFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,7,0,8,60,60,140,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lines}
`;
}

// ---- B-roll ----

export async function downloadFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

// ---- Main render ----
// edits: [{type:'zoom'|'broll'|'textcard', start, duration, scale?, query?, text?}]
// brollFiles: Map<editIndex, filePath> for resolved broll edits.
export async function renderReel({ input, output, edits = [], brollFiles = new Map(), assPath, duration }) {
  const fontsdir = findFontsDir();
  const args = ["-y", "-i", input];

  const brollIdx = [];
  edits.forEach((e, i) => {
    if (e.type === "broll" && brollFiles.has(i)) brollIdx.push([i, brollFiles.get(i)]);
  });
  // -stream_loop -1 lets short clips cover the requested window.
  for (const [, file] of brollIdx) args.push("-stream_loop", "-1", "-i", file);

  // Base: scale + cover-crop to 1080x1920, then zoom expression via crop.
  const zooms = edits.filter((e) => e.type === "zoom" && e.scale > 1);
  let zoomExpr = "1";
  for (const z of zooms) {
    const s = Math.max(0, z.start), e = z.start + (z.duration || 1);
    zoomExpr = `if(between(t,${s.toFixed(2)},${e.toFixed(2)}),${z.scale},${zoomExpr})`;
  }
  let vf = `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`;
  if (zooms.length) {
    // crop w/h as expression of zoom factor z(t); keep centered.
    vf += `,crop=w='iw/${zoomExpr}':h='ih/${zoomExpr}':x='(iw-iw/${zoomExpr})/2':y='(ih-ih/${zoomExpr})/2',scale=${W}:${H}`;
  }
  vf += "[base]";

  const parts = [vf];
  let cur = "base";
  brollIdx.forEach(([editIndex], n) => {
    const inIdx = n + 1;
    const e = edits[editIndex];
    const s = Math.max(0, e.start), dur = e.duration || 2;
    const bv = `br${n}`;
    parts.push(
      `[${inIdx}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,` +
      `trim=0:${dur.toFixed(2)},setpts=PTS-STARTPTS[${bv}]`
    );
    const out = `v${n}`;
    parts.push(
      `[${cur}][${bv}]overlay=0:0:enable='between(t,${s.toFixed(2)},${(s + dur).toFixed(2)})'[${out}]`
    );
    cur = out;
  });

  // Burn captions last so they sit on top of b-roll.
  if (assPath) {
    const sub = fontsdir
      ? `subtitles='${assPath.replace(/'/g, "\\'")}':fontsdir='${fontsdir}'`
      : `subtitles='${assPath.replace(/'/g, "\\'")}'`;
    parts.push(`[${cur}]${sub}[vout]`);
    cur = "vout";
  }

  args.push(
    "-filter_complex", parts.join(";"),
    "-map", `[${cur}]`, "-map", "0:a?",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
    "-pix_fmt", "yuv420p", "-r", "30",
    "-c:a", "aac", "-b:a", "128k",
    "-t", String(Math.max(1, Math.min(90, duration || 90))),
    "-movflags", "+faststart",
    output
  );
  await runFfmpeg(args, "render reel");
}
