// REEL workflow — Phase 2: full pre-production pack for a topic.
// Emits the same shape as Script Kit (hook analysis, beat-by-beat script with
// per-beat B-roll, BGM, SFX, captions, editing tips) PLUS viral-format
// references — then resolves B-roll (Pexels/Pixabay, free) and BGM (Free To
// Use, no key) server-side via the shared resolveKitMedia helper.
import { generateJson } from "../gemini.js";
import { HINGLISH_SCRIPT_GUIDE, SCRIPT_KIT_SCHEMA } from "../prompt.js";
import { resolveKitMedia } from "../kit.js";

export const meta = {
  id: "reel",
  label: "Reel",
  // script-kit-shaped payload → rendered by the existing renderScriptKit UI
  kind: "scriptkit",
};

const EXTRA_FIELDS = `
Additionally include these top-level fields alongside the schema above:
  "references": [
    {
      "format": "name of a proven Reel format this topic fits (e.g. 'talking-head list', 'POV', 'before/after')",
      "whyItWorks": "1 line on the retention psychology that makes it perform",
      "twist": "how this specific script adapts/differentiates the format so it doesn't look copied"
    }
  ],
  "script": {
    "durationSeconds": 30,
    "hook": "the spoken HINGLISH hook line (same as hook.line)",
    "onScreenHook": "first-frame text overlay",
    "lines": [
      { "part": "hook | build | value | cta", "say": "the spoken HINGLISH line (same as beats[].say)", "text": "on-screen text", "visual": "shot/b-roll idea" }
    ],
    "caption": "same as captions.caption",
    "hashtags": ["same as captions.hashtags"]
  }
`;

export async function run({ topic, context, niche }) {
  const prompt = `You are a senior short-form video producer and retention editor for Instagram Reels.
A creator wants a COMPLETE production pack for a Reel on a given topic: the script itself,
beat-by-beat plan, B-roll search queries, BGM recommendations with audience-psychology
reasoning, sound effects, captions, and editing tips.

THE CREATOR'S NICHE:
${niche}

TOPIC: ${topic}
${context ? `ADDITIONAL CONTEXT: ${context}` : ""}

STEP 1 — Write the Reel: a ready-to-record HINGLISH script (~25-40s) on this topic.
Choose the single strongest proven hook pattern for THIS topic (bold claim, direct
callout, pain point, curiosity loop, or number promise). Then break it into beats.

STEP 2 — Build the production kit around that script:
- hook: analyze your own hook's strength honestly and give a stronger alternative if needed.
- beats: one per spoken line, with timing, on-screen text, SPECIFIC visual direction,
  B-roll queries (concrete, photographable), placement, zoom flags, and SFX where they
  genuinely add impact. B-roll on at least 60% of beats.
- bgm: 1-2 instrumental picks whose mood follows the arc (curiosity hook → momentum →
  satisfying CTA), with real searchable queries.
- captions + hashtags in Hinglish with SEO keywords and exactly ONE CTA.
- editingTips + requiredAssets.
- references: 2-3 proven viral formats this Reel borrows from, why they work, and the
  twist that keeps this version original. Frame them as representative of the format —
  never claim to reproduce a specific creator's video.
- script: mirror the spoken lines as a plain script object too (same content as beats).

For Indian creator audiences, all spoken lines/on-screen text/captions in natural
HINGLISH (Roman script). B-roll queries, imageQuery, and BGM searchQuery in English.

${HINGLISH_SCRIPT_GUIDE}

${SCRIPT_KIT_SCHEMA}

${EXTRA_FIELDS}`;

  const kit = await generateJson(prompt);
  await resolveKitMedia(kit); // free: Pexels/Pixabay B-roll + FreeToUse BGM
  return { type: meta.id, title: kit.title || topic, payload: kit };
}
