// Browser-side Reel renderer — runs fully on the viewer's device (₹0 server cost).
// MediaPipe segments the speaker out of each frame so B-roll sits BEHIND them;
// WebCodecs + mp4-muxer produce a silent mp4 the server muxes with the audio.

const W = 720, H = 1280, FPS = 30;
const MP_VERSION = "0.10.14";
const MUXER_VERSION = "5.2.0";

let _seg = null;
async function getSegmenter() {
  if (_seg) return _seg;
  const vision = await import(
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs`
  );
  const fileset = await vision.FilesetResolver.forVisionTasks(
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`
  );
  _seg = await vision.ImageSegmenter.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    outputConfidenceMasks: true,
  });
  return _seg;
}

// cover-fit draw of any drawable (video/img/canvas) into the output frame
function drawCover(ctx, src, sw, sh) {
  const s = Math.max(W / sw, H / sh);
  const dw = sw * s, dh = sh * s;
  ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

// Extract the person from a video frame onto personCanvas (RGBA).
function cutoutPerson(video, seg, vw, vh, personCanvas, maskCanvas, tMs) {
  const res = seg.segmentForVideo(video, tMs);
  // Selfie segmenter: last confidence mask = person class (index 0 = background).
  const masks = res.confidenceMasks || [];
  const mask = masks[masks.length - 1];
  if (!mask) { res.close?.(); return false; }
  const mw = mask.width, mh = mask.height;
  if (maskCanvas.width !== mw) { maskCanvas.width = mw; maskCanvas.height = mh; }
  const conf = mask.getAsFloat32Array();
  const mctx = maskCanvas.getContext("2d");
  const img = mctx.createImageData(mw, mh);
  for (let i = 0; i < conf.length; i++) {
    const a = Math.max(0, Math.min(255, Math.round(conf[i] * 255)));
    img.data[i * 4 + 3] = a;
  }
  mctx.putImageData(img, 0, 0);
  res.close?.();

  const pctx = personCanvas.getContext("2d");
  pctx.clearRect(0, 0, W, H);
  pctx.save();
  // cover-crop the source frame the same way drawCover does
  const s = Math.max(W / vw, H / vh);
  pctx.drawImage(video, (W - vw * s) / 2, (H - vh * s) / 2, vw * s, vh * s);
  pctx.globalCompositeOperation = "destination-in";
  pctx.drawImage(maskCanvas, 0, 0, W, H);
  pctx.restore();
  return true;
}

function drawTextCard(ctx, text) {
  const words = String(text).toUpperCase().split(/\s+/);
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = "800 58px Inter, Arial, sans-serif";
  ctx.lineJoin = "round";
  // wrap into max 2 lines
  const lines = [[]];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    const test = [...cur, w].join(" ");
    if (ctx.measureText(test).width > W - 80 && cur.length) lines.push([w]);
    else cur.push(w);
  }
  const strs = lines.map((l) => l.join(" "));
  const y0 = 170 - (strs.length - 1) * 34;
  strs.forEach((t, i) => {
    const y = y0 + i * 68;
    ctx.lineWidth = 12;
    ctx.strokeStyle = "#000";
    ctx.strokeText(t, W / 2, y);
    ctx.fillStyle = "#FFE600";
    ctx.fillText(t, W / 2, y);
  });
  ctx.restore();
}

const activeAt = (edits, type, t) =>
  edits.find((e) => e.type === type && t >= e.start && t <= e.start + (e.duration || 1));

// plan: {edits:[{type,start,duration,scale,mode,media,query,text,mediaUrl}], duration}
// Returns a silent mp4 Blob. onProgress(0..1, label) reports progress.
export async function renderClient({ file, plan, onProgress }) {
  if (typeof VideoEncoder === "undefined") {
    throw new Error("This browser can't encode video — use Chrome or Edge.");
  }
  const duration = Math.min(plan.duration || 90, 90);
  const edits = plan.edits || [];
  const say = (p, l) => onProgress?.(p, l);

  say(0, "Loading AI segmenter…");
  const seg = await getSegmenter();

  // Preload B-roll media
  say(0.02, "Loading visuals…");
  const mediaEls = new Map();
  await Promise.all(edits.map(async (e, i) => {
    if (e.type !== "broll" || !e.mediaUrl) return;
    const tryUrls = [e.mediaUrl, `/api/reel-media?url=${encodeURIComponent(e.mediaUrl)}`];
    for (const url of tryUrls) {
      try {
        if (e.media === "image") {
          const img = new Image();
          img.crossOrigin = "anonymous";
          await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = url; });
          mediaEls.set(i, img);
          return;
        }
        const v = document.createElement("video");
        v.crossOrigin = "anonymous";
        v.muted = true; v.loop = true; v.playsInline = true;
        v.preload = "auto"; v.src = url;
        await new Promise((ok, no) => { v.oncanplay = ok; v.onerror = no; });
        mediaEls.set(i, v);
        return;
      } catch { /* try proxy next */ }
    }
  }));

  // Source video
  const video = document.createElement("video");
  video.muted = true; video.playsInline = true;
  video.src = URL.createObjectURL(file);
  await new Promise((ok) => { video.onloadeddata = ok; });
  const vw = video.videoWidth, vh = video.videoHeight;

  // Canvas stack: output + person cutout + mask
  const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const ctx = canvas.getContext("2d");
  const personCanvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
  let maskCanvas = null;

  // Encoder
  const { Muxer, ArrayBufferTarget } = await import(
    `https://cdn.jsdelivr.net/npm/mp4-muxer@${MUXER_VERSION}/+esm`
  );
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec: "avc", width: W, height: H }, fastStart: "in-memory" });
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => console.error("encoder:", e),
  });
  // Probe codec support — the right avc string varies by browser/GPU.
  const codecs = ["avc1.4d002a", "avc1.42E01F", "avc1.640028"];
  let configured = false;
  for (const codec of codecs) {
    const cfg = { codec, width: W, height: H, bitrate: 6_000_000, framerate: FPS, avc: { format: "avc" } };
    try {
      const { supported } = await VideoEncoder.isConfigSupported(cfg);
      if (!supported) continue;
      encoder.configure(cfg);
      configured = true;
      break;
    } catch { /* try next */ }
  }
  if (!configured) throw new Error("No supported H.264 encoder found — try the latest Chrome.");

  say(0.05, "Rendering…");
  let lastT = -1;
  await new Promise((resolve, reject) => {
    let done = false;
    const finish = async () => {
      if (done) return;
      done = true;
      video.pause();
      resolve();
    };
    const onFrame = async (_now, meta) => {
      if (done) return;
      const t = video.currentTime;
      try {
        if (t >= duration) return finish();
        if (t !== lastT) {
          lastT = t;
          const zoom = activeAt(edits, "zoom", t);
          // find active broll
          let brollEl = null;
          for (let i = 0; i < edits.length; i++) {
            const e = edits[i];
            if (e.type === "broll" && mediaEls.has(i) && t >= e.start && t <= e.start + (e.duration || 2)) {
              brollEl = mediaEls.get(i);
              break;
            }
          }
          const scale = zoom ? zoom.scale || 1.25 : 1;
          ctx.save();
          if (scale > 1) {
            ctx.translate(W / 2, H / 2);
            ctx.scale(scale, scale);
            ctx.translate(-W / 2, -H / 2);
          }
          if (brollEl) {
            // B-roll fills the frame BEHIND the speaker
            const bw = brollEl.videoWidth || brollEl.width, bh = brollEl.videoHeight || brollEl.height;
            if (brollEl.tagName === "VIDEO" && brollEl.paused) brollEl.play().catch(() => {});
            drawCover(ctx, brollEl, bw, bh);
            // speaker cutout on top
            if (!maskCanvas) maskCanvas = document.createElement("canvas");
            const okCut = cutoutPerson(video, seg, vw, vh, personCanvas, maskCanvas, t * 1000);
            if (!okCut) drawCover(ctx, video, vw, vh); // fallback: show raw frame
            else ctx.drawImage(personCanvas, 0, 0);
          } else {
            drawCover(ctx, video, vw, vh);
          }
          ctx.restore();
          const card = activeAt(edits, "textcard", t);
          if (card?.text) drawTextCard(ctx, card.text);
          if (encoder.encodeQueueSize > 10) await new Promise((r) => setTimeout(r, 30));
          encoder.encode(
            new VideoFrame(canvas, { timestamp: Math.round(t * 1e6), duration: Math.round(1e6 / FPS) }),
            { keyFrame: Math.round(t * FPS) % (FPS * 2) === 0 }
          );
          say(0.05 + 0.85 * (t / duration), `Rendering… ${Math.round((t / duration) * 100)}%`);
        }
        video.requestVideoFrameCallback(onFrame);
      } catch (err) { reject(err); }
    };
    video.onended = finish;
    video.requestVideoFrameCallback(onFrame);
    video.play().catch(reject);
  });

  say(0.95, "Encoding…");
  await encoder.flush();
  muxer.finalize();
  encoder.close();
  say(1, "Done");
  return new Blob([target.buffer], { type: "video/mp4" });
}
