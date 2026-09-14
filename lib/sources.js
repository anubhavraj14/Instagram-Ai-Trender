// Free, no-API-key trend signal collection.
// Pulls fresh items from Google News RSS + Reddit JSON so we don't need paid web search.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) TrendRadar/1.0 (+personal use)";

// Instagram-only Google News queries. Edit these to retune what the radar watches.
const NEWS_QUERIES = [
  "Instagram Reels update",
  "Instagram algorithm change",
  "Instagram new feature creators",
  "Meta Instagram creators announcement",
  "Instagram Reels trend",
  "Instagram monetization creators",
  "Instagram Reels AI editing tool",
  "Instagram growth strategy",
  "Instagram Reels hook viral",
  "Instagram content creator tips",
];

// Instagram-focused subreddits where creators discuss what's working right now.
const SUBREDDITS = [
  "Instagram",
  "InstagramMarketing",
  "InstagramReels",
  "InstagramGrowthTips",
  "socialmedia",
];

const withTimeout = (ms) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
};

function decode(s = "") {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]) : "";
};

async function fetchNews(query, recency = "2d") {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
    query
  )}%20when:${recency}&hl=en-US&gl=US&ceid=US:en`;
  const t = withTimeout(12000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: t.signal });
    if (!res.ok) return [];
    const xml = await res.text();
    const items = xml.split("<item>").slice(1, 8);
    return items.map((raw) => {
      const title = tag(raw, "title");
      const sourceName = tag(raw, "source") || "Google News";
      return {
        title: title.replace(new RegExp(` - ${sourceName}$`), ""),
        url: tag(raw, "link"),
        source: sourceName,
        publishedAt: tag(raw, "pubDate"),
        origin: `news:${query}`,
      };
    }).filter((i) => i.title && i.url);
  } catch {
    return [];
  } finally {
    t.done();
  }
}

async function fetchReddit(sub, t_range = "day") {
  const url = `https://www.reddit.com/r/${sub}/top.json?t=${t_range}&limit=8`;
  const t = withTimeout(12000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: t.signal });
    if (!res.ok) return [];
    const json = await res.json();
    return (json?.data?.children || []).map((c) => {
      const p = c.data || {};
      return {
        title: p.title,
        url: `https://reddit.com${p.permalink}`,
        source: `r/${sub}`,
        publishedAt: p.created_utc ? new Date(p.created_utc * 1000).toUTCString() : "",
        score: p.score,
        origin: `reddit:${sub}`,
      };
    }).filter((i) => i.title && i.url);
  } catch {
    return [];
  } finally {
    t.done();
  }
}

function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = item.title.toLowerCase().slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export async function fetchTrendSignals() {
  const results = await Promise.all([
    ...NEWS_QUERIES.map(fetchNews),
    ...SUBREDDITS.map(fetchReddit),
  ]);
  return dedupe(results.flat());
}

// Signals about what viral formats / ideas are working in the niche (less time-sensitive).
const VIRAL_QUERIES = [
  "viral Instagram Reels ideas",
  "best Instagram Reels format",
  "Instagram Reels hooks that go viral",
  "Instagram Reels ideas India",
  "how creators went viral Instagram",
  "Instagram Reels content ideas creators",
  "Instagram growth viral strategy",
  "trending Instagram Reels this week",
];

export async function fetchViralSignals() {
  const results = await Promise.all([
    ...VIRAL_QUERIES.map((q) => fetchNews(q, "30d")),
    ...SUBREDDITS.map((s) => fetchReddit(s, "week")),
  ]);
  return dedupe(results.flat());
}
