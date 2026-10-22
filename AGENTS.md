# Verification

- Run carousel renderer and prompt tests with `node --test carousel-render.test.js`. These use a mocked canvas context; they do not replace browser visual verification.
- Check changed JavaScript syntax with `node --check <file>` and whitespace with `git diff --check`.
- Start the application with `npm run dev` or `npm start`.

# Carousel rendering

- `public/app.js` owns the shared canvas renderer used by carousel previews, PNG downloads, and Instagram sharing.
- Both `lib/prompt.js` and `lib/workflows/carousel.js` generate carousel content. Keep their art direction aligned.
- `/api/slide-image` searches Pexels; carousel previews and exports use stock photos by default. `/api/carousel-image` is opt-in per slide: free Pollinations Classic artwork with a server cooldown and cache. Never trigger AI generation from rendering or downloading. Failed or busy AI requests keep the current photo; no automatic retries or stock replacement.
- Carousel `imagePrompt` describes optional custom artwork; `imageQuery` contains primary stock-search keywords. `artDirection` keeps artwork consistent. Selected AI data stays in a session WeakMap, not synced drafts.
- Carousel text, photo queries, prompts, captions and hashtags use the existing edits store, with a stable content-derived draft key. Cover alternatives and `/api/carousel-hooks` share `CAROUSEL_HOOK_GUIDE`.
- Run carousel editor behavior tests with `node --test carousel-editor.test.js`.
- Run image-provider tests with `node --test carousel-images.test.js`. Free live generation is best-effort, limited per IP, and includes a provider logo; never add payment handling implicitly.
