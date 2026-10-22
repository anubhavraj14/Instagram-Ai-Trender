# Verification

- Run carousel renderer and prompt tests with `node --test carousel-render.test.js`. These use a mocked canvas context; they do not replace browser visual verification.
- Check changed JavaScript syntax with `node --check <file>` and whitespace with `git diff --check`.
- Start the application with `npm run dev` or `npm start`.

# Carousel rendering

- `public/app.js` owns the shared canvas renderer used by carousel previews, PNG downloads, and Instagram sharing.
- Both `lib/prompt.js` and `lib/workflows/carousel.js` generate carousel content. Keep their art direction aligned.
- `/api/slide-image` searches Pexels; image queries must be stock-search keywords, not image-generation instructions.
