// STORY workflow — Phase 2: engagement-focused story sequence.
// Each frame carries a concrete stock-photo query resolved client-side through
// the existing free /api/slide-image pipeline, plus interactive sticker ideas.
import { generateJson } from "../gemini.js";
import { HINGLISH_SCRIPT_GUIDE } from "../prompt.js";

export const meta = {
  id: "story",
  label: "Story",
  kind: "story",
};

const SCHEMA = `
Return ONLY a single valid JSON object (no markdown fences, no commentary) matching:
{
  "title": "short internal name",
  "goal": "engagement | trust | reach | conversion",
  "strategy": "1-2 lines on the arc you chose and why it builds engagement/trust",
  "frames": [
    {
      "n": 1,
      "purpose": "hook | value | interactive | proof | cta",
      "text": "short HINGLISH text overlay for this story frame (1-2 lines, conversational)",
      "visual": "what to show: selfie talking | screen-record | photo idea | text-only background",
      "imageQuery": "2-4 concrete English keywords for a real stock photo (photographable subjects only) — empty string if the frame should be selfie/text-only",
      "imageMood": "dark | bright | vibrant | minimal",
      "interactive": "sticker idea with the exact poll/question/slider wording, or 'none'",
      "timing": "best time/context to post this frame if it matters, else empty"
    }
  ],
  "cta": "the closing call-to-action",
  "postingTips": ["1-3 short tips: spacing between frames, best hours, reply strategy"]
}
`;

export async function run({ topic, context, niche }) {
  const prompt = `You are an Instagram Stories strategist for an Indian creator.

THE CREATOR'S NICHE:
${niche}

TOPIC: ${topic}
${context ? `ADDITIONAL CONTEXT: ${context}` : ""}

YOUR JOB:
- Design a 5-8 frame Instagram STORY sequence on this topic, engineered for
  engagement (replies, sticker taps, poll votes) and trust (real, human, specific).
- Arc: hook frame that makes people tap forward → value frames → ONE interactive
  frame with a genuinely tempting poll/question/slider → a proof or relatable/
  behind-the-scenes frame → CTA frame.
- Keep every frame's text SHORT — stories are glanced at, not read.
- Interactive sticker wording must be specific and easy to answer in one tap.
- Frames that should show a real photo get a concrete "imageQuery"; frames that
  work better as selfie-talking or text-on-background leave it empty.
- All text in HINGLISH (Hindi+English, Roman script), like a real Indian creator.
- imageQuery + imageMood in English.

${HINGLISH_SCRIPT_GUIDE}

${SCHEMA}`;

  const data = await generateJson(prompt);
  return { type: meta.id, title: data.title || topic, payload: data };
}
