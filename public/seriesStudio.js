// Series Studio frontend — create, discover, research, and manage Reel series.
// Wrapped in an IIFE so its top-level declarations don't collide with app.js globals.
(function () {
"use strict";

const R = window.ReelStudioShared || {};
const { esc, copyText, passHeaders, switchView, buildScriptEl, scriptToText, parseScriptText, mediaConfigClient } = R;

const LIBRARY_KEY = "reelstudio_series_lib";
let library = [];
let currentSeries = null;
let analyzeUploadId = null;
let analyzePoll = null;

function $(s, r = document) { return r.querySelector(s); }
function hide(el) { if (typeof el === "string") el = $(el); el.classList.add("hidden"); }
function show(el) { if (typeof el === "string") el = $(el); el.classList.remove("hidden"); }

function errorHtml(data) {
  return `<p class="big">⚠️ ${esc(data.error || "Something went wrong")}</p>`;
}

async function apiFetch(url, body) {
  const opts = { method: "POST", headers: { "Content-Type": "application/json", ...passHeaders() } };
  if (body) opts.body = JSON.stringify(body);
  return fetch(url, opts);
}

function upsertSeriesHistory(item) {
  if (typeof window.upsertHistory === "function") window.upsertHistory(item);
}

function cacheLibrary() { try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(library)); } catch {} }
function loadLibraryCache() { try { library = JSON.parse(localStorage.getItem(LIBRARY_KEY)) || []; } catch { library = []; } }

async function refreshLibrary() {
  try {
    const res = await fetch("/api/series/library", { headers: passHeaders() });
    if (res.status === 401) { renderLibraryLogin(); return; }
    const d = await res.json();
    library = Array.isArray(d.items) ? d.items : [];
    cacheLibrary();
  } catch {
    loadLibraryCache();
  }
  renderLibrary();
}

async function persistLibrary() {
  cacheLibrary();
  try {
    await fetch("/api/series/library", { method: "PUT", headers: { "Content-Type": "application/json", ...passHeaders() }, body: JSON.stringify({ items: library }) });
  } catch {}
}

function normalizeEpisode(ep, i) {
  ep.id = ep.id || `ep-${(ep.n || i + 1)}-${Math.random().toString(36).slice(2, 6)}`;
  ep.n = ep.n || i + 1;
  ep.status = ep.status || "Idea";
  // Some model responses flatten the script fields into the episode; lift them into a script object.
  if (!ep.script && (ep.lines || ep.durationSeconds || ep.hashtags)) {
    ep.script = {
      durationSeconds: ep.durationSeconds || 30,
      hook: ep.hook || "",
      onScreenHook: ep.onScreenHook || "",
      lines: Array.isArray(ep.lines) ? ep.lines : [],
      caption: ep.caption || "",
      hashtags: Array.isArray(ep.hashtags) ? ep.hashtags : []
    };
  }
  if (!ep.script) {
    ep.script = {
      durationSeconds: 30,
      hook: ep.hook || "",
      onScreenHook: "",
      lines: [],
      caption: ep.caption || "",
      hashtags: []
    };
  }
  return ep;
}

function normalizeSeries(data, topic, context) {
  const s = data || {};
  s.id = s.id || `series-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  s.topic = topic || s.topic || "";
  s.context = context || s.context || "";
  s.seriesName = s.seriesName || s.title || "Untitled Series";
  s.episodes = Array.isArray(s.episodes) ? s.episodes : [];
  s.createdAt = s.createdAt || Date.now();
  s.updatedAt = Date.now();
  s.coveredTopics = Array.isArray(s.coveredTopics) ? s.coveredTopics : [];
  s.episodes = s.episodes.map(normalizeEpisode);
  return s;
}

function updateEpisodeFromForm(series, idx, card) {
  const ep = series.episodes[idx];
  ep.title = card.querySelector(".ss-ep-title").value.trim();
  ep.status = card.querySelector(".ss-ep-status").value;
  ep.plannedDate = card.querySelector(".ss-ep-date").value;
  ep.hook = card.querySelector(".ss-ep-hook").value.trim();
  ep.mainTakeaway = card.querySelector(".ss-ep-takeaway").value.trim();
  ep.cta = card.querySelector(".ss-ep-cta").value.trim();
  ep.brollVisuals = card.querySelector(".ss-ep-broll").value.split("\n").map((x) => x.trim()).filter(Boolean);
  ep.bgmMood = card.querySelector(".ss-ep-bgm").value.trim();
  ep.caption = card.querySelector(".ss-ep-caption").value.trim();
  ep.suggestedPostingDay = card.querySelector(".ss-ep-day").value.trim();
  ep.continuityNote = card.querySelector(".ss-ep-continuity").value.trim();
  series.updatedAt = Date.now();
}

function collectSeriesMeta(series) {
  series.coveredTopics = Array.from(new Set(series.episodes.map((e) => e.continuityNote || e.title).filter(Boolean)));
}

function renderLibraryLogin() {
  const el = $("#seriesLibrary");
  el.innerHTML = `<div class="card"><div class="status"><p class="big">Enter your passcode to view your synced series library</p><button class="btn" id="ssUnlockLib" type="button">Unlock</button></div></div>`;
  $("#ssUnlockLib").addEventListener("click", async () => {
    if (typeof window.ensureAuth === "function" && await window.ensureAuth()) refreshLibrary();
  });
}

function renderLibrary() {
  const el = $("#seriesLibrary");
  if (!library.length) {
    el.innerHTML = `<p class="subtle" style="text-align:center;padding:24px">No saved series yet. Create one and save it here — it syncs across devices.</p>`;
    return;
  }
  let html = `<details class="hist-card card" open><summary class="hist-head">Series Library <span class="badge">${library.length}</span></summary><div class="hist-list">`;
  library.forEach((s) => {
    const when = new Date(s.updatedAt || s.createdAt || Date.now()).toLocaleString();
    const epCount = (s.episodes || []).length;
    html += `
      <div class="hist-row" data-id="${esc(s.id)}">
        <span class="hist-type">series</span>
        <button class="hist-title ss-open" type="button">${esc(s.seriesName)}</button>
        <span class="hist-date">${epCount} ep · ${when}</span>
        <button class="hist-del ss-dup" type="button" title="Duplicate">copy</button>
        <button class="hist-del ss-del" type="button" title="Delete">delete</button>
      </div>`;
  });
  html += `</div></details>`;
  el.innerHTML = html;
  el.querySelectorAll(".ss-open").forEach((b) => b.addEventListener("click", () => openSeries(library.find((x) => x.id === b.closest(".hist-row").dataset.id))));
  el.querySelectorAll(".ss-dup").forEach((b) => b.addEventListener("click", () => duplicateSeries(b.closest(".hist-row").dataset.id)));
  el.querySelectorAll(".ss-del").forEach((b) => b.addEventListener("click", () => deleteSeries(b.closest(".hist-row").dataset.id)));
}

function openSeries(series) {
  currentSeries = JSON.parse(JSON.stringify(series));
  renderCurrentSeries();
}

function duplicateSeries(id) {
  const s = library.find((x) => x.id === id);
  if (!s) return;
  const copy = JSON.parse(JSON.stringify(s));
  copy.id = `series-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  copy.seriesName = `Copy of ${s.seriesName}`;
  copy.createdAt = Date.now();
  copy.updatedAt = Date.now();
  library.unshift(copy);
  persistLibrary();
  renderLibrary();
  openSeries(copy);
}

async function deleteSeries(id) {
  const s = library.find((x) => x.id === id);
  if (!s || !confirm(`Delete "${s.seriesName}" permanently?`)) return;
  library = library.filter((x) => x.id !== id);
  await persistLibrary();
  renderLibrary();
  if (currentSeries && currentSeries.id === id) { currentSeries = null; $("#seriesOutput").innerHTML = ""; }
}

function saveCurrentSeries() {
  if (!currentSeries) return;
  collectSeriesMeta(currentSeries);
  const idx = library.findIndex((x) => x.id === currentSeries.id);
  if (idx >= 0) library[idx] = currentSeries;
  else library.unshift(currentSeries);
  persistLibrary();
  renderLibrary();
  if (typeof window.upsertHistory === "function") {
    window.upsertHistory({ id: currentSeries.id, kind: "series", type: "series", title: currentSeries.seriesName, data: currentSeries });
  }
}

function renderCurrentSeries() {
  const out = $("#seriesOutput");
  const s = currentSeries;
  out.innerHTML = "";

  const header = document.createElement("div");
  header.className = "card";
  header.innerHTML = `
    <div class="card-top"><span class="category">Series</span></div>
    <input class="ss-series-title gen-input" value="${esc(s.seriesName)}" style="font-size:1.25rem;font-weight:800;margin-bottom:10px" />
    <div class="rows">
      <div class="row"><span class="k">Concept</span><p class="v"><textarea class="ss-series-concept script-ta" rows="2">${esc(s.concept || "")}</textarea></p></div>
      <div class="row"><span class="k">Target audience</span><p class="v"><input class="ss-series-audience gen-input" value="${esc(s.targetAudience || "")}" /></p></div>
      <div class="row"><span class="k">Why follow</span><p class="v"><textarea class="ss-series-follow script-ta" rows="2">${esc(s.followReason || "")}</textarea></p></div>
      <div class="row"><span class="k">Posting sequence</span><p class="v"><input class="ss-series-sequence gen-input" value="${esc(s.postingSequence || "")}" /></p></div>
    </div>
    <div class="series-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
      <button class="btn dl-btn ss-save" type="button">Save Series</button>
      <button class="btn copy-btn ss-next" type="button">Next Episode</button>
      <button class="btn copy-btn ss-dup-series" type="button">Duplicate Series</button>
      <button class="btn copy-btn ss-gaps" type="button">Find Content Gaps</button>
    </div>
    <div id="ssGapsOut" style="margin-top:14px"></div>`;
  header.querySelector(".ss-save").addEventListener("click", () => {
    s.seriesName = header.querySelector(".ss-series-title").value.trim();
    s.concept = header.querySelector(".ss-series-concept").value.trim();
    s.targetAudience = header.querySelector(".ss-series-audience").value.trim();
    s.followReason = header.querySelector(".ss-series-follow").value.trim();
    s.postingSequence = header.querySelector(".ss-series-sequence").value.trim();
    saveCurrentSeries();
    renderCurrentSeries();
  });
  header.querySelector(".ss-next").addEventListener("click", () => addNextEpisode());
  header.querySelector(".ss-dup-series").addEventListener("click", () => duplicateSeries(s.id));
  header.querySelector(".ss-gaps").addEventListener("click", () => findGaps());
  out.appendChild(header);

  const list = document.createElement("div");
  list.className = "ss-episodes";
  s.episodes.forEach((ep, i) => list.appendChild(buildEpisodeCard(ep, i)));
  out.appendChild(list);
}

function buildEpisodeCard(ep, idx) {
  const s = currentSeries;
  const card = document.createElement("div");
  card.className = "card ss-ep-card";
  card.dataset.idx = idx;

  const scriptObj = ep.script || { durationSeconds: 30, hook: ep.hook || "", onScreenHook: "", lines: [], caption: ep.caption || "", hashtags: [] };

  card.innerHTML = `
    <div class="card-top"><span class="category">Episode ${ep.n}</span><span class="ss-dur">~${scriptObj.durationSeconds || 30}s</span></div>
    <input class="ss-ep-title gen-input" value="${esc(ep.title || "")}" placeholder="Episode title" />
    <div class="ss-ep-meta" style="display:flex;gap:10px;flex-wrap:wrap;margin:10px 0">
      <select class="ss-ep-status gen-input" style="max-width:140px">
        <option value="Idea" ${ep.status === "Idea" ? "selected" : ""}>Idea</option>
        <option value="Scripted" ${ep.status === "Scripted" ? "selected" : ""}>Scripted</option>
        <option value="Filmed" ${ep.status === "Filmed" ? "selected" : ""}>Filmed</option>
        <option value="Edited" ${ep.status === "Edited" ? "selected" : ""}>Edited</option>
        <option value="Posted" ${ep.status === "Posted" ? "selected" : ""}>Posted</option>
      </select>
      <input class="ss-ep-date gen-input" type="date" value="${esc(ep.plannedDate || "")}" style="max-width:160px" />
    </div>
    <label class="gen-label">Hook</label>
    <input class="ss-ep-hook gen-input" value="${esc(ep.hook || scriptObj.hook || "")}" />
    <div class="ss-script-slot"></div>
    <label class="gen-label">Main takeaway</label>
    <textarea class="ss-ep-takeaway script-ta" rows="2">${esc(ep.mainTakeaway || "")}</textarea>
    <label class="gen-label">CTA</label>
    <input class="ss-ep-cta gen-input" value="${esc(ep.cta || "")}" />
    <label class="gen-label">B-roll / Visual suggestions (one per line)</label>
    <textarea class="ss-ep-broll script-ta" rows="2">${esc((ep.brollVisuals || []).join("\n"))}</textarea>
    <label class="gen-label">BGM mood</label>
    <input class="ss-ep-bgm gen-input" value="${esc(ep.bgmMood || "")}" />
    <label class="gen-label">Caption</label>
    <textarea class="ss-ep-caption script-ta" rows="2">${esc(ep.caption || scriptObj.caption || "")}</textarea>
    <label class="gen-label">Suggested posting day</label>
    <input class="ss-ep-day gen-input" value="${esc(ep.suggestedPostingDay || "")}" />
    <label class="gen-label">Continuity note</label>
    <textarea class="ss-ep-continuity script-ta" rows="2">${esc(ep.continuityNote || "")}</textarea>
    <div class="series-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
      <button class="btn copy-btn ss-hooks" type="button">Hook Variations</button>
      <button class="btn copy-btn ss-ctas" type="button">CTA Suggestions</button>
      <button class="btn copy-btn ss-broll" type="button">B-roll Planner</button>
      <button class="btn copy-btn ss-bgm" type="button">BGM Recommendations</button>
      <button class="btn copy-btn ss-repurpose" type="button">Repurpose</button>
      <button class="btn copy-btn ss-regen" type="button">Regenerate Episode</button>
    </div>
    <div class="ss-tools-out" style="margin-top:14px"></div>`;

  const scriptSlot = card.querySelector(".ss-script-slot");
  scriptSlot.appendChild(buildScriptEl(scriptObj, {
    label: "Script",
    title: ep.title || `Episode ${ep.n}`,
    onEdit: () => {
      ep.hook = scriptObj.hook;
      ep.script = scriptObj;
      ep.caption = scriptObj.caption;
      card.querySelector(".ss-ep-hook").value = ep.hook;
      card.querySelector(".ss-ep-caption").value = ep.caption;
      s.updatedAt = Date.now();
    }
  }));

  const tools = card.querySelector(".ss-tools-out");
  card.querySelector(".ss-hooks").addEventListener("click", () => runHookVariations(card, idx, tools));
  card.querySelector(".ss-ctas").addEventListener("click", () => runCtaSuggestions(card, idx, tools));
  card.querySelector(".ss-broll").addEventListener("click", () => runBrollPlanner(card, idx, tools));
  card.querySelector(".ss-bgm").addEventListener("click", () => runBgmRecommendations(card, idx, tools));
  card.querySelector(".ss-repurpose").addEventListener("click", () => runRepurpose(card, idx, tools));
  card.querySelector(".ss-regen").addEventListener("click", () => runRegenerateEpisode(idx));

  card.querySelectorAll("input, textarea, select").forEach((inp) => {
    inp.addEventListener("change", () => { updateEpisodeFromForm(s, idx, card); s.updatedAt = Date.now(); });
    inp.addEventListener("input", () => { updateEpisodeFromForm(s, idx, card); s.updatedAt = Date.now(); });
  });

  return card;
}

async function runHookVariations(card, idx, out) {
  updateEpisodeFromForm(currentSeries, idx, card);
  const ep = currentSeries.episodes[idx];
  out.innerHTML = `<div class="loading"><div class="spinner"></div><p>Generating hook variations...</p></div>`;
  try {
    const res = await apiFetch("/api/series/hook-variations", { episode: ep });
    const d = await res.json();
    if (!res.ok) { out.innerHTML = errorHtml(d); return; }
    let html = `<div class="sk-section"><h3 class="sk-section-title">Hook Variations</h3>`;
    (d.variations || []).forEach((v) => {
      html += `<div class="sk-block" style="margin-bottom:10px">
        <p class="sk-line">${esc(v.hook || "")}</p>
        <p class="sk-text">On-screen: ${esc(v.onScreenHook || "")} · Pattern: ${esc(v.pattern || "")}</p>
        <button class="copy-btn ss-use-hook" data-hook="${esc(v.hook || "")}" data-osh="${esc(v.onScreenHook || "")}" type="button">Use this hook</button>
      </div>`;
    });
    html += `</div>`;
    out.innerHTML = html;
    out.querySelectorAll(".ss-use-hook").forEach((b) => b.addEventListener("click", () => {
      ep.hook = b.dataset.hook;
      ep.script = ep.script || {};
      ep.script.hook = b.dataset.hook;
      ep.script.onScreenHook = b.dataset.osh;
      saveCurrentSeries();
      renderCurrentSeries();
    }));
  } catch {
    out.innerHTML = errorHtml({ error: "Could not reach the server." });
  }
}

async function runCtaSuggestions(card, idx, out) {
  updateEpisodeFromForm(currentSeries, idx, card);
  const ep = currentSeries.episodes[idx];
  out.innerHTML = `<div class="loading"><div class="spinner"></div><p>Suggesting CTAs...</p></div>`;
  try {
    const goal = prompt("Primary goal? (follows, comments, saves, shares, dms)", "follows") || "follows";
    const res = await apiFetch("/api/series/cta-suggestions", { episode: ep, goal });
    const d = await res.json();
    if (!res.ok) { out.innerHTML = errorHtml(d); return; }
    let html = `<div class="sk-section"><h3 class="sk-section-title">CTA Suggestions</h3>`;
    (d.ctas || []).forEach((c) => {
      html += `<div class="sk-block" style="margin-bottom:10px">
        <p class="sk-line">${esc(c.cta || "")}</p>
        <p class="sk-text">Goal: ${esc(c.goal || "")} · ${esc(c.why || "")}</p>
        <button class="copy-btn ss-use-cta" data-cta="${esc(c.cta || "")}" type="button">Use this CTA</button>
      </div>`;
    });
    html += `</div>`;
    out.innerHTML = html;
    out.querySelectorAll(".ss-use-cta").forEach((b) => b.addEventListener("click", () => {
      ep.cta = b.dataset.cta;
      saveCurrentSeries();
      renderCurrentSeries();
    }));
  } catch {
    out.innerHTML = errorHtml({ error: "Could not reach the server." });
  }
}

async function runBrollPlanner(card, idx, out) {
  updateEpisodeFromForm(currentSeries, idx, card);
  const ep = currentSeries.episodes[idx];
  const lines = (ep.script?.lines || []).map((l) => ({ part: l.part || "value", say: l.say || "", text: l.text || "", visual: l.visual || "" }));
  out.innerHTML = `<div class="loading"><div class="spinner"></div><p>Planning B-roll...</p></div>`;
  try {
    const res = await apiFetch("/api/series/broll", { lines, hook: ep.hook, onScreenHook: ep.script?.onScreenHook || "" });
    const d = await res.json();
    if (!res.ok) { out.innerHTML = errorHtml(d); return; }
    ep.script.lines = (d.lines || []).map((l) => ({ ...l, originalSay: l.say }));
    let html = `<div class="sk-section"><h3 class="sk-section-title">B-roll Plan</h3>`;
    (d.lines || []).forEach((l, i) => {
      html += `<div class="sk-beat">
        <p class="sk-beat-say">${esc(l.say || "")}</p>
        <p class="sk-text">Visual: ${esc(l.visual || "")}</p>
        <p class="sk-text">B-roll query: <code>${esc(l.brollQuery || "")}</code> · ${esc(l.placement || "")}</p>
        ${l.brollQuery ? `<button class="copy-btn ss-find-broll" data-q="${esc(l.brollQuery || "")}" data-i="${i}" type="button">Find stock media</button><div class="ss-broll-opts" id="ss-broll-${idx}-${i}"></div>` : ""}
      </div>`;
    });
    html += `</div>`;
    out.innerHTML = html;
    out.querySelectorAll(".ss-find-broll").forEach((b) => b.addEventListener("click", async () => {
      const q = b.dataset.q;
      const optsEl = out.querySelector(`#ss-broll-${idx}-${b.dataset.i}`);
      b.disabled = true; b.textContent = "Searching...";
      try {
        const r = await apiFetch("/api/analyze/broll", { query: q });
        const data = await r.json();
        if (r.ok && (data.options || []).length) {
          optsEl.innerHTML = `<div class="sk-options">${data.options.map((opt) => `
            <div class="sk-option">
              ${opt.type === "video" ? `<video class="sk-preview" src="${esc(opt.url)}" poster="${esc(opt.thumb || "")}" preload="metadata" controls playsinline></video>` : `<img class="sk-preview" src="${esc(opt.thumb || opt.url)}" alt="" loading="lazy" />`}
              <div class="sk-option-info"><span class="sk-option-tag">${esc(opt.source || "")}</span>${opt.credit ? `<span class="sk-option-credit">by ${esc(opt.credit)}</span>` : ""}</div>
              <a class="btn sk-option-dl" href="${esc(opt.url)}" target="_blank" rel="noopener">Use this</a>
            </div>`).join("")}</div>`;
          b.classList.add("hidden");
        } else {
          optsEl.innerHTML = `<p class="sk-text">No stock media found — <a href="https://www.pexels.com/search/videos/${encodeURIComponent(q)}/?orientation=portrait" target="_blank" rel="noopener">search Pexels</a></p>`;
          b.disabled = false; b.textContent = "Retry";
        }
      } catch {
        b.disabled = false; b.textContent = "Find stock media";
      }
    }));
  } catch {
    out.innerHTML = errorHtml({ error: "Could not reach the server." });
  }
}

async function runBgmRecommendations(card, idx, out) {
  updateEpisodeFromForm(currentSeries, idx, card);
  const ep = currentSeries.episodes[idx];
  out.innerHTML = `<div class="loading"><div class="spinner"></div><p>Finding BGM ideas...</p></div>`;
  try {
    const res = await apiFetch("/api/series/bgm", { episode: ep });
    const d = await res.json();
    if (!res.ok) { out.innerHTML = errorHtml(d); return; }
    let html = `<div class="sk-section"><h3 class="sk-section-title">BGM Recommendations</h3>`;
    (d.tracks || []).forEach((t) => {
      html += `<div class="sk-bgm">
        <div class="sk-bgm-head"><strong>${esc(t.name || "")}</strong><span class="sk-badge watch">${esc((t.mood || "").toUpperCase())}</span></div>
        <p class="sk-text">${esc(t.why || "")}</p>
        <p class="sk-meta">Search: "${esc(t.searchQuery || "")}"</p>
      </div>`;
    });
    html += `<button class="copy-btn ss-find-bgm" type="button">Find downloadable tracks</button><div class="ss-bgm-tracks"></div>`;
    html += `</div>`;
    out.innerHTML = html;
    out.querySelector(".ss-find-bgm").addEventListener("click", async (e) => {
      const b = e.currentTarget; b.disabled = true; b.textContent = "Searching free music...";
      const tracksEl = out.querySelector(".ss-bgm-tracks");
      try {
        const r = await apiFetch("/api/analyze/bgm", { items: d.tracks || [] });
        const data = await r.json();
        if (!r.ok) throw new Error();
        tracksEl.innerHTML = (data.items || []).map((m) => `
          <div class="sk-bgm">
            <div class="sk-bgm-head"><strong>${esc(m.name || "")}</strong><span class="sk-badge watch">${esc((m.mood || "").toUpperCase())}</span></div>
            ${(m.tracks || []).length ? `<div class="sk-options">${m.tracks.map((tr) => `
              <div class="sk-option sk-music-option">
                <div class="sk-music-head"><strong>${esc(tr.title || "Untitled")}</strong></div>
                <audio class="sk-audio" src="${esc(tr.url)}" preload="metadata" controls></audio>
                <div class="sk-option-info"><span class="sk-option-credit">by ${esc(tr.artist || "Unknown")}</span><span class="sk-option-credit">${tr.duration ? Math.round(tr.duration) + "s" : ""}</span></div>
                <a class="btn sk-option-dl" href="${esc(tr.url)}" target="_blank" rel="noopener">Download this</a>
              </div>`).join("")}</div>` : `<p class="sk-text">No free tracks found.</p>`}
          </div>`).join("");
        b.classList.add("hidden");
      } catch {
        b.disabled = false; b.textContent = "Find downloadable tracks";
      }
    });
  } catch {
    out.innerHTML = errorHtml({ error: "Could not reach the server." });
  }
}

async function runRepurpose(card, idx, out) {
  updateEpisodeFromForm(currentSeries, idx, card);
  const ep = currentSeries.episodes[idx];
  const format = prompt("Repurpose into? carousel, story, caption, normal post", "caption");
  if (!format || !["carousel", "story", "caption", "normal post"].includes(format)) return;
  out.innerHTML = `<div class="loading"><div class="spinner"></div><p>Repurposing...</p></div>`;
  try {
    const res = await apiFetch("/api/series/repurpose", { source: ep, format });
    const d = await res.json();
    if (!res.ok) { out.innerHTML = errorHtml(d); return; }
    out.innerHTML = `<div class="sk-section"><h3 class="sk-section-title">Repurposed: ${esc(format)}</h3><pre class="script-custom">${esc(JSON.stringify(d.result, null, 2))}</pre></div>`;
  } catch {
    out.innerHTML = errorHtml({ error: "Could not reach the server." });
  }
}

async function runRegenerateEpisode(idx) {
  const s = currentSeries;
  if (!confirm("Regenerate this episode? Current version will be replaced.")) return;
  $("#seriesOutput").insertAdjacentHTML("afterbegin", `<div id="ssRegenLoading" class="status"><div class="spinner"></div><p>Regenerating episode...</p></div>`);
  try {
    const res = await apiFetch("/api/series/regenerate-episode", { series: s, episodeIndex: idx });
    const d = await res.json();
    const loading = $("#ssRegenLoading"); if (loading) loading.remove();
    if (!res.ok) { $("#seriesOutput").insertAdjacentHTML("afterbegin", errorHtml(d)); return; }
    const ep = normalizeSeries({ episodes: [d.episode] }).episodes[0];
    ep.id = s.episodes[idx].id; ep.n = s.episodes[idx].n;
    s.episodes[idx] = ep;
    saveCurrentSeries();
    renderCurrentSeries();
  } catch {
    const loading = $("#ssRegenLoading"); if (loading) loading.remove();
    $("#seriesOutput").insertAdjacentHTML("afterbegin", errorHtml({ error: "Could not reach the server." }));
  }
}

async function addNextEpisode() {
  const s = currentSeries;
  collectSeriesMeta(s);
  $("#seriesOutput").insertAdjacentHTML("afterbegin", `<div id="ssNextLoading" class="status"><div class="spinner"></div><p>Creating next episode...</p></div>`);
  try {
    const res = await apiFetch("/api/series/next-episode", { series: s });
    const d = await res.json();
    const loading = $("#ssNextLoading"); if (loading) loading.remove();
    if (!res.ok) { $("#seriesOutput").insertAdjacentHTML("afterbegin", errorHtml(d)); return; }
    const ep = normalizeSeries({ episodes: [d.episode] }).episodes[0];
    s.episodes.push(ep);
    saveCurrentSeries();
    renderCurrentSeries();
  } catch {
    const loading = $("#ssNextLoading"); if (loading) loading.remove();
    $("#seriesOutput").insertAdjacentHTML("afterbegin", errorHtml({ error: "Could not reach the server." }));
  }
}

async function findGaps() {
  const s = currentSeries;
  collectSeriesMeta(s);
  const out = $("#ssGapsOut");
  out.innerHTML = `<div class="loading"><div class="spinner"></div><p>Finding content gaps...</p></div>`;
  try {
    const res = await apiFetch("/api/series/gaps", { series: s });
    const d = await res.json();
    if (!res.ok) { out.innerHTML = errorHtml(d); return; }
    let html = `<div class="sk-section"><h3 class="sk-section-title">Content Gaps</h3><ul class="sk-list">`;
    (d.gaps || []).forEach((g) => {
      html += `<li><strong>${esc(g.topic || "")}</strong> — ${esc(g.whyItMatters || "")}${g.suggestedEpisodeTitle ? ` <em>(suggested: ${esc(g.suggestedEpisodeTitle)})</em>` : ""}</li>`;
    });
    html += `</ul></div>`;
    out.innerHTML = html;
  } catch {
    out.innerHTML = errorHtml({ error: "Could not reach the server." });
  }
}

async function createSeries() {
  const topic = $("#seriesTopic").value.trim();
  const context = $("#seriesContext").value.trim();
  const count = Math.min(10, Math.max(3, Number($("#seriesCount").value) || 6));
  if (!topic) { $("#seriesCreateStatus").innerHTML = errorHtml({ error: "Enter a series topic first." }); return; }
  $("#seriesCreateStatus").innerHTML = `<div class="loading"><div class="spinner"></div><p>Creating your series...</p></div>`;
  $("#seriesOutput").innerHTML = "";
  try {
    const res = await apiFetch("/api/series/create", { topic, context, episodeCount: count });
    const d = await res.json();
    if (!res.ok) { $("#seriesCreateStatus").innerHTML = errorHtml(d); return; }
    $("#seriesCreateStatus").innerHTML = "";
    currentSeries = normalizeSeries(d, topic, context);
    saveCurrentSeries();
    renderCurrentSeries();
  } catch {
    $("#seriesCreateStatus").innerHTML = errorHtml({ error: "Could not reach the server." });
  }
}

async function discoverIdeas() {
  const topic = $("#seriesDiscoverTopic").value.trim();
  const count = Math.min(10, Math.max(1, Number($("#seriesDiscoverCount").value) || 6));
  $("#seriesDiscoverStatus").innerHTML = `<div class="loading"><div class="spinner"></div><p>Discovering series ideas...</p></div>`;
  $("#seriesOutput").innerHTML = "";
  try {
    const res = await apiFetch("/api/series/ideas", { topic, count });
    const d = await res.json();
    if (!res.ok) { $("#seriesDiscoverStatus").innerHTML = errorHtml(d); return; }
    $("#seriesDiscoverStatus").innerHTML = "";
    renderIdeas(d.ideas || [], { topic });
  } catch {
    $("#seriesDiscoverStatus").innerHTML = errorHtml({ error: "Could not reach the server." });
  }
}

function renderIdeas(ideas, { topic = "", fromHistory = false } = {}) {
  const out = $("#seriesOutput");
  out.innerHTML = `<h3 class="section-title" style="margin-top:18px">Discovered Series Ideas</h3>`;
  ideas.forEach((idea, i) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card-top"><span class="category">${esc(idea.difficulty || "Medium")}</span></div>
      <h3 class="card-title">${esc(idea.title || "")}</h3>
      <div class="rows">
        <div class="row"><span class="k">Core concept</span><p class="v">${esc(idea.coreConcept || "")}</p></div>
        <div class="row"><span class="k">Target audience</span><p class="v">${esc(idea.targetAudience || "")}</p></div>
        <div class="row"><span class="k">Why people may care</span><p class="v">${esc(idea.whyCare || "")}</p></div>
        <div class="row"><span class="k">Suggested episodes</span><p class="v">${esc(idea.suggestedEpisodes || "")}</p></div>
        <div class="row"><span class="k">Content angle</span><p class="v">${esc(idea.contentAngle || "")}</p></div>
        <div class="row"><span class="k">Posting frequency</span><p class="v">${esc(idea.suggestedPostingFrequency || "")}</p></div>
      </div>
      <p class="subtle" style="margin-top:10px">Example Ep 1 hook: ${esc(idea.exampleEpisode1Hook || "")}</p>
      ${(idea.exampleTopics || []).length ? `<ul class="sk-list"><li>${idea.exampleTopics.map((t) => esc(t)).join("</li><li>")}</li></ul>` : ""}
      <div class="carousel-actions" style="margin-top:12px">
        <button class="btn dl-btn ss-create-from-idea" type="button">Create series from this idea</button>
      </div>`;
    card.querySelector(".ss-create-from-idea").addEventListener("click", () => {
      $("#seriesTopic").value = idea.title || "";
      $("#seriesContext").value = `${idea.coreConcept || ""}. Target: ${idea.targetAudience || ""}. Angle: ${idea.contentAngle || ""}`;
      $("#seriesCount").value = Math.min(10, Math.max(3, Number(idea.suggestedEpisodes) || 6));
      switchTab("create");
      createSeries();
    });
    out.appendChild(card);
  });
  if (!fromHistory) {
    upsertSeriesHistory({
      id: `series-ideas-${Date.now()}`,
      kind: "series",
      type: "ideas",
      title: topic ? `Discovered ideas: ${topic}` : "Discovered Series Ideas",
      data: { ideas, topic },
    });
  }
}

async function researchHooks() {
  const topic = $("#seriesResearchTopic").value.trim();
  if (!topic) { $("#seriesResearchStatus").innerHTML = errorHtml({ error: "Enter a topic first." }); return; }
  $("#seriesResearchStatus").innerHTML = `<div class="loading"><div class="spinner"></div><p>Researching viral hooks...</p></div>`;
  $("#seriesOutput").innerHTML = "";
  try {
    const res = await apiFetch("/api/series/research", { topic });
    const d = await res.json();
    if (!res.ok) { $("#seriesResearchStatus").innerHTML = errorHtml(d); return; }
    $("#seriesResearchStatus").innerHTML = d.summary ? `<p class="summary">${esc(d.summary)}</p>` : "";
    renderResearch(d, topic);
  } catch {
    $("#seriesResearchStatus").innerHTML = errorHtml({ error: "Could not reach the server." });
  }
}

function renderResearch(d, topic, { fromHistory = false } = {}) {
  const out = $("#seriesOutput");
  out.innerHTML = "";

  if ((d.hooks || []).length) {
    const sec = document.createElement("div");
    sec.innerHTML = `<h3 class="section-title" style="margin-top:18px">Viral Hooks</h3>`;
    d.hooks.forEach((h) => {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="card-top"><span class="category">${esc(h.structure || "hook")}</span></div>
        <p class="sk-line">${esc(h.hookText || "")}</p>
        <p class="sk-text">${esc(h.whyItWorked || "")}</p>
        ${h.url ? `<p class="subtle"><a href="${esc(h.url)}" target="_blank" rel="noopener">View source</a> · ${esc(h.source || "")}</p>` : `<p class="subtle">${esc(h.source || "")}</p>`}
        <div class="carousel-actions" style="margin-top:12px">
          <button class="copy-btn ss-copy-hook" type="button">Copy hook</button>
          <button class="copy-btn ss-inspire-hook" type="button">Create original hook</button>
        </div>`;
      card.querySelector(".ss-copy-hook").addEventListener("click", (e) => copyText(e, h.hookText || ""));
      card.querySelector(".ss-inspire-hook").addEventListener("click", async (e) => {
        const btn = e.currentTarget; btn.disabled = true; btn.textContent = "Working...";
        try {
          const res = await apiFetch("/api/series/hook-variations", { episode: { title: topic, hook: h.hookText || "", mainTakeaway: "" } });
          const data = await res.json();
          if (!res.ok) { alert(data.error || "Failed"); return; }
          let html = `<div class="sk-section" style="margin-top:12px"><h4 class="sk-section-title">Original hooks inspired by this structure</h4>`;
          (data.variations || []).forEach((v) => {
            html += `<div class="sk-block"><p class="sk-line">${esc(v.hook || "")}</p><p class="sk-text">${esc(v.why || "")}</p></div>`;
          });
          html += `</div>`;
          card.insertAdjacentHTML("beforeend", html);
        } finally { btn.disabled = false; btn.textContent = "Create original hook"; }
      });
      sec.appendChild(card);
    });
    out.appendChild(sec);
  }

  if ((d.reels || []).length) {
    const sec = document.createElement("div");
    sec.innerHTML = `<h3 class="section-title" style="margin-top:18px">Successful Reels</h3>`;
    d.reels.forEach((r) => {
      const card = document.createElement("div");
      card.className = "card";
      const scriptText = scriptToText(r.script || {}, r.title || "Reel");
      card.innerHTML = `
        <div class="card-top"><span class="category">reference reel</span></div>
        <h3 class="card-title">${esc(r.title || "")}</h3>
        <p class="subtle">Structure: ${esc(r.structure || "")}</p>
        <p class="sk-text">CTA: ${esc(r.cta || "")}</p>
        ${r.sourceUrl ? `<p class="subtle"><a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">View source Reel</a></p>` : ""}
        <div class="carousel-actions" style="margin-top:12px">
          <button class="copy-btn ss-copy-script" type="button">Copy source script</button>
          <button class="copy-btn ss-original-script" type="button">Create original version</button>
        </div>
        <div class="ss-original-out"></div>`;
      card.querySelector(".ss-copy-script").addEventListener("click", (e) => copyText(e, scriptText));
      card.querySelector(".ss-original-script").addEventListener("click", async (e) => {
        const btn = e.currentTarget; btn.disabled = true; btn.textContent = "Working...";
        const outEl = card.querySelector(".ss-original-out");
        try {
          const analysis = {
            coreIdea: r.title || "",
            structure: r.structure || "",
            mainPoints: Array.isArray(r.keyPoints) ? r.keyPoints : [],
            cta: { text: r.cta || "" },
            url: r.sourceUrl || ""
          };
          const res = await apiFetch("/api/analyze/original", { analysis, script: scriptText });
          const data = await res.json();
          if (!res.ok) { outEl.innerHTML = errorHtml(data); return; }
          const sc = { durationSeconds: data.durationSeconds, hook: data.hook, onScreenHook: data.onScreenHook, lines: data.lines, caption: data.caption, hashtags: data.hashtags };
          outEl.innerHTML = "";
          const wrap = document.createElement("div");
          wrap.className = "sk-section";
          wrap.innerHTML = `<h4 class="sk-section-title">Your original version</h4><p class="sk-text">${esc(data.whatsDifferent || "")}</p><div class="ss-orig-script"></div>`;
          wrap.querySelector(".ss-orig-script").appendChild(buildScriptEl(sc, { label: "Original version", title: r.title || "Reel" }));
          outEl.appendChild(wrap);
        } catch {
          outEl.innerHTML = errorHtml({ error: "Could not reach the server." });
        } finally { btn.disabled = false; btn.textContent = "Create original version"; }
      });
      sec.appendChild(card);
    });
    out.appendChild(sec);
  }
  if (!fromHistory) {
    upsertSeriesHistory({
      id: `series-research-${Date.now()}`,
      kind: "series",
      type: "research",
      title: topic,
      data: { ...d, topic },
    });
  }
}

async function analyzeReel() {
  const url = $("#seriesAnalyzeUrl").value.trim();
  if (!url && !analyzeUploadId) { $("#seriesAnalyzeStatus").innerHTML = errorHtml({ error: "Paste a Reel URL or upload the video file." }); return; }
  $("#seriesAnalyzeStatus").innerHTML = `<div class="loading"><div class="spinner"></div><p id="ssAnalyzeStep">Starting...</p></div>`;
  $("#seriesAnalyzeOutput").innerHTML = "";
  try {
    const res = await apiFetch("/api/analyze", { url: url || undefined, uploadId: analyzeUploadId || undefined });
    const d = await res.json();
    if (!res.ok) { $("#seriesAnalyzeStatus").innerHTML = errorHtml(d); return; }
    if (d.result) { $("#seriesAnalyzeStatus").innerHTML = ""; renderAnalyzeResult(d.result); return; }
    pollAnalyze(d.id);
  } catch {
    $("#seriesAnalyzeStatus").innerHTML = errorHtml({ error: "Could not reach the server." });
  }
}

function pollAnalyze(id) {
  clearInterval(analyzePoll);
  analyzePoll = setInterval(async () => {
    try {
      const res = await fetch(`/api/analyze/${id}/status`);
      const d = await res.json();
      const stepEl = $("#ssAnalyzeStep"); if (stepEl) stepEl.textContent = d.step || "Working...";
      if (!res.ok) { clearInterval(analyzePoll); $("#seriesAnalyzeStatus").innerHTML = errorHtml(d); return; }
      if (d.status === "done") {
        clearInterval(analyzePoll);
        $("#seriesAnalyzeStatus").innerHTML = "";
        renderAnalyzeResult(d.result);
      } else if (d.status === "failed") {
        clearInterval(analyzePoll);
        $("#seriesAnalyzeStatus").innerHTML = errorHtml({ error: d.error || "Analysis failed." });
      }
    } catch {}
  }, 2000);
}

function renderAnalyzeResult(r, { fromHistory = false } = {}) {
  const out = $("#seriesAnalyzeOutput");
  out.innerHTML = `<div class="card"><h3 class="card-title">${esc(r.title || "Analyzed Reel")}</h3>
    <p class="subtle">${esc(r.coreIdea || "")}</p>
    <p class="sk-text">Hook: ${esc(r.hook?.text || "")}</p>
    <p class="sk-text">CTA: ${esc(r.cta?.text || "")}</p>
    <pre class="script-custom">${esc((r.segments || []).map((s) => s.text).join("\n"))}</pre>
  </div>`;
  if (!fromHistory) {
    upsertSeriesHistory({
      id: `series-analyze-${Date.now()}`,
      kind: "series",
      type: "analyze",
      title: r.title || "Analyzed Reel",
      data: r,
    });
  }
}

function switchTab(tab) {
  document.querySelectorAll(".series-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  ["create", "discover", "research", "analyze"].forEach((t) => showHide(`seriesPanel${cap(t)}`, t === tab));
  $("#seriesOutput").innerHTML = "";
}

function cap(s) { return s[0].toUpperCase() + s.slice(1); }
function showHide(id, showIt) { const el = document.getElementById(id); if (!el) return; if (showIt) show(el); else hide(el); }

function init() {
  if (!window.ReelStudioShared) {
    $("#seriesOutput").innerHTML = `<p class="notice">Series Studio needs the latest app files. Please hard-refresh the page (Ctrl/Cmd + Shift + R).</p>`;
    return;
  }
  loadLibraryCache();
  renderLibrary();

  document.querySelectorAll(".series-tab").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));

  $("#seriesCreateBtn").addEventListener("click", createSeries);
  $("#seriesDiscoverBtn").addEventListener("click", discoverIdeas);
  $("#seriesResearchBtn").addEventListener("click", researchHooks);
  $("#seriesAnalyzeBtn").addEventListener("click", analyzeReel);
  $("#seriesAnalyzeUploadBtn").addEventListener("click", () => $("#seriesAnalyzeFile").click());
  $("#seriesAnalyzeFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    $("#seriesAnalyzeFileName").textContent = `uploading ${file.name}...`;
    const fd = new FormData();
    fd.append("video", file);
    try {
      const res = await fetch("/api/reel/upload", { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) { $("#seriesAnalyzeFileName").textContent = ""; $("#seriesAnalyzeStatus").innerHTML = errorHtml(d); return; }
      analyzeUploadId = d.id;
      $("#seriesAnalyzeFileName").textContent = `✓ ${file.name}`;
    } catch {
      $("#seriesAnalyzeFileName").textContent = "";
      $("#seriesAnalyzeStatus").innerHTML = errorHtml({ error: "Upload failed." });
    }
  });
}

window.SeriesStudio = {
  onViewOpened: refreshLibrary,
  init,
  switchTab,
  openSeries,
  renderIdeas,
  renderResearch,
  renderAnalyzeResult,
};

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();

})();
