// Speech-to-text via Groq's free Whisper tier (word-level timestamps).
// Get a free key at https://console.groq.com and set GROQ_API_KEY.
// Falls back gracefully when unset so the editor still works with
// segment-level captions from the edit-plan model instead.

import fs from "node:fs";

export function hasWhisperKey() {
  return !!process.env.GROQ_API_KEY;
}

// Returns { text, words: [{word, start, end}], segments: [{start, end, text}] }
export async function transcribeAudio(audioPath, { language } = {}) {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    const err = new Error("Groq API key not set. Add GROQ_API_KEY for word-accurate captions (free at console.groq.com).");
    err.code = "NO_GROQ_KEY";
    throw err;
  }
  const buf = fs.readFileSync(audioPath);
  const form = new FormData();
  form.append("file", new Blob([buf], { type: "audio/mpeg" }), "audio.mp3");
  form.append("model", "whisper-large-v3-turbo");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("timestamp_granularities[]", "segment");
  if (language) form.append("language", language);

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Whisper failed (${res.status}): ${text.slice(0, 200)}`);
    err.code = "WHISPER_FAILED";
    throw err;
  }
  const d = await res.json();
  return {
    text: d.text || "",
    words: (d.words || []).map((w) => ({ word: w.word.trim(), start: w.start, end: w.end })).filter((w) => w.word),
    segments: (d.segments || []).map((s) => ({ start: s.start, end: s.end, text: (s.text || "").trim() })),
  };
}
