// Shared media resolution for "asset kit" shaped payloads (Script Kit, generated
// Reels). Resolves B-roll options per beat (Pexels -> Pixabay, video -> image)
// and BGM options (Free To Use, no key) — all free sources.
import { searchBrollOptions, searchMusicOptions, mediaConfig } from "./media.js";

export async function resolveKitMedia(kit) {
  const beats = Array.isArray(kit.beats) ? kit.beats : [];

  const brollJobs = [];
  for (const beat of beats) {
    const br = beat.broll;
    if (!br?.needed || !br?.query) continue;
    brollJobs.push(
      searchBrollOptions(br.query, br.media === "image" ? "image" : "video", 4)
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
  await Promise.all(brollJobs);

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
