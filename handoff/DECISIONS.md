# Decisions

Settled decisions. Add new ones at the bottom with a date and who decided.

| Date | Decision | Decided by |
|---|---|---|
| 2026-10-28 | Handoffs and session records live in `handoff/` and are committed, so every dev's Claude reads the same context. | c-cheng10 |
| 2026-10-28 | Start with a quick Gemini-only test (simple `.mjs`, no deps) before building the full 4-model bake-off. | c-cheng10 |

| 2026-10-28 | Build the generation harness in `handoff/HARNESS.md`: support every genre (word games included), games ship their own `probe()`, `bot()`, `invariants()` and `tests`, the harness runs its own bots, and the model self-reviews and fixes from test feedback. | kenzo-aspuru-takata |
| 2026-10-28 | Game contract: `probe()` and `bot()` are required. `Math.sin/cos/atan2/pow/exp/log` are banned (use the engine's deterministic versions). Games written before this (b01, b03) must be regenerated. | kenzo-aspuru-takata |
| 2026-10-28 | Bake-off round 1 (one shot) uses the same prompt as the full pipeline: `npm run gen` = `build.mjs --oneshot`. | kenzo-aspuru-takata (Claude, as part of the harness build) |
| 2026-10-28 | Generated content is checked against the game's own requirements: logic puzzles export `puzzle()` (the harness solves it; `unique` puzzles must have exactly one answer), generated levels export `level()` → `{rows, reqs}` (the harness runs `checklevel`). | kenzo-aspuru-takata |
| 2026-10-28 | Offensive words: LDNOOBW list (npm `naughty-words`, CC-BY-4.0) plus `engine/blocklist-extra.txt`; removed from the word lists and checked in game text by the harness. The list stays server-side. | kenzo-aspuru-takata (Claude) |
| 2026-10-28 | The day's seed is `dailySeed("YYYY-MM-DD")` (UTC date, FNV hash), so every player gets the same game; games may export `share()` for a spoiler-free result. | kenzo-aspuru-takata (Claude) |
| 2026-10-28 | Bigger category lists come from Darius Kazemi's Corpora (CC0), imported by `build-categories.mjs` into `categories-big.js` and opt-in (`{ big: true }`); the hand-checked `categories.js` stays the default. WordNet was tried and rejected as too noisy. | kenzo-aspuru-takata |

## Open

- OpenRouter or Groq for the free open-weight model? (from `HANDOFF.md`) Both are now supported by the harness (`--provider openrouter` / `groq`), so this is only a choice of which free model to use.
