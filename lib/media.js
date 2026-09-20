// Stock media search helpers for B-roll, photos, and BGM.
// Tries multiple free sources and returns several options so the user can pick the best fit.

// --- Pexels (existing key) ---
const PEXELS_IMG_API = "https://api.pexels.com/v1/search";
const PEXELS_VID_API = "https://api.pexels.com/videos/search";

function hasPexelsKey() {
  return !!process.env.PEXELS_API_KEY;
}

function hashPick(str, len) {
  let h = 7;
  for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return len ? h % len : 0;
}

function isDark(hex = "") {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110;
}

async function searchPexelsImages(query, { mood = "", limit = 5 } = {}) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) throw new Error("Pexels key missing");
  const params = new URLSearchParams({ query, per_page: String(limit + 5), orientation: "portrait" });
  const res = await fetch(`${PEXELS_IMG_API}?${params}`, { headers: { Authorization: key } });
  if (res.status === 429) throw new Error("Pexels rate limit");
  if (!res.ok) throw new Error(`Pexels image ${res.status}`);
  const data = await res.json();
  let photos = data.photos || [];
  if (!photos.length) throw new Error("no Pexels images");
  if (mood === "dark") {
    const dark = photos.filter((p) => isDark(p.avg_color));
    if (dark.length) photos = dark;
  } else if (mood === "bright" || mood === "minimal") {
    const bright = photos.filter((p) => !isDark(p.avg_color));
    if (bright.length) photos = bright;
  }
  return photos.slice(0, limit).map((pick) => {
    const base = (pick.src?.original || pick.src?.large2x || "").split("?")[0];
    return {
      url: base ? `${base}?auto=compress&cs=tinysrgb&fit=crop&w=1080&h=1350` : pick.src?.portrait || pick.src?.large2x,
      thumb: pick.src?.small || pick.src?.portrait,
      width: pick.width,
      height: pick.height,
      credit: pick.photographer,
      source: "pexels",
      pageUrl: pick.url,
      type: "image",
    };
  });
}

async function searchPexelsVideos(query, { limit = 5 } = {}) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) throw new Error("Pexels key missing");
  const res = await fetch(
    `${PEXELS_VID_API}?query=${encodeURIComponent(query)}&per_page=${limit + 3}&orientation=portrait&size=medium`,
    { headers: { Authorization: key } }
  );
  if (!res.ok) throw new Error(`Pexels video ${res.status}`);
  const d = await res.json();
  const out = [];
  for (const video of d.videos || []) {
    const files = (video.video_files || [])
      .filter((f) => f.link && f.width && f.height)
      .sort((a, b) => Math.abs(a.width - 720) - Math.abs(b.width - 720));
    const file = files.find((f) => f.width <= 1280) || files[0];
    if (file) {
      out.push({
        url: file.link,
        thumb: video.image,
        width: file.width,
        height: file.height,
        duration: video.duration,
        credit: video.user?.name || "Pexels",
        source: "pexels",
        pageUrl: video.url,
        type: "video",
      });
    }
    if (out.length >= limit) break;
  }
  if (!out.length) throw new Error("no Pexels videos");
  return out;
}

// --- Pixabay fallback (needs PIXABAY_API_KEY) ---
function hasPixabayKey() {
  return !!process.env.PIXABAY_API_KEY;
}

async function searchPixabayVideos(query, { limit = 5 } = {}) {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) throw new Error("Pixabay key missing");
  const params = new URLSearchParams({ key, q: query, per_page: String(limit + 3), orientation: "vertical", video_type: "film" });
  const res = await fetch(`https://pixabay.com/api/videos/?${params}`);
  if (!res.ok) throw new Error(`Pixabay video ${res.status}`);
  const d = await res.json();
  const out = [];
  for (const hit of d.hits || []) {
    if (!hit.videos) continue;
    const sizes = ["large", "medium", "small"];
    let file;
    for (const size of sizes) file = file || hit.videos[size];
    if (file?.url) {
      out.push({
        url: file.url,
        thumb: hit.videos?.small?.url || hit.videos?.medium?.url,
        width: file.width,
        height: file.height,
        duration: hit.duration,
        credit: hit.user,
        source: "pixabay",
        pageUrl: hit.pageURL,
        type: "video",
      });
    }
    if (out.length >= limit) break;
  }
  if (!out.length) throw new Error("no Pixabay videos");
  return out;
}

async function searchPixabayImages(query, { limit = 5 } = {}) {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) throw new Error("Pixabay key missing");
  const params = new URLSearchParams({ key, q: query, per_page: String(limit + 3), orientation: "vertical" });
  const res = await fetch(`https://pixabay.com/api/?${params}`);
  if (!res.ok) throw new Error(`Pixabay image ${res.status}`);
  const d = await res.json();
  const out = (d.hits || []).slice(0, limit).map((hit) => ({
    url: hit.largeImageURL || hit.webformatURL,
    thumb: hit.previewURL || hit.webformatURL,
    width: hit.imageWidth,
    height: hit.imageHeight,
    credit: hit.user,
    source: "pixabay",
    pageUrl: hit.pageURL,
    type: "image",
  }));
  if (!out.length) throw new Error("no Pixabay images");
  return out;
}

// --- Free To Use music (no API key) ---
const FTU_API = "https://api.freetouse.com/v3/music/tracks/search";

async function searchFreeToUseMusic(query, { limit = 5, fallbacks = ["background music"] } = {}) {
  const singleWords = (query || "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !/^(a|an|the|for|and|of|in|on|at|to|with)$/i.test(w));
  const terms = [query, ...singleWords, ...fallbacks];
  const seen = new Set();
  const out = [];
  for (const q of terms) {
    if (seen.has(q)) continue;
    seen.add(q);
    const params = new URLSearchParams({ query: q, limit: String(limit + 3) });
    const res = await fetch(`${FTU_API}?${params.toString()}`);
    if (!res.ok) continue;
    const d = await res.json();
    for (const pick of d.data || []) {
      if (!pick.files?.mp3) continue;
      const artist = pick.artists?.[0]?.[1]?.name || "Unknown";
      const item = {
        url: pick.files.mp3,
        thumb: pick.thumbnails?.md || "",
        title: pick.title,
        artist,
        duration: pick.duration,
        genre: pick.genre,
        source: "freetouse",
        matchedQuery: q,
      };
      if (!out.some((x) => x.url === item.url)) out.push(item);
      if (out.length >= limit) return out;
    }
  }
  if (!out.length) throw new Error("no FreeToUse tracks");
  return out;
}

// --- Public helpers ---
export function mediaConfig() {
  return { pexels: hasPexelsKey(), pixabay: hasPixabayKey() };
}

// Return several B-roll options. Order: Pexels video -> Pixabay video -> Pexels image -> Pixabay image.
export async function searchBrollOptions(query, preferType = "video", limit = 5) {
  const results = [];
  const errors = [];

  const tryCollect = async (fn) => {
    try {
      const items = await fn();
      for (const item of items) {
        if (!results.some((r) => r.url === item.url)) results.push(item);
      }
    } catch (e) {
      errors.push(e.message);
    }
  };

  if (preferType === "video") {
    if (hasPexelsKey()) await tryCollect(() => searchPexelsVideos(query, { limit }));
    if (hasPixabayKey()) await tryCollect(() => searchPixabayVideos(query, { limit }));
    if (results.length < limit && hasPexelsKey()) await tryCollect(() => searchPexelsImages(query, { limit: limit - results.length }));
    if (results.length < limit && hasPixabayKey()) await tryCollect(() => searchPixabayImages(query, { limit: limit - results.length }));
  } else {
    if (hasPexelsKey()) await tryCollect(() => searchPexelsImages(query, { limit }));
    if (hasPixabayKey()) await tryCollect(() => searchPixabayImages(query, { limit }));
    if (results.length < limit && hasPexelsKey()) await tryCollect(() => searchPexelsVideos(query, { limit: limit - results.length }));
    if (results.length < limit && hasPixabayKey()) await tryCollect(() => searchPixabayVideos(query, { limit: limit - results.length }));
  }

  if (!results.length) throw new Error(errors.join("; ") || "no media API configured");
  return results.slice(0, limit);
}

// Backwards-compatible single-result wrapper.
export async function searchBroll(query, preferType = "video") {
  const opts = await searchBrollOptions(query, preferType, 1);
  return opts[0];
}

export async function searchMusicOptions(query, { limit = 5, fallbacks = ["background music"] } = {}) {
  return searchFreeToUseMusic(query, { limit, fallbacks });
}

export async function searchMusic(query, fallbacks = ["background music"]) {
  const opts = await searchMusicOptions(query, { limit: 1, fallbacks });
  return opts[0];
}
