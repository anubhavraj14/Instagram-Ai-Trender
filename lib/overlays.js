// Keyless graphic-overlay search: transparent stickers, icons, badges, arrows,
// circles/shapes, emoji, and emphasis graphics — for pop-ups, "EPISODE 1" style
// badges, highlight circles, pointer arrows, and reaction stickers.
//
// Sources (all FREE, NO API KEY, NO AI image generation — real openly-licensed art):
//   - Iconify  (https://iconify.design) — searchable index of 200k+ icons/emoji
//     from dozens of open icon sets. Returns a scalable TRANSPARENT SVG per icon.
//   - wsrv.nl  (https://wsrv.nl) — keyless image CDN that rasterizes those SVGs
//     into real TRANSPARENT PNGs (RGBA) so creators can drop them into any editor.
//
// Nothing here needs a key, so overlays are always available.

const ICONIFY_SEARCH = "https://api.iconify.design/search";

// Each overlay "kind" maps to the icon sets that look right for it, so a request
// for a sticker returns flat color emoji art, a badge returns bold shapes, etc.
// Order matters: earlier prefixes are preferred by Iconify's relevance ranking.
const KIND_PREFIXES = {
  sticker: ["twemoji", "noto", "fluent-emoji", "openmoji", "streamline-emojis"],
  emoji: ["twemoji", "noto", "fluent-emoji", "openmoji"],
  badge: ["mdi", "ph", "tabler", "solar", "material-symbols", "fluent"],
  icon: ["mdi", "tabler", "ph", "lucide", "solar", "material-symbols"],
  arrow: ["mdi", "ph", "tabler", "lucide", "solar", "iconoir"],
  shape: ["mdi", "ph", "tabler", "material-symbols", "iconoir"], // circles, bursts, speech bubbles
  emphasis: ["noto", "twemoji", "mdi", "ph", "tabler"], // 100, fire, sparkles, stars, pins
};

// Kinds that are already full-color art — don't recolor these.
const FULL_COLOR = new Set(["sticker", "emoji", "emphasis"]);

function normalizeKind(kind) {
  const k = String(kind || "").toLowerCase().trim();
  if (KIND_PREFIXES[k]) return k;
  // Friendly aliases the model might emit.
  if (/pop|bubble|circle|burst|ring|shape/.test(k)) return "shape";
  if (/arrow|point|pointer/.test(k)) return "arrow";
  if (/badge|ribbon|banner|tag|label|stamp/.test(k)) return "badge";
  if (/emoji/.test(k)) return "emoji";
  if (/emphas|highlight|reaction|sticker/.test(k)) return "sticker";
  return "icon";
}

function cleanHex(color) {
  const m = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.exec(String(color || "").trim());
  return m ? `#${m[1]}` : "";
}

// Build a transparent SVG URL straight from Iconify (scalable, editor-friendly).
function svgUrl(name, { color = "", height = 240 } = {}) {
  const [prefix, icon] = name.split(":");
  if (!prefix || !icon) return "";
  const params = new URLSearchParams();
  const c = cleanHex(color);
  if (c) params.set("color", c);
  params.set("height", String(height));
  return `https://api.iconify.design/${prefix}/${icon}.svg?${params.toString()}`;
}

// Rasterize an SVG into a real transparent PNG via the keyless wsrv.nl CDN.
function pngUrl(svg, size = 400) {
  if (!svg) return "";
  const bare = svg.replace(/^https?:\/\//, "");
  return `https://wsrv.nl/?url=${encodeURIComponent(bare)}&w=${size}&output=png`;
}

const prettyName = (name) =>
  (name.split(":")[1] || name).replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const STOP = new Set(["a", "an", "the", "of", "for", "and", "or", "with", "to", "in", "on", "my", "your"]);

// Iconify matches against icon NAMES, so multi-word phrases often miss. Build a
// ranked list of query variants: the full phrase first (most specific), then the
// strongest single words, so we always surface a relevant graphic.
function queryVariants(q) {
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));
  const out = [q];
  if (words.length > 1) out.push(words.join(" "), ...words.slice().reverse());
  else if (words[0] && words[0] !== q) out.push(words[0]);
  return [...new Set(out)];
}

async function iconifySearch(query, prefixes, limit) {
  const params = new URLSearchParams({ query, limit: String(Math.min(60, limit + 10)) });
  if (prefixes) params.set("prefixes", prefixes);
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 10000);
  try {
    const res = await fetch(`${ICONIFY_SEARCH}?${params}`, { signal: c.signal });
    if (!res.ok) return [];
    return (await res.json()).icons || [];
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

// Search for overlay graphics matching a concept. Returns ready-to-use assets:
//   { url(PNG), svgUrl, thumb, name, label, source, set, kind, type, transparent }
export async function searchOverlayOptions(query, { kind = "sticker", color = "", limit = 6 } = {}) {
  const q = String(query || "").trim();
  if (!q) {
    const err = new Error("Empty overlay query");
    err.code = "BAD_QUERY";
    throw err;
  }
  const k = normalizeKind(kind);
  const prefixes = KIND_PREFIXES[k].join(",");
  const recolor = FULL_COLOR.has(k) ? "" : cleanHex(color);

  // Try each query variant against the on-style sets first, then fall back to all
  // sets — stop as soon as we have enough relevant icons.
  let icons = [];
  const seen = new Set();
  const collect = (list) => {
    for (const name of list) {
      if (!seen.has(name)) { seen.add(name); icons.push(name); }
    }
  };
  for (const variant of queryVariants(q)) {
    if (icons.length >= limit) break;
    collect(await iconifySearch(variant, prefixes, limit));
  }
  for (const variant of queryVariants(q)) {
    if (icons.length >= limit) break;
    collect(await iconifySearch(variant, "", limit)); // all sets
  }

  if (!icons.length) {
    const err = new Error(`No overlay graphic found for "${q}"`);
    err.code = "NO_OVERLAY";
    throw err;
  }

  return icons.slice(0, limit).map((name) => {
    const svg = svgUrl(name, { color: recolor, height: 240 });
    return {
      name,
      label: prettyName(name),
      url: pngUrl(svg, 400), // real transparent PNG, download-ready
      svgUrl: svg, // scalable transparent SVG
      thumb: pngUrl(svgUrl(name, { color: recolor, height: 120 }), 120),
      width: 400,
      height: 400,
      source: "iconify",
      set: name.split(":")[0],
      kind: k,
      type: "sticker",
      transparent: true,
    };
  });
}

// Overlays never need a key, so they're always on.
export function hasOverlaySource() {
  return true;
}
