// CAROUSEL workflow — Phase 1: single on-demand carousel for a given topic.
// Reuses the SAME slide schema + rendering pipeline as the existing Carousels
// page (buildCarouselCard / slideCanvas / /api/slide-image on the client), so
// downloads, IG share, and slide photos work identically. No duplicate logic.
import { generateJson } from "../gemini.js";
import { CAROUSEL_SCHEMA, CAROUSEL_HOOK_GUIDE } from "../prompt.js";

export const meta = {
  id: "carousel",
  label: "Carousel",
  // matches the existing carousel card renderer — payload is { carousels: [c] }
  kind: "carousel",
};

const SINGLE_CAROUSEL_SCHEMA = CAROUSEL_SCHEMA; // same shape: { carousels: [...] }

export async function run({ topic, context, niche }) {
  const prompt = `You are a top Instagram carousel strategist and designer for a beginner creator.

THE CREATOR'S NICHE:
${niche}

TOPIC (user-chosen): ${topic}
${context ? `ADDITIONAL CONTEXT: ${context}` : ""}
CONTEXT: Beginner (~1000 followers), based in INDIA, Instagram only. Carousels drive
SAVES and SHARES with high-value, skimmable, VISUAL-FIRST content.

YOUR JOB:
- Design ONE original, ready-to-post carousel on the user's TOPIC above.
- Choose the single strongest structure for this topic (listicle, problem-agitate-
  solve, before/after, myth-busting, step-by-step framework) and record it in
  "structure" with 1 line on why it fits.

RULES:
- 6 to 8 slides: COVER (scroll-stopping hook) → 1-2 curiosity/tension slides →
  3-4 slides of SUBSTANTIAL value → actionable takeaway → CTA slide.
- VALUE DENSITY IS #1: every "point" slide must teach something ACTABLE — a
  framework, step, checklist item, real example, common mistake, tool name, or
  number. BANNED: motivational filler and vague tips.
- Art direction: cinematic editorial posters with CUSTOM AI ARTWORK, oversized white
  headings and quiet supporting copy. Define artDirection: palette, lighting, medium.
  Each imagePrompt must translate the exact lesson into a striking visual metaphor,
  using surreal scale, sculptural objects, rich textures and dramatic lighting.
  Example: attention = a tiny glowing stage inside a giant glass eye; weak hooks = a
  giant golden fishing hook lifting a miniature cinema from a black ocean.
  No generic desks, laptop users or motivational stock. Cover = strongest visual hook.
  Hero in lower 45%, calm dark negative space in upper 55% for type. Evolve scenes
  across slides within one visual world. imagePrompt in English, 60-100 words.
  AI artwork is OPTIONAL, generated only when requested. Stock photos load first:
  imageQuery must be a 2-4 keyword Pexels search for a common topic-relevant real scene,
  not composition instructions or impossible metaphors.
  Use imageMood "dark" for a consistent series.
- Point/CTA headings prefer 2-5 bold words, max ~6. Bodies maximum 30 words of actionable
  value. Cover hooks follow the COVER HOOK QUALITY GATE below, not the point-slide word limit.
- All headings/bodies/caption in HINGLISH (Roman script). imageQuery/mood in English.
- "music" = INSTRUMENTAL BGM only (never lyrics) + 1 line on why it holds attention.
- Ready-to-paste HINGLISH caption + 8-12 hashtags. Comment-bait CTA only if a real
  lead magnet makes sense; otherwise "Save this" / "Share with a creator friend".

${CAROUSEL_HOOK_GUIDE}
Return exactly ONE object inside "carousels".
${SINGLE_CAROUSEL_SCHEMA}`;

  const data = await generateJson(prompt);
  const first = Array.isArray(data.carousels) ? data.carousels[0] : null;
  if (first && !first.id) first.id = "gen-carousel";
  return { type: meta.id, title: first?.title || topic, payload: { carousels: first ? [first] : [] } };
}
