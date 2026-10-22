# Verification

- Run carousel renderer and prompt tests with `node --test carousel-render.test.js`. These use a mocked canvas context; they do not replace browser visual verification.
- Check changed JavaScript syntax with `node --check <file>` and whitespace with `git diff --check`.
- Start the application with `npm run dev` or `npm start`.

# Carousel rendering

- `public/app.js` owns the shared canvas renderer used by carousel previews, PNG downloads, and Instagram sharing.
- Both `lib/prompt.js` and `lib/workflows/carousel.js` generate carousel content. Keep their art direction aligned.
- `/api/slide-image` searches Pexels for non-carousel content. `/api/carousel-image` generates free Pollinations Classic artwork with a server-side cooldown, cache, and labelled Pexels fallback. No paid endpoint or API key is used for carousel artwork.
- Carousel `imagePrompt` describes custom artwork; `imageQuery` contains stock-search fallback keywords. `artDirection` keeps each carousel visually consistent.
- Run image-provider tests with `node --test carousel-images.test.js`. Free live generation is best-effort, limited per IP, and includes a provider logo; never add payment handling implicitly.
