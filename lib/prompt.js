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

// Schema for the "Carousels" page: ready-to-post multi-slide carousel posts.
export const CAROUSEL_SCHEMA = `
Return ONLY a single valid JSON object (no markdown fences, no commentary) matching:

{
  "generatedAt": "ISO-8601 timestamp",
  "niche": "string",
  "carousels": [
    {
      "id": "short-slug",
      "title": "short internal name of the carousel",
      "topic": "what this carousel teaches",
      "goal": "saves | shares | reach | follows",
      "structure": "Name the proven carousel structure you chose (e.g. 'Listicle', 'Problem-Agitate-Solve', 'Before/After', 'Myth-busting', 'Step-by-step framework') and 1 line on WHY it fits this topic best, based on the research signals.",
      "slides": [
        {
          "n": 1,
          "type": "cover | point | cta",
          "heading": "SHORT punchy HINGLISH heading (max ~6 words). The cover = the hook.",
          "body": "2-3 short HINGLISH lines of SPECIFIC, actionable value — a concrete step, number, example, checklist item, mistake, or tool name. NEVER generic filler like 'consistency is key'. If a slide can't teach something specific, cut it.",
          "imageQuery": "2-4 English keywords to find a REAL photo for this slide on a stock photo site (Pexels). Must be CONCRETE and photographable (people, objects, places, actions) — e.g. 'young woman filming phone', 'indian creator studio', 'smartphone tripod desk', 'excited person laptop'. NOT abstract concepts.",
          "imageMood": "one of: dark | bright | vibrant | minimal (helps pick a matching photo)"
        }
      ],
      "music": "An INSTRUMENTAL BGM/tune for retention (NEVER a song with lyrics): e.g. 'subtle suspense loop', 'curiosity-building ambient beat', 'rhythmic ticking tension track' + 1 line on why it holds attention without distracting",
      "caption": "Ready-to-paste HINGLISH caption: strong first line + value + a comment-bait CTA like 'Comment \"PDF\" aur main detailed guide bhej dunga' + keywords.",
      "hashtags": ["#reelsindia", "#instagramgrowth", "8-12 tags"]
    }
  ]
}
`;

export function buildCarouselPrompt(niche = DEFAULT_NICHE, signals = []) {
  const today = new Date().toISOString();
  const feed = signals
    .map((s, i) => `${i + 1}. [${s.source}] ${s.title}\n   url: ${s.url}`)
    .join("\n");

  return `You are a top Instagram carousel strategist and designer for a beginner creator.

THE CREATOR'S NICHE:
${niche}

TODAY (UTC): ${today}
CONTEXT: Beginner (~1000 followers), based in INDIA, Instagram only. Carousels drive SAVES
and SHARES with high-value, skimmable, VISUAL-FIRST content.

Below are REAL, freshly-fetched articles and creator discussions about what makes Instagram
CAROUSELS perform right now — hooks, cover-slide design, layouts, and storytelling structures.

=== RESEARCH SIGNALS ===
${feed || "(live sources unavailable — rely on your own expert knowledge of proven carousel patterns)"}
=== END SIGNALS ===

YOUR JOB:
1) STUDY the research above + your knowledge of high-performing carousels. Identify the
   strongest recurring patterns: what hooks stop the scroll, how covers are framed, how
   the story flows slide-to-slide, and which STRUCTURES get the most saves.
2) For EACH of 3 carousels, AUTOMATICALLY CHOOSE the single strongest structure for that
   specific topic (listicle, problem-agitate-solve, before/after, myth-busting, step framework,
   etc.) and record it in "structure". Do NOT force the same structure on all three.
3) Design an ORIGINAL carousel that REMIXES multiple reference patterns — never replicate any
   one creator's carousel. Make the cover the most scroll-stopping slide.

RULES:
- Each carousel = 6 to 8 slides following this arc: COVER (strong scroll-stopping hook) →
  1-2 slides that build curiosity/tension → 3-4 slides of SUBSTANTIAL value → an actionable
  takeaway → CTA slide.
- VALUE DENSITY IS THE #1 PRIORITY. Think from the audience's perspective: every single
  "point" slide must teach something they can ACT on — a framework, step-by-step process,
  checklist item, template, real example, common mistake, specific tool name, or a concrete
  number/stat. Bodies should be 2-3 lines of specific, usable advice.
- BANNED: generic 4-5 word statements, motivational filler, vague tips ("post consistently",
  "be authentic", "engage with audience"). If a slide doesn't contain something a viewer
  could screenshot and use, rewrite it until it does.
- QUALITY GATE before finalizing each carousel: ask "Why would someone SAVE this instead of
  just liking it?" If there's no strong answer (template, checklist, framework, numbers,
  step-by-step they'd want to reuse later), improve the content until there is.
- The CTA slide may offer a lead magnet ("Comment 'PDF' for the full resource") ONLY when
  the carousel genuinely delivers enough value that a deeper guide makes sense. Otherwise
  use "Save this" or "Share with a creator friend".
- VISUAL: each slide is a full-bleed REAL PHOTO with a text overlay. Every slide needs a
  strong "imageQuery" — concrete, photographable keywords to find a real stock photo that
  fits the slide's idea. Vary subjects so the carousel feels designed. The COVER imageQuery
  must be the most eye-catching.
- Headings SHORT and punchy (max ~6 words). Body lines stay short each — but now they carry
  the real substance, so specificity matters more than brevity.
- All headings/bodies/caption in HINGLISH (Hindi+English in Roman script), like a real Indian
  creator. imageQuery + imageMood are in English.
- Ready-to-paste HINGLISH caption + 8-12 hashtags per carousel. The caption ends with the
  comment-bait CTA only when the lead magnet is real.
- "music" = INSTRUMENTAL BGM only — NEVER a song or anything with lyrics. Suggest a retention-
  focused sound (subtle suspense, curiosity-building ambient, rhythmic/ticking loops, tension
  builders) + 1 line on why it keeps viewers swiping without distracting from the content.

Tone: conversational Hinglish, short lines, no cringe, practical. Example heading style:
"Reels ki reach kaise badhaye", "3 hooks jo chalte hain".

${CAROUSEL_SCHEMA}`;
}

// Schema for the Reel Editor: given a script with timestamps, produce an edit plan.
export const EDIT_PLAN_SCHEMA = `
Return ONLY a single valid JSON object (no markdown fences, no commentary) matching:

{
  "title": "short reel title",
  "edits": [
    {
      "type": "zoom | broll | textcard",
      "start": 1.25,
      "duration": 1.5,
      "scale": 1.25,
      "mode": "top | pip",
      "media": "video | image",
      "query": "2-4 concrete searchable keywords for stock media (broll only) e.g. 'phone tripod filming', 'analytics dashboard screen'",
      "text": "short on-screen highlight in HINGLISH (textcard only, max 4 words)"
    }
  ]
}

Rules for the plan:
- "zoom" = punch-in on the speaker for emphasis moments (hooks, punchlines, strong claims).
  scale 1.15-1.4, duration 0.6-1.6s. Use 4-7 zooms across the reel on the most impactful lines.
- "broll" = stock footage or image shown WITHOUT covering the speaker — it appears in a
  framed panel while the speaker stays visible underneath. Only when the spoken moment
  references something concretely visual (apps, screens, phones, money, gym, food, travel).
  - mode "top": media fills a panel across the top of the frame (speaker visible below).
    Best for immersive visuals.
  - mode "pip": small card in an upper corner. Best for quick references/mentions.
  - media "video" for motion/action scenes, "image" for screenshots-like/static visuals.
  - query must be SPECIFIC to what is being said — not generic stock words.
  duration 1.5-3.5s. Use 3-6 broll moments. Never on the hook's first 1.5s or during a punchline.
- "textcard" = a bold keyword/number pop-up highlighting ONE important idea (e.g. "50,000
  followers", "3 steps", "90 days"). NOT a subtitle — a graphic emphasis element.
  duration 1-1.8s. Max 4, on the most memorable numbers/claims only.
- Timestamps (seconds) come from the segment timing provided. Edits must not overlap each other.
- Order by start time. Vary the visual rhythm — something should change every 3-6 seconds,
  but never stack two effects at the same instant.
`;

export function buildEditPlanPrompt(script, segments = [], duration = 0) {
  const segList = segments
    .map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}s] ${s.text}`)
    .join("\n");
  return `You are a professional short-form video editor for Instagram Reels. A creator
gave you their raw talking-head video. The SCRIPT below is what they actually say —
treat it as the source of truth for meaning and topic. The segment timestamps tell
you WHEN each part is spoken.

VIDEO DURATION: ${duration ? duration.toFixed(1) + "s" : "unknown"}

SEGMENT TIMING (from speech-to-text, use for timestamps only):
${segList || "(no timing available)"}

SCRIPT (primary source — design visuals around THIS):
${script}

Think like a retention editor: the speaker stays on screen the whole time. Punch in
on strong lines, bring in a visual panel exactly when they mention something you can
show, pop a keyword card on numbers and bold claims. Match every visual to the SPECIFIC
words being said at that moment — never generic stock filler. Do NOT over-edit.

${EDIT_PLAN_SCHEMA}`;
}

// Schema for the "Script Kit": a creator pastes a script and gets a complete
// pre-production asset pack — B-roll, BGM, SFX, visual directions, captions, etc.
export const SCRIPT_KIT_SCHEMA = `
Return ONLY a single valid JSON object (no markdown fences, no commentary) matching:

{
  "title": "short punchy title for the Reel",
  "estimatedDurationSeconds": 32,
  "niche": "the niche/topic this script targets",
  "hook": {
    "line": "the exact hook line from the script",
    "strength": "strong | moderate | weak",
    "why": "1-2 sentence analysis of why the hook works or what's missing",
    "improvedLine": "a stronger alternative hook if strength is moderate or weak, otherwise empty string"
  },
  "audiencePsychology": "one sentence on the psychological trigger this script leverages (curiosity gap, fear of missing out, identity, pain point, etc.)",
  "beats": [
    {
      "startSeconds": 0,
      "endSeconds": 4,
      "part": "hook | build | value | cta",
      "say": "the exact spoken line for this beat",
      "onScreenText": "short on-screen text overlay (max 5 words) for this beat, Hinglish/English mix as natural",
      "visualDirection": "what to shoot or show on screen during this beat",
      "broll": {
        "needed": true,
        "query": "2-4 concrete English keywords to search stock media sites like Pexels. MUST be photographable/video-able: objects, actions, places, people. NO abstract concepts.",
        "media": "video | image",
        "why": "why this B-roll fits the exact words in this beat",
        "placement": "full screen cutaway | top panel behind speaker | pip corner overlay"
      },
      "zoom": true,
      "soundEffect": "specific sound effect suggestion if it adds impact, otherwise empty string"
    }
  ],
  "bgm": [
    {
      "name": "descriptive name of the instrumental track style, e.g. 'lo-fi curiosity beat', 'cinematic tension riser', 'upbeat indie pop instrumental'",
      "searchQuery": "1-3 simple English keywords for searching a stock music library. Use COMMON searchable terms only: 'upbeat background music', 'lo-fi hip hop', 'cinematic suspense', 'ambient chill', 'dramatic tension', 'bright indie pop', 'motivational electronic'. NEVER made-up or overly specific phrases.",
      "mood": "curiosity | urgency | emotional | upbeat | dramatic | chill | motivational",
      "whyItRetains": "the psychology of WHY this mood keeps someone watching the full Reel — be specific about tension, dopamine, emotional pacing, etc.",
      "energyLevel": "low | medium | high",
      "whenToStart": "e.g. from second 0, or after hook at 3s",
      "whereToFind": "free source suggestion: YouTube Audio Library, Uppbeat, Pixabay, Mixkit — whichever fits this mood"
    }
  ],
  "soundEffects": [
    "specific SFX that would lift key moments, e.g. 'whoosh transition at 0:03', 'camera shutter on reveal', 'subtle ding on checklist'"
  ],
  "captions": {
    "caption": "ready-to-paste Instagram caption in Hinglish with a strong first line + value + soft CTA + keywords for search",
    "hashtags": ["#reelsindia", "#instagramgrowth", "8-12 relevant mixed Hindi/English tags"]
  },
  "editingTips": [
    "2-5 short, specific editing tips for this script (pacing, text animation, jump cuts, B-roll timing)"
  ],
  "requiredAssets": [
    { "type": "broll", "description": "what to download/film" },
    { "type": "text overlay", "description": "what text graphics to prepare" }
  ]
}

Rules for the beats:
- Estimated total duration should be 25-50 seconds.
- Each beat covers one spoken line/idea.
- B-roll is REQUIRED on the most visual moments. Suggest B-roll for at least 60% of beats.
- 'media' = video when motion adds meaning (typing, walking, gestures, processes); image when the point is static (screenshot, object, finished result).
- 'placement' = choose what makes sense for the beat. Beats with strong B-roll may go full screen; supporting visuals go top panel/pip.
- Suggest 'zoom: true' on the hook, punchlines, strong claims, and CTA.
- Keep on-screen text extremely short and punchy.
- Visual directions must be SPECIFIC — never 'relevant footage'.

Rules for BGM:
- 'searchQuery' must be a real music-search term (NOT the mood name). Use English words that stock music sites actually index, e.g. "upbeat lo-fi hip hop", "cinematic suspense instrumental", "bright indie pop instrumental", "minimal ambient piano", "dramatic tension riser".
- 'name' describes the style; 'mood' is the emotional category; 'searchQuery' is what we use to fetch the track.
- Pick moods/energy levels that follow the Reel arc: curiosity/tension in the hook, momentum in the value, satisfaction in the CTA.
`;

export function buildScriptKitPrompt(script, niche = DEFAULT_NICHE) {
  const today = new Date().toISOString();
  return `You are a senior short-form video producer and retention editor for Instagram Reels.
A creator pasted a script below. Your job is to turn it into a complete pre-production
asset kit: B-roll search queries, BGM recommendations with audience-psychology reasoning,
sound effects, visual directions, captions, and editing tips.

THE CREATOR'S NICHE:
${niche}

TODAY (UTC): ${today}

PASTED SCRIPT (treat this as the source of truth):
${script}

Think like a YouTube/Instagram editor who wants maximum retention:
- Every visual must match the SPECIFIC words being said in that beat.
- BGM should support the emotional arc: curiosity in the hook, momentum in the value, satisfaction in the CTA.
- Suggest sound effects only when they genuinely add impact, not decoration.
- For Indian creator audiences, prefer Hinglish (Roman script) in on-screen text and captions when it sounds natural.

${SCRIPT_KIT_SCHEMA}`;
}

// ---------- Instagram Reel Analyzer ----------
// One vision pass over the actual reel video: transcribe speech with timestamps,
// break down structure (hook/build/value/cta), and describe on-screen visuals /
// B-roll moments mapped to the script.
export const REEL_ANALYSIS_SCHEMA = `
Return ONLY a single valid JSON object (no markdown fences, no commentary) matching:

{
  "title": "short punchy name for this reel",
  "coreIdea": "the ONE central idea/message of the video in 1-2 sentences",
  "durationSeconds": 0,
  "structure": "one line describing the arc, e.g. 'hook -> pain point -> 3 steps -> CTA'",
  "hook": {
    "text": "the exact spoken hook line",
    "start": 0,
    "end": 3,
    "why": "why this hook works or doesn't (retention psychology, specific)"
  },
  "segments": [
    {
      "start": 0,
      "end": 4,
      "part": "hook | build | value | cta",
      "text": "the exact words spoken in this segment (transcribed verbatim)",
      "onScreen": "text overlay shown during this segment, or empty string"
    }
  ],
  "mainPoints": ["each key claim/step/idea the video makes, in order"],
  "cta": { "text": "the call-to-action line", "start": 0, "end": 0 },
  "visuals": [
    {
      "start": 0,
      "end": 2,
      "type": "talking-head | broll | screen-recording | text-overlay | photo | meme",
      "description": "what is literally on screen during this window (be concrete)",
      "mapsToSegment": 0,
      "sourceUrl": "if the on-screen content visibly credits/links a source, otherwise empty string"
    }
  ],
  "spokenLanguage": "e.g. English, Hindi, Hinglish"
}

Rules:
- Transcribe the SPOKEN words verbatim into "segments" with real timestamps from the video.
  Segments should cover the whole video in order (no gaps > 2s). 4-10 segments typical.
- "visuals" = what the viewer SEES. Note every B-roll cutaway, screen recording, image,
  meme, or big text overlay with its timestamps, and which segment index it supports.
- Be concrete and factual; never invent visuals or words that aren't in the video.
`;

export function buildReelAnalysisPrompt(meta = {}) {
  const metaLines = [
    meta.title && `Caption/title: ${meta.title}`,
    meta.author && `Creator: ${meta.author}`,
    meta.duration && `Duration: ~${Math.round(meta.duration)}s`,
  ].filter(Boolean).join("\n");
  return `You are a short-form video analyst. Analyze this Instagram Reel frame-by-frame
and word-by-word.

${metaLines ? `KNOWN METADATA:\n${metaLines}\n` : ""}
Watch AND listen to the video. Transcribe the spoken script with accurate timestamps,
identify the hook / main points / structure / CTA, and describe the visuals & B-roll
and which spoken moments they support.

${REEL_ANALYSIS_SCHEMA}`;
}

// Same analysis but when we only have an audio transcript (video upload failed).
export function buildReelAnalysisFromTranscriptPrompt(transcript, segments = [], meta = {}) {
  const segList = segments
    .map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}s] ${s.text}`)
    .join("\n");
  const metaLines = [
    meta.title && `Caption/title: ${meta.title}`,
    meta.author && `Creator: ${meta.author}`,
  ].filter(Boolean).join("\n");
  return `You are a short-form video analyst. Below is the auto-transcribed speech from an
Instagram Reel (we could not access the visuals). Reconstruct the analysis from the words.

${metaLines ? `KNOWN METADATA:\n${metaLines}\n` : ""}
TIMESTAMPED TRANSCRIPT:
${segList || transcript}

For "visuals": infer what a creator in this style most likely shows (talking-head, text
overlays, B-roll topics implied by the words) and mark each description with "(inferred)".
${REEL_ANALYSIS_SCHEMA}`;
}

// Original-version generation: same idea, genuinely new wording/angle.
export const ORIGINAL_SCRIPT_SCHEMA = `
Return ONLY a single valid JSON object (no markdown fences, no commentary) matching:

{
  "whatsDifferent": "how this version is genuinely different: new hook angle, new examples, different framing — not just reworded",
  "durationSeconds": 30,
  "hook": "the new spoken hook line (first 0-3s)",
  "onScreenHook": "short bold first-frame text overlay",
  "lines": [
    {
      "part": "hook | build | value | cta",
      "say": "the spoken line, same language/style as the source video",
      "text": "short on-screen text overlay",
      "visual": "what to shoot / show during this line",
      "brollQuery": "2-4 concrete English keywords to find matching stock B-roll (objects, actions, people, places — photographable). Empty string if the line should stay talking-head."
    }
  ],
  "caption": "ready-to-paste caption in the same language as the source",
  "hashtags": ["8-12 relevant tags"],
  "bgm": [
    {
      "name": "descriptive style name e.g. 'lo-fi curiosity beat'",
      "searchQuery": "1-3 simple English music-search keywords (e.g. 'upbeat background music', 'cinematic suspense', 'lo-fi hip hop')",
      "mood": "curiosity | urgency | emotional | upbeat | dramatic | chill | motivational",
      "why": "why this mood fits this reel's topic and pacing"
    }
  ]
}
`;

export function buildOriginalScriptPrompt(analysis, currentScriptText, niche = DEFAULT_NICHE) {
  return `You are a top short-form scriptwriter. A creator analyzed someone else's Reel and
wants THEIR OWN original version — same core idea and structure, genuinely new execution.

THE CREATOR'S NICHE:
${niche}

SOURCE REEL ANALYSIS:
Core idea: ${analysis?.coreIdea || ""}
Structure: ${analysis?.structure || ""}
Main points: ${(analysis?.mainPoints || []).join(" | ")}

SOURCE SCRIPT (possibly user-edited — treat as current truth):
${currentScriptText}

HARD RULES:
- Keep the CORE IDEA and factual claims accurate — do not distort facts.
- Write GENUINELY different wording and sentence structure. NEVER just swap synonyms.
- Fresh hook: pick a DIFFERENT proven hook pattern than the source used.
- Where reasonable, use a different angle, example, or framing than the source.
- Write in the SAME language/style as the source script (if it's Hinglish, write Hinglish
  in Roman script; if English, write casual spoken English). Sound like a real human
  talking to a friend — not an essay, not robotic.
- 4-8 lines, ~25-40s of speaking. One idea per line.
- "brollQuery": only for lines where a visual cutaway genuinely reinforces the specific
  words — concrete searchable subjects, never generic.
- "bgm": 1-2 instrumental recommendations matching the topic's mood and pacing.

${ORIGINAL_SCRIPT_SCHEMA}`;
}

// Rephrase one selected part while preserving meaning.
export function buildRephrasePrompt(text, context = "") {
  return `Rephrase this line from a Reel script. Keep the SAME meaning and facts, but use
genuinely different wording and sentence structure — natural, spoken, human. Match the
original language (if Hinglish, reply in Hinglish; if English, reply in casual English).

LINE:
${text}

${context ? `SURROUNDING SCRIPT CONTEXT (for tone only):\n${context}\n` : ""}
Return ONLY a single valid JSON object: { "rephrased": "the new line" }`;
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
