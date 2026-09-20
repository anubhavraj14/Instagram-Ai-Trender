import { GoogleGenAI } from "@google/genai";
import { buildAnalysisPrompt, buildViralPrompt, buildPlanPrompt, buildCarouselPrompt, buildEditPlanPrompt, buildScriptKitPrompt, DEFAULT_NICHE } from "./prompt.js";
import { fetchTrendSignals, fetchViralSignals, fetchCarouselSignals } from "./sources.js";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
// Fallback models tried (in order) when the primary is overloaded (503).
const FALLBACK_MODELS = (process.env.GEMINI_FALLBACKS ||
  "gemini-3.6-flash,gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-3.7-flash,gemini-3.8-flash")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.startsWith("AIza...") || apiKey.includes("your")) {
    const err = new Error(
      "GEMINI_API_KEY is not set. Copy .env.example to .env and add your free key."
    );
    err.code = "NO_API_KEY";
    throw err;
  }
  return new GoogleGenAI({ apiKey });
}

// Pull the final JSON object out of the model output, tolerating stray prose or fences.
function extractJson(text) {
  if (!text) throw new Error("Empty response from model.");
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first === -1 || last === -1) throw new Error("No JSON found in model output.");
  return JSON.parse(t.slice(first, last + 1));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// retry = temporarily overloaded (wait & retry same model)
// skip  = model gone OR its daily quota is used up (jump to next model, which has its own quota)
// fatal = real problem (bad key, bad request) — stop entirely.
function classify(e) {
  const m = String(e?.message || "");
  if (m.includes("503") || m.includes("UNAVAILABLE") || m.includes("overloaded") || m.includes("500")) return "retry";
  if (m.includes("404") || m.includes("NOT_FOUND") || m.includes("no longer available")) return "skip";
  if (m.includes("429") || m.includes("RESOURCE_EXHAUSTED") || m.includes("quota")) return "skip";
  return "fatal";
}

const isQuota = (e) => /429|RESOURCE_EXHAUSTED|quota/.test(String(e?.message || ""));

async function callModel(ai, model, prompt) {
  return ai.models.generateContent({
    model,
    contents: prompt,
    config: { temperature: 0.7, maxOutputTokens: 30000, responseMimeType: "application/json" },
  });
}

// Try the primary model with backoff; if it stays overloaded, fall through to fallbacks.
async function generateWithRetry(ai, prompt) {
  const models = [MODEL, ...FALLBACK_MODELS.filter((m) => m !== MODEL)];
  let lastErr;
  for (const model of models) {
    for (let i = 0; i < 3; i++) {
      try {
        return await callModel(ai, model, prompt);
      } catch (e) {
        lastErr = e;
        const kind = classify(e);
        if (kind === "fatal") throw e;
        if (kind === "skip") {
          console.warn(`Model ${model} unavailable — trying next fallback.`);
          break;
        }
        console.warn(`Model ${model} busy (try ${i + 1}); retrying…`);
        await sleep(2000 * (i + 1));
      }
    }
  }
  if (isQuota(lastErr)) {
    const err = new Error(
      "Free Gemini daily limit reached on all models (20 requests/day each). " +
      "It resets at midnight Pacific time — or add billing / more models to keep going. " +
      "Tip: results are cached 30 min, so avoid hitting Refresh repeatedly."
    );
    err.code = "QUOTA";
    throw err;
  }
  throw lastErr;
}

export async function researchTrends(niche = DEFAULT_NICHE) {
  const ai = getClient();

  // 1) Collect fresh, real signals for free (Google News RSS + Reddit).
  //    Some hosts' datacenter IPs get blocked by these sources; if so we fall back
  //    to the model's own knowledge instead of failing.
  let signals = [];
  try {
    signals = await fetchTrendSignals();
  } catch (e) {
    console.warn("Trend signal fetch failed:", e.message);
  }

  // 2) Let Gemini analyze/rank them and write Reel concepts (free plain generation).
  const response = await generateWithRetry(ai, buildAnalysisPrompt(niche, signals));

  const data = extractJson(response.text);
  data.signalCount = signals.length;
  data.liveData = signals.length > 0;
  if (!data.generatedAt) data.generatedAt = new Date().toISOString();
  if (!data.niche) data.niche = niche;
  return data;
}

export async function researchViral(niche = DEFAULT_NICHE) {
  const ai = getClient();

  // Viral analysis already leans on the model's knowledge, so empty signals are fine.
  let signals = [];
  try {
    signals = await fetchViralSignals();
  } catch (e) {
    console.warn("Viral signal fetch failed:", e.message);
  }

  const response = await generateWithRetry(ai, buildViralPrompt(niche, signals));

  const data = extractJson(response.text);
  data.signalCount = signals.length;
  data.liveData = signals.length > 0;
  if (!data.generatedAt) data.generatedAt = new Date().toISOString();
  if (!data.niche) data.niche = niche;
  return data;
}

export async function researchPlan(niche = DEFAULT_NICHE) {
  const ai = getClient();
  const response = await generateWithRetry(ai, buildPlanPrompt(niche));
  const data = extractJson(response.text);
  if (!data.generatedAt) data.generatedAt = new Date().toISOString();
  if (!data.niche) data.niche = niche;
  return data;
}

export async function researchCarousels(niche = DEFAULT_NICHE) {
  const ai = getClient();
  const signals = await fetchCarouselSignals().catch(() => []);
  const response = await generateWithRetry(ai, buildCarouselPrompt(niche, signals));
  const data = extractJson(response.text);
  if (!data.generatedAt) data.generatedAt = new Date().toISOString();
  if (!data.niche) data.niche = niche;
  data.liveData = signals.length > 0;
  return data;
}

// Reel Editor: transcript (+ optional segment timings) -> edit plan JSON.
export async function planEdit(transcript, segments = [], duration = 0) {
  const ai = getClient();
  const response = await generateWithRetry(ai, buildEditPlanPrompt(transcript, segments, duration));
  return extractJson(response.text);
}

// Script Kit: pasted script -> full pre-production asset pack.
export async function planScriptKit(script, niche = DEFAULT_NICHE) {
  const ai = getClient();
  const response = await generateWithRetry(ai, buildScriptKitPrompt(script, niche));
  return extractJson(response.text);
}
