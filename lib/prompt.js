// Builds the research prompt + the JSON schema Claude must return.
// The whole "brain" of the app lives here — tweak this to change what it looks for.

export const DEFAULT_NICHE =
  "Helping creators grow on Instagram through Reels, hooks, storytelling, editing, AI tools, creator strategy, and content ideas.";

// The Hinglish scriptwriting playbook the model must follow for every script.
export const HINGLISH_SCRIPT_GUIDE = `
=== HINGLISH SCRIPT RULES (very important) ===
The creator and audience are INDIAN. Every "script" MUST be in HINGLISH written in ROMAN script
(Hindi + English mixed, the way real Indian creators actually talk in Reels). Do NOT write in
pure English and do NOT write in Devanagari. It must sound like a real human speaking casually
to a friend — NOT like a formal essay, NOT AI-generated, NOT robotic.

HOW REAL HINGLISH REELS ARE WRITTEN (learn from these techniques):
1) HOOK (0-3 sec) — stop the scroll. Use one of these proven patterns:
   - Bold claim / contrarian: "Reels viral karne ke liye followers ki zaroorat nahi hai."
   - Direct callout: "Agar tum bhi creator ho aur views nahi aa rahe, toh ye sun lo."
   - Pain point: "Ghante lagake edit karte ho phir bhi 200 views? Galti yahan ho rahi hai."
   - Curiosity / open loop: "Instagram ne chupke se ek feature diya hai jo game change kar dega."
   - Number promise: "3 cheezein jo aaj hi apne Reels me change karo."
   The on-screen text hook should be short & punchy, often different words than spoken hook.
2) BUILD (3-8 sec) — retention. Agitate the problem or raise the stakes so they keep watching.
   Keep an open loop ("aage batati hoon", "last tak ruko") but don't overdo it.
3) VALUE / MIDDLE — deliver the actual meat: concrete steps, the "how", specific and doable.
   Short punchy lines. One idea per line. Give a real example so it feels practical.
4) CTA — soft, specific, single ask. E.g. "Save kar lo taaki bhool na jao", "Comment karo 'REEL'
   aur main DM me bhej dungi", "Follow for part 2". Never stack multiple CTAs.

TONE & LANGUAGE:
- Conversational Hinglish: "tum/aap", "yaar", "bhai/dost", "matlab", "basically", "seedha point".
- Mix natural English words creators actually use: hook, reach, algorithm, edit, trend, viral,
  save, share, engagement, niche, content.
- Short sentences. Spoken rhythm. Contractions. Real, not perfect grammar.
- India-relevant references where natural. Keep it authentic, not cringe.
- Total length ~25-40 seconds of speaking. 5-9 lines in "lines".
- Each line in "lines" = one spoken beat with matching on-screen text + a visual/shot idea.

MINI EXAMPLE (style reference only — do NOT reuse this content):
{
  "hook": "Agar teri Reels ki reach gir gayi hai, toh 90% chance ye galti kar raha hai.",
  "onScreenHook": "Reach gir gayi? Ye dekh 👇",
  "lines": [
    { "part": "hook", "say": "Agar teri Reels ki reach achanak gir gayi hai, ruk zara.", "text": "Reach DOWN?", "visual": "Talking to camera, close up, quick zoom in" },
    { "part": "build", "say": "Problem tera content nahi, problem hai pehle 1 second.", "text": "Pehla 1 second", "visual": "Show a boring vs punchy first frame side by side" },
    { "part": "value", "say": "Pehli line me hi audience ka dard bol — 'views nahi aa rahe na?'", "text": "Bol unka dard", "visual": "Screen-record example hook text" },
    { "part": "value", "say": "Aur first frame pe bada text daal, chehra baad me dikha.", "text": "Text first, face later", "visual": "Editing timeline demo" },
    { "part": "cta", "say": "Ye chhoti si trick save kar le, kal ki Reel me use karna.", "text": "SAVE karo", "visual": "Point to save icon, bounce animation" }
  ],
  "caption": "Reels ki reach kaise wapas laaye 👀 in-app search ke liye keywords bhi daalo. #instagramgrowth",
  "hashtags": ["#reelsindia", "#instagramgrowth", "#reelstips", "#contentcreatorindia", "#viralreels"]
}
`;

// The structured shape we ask Claude to emit as its FINAL message (after searching).
export const OUTPUT_SCHEMA = `
Return ONLY a single valid JSON object (no markdown fences, no commentary) matching:

{
  "generatedAt": "ISO-8601 timestamp",
  "niche": "string",
  "summary": "2-3 sentence executive summary of today's landscape",
  "findings": [
    {
      "id": "short-slug",
      "title": "Punchy name of the trend/update",
      "category": "Instagram/Meta update | Reel format/trend | Creator/AI news | Search/discovery trend | Creator discussion | Creator-education account",
      "ranking": "POST NOW | WATCH | IGNORE",
      "novelty": "genuinely-new | evergreen",
      "freshnessHours": 0,
      "whatChanged": "What changed or is trending, concretely.",
      "whyCare": "Why creators in this niche should care.",
      "timing": "Is it early enough to act on? Be honest about saturation.",
      "howToAdapt": "How to adapt it to THIS niche without copying the original.",
      "reelConcept": {
        "hook": "The exact first line / on-screen text (strong, scroll-stopping).",
        "visual": "How to shoot/edit it: shots, b-roll, text, pacing, format.",
        "cta": "The call to action / caption angle."
      },
      "script": {
        "durationSeconds": 30,
        "hook": "Spoken HINGLISH hook line for the first 0-3 seconds. Roman script, sounds like a real Indian creator talking to a friend.",
        "onScreenHook": "Bold text overlay shown on the very first frame (short, punchy Hinglish/English).",
        "lines": [
          {
            "part": "hook | build | value | cta",
            "say": "The exact HINGLISH line the creator speaks (Roman script). Natural, spoken, not bookish.",
            "text": "On-screen text overlay for this beat (keep short).",
            "visual": "What to show on screen: shot / action / b-roll / screen-recording."
          }
        ],
        "caption": "Instagram caption in HINGLISH with a strong first line + keywords for in-app search (SEO).",
        "hashtags": ["#reelsindia", "#instagramgrowth", "8-12 relevant mixed Hindi/English tags"]
      },
      "confidence": "high | medium | low",
      "sources": [ { "title": "string", "url": "string" } ]
    }
  ],
  "topThree": [
    { "id": "matches a finding id", "why": "one line on why it's a top pick for TODAY" }
  ],
  "sourcesUsed": [ { "title": "string", "url": "string" } ]
}
`;

// Schema for the "Viral Reels" page: proven high-performing formats with original-style
// (reconstructed) script + an improved, differentiated version.
export const VIRAL_SCHEMA = `
Return ONLY a single valid JSON object (no markdown fences, no commentary) matching:

{
  "generatedAt": "ISO-8601 timestamp",
  "niche": "string",
  "summary": "2-3 sentence overview of what's working in this niche right now",
  "blueprints": [
    {
      "id": "short-slug",
      "title": "Name of the viral reel format/topic",
      "format": "e.g. Talking-head hook + list | POV | Screen-record tutorial | Before/After | Story-time",
      "successLevel": "PROVEN | STRONG | EMERGING",
      "whyItWorks": "The psychology / retention mechanic that makes this format perform (specific).",
      "successSignals": "Why we believe it has a high success rate (saves, shares, watch-time, replication).",
      "exampleCreators": ["Types of accounts or well-known creator-education names in this niche that use it (be honest; say 'representative' if unsure)"],
      "originalStyle": {
        "note": "REPRESENTATIVE reconstruction of how this format is typically done — NOT a copy of any one creator's exact words.",
        "hook": "Typical HINGLISH hook line used in this format.",
        "lines": [
          { "part": "hook | build | value | cta", "say": "typical HINGLISH spoken line", "text": "on-screen text" }
        ],
        "caption": "typical caption style",
        "hashtags": ["#..."]
      },
      "improvedScript": {
        "whatsDifferent": "How THIS version stands out and avoids looking copied (fresh angle, better hook, unique example).",
        "durationSeconds": 30,
        "hook": "Improved spoken HINGLISH hook (stronger, original).",
        "onScreenHook": "Bold first-frame text overlay.",
        "lines": [
          { "part": "hook | build | value | cta", "say": "improved HINGLISH spoken line", "text": "on-screen text", "visual": "what to shoot / b-roll" }
        ],
        "caption": "Improved HINGLISH caption with SEO keywords.",
        "hashtags": ["#reelsindia", "#instagramgrowth", "8-12 tags"]
      },
      "sources": [ { "title": "string", "url": "string" } ]
    }
  ],
  "topThree": [
    { "id": "matches a blueprint id", "why": "one line on why it's the best viral bet to make now" }
  ],
  "sourcesUsed": [ { "title": "string", "url": "string" } ]
}
`;

// Schema for the "7-Day Content Plan" page.
export const PLAN_SCHEMA = `
Return ONLY a single valid JSON object (no markdown fences, no commentary) matching:

{
  "generatedAt": "ISO-8601 timestamp",
  "niche": "string",
  "summary": "1-2 sentence overview of this week's focus",
  "pillars": ["3-5 content pillars this niche should post around"],
  "days": [
    {
      "id": "day-monday",
      "day": "Monday",
      "pillar": "which pillar this day covers",
      "format": "Talking-head list | Tutorial/screen-record | Story-time | POV | Before/After | Myth-bust | Hot-take",
      "title": "the reel idea in a few words",
      "goal": "reach | saves | shares | engagement",
      "why": "one line: why post this idea on this day",
      "script": {
        "durationSeconds": 30,
        "hook": "Spoken HINGLISH hook (0-3s), Roman script.",
        "onScreenHook": "Bold first-frame text overlay.",
        "lines": [
          { "part": "hook | build | value | cta", "say": "HINGLISH spoken line", "text": "on-screen text", "visual": "what to shoot" }
        ],
        "caption": "HINGLISH caption with SEO keywords.",
        "hashtags": ["#reelsindia", "#instagramgrowth", "6-10 tags"]
      }
    }
  ],
  "tips": ["2-3 short consistency/execution tips for the week"]
}
`;

export function buildPlanPrompt(niche = DEFAULT_NICHE) {
  const today = new Date().toISOString();
  return `You are a content strategist planning a beginner Instagram creator's week.

THE CREATOR'S NICHE:
${niche}

TODAY (UTC): ${today}
CONTEXT: The creator is a BEGINNER (~1000 followers), based in INDIA, posting on Instagram only.
Reels are the growth engine. Consistency matters more than perfection at this stage.

YOUR JOB:
- First define 3-5 clear CONTENT PILLARS for this niche.
- Then build a 7-DAY plan (Monday to Sunday), one Reel idea per day.
- Spread ideas across the pillars and MIX the formats (don't repeat the same format daily).
- Mix goals across the week: some for reach (hooky/relatable), some for saves (how-to/value),
  some for shares (relatable truths), some for engagement (questions/hot-takes).
- Keep every idea EASY to shoot for a beginner (phone + simple editing). No fancy gear.
- For each day, write a full, ready-to-record HINGLISH script (Roman script) following the
  SCRIPT RULES below. 4-6 lines per script.
- End with 2-3 practical consistency tips for the week.

${HINGLISH_SCRIPT_GUIDE}

${PLAN_SCHEMA}`;
}

export function buildViralPrompt(niche = DEFAULT_NICHE, signals = []) {
  const today = new Date().toISOString();
  const feed = signals
    .map((s, i) => `${i + 1}. [${s.source}] ${s.title}\n   url: ${s.url}`)
    .join("\n");

  return `You are a viral-content strategist for an Instagram creator.

THE CREATOR'S NICHE:
${niche}

TODAY (UTC): ${today}

Below are REAL, freshly-fetched articles and creator discussions about what's going viral
in this space. Use them as evidence, plus your own knowledge of proven Reel formats.

=== SIGNALS ===
${feed}
=== END SIGNALS ===

YOUR JOB:
- Identify 5-7 VIRAL reel formats/topics with a genuinely high success rate for THIS niche
  (Instagram only, Indian audience). Favor formats known to drive SAVES, SHARES and watch-time.
- For each, explain the format, why it works (retention psychology), and its success signals.
- Give an "originalStyle" script: a REPRESENTATIVE reconstruction of how the format is normally
  done. This must NOT copy any single creator's exact words — it's a generic reference.
- Then give an "improvedScript": a stronger, ORIGINAL, differentiated HINGLISH version the creator
  can actually post, with "whatsDifferent" explaining how it avoids looking copied and improves on it.
- Both scripts must be in HINGLISH (Roman script), following the SCRIPT RULES below.
- Pick the 3 best viral bets in "topThree".
- Cite real URLs from the signals list where relevant. Never invent URLs.

IMPORTANT: Do NOT claim exact view counts or pretend to quote a specific person's video verbatim.
Frame originals as representative of the format.

${HINGLISH_SCRIPT_GUIDE}

${VIRAL_SCHEMA}`;
}

// Used when we fetch real signals ourselves (free) and hand them to the model to analyze.
export function buildAnalysisPrompt(niche = DEFAULT_NICHE, signals = []) {
  const today = new Date().toISOString();

  // Graceful fallback: if live signals couldn't be fetched (e.g. sources block the
  // server's datacenter IP), let the model use its own knowledge instead of failing.
  if (!signals.length) {
    return `You are a sharp, no-fluff trend scout for an Instagram content creator.

THE CREATOR'S NICHE:
${niche}

TODAY (UTC): ${today}

NOTE: Live news/Reddit signals are unavailable right now, so use your OWN best knowledge
of recent Instagram/Meta updates, current Reel formats, and creator/AI tools. Prefer things
that are genuinely current and likely still relevant. It is OK to leave "sources" empty; do
NOT invent fake URLs. Be honest in "timing" about how fresh vs. evergreen each item is.

FOCUS: This creator ONLY posts on Instagram right now. Analyze everything through an
Instagram lens (Reels, Stories, the IG grid, IG algorithm/discovery, IG monetization).

YOUR JOB:
- Provide 6-8 findings that matter for THIS niche (Instagram/Meta updates, Reel formats,
  creator/AI tools for Instagram, notable strategies).
- Distinguish genuinely-new trends from evergreen advice (set "novelty").
- Rank each as POST NOW / WATCH / IGNORE. Favor clear audience payoff and niche fit.
- For each: what changed, why creators care, timing, how to adapt without copying, a short
  Reel concept (hook + visual + cta), AND a full HINGLISH script (see SCRIPT RULES below).
- Pick the 3 BEST Reel opportunities in "topThree".

${HINGLISH_SCRIPT_GUIDE}

${OUTPUT_SCHEMA}`;
  }

  const feed = signals
    .map(
      (s, i) =>
        `${i + 1}. [${s.source}] ${s.title}\n   url: ${s.url}\n   published: ${s.publishedAt || "unknown"}`
    )
    .join("\n");

  return `You are a sharp, no-fluff trend scout for an Instagram content creator.

THE CREATOR'S NICHE:
${niche}

TODAY (UTC): ${today}

Below are REAL, freshly-fetched headlines and discussions from the last ~48 hours
(Google News + Reddit). Analyze ONLY these items. Many are noise or off-niche —
ignore anything irrelevant to the creator's niche. Do NOT invent items or URLs;
only cite URLs that appear in this list.

=== FRESH SIGNALS ===
${feed}
=== END SIGNALS ===

FOCUS: This creator ONLY posts on Instagram right now. Analyze everything through an
Instagram lens (Reels, Stories, the IG grid, IG algorithm/discovery, IG monetization).
Ignore TikTok/YouTube-specific items UNLESS the takeaway clearly applies to Instagram.

YOUR JOB:
- Identify the items that genuinely matter for THIS niche (Instagram/Meta updates, Reel
  formats, creator/AI tools for Instagram, notable creator discussion).
- Distinguish genuinely-new trends from evergreen advice (set "novelty").
- Do NOT recommend acting on every item. Favor clear audience payoff, novelty, and niche fit.
- Rank each finding as POST NOW (act today, still early), WATCH (promising, not yet), or
  IGNORE (saturated, off-niche, or low payoff). It is good to mark weak items IGNORE.
- For each finding give: what changed, why creators care, whether it's early enough, how to
  adapt it to THIS niche WITHOUT copying the original, a short Reel concept (hook + visual + cta),
  AND a full, ready-to-record HINGLISH script (see the SCRIPT RULES below).
- Provide 6-8 findings. Then pick the 3 BEST Reel opportunities for TODAY in "topThree".
- Cite ONLY real URLs from the signals list above.

${HINGLISH_SCRIPT_GUIDE}

${OUTPUT_SCHEMA}`;
}

export function buildResearchPrompt(niche = DEFAULT_NICHE) {
  const today = new Date().toISOString();
  return `You are a sharp, no-fluff trend scout for an Instagram content creator.

THE CREATOR'S NICHE:
${niche}

TODAY (UTC): ${today}

YOUR JOB:
Research the latest developments and emerging trends relevant to this creator. Use web search
aggressively and check across ALL of these areas:
- Current Instagram / Meta product updates (features, algorithm, Reels changes, monetization).
- Emerging Reel formats, audio trends, and content styles.
- Creator economy & AI-tool news (new AI editing/video tools, model releases relevant to creators).
- TikTok and YouTube trends that could migrate to Instagram.
- Google / search trends and rising queries.
- Relevant creator discussions (Reddit, X/Twitter, forums).
- Notable recent content from major creator-education accounts.

RULES:
- Prioritize developments from the LAST 24-48 HOURS. Older items only if truly important.
- Clearly distinguish genuinely-new trends from evergreen advice (set "novelty").
- Do NOT recommend acting on every trend. Favor trends with a clear audience payoff, novelty,
  and fit for THIS niche. It is good to mark weak trends as IGNORE.
- Rank each finding as POST NOW (act today, still early), WATCH (promising, not yet), or IGNORE
  (saturated, off-niche, or low payoff).
- For each finding give: what changed, why creators care, whether it's early enough, how to adapt
  it to THIS niche WITHOUT copying the original, and one concrete Reel concept (hook + visual + cta).
- Provide 6-10 findings total. Then pick the 3 BEST Reel opportunities for TODAY in "topThree".
- Always cite the key sources you actually used (real URLs from your searches).

${OUTPUT_SCHEMA}`;
}
