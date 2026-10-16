// Faceless Typography Reel — backend.
// Turns a topic or a full script into a kinetic-typography scene plan, then
// resolves REAL background photos/textures (Pexels/Pixabay), transparent graphic
// overlays (Iconify, keyless), and retention BGM (Free To Use, no key) — all free.
import { generateJson } from "../gemini.js";
import { buildTypographyPrompt, buildTypographyScenePrompt, DEFAULT_NICHE } from "../prompt.js";
import { searchBrollOptions, searchMusicOptions, searchOverlayOptions, mediaConfig } from "../media.js";

const FONTS = new Set(["anton", "montserrat", "poppins", "bebas"]);
const ANIMS = new Set(["word-pop", "slide-up", "typewriter", "karaoke", "scale-bounce", "fade-stack"]);
const TRANSITIONS = new Set(["cut", "fade", "slide", "zoom"]);

const hex = (v, fallback) => (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(v || "")) ? v : fallback);
const clampDur = (d) => Math.max(1.5, Math.min(6, Number(d) || 3));

function normalizeScene(raw, i) {
  const s = raw && typeof raw === "object" ? raw : {};
  const text = String(s.text || "").trim();
  return {
    id: s.id || i + 1,
    part: String(s.part || "value").toLowerCase(),
    text,
    emphasisWords: Array.isArray(s.emphasisWords) ? s.emphasisWords.filter(Boolean).map(String) : [],
    animation: ANIMS.has(s.animation) ? s.animation : "word-pop",
    layout: ["center", "stacked", "left"].includes(s.layout) ? s.layout : "center",
    durationSeconds: clampDur(s.durationSeconds),
    transition: TRANSITIONS.has(s.transition) ? s.transition : "fade",
    bgStyle: ["solid", "gradient", "image"].includes(s.bgStyle) ? s.bgStyle : "gradient",
    visualQuery: String(s.visualQuery || "").trim(),
    visualMood: ["dark", "bright", "minimal"].includes(s.visualMood) ? s.visualMood : "dark",
    overlay: s.overlay && s.overlay.query && s.overlay.kind && s.overlay.kind !== "none"
      ? { kind: String(s.overlay.kind), query: String(s.overlay.query), label: String(s.overlay.label || "") }
      : null,
  };
}

function normalizePlan(plan, fallbackTitle = "Typography Reel") {
  const theme = plan.theme || {};
  const scenes = (Array.isArray(plan.scenes) ? plan.scenes : []).map(normalizeScene).filter((s) => s.text);
  return {
    title: plan.title || fallbackTitle,
    estimatedDurationSeconds: Math.round(scenes.reduce((a, s) => a + s.durationSeconds, 0)) || plan.estimatedDurationSeconds || 30,
    theme: {
      name: theme.name || "bold dark",
      bg: hex(theme.bg, "#0b0b14"),
      accent: hex(theme.accent, "#ffd400"),
      text: hex(theme.text, "#ffffff"),
      font: FONTS.has(theme.font) ? theme.font : "anton",
    },
    hook: plan.hook || (scenes[0] && scenes[0].text) || "",
    voiceoverScript: String(plan.voiceoverScript || scenes.map((s) => s.text).join(" ")),
    scenes,
    bgm: Array.isArray(plan.bgm) ? plan.bgm.slice(0, 2) : [],
    captions: {
      caption: plan.captions?.caption || "",
      hashtags: Array.isArray(plan.captions?.hashtags) ? plan.captions.hashtags : [],
    },
    cta: plan.cta || "",
  };
}

// Resolve one scene's background image + overlay (free sources, best-effort).
async function resolveSceneMedia(scene) {
  const jobs = [];
  if (scene.bgStyle === "image" && scene.visualQuery) {
    jobs.push(
      searchBrollOptions(scene.visualQuery, "image", 4)
        .then((opts) => {
          scene.visual = { query: scene.visualQuery, options: opts };
          if (opts[0]) scene.visual.url = opts[0].url;
        })
        .catch((e) => { console.warn(`typography bg "${scene.visualQuery}" skipped: ${e.message}`); })
    );
  }
  if (scene.overlay?.query) {
    jobs.push(
      searchOverlayOptions(scene.overlay.query, { kind: scene.overlay.kind, limit: 5 })
        .then((opts) => {
          scene.overlay.options = opts;
          if (opts[0]) scene.overlay.url = opts[0].url;
        })
        .catch((e) => { console.warn(`typography overlay "${scene.overlay.query}" skipped: ${e.message}`); })
    );
  }
  await Promise.all(jobs);
  return scene;
}

async function resolveBgm(plan) {
  const jobs = (plan.bgm || []).map(async (m) => {
    const query = m.searchQuery || m.name || m.mood || "background music";
    const fallbacks = [
      m.mood && `${m.mood} instrumental`,
      m.energyLevel === "high" ? "energetic upbeat instrumental" : m.energyLevel === "low" ? "ambient chill instrumental" : "background music instrumental",
      "background music",
    ].filter(Boolean);
    try {
      const tracks = await searchMusicOptions(query, { limit: 4, fallbacks });
      m.options = tracks;
      if (tracks[0]) { m.trackUrl = tracks[0].url; m.title = tracks[0].title; m.artist = tracks[0].artist; m.duration = tracks[0].duration; }
    } catch (e) {
      console.warn(`typography bgm "${query}" skipped: ${e.message}`);
    }
  });
  await Promise.all(jobs);
}

export async function resolveTypographyMedia(plan) {
  await Promise.all([...plan.scenes.map(resolveSceneMedia), resolveBgm(plan)]);
  plan.media = mediaConfig();
  return plan;
}

export async function generateTypographyReel({ input, isScript = false, niche = DEFAULT_NICHE }) {
  const raw = await generateJson(buildTypographyPrompt({ input, isScript, niche }));
  const plan = normalizePlan(raw, isScript ? "Typography Reel" : input.slice(0, 60));
  if (!plan.scenes.length) {
    const err = new Error("The model returned no usable scenes — try rephrasing the topic/script.");
    err.code = "NO_SCENES";
    throw err;
  }
  await resolveTypographyMedia(plan);
  return plan;
}

export async function regenerateTypographyScene({ plan = {}, scene = {}, instruction = "", niche = DEFAULT_NICHE }) {
  const raw = await generateJson(buildTypographyScenePrompt({ plan, scene, instruction, niche }));
  const next = normalizeScene({ ...raw, id: scene.id }, (scene.id || 1) - 1);
  if (!next.text) {
    const err = new Error("Scene regeneration returned no text.");
    err.code = "NO_SCENE";
    throw err;
  }
  await resolveSceneMedia(next);
  return next;
}
