import { createHash } from "node:crypto";

export const CAROUSEL_IMAGE_STYLE = `Create an original, premium editorial artwork for an Instagram carousel, portrait 4:5.
A single arresting visual metaphor, surprising scale, tactile detail, dramatic directional light,
strong focal point and deliberate negative space. NOT a generic stock photo, office worker,
handshake, person pointing at a laptop, or motivational quote card.
Keep the main subject in the lower 45 percent. The upper 55 percent is calm dark negative space
for white typography added separately. Rich color, luminous highlights, deep but detailed shadows.
No text, letters, numbers, fake UI, brand logos or typography in the artwork.`;

export function buildCarouselImagePrompt({ prompt, direction = "" }) {
  return `${CAROUSEL_IMAGE_STYLE}\nSeries art direction: ${String(direction).slice(0, 600) || "midnight blue, warm amber highlights, surreal cinematic photography"}\nScene: ${String(prompt).slice(0, 1800)}`;
}

export function createFreeImageGenerator({ fetchImage = fetch, now = Date.now } = {}) {
  let busy = false;
  let nextStart = 0;
  return async (prompt) => {
    if (busy || now() < nextStart) {
      const error = new Error("Free image generation is queued. Please wait for the next slot.");
      error.code = "IMAGE_BUSY";
      error.retryAfter = Math.max(5, Math.ceil((nextStart - now()) / 1000));
      throw error;
    }
    busy = true;
    nextStart = now() + 46000;
    try {
      const seed = createHash("sha256").update(prompt).digest().readUInt32BE(0);
      const url = new URL(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`);
      url.search = new URLSearchParams({ width: "680", height: "850", seed: String(seed), safe: "true" });
      const response = await fetchImage(url, { signal: AbortSignal.timeout(90000) });
      if (response.status === 402 || response.status === 429) {
        const raw = Number(response.headers.get("retry-after"));
        const retryAfter = Number.isFinite(raw) && raw > 0 ? Math.min(120, Math.ceil(raw)) : 46;
        nextStart = Math.max(nextStart, now() + retryAfter * 1000);
        const error = new Error("Free image provider is rate limited.");
        error.code = "IMAGE_BUSY";
        error.retryAfter = retryAfter;
        throw error;
      }
      if (!response.ok) throw new Error(`Free image provider returned ${response.status}`);
      const mime = response.headers.get("content-type")?.split(";")[0].trim();
      if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") {
        throw new Error("Free image provider did not return an image");
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 1024 || bytes.length > 1000000) throw new Error("Free image provider returned an invalid image size");
      return { url: `data:${mime};base64,${bytes.toString("base64")}`, source: "pollinations", generated: true };
    } finally {
      busy = false;
    }
  };
}

export const generateFreeCarouselImage = createFreeImageGenerator();
