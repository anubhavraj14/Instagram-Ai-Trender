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

// Repair a truncated JSON string (model hit the output-token cap mid-object).
// Scans once, tracking the last point where a COMPLETE value closed (never a
// dangling key or trailing comma), then cuts there and closes open containers.
function repairTruncatedJson(s) {
  const stack = [];       // open containers: "{" or "["
  let inStr = false, esc = false;
  let expect = "value";   // value | key | colon | comma
  let safeEnd = -1, safeStack = [];
  const snap = (i) => { safeEnd = i + 1; safeStack = stack.slice(); };

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') {
        inStr = false;
        const topObj = stack[stack.length - 1] === "{";
        if (topObj && expect === "key") expect = "colon";   // this string was a key
        else { snap(i); expect = "comma"; }                  // this string was a value
      }
      continue;
    }
    if (c === '"') { inStr = true; esc = false; continue; }
    if (c === " " || c === "\n" || c === "\t" || c === "\r") continue;
    if (c === ":") { expect = "value"; continue; }
    if (c === ",") { expect = stack[stack.length - 1] === "{" ? "key" : "value"; continue; }
    if (c === "{") { stack.push("{"); expect = "key"; continue; }
    if (c === "[") { stack.push("["); expect = "value"; continue; }
    if (c === "}" || c === "]") { stack.pop(); snap(i); expect = "comma"; continue; }
    // primitive run (number/true/false/null) — only "complete" if a delimiter follows.
    let j = i;
    while (j < s.length && !/[\s,}\]]/.test(s[j])) j++;
    if (j < s.length) { snap(j - 1); expect = "comma"; }
    i = j - 1;
  }

  if (safeEnd < 0) throw new Error("nothing to repair");
  let out = s.slice(0, safeEnd);
  for (let k = safeStack.length - 1; k >= 0; k--) out += safeStack[k] === "{" ? "}" : "]";
  return out;
}

// Pull the final JSON object out of the model output, tolerating stray prose or fences.
function extractJson(text) {
  if (!text) throw new Error("Empty response from model.");
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first === -1) throw new Error("No JSON found in model output.");
  if (last !== -1) {
    try {
      return JSON.parse(t.slice(first, last + 1));
    } catch {
      // Model emitted trailing text/objects — fall back to the first balanced {...}.
      let depth = 0, inStr = false, esc = false;
      for (let i = first; i <= last; i++) {
        const c = t[i];
        if (inStr) {
          if (esc) esc = false;
          else if (c === "\\") esc = true;
          else if (c === '"') inStr = false;
        } else if (c === '"') inStr = true;
        else if (c === "{") depth++;
        else if (c === "}" && --depth === 0) return JSON.parse(t.slice(first, i + 1));
      }
    }
  }
  // No balanced object found — most likely the response was truncated at the token
  // cap. Try to repair the partial JSON so a long-but-cut-off kit is still usable.
  try {
    return JSON.parse(repairTruncatedJson(t.slice(first)));
  } catch {
    throw new Error("No complete JSON object found in model output.");
  }
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

// Flash models can spend the output-token budget on hidden "thinking" tokens,
// which truncates the JSON before it closes (seen on the richer Script Kit schema).
// We ask for a zero thinking budget so the whole budget goes to the JSON. If a
// model rejects that field, we transparently retry without it and stop sending it.
let SEND_THINKING_CONFIG = true;

async function callModel(ai, model, prompt) {
  const base = { temperature: 0.7, maxOutputTokens: 30000, responseMimeType: "application/json" };
  if (SEND_THINKING_CONFIG) {
    try {
      return await ai.models.generateContent({
        model,
        contents: prompt,
        config: { ...base, thinkingConfig: { thinkingBudget: 0 } },
      });
    } catch (e) {
      const m = String(e?.message || "");
      if (/thinking|thought|not supported|unknown name|invalid_argument/i.test(m)) {
        SEND_THINKING_CONFIG = false; // model doesn't accept it — fall through without
      } else {
        throw e;
      }
    }
  }
  return ai.models.generateContent({ model, contents: prompt, config: base });
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

// Generic entry point for one-off structured generation (used by the Content
// Generator workflows). Returns the parsed JSON object from the model.
export async function generateJson(prompt) {
  const ai = getClient();
  const response = await generateWithRetry(ai, prompt);
  return extractJson(response.text);
}

// Same, but the request includes a file part (video/audio/image via Files API).
// fileData = { fileUri, mimeType } from ai.files.upload().
export async function generateJsonWithFile(prompt, fileData) {
  const ai = getClient();
  const response = await generateWithRetry(ai, [
    { role: "user", parts: [{ fileData }, { text: prompt }] },
  ]);
  return extractJson(response.text);
}

// Upload a local file to the Gemini Files API and wait until it's ACTIVE
// (video needs a short processing pass before it can be referenced).
export async function uploadFileForAnalysis(filePath, mimeType = "video/mp4") {
  const ai = getClient();
  const up = await ai.files.upload({ file: filePath, config: { mimeType } });
  const name = up.name;
  for (let i = 0; i < 40; i++) {
    const f = await ai.files.get({ name });
    if (f.state === "ACTIVE") return { fileUri: f.uri, mimeType: f.mimeType || mimeType, name };
    if (f.state === "FAILED") throw new Error("Gemini could not process the video file.");
    await sleep(1500);
  }
  throw new Error("Video processing timed out on Gemini's side.");
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
