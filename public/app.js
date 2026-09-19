const $ = (s, r = document) => r.querySelector(s);

const state = { view: "trends", trends: null, viral: null, plan: null, carousels: null, filter: "ALL" };

// Saved list is synced to the server (Upstash) and cached locally for offline/instant use.
let savedCache = [];
let requiresPass = false;
let hasImages = true;
let passcode = localStorage.getItem("reelstudio_pass") || "";

/* ---------- helpers ---------- */
function esc(s = "") {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function rankClass(r = "") {
  const x = r.toUpperCase();
  if (x.includes("POST")) return "post";
  if (x.includes("WATCH")) return "watch";
  return "ignore";
}
function successClass(l = "") {
  const x = l.toUpperCase();
  if (x.includes("PROVEN")) return "post";
  if (x.includes("STRONG")) return "watch";
  return "ignore";
}
function hide(sel) { $(sel).classList.add("hidden"); }
function show(sel) { $(sel).classList.remove("hidden"); }

/* ---------- saved (synced via server, cached locally) ---------- */
const LOCAL_KEY = "reelstudio_saved";
const passHeaders = () => (passcode ? { "x-app-passcode": passcode } : {});

function cacheLocally() { localStorage.setItem(LOCAL_KEY, JSON.stringify(savedCache)); }
function loadLocalCache() { try { savedCache = JSON.parse(localStorage.getItem(LOCAL_KEY)) || []; } catch { savedCache = []; } }
function updateSavedBadge() { $("#savedCount").textContent = savedCache.length; }
function isSaved(id) { return savedCache.some((x) => x.id === id); }

async function refreshSaved() {
  if (requiresPass && !passcode) { updateSavedBadge(); return; }
  try {
    const res = await fetch("/api/saved", { headers: passHeaders() });
    if (res.status === 401) { passcode = ""; localStorage.removeItem("reelstudio_pass"); updateSavedBadge(); return; }
    const d = await res.json();
    savedCache = d.items || [];
    cacheLocally();
    updateSavedBadge();
    if (state.view === "saved") renderSaved();
  } catch {
    // offline: keep local cache
    updateSavedBadge();
  }
}

async function ensureAuth() {
  if (!requiresPass || passcode) return true;
  const p = prompt("Enter your passcode to sync saved ideas across devices:");
  if (!p) return false;
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode: p }),
    });
    if (res.ok) {
      passcode = p;
      localStorage.setItem("reelstudio_pass", p);
      await refreshSaved();
      await refreshEdits();
      return true;
    }
    alert("Wrong passcode.");
  } catch {
    alert("Could not reach the server.");
  }
  return false;
}

async function persistSaved() {
  cacheLocally();
  updateSavedBadge();
  try {
    await fetch("/api/saved", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...passHeaders() },
      body: JSON.stringify({ items: savedCache }),
    });
  } catch { /* stays in local cache; will sync on next change */ }
}

async function toggleSave(item) {
  if (!(await ensureAuth())) return;
  const i = savedCache.findIndex((x) => x.id === item.id);
  if (i >= 0) savedCache.splice(i, 1);
  else savedCache.unshift({ ...item, savedAt: Date.now() });
  await persistSaved();
}

function wireSave(btn, item) {
  const set = () => {
    const s = isSaved(item.id);
    btn.textContent = s ? "★" : "☆";
    btn.classList.toggle("saved", s);
  };
  set();
  btn.addEventListener("click", async () => {
    await toggleSave(item);
    set();
    if (state.view === "saved") renderSaved();
  });
}

/* ---------- clipboard ---------- */
async function copyText(e, text) {
  const btn = e.currentTarget;
  try {
    await navigator.clipboard.writeText(text);
    const o = btn.textContent;
    btn.textContent = "✓ Copied";
    setTimeout(() => (btn.textContent = o), 1500);
  } catch {
    btn.textContent = "Copy failed";
  }
}

/* ---------- shared script rendering ---------- */
function scriptToText(sc = {}, title = "Reel", label = "") {
  const L = [];
  L.push(`${label ? label + " — " : ""}${title} (${sc.durationSeconds || "~30"}s)`);
  L.push("");
  if (sc.note) L.push(`(${sc.note})`);
  if (sc.hook) L.push(`HOOK (spoken): ${sc.hook}`);
  if (sc.onScreenHook) L.push(`HOOK (on-screen): ${sc.onScreenHook}`);
  L.push("");
  (sc.lines || []).forEach((ln, i) => {
    L.push(`${i + 1}. [${(ln.part || "").toUpperCase()}]`);
    if (ln.say) L.push(`   Bolo: ${ln.say}`);
    if (ln.text) L.push(`   Text: ${ln.text}`);
    if (ln.visual) L.push(`   Visual: ${ln.visual}`);
  });
  L.push("");
  if (sc.caption) L.push(`CAPTION: ${sc.caption}`);
  if (sc.hashtags && sc.hashtags.length) L.push(`HASHTAGS: ${sc.hashtags.join(" ")}`);
  return L.join("\n");
}

// If this card is already in the saved list, push the edited data back to it
// (and sync) so custom edits survive reloads and sync across devices.
function persistIfSaved(id, data) {
  const it = savedCache.find((x) => x.id === id);
  if (it) { it.data = data; persistSaved(); }
}

/* ---------- per-script edits (synced via server, cached locally) ----------
   Edits are keyed per script (e.g. "trend-1:script", "viral-2:imp"). They sync
   through /api/edits (passcode-gated like the saved list) so they follow you
   across devices; localStorage is the offline/instant cache. */
const EDITS_KEY = "reelstudio_edits";
let editsMap = {};

function loadEditsLocal() { try { editsMap = JSON.parse(localStorage.getItem(EDITS_KEY)) || {}; } catch { editsMap = {}; } }
function cacheEditsLocally() { localStorage.setItem(EDITS_KEY, JSON.stringify(editsMap)); }

async function refreshEdits() {
  if (requiresPass && !passcode) return;
  try {
    const res = await fetch("/api/edits", { headers: passHeaders() });
    if (res.status === 401) { passcode = ""; localStorage.removeItem("reelstudio_pass"); return; }
    const d = await res.json();
    editsMap = { ...editsMap, ...(d.items || {}) }; // server entries win
    cacheEditsLocally();
  } catch { /* offline: keep local cache */ }
}

async function persistEdits() {
  cacheEditsLocally();
  if (requiresPass && !passcode) return;
  try {
    await fetch("/api/edits", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...passHeaders() },
      body: JSON.stringify({ items: editsMap }),
    });
  } catch { /* stays in local cache; syncs on next change */ }
}

function applyStoredEdit(key, sc) {
  const e = editsMap[key];
  // only apply if this script doesn't already carry edits (e.g. from a saved item)
  if (e && !sc.edited && !sc.customText) Object.assign(sc, e);
}

function storeEdit(key, sc) {
  if (sc.edited || sc.customText) {
    editsMap[key] = {
      hook: sc.hook, onScreenHook: sc.onScreenHook, lines: sc.lines,
      caption: sc.caption, hashtags: sc.hashtags,
      customText: sc.customText, edited: sc.edited, _original: sc._original,
    };
  } else {
    delete editsMap[key];
  }
  persistEdits();
}

// Parse the plain-text script format back into structured fields so edits
// re-render inside the ORIGINAL layout (hook box, beats, caption).
function parseScriptText(text = "") {
  const out = { lines: [] };
  let cur = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    let m;
    if ((m = /^HOOK \(spoken\):\s*(.*)/i.exec(line))) out.hook = m[1];
    else if ((m = /^HOOK \(on-screen\):\s*(.*)/i.exec(line))) out.onScreenHook = m[1];
    else if ((m = /^\d+\.\s*\[([^\]]+)\]/.exec(line))) { cur = { part: m[1] }; out.lines.push(cur); }
    else if (cur && (m = /^Bolo:\s*(.*)/i.exec(line))) cur.say = m[1];
    else if (cur && (m = /^Text:\s*(.*)/i.exec(line))) cur.text = m[1];
    else if (cur && (m = /^Visual:\s*(.*)/i.exec(line))) cur.visual = m[1];
    else if ((m = /^CAPTION:\s*(.*)/i.exec(line))) out.caption = m[1];
    else if ((m = /^HASHTAGS:\s*(.*)/i.exec(line))) out.hashtags = m[1].split(/\s+/).filter(Boolean);
  }
  return out;
}

function buildScriptEl(sc = {}, opts = {}) {
  const { label = "📝 Script", title = "Reel", note = "", showVisual = true, variant = "", onEdit = null, editKey = null } = opts;
  if (editKey) applyStoredEdit(editKey, sc); // reapply your edits after a page refresh
  const el = document.createElement("div");
  el.className = "script" + (variant ? " " + variant : "");
  el.innerHTML = `
    <div class="script-head">
      <div class="script-label">${esc(label)} <span class="dur">${sc.durationSeconds ? "· " + sc.durationSeconds + "s" : ""}</span><span class="edited-tag hidden">✏️ edited</span></div>
      <div class="script-actions">
        <button class="copy-btn edit-btn" type="button">Edit</button>
        <button class="copy-btn" type="button">Copy</button>
      </div>
    </div>`;
  const head = el.querySelector(".script-head");
  const editedTag = el.querySelector(".edited-tag");
  const showEdited = () => editedTag.classList.toggle("hidden", !(sc.edited || sc.customText));

  // (Re)render the script body — same layout before and after edits.
  function renderBody() {
    [...el.children].filter((ch) => ch !== head).forEach((ch) => ch.remove());
    const frag = document.createElement("div");
    frag.innerHTML = `
      ${note ? `<p class="script-note">${esc(note)}</p>` : ""}
      <div class="script-hook">
        <span class="k">Hook</span>
        ${sc.hook ? `<p class="s-hook">🎤 ${esc(sc.hook)}</p>` : ""}
        ${sc.onScreenHook ? `<p class="s-onscreen">🅣 ${esc(sc.onScreenHook)}</p>` : ""}
      </div>
      <div class="beats"></div>
      <div class="script-caption">
        <span class="k">Caption</span>
        <p class="s-caption">${esc(sc.caption || "")}</p>
        <p class="s-hashtags">${esc((sc.hashtags || []).join("  "))}</p>
      </div>
      <pre class="script-custom ${sc.customText ? "" : "hidden"}">${esc(sc.customText || "")}</pre>`;
    const beats = frag.querySelector(".beats");
    (sc.lines || []).forEach((ln) => {
      const b = document.createElement("div");
      b.className = "beat";
      b.innerHTML = `
        <span class="beat-part ${(ln.part || "").split(" ")[0].toLowerCase()}">${esc(ln.part || "")}</span>
        <div class="beat-body">
          <p class="beat-say">${esc(ln.say || "")}</p>
          ${ln.text ? `<p class="beat-text">🅣 ${esc(ln.text)}</p>` : ""}
          ${showVisual && ln.visual ? `<p class="beat-visual">🎥 ${esc(ln.visual)}</p>` : ""}
        </div>`;
      beats.appendChild(b);
    });
    // freeform edits that don't match the script format show as-is instead
    if (sc.customText) frag.querySelectorAll(".script-hook,.beats,.script-caption,.script-note").forEach((n) => n.classList.add("hidden"));
    while (frag.firstChild) el.appendChild(frag.firstChild);
    showEdited();
  }
  renderBody();

  el.querySelector(".script-actions .copy-btn:last-child").addEventListener(
    "click", (e) => copyText(e, sc.customText || scriptToText(sc, title, label))
  );

  el.querySelector(".edit-btn").addEventListener("click", () => {
    const body = [...el.children].filter((ch) => ch !== head);
    body.forEach((ch) => ch.classList.add("hidden"));
    const wrap = document.createElement("div");
    wrap.className = "script-edit";
    wrap.innerHTML = `
      <textarea class="script-ta" rows="15"></textarea>
      <div class="edit-actions">
        <button class="copy-btn save-edit" type="button">✓ Save my version</button>
        <button class="copy-btn cancel-edit" type="button">Cancel</button>
        ${(sc.edited || sc.customText) ? '<button class="copy-btn reset-edit" type="button">↺ Reset to original</button>' : ""}
      </div>`;
    const ta = wrap.querySelector(".script-ta");
    ta.value = sc.customText || scriptToText(sc, title, label);
    el.appendChild(wrap);
    ta.focus();

    const done = () => { wrap.remove(); renderBody(); };
    wrap.querySelector(".save-edit").addEventListener("click", () => {
      const parsed = parseScriptText(ta.value);
      const structured = parsed.hook || parsed.onScreenHook || parsed.lines.length || parsed.caption;
      if (structured) {
        // edits stay inside the original hook/beats/caption layout
        if (!sc._original) sc._original = JSON.parse(JSON.stringify(sc));
        if (parsed.hook !== undefined) sc.hook = parsed.hook;
        if (parsed.onScreenHook !== undefined) sc.onScreenHook = parsed.onScreenHook;
        if (parsed.lines.length) sc.lines = parsed.lines;
        if (parsed.caption !== undefined) sc.caption = parsed.caption;
        if (parsed.hashtags) sc.hashtags = parsed.hashtags;
        delete sc.customText;
        sc.edited = true;
      } else {
        // totally freeform text — show it as-is
        if (!sc._original) sc._original = JSON.parse(JSON.stringify(sc));
        sc.customText = ta.value.trim();
        sc.edited = true;
      }
      if (editKey) storeEdit(editKey, sc);
      if (onEdit) onEdit();
      done();
    });
    wrap.querySelector(".cancel-edit").addEventListener("click", done);
    const reset = wrap.querySelector(".reset-edit");
    if (reset) reset.addEventListener("click", () => {
      if (sc._original) Object.assign(sc, sc._original);
      delete sc._original;
      delete sc.customText;
      delete sc.edited;
      if (editKey) storeEdit(editKey, sc);
      if (onEdit) onEdit();
      done();
    });
  });
  return el;
}

function fillSources(el, sources) {
  (sources || []).forEach((s) => {
    if (!s.url) return;
    const a = document.createElement("a");
    a.href = s.url; a.target = "_blank"; a.rel = "noopener";
    try { a.textContent = s.title || new URL(s.url).hostname; } catch { a.textContent = s.title || s.url; }
    el.appendChild(a);
  });
}

/* ---------- card builders ---------- */
function buildTrendCard(f) {
  const node = $("#cardTpl").content.cloneNode(true);
  const card = node.querySelector(".card");
  const rank = node.querySelector(".rank");
  rank.textContent = (f.ranking || "").toUpperCase();
  rank.classList.add(rankClass(f.ranking));
  node.querySelector(".category").textContent = f.category || "";
  const nov = node.querySelector(".novelty");
  nov.textContent = f.novelty === "genuinely-new" ? "NEW" : (f.novelty || "");
  if (f.novelty === "genuinely-new") nov.classList.add("new");
  node.querySelector(".fresh").textContent = f.freshnessHours != null ? `~${f.freshnessHours}h old` : "";
  node.querySelector(".card-title").textContent = f.title || "";
  node.querySelector(".whatChanged").textContent = f.whatChanged || "";
  node.querySelector(".whyCare").textContent = f.whyCare || "";
  node.querySelector(".timing").textContent = f.timing || "";
  node.querySelector(".howToAdapt").textContent = f.howToAdapt || "";
  const reel = f.reelConcept || {};
  node.querySelector(".hook").textContent = reel.hook ? `“${reel.hook}”` : "";
  node.querySelector(".visual-txt").textContent = reel.visual || "";
  node.querySelector(".cta-txt").textContent = reel.cta || "";
  const slot = node.querySelector(".script-slot");
  if (f.script && (f.script.hook || (f.script.lines && f.script.lines.length))) {
    slot.appendChild(buildScriptEl(f.script, { label: "📝 Hinglish script", title: f.title, editKey: `${f.id}:script`, onEdit: () => persistIfSaved(f.id, f) }));
  } else slot.remove();
  fillSources(node.querySelector(".sources"), f.sources);
  wireSave(node.querySelector(".save-btn"), { id: f.id, type: "trend", title: f.title, data: f });
  return card;
}

function buildViralCard(b) {
  const node = $("#viralTpl").content.cloneNode(true);
  const card = node.querySelector(".card");
  const lvl = node.querySelector(".rank");
  lvl.textContent = b.successLevel || "";
  lvl.classList.add(successClass(b.successLevel));
  node.querySelector(".format").textContent = b.format || "";
  node.querySelector(".card-title").textContent = b.title || "";
  node.querySelector(".whyItWorks").textContent = b.whyItWorks || "";
  node.querySelector(".successSignals").textContent = b.successSignals || "";
  node.querySelector(".exampleCreators").textContent = (b.exampleCreators || []).join(", ");
  node.querySelector(".whatsDiff-txt").textContent = (b.improvedScript && b.improvedScript.whatsDifferent) || "";
  const os = b.originalStyle || {};
  node.querySelector(".orig-slot").appendChild(
    buildScriptEl(os, { label: "🎪 Original-style (reference)", title: b.title, note: os.note, showVisual: false, variant: "original", editKey: `${b.id}:orig`, onEdit: () => persistIfSaved(b.id, b) })
  );
  node.querySelector(".improved-slot").appendChild(
    buildScriptEl(b.improvedScript || {}, { label: "✅ Your improved script", title: b.title, variant: "improved", editKey: `${b.id}:imp`, onEdit: () => persistIfSaved(b.id, b) })
  );
  fillSources(node.querySelector(".sources"), b.sources);
  wireSave(node.querySelector(".save-btn"), { id: b.id, type: "viral", title: b.title, data: b });
  return card;
}

function buildPlanCard(d) {
  const node = $("#planTpl").content.cloneNode(true);
  const card = node.querySelector(".card");
  node.querySelector(".day-badge").textContent = d.day || "";
  node.querySelector(".pillar").textContent = d.pillar || "";
  node.querySelector(".format").textContent = d.format || "";
  const goal = node.querySelector(".goal");
  goal.textContent = d.goal ? `🎯 ${d.goal}` : "";
  node.querySelector(".card-title").textContent = d.title || "";
  node.querySelector(".day-why").textContent = d.why || "";
  const slot = node.querySelector(".script-slot");
  if (d.script && (d.script.hook || (d.script.lines && d.script.lines.length))) {
    slot.appendChild(buildScriptEl(d.script, { label: "📝 Hinglish script", title: d.title, editKey: `${d.id}:script`, onEdit: () => persistIfSaved(d.id, d) }));
  } else slot.remove();
  wireSave(node.querySelector(".save-btn"), { id: d.id, type: "plan", title: `${d.day}: ${d.title}`, data: d });
  return card;
}

/* ---------- carousels: slide PNG rendering + export ---------- */
function wrapLines(ctx, text, maxW) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; }
    else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

/* slide images: generated server-side, cached by prompt. Client fetches lazily,
   max 4 at a time so the first view doesn't fire ~21 requests at once. */
const slideImgCache = new Map(); // prompt -> Promise<dataUrl|null>
const slideImgQueue = [];
let slideImgActive = 0;

function pumpSlideQueue() {
  while (slideImgActive < 4 && slideImgQueue.length) {
    const job = slideImgQueue.shift();
    slideImgActive++;
    job().finally(() => { slideImgActive--; pumpSlideQueue(); });
  }
}

function loadSlideImage(slide) {
  const q = (slide.imageQuery || "").trim();
  if (!q) return Promise.resolve(null);
  if (slide._img !== undefined) return Promise.resolve(slide._img);
  const mood = (slide.imageMood || "").trim();
  const cacheKey = `${q}|${mood}`;
  if (!slideImgCache.has(cacheKey)) {
    slideImgCache.set(cacheKey, new Promise((res) => {
      slideImgQueue.push(() =>
        fetch(`/api/slide-image?q=${encodeURIComponent(q)}&mood=${encodeURIComponent(mood)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            slide._img = d?.url || null;
            slide._credit = d?.photographer || null;
            res(slide._img);
          })
          .catch(() => { slide._img = null; res(null); })
      );
      pumpSlideQueue();
    }));
  }
  return slideImgCache.get(cacheKey);
}

function loadImageEl(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // pollinations sends ACAO:* — keeps canvas exportable
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

async function slideCanvas(slide, i, total) {
  const W = 1080, H = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const type = slide.type || "point";

  // full-bleed image (cover-crop to 4:5); dark fallback if it failed
  ctx.fillStyle = "#0b0d12";
  ctx.fillRect(0, 0, W, H);
  const dataUrl = await loadSlideImage(slide);
  if (dataUrl) {
    try {
      const img = await loadImageEl(dataUrl);
      // cover-crop the real photo to fill the 1080x1350 frame, centered
      const scale = Math.max(W / img.width, H / img.height);
      const dw = img.width * scale, dh = img.height * scale;
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } catch { /* keep dark bg */ }
  } else {
    // fallback: subtle branded gradient so the slide still looks designed
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    if (type === "cover") { bg.addColorStop(0, "#2a1f5e"); bg.addColorStop(1, "#0b0d12"); }
    else if (type === "cta") { bg.addColorStop(0, "#0f3d2e"); bg.addColorStop(1, "#0b0d12"); }
    else { bg.addColorStop(0, "#1c2130"); bg.addColorStop(1, "#0b0d12"); }
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
  }

  // bottom scrim so the minimal text stays readable on any image
  const scrim = ctx.createLinearGradient(0, H * 0.5, 0, H);
  scrim.addColorStop(0, "rgba(6,8,12,0)");
  scrim.addColorStop(1, "rgba(6,8,12,0.88)");
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, W, H);

  const pad = 90, maxW = W - pad * 2;
  const SAFE_BOTTOM = 100;   // nothing may render below H - SAFE_BOTTOM
  const SAFE_TOP = 140;      // keep clear of the counter pill zone
  const swipeSpace = type === "cover" ? 90 : 0;
  const textBottom = H - SAFE_BOTTOM - swipeSpace;
  const maxBlock = textBottom - SAFE_TOP;

  // Measure-then-place layout: wrap at the current size, shrink until the whole
  // text block fits inside the safe area — never let text overflow the canvas.
  let hSize = type === "cover" ? 96 : 76;
  let hLines, bLines, hStep, bStep, bSize, gap, blockH;
  const measure = () => {
    bSize = Math.max(30, Math.round(hSize * 0.55));
    hStep = hSize * 1.12;
    bStep = bSize * 1.35;
    gap = 30;
    ctx.font = `800 ${hSize}px Inter, system-ui, sans-serif`;
    hLines = wrapLines(ctx, slide.heading || "", maxW).slice(0, 4);
    ctx.font = `500 ${bSize}px Inter, system-ui, sans-serif`;
    bLines = slide.body ? wrapLines(ctx, slide.body, maxW).slice(0, 4) : [];
    blockH = hLines.length * hStep + (bLines.length ? gap + bLines.length * bStep : 0);
  };
  measure();
  while ((hLines.length >= 4 || blockH > maxBlock) && hSize > 34) {
    hSize -= 6;
    measure();
  }

  // Anchor the WHOLE block (heading + body) so the last line's DESCENDERS
  // stay above the safe edge — blockH already includes heading + gap + body.
  const descender = Math.round((bLines.length ? bSize : hSize) * 0.3);
  let y = textBottom - descender - blockH;
  ctx.font = `800 ${hSize}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = "#ffffff";
  hLines.forEach((l) => { y += hStep; ctx.fillText(l, pad, y); });
  if (bLines.length) {
    y += gap;
    ctx.font = `500 ${bSize}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = "#d7dcea";
    bLines.forEach((l) => { y += bStep; ctx.fillText(l, pad, y); });
  }

  // cover gets the swipe cue, pinned inside its own reserved space
  if (type === "cover") {
    ctx.font = "700 42px Inter, system-ui, sans-serif";
    ctx.fillStyle = "#22d3ee";
    ctx.textAlign = "right";
    ctx.fillText("Swipe →", W - pad, H - 40);
    ctx.textAlign = "left";
  }

  return canvas;
}

function canvasToBlob(canvas) {
  return new Promise((res) => canvas.toBlob(res, "image/png"));
}

function carouselCaptionText(c) {
  const tags = (c.hashtags || []).join(" ");
  return `${c.caption || ""}${tags ? "\n\n" + tags : ""}`.trim();
}

async function downloadSlide(c, i) {
  const slides = c.slides || [];
  const blob = await canvasToBlob(await slideCanvas(slides[i], i, slides.length));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${c.id || "carousel"}-slide-${i + 1}.png`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function downloadSlides(c) {
  const slides = c.slides || [];
  for (let i = 0; i < slides.length; i++) {
    await downloadSlide(c, i);
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function postToInstagram(c, btn) {
  const slides = c.slides || [];
  const text = carouselCaptionText(c);
  btn.disabled = true;
  const orig = btn.textContent;
  try {
    btn.textContent = "Preparing slides…";
    const files = [];
    for (let i = 0; i < slides.length; i++) {
      const blob = await canvasToBlob(await slideCanvas(slides[i], i, slides.length));
      files.push(new File([blob], `slide-${i + 1}.png`, { type: "image/png" }));
    }
    if (navigator.canShare && navigator.canShare({ files })) {
      await navigator.share({ files, text, title: c.title || "Carousel" });
      btn.textContent = orig;
    } else {
      // Desktop fallback: IG web has no auto-compose — download slides, copy caption, open IG.
      await downloadSlides(c);
      try { await navigator.clipboard.writeText(text); } catch {}
      window.open("https://www.instagram.com/", "_blank", "noopener");
      btn.textContent = "Slides saved + caption copied ✓";
      setTimeout(() => (btn.textContent = orig), 4000);
      alert(
        "Slides downloaded and caption copied!\n\nInstagram's website doesn't allow auto-creating posts, " +
        "so just: create a new post on Instagram, select the downloaded slide images in order, " +
        "paste the caption, and hit Share.\n\nTip: on your phone this button shares directly into the Instagram app."
      );
    }
  } catch (e) {
    btn.textContent = e && e.name === "AbortError" ? orig : "Share failed";
    setTimeout(() => (btn.textContent = orig), 2500);
  } finally {
    btn.disabled = false;
  }
}

function buildCarouselCard(c) {
  const node = $("#carouselTpl").content.cloneNode(true);
  const card = node.querySelector(".card");
  node.querySelector(".goal-badge").textContent = c.goal ? `🎯 ${c.goal}` : "";
  node.querySelector(".slide-count").textContent = `${(c.slides || []).length} slides`;
  node.querySelector(".card-title").textContent = c.title || "";
  node.querySelector(".carousel-topic").textContent = c.topic || "";
  const struct = node.querySelector(".carousel-structure");
  if (c.structure) struct.innerHTML = `<span class="k">🧩 Structure</span> ${esc(c.structure)}`;
  else struct.remove();
  const music = node.querySelector(".carousel-music");
  if (c.music) music.innerHTML = `<span class="k">🎵 Music</span> ${esc(c.music)}`;
  else music.remove();

  const strip = node.querySelector(".slide-strip");
  (c.slides || []).forEach((s, i) => {
    const t = document.createElement("div");
    t.className = "slide-thumb " + (s.type || "point");
    t.innerHTML = `
      <div class="st-imgwrap"><div class="st-shimmer"></div></div>
      <div class="st-scrim"></div>
      <span class="st-n">${i + 1}</span>
      <p class="st-h">${esc(s.heading || "")}</p>
      <button class="st-dl" type="button" title="Download this slide">⬇</button>`;
    t.querySelector(".st-dl").addEventListener("click", () => downloadSlide(c, i));
    strip.appendChild(t);
    loadSlideImage(s).then((url) => {
      const wrap = t.querySelector(".st-imgwrap");
      if (url) wrap.innerHTML = `<img src="${url}" alt="" loading="lazy" />`;
      else wrap.innerHTML = `<div class="st-fallback"></div>`;
    });
  });

  node.querySelector(".s-caption").textContent = c.caption || "";
  node.querySelector(".s-hashtags").textContent = (c.hashtags || []).join("  ");
  node.querySelector(".dl-btn").addEventListener("click", () => downloadSlides(c));
  node.querySelector(".ig-btn").addEventListener("click", (e) => postToInstagram(c, e.currentTarget));
  node.querySelector(".cap-btn").addEventListener("click", (e) => copyText(e, carouselCaptionText(c)));
  wireSave(node.querySelector(".save-btn"), { id: c.id, type: "carousel", title: c.title, data: c });
  return card;
}

/* ---------- top-3 ---------- */
function renderTop(container, picks, items, badgeKey) {
  const byId = Object.fromEntries((items || []).map((x) => [x.id, x]));
  container.innerHTML = (picks || []).map((t, i) => {
    const x = byId[t.id] || {};
    const badge = (x[badgeKey] || "").toUpperCase();
    return `<div class="top-card">
      <div class="top-rank">#${i + 1}${badge ? " · " + esc(badge) : ""}</div>
      <h4>${esc(x.title || t.id)}</h4>
      <p>${esc(t.why || x.whyCare || x.whyItWorks || "")}</p>
    </div>`;
  }).join("");
}

/* ---------- status / errors ---------- */
function loadingHtml(kind) {
  const msg = kind === "viral"
    ? "Finding proven viral formats + writing original vs. improved scripts…"
    : kind === "carousels"
    ? "Researching top carousel patterns + designing visual-first slides…"
    : "Scanning fresh Instagram trends & writing Hinglish scripts…";
  return `<div class="spinner"></div><p class="big">${msg}</p><p>This takes ~60-90s. Free Gemini + live sources.</p>`;
}
function errorHtml(data) {
  const setup = data.code === "NO_API_KEY"
    ? `<div class="setup"><p><strong>Add your FREE Gemini key:</strong></p>
       <pre>cd trend-radar
cp .env.example .env
# paste your key, then: npm start</pre>
       <p>Free key at <code>aistudio.google.com/apikey</code></p></div>`
    : "";
  return `<p class="big">⚠️ ${esc(data.error || "Something went wrong")}</p>${setup}`;
}

/* ---------- view renderers ---------- */
function liveNotice(data) {
  if (data.liveData === false) {
    return `<p class="notice">⚡ Live news/Reddit sources weren't reachable from the server, so these are AI-generated from recent knowledge (not last-24h verified). They're still useful — just double-check anything time-sensitive.</p>`;
  }
  return "";
}

function renderTrends(data) {
  $("#status").innerHTML = liveNotice(data) +
    (data.summary ? `<p class="summary">${esc(data.summary)}</p>` : "");
  renderTop($("#topCards"), data.topThree, data.findings, "ranking");
  show("#top");
  renderTrendCards();
  show("#feed");
  setMeta(data);
}
function renderTrendCards() {
  const data = state.trends;
  const cards = $("#cards");
  cards.innerHTML = "";
  const items = (data.findings || []).filter(
    (f) => state.filter === "ALL" || (f.ranking || "").toUpperCase().includes(state.filter.split(" ")[0])
  );
  if (!items.length) { cards.innerHTML = `<p class="subtle" style="text-align:center;padding:30px">Nothing here.</p>`; return; }
  items.forEach((f) => cards.appendChild(buildTrendCard(f)));
}

function renderViral(data) {
  $("#viralStatus").innerHTML = liveNotice(data) +
    (data.summary ? `<p class="summary">${esc(data.summary)}</p>` : "");
  renderTop($("#viralTopCards"), data.topThree, data.blueprints, "successLevel");
  show("#viralTop");
  const cards = $("#viralCards");
  cards.innerHTML = "";
  (data.blueprints || []).forEach((b) => cards.appendChild(buildViralCard(b)));
  show("#viralFeed");
  setMeta(data);
}

function renderPlan(data) {
  $("#planSummary").textContent = data.summary || "";
  const pillars = $("#planPillars");
  pillars.innerHTML = (data.pillars || []).map((p) => `<span class="pillar-chip">${esc(p)}</span>`).join("");
  show("#planHead");
  const days = $("#planDays");
  days.innerHTML = "";
  (data.days || []).forEach((d) => days.appendChild(buildPlanCard(d)));
  const tips = data.tips || [];
  if (tips.length) {
    $("#planTipsList").innerHTML = tips.map((t) => `<li>${esc(t)}</li>`).join("");
    show("#planTips");
  } else hide("#planTips");
  setMeta(data);
}

function renderCarousels(data) {
  const imgNotice = hasImages ? "" :
    `<p class="notice">🖼️ Slide photos need a free Pexels API key. Add <code>PEXELS_API_KEY</code> to your .env (get one at pexels.com/api) and refresh — until then slides use plain gradients.</p>`;
  $("#carouselStatus").innerHTML = imgNotice + liveNotice(data) +
    (data.summary ? `<p class="summary">${esc(data.summary)}</p>` : "");
  const cards = $("#carouselCards");
  cards.innerHTML = "";
  (data.carousels || []).forEach((c) => cards.appendChild(buildCarouselCard(c)));
  show("#carouselHead");
  setMeta(data);
}

function renderSaved() {
  const wrap = $("#savedCards");
  wrap.innerHTML = "";
  if (requiresPass && !passcode) {
    wrap.innerHTML = `<div class="status"><p class="big">🔒 Enter your passcode to view your synced saved ideas</p></div>`;
    const b = document.createElement("button");
    b.className = "btn"; b.textContent = "Unlock";
    b.style.margin = "0 auto"; b.style.display = "block";
    b.addEventListener("click", async () => { if (await ensureAuth()) renderSaved(); });
    wrap.querySelector(".status").appendChild(b);
    return;
  }
  if (!savedCache.length) {
    wrap.innerHTML = `<p class="subtle" style="text-align:center;padding:40px">No saved ideas yet. Tap ☆ on any card to save it here — it syncs across all your devices.</p>`;
    return;
  }
  savedCache.forEach((item) => {
    let card;
    if (item.type === "viral") card = buildViralCard(item.data);
    else if (item.type === "plan") card = buildPlanCard(item.data);
    else if (item.type === "carousel") card = buildCarouselCard(item.data);
    else card = buildTrendCard(item.data);
    wrap.appendChild(card);
  });
}

function setMeta(data) {
  const when = new Date(data.cachedAt || data.generatedAt || Date.now());
  $("#meta").textContent = (data.cached ? "cached · " : "fresh · ") + when.toLocaleString();
}

/* ---------- loaders ---------- */
async function loadTrends(force = false) {
  $("#status").innerHTML = loadingHtml("trends");
  hide("#top"); hide("#feed");
  try {
    const res = await fetch(`/api/trends${force ? "?force=1" : ""}`);
    const data = await res.json();
    if (!res.ok) { $("#status").innerHTML = errorHtml(data); return; }
    state.trends = data;
    renderTrends(data);
  } catch {
    $("#status").innerHTML = errorHtml({ error: "Could not reach the server. Is it running?" });
  }
}

async function loadViral(force = false) {
  $("#viralStatus").innerHTML = loadingHtml("viral");
  hide("#viralTop"); hide("#viralFeed");
  try {
    const res = await fetch(`/api/viral${force ? "?force=1" : ""}`);
    const data = await res.json();
    if (!res.ok) { $("#viralStatus").innerHTML = errorHtml(data); return; }
    state.viral = data;
    renderViral(data);
  } catch {
    $("#viralStatus").innerHTML = errorHtml({ error: "Could not reach the server. Is it running?" });
  }
}

async function loadPlan(force = false) {
  $("#planStatus").innerHTML = loadingHtml("plan");
  hide("#planHead"); hide("#planTips"); $("#planDays").innerHTML = "";
  try {
    const res = await fetch(`/api/plan${force ? "?force=1" : ""}`);
    const data = await res.json();
    if (!res.ok) { $("#planStatus").innerHTML = errorHtml(data); return; }
    state.plan = data;
    $("#planStatus").innerHTML = "";
    renderPlan(data);
  } catch {
    $("#planStatus").innerHTML = errorHtml({ error: "Could not reach the server. Is it running?" });
  }
}

async function loadCarousels(force = false) {
  $("#carouselStatus").innerHTML = loadingHtml("carousels");
  hide("#carouselHead");
  try {
    const res = await fetch(`/api/carousels${force ? "?force=1" : ""}`);
    const data = await res.json();
    if (!res.ok) { $("#carouselStatus").innerHTML = errorHtml(data); return; }
    state.carousels = data;
    renderCarousels(data);
  } catch {
    $("#carouselStatus").innerHTML = errorHtml({ error: "Could not reach the server. Is it running?" });
  }
}

/* ---------- router ---------- */
function switchView(view) {
  state.view = view;
  ["trends", "viral", "plan", "carousels", "saved"].forEach((v) => $(`#view-${v}`).classList.toggle("hidden", v !== view));
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $("#refresh").style.display = view === "saved" ? "none" : "";
  if (view === "trends" && !state.trends) loadTrends(false);
  if (view === "viral" && !state.viral) loadViral(false);
  if (view === "plan" && !state.plan) loadPlan(false);
  if (view === "carousels" && !state.carousels) loadCarousels(false);
  if (view === "saved") renderSaved();
  if (view !== "saved") $("#meta").textContent = "";
}

/* ---------- wiring ---------- */
document.querySelectorAll(".nav-btn").forEach((b) =>
  b.addEventListener("click", () => switchView(b.dataset.view))
);
$("#refresh").addEventListener("click", () => {
  if (state.view === "trends") loadTrends(true);
  else if (state.view === "viral") loadViral(true);
  else if (state.view === "plan") loadPlan(true);
  else if (state.view === "carousels") loadCarousels(true);
});
$("#filters").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
  chip.classList.add("active");
  state.filter = chip.dataset.filter;
  if (state.trends) renderTrendCards();
});

loadLocalCache();
loadEditsLocal();
updateSavedBadge();

fetch("/api/config")
  .then((r) => r.json())
  .then((d) => {
    $("#niche").textContent = d.niche || "";
    requiresPass = !!d.requiresPass;
    hasImages = d.images !== false;
    refreshSaved();
    refreshEdits();
  })
  .catch(() => {});

loadTrends(false);
