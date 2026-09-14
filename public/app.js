const $ = (s, r = document) => r.querySelector(s);

const state = { view: "trends", trends: null, viral: null, filter: "ALL" };

// Saved list is synced to the server (Upstash) and cached locally for offline/instant use.
let savedCache = [];
let requiresPass = false;
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

function buildScriptEl(sc = {}, opts = {}) {
  const { label = "📝 Script", title = "Reel", note = "", showVisual = true, variant = "" } = opts;
  const el = document.createElement("div");
  el.className = "script" + (variant ? " " + variant : "");
  el.innerHTML = `
    <div class="script-head">
      <div class="script-label">${esc(label)} <span class="dur">${sc.durationSeconds ? "· " + sc.durationSeconds + "s" : ""}</span></div>
      <button class="copy-btn" type="button">Copy</button>
    </div>
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
    </div>`;
  const beats = el.querySelector(".beats");
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
  el.querySelector(".copy-btn").addEventListener("click", (e) => copyText(e, scriptToText(sc, title, label)));
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
    slot.appendChild(buildScriptEl(f.script, { label: "📝 Hinglish script", title: f.title }));
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
    buildScriptEl(os, { label: "🎪 Original-style (reference)", title: b.title, note: os.note, showVisual: false, variant: "original" })
  );
  node.querySelector(".improved-slot").appendChild(
    buildScriptEl(b.improvedScript || {}, { label: "✅ Your improved script", title: b.title, variant: "improved" })
  );
  fillSources(node.querySelector(".sources"), b.sources);
  wireSave(node.querySelector(".save-btn"), { id: b.id, type: "viral", title: b.title, data: b });
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
function renderTrends(data) {
  $("#status").innerHTML = data.summary
    ? `<p class="summary">${esc(data.summary)}</p>` : "";
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
  $("#viralStatus").innerHTML = data.summary ? `<p class="summary">${esc(data.summary)}</p>` : "";
  renderTop($("#viralTopCards"), data.topThree, data.blueprints, "successLevel");
  show("#viralTop");
  const cards = $("#viralCards");
  cards.innerHTML = "";
  (data.blueprints || []).forEach((b) => cards.appendChild(buildViralCard(b)));
  show("#viralFeed");
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
    const card = item.type === "viral" ? buildViralCard(item.data) : buildTrendCard(item.data);
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

/* ---------- router ---------- */
function switchView(view) {
  state.view = view;
  ["trends", "viral", "saved"].forEach((v) => $(`#view-${v}`).classList.toggle("hidden", v !== view));
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $("#refresh").style.display = view === "saved" ? "none" : "";
  if (view === "trends" && !state.trends) loadTrends(false);
  if (view === "viral" && !state.viral) loadViral(false);
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
updateSavedBadge();

fetch("/api/config")
  .then((r) => r.json())
  .then((d) => {
    $("#niche").textContent = d.niche || "";
    requiresPass = !!d.requiresPass;
    refreshSaved();
  })
  .catch(() => {});

loadTrends(false);
