import { createHash } from "node:crypto";
import { buildCarouselPrompt } from "./prompt.js";

export const CAROUSEL_PILLARS = [
  { id: "filming", label: "Phone filming and production", query: "creator phone filming lighting audio tips", angles: ["Window-light setup for phone videos", "Cleaner voice recordings in a noisy room", "A practical B-roll shot list"] },
  { id: "editing", label: "Editing and visual storytelling", query: "Reels editing captions pacing workflow", angles: ["Remove dead time without confusing the viewer", "Readable subtitles on a small screen", "Sound design that supports a story"] },
  { id: "analytics", label: "Analytics and experiments", query: "Instagram insights retention analytics creators", angles: ["Diagnose a retention drop using Insights", "Run a fair content experiment", "Choose useful metrics beyond views"] },
  { id: "profile", label: "Positioning and profile conversion", query: "Instagram creator profile bio positioning", angles: ["Make a profile's audience and promise clear", "Build useful pinned posts", "Use Highlights to answer audience questions"] },
  { id: "ideas", label: "Audience research and content ideas", query: "creator audience research content ideas", angles: ["Turn audience questions into useful posts", "Find overlooked problems in your niche", "Build a reusable idea bank"] },
  { id: "workflow", label: "Planning and sustainable workflows", query: "content creator batch filming workflow planning", angles: ["Batch filming with a realistic shot plan", "Organize footage so editing is faster", "Plan a sustainable weekly publishing routine"] },
  { id: "storytelling", label: "Stories, examples and teaching", query: "creator storytelling examples teaching content", angles: ["Teach with a concrete before-and-after example", "Turn a small failure into a useful lesson", "Explain a complex idea without jargon"] },
  { id: "community", label: "Community and audience conversations", query: "Instagram creators community engagement audience", angles: ["Turn thoughtful comments into conversations", "Ask audience-research questions in Stories", "Build trust without engagement bait"] },
  { id: "tools", label: "AI and practical creator tools", query: "creator AI tools content workflow fact checking", angles: ["Fact-check AI-assisted content before publishing", "Use AI to organize research, not invent facts", "Choose tools by the bottleneck they solve"] },
  { id: "monetization", label: "Offers, brand work and monetization", query: "creators brand deals media kit pricing deliverables", angles: ["Build a simple media kit with honest metrics", "Clarify brand-deal deliverables before quoting", "Turn an audience problem into a useful offer"] },
  { id: "repurposing", label: "Repurposing and content libraries", query: "creator repurpose content library evergreen", angles: ["Adapt one lesson for multiple useful formats", "Refresh an evergreen post with a better example", "Build a searchable library of reusable footage"] },
  { id: "distribution", label: "Discovery and collaborations", query: "Instagram search discoverability creator collaborations", angles: ["Make content easier to find with clear keywords", "Plan a relevant creator collaboration", "Distribute a useful post without spamming"] },
];

export function planCarouselTopics(cursor = 0) {
  return Array.from({ length: 3 }, (_, i) => {
    const position = cursor + i;
    const pillar = CAROUSEL_PILLARS[position % CAROUSEL_PILLARS.length];
    const angle = pillar.angles[Math.floor(position / CAROUSEL_PILLARS.length) % pillar.angles.length];
    return { id: pillar.id, label: pillar.label, angle, query: pillar.query };
  });
}

const TOPIC_STOP_WORDS = new Set(["the", "and", "for", "how", "your", "with", "instagram", "reels", "creator", "creators", "kaise", "mein", "apne"]);

function topicWords(value) {
  return String(value || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/)
    .filter((word) => word.length > 2 && !TOPIC_STOP_WORDS.has(word));
}

export function topicsOverlap(a, b) {
  const left = new Set(topicWords(a)), right = new Set(topicWords(b));
  if (!left.size || !right.size) return false;
  const common = [...left].filter((word) => right.has(word)).length;
  const union = new Set([...left, ...right]).size;
  return common === left.size && common === right.size || common >= 3 && common / union >= 0.65;
}

export function validateCarouselTopics(data, plan, recent = []) {
  if (!Array.isArray(data.carousels) || data.carousels.length !== 3) throw new Error("Return exactly three distinct carousels.");
  const accepted = [];
  for (const assignment of plan) {
    const matches = data.carousels.filter((c) => c.pillarId === assignment.id);
    if (matches.length !== 1) throw new Error(`Use the assigned content pillar ${assignment.id} exactly once.`);
    const carousel = matches[0];
    if (typeof carousel.topic !== "string" || !carousel.topic.trim() || !Array.isArray(carousel.slides) || !carousel.slides.length) throw new Error("Each carousel needs a concrete topic and slides.");
    if (/\b(?:carousels?|hooks?)\b/i.test(`${carousel.topic} ${carousel.title || ""}`)) throw new Error("Automatic topics must teach the assigned subject, not carousel creation or hook writing.");
    if ([...recent, ...accepted].some((previous) => topicsOverlap(carousel.topic, previous.topic) || topicsOverlap(carousel.title, previous.title))) {
      throw new Error("A topic repeats a recent carousel. Choose a genuinely different problem, not a renamed headline.");
    }
    accepted.push(carousel);
  }
  return accepted;
}

export function createCarouselResearch({ generate, fetchSignals, getCache, setCache, now = () => new Date().toISOString() }) {
  const localHistory = new Map();
  return async (niche) => {
    const historyKey = "carousel-topics-v1:" + createHash("sha256").update(niche).digest("hex").slice(0, 20);
    const history = await getCache(historyKey).catch(() => null) || localHistory.get(historyKey) || { cursor: 0, recent: [] };
    const cursor = Number.isSafeInteger(history.cursor) && history.cursor >= 0 ? history.cursor : 0;
    const recent = Array.isArray(history.recent) ? history.recent.slice(-60) : [];
    const plan = planCarouselTopics(cursor);
    const signals = await fetchSignals(plan).catch(() => []);
    const prompt = buildCarouselPrompt(niche, signals, { plan, recent });
    let data;
    let feedback = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      data = await generate(prompt + feedback);
      try {
        data.carousels = validateCarouselTopics(data, plan, recent);
        break;
      } catch (error) {
        if (attempt === 1) throw error;
        feedback = `\nREVISION REQUIRED: ${error.message}\nReturn a corrected complete batch, respecting all assigned pillars and recent-topic exclusions.`;
      }
    }
    data.generatedAt ||= now();
    data.niche ||= niche;
    data.liveData = signals.length > 0;
    const next = { cursor: cursor + 3, recent: [...recent, ...data.carousels.map(({ pillarId, topic, title }) => ({ pillarId, topic, title }))].slice(-60) };
    localHistory.set(historyKey, next);
    await setCache(historyKey, next).catch(() => {});
    return data;
  };
}
