// Faceless Typography Reel — UI module.
// Generate a kinetic-typography Reel from a topic/script, edit scenes live,
// preview with synced BGM/voiceover, and export a 9:16 MP4. Reuses the shared
// render engine (typographyRender.js) and the app's shared helpers.
(function () {
  "use strict";
  const S = window.ReelStudioShared || {};
  const esc = S.esc || ((s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));
  const errorHtml = S.errorHtml || ((d) => `<p class="big">⚠️ ${esc(d.error || "Something went wrong")}</p>`);
  const $ = (sel) => document.querySelector(sel);

  const ANIMS = ["word-pop", "slide-up", "typewriter", "karaoke", "scale-bounce", "fade-stack"];
  const TRANS = ["cut", "fade", "slide", "zoom"];
  const BGS = ["solid", "gradient", "image"];
  const FONTS = ["anton", "bebas", "montserrat", "poppins"];

  let TR = null;            // render engine module
  let plan = null;          // current scene plan (loaded images live on each scene)
  let mode = "topic";
  let inited = false;

  // preview player state
  const pv = { playing: false, t: 0, raf: 0, last: 0, total: 0 };
  // audio state (shared by preview + export)
  const audio = { actx: null, bgmBuffer: null, bgmUrl: null, voiceBuffer: null, voiceUrl: null, bgmSrc: null, voiceSrc: null };

  async function engine() { if (!TR) TR = await import("./typographyRender.js?v=1"); return TR; }
  const actx = () => (audio.actx ||= new (window.AudioContext || window.webkitAudioContext)());

  /* ---------------- generation ---------------- */
  async function generate() {
    const input = $("#tgInput").value.trim();
    if (!input) { $("#tgStatus").innerHTML = errorHtml({ error: mode === "topic" ? "Enter a topic first." : "Paste your script first." }); return; }
    const btn = $("#tgGenerateBtn"); btn.disabled = true;
    $("#tgStatus").innerHTML = `<div class="loading"><div class="spinner"></div><p>Writing your typography Reel + fetching visuals…</p></div>`;
    try {
      const res = await fetch("/api/typography/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input, isScript: mode === "script" }),
      });
      const data = await res.json();
      if (!res.ok) { $("#tgStatus").innerHTML = errorHtml(data); return; }
      plan = data;
      $("#tgStatus").innerHTML = "";
      await openStudio();
    } catch (e) {
      $("#tgStatus").innerHTML = errorHtml({ error: "Could not reach the server." });
    } finally { btn.disabled = false; }
  }

  async function openStudio() {
    $("#tgStudio").classList.remove("hidden");
    const TRm = await engine();
    await TRm.ensureFonts();
    audio.bgmUrl = plan.bgm?.[0]?.trackUrl || null;
    audio.bgmBuffer = null;
    renderMeta();
    renderScenes();
    renderBgmPicker();
    renderCaption();
    recomputeTotal();
    await TRm.preloadAssets(plan); // attaches _bgImg / _ovlImg onto each scene
    seekTo(0);
    $("#tgStudio").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function recomputeTotal() { pv.total = TR.sceneTimes(plan).total; $("#tgSeek").max = Math.max(1, Math.round(pv.total * 100)); updateTime(); }

  /* ---------------- meta / theme ---------------- */
  function renderMeta() {
    $("#tgTitle").textContent = plan.title || "Typography Reel";
    const n = plan.scenes.length;
    $("#tgMeta").textContent = `~${Math.round(plan.estimatedDurationSeconds || 0)}s · ${n} scenes`;
    const th = plan.theme || {};
    $("#tgTheme").innerHTML = `
      <span class="tg-theme-name">🎨 ${esc(th.name || "theme")}</span>
      <label class="tg-swatch" title="Background"><input type="color" data-k="bg" value="${esc(th.bg || "#0b0b14")}"><span>BG</span></label>
      <label class="tg-swatch" title="Accent"><input type="color" data-k="accent" value="${esc(th.accent || "#ffd400")}"><span>Accent</span></label>
      <label class="tg-swatch" title="Text"><input type="color" data-k="text" value="${esc(th.text || "#ffffff")}"><span>Text</span></label>
      <select class="tg-font" title="Font">${FONTS.map((f) => `<option value="${f}" ${th.font === f ? "selected" : ""}>${f}</option>`).join("")}</select>`;
    $("#tgTheme").querySelectorAll("input[type=color]").forEach((inp) => inp.addEventListener("input", () => {
      plan.theme[inp.dataset.k] = inp.value; redraw();
    }));
    $("#tgTheme").querySelector(".tg-font").addEventListener("change", (e) => { plan.theme.font = e.target.value; bustLayout(); redraw(); });
  }

  function renderCaption() {
    const c = plan.captions || {};
    $("#tgCaptionBlock").innerHTML = `
      <span class="k">Caption</span>
      <p>${esc(c.caption || "")}</p>
      <p class="s-hashtags">${esc((c.hashtags || []).join("  "))}</p>
      <button class="copy-btn" id="tgCapCopy" type="button">📋 Copy caption</button>`;
    $("#tgCapCopy").addEventListener("click", () => {
      const txt = `${c.caption || ""}\n\n${(c.hashtags || []).join(" ")}`.trim();
      (S.copyText ? S.copyText(txt) : navigator.clipboard.writeText(txt));
      $("#tgCapCopy").textContent = "✓ Copied";
      setTimeout(() => ($("#tgCapCopy").textContent = "📋 Copy caption"), 1500);
    });
  }

  /* ---------------- scene editor ---------------- */
  function renderScenes() {
    const wrap = $("#tgScenes");
    wrap.innerHTML = plan.scenes.map((s, i) => sceneCardHtml(s, i)).join("");
    plan.scenes.forEach((s, i) => bindScene(wrap.children[i], i));
  }

  function sceneCardHtml(s, i) {
    const vis = s.visual || {};
    return `
    <div class="tg-scene" data-i="${i}">
      <div class="tg-scene-head">
        <span class="beat-part ${(s.part || "").toLowerCase()}">${esc(s.part || "scene")}</span>
        <span class="subtle">#${i + 1} · ${(s.durationSeconds || 3).toFixed(1)}s</span>
        <div class="tg-scene-tools">
          <button class="icon-btn tg-sc-jump" title="Preview this scene" type="button">▶</button>
          <button class="icon-btn tg-sc-regen" title="Regenerate scene" type="button">↻</button>
          <button class="icon-btn tg-sc-del" title="Delete scene" type="button">✕</button>
        </div>
      </div>
      <textarea class="script-ta tg-sc-text" rows="2" placeholder="Scene text">${esc(s.text || "")}</textarea>
      <input class="gen-input tg-sc-emph" type="text" placeholder="Highlight words (space/comma separated)" value="${esc((s.emphasisWords || []).join(" "))}" />
      <div class="tg-sc-row">
        <select class="tg-sc-anim" title="Animation">${ANIMS.map((a) => `<option ${s.animation === a ? "selected" : ""}>${a}</option>`).join("")}</select>
        <select class="tg-sc-trans" title="Transition">${TRANS.map((a) => `<option ${s.transition === a ? "selected" : ""}>${a}</option>`).join("")}</select>
        <select class="tg-sc-bg" title="Background">${BGS.map((a) => `<option ${s.bgStyle === a ? "selected" : ""}>${a}</option>`).join("")}</select>
        <input class="tg-sc-dur" type="number" min="1.5" max="6" step="0.1" value="${(s.durationSeconds || 3).toFixed(1)}" title="Duration (s)" />
      </div>
      <div class="tg-sc-visual">
        ${vis.url ? `<img class="tg-sc-thumb" src="${esc((vis.options && vis.options[0] && vis.options[0].thumb) || vis.url)}" alt="" />` : `<span class="subtle tg-sc-novis">No background image</span>`}
        <input class="gen-input tg-sc-vq" type="text" placeholder="Background search (real photo/texture)" value="${esc(vis.query || s.visualQuery || "")}" />
        <button class="copy-btn tg-sc-find" type="button">🔎 Find</button>
      </div>
      <div class="tg-sc-opts"></div>
      ${s.overlay ? `<p class="subtle tg-sc-ovl">✨ Overlay: ${esc(s.overlay.query || "")}${s.overlay.label ? ` · “${esc(s.overlay.label)}”` : ""}${s.overlay.url ? "" : " (not found)"}</p>` : ""}
    </div>`;
  }

  function bindScene(el, i) {
    const get = () => plan.scenes[i];
    const commit = (changes, { relayout = false, redrawNow = true } = {}) => {
      plan.scenes[i] = { ...plan.scenes[i], ...changes }; // new ref -> busts layout cache
      if (changes.durationSeconds != null) recomputeTotal();
      if (redrawNow) redraw();
    };
    el.querySelector(".tg-sc-text").addEventListener("input", (e) => commit({ text: e.target.value }));
    el.querySelector(".tg-sc-emph").addEventListener("input", (e) => commit({ emphasisWords: e.target.value.split(/[\s,]+/).filter(Boolean) }));
    el.querySelector(".tg-sc-anim").addEventListener("change", (e) => commit({ animation: e.target.value }));
    el.querySelector(".tg-sc-trans").addEventListener("change", (e) => commit({ transition: e.target.value }));
    el.querySelector(".tg-sc-bg").addEventListener("change", (e) => commit({ bgStyle: e.target.value }));
    el.querySelector(".tg-sc-dur").addEventListener("change", (e) => {
      const d = Math.max(1.5, Math.min(6, parseFloat(e.target.value) || 3));
      commit({ durationSeconds: d });
    });
    el.querySelector(".tg-sc-jump").addEventListener("click", () => { const t = TR.sceneTimes(plan).times[i]; seekTo(t ? t.start + 0.02 : 0); play(); });
    el.querySelector(".tg-sc-del").addEventListener("click", () => {
      if (plan.scenes.length <= 1) return;
      plan.scenes.splice(i, 1); renderScenes(); recomputeTotal(); seekTo(0);
    });
    el.querySelector(".tg-sc-regen").addEventListener("click", () => regenScene(i, el));
    el.querySelector(".tg-sc-find").addEventListener("click", () => findVisual(i, el));
  }

  async function findVisual(i, el) {
    const q = el.querySelector(".tg-sc-vq").value.trim();
    if (!q) return;
    const optsEl = el.querySelector(".tg-sc-opts");
    const btn = el.querySelector(".tg-sc-find");
    btn.disabled = true; btn.textContent = "…";
    optsEl.innerHTML = `<p class="subtle">Searching real photos…</p>`;
    try {
      const res = await fetch("/api/analyze/broll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q, media: "image" }) });
      const data = await res.json();
      const imgs = (data.options || []).filter((o) => o.type === "image");
      if (imgs.length) {
        optsEl.innerHTML = `<div class="tg-opt-grid">${imgs.map((o, k) => `<img class="tg-opt" data-k="${k}" src="${esc(o.thumb || o.url)}" alt="" />`).join("")}</div>`;
        optsEl.querySelectorAll(".tg-opt").forEach((im) => im.addEventListener("click", async () => {
          const pick = imgs[+im.dataset.k];
          plan.scenes[i] = { ...plan.scenes[i], bgStyle: "image", visualQuery: q, visual: { query: q, url: pick.url, options: imgs }, _bgImg: null, _bgImgUrl: null };
          const TRm = await engine();
          await TRm.preloadAssets({ scenes: [plan.scenes[i]] });
          renderScenes(); redraw();
        }));
      } else optsEl.innerHTML = `<p class="subtle">No photos found — try different words.</p>`;
    } catch { optsEl.innerHTML = `<p class="subtle">Search failed.</p>`; }
    finally { btn.disabled = false; btn.textContent = "🔎 Find"; }
  }

  async function regenScene(i, el) {
    const instruction = prompt("How should this scene change? (optional)") || "";
    const btn = el.querySelector(".tg-sc-regen"); btn.disabled = true; btn.textContent = "…";
    try {
      const res = await fetch("/api/typography/scene", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: lightPlan(), scene: plan.scenes[i], instruction }),
      });
      const data = await res.json();
      if (res.ok && data.scene) {
        plan.scenes[i] = data.scene;
        const TRm = await engine();
        await TRm.preloadAssets({ scenes: [data.scene] });
        renderScenes(); recomputeTotal(); redraw();
      }
    } catch {} finally { btn.disabled = false; btn.textContent = "↻"; }
  }
  const lightPlan = () => ({ title: plan.title, theme: plan.theme, scenes: plan.scenes.map((s) => ({ id: s.id, part: s.part, text: s.text })) });

  /* ---------------- bgm picker ---------------- */
  function renderBgmPicker() {
    const tracks = [];
    (plan.bgm || []).forEach((m) => (m.options || []).forEach((o) => { if (!tracks.some((t) => t.url === o.url)) tracks.push(o); }));
    if (!tracks.length) { $("#tgBgmPick").innerHTML = `<p class="subtle">🎵 No free BGM found — add a PEXELS key or try again. The Reel will export silent.</p>`; return; }
    $("#tgBgmPick").innerHTML = `<span class="k">🎵 Background music</span>
      <div class="tg-bgm-list">${tracks.map((t, k) => `
        <label class="tg-bgm-item ${t.url === audio.bgmUrl ? "sel" : ""}">
          <input type="radio" name="tgbgm" value="${esc(t.url)}" data-k="${k}" ${t.url === audio.bgmUrl ? "checked" : ""}/>
          <span class="tg-bgm-title">${esc(t.title || "Track")}</span>
          <span class="subtle">${esc(t.artist || "")}</span>
          <audio src="${esc(t.url)}" preload="none" controls></audio>
        </label>`).join("")}</div>`;
    $("#tgBgmPick").querySelectorAll("input[name=tgbgm]").forEach((r) => r.addEventListener("change", () => {
      audio.bgmUrl = r.value; audio.bgmBuffer = null;
      $("#tgBgmPick").querySelectorAll(".tg-bgm-item").forEach((it) => it.classList.toggle("sel", it.contains(r)));
    }));
  }

  /* ---------------- preview player ---------------- */
  function ctx2d() { return $("#tgCanvas").getContext("2d", { alpha: false }); }
  // Clone scenes to bust the render's layout cache; spread copies the attached
  // _bgImg/_ovlImg so loaded visuals survive the clone.
  function bustLayout() { plan.scenes = plan.scenes.map((s) => ({ ...s })); }

  function redraw() { if (!plan || !TR) return; TR.drawReelFrame(ctx2d(), plan, null, pv.t, drawOpts()); }
  function drawOpts() { return { captions: $("#tgCaptions").checked, _tl: TR.sceneTimes(plan) }; }

  function updateTime() { $("#tgTime").textContent = `${pv.t.toFixed(1)}s / ${pv.total.toFixed(1)}s`; $("#tgSeek").value = Math.round(pv.t * 100); }

  function seekTo(t) {
    stopAudio();
    pv.t = Math.max(0, Math.min(pv.total, t));
    updateTime(); redraw();
  }

  function play() {
    if (pv.playing || !plan) return;
    if (pv.t >= pv.total - 0.05) pv.t = 0;
    pv.playing = true; pv.last = performance.now();
    $("#tgPlay").textContent = "⏸ Pause";
    startAudio(pv.t);
    const loop = (now) => {
      if (!pv.playing) return;
      const dt = (now - pv.last) / 1000; pv.last = now;
      pv.t += dt;
      if (pv.t >= pv.total) { pv.t = pv.total; pause(); redraw(); updateTime(); return; }
      redraw(); updateTime();
      pv.raf = requestAnimationFrame(loop);
    };
    pv.raf = requestAnimationFrame(loop);
  }
  function pause() { pv.playing = false; cancelAnimationFrame(pv.raf); $("#tgPlay").textContent = "▶ Play"; stopAudio(); }
  function togglePlay() { pv.playing ? pause() : play(); }

  /* ---------------- preview audio ---------------- */
  async function ensureBgmBuffer() {
    if (!audio.bgmUrl || !$("#tgBgmOn").checked) return null;
    if (audio.bgmBuffer) return audio.bgmBuffer;
    try { audio.bgmBuffer = await TR.loadAudioBuffer(actx(), audio.bgmUrl); } catch (e) { console.warn("bgm load", e.message); audio.bgmBuffer = null; }
    return audio.bgmBuffer;
  }
  async function startAudio(fromT) {
    try {
      await actx().resume?.();
      const bgm = await ensureBgmBuffer();
      if (bgm && $("#tgBgmOn").checked) {
        const src = actx().createBufferSource(); src.buffer = bgm; src.loop = true;
        const g = actx().createGain(); g.gain.value = ($("#tgBgmVol").value || 55) / 100;
        src.connect(g).connect(actx().destination);
        src.start(0, fromT % (bgm.duration || 1)); audio.bgmSrc = src;
      }
      if ($("#tgVoiceOn").checked && audio.voiceBuffer) {
        const src = actx().createBufferSource(); src.buffer = audio.voiceBuffer;
        const g = actx().createGain(); g.gain.value = ($("#tgVoiceVol").value || 100) / 100;
        src.connect(g).connect(actx().destination);
        if (fromT < audio.voiceBuffer.duration) src.start(0, fromT); audio.voiceSrc = src;
      }
    } catch (e) { console.warn("preview audio:", e.message); }
  }
  function stopAudio() { try { audio.bgmSrc?.stop(); } catch {} try { audio.voiceSrc?.stop(); } catch {} audio.bgmSrc = audio.voiceSrc = null; }

  /* ---------------- voiceover controls ---------------- */
  function previewTts() {
    if (!window.speechSynthesis) { alert("Your browser has no speech synthesis."); return; }
    const text = plan?.voiceoverScript || plan?.scenes?.map((s) => s.text).join(". ") || "";
    if (!text) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1; u.pitch = 1;
    window.speechSynthesis.speak(u);
  }
  async function onVoiceFile(file) {
    if (!file) return;
    $("#tgVoiceName").textContent = file.name;
    audio.voiceUrl = URL.createObjectURL(file);
    $("#tgVoiceOn").checked = true; $("#tgVoicePanel").classList.remove("hidden");
    try { audio.voiceBuffer = await TR.loadAudioBuffer(actx(), audio.voiceUrl); } catch (e) { audio.voiceBuffer = null; alert("Could not read that audio file."); }
  }

  /* ---------------- export ---------------- */
  async function doExport() {
    if (!plan) return;
    pause();
    const btn = $("#tgExportBtn"); btn.disabled = true;
    const st = $("#tgExportStatus");
    st.innerHTML = `<div class="loading"><div class="spinner"></div><p id="tgExpStep">Preparing…</p></div>`;
    $("#tgDownload").classList.add("hidden");
    try {
      const TRm = await engine();
      await TRm.preloadAssets(plan); // make sure all current visuals are loaded onto scenes
      let bgmBuffer = null, voiceBuffer = null;
      if ($("#tgBgmOn").checked && audio.bgmUrl) { try { bgmBuffer = await TRm.loadAudioBuffer(actx(), audio.bgmUrl); } catch {} }
      if ($("#tgVoiceOn").checked && audio.voiceUrl) { try { voiceBuffer = audio.voiceBuffer || await TRm.loadAudioBuffer(actx(), audio.voiceUrl); } catch {} }
      const out = await TRm.exportReel({
        plan, bgmBuffer, voiceBuffer,
        controls: {
          captions: $("#tgCaptions").checked,
          bgmOn: $("#tgBgmOn").checked, bgmVol: +$("#tgBgmVol").value,
          voiceOn: $("#tgVoiceOn").checked, voiceVol: +$("#tgVoiceVol").value,
        },
        onProgress: (p, label) => { const el = $("#tgExpStep"); if (el) el.textContent = label || `Rendering… ${Math.round(p * 100)}%`; },
      });
      const url = URL.createObjectURL(out.blob);
      const dl = $("#tgDownload");
      dl.href = url; dl.download = `typography-reel.${out.ext}`;
      dl.classList.remove("hidden");
      const note = out.ext === "mp4" ? "" : " (WebM — your browser can't make MP4; it still uploads from most phones, or convert it free.)";
      st.innerHTML = `<div class="notice ok">✅ Reel ready — ${Math.round(pv.total)}s.${note}</div>`;
    } catch (e) {
      st.innerHTML = errorHtml({ error: e.message || "Export failed. Use the latest Chrome/Edge." });
    } finally { btn.disabled = false; }
  }

  /* ---------------- init ---------------- */
  function setMode(m) {
    mode = m;
    document.querySelectorAll(".tg-mode-btn").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
    $("#tgInputLabel").textContent = m === "topic" ? "Topic" : "Your full script";
    $("#tgInput").placeholder = m === "topic" ? "e.g. 3 habits that quietly ruin your focus" : "Paste your complete script here…";
    $("#tgInput").rows = m === "topic" ? 4 : 8;
  }

  function init() {
    if (inited) return; inited = true;
    document.querySelectorAll(".tg-mode-btn").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
    $("#tgGenerateBtn").addEventListener("click", generate);
    $("#tgPlay").addEventListener("click", togglePlay);
    $("#tgSeek").addEventListener("input", (e) => { pause(); pv.t = (+e.target.value) / 100; updateTime(); redraw(); });
    $("#tgCaptions").addEventListener("change", redraw);
    $("#tgVoiceOn").addEventListener("change", () => $("#tgVoicePanel").classList.toggle("hidden", !$("#tgVoiceOn").checked));
    $("#tgTtsPreview").addEventListener("click", previewTts);
    $("#tgVoiceUploadBtn").addEventListener("click", () => $("#tgVoiceFile").click());
    $("#tgVoiceFile").addEventListener("change", (e) => onVoiceFile(e.target.files[0]));
    $("#tgExportBtn").addEventListener("click", doExport);
    $("#tgRegenAll").addEventListener("click", () => { if (plan) { $("#tgInput").value = $("#tgInput").value || (plan.title || ""); generate(); } });
    setMode("topic");
  }

  window.TypographyReel = { onViewOpened: init };
  if (document.readyState !== "loading") init(); else document.addEventListener("DOMContentLoaded", init);
})();
