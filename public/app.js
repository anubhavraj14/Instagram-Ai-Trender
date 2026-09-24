const $ = (s, r = document) => r.querySelector(s);

const state = { view: "trends", trends: null, viral: null, plan: null, carousels: null, filter: "ALL" };

// Saved list is synced to the server (Upstash) and cached locally for offline/instant use.
let savedCache = [];
let requiresPass = false;
let hasImages = true;
let mediaConfigClient = { pexels: false, pixabay: false, music: false };
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

/* ---------- generation/analysis history (synced via /api/history) ----------
   Every result from the Content Generator, Script Kit, and Reel Analyzer is
   upserted here so it survives refresh and syncs across devices. The views
   show a compact list (title + type + date + delete); clicking opens the full
   saved content. */
const HISTORY_KEY = "reelstudio_history";
let historyCache = [];

function loadHistoryLocal() { try { historyCache = JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { historyCache = []; } }
function cacheHistoryLocally() { localStorage.setItem(HISTORY_KEY, JSON.stringify(historyCache)); }

async function refreshHistory() {
  if (requiresPass && !passcode) return;
  try {
    const res = await fetch("/api/history", { headers: passHeaders() });
    if (res.status === 401) return;
    const d = await res.json();
    historyCache = d.items || historyCache;
    cacheHistoryLocally();
  } catch { /* offline: keep local cache */ }
}

async function persistHistory() {
  cacheHistoryLocally();
  if (requiresPass && !passcode) return;
  try {
    await fetch("/api/history", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...passHeaders() },
      body: JSON.stringify({ items: historyCache }),
    });
  } catch { /* stays in local cache; syncs on next change */ }
}

// Insert or update a history entry. kind: "generated" | "scriptkit" | "analyzer".
function upsertHistory({ id, kind, type = "", title = "Untitled", data }) {
  const i = historyCache.findIndex((x) => x.id === id);
  if (i >= 0) {
    historyCache[i] = { ...historyCache[i], title, type, data, updatedAt: Date.now() };
  } else {
    historyCache.unshift({ id, kind, type, title, data, createdAt: Date.now(), updatedAt: Date.now() });
  }
  persistHistory();
  renderHistoryLists();
}

async function deleteHistory(id) {
  const it = historyCache.find((x) => x.id === id);
  if (!it) return;
  if (!confirm(`Delete "${it.title}" permanently? This can't be undone.`)) return;
  historyCache = historyCache.filter((x) => x.id !== id);
  await persistHistory();
  renderHistoryLists();
}

const HISTORY_KIND_LABEL = { generated: "✨ Generated", scriptkit: "🎒 Script Kit", analyzer: "🔍 Analyzed Reel" };

// Compact rows: type chip + clickable title + date + delete.
function renderHistoryList(el, kind) {
  const items = historyCache.filter((x) => x.kind === kind);
  if (!items.length) { el.innerHTML = ""; return; }
  el.innerHTML = `
    <details class="hist-card card">
      <summary class="hist-head">📚 History <span class="badge">${items.length}</span></summary>
      <div class="hist-list"></div>
    </details>`;
  const list = el.querySelector(".hist-list");
  items.forEach((it) => {
    const row = document.createElement("div");
    row.className = "hist-row";
    const when = new Date(it.updatedAt || it.createdAt || Date.now());
    row.innerHTML = `
      <span class="hist-type">${esc(it.type || HISTORY_KIND_LABEL[it.kind] || it.kind)}</span>
      <button class="hist-title" type="button">${esc(it.title)}</button>
      <span class="hist-date">${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      <button class="hist-del" type="button" title="Delete">🗑</button>`;
    row.querySelector(".hist-title").addEventListener("click", () => openHistoryItem(it));
    row.querySelector(".hist-del").addEventListener("click", () => deleteHistory(it.id));
    list.appendChild(row);
  });
}

function renderHistoryLists() {
  const g = $("#genHistory"); if (g) renderHistoryList(g, "generated");
  const s = $("#skHistory"); if (s) renderHistoryList(s, "scriptkit");
  const a = $("#anlzHistory"); if (a) renderHistoryList(a, "analyzer");
}

// Re-open a saved item in its feature's normal output area.
function openHistoryItem(it) {
  if (it.kind === "generated") {
    switchView("generator");
    renderGenerated(it.data);
  } else if (it.kind === "scriptkit") {
    switchView("scriptkit");
    renderScriptKit(it.data);
  } else if (it.kind === "analyzer") {
    switchView("analyzer");
    const d = it.data || {};
    renderAnalysis(d.result || {}, false, it.id);
    if (d.original) renderOriginal(d.original);
  }
}

// Tiny stable string hash for history ids.
function strHash(s = "") {
  let h = 7;
  for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
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
    else if (item.type === "generated") {
      item.data._saveId = item.id;
      buildGeneratedCards(item.data).forEach((c) => wrap.appendChild(c));
      return;
    }
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
  ["trends", "viral", "plan", "carousels", "generator", "scriptkit", "analyzer", "editor", "saved"].forEach((v) => $(`#view-${v}`).classList.toggle("hidden", v !== view));
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $("#refresh").style.display = (view === "saved" || view === "editor" || view === "scriptkit" || view === "generator" || view === "analyzer") ? "none" : "";
  if (view === "trends" && !state.trends) loadTrends(false);
  if (view === "viral" && !state.viral) loadViral(false);
  if (view === "plan" && !state.plan) loadPlan(false);
  if (view === "carousels" && !state.carousels) loadCarousels(false);
  if (view === "saved") renderSaved();
  if (view === "generator" || view === "scriptkit" || view === "analyzer") renderHistoryLists();
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
loadHistoryLocal();
updateSavedBadge();
renderHistoryLists();

fetch("/api/config")
  .then((r) => r.json())
  .then((d) => {
    $("#niche").textContent = d.niche || "";
    requiresPass = !!d.requiresPass;
    hasImages = d.images !== false;
    mediaConfigClient = { pexels: false, pixabay: false, music: false, ...(d.media || {}) };
    refreshSaved();
    refreshEdits();
    refreshHistory().then(renderHistoryLists);
  })
  .catch(() => {});

loadTrends(false);

/* ---------- Script Kit ---------- */
const scriptkitStatus = (html) => { $("#scriptkitStatus").innerHTML = html; };

$("#scriptkitBtn").addEventListener("click", async () => {
  const script = $("#scriptkitInput").value.trim();
  if (!script) { scriptkitStatus(errorHtml({ error: "Paste a script first." })); return; }
  scriptkitStatus(`<div class="loading"><div class="spinner"></div><p>Building your asset kit…</p></div>`);
  $("#scriptkitOutput").innerHTML = "";
  try {
    const res = await fetch("/api/script-kit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ script }),
    });
    const data = await res.json();
    if (!res.ok) { scriptkitStatus(errorHtml(data)); return; }
    scriptkitStatus("");
    renderScriptKit(data);
    upsertHistory({ id: `kit-${strHash(script)}`, kind: "scriptkit", title: data.title || "Script Kit", data });
  } catch {
    scriptkitStatus(errorHtml({ error: "Could not reach the server. Is it running?" }));
  }
});

// Shared HTML for a downloadable stock-media option (B-roll video/image).
function brollOptionHtml(opt, idx) {
  const isVideo = opt.type === "video";
  const preview = isVideo
    ? `<video class="sk-preview" src="${esc(opt.url)}" poster="${esc(opt.thumb || "")}" preload="metadata" controls playsinline></video>`
    : `<img class="sk-preview" src="${esc(opt.thumb || opt.url)}" alt="" loading="lazy" />`;
  return `
    <div class="sk-option">
      ${preview}
      <div class="sk-option-info">
        <span class="sk-option-tag">#${idx + 1} · ${esc(opt.type || "media")} · ${esc(opt.source || "")}</span>
        ${opt.credit ? `<span class="sk-option-credit">by ${esc(opt.credit)}</span>` : ""}
        ${opt.duration ? `<span class="sk-option-credit">${Math.round(opt.duration)}s</span>` : ""}
        ${opt.pageUrl ? `<a class="sk-option-credit" href="${esc(opt.pageUrl)}" target="_blank" rel="noopener">source</a>` : ""}
      </div>
      <a class="btn sk-option-dl" href="${esc(opt.url)}" target="_blank" rel="noopener">⬇ Use this</a>
    </div>
  `;
}

// Shared HTML for a downloadable music-track option.
function musicOptionHtml(opt, idx) {
  return `
    <div class="sk-option sk-music-option">
      <div class="sk-music-head">
        <strong>${esc(opt.title || "Untitled")}</strong>
        <span class="sk-badge">${esc(opt.genre || "music")}</span>
      </div>
      <audio class="sk-audio" src="${esc(opt.url)}" preload="metadata" controls></audio>
      <div class="sk-option-info">
        <span class="sk-option-credit">by ${esc(opt.artist || "Unknown")}</span>
        <span class="sk-option-credit">${opt.duration ? Math.round(opt.duration) + "s" : ""}</span>
        <span class="sk-option-credit">${esc(opt.source || "")}</span>
      </div>
      <a class="btn sk-option-dl" href="${esc(opt.url)}" target="_blank" rel="noopener">⬇ Download this</a>
    </div>
  `;
}

function renderScriptKit(kit, out = $("#scriptkitOutput")) {
  const mediaReady = mediaConfigClient.pexels || mediaConfigClient.pixabay;
  const noticeLines = [];
  if (!mediaReady) noticeLines.push(`🎞️ B-roll download links need a free stock-media key. Add <code>PEXELS_API_KEY</code> or <code>PIXABAY_API_KEY</code> to your .env and refresh.`);
  const imgNotice = noticeLines.length ? `<p class="notice">${noticeLines.join(" ")}</p>` : "";

  const hook = kit.hook || {};
  const hookHtml = `
    <div class="sk-section">
      <h3 class="sk-section-title">🪝 Hook Analysis</h3>
      <div class="sk-block">
        <p class="sk-line">${esc(hook.line || "")}</p>
        <span class="sk-badge ${hook.strength === "strong" ? "post" : hook.strength === "moderate" ? "watch" : "ignore"}">${esc((hook.strength || "unknown").toUpperCase())}</span>
        <p class="sk-text">${esc(hook.why || "")}</p>
        ${hook.improvedLine ? `<div class="sk-improve"><span class="k">Stronger alternative</span><p>${esc(hook.improvedLine)}</p></div>` : ""}
      </div>
    </div>`;

  const beats = (kit.beats || []).map((b, i) => {
    const br = b.broll || {};
    const options = Array.isArray(br.options) ? br.options : (br.mediaUrl ? [{ url: br.mediaUrl, thumb: "", type: br.media, source: br.source, credit: br.credit, duration: br.duration }] : []);
    const hasOptions = options.length > 0;
    const fallbackLinks = br.query && !hasOptions ? `
      <div class="sk-fallback-links">
        <a class="copy-btn" href="https://www.pexels.com/search/${encodeURIComponent(br.query)}/?orientation=portrait" target="_blank" rel="noopener">Search Pexels</a>
        <a class="copy-btn" href="https://pixabay.com/videos/search/${encodeURIComponent(br.query)}/?orientation=vertical" target="_blank" rel="noopener">Search Pixabay</a>
      </div>` : "";
    return `
    <div class="sk-beat">
      <div class="sk-beat-head">
        <span class="sk-beat-time">${b.startSeconds ?? i * 4}s–${b.endSeconds ?? (i + 1) * 4}s</span>
        <span class="beat-part ${(b.part || "").split(" ")[0].toLowerCase()}">${esc(b.part || "beat")}</span>
        ${b.zoom ? `<span class="sk-badge zoom">ZOOM</span>` : ""}
      </div>
      <p class="sk-beat-say">${esc(b.say || "")}</p>
      ${b.onScreenText ? `<p class="sk-beat-ost">🅣 ${esc(b.onScreenText)}</p>` : ""}
      ${b.visualDirection ? `<p class="sk-beat-visual">🎥 ${esc(b.visualDirection)}</p>` : ""}
      ${br.needed ? `
        <div class="sk-broll ${hasOptions ? "has-media" : ""}">
          <div class="sk-broll-head">
            <span class="k">B-roll options</span>
            <span class="sk-broll-meta">${esc(br.placement || "")}</span>
          </div>
          <p class="sk-broll-query">🔍 ${esc(br.query || "")}</p>
          <p class="sk-text">${esc(br.why || "")}</p>
          ${hasOptions ? `<div class="sk-options">${options.map(brollOptionHtml).join("")}</div>` : ""}
          ${fallbackLinks}
        </div>
      ` : ""}
      ${b.soundEffect ? `<p class="sk-sfx">🔊 ${esc(b.soundEffect)}</p>` : ""}
    </div>`;
  }).join("");

  const bgm = (kit.bgm || []).map((m) => {
    const options = Array.isArray(m.options) ? m.options : (m.trackUrl ? [{ url: m.trackUrl, title: m.title, artist: m.artist, duration: m.duration, genre: m.mood || m.genre, source: m.source }] : []);
    const hasOptions = options.length > 0;
    return `
    <div class="sk-bgm">
      <div class="sk-bgm-head">
        <strong>${esc(m.name || "")}</strong>
        <span class="sk-badge ${(m.energyLevel || "medium") === "high" ? "post" : (m.energyLevel || "medium") === "low" ? "ignore" : "watch"}">${esc((m.mood || "").toUpperCase())}</span>
      </div>
      <p class="sk-text"><strong>Why it holds attention:</strong> ${esc(m.whyItRetains || "")}</p>
      <p class="sk-meta">Energy: ${esc(m.energyLevel || "")} · Start: ${esc(m.whenToStart || "")}</p>
      ${hasOptions ? `<p class="sk-text">Preview and pick one:</p><div class="sk-options">${options.map(musicOptionHtml).join("")}</div>` : ""}
      ${!hasOptions && m.whereToFind ? `<p class="sk-meta">Find it on: ${esc(m.whereToFind || "")}</p>` : ""}
    </div>
  `;
  }).join("");

  const sfx = (kit.soundEffects || []).map((s) => `<li>${esc(s)}</li>`).join("");
  const tips = (kit.editingTips || []).map((t) => `<li>${esc(t)}</li>`).join("");
  const assets = (kit.requiredAssets || []).map((a) => `<div class="sk-asset"><span class="sk-asset-type">${esc(a.type || "")}</span><span>${esc(a.description || "")}</span></div>`).join("");
  const cap = kit.captions || {};

  out.innerHTML = `
    ${imgNotice}
    <div class="sk-header">
      <h3>${esc(kit.title || "Untitled Reel")}</h3>
      <span class="sk-badge watch">~${kit.estimatedDurationSeconds || "~"}s · ${esc(kit.niche || "")}</span>
    </div>
    <p class="sk-psychology"><strong>Audience trigger:</strong> ${esc(kit.audiencePsychology || "")}</p>
    ${hookHtml}
    <div class="sk-section">
      <h3 class="sk-section-title">🎬 Beat-by-beat plan</h3>
      <div class="sk-beats">${beats}</div>
    </div>
    <div class="sk-section">
      <h3 class="sk-section-title">🎵 Background music</h3>
      <div class="sk-bgms">${bgm || "<p class=\"subtle\">No BGM suggestions.</p>"}</div>
    </div>
    ${sfx ? `<div class="sk-section"><h3 class="sk-section-title">🔊 Sound effects</h3><ul class="sk-list">${sfx}</ul></div>` : ""}
    <div class="sk-section">
      <h3 class="sk-section-title">📝 Caption + hashtags</h3>
      <div class="sk-caption-block">
        <p>${esc(cap.caption || "")}</p>
        <p class="s-hashtags">${esc((cap.hashtags || []).join("  "))}</p>
        <button class="copy-btn cap-copy" type="button">📋 Copy caption</button>
      </div>
    </div>
    ${assets ? `<div class="sk-section"><h3 class="sk-section-title">🛠️ Required assets</h3><div class="sk-assets">${assets}</div></div>` : ""}
    ${tips ? `<div class="sk-section"><h3 class="sk-section-title">✂️ Editing tips</h3><ul class="sk-list">${tips}</ul></div>` : ""}
  `;

  const capBtn = out.querySelector(".cap-copy");
  if (capBtn) {
    capBtn.addEventListener("click", (e) => copyText(e, `${cap.caption || ""}\n\n${(cap.hashtags || []).join(" ")}`));
  }
}

/* ---------- Reel Editor ---------- */
const editor = { jobId: null, file: null, poll: null };
const showEl = (el) => el.classList.remove("hidden");
const editorStatus = (html) => { $("#editorStatus").innerHTML = html; };

function resetEditorOutput() {
  hide("#editorDownload");
  hide("#editorTranscriptWrap");
  editorStatus("");
}

async function uploadEditorFile(file) {
  editorStatus(`<div class="loading"><div class="spinner"></div><p>Uploading ${file.name}…</p></div>`);
  const fd = new FormData();
  fd.append("video", file);
  try {
    const res = await fetch("/api/reel/upload", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) { editorStatus(errorHtml(data)); return; }
    editor.jobId = data.id;
    editorStatus("");
    showEl($("#editorRenderBtn"));
  } catch {
    editorStatus(errorHtml({ error: "Upload failed — check your connection." }));
  }
}

function pickEditorFile(file) {
  if (!file) return;
  if (file.size > 120 * 1024 * 1024) {
    editorStatus(errorHtml({ error: "Video too large — keep it under 120MB." }));
    return;
  }
  resetEditorOutput();
  hide("#editorRenderBtn");
  editor.file = file;
  const pv = $("#editorPreview");
  pv.src = URL.createObjectURL(file);
  showEl(pv);
  uploadEditorFile(file);
}

$("#editorDrop").addEventListener("click", () => $("#editorFile").click());
$("#editorFile").addEventListener("change", (e) => pickEditorFile(e.target.files[0]));
$("#editorDrop").addEventListener("dragover", (e) => { e.preventDefault(); e.currentTarget.classList.add("over"); });
$("#editorDrop").addEventListener("dragleave", (e) => e.currentTarget.classList.remove("over"));
$("#editorDrop").addEventListener("drop", (e) => {
  e.preventDefault();
  e.currentTarget.classList.remove("over");
  pickEditorFile(e.dataTransfer.files[0]);
});

$("#editorRenderBtn").addEventListener("click", async () => {
  if (!editor.jobId) return;
  hide("#editorRenderBtn");
  resetEditorOutput();
  showEl($("#editorProgress"));
  $("#editorStep").textContent = "Starting render…";
  try {
    const res = await fetch(`/api/reel/${editor.jobId}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ script: $("#editorScript").value || "" }),
    });
    const data = await res.json();
    if (!res.ok) {
      hide("#editorProgress");
      editorStatus(errorHtml(data));
      showEl($("#editorRenderBtn"));
      return;
    }
    pollEditorJob();
  } catch {
    hide("#editorProgress");
    editorStatus(errorHtml({ error: "Could not start the render." }));
  }
});

function pollEditorJob() {
  clearInterval(editor.poll);
  editor.poll = setInterval(async () => {
    try {
      const res = await fetch(`/api/reel/${editor.jobId}/status`);
      const d = await res.json();
      if (!res.ok) {
        clearInterval(editor.poll);
        hide("#editorProgress");
        editorStatus(errorHtml({ error: d.error || "Render job lost — the server may have restarted. Please upload again." }));
        showEl($("#editorRenderBtn"));
        return;
      }
      $("#editorStep").textContent = d.step || "Working…";
      if (d.status === "planned" && d.planData) {
        clearInterval(editor.poll);
        renderOnDevice(d.planData);
      } else if (d.status === "done") {
        clearInterval(editor.poll);
        hide("#editorProgress");
        editorStatus(`<div class="notice ok">✅ Your Reel is ready — ${Math.round(d.duration || 0)}s with ${d.plan?.edits || 0} auto-edits.</div>`);
        const dl = $("#editorDownload");
        dl.href = d.output;
        showEl(dl);
        $("#editorTranscript").textContent = d.transcript || "";
        showEl($("#editorTranscriptWrap"));
        const pv = $("#editorPreview");
        pv.src = d.output;
        showEl(pv);
      } else if (d.status === "failed") {
        clearInterval(editor.poll);
        hide("#editorProgress");
        editorStatus(errorHtml({ error: d.error || "Render failed." }));
        showEl($("#editorRenderBtn"));
      }
    } catch { /* keep polling */ }
  }, 2500);
}

// Renders the edit plan in the browser (segmentation + B-roll behind speaker),
// uploads the silent mp4, server copies the audio in.
async function renderOnDevice(planData) {
  try {
    const { renderClient } = await import("./render.js?v=13");
    const blob = await renderClient({
      file: editor.file,
      plan: planData,
      onProgress: (_p, label) => { $("#editorStep").textContent = label; },
    });
    $("#editorStep").textContent = "Finalizing (adding audio)…";
    const fd = new FormData();
    fd.append("video", blob, "rendered.mp4");
    const res = await fetch(`/api/reel/${editor.jobId}/mux`, { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Finalize failed");
    hide("#editorProgress");
    editorStatus(`<div class="notice ok">✅ Your Reel is ready — ${Math.round(planData.duration || 0)}s with ${planData.edits?.length || 0} auto-edits.</div>`);
    const dl = $("#editorDownload");
    dl.href = data.output;
    showEl(dl);
    const pv = $("#editorPreview");
    pv.src = data.output;
    showEl(pv);
    showEl($("#editorRenderBtn"));
  } catch (e) {
    hide("#editorProgress");
    editorStatus(errorHtml({ error: e.message || "On-device render failed." }));
    showEl($("#editorRenderBtn"));
  }
}

/* ---------- Content Generator ---------- */
// Central entry point -> POST /api/generate -> per-type workflow on the server.
// Each workflow's payload maps to an existing renderer where possible
// (carousel -> buildCarouselCard, reel -> buildScriptEl), so download/share/
// save/edit behavior stays identical to the rest of the app.
let genType = "story";

$("#genTypes").addEventListener("click", (e) => {
  const chip = e.target.closest(".gen-type");
  if (!chip) return;
  document.querySelectorAll(".gen-type").forEach((c) => c.classList.remove("active"));
  chip.classList.add("active");
  genType = chip.dataset.type;
});

const genStatus = (html) => { $("#genStatus").innerHTML = html; };

$("#genBtn").addEventListener("click", async () => {
  const topic = $("#genTopic").value.trim();
  const context = $("#genContext").value.trim();
  if (!topic) { genStatus(errorHtml({ error: "Enter a content topic first." })); return; }
  const btn = $("#genBtn");
  btn.disabled = true;
  genStatus(`<div class="loading"><div class="spinner"></div><p>Generating your ${genType}…</p></div>`);
  $("#genOutput").innerHTML = "";
  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: genType, topic, context }),
    });
    const data = await res.json();
    if (!res.ok) { genStatus(errorHtml(data)); return; }
    genStatus("");
    renderGenerated(data);
  } catch {
    genStatus(errorHtml({ error: "Could not reach the server. Is it running?" }));
  } finally {
    btn.disabled = false;
  }
});

function renderGenerated(result) {
  const out = $("#genOutput");
  out.innerHTML = "";
  if (!result._saveId) result._saveId = `gen-${result.type}-${Date.now()}`;
  upsertHistory({ id: result._saveId, kind: "generated", type: result.type, title: result.title || "Generated content", data: result });
  buildGeneratedCards(result).forEach((card) => out.appendChild(card));
}

// Builds the card element(s) for a generated result — also used to re-render
// saved "generated" items in the Saved view.
function buildGeneratedCards(result) {
  const cards = [];
  const genId = result._saveId || `gen-${result.type}-${Date.now()}`;
  const title = result.title || "Generated content";

  if (result.type === "carousel") {
    (result.payload?.carousels || []).forEach((c) => {
      if (!c.id) c.id = genId;
      cards.push(buildCarouselCard(c)); // same card as Carousels page
    });
    return cards;
  }

  if (result.type === "reel") {
    const p = result.payload || {};
    const card = document.createElement("article");
    card.className = "card";
    const refs = (p.references || []).map((r) => `
      <div class="gen-frame">
        <div class="gen-frame-head"><span class="gen-frame-purpose">${esc(r.format || "")}</span></div>
        <p><span class="k">Why it works</span>${esc(r.whyItWorks || "")}</p>
        <p><span class="k">Your twist</span>${esc(r.twist || "")}</p>
      </div>`).join("");
    card.innerHTML = `
      <div class="card-top"><span class="category">🎬 Reel production pack</span><button class="save-btn" type="button" title="Save idea">☆</button></div>
      <h3 class="card-title">${esc(title)}</h3>
      ${refs ? `<div class="sk-section"><h3 class="sk-section-title">🚀 Format references</h3>${refs}</div>` : ""}
      ${p.script ? `<div class="script-slot"></div>` : ""}
      <div class="gen-kit"></div>`;
    if (p.script) {
      card.querySelector(".script-slot").appendChild(
        buildScriptEl(p.script, { label: "📝 Hinglish script", title, editKey: `${genId}:script`,
          onEdit: () => upsertHistory({ id: genId, kind: "generated", type: result.type, title, data: result }) })
      );
    }
    renderScriptKit(p, card.querySelector(".gen-kit")); // beats, B-roll, BGM, captions, tips
    wireSave(card.querySelector(".save-btn"), { id: genId, type: "generated", title, data: result });
    cards.push(card);
    return cards;
  }

  if (result.type === "story") {
    const p = result.payload || {};
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <div class="card-top">
        <span class="category">📱 Story</span>
        ${p.goal ? `<span class="goal">🎯 ${esc(p.goal)}</span>` : ""}
        <button class="save-btn" type="button" title="Save idea">☆</button>
      </div>
      <h3 class="card-title">${esc(title)}</h3>
      ${p.strategy ? `<p class="subtle" style="margin:-4px 0 12px">${esc(p.strategy)}</p>` : ""}
      <div class="gen-frames"></div>
      ${p.cta ? `<div class="reel"><div class="reel-label">📣 CTA</div><p>${esc(p.cta)}</p></div>` : ""}
      ${(p.postingTips || []).length ? `<div class="sk-section"><h3 class="sk-section-title">💡 Posting tips</h3><ul class="sk-list">${p.postingTips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>` : ""}`;
    const frames = card.querySelector(".gen-frames");
    (p.frames || []).forEach((f) => {
      const el = document.createElement("div");
      el.className = "gen-frame";
      el.innerHTML = `
        <div class="gen-frame-head"><span class="gen-frame-n">${f.n || ""}</span><span class="gen-frame-purpose">${esc(f.purpose || "")}</span></div>
        ${f.imageQuery ? `<div class="gen-frame-img"><div class="st-shimmer"></div></div>` : ""}
        <p>${esc(f.text || "")}</p>
        ${f.visual ? `<p><span class="k">Visual</span>${esc(f.visual)}</p>` : ""}
        ${f.interactive && f.interactive !== "none" ? `<p><span class="k">Interactive</span>${esc(f.interactive)}</p>` : ""}
        ${f.timing ? `<p><span class="k">Timing</span>${esc(f.timing)}</p>` : ""}`;
      frames.appendChild(el);
      // Resolve a real photo for the frame via the existing free slide-image pipeline.
      if (f.imageQuery) {
        loadSlideImage({ imageQuery: f.imageQuery, imageMood: f.imageMood }).then((url) => {
          const wrap = el.querySelector(".gen-frame-img");
          if (wrap && url) wrap.innerHTML = `<img src="${url}" alt="" loading="lazy" />`;
          else if (wrap) wrap.remove();
        });
      }
    });
    wireSave(card.querySelector(".save-btn"), { id: genId, type: "generated", title, data: result });
    cards.push(card);
    return cards;
  }

  // normal post
  const p = result.payload || {};
  const card = document.createElement("article");
  card.className = "card";
  card.innerHTML = `
    <div class="card-top"><span class="category">📝 ${esc(p.format || "Post")}</span><button class="save-btn" type="button" title="Save idea">☆</button></div>
    <h3 class="card-title">${esc(title)}</h3>
    <div class="rows">
      ${p.creativeDirection ? `<div class="row"><span class="k">Creative direction</span><p class="v">${esc(p.creativeDirection)}</p></div>` : ""}
      ${p.altText ? `<div class="row"><span class="k">Alt text</span><p class="v">${esc(p.altText)}</p></div>` : ""}
    </div>
    <div class="gen-post-imgs"></div>
    <div class="script-caption" style="margin-top:12px">
      <span class="k">Caption</span>
      <p class="s-caption">${esc(p.caption || "")}</p>
      <p class="s-hashtags">${esc((p.hashtags || []).join("  "))}</p>
    </div>
    <div class="carousel-actions">
      <button class="copy-btn cap-btn" type="button">📋 Copy caption</button>
    </div>`;
  const imgWrap = card.querySelector(".gen-post-imgs");
  const opts = Array.isArray(p.imageOptions) ? p.imageOptions : [];
  if (opts.length) {
    imgWrap.innerHTML = `<span class="k">📷 Photo options (free to use)</span><div class="sk-options">` +
      opts.map((o, i) => `
        <div class="sk-option">
          <img class="sk-preview" src="${esc(o.thumb || o.url)}" alt="${esc(p.altText || "")}" loading="lazy" />
          <div class="sk-option-info">
            <span class="sk-option-tag">#${i + 1} · ${esc(o.source || "")}</span>
            ${o.credit ? `<span class="sk-option-credit">by ${esc(o.credit)}</span>` : ""}
          </div>
          <a class="btn sk-option-dl" href="${esc(o.url)}" target="_blank" rel="noopener">⬇ Use this</a>
        </div>`).join("") + `</div>`;
  } else if (p.imageQuery) {
    imgWrap.innerHTML = `<p class="subtle">🔍 Find a photo: <a href="https://www.pexels.com/search/${encodeURIComponent(p.imageQuery)}/?orientation=portrait" target="_blank" rel="noopener">search "${esc(p.imageQuery)}" on Pexels</a></p>`;
  } else imgWrap.remove();
  card.querySelector(".cap-btn").addEventListener(
    "click",
    (e) => copyText(e, `${p.caption || ""}\n\n${(p.hashtags || []).join(" ")}`.trim())
  );
  wireSave(card.querySelector(".save-btn"), { id: genId, type: "generated", title, data: result });
  cards.push(card);
  return cards;
}

/* ---------- Reel Analyzer ---------- */
const anlz = { poll: null, uploadId: null, result: null, original: null };
const anlzStatus = (html) => { $("#anlzStatus").innerHTML = html; };

function fmtTs(s = 0) {
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

// Optional manual upload path — reuses the existing /api/reel/upload endpoint.
$("#anlzUploadBtn").addEventListener("click", () => $("#anlzFile").click());
$("#anlzFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 120 * 1024 * 1024) {
    anlzStatus(errorHtml({ error: "Video too large — keep it under 120MB." }));
    return;
  }
  $("#anlzFileName").textContent = `uploading ${file.name}…`;
  const fd = new FormData();
  fd.append("video", file);
  try {
    const res = await fetch("/api/reel/upload", { method: "POST", body: fd });
    const d = await res.json();
    if (!res.ok) { $("#anlzFileName").textContent = ""; anlzStatus(errorHtml(d)); return; }
    anlz.uploadId = d.id;
    $("#anlzFileName").textContent = `✓ ${file.name}`;
    anlzStatus("");
  } catch {
    $("#anlzFileName").textContent = "";
    anlzStatus(errorHtml({ error: "Upload failed — check your connection." }));
  }
});

$("#anlzBtn").addEventListener("click", async () => {
  const url = $("#anlzUrl").value.trim();
  if (!url && !anlz.uploadId) {
    anlzStatus(errorHtml({ error: "Paste an Instagram Reel URL (or upload the video file)." }));
    return;
  }
  $("#anlzBtn").disabled = true;
  $("#anlzOutput").innerHTML = "";
  anlz.original = null;
  anlzStatus(`<div class="loading"><div class="spinner"></div><p id="anlzStep">Starting…</p></div>`);
  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url || undefined, uploadId: anlz.uploadId || undefined }),
    });
    const data = await res.json();
    if (!res.ok) { anlzStatus(errorHtml(data)); return; }
    if (data.result) { anlzStatus(""); renderAnalysis(data.result, true); return; }
    pollAnalyze(data.id);
  } catch {
    anlzStatus(errorHtml({ error: "Could not reach the server. Is it running?" }));
  } finally {
    $("#anlzBtn").disabled = false;
  }
});

function pollAnalyze(id) {
  clearInterval(anlz.poll);
  anlz.poll = setInterval(async () => {
    try {
      const res = await fetch(`/api/analyze/${id}/status`);
      const d = await res.json();
      if (!res.ok) {
        clearInterval(anlz.poll);
        anlzStatus(errorHtml({ error: d.error || "Analysis job lost — the server may have restarted." }));
        return;
      }
      const stepEl = $("#anlzStep");
      if (stepEl) stepEl.textContent = d.step || "Working…";
      if (d.status === "done") {
        clearInterval(anlz.poll);
        anlzStatus("");
        renderAnalysis(d.result, false);
      } else if (d.status === "failed") {
        clearInterval(anlz.poll);
        anlzStatus(errorHtml({ error: d.error || "Analysis failed." }));
      }
    } catch { /* keep polling */ }
  }, 2000);
}

// Plain-text version of the analyzed (possibly user-edited) transcript.
function analysisScriptText() {
  const r = anlz.result || {};
  return (r.segments || []).map((s) => s.text || "").filter(Boolean).join("\n");
}

// Persist the current analyzer state (transcript edits, original version) to history.
let anlzSaveTimer = null;
function saveAnlzHistory(debounce = false) {
  if (!anlz.result) return;
  clearTimeout(anlzSaveTimer);
  const run = () => upsertHistory({
    id: anlz.historyId,
    kind: "analyzer",
    title: anlz.result.title || "Analyzed Reel",
    data: { result: anlz.result, original: anlz.original },
  });
  if (debounce) anlzSaveTimer = setTimeout(run, 800);
  else run();
}

function renderAnalysis(r, cached, historyId) {
  anlz.result = r;
  anlz.original = null;
  anlz.historyId = historyId || `anlz-${strHash(r.url || anlz.uploadId || r.title || Date.now())}`;
  const out = $("#anlzOutput");
  const mediaReady = mediaConfigClient.pexels || mediaConfigClient.pixabay;
  const inferredNote = r._mode === "transcript"
    ? `<p class="notice">⚠️ Couldn't access the video frames — visuals below are inferred from the spoken script.</p>` : "";
  const cacheNote = cached ? `<p class="notice ok">⚡ Served from cache — no new AI calls were used.</p>` : "";

  const segments = (r.segments || []).map((s, i) => `
    <div class="anlz-seg" data-i="${i}">
      <div class="anlz-seg-head">
        <span class="sk-beat-time">${fmtTs(s.start)}–${fmtTs(s.end)}</span>
        <span class="beat-part ${(s.part || "").split(" ")[0].toLowerCase()}">${esc(s.part || "seg")}</span>
        <button class="copy-btn anlz-rephrase" type="button" title="Rephrase this line">↺ Rephrase</button>
      </div>
      <textarea class="anlz-seg-ta" rows="2">${esc(s.text || "")}</textarea>
      ${s.onScreen ? `<p class="sk-beat-ost">🅣 ${esc(s.onScreen)}</p>` : ""}
    </div>`).join("");

  const visuals = (r.visuals || []).map((v) => `
    <div class="anlz-vis">
      <span class="sk-beat-time">${fmtTs(v.start)}–${fmtTs(v.end)}</span>
      <span class="sk-badge watch">${esc(v.type || "visual")}</span>
      <p class="sk-text">${esc(v.description || "")}${v.mapsToSegment != null && r.segments?.[v.mapsToSegment] ? ` <span class="subtle">→ supports: "${esc((r.segments[v.mapsToSegment].text || "").slice(0, 60))}…"</span>` : ""}</p>
      ${v.sourceUrl ? `<a class="sk-option-credit" href="${esc(v.sourceUrl)}" target="_blank" rel="noopener">🔗 source</a>` : ""}
    </div>`).join("");

  const card = document.createElement("article");
  card.className = "card";
  card.innerHTML = `
    <div class="card-top">
      <span class="category">🔍 Reel analysis</span>
      ${r.spokenLanguage ? `<span class="category">${esc(r.spokenLanguage)}</span>` : ""}
      ${r.durationSeconds ? `<span class="goal">~${Math.round(r.durationSeconds)}s</span>` : ""}
    </div>
    <h3 class="card-title">${esc(r.title || "Analyzed Reel")}</h3>
    ${r.url ? `<p class="subtle"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a></p>` : ""}
    ${cacheNote}${inferredNote}
    <div class="rows">
      ${r.coreIdea ? `<div class="row"><span class="k">Core idea</span><p class="v">${esc(r.coreIdea)}</p></div>` : ""}
      ${r.structure ? `<div class="row"><span class="k">Structure</span><p class="v">${esc(r.structure)}</p></div>` : ""}
    </div>
    <div class="sk-section">
      <h3 class="sk-section-title">🪝 Hook</h3>
      <div class="sk-block">
        <p class="sk-line">${esc(r.hook?.text || "")}</p>
        ${r.hook?.start != null ? `<span class="sk-beat-time">${fmtTs(r.hook.start)}–${fmtTs(r.hook.end)}</span>` : ""}
        <p class="sk-text">${esc(r.hook?.why || "")}</p>
      </div>
    </div>
    <div class="sk-section">
      <h3 class="sk-section-title">📝 Transcript <span class="subtle">— editable</span></h3>
      <div class="anlz-segs">${segments}</div>
      <div class="carousel-actions" style="margin-top:8px">
        <button class="copy-btn anlz-copy-script" type="button">📋 Copy script</button>
      </div>
    </div>
    ${(r.mainPoints || []).length ? `<div class="sk-section"><h3 class="sk-section-title">🎯 Main points</h3><ul class="sk-list">${r.mainPoints.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div>` : ""}
    ${r.cta?.text ? `<div class="sk-section"><h3 class="sk-section-title">📣 CTA</h3><div class="sk-block"><p class="sk-line">${esc(r.cta.text)}</p>${r.cta.start != null ? `<span class="sk-beat-time">${fmtTs(r.cta.start)}–${fmtTs(r.cta.end)}</span>` : ""}</div></div>` : ""}
    ${visuals ? `<div class="sk-section"><h3 class="sk-section-title">🎞️ Visuals & B-roll map</h3><div class="anlz-viss">${visuals}</div></div>` : ""}
    <div class="carousel-actions" style="margin-top:14px">
      <button class="btn dl-btn anlz-orig-btn" type="button">✨ Create my original version</button>
    </div>
    <div id="anlzOrigOut"></div>`;
  out.innerHTML = "";
  out.appendChild(card);

  card.querySelector(".anlz-copy-script").addEventListener("click", (e) => copyText(e, analysisScriptText()));

  // Editable transcript: keep the model in sync so "original version" + rephrase
  // always use the latest wording.
  card.querySelectorAll(".anlz-seg").forEach((seg) => {
    const i = +seg.dataset.i;
    const ta = seg.querySelector(".anlz-seg-ta");
    ta.addEventListener("input", () => { anlz.result.segments[i].text = ta.value; saveAnlzHistory(true); });
    seg.querySelector(".anlz-rephrase").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const orig = ta.value;
      btn.textContent = "…";
      try {
        const res = await fetch("/api/analyze/rephrase", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: orig, context: analysisScriptText() }),
        });
        const d = await res.json();
        if (res.ok && d.rephrased) {
          ta.value = d.rephrased;
          anlz.result.segments[i].text = d.rephrased;
          saveAnlzHistory();
        } else {
          btn.textContent = d.error || "failed";
          setTimeout(() => (btn.textContent = "↺ Rephrase"), 2000);
        }
      } catch {
        btn.textContent = "↺ Rephrase";
      } finally {
        btn.disabled = false;
        if (btn.textContent === "…") btn.textContent = "↺ Rephrase";
      }
    });
  });

  card.querySelector(".anlz-orig-btn").addEventListener("click", (e) => makeOriginal(e.currentTarget));

  saveAnlzHistory();

  if (!mediaReady) {
    card.insertAdjacentHTML("beforeend",
      `<p class="notice">🎞️ B-roll download links need a free stock-media key (<code>PEXELS_API_KEY</code> or <code>PIXABAY_API_KEY</code>).</p>`);
  }
}

// On demand: one AI call -> genuinely new script + B-roll queries + BGM ideas.
async function makeOriginal(btn) {
  const script = analysisScriptText();
  if (!script) return;
  btn.disabled = true;
  const origLabel = btn.textContent;
  btn.textContent = "Writing your version…";
  const out = $("#anlzOrigOut");
  out.innerHTML = `<div class="loading"><div class="spinner"></div><p>Creating an original version of the script…</p></div>`;
  try {
    const res = await fetch("/api/analyze/original", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analysis: anlz.result, script }),
    });
    const d = await res.json();
    if (!res.ok) { out.innerHTML = errorHtml(d); return; }
    anlz.original = d;
    renderOriginal(d);
  } catch {
    out.innerHTML = errorHtml({ error: "Could not reach the server." });
  } finally {
    btn.disabled = false;
    btn.textContent = origLabel;
  }
}

function renderOriginal(d) {
  anlz.original = d;
  const out = $("#anlzOrigOut");
  out.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "sk-section";
  wrap.innerHTML = `
    <h3 class="sk-section-title">✨ Your original version</h3>
    ${d.cached ? `<p class="notice ok">⚡ Cached — no new AI calls.</p>` : ""}
    ${d.whatsDifferent ? `<div class="whatsDiff"><span class="k">What's different</span><p class="whatsDiff-txt">${esc(d.whatsDifferent)}</p></div>` : ""}
    <div class="orig-script-slot"></div>
    <div class="anlz-orig-lines"></div>
    <div class="sk-section">
      <h3 class="sk-section-title">🎵 BGM recommendations</h3>
      <div class="anlz-bgm-list"></div>
      <div class="carousel-actions"><button class="copy-btn anlz-find-bgm" type="button">🔊 Find downloadable tracks</button></div>
      <div class="anlz-bgm-tracks"></div>
    </div>`;
  out.appendChild(wrap);

  // Editable script card (same component used everywhere else).
  const sc = { durationSeconds: d.durationSeconds, hook: d.hook, onScreenHook: d.onScreenHook, lines: d.lines, caption: d.caption, hashtags: d.hashtags };
  wrap.querySelector(".orig-script-slot").appendChild(
    buildScriptEl(sc, { label: "✅ Your original script", title: anlz.result?.title || "Reel", variant: "improved",
      editKey: `${anlz.historyId}:orig`,
      onEdit: () => {
        Object.assign(anlz.original, { hook: sc.hook, onScreenHook: sc.onScreenHook, lines: sc.lines, caption: sc.caption, hashtags: sc.hashtags });
        saveAnlzHistory();
      } })
  );

  // Per-line tools: rephrase + lazy B-roll.
  const linesEl = wrap.querySelector(".anlz-orig-lines");
  (d.lines || []).forEach((ln, i) => {
    const row = document.createElement("div");
    row.className = "anlz-seg";
    row.innerHTML = `
      <div class="anlz-seg-head">
        <span class="beat-part ${(ln.part || "").split(" ")[0].toLowerCase()}">${esc(ln.part || "")}</span>
        <button class="copy-btn anlz-oline-rephrase" type="button">↺ Rephrase</button>
      </div>
      <p class="sk-beat-say">${esc(ln.say || "")}</p>
      ${ln.brollQuery ? `
        <div class="anlz-broll">
          <button class="copy-btn anlz-find-broll" type="button">🎞️ Find B-roll: "${esc(ln.brollQuery)}"</button>
          <div class="anlz-broll-opts"></div>
        </div>` : ""}`;
    linesEl.appendChild(row);

    row.querySelector(".anlz-oline-rephrase").addEventListener("click", async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      b.textContent = "…";
      try {
        const res = await fetch("/api/analyze/rephrase", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: ln.say, context: (d.lines || []).map((x) => x.say).join("\n") }),
        });
        const r = await res.json();
        if (res.ok && r.rephrased) {
          ln.say = r.rephrased;
          row.querySelector(".sk-beat-say").textContent = r.rephrased;
          if (sc.lines?.[i]) sc.lines[i].say = r.rephrased;
          saveAnlzHistory();
        }
      } catch {} finally {
        b.disabled = false;
        b.textContent = "↺ Rephrase";
      }
    });

    const brollBtn = row.querySelector(".anlz-find-broll");
    if (brollBtn) {
      brollBtn.addEventListener("click", async () => {
        brollBtn.disabled = true;
        brollBtn.textContent = "Searching…";
        const optsEl = row.querySelector(".anlz-broll-opts");
        try {
          const res = await fetch("/api/analyze/broll", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: ln.brollQuery }),
          });
          const r = await res.json();
          if (res.ok && (r.options || []).length) {
            optsEl.innerHTML = `<div class="sk-options">${r.options.map(brollOptionHtml).join("")}</div>`;
            brollBtn.classList.add("hidden");
          } else {
            optsEl.innerHTML = `<p class="sk-text">No stock media found — <a href="https://www.pexels.com/search/videos/${encodeURIComponent(ln.brollQuery)}/?orientation=portrait" target="_blank" rel="noopener">search Pexels manually</a></p>`;
            brollBtn.disabled = false;
            brollBtn.textContent = `🎞️ Retry: "${ln.brollQuery}"`;
          }
        } catch {
          brollBtn.disabled = false;
          brollBtn.textContent = `🎞️ Find B-roll: "${ln.brollQuery}"`;
        }
      });
    }
  });

  // BGM suggestions + lazy track resolution.
  const bgmList = wrap.querySelector(".anlz-bgm-list");
  bgmList.innerHTML = (d.bgm || []).map((m) => `
    <div class="sk-bgm">
      <div class="sk-bgm-head"><strong>${esc(m.name || "")}</strong><span class="sk-badge watch">${esc((m.mood || "").toUpperCase())}</span></div>
      <p class="sk-text">${esc(m.why || "")}</p>
      <p class="sk-meta">Search: "${esc(m.searchQuery || "")}"</p>
    </div>`).join("") || `<p class="subtle">No BGM suggestions.</p>`;

  wrap.querySelector(".anlz-find-bgm").addEventListener("click", async (e) => {
    const b = e.currentTarget;
    if (!(d.bgm || []).length) return;
    b.disabled = true;
    b.textContent = "Searching free music…";
    const tracksEl = wrap.querySelector(".anlz-bgm-tracks");
    try {
      const res = await fetch("/api/analyze/bgm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: d.bgm }),
      });
      const r = await res.json();
      if (res.ok) {
        tracksEl.innerHTML = (r.items || []).map((m) => `
          <div class="sk-bgm">
            <div class="sk-bgm-head"><strong>${esc(m.name || "")}</strong><span class="sk-badge watch">${esc((m.mood || "").toUpperCase())}</span></div>
            ${(m.tracks || []).length ? `<div class="sk-options">${m.tracks.map(musicOptionHtml).join("")}</div>` : `<p class="sk-text">No free tracks found — try "${esc(m.searchQuery || "")}" on Uppbeat / Pixabay / YouTube Audio Library.</p>`}
          </div>`).join("");
        b.classList.add("hidden");
      }
    } catch {
      b.disabled = false;
      b.textContent = "🔊 Find downloadable tracks";
    }
  });

  saveAnlzHistory();
}
