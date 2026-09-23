// NORMAL POST workflow — Phase 2: human-style caption post + creative direction
// + real photo options resolved server-side from free stock sources
// (Pexels/Pixabay via searchBrollOptions — no paid services).
import { generateJson } from "../gemini.js";
import { HINGLISH_SCRIPT_GUIDE } from "../prompt.js";
import { searchBrollOptions } from "../media.js";

export const meta = {
  id: "post",
  label: "Normal Post",
  kind: "post",
};

const SCHEMA = `
Return ONLY a single valid JSON object (no markdown fences, no commentary) matching:
{
  "title": "short internal name",
  "format": "single photo | quote card | infographic",
  "creativeDirection": "how the visual should look: subject, framing, colors, mood",
  "imageQuery": "2-4 concrete English keywords to find a real photo on a stock site",
  "altText": "short accessibility alt-text for the image",
  "caption": "ready-to-paste HINGLISH caption — sounds human-written, strong first line, value, ONE CTA",
  "cta": "the single call-to-action used",
  "hashtags": ["8-12 relevant mixed Hindi/English tags"]
}
`;

export async function run({ topic, context, niche }) {
  const prompt = `You are an Instagram strategist writing a NORMAL (single-image) post for an Indian creator.

THE CREATOR'S NICHE:
${niche}

TOPIC: ${topic}
${context ? `ADDITIONAL CONTEXT: ${context}` : ""}

YOUR JOB:
- Create one ready-to-post normal feed post on this topic.
- The caption must sound like a real human wrote it — conversational Hinglish,
  not AI-polished. Strong first line, real value, exactly ONE CTA.
- Give creative direction + a concrete stock-photo query for the visual.

${HINGLISH_SCRIPT_GUIDE}

${SCHEMA}`;

  const data = await generateJson(prompt);
  // Resolve real, free-to-use photo options for the visual (best-effort).
  if (data.imageQuery) {
    try {
      data.imageOptions = await searchBrollOptions(data.imageQuery, "image", 4);
    } catch (err) {
      console.warn(`post image "${data.imageQuery}" skipped: ${err.message}`);
      data.imageOptions = [];
    }
  }
  return { type: meta.id, title: data.title || topic, payload: data };
}
