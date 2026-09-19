// Real web-sourced slide images via the Pexels API (free key).
// Returns a portrait (4:5-ish) photo URL best matching the search query.
// Get a free key at https://www.pexels.com/api/ and set PEXELS_API_KEY.

const API = "https://api.pexels.com/v1/search";

export function hasPexelsKey() {
  return !!process.env.PEXELS_API_KEY;
}

// Deterministic pick so the same query maps to the same photo (stable across reloads/cache).
function hashPick(str, len) {
  let h = 7;
  for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return len ? h % len : 0;
}

export async function searchPexelsImage(query, { mood = "" } = {}) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) {
    const err = new Error("Pexels API key not set. Add PEXELS_API_KEY to your .env (free at pexels.com/api).");
    err.code = "NO_PEXELS_KEY";
    throw err;
  }
  const q = String(query || "").trim();
  if (!q) {
    const err = new Error("Empty image query");
    err.code = "BAD_QUERY";
    throw err;
  }

  const params = new URLSearchParams({
    query: q,
    per_page: "15",
    orientation: "portrait",
  });

  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 12000);
  try {
    const res = await fetch(`${API}?${params}`, {
      headers: { Authorization: key },
      signal: c.signal,
    });
    if (res.status === 429) {
      const err = new Error("Pexels rate limit reached (free tier: 200/hr). Try again shortly.");
      err.code = "PEXELS_RATE_LIMIT";
      throw err;
    }
    if (!res.ok) throw new Error(`Pexels error ${res.status}`);
    const data = await res.json();
    const photos = data.photos || [];
    if (!photos.length) {
      const err = new Error(`No Pexels photo found for "${q}"`);
      err.code = "NO_PHOTO";
      throw err;
    }
    // Pick deterministically from the top results; bias by mood via avg_color when possible.
    let pool = photos;
    if (mood === "dark") {
      const dark = photos.filter((p) => isDark(p.avg_color));
      if (dark.length) pool = dark;
    } else if (mood === "bright" || mood === "minimal") {
      const bright = photos.filter((p) => !isDark(p.avg_color));
      if (bright.length) pool = bright;
    }
    const pick = pool[hashPick(q, pool.length)];
    // Build an exact 1080x1350 (4:5) crop off the CDN so slides are portrait & crisp.
    const base = (pick.src?.original || pick.src?.large2x || "").split("?")[0];
    const url = base
      ? `${base}?auto=compress&cs=tinysrgb&fit=crop&w=1080&h=1350`
      : pick.src?.portrait || pick.src?.large2x;
    return {
      url,
      photographer: pick.photographer,
      photographerUrl: pick.photographer_url,
      pexelsUrl: pick.url,
    };
  } finally {
    clearTimeout(t);
  }
}

function isDark(hex = "") {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  // relative luminance
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110;
}

// Search Pexels for a portrait stock VIDEO clip (Reel Editor B-roll).
// Returns { url, width, height, duration, credit } — url is a direct mp4 link.
export async function searchPexelsVideo(query) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) {
    const err = new Error("Pexels API key not set.");
    err.code = "NO_PEXELS_KEY";
    throw err;
  }
  const res = await fetch(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=5&orientation=portrait&size=medium`,
    { headers: { Authorization: key } }
  );
  if (!res.ok) {
    const err = new Error(`Pexels video search failed (${res.status})`);
    err.code = "PEXELS_FAILED";
    throw err;
  }
  const d = await res.json();
  for (const video of d.videos || []) {
    const files = (video.video_files || [])
      .filter((f) => f.link && f.width && f.height)
      .sort((a, b) => Math.abs(a.width - 720) - Math.abs(b.width - 720));
    const file = files.find((f) => f.width <= 1280) || files[0];
    if (file) {
      return {
        url: file.link,
        width: file.width,
        height: file.height,
        duration: video.duration,
        credit: video.user?.name || "Pexels",
      };
    }
  }
  return null;
}
