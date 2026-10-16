// Faceless Typography Reel — browser render engine.
// Draws kinetic typography (bold animated words, dynamic highlighting, varied
// sizes, scene transitions) onto a 1080x1920 canvas. The SAME draw function powers
// the live preview and the MP4 export, so what you see is what you get.
//
// Export: WebCodecs (H.264 video + AAC audio) + mp4-muxer -> real .mp4 (Chrome/Edge).
// Fallback: MediaRecorder real-time capture (webm/mp4) for other browsers.
// Everything is free + keyless; assets come from Pexels/Pixabay/Iconify/FreeToUse.

export const W = 1080, H = 1920, FPS = 30;
const MUXER_VERSION = "5.2.0";

const FONT_STACK = {
  anton: '"Anton", Impact, "Arial Black", sans-serif',
  bebas: '"Bebas Neue", Impact, "Arial Black", sans-serif',
  montserrat: '"Montserrat", "Arial Black", sans-serif',
  poppins: '"Poppins", "Segoe UI", sans-serif',
};
const fontFamily = (f) => FONT_STACK[f] || FONT_STACK.anton;
const WEIGHT = (f) => (f === "poppins" ? 800 : f === "montserrat" ? 900 : 400); // display fonts have one weight

// ---- fonts: make sure canvas can use them before drawing ----
let _fontsReady = null;
export function ensureFonts() {
  if (_fontsReady) return _fontsReady;
  const specs = ['700 100px "Anton"', '700 100px "Bebas Neue"', '900 100px "Montserrat"', '800 100px "Poppins"'];
  _fontsReady = Promise.all(
    specs.map((s) => (document.fonts?.load ? document.fonts.load(s).catch(() => {}) : Promise.resolve()))
  ).then(() => document.fonts?.ready).catch(() => {});
  return _fontsReady;
}

// ---- easing ----
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const easeOutBack = (x) => { const c = 1.70158, c3 = c + 1; return 1 + c3 * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };

// ---- timeline helpers ----
export function sceneTimes(plan) {
  let t = 0;
  const out = (plan.scenes || []).map((s) => {
    const start = t; const dur = Math.max(1.2, s.durationSeconds || 3); t += dur;
    return { start, dur, end: t };
  });
  return { times: out, total: t };
}

// ---- layout: fit words into lines, size-to-fit, emphasis = bigger ----
const layoutCache = new WeakMap();
function computeLayout(ctx, scene, theme) {
  const cached = layoutCache.get(scene);
  if (cached && cached.text === scene.text && cached.font === theme.font) return cached;

  const fam = fontFamily(theme.font), wt = WEIGHT(theme.font);
  const emph = new Set((scene.emphasisWords || []).join(" ").toLowerCase().split(/\s+/).filter(Boolean));
  const rawWords = String(scene.text || "").trim().split(/\s+/).filter(Boolean);
  const words = rawWords.map((w) => ({ text: w, emphasis: emph.has(w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")) }));
  const maxW = W * 0.84, maxH = H * 0.56;

  let size = 190, lines = [];
  for (; size >= 54; size -= 6) {
    ctx.font = `${wt} ${size}px ${fam}`;
    const space = ctx.measureText(" ").width;
    lines = [];
    let cur = { words: [], width: 0 };
    for (const wd of words) {
      ctx.font = `${wt} ${Math.round(size * (wd.emphasis ? 1.16 : 1))}px ${fam}`;
      const wWidth = ctx.measureText(wd.text).width;
      const add = (cur.words.length ? space : 0) + wWidth;
      if (cur.words.length && cur.width + add > maxW) { lines.push(cur); cur = { words: [], width: 0 }; }
      cur.words.push({ ...wd, w: wWidth });
      cur.width += add;
    }
    if (cur.words.length) lines.push(cur);
    const lineH = size * 1.12;
    if (lines.length * lineH <= maxH && lines.every((l) => l.width <= maxW)) break;
  }
  const lineH = size * 1.12;
  const res = { text: scene.text, font: theme.font, fam, wt, size, lineH, lines, space: 0 };
  // flatten tokens for staggered animations (word index + per-line geometry)
  let idx = 0;
  res.tokens = [];
  lines.forEach((l, li) => l.words.forEach((wd) => { res.tokens.push({ ...wd, line: li }); idx++; }));
  res.wordCount = idx;
  layoutCache.set(scene, res);
  return res;
}

// ---- background ----
function drawCover(ctx, src, sw, sh, scale = 1, panX = 0, panY = 0) {
  const s = Math.max(W / sw, H / sh) * scale;
  const dw = sw * s, dh = sh * s;
  ctx.drawImage(src, (W - dw) / 2 + panX, (H - dh) / 2 + panY, dw, dh);
}

function hexToRgb(h) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(h || "");
  if (!m) return [10, 10, 20];
  let s = m[1]; if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  const n = parseInt(s, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const shade = (rgb, f) => rgb.map((c) => Math.max(0, Math.min(255, Math.round(c * f))));
const rgbStr = (a) => `rgb(${a[0]},${a[1]},${a[2]})`;

function drawBackground(ctx, scene, theme, p) {
  const bg = hexToRgb(theme.bg);
  const img = scene._bgImg;
  if (scene.bgStyle === "image" && img) {
    const kb = 1.06 + 0.1 * easeOut(p);            // ken-burns zoom
    const pan = 36 * Math.sin(p * Math.PI);         // gentle pan
    drawCover(ctx, img, img.naturalWidth || img.width, img.naturalHeight || img.height, kb, pan, -pan * 0.4);
    // dark scrim so the typography stays readable
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "rgba(0,0,0,0.45)");
    g.addColorStop(0.5, "rgba(0,0,0,0.30)");
    g.addColorStop(1, "rgba(0,0,0,0.6)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  } else if (scene.bgStyle === "gradient") {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, rgbStr(shade(bg, 1.35)));
    g.addColorStop(1, rgbStr(shade(bg, 0.7)));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = rgbStr(bg); ctx.fillRect(0, 0, W, H);
    // subtle vignette
    const r = ctx.createRadialGradient(W / 2, H * 0.42, H * 0.1, W / 2, H * 0.5, H * 0.7);
    r.addColorStop(0, "rgba(255,255,255,0.04)");
    r.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
  }
}

// ---- one word ----
function drawWord(ctx, t, x, y, size, fam, wt, color, alpha, extraScale = 1) {
  ctx.save();
  ctx.globalAlpha = clamp01(alpha);
  ctx.font = `${wt} ${Math.round(size)}px ${fam}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  if (extraScale !== 1) {
    ctx.translate(x + ctx.measureText(t).width / 2, y);
    ctx.scale(extraScale, extraScale);
    ctx.translate(-(x + ctx.measureText(t).width / 2), -y);
  }
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(6, size * 0.09);
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = size * 0.14;
  ctx.shadowOffsetY = size * 0.03;
  ctx.strokeText(t, x, y);
  ctx.shadowColor = "transparent";
  ctx.fillStyle = color;
  ctx.fillText(t, x, y);
  ctx.restore();
}

// ---- text (kinetic, by animation style) ----
function drawText(ctx, scene, theme, p, localT) {
  const L = computeLayout(ctx, scene, theme);
  const { lines, size, lineH, fam, wt } = L;
  const accent = theme.accent || "#ffd400";
  const base = theme.text || "#ffffff";
  const anim = scene.animation || "word-pop";
  const align = scene.layout === "left" ? "left" : "center";

  const blockH = lines.length * lineH;
  let y0 = (H - blockH) / 2 + size; // baseline of first line
  if (scene.layout === "stacked") y0 = H * 0.30 + size;

  // precompute word widths at their render size
  const measure = (wd) => { ctx.font = `${wt} ${Math.round(size * (wd.emphasis ? 1.16 : 1))}px ${fam}`; return ctx.measureText(wd.text).width; };
  const space = (() => { ctx.font = `${wt} ${size}px ${fam}`; return ctx.measureText(" ").width; })();

  let wordGlobalIdx = 0;
  const totalWords = L.wordCount || 1;

  lines.forEach((line, li) => {
    const widths = line.words.map(measure);
    const lineW = widths.reduce((a, b) => a + b, 0) + space * (line.words.length - 1);
    let x = align === "left" ? W * 0.09 : (W - lineW) / 2;
    const yLine = y0 + li * lineH;

    line.words.forEach((wd, wi) => {
      const wsize = size * (wd.emphasis ? 1.16 : 1);
      let color = wd.emphasis ? accent : base;
      let alpha = 1, scale = 1, dx = 0, dy = 0;

      if (anim === "word-pop") {
        const per = 0.6 / totalWords;                // reveal across first 60%
        const start = wordGlobalIdx * per;
        const k = clamp01((localT - start) / 0.26);
        alpha = k; scale = 0.5 + easeOutBack(k) * 0.5;
      } else if (anim === "slide-up") {
        const start = li * 0.12;
        const k = clamp01((localT - start) / 0.4);
        alpha = k; dy = (1 - easeOut(k)) * 90;
      } else if (anim === "fade-stack") {
        const start = li * 0.18;
        alpha = clamp01((localT - start) / 0.5);
      } else if (anim === "scale-bounce") {
        const k = clamp01(localT / 0.55);
        alpha = clamp01(localT / 0.25); scale = 0.6 + easeOutBack(k) * 0.4;
      } else if (anim === "typewriter") {
        // handled per-character below; skip normal word draw
      } else if (anim === "karaoke") {
        const frac = wordGlobalIdx / totalWords;
        const played = clamp01((p - 0.05) / 0.8);
        const lit = played >= frac;
        color = lit ? accent : base;
        if (Math.abs(played - frac) < 1 / totalWords) scale = 1.12;
        alpha = 1;
      }

      if (anim === "typewriter") {
        // reveal characters progressively across 70% of the scene
        const totalChars = L.tokens.reduce((a, tk) => a + tk.text.length + 1, 0);
        const shown = Math.floor(clamp01(localT / (scene.durationSeconds * 0.7)) * totalChars);
        let before = 0;
        for (let k = 0; k < wordGlobalIdx; k++) before += L.tokens[k].text.length + 1;
        const reveal = Math.max(0, Math.min(wd.text.length, shown - before));
        if (reveal > 0) drawWord(ctx, wd.text.slice(0, reveal), x, yLine, wsize, fam, wt, color, 1, 1);
      } else {
        drawWord(ctx, wd.text, x, yLine + dy, wsize, fam, wt, color, alpha, scale);
      }

      x += widths[wi] + space;
      wordGlobalIdx++;
    });
  });
}

// ---- overlay graphic (transparent sticker/icon/badge) ----
function drawOverlay(ctx, scene, p) {
  const img = scene._ovlImg;
  if (!img) return;
  const k = clamp01(p / 0.25);
  const a = clamp01(p / 0.2) * clamp01((1 - p) / 0.15 + 0.5);
  const size = 190 * (0.6 + easeOutBack(k) * 0.4);
  const pos = (scene.overlay?.placement || "top-right");
  let x = W - size - 70, y = 230;
  if (pos.includes("left")) x = 70;
  if (pos.includes("bottom")) y = H - size - 360;
  if (pos.includes("center")) { x = (W - size) / 2; y = H * 0.2; }
  ctx.save(); ctx.globalAlpha = a;
  ctx.drawImage(img, x, y, size, size);
  ctx.restore();
}

// ---- captions (optional small subtitle bar) ----
function drawCaption(ctx, scene) {
  const text = String(scene.text || "").toUpperCase();
  ctx.save();
  ctx.font = '700 40px "Montserrat", sans-serif';
  ctx.textAlign = "center";
  const y = H - 230;
  const w = Math.min(W - 80, ctx.measureText(text).width + 56);
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  const rx = (W - w) / 2;
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(rx, y - 52, w, 76, 16); ctx.fill(); }
  else ctx.fillRect(rx, y - 52, w, 76);
  ctx.fillStyle = "#fff"; ctx.textBaseline = "middle";
  ctx.fillText(text, W / 2, y - 12);
  ctx.restore();
}

// ---- progress ticks (subtle top segments like story reels) ----
function drawProgress(ctx, plan, times, idx, localT, dur) {
  const n = plan.scenes.length; if (!n) return;
  const gap = 10, pad = 36, top = 36;
  const seg = (W - pad * 2 - gap * (n - 1)) / n;
  for (let i = 0; i < n; i++) {
    const x = pad + i * (seg + gap);
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(x, top, seg, 7);
    const fill = i < idx ? 1 : i === idx ? clamp01(localT / dur) : 0;
    if (fill > 0) { ctx.fillStyle = "rgba(255,255,255,0.95)"; ctx.fillRect(x, top, seg * fill, 7); }
  }
}

// ---- master frame draw (preview + export share this) ----
// `assets` is accepted for call-site compatibility but images now live on the
// scene objects themselves (scene._bgImg / scene._ovlImg), so cloning a scene in
// the editor keeps its loaded visuals.
export function drawReelFrame(ctx, plan, assets, t, opts = {}) {
  const { times, total } = opts._tl || sceneTimes(plan);
  let idx = times.findIndex((s) => t < s.end);
  if (idx === -1) idx = times.length - 1;
  const scene = plan.scenes[idx];
  const st = times[idx];
  const localT = Math.max(0, t - st.start);
  const p = clamp01(localT / st.dur);

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);

  // scene entrance transition (applies to the whole scene for its first 0.4s)
  const trans = scene.transition || "fade";
  const te = clamp01(localT / 0.42);
  ctx.save();
  if (trans === "fade") ctx.globalAlpha = te;
  else if (trans === "zoom") { const s = 1.12 - 0.12 * easeOut(te); ctx.globalAlpha = Math.min(1, te + 0.2); ctx.translate(W / 2, H / 2); ctx.scale(s, s); ctx.translate(-W / 2, -H / 2); }
  else if (trans === "slide") { ctx.translate((1 - easeOut(te)) * W, 0); }

  drawBackground(ctx, scene, plan.theme, p);
  drawText(ctx, scene, plan.theme, p, localT);
  drawOverlay(ctx, scene, p);
  ctx.restore();

  if (opts.captions) drawCaption(ctx, scene);
  if (opts.progress !== false) drawProgress(ctx, plan, times, idx, localT, st.dur);
  return { idx, total };
}

// ---- asset preloading ----
const PROXY = (url) => `/api/asset-proxy?url=${encodeURIComponent(url)}`;
function loadImage(url) {
  return new Promise((ok, no) => {
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => ok(img); img.onerror = no; img.src = url;
  });
}
async function loadImageSafe(url) {
  // Pexels is CORS-clean; route everything else through our proxy so the canvas
  // stays untainted (required for export).
  const direct = /^https:\/\/(images|videos)\.pexels\.com\//.test(url);
  try { return await loadImage(direct ? url : PROXY(url)); }
  catch { try { return await loadImage(PROXY(url)); } catch { return null; } }
}

// Loads each scene's background image + overlay graphic and attaches them to the
// scene object (scene._bgImg / scene._ovlImg). Idempotent and safe to re-run.
export async function preloadAssets(plan) {
  await Promise.all((plan.scenes || []).map(async (s) => {
    if (s.bgStyle === "image" && s.visual?.url) {
      if (!s._bgImg || s._bgImgUrl !== s.visual.url) { const im = await loadImageSafe(s.visual.url); if (im) { s._bgImg = im; s._bgImgUrl = s.visual.url; } }
    } else { s._bgImg = null; }
    if (s.overlay?.url) {
      if (!s._ovlImg || s._ovlImgUrl !== s.overlay.url) { const ov = await loadImageSafe(s.overlay.url); if (ov) { s._ovlImg = ov; s._ovlImgUrl = s.overlay.url; } }
    }
  }));
  return plan;
}

// ---- audio ----
export async function loadAudioBuffer(actx, url) {
  if (!url) return null;
  const direct = /^blob:/.test(url);
  const res = await fetch(direct ? url : PROXY(url));
  if (!res.ok) throw new Error("audio fetch failed");
  const buf = await res.arrayBuffer();
  return await actx.decodeAudioData(buf);
}

// Mix BGM (looped+trimmed) and optional voiceover into one stereo AudioBuffer.
async function mixAudio({ bgmBuffer, voiceBuffer, duration, bgmVol = 0.55, voiceVol = 1 }) {
  const sr = 44100;
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const octx = new Offline(2, Math.ceil(duration * sr), sr);
  if (bgmBuffer) {
    const src = octx.createBufferSource(); src.buffer = bgmBuffer; src.loop = true;
    const g = octx.createGain(); g.gain.value = bgmVol;
    // gentle fade out at the end
    g.gain.setValueAtTime(bgmVol, Math.max(0, duration - 1.2));
    g.gain.linearRampToValueAtTime(0.0001, duration);
    src.connect(g).connect(octx.destination); src.start(0);
  }
  if (voiceBuffer) {
    const src = octx.createBufferSource(); src.buffer = voiceBuffer;
    const g = octx.createGain(); g.gain.value = voiceVol;
    src.connect(g).connect(octx.destination); src.start(0);
  }
  return await octx.startRendering();
}

function audioBufferToInterleaved(buf) {
  const ch = buf.numberOfChannels, len = buf.length;
  const out = new Float32Array(len * ch);
  const data = [];
  for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) out[i * ch + c] = data[c][i];
  return out;
}

// ---- EXPORT ----
// Returns { blob, ext, mime }. Prefers real MP4 via WebCodecs; falls back to
// MediaRecorder (webm) when WebCodecs video/audio isn't available.
export async function exportReel({ plan, assets, bgmBuffer, voiceBuffer, controls = {}, onProgress }) {
  await ensureFonts();
  const { total } = sceneTimes(plan);
  const duration = Math.min(total, 90);
  const say = (p, l) => onProgress?.(p, l);
  const tl = sceneTimes(plan);

  const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const ctx = canvas.getContext("2d", { alpha: false });

  const wantBgm = controls.bgmOn !== false && bgmBuffer;
  const wantVoice = controls.voiceOn && voiceBuffer;
  let mixed = null;
  if (wantBgm || wantVoice) {
    try {
      mixed = await mixAudio({
        bgmBuffer: wantBgm ? bgmBuffer : null,
        voiceBuffer: wantVoice ? voiceBuffer : null,
        duration,
        bgmVol: (controls.bgmVol ?? 55) / 100,
        voiceVol: (controls.voiceVol ?? 100) / 100,
      });
    } catch (e) { console.warn("audio mix failed:", e.message); }
  }

  const canWebCodecsVideo = typeof VideoEncoder !== "undefined";
  const canWebCodecsAudio = typeof AudioEncoder !== "undefined" && typeof AudioData !== "undefined";

  if (canWebCodecsVideo) {
    return await exportWebCodecs({ canvas, ctx, plan, assets, duration, tl, mixed, canWebCodecsAudio, drawOpts: { captions: !!controls.captions, _tl: tl }, say });
  }
  return await exportMediaRecorder({ canvas, ctx, plan, assets, duration, tl, mixed, drawOpts: { captions: !!controls.captions, _tl: tl }, say });
}

async function exportWebCodecs({ canvas, ctx, plan, assets, duration, tl, mixed, canWebCodecsAudio, drawOpts, say }) {
  say(0.02, "Preparing encoder…");
  const { Muxer, ArrayBufferTarget } = await import(`https://cdn.jsdelivr.net/npm/mp4-muxer@${MUXER_VERSION}/+esm`);
  const useAudio = mixed && canWebCodecsAudio;
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width: W, height: H },
    ...(useAudio ? { audio: { codec: "aac", numberOfChannels: mixed.numberOfChannels, sampleRate: mixed.sampleRate } } : {}),
    fastStart: "in-memory",
  });

  const encoder = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => console.error("vid enc", e) });
  let configured = false;
  for (const codec of ["avc1.640028", "avc1.4d002a", "avc1.42E01F"]) {
    const cfg = { codec, width: W, height: H, bitrate: 9_000_000, framerate: FPS };
    try { const { supported } = await VideoEncoder.isConfigSupported(cfg); if (!supported) continue; encoder.configure(cfg); configured = true; break; } catch {}
  }
  if (!configured) throw new Error("No supported H.264 encoder found — try the latest Chrome/Edge.");

  const frames = Math.round(duration * FPS);
  for (let f = 0; f < frames; f++) {
    const t = f / FPS;
    drawReelFrame(ctx, plan, assets, t, drawOpts);
    const vf = new VideoFrame(canvas, { timestamp: Math.round(t * 1e6), duration: Math.round(1e6 / FPS) });
    encoder.encode(vf, { keyFrame: f % (FPS * 2) === 0 });
    vf.close();
    if (encoder.encodeQueueSize > 12) await new Promise((r) => setTimeout(r, 8));
    if (f % 6 === 0) say(0.05 + 0.75 * (f / frames), `Rendering… ${Math.round((f / frames) * 100)}%`);
  }
  await encoder.flush(); encoder.close();

  if (useAudio) {
    say(0.84, "Encoding audio…");
    await encodeAudioTrack(muxer, mixed);
  }
  say(0.96, "Finalizing MP4…");
  muxer.finalize();
  say(1, "Done");
  return { blob: new Blob([target.buffer], { type: "video/mp4" }), ext: "mp4", mime: "video/mp4" };
}

async function encodeAudioTrack(muxer, mixed) {
  const sampleRate = mixed.sampleRate, channels = mixed.numberOfChannels;
  const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => console.error("aud enc", e) });
  aenc.configure({ codec: "mp4a.40.2", sampleRate, numberOfChannels: channels, bitrate: 160_000 });
  const interleaved = audioBufferToInterleaved(mixed);
  const frameSize = 1024, total = mixed.length;
  let offset = 0;
  while (offset < total) {
    const count = Math.min(frameSize, total - offset);
    const slice = interleaved.subarray(offset * channels, (offset + count) * channels);
    const data = new AudioData({
      format: "f32", sampleRate, numberOfFrames: count, numberOfChannels: channels,
      timestamp: Math.round((offset / sampleRate) * 1e6), data: slice,
    });
    aenc.encode(data); data.close();
    offset += count;
    if (aenc.encodeQueueSize > 24) await new Promise((r) => setTimeout(r, 4));
  }
  await aenc.flush(); aenc.close();
}

// Real-time fallback: play audio + animate canvas, capture with MediaRecorder.
async function exportMediaRecorder({ canvas, ctx, plan, assets, duration, tl, mixed, drawOpts, say }) {
  say(0.03, "Recording (real-time)…");
  const stream = canvas.captureStream(FPS);
  let actx, srcNode;
  if (mixed) {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    const dest = actx.createMediaStreamDestination();
    srcNode = actx.createBufferSource(); srcNode.buffer = mixed; srcNode.connect(dest);
    dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
  }
  const mime = ["video/mp4;codecs=avc1", "video/webm;codecs=vp9,opus", "video/webm"].find((m) => MediaRecorder.isTypeSupported?.(m)) || "video/webm";
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 9_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((r) => (rec.onstop = r));
  rec.start();
  if (srcNode) { await actx.resume?.(); srcNode.start(); }

  const t0 = performance.now();
  await new Promise((resolve) => {
    const loop = () => {
      const t = (performance.now() - t0) / 1000;
      if (t >= duration) return resolve();
      drawReelFrame(ctx, plan, assets, Math.min(t, duration - 0.001), drawOpts);
      say(0.05 + 0.9 * (t / duration), `Recording… ${Math.round((t / duration) * 100)}%`);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  rec.stop(); await done;
  try { srcNode?.stop(); actx?.close(); } catch {}
  const ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
  say(1, "Done");
  return { blob: new Blob(chunks, { type: mime }), ext, mime };
}
