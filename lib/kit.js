// Shared media resolution for "asset kit" shaped payloads (Script Kit, generated
// Reels). Resolves B-roll options per beat (Pexels -> Pixabay, video -> image),
// transparent graphic overlays (stickers/icons/badges/arrows, keyless), and BGM
// options (Free To Use, no key) — all free sources.
import { searchBrollOptions, searchMusicOptions, searchOverlayOptions, mediaConfig } from "./media.js";

// Resolve a flat list of overlay objects ({ kind, query, ... }) in place, attaching
// `.options` (transparent sticker/icon/badge assets). Best-effort + free/keyless.
// Shared by the Story and Post generators.
export async function resolveOverlays(overlays = []) {
  await Promise.all(
    (overlays || [])
      .filter((ov) => ov && ov.query)
      .map((ov) =>
        searchOverlayOptions(ov.query, { kind: ov.kind || "sticker", limit: 5 })
          .then((opts) => {
            ov.options = opts;
            if (opts[0]) { ov.assetUrl = opts[0].url; ov.svgUrl = opts[0].svgUrl; }
          })
          .catch((err) => { console.warn(`overlay "${ov.query}" skipped: ${err.message}`); })
      )
  );
}

// Try the hyper-specific query first; fall back to the AI's on-topic altQuery only
// if the specific one returns nothing — keeps results relevant, never generic.
async function resolveBrollWithFallback(br, preferType) {
  try {
    return await searchBrollOptions(br.query, preferType, 4);
  } catch (err) {
    if (br.altQuery && br.altQuery !== br.query) {
      try {
        const out = await searchBrollOptions(br.altQuery, preferType, 4);
        if (out.length) return out;
      } catch {}
    }
    throw err;
  }
}

export async function resolveKitMedia(kit) {
  const beats = Array.isArray(kit.beats) ? kit.beats : [];

  const brollJobs = [];
  for (const beat of beats) {
    const br = beat.broll;
    if (!br?.needed || !br?.query) continue;
    brollJobs.push(
      resolveBrollWithFallback(br, br.media === "image" ? "image" : "video")
        .then((out) => {
          br.options = out;
          if (out[0]) {
            br.media = out[0].type;
            br.mediaUrl = out[0].url;
          }
        })
        .catch((err) => {
          console.warn(`kit b-roll "${br.query}" skipped: ${err.message}`);
        })
    );
  }

  // Resolve transparent graphic overlays per beat (stickers/icons/badges/arrows).
  const overlayJobs = [];
  for (const beat of beats) {
    const overlays = Array.isArray(beat.overlays) ? beat.overlays : [];
    for (const ov of overlays) {
      if (!ov?.query) continue;
      overlayJobs.push(
        searchOverlayOptions(ov.query, { kind: ov.kind || "sticker", limit: 6 })
          .then((out) => {
            ov.options = out;
            if (out[0]) { ov.assetUrl = out[0].url; ov.svgUrl = out[0].svgUrl; }
          })
          .catch((err) => {
            console.warn(`kit overlay "${ov.query}" skipped: ${err.message}`);
          })
      );
    }
  }

  await Promise.all([...brollJobs, ...overlayJobs]);

  const bgmJobs = (kit.bgm || []).map(async (m) => {
    const query = m.searchQuery || m.name || m.mood || "background music";
    const fallbacks = [
      m.mood && `${m.mood} instrumental`,
      m.energyLevel === "high" ? "energetic upbeat instrumental" : m.energyLevel === "low" ? "ambient chill instrumental" : "background music instrumental",
      "background music",
    ].filter(Boolean);
    try {
      const tracks = await searchMusicOptions(query, { limit: 4, fallbacks });
      m.options = tracks;
      if (tracks[0]) {
        m.trackUrl = tracks[0].url;
        m.title = tracks[0].title;
        m.artist = tracks[0].artist;
        m.duration = tracks[0].duration;
        m.source = tracks[0].source;
      }
    } catch (err) {
      console.warn(`kit bgm "${query}" skipped: ${err.message}`);
    }
  });
  await Promise.all(bgmJobs);

  kit.media = mediaConfig();
  return kit;
}
