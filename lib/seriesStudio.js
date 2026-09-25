// Series Studio backend — complete Reel series creation, discovery, and smart tools.
// All content is generated through Gemini as structured JSON. Media resolution is
// deferred to the client or separate lazy endpoints so AI calls stay efficient.

import { generateJson } from "./gemini.js";
import { fetchViralSignals } from "./sources.js";
import { HINGLISH_SCRIPT_GUIDE, DEFAULT_NICHE } from "./prompt.js";

const EPISODE_SCHEMA = `{
  "n": 1,
  "title": "short episode title",
  "status": "Idea",
  "hook": "strong spoken hook line (0-3s)",
  "script": {
    "durationSeconds": 30,
    "hook": "spoken hook line (same as episode.hook)",
    "onScreenHook": "bold first-frame text overlay",
    "lines": [
      { "part": "hook | build | value | cta", "say": "HINGLISH spoken line", "text": "on-screen text", "visual": "shot / b-roll idea" }
    ],
    "caption": "ready-to-paste HINGLISH Instagram caption",
    "hashtags": ["#reelsindia", "#instagramgrowth", "8-12 tags"]
  },
  "mainTakeaway": "one-line value the viewer leaves with",
  "cta": "single soft call-to-action",
  "brollVisuals": ["specific visual/B-roll suggestion 1", "suggestion 2"],
  "bgmMood": "instrumental mood + 1 line why it fits",
  "caption": "same as script.caption",
  "suggestedPostingDay": "e.g. Day 1 — Monday",
  "continuityNote": "what this episode covers; used to avoid repetition"
}`;

const SERIES_SCHEMA = `Return ONLY a single valid JSON object (no markdown fences, no commentary) matching:

{
  "seriesName": "catchy series title",
  "concept": "overall concept/angle in 1-2 sentences",
  "targetAudience": "who this is for",
  "followReason": "why someone would follow episode to episode",
  "recommendedEpisodes": 6,
  "contentAngle": "angle that ties the series together",
  "postingSequence": "e.g. 3 episodes/week: Mon/Wed/Fri",
  "coveredTopics": ["topic 1", "topic 2"],
  "episodes": [
    ${EPISODE_SCHEMA}
  ]
}

Make episodes feel connected: each episode ends with a small tease or open loop that points to the next episode. Every episode must cover a genuinely different sub-topic. Avoid repetitive wording.`;

function seriesPrompt(topic, context, niche, episodeCount) {
  return `You are a senior Instagram Reels strategist and scriptwriter for an Indian creator audience.
A creator wants a COMPLETE Reel series around this topic.

THE CREATOR'S NICHE:
${niche}

TOPIC FOR THE SERIES: ${topic}
${context ? `ADDITIONAL CONTEXT: ${context}` : ""}

GOALS:
- Build a binge-worthy series of ${episodeCount} episodes (recommended: ${episodeCount}).
- Each episode is a 25-40s HINGLISH Reel in Roman script.
- Episodes are CONNECTED: the order makes sense, each adds new value, and there is a reason to watch the next one.
- Avoid repeating the same hook pattern or script structure across episodes.
- Every episode gets: title, strong hook, full script with lines, main takeaway, CTA, B-roll/visual suggestions, BGM/mood recommendation, caption, and suggested posting day.
- Track what each episode covers in "continuityNote" so future episodes don't repeat.

${HINGLISH_SCRIPT_GUIDE}

${SERIES_SCHEMA}`;
}

export async function createSeries({ topic, context = "", niche = DEFAULT_NICHE, episodeCount = 6 }) {
  const count = Math.max(3, Math.min(10, Number(episodeCount) || 6));
  const data = await generateJson(seriesPrompt(topic, context, niche, count));
  if (!Array.isArray(data.episodes)) data.episodes = [];
  data.episodes = data.episodes.slice(0, count).map((ep, i) => ({ ...ep, n: ep.n || i + 1, status: ep.status || "Idea" }));
  data.recommendedEpisodes = data.episodes.length || count;
  return data;
}

const IDEA_SCHEMA = `Return ONLY a single valid JSON object (no markdown fences, no commentary) matching:

{
  "ideas": [
    {
      "title": "series title",
      "coreConcept": "1-2 sentence concept",
      "targetAudience": "who it's for",
      "whyCare": "why people may care (trend/signal reasoning)",
      "suggestedEpisodes": 5,
      "exampleEpisode1Hook": "strong first-episode hook",
      "exampleTopics": ["episode 2 topic", "episode 3 topic"],
      "contentAngle": "fresh angle to stand out",
      "difficulty": "Easy | Medium | Hard",
      "suggestedPostingFrequency": "e.g. 2 episodes/week",
      "signals": "optional: what signals support this"
    }
  ]
}

Be honest: explain the reasoning but never claim guaranteed virality.`;

export async function discoverSeriesIdeas({ topic = "", niche = DEFAULT_NICHE, count = 6 }) {
  const prompt = `You are a trend-aware Instagram content strategist.
${topic ? `Suggest around ${count} Reel series ideas related to: ${topic}` : `Suggest around ${count} fresh Reel series ideas`} for a creator in this niche:
${niche}

Use your knowledge of current Instagram/creator/AI/social-media trends where possible. For each idea explain why it has audience potential and what signals make it promising. Be specific and practical; avoid generic motivational advice.

${IDEA_SCHEMA}`;
  const data = await generateJson(prompt);
  return { ideas: Array.isArray(data.ideas) ? data.ideas.slice(0, count) : [] };
}

export async function researchTopicHooks({ topic, niche = DEFAULT_NICHE }) {
  let signals = [];
  try { signals = await fetchViralSignals(); } catch (e) { console.warn("series hook research signals failed:", e.message); }
  const feed = signals.map((s, i) => `${i + 1}. [${s.source}] ${s.title}\n   url: ${s.url}`).join("\n");
  const prompt = `You are a viral-hook researcher for Instagram Reels in this niche:
${niche}

TOPIC: ${topic}

Below are fresh signals about what's performing in this space. Extract or infer relevant viral/high-performing Reel hooks around the topic. If a signal includes a URL, include it. If not, leave "url" as an empty string. Do NOT invent URLs or claim a hook is guaranteed to go viral. Frame everything as reference/inspiration.

=== SIGNALS ===
${feed || "(no live signals available — rely on your knowledge of proven hook patterns)"}
=== END SIGNALS ===

Return ONLY a single valid JSON object:
{
  "summary": "short overview",
  "hooks": [
    { "hookText": "exact or reconstructed hook", "source": "source name", "url": "source URL or empty", "whyItWorked": "retention psychology", "structure": "hook pattern name" }
  ],
  "reels": [
    { "title": "representative reel title", "sourceUrl": "URL or empty", "script": { "hook": "...", "lines": [{"part":"...","say":"...","text":"...","visual":"..."}], "caption": "...", "hashtags": ["..."] }, "structure": "...", "keyPoints": ["..."], "cta": "..." }
  ]
}`;
  const data = await generateJson(prompt);
  return {
    summary: data.summary || "",
    hooks: Array.isArray(data.hooks) ? data.hooks : [],
    reels: Array.isArray(data.reels) ? data.reels : [],
  };
}

export async function generateNextEpisode({ series, niche = DEFAULT_NICHE }) {
  const eps = Array.isArray(series.episodes) ? series.episodes : [];
  const n = eps.length + 1;
  const summaries = eps.map((e) =>
    `- Ep ${e.n}: ${e.title || ""}. Hook: ${e.hook || ""}. Takeaway: ${e.mainTakeaway || ""}. Covered: ${e.continuityNote || ""}`
  ).join("\n");
  const covered = (series.coveredTopics || []).join(", ");
  const prompt = `You are continuing an existing Instagram Reel series.

SERIES: ${series.seriesName}
CONCEPT: ${series.concept}
TARGET AUDIENCE: ${series.targetAudience}
NICHE: ${niche}

ALREADY COVERED TOPICS: ${covered || "(none yet)"}

PREVIOUS EPISODES:
${summaries || "(none yet)"}

Write EPISODE ${n}. It must add a NEW sub-topic, not repeat anything above, and tease or naturally lead toward a future episode. Return the same JSON shape as a single episode object.

${HINGLISH_SCRIPT_GUIDE}

Return ONLY this JSON object:
{
  "n": ${n},
  "title": "...",
  "status": "Idea",
  "hook": "...",
  "script": { "durationSeconds": 30, "hook": "...", "onScreenHook": "...", "lines": [...], "caption": "...", "hashtags": [...] },
  "mainTakeaway": "...",
  "cta": "...",
  "brollVisuals": [...],
  "bgmMood": "...",
  "caption": "...",
  "suggestedPostingDay": "Day ${n}",
  "continuityNote": "..."
}`;
  const ep = await generateJson(prompt);
  ep.n = n;
  ep.status = ep.status || "Idea";
  return ep;
}

export async function regenerateEpisode({ series, episodeIndex, niche = DEFAULT_NICHE }) {
  const idx = Number(episodeIndex) || 0;
  const existing = (series.episodes || [])[idx];
  const others = (series.episodes || []).filter((_, i) => i !== idx);
  const summaries = others.map((e) =>
    `- Ep ${e.n}: ${e.title || ""}. Covered: ${e.continuityNote || ""}`
  ).join("\n");
  const prompt = `Rewrite a single episode of this Reel series with a fresh hook, wording, structure and/or angle while keeping factual information accurate.

SERIES: ${series.seriesName}
CONCEPT: ${series.concept}
TARGET AUDIENCE: ${series.targetAudience}
NICHE: ${niche}

OTHER EPISODES (do not repeat these topics):
${summaries || "(none)"}

EPISODE NUMBER TO REWRITE: ${existing?.n || idx + 1}
CURRENT TITLE: ${existing?.title || ""}
CURRENT HOOK: ${existing?.hook || ""}

Return the same JSON shape as a single episode object. Make it genuinely different from the current version, not just a few synonym swaps.

${HINGLISH_SCRIPT_GUIDE}

Return ONLY the episode JSON object.`;
  const ep = await generateJson(prompt);
  ep.n = existing?.n || idx + 1;
  ep.status = existing?.status || "Idea";
  return ep;
}

export async function hookVariations({ episode, niche = DEFAULT_NICHE }) {
  const prompt = `You are writing alternative scroll-stopping hooks for an Instagram Reel episode.

SERIES: ${episode.seriesName || ""}
EPISODE TITLE: ${episode.title || ""}
CURRENT HOOK: ${episode.hook || (episode.script?.hook || "")}
MAIN TAKEAWAY: ${episode.mainTakeaway || ""}
NICHE: ${niche}

Generate 3 different hook options using different proven patterns (bold claim, direct callout, pain point, curiosity loop, number promise, story). Return ONLY:
{
  "variations": [
    { "hook": "spoken hook line", "onScreenHook": "first-frame text", "pattern": "pattern name", "why": "why it works" }
  ]
}`;
  const data = await generateJson(prompt);
  return { variations: Array.isArray(data.variations) ? data.variations : [] };
}

export async function ctaSuggestions({ episode, goal = "follows", niche = DEFAULT_NICHE }) {
  const prompt = `Suggest 3 tailored CTAs for this Reel episode. The primary goal is: ${goal} (follows, comments, saves, shares, or DMs).

EPISODE TITLE: ${episode.title || ""}
HOOK: ${episode.hook || (episode.script?.hook || "")}
MAIN TAKEAWAY: ${episode.mainTakeaway || ""}
NICHE: ${niche}

Return ONLY:
{
  "ctas": [
    { "cta": "exact CTA line", "goal": "follows|comments|saves|shares|dms", "why": "why it fits" }
  ]
}`;
  const data = await generateJson(prompt);
  return { ctas: Array.isArray(data.ctas) ? data.ctas : [] };
}

export async function planBroll({ scriptLines = [], hook, onScreenHook, niche = DEFAULT_NICHE }) {
  if (!scriptLines.length) return { lines: [] };
  const linesText = scriptLines.map((ln, i) => `${i + 1}. [${ln.part || "value"}] ${ln.say || ln.text || ""}`).join("\n");
  const prompt = `You are a short-form video editor. For each spoken line below, add a SPECIFIC B-roll / visual suggestion and a searchable query.

Hook: ${hook || ""}
On-screen hook: ${onScreenHook || ""}

LINES:
${linesText}

Return ONLY:
{
  "lines": [
    { "part": "...", "say": "...", "text": "...", "visual": "...", "brollQuery": "2-4 concrete English keywords to search stock media", "placement": "full screen cutaway | top panel behind speaker | pip corner overlay" }
  ]
}`;
  const data = await generateJson(prompt);
  return { lines: Array.isArray(data.lines) ? data.lines : [] };
}

export async function bgmSuggestions({ episode, niche = DEFAULT_NICHE }) {
  const prompt = `Recommend 2 instrumental BGM options for this Reel episode.

EPISODE TITLE: ${episode.title || ""}
HOOK: ${episode.hook || (episode.script?.hook || "")}
MOOD/VIBE: ${episode.bgmMood || ""}
NICHE: ${niche}

Return ONLY:
{
  "tracks": [
    { "name": "descriptive style", "searchQuery": "simple English music search keywords", "mood": "curiosity|urgency|emotional|upbeat|dramatic|chill|motivational", "why": "why it fits" }
  ]
}`;
  const data = await generateJson(prompt);
  return { tracks: Array.isArray(data.tracks) ? data.tracks : [] };
}

export async function repurposeContent({ source, format, niche = DEFAULT_NICHE }) {
  // source can be a series object, an episode object, or { title, text, lines }
  const title = source.seriesName || source.title || "Content";
  const text = source.script
    ? (source.script.lines || []).map((l) => l.say || l.text).filter(Boolean).join("\n")
    : source.text || "";
  const prompt = `Repurpose the following Reel content into a ${format} for Instagram. Keep the core value accurate, but rewrite for the new format.

ORIGINAL TITLE: ${title}
ORIGINAL SCRIPT:
${text}

NICHE: ${niche}

Return ONLY a JSON object with the appropriate fields for a ${format}:
- "carousel": { "title", "slides": [{"n","type","heading","body","imageQuery","imageMood"}], "caption", "hashtags" }
- "story": { "title", "frames": [{"n","purpose","text","visual","imageQuery","imageMood","interactive","timing"}], "cta" }
- "caption": { "caption", "hashtags", "hookText" }
- "normal post": { "caption", "hashtags", "imageQuery", "creativeDirection" }

${HINGLISH_SCRIPT_GUIDE}`;
  return generateJson(prompt);
}

export async function findContentGaps({ series, niche = DEFAULT_NICHE }) {
  const covered = (series.coveredTopics || []).concat(
    (series.episodes || []).map((e) => e.continuityNote || e.title || "")
  ).join("\n- ");
  const prompt = `You are auditing a Reel series for missing topics.

SERIES: ${series.seriesName}
CONCEPT: ${series.concept}
TARGET AUDIENCE: ${series.targetAudience}
NICHE: ${niche}

ALREADY COVERED:
- ${covered || "(nothing yet)"}

Return ONLY:
{
  "gaps": [
    { "topic": "missing sub-topic", "whyItMatters": "why the audience cares", "suggestedEpisodeTitle": "title if added" }
  ]
}`;
  const data = await generateJson(prompt);
  return { gaps: Array.isArray(data.gaps) ? data.gaps : [] };
}
