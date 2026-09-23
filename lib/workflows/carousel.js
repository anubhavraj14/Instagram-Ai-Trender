// CAROUSEL workflow — Phase 1: single on-demand carousel for a given topic.
// Reuses the SAME slide schema + rendering pipeline as the existing Carousels
// page (buildCarouselCard / slideCanvas / /api/slide-image on the client), so
// downloads, IG share, and slide photos work identically. No duplicate logic.
import { generateJson } from "../gemini.js";
import { CAROUSEL_SCHEMA } from "../prompt.js";

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
- Each slide = full-bleed REAL PHOTO + text overlay. Every slide needs a concrete
  "imageQuery" (2-4 English keywords, photographable) + "imageMood".
- Headings SHORT and punchy (max ~6 words). Bodies 2-3 short lines of specifics.
- All headings/bodies/caption in HINGLISH (Roman script). imageQuery/mood in English.
- "music" = INSTRUMENTAL BGM only (never lyrics) + 1 line on why it holds attention.
- Ready-to-paste HINGLISH caption + 8-12 hashtags. Comment-bait CTA only if a real
  lead magnet makes sense; otherwise "Save this" / "Share with a creator friend".

Return exactly ONE object inside "carousels".
${SINGLE_CAROUSEL_SCHEMA}`;

  const data = await generateJson(prompt);
  const first = Array.isArray(data.carousels) ? data.carousels[0] : null;
  if (first && !first.id) first.id = "gen-carousel";
  return { type: meta.id, title: first?.title || topic, payload: { carousels: first ? [first] : [] } };
}
