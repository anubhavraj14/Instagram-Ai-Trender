// Content Generator — workflow registry.
// Each content type gets its own module with a `run({ topic, context, niche })`
// that returns a normalized result: { type, title, payload }.
// Phase 2+: extend the individual module (or add steps inside it) without
// touching the dispatcher or the other content types.
import * as story from "./story.js";
import * as carousel from "./carousel.js";
import * as reel from "./reel.js";
import * as post from "./post.js";

export const CONTENT_TYPES = {
  story,
  carousel,
  reel,
  post,
};

export function getWorkflow(type) {
  const wf = CONTENT_TYPES[type];
  if (!wf) {
    const err = new Error(`Unknown content type "${type}". Use one of: ${Object.keys(CONTENT_TYPES).join(", ")}`);
    err.code = "BAD_TYPE";
    throw err;
  }
  return wf;
}
