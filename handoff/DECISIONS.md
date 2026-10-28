# Decisions

Settled decisions. Add new ones at the bottom with a date and who decided.

| Date | Decision | Decided by |
|---|---|---|
| 2026-10-28 | Handoffs and session records live in `handoff/` and are committed, so every dev's Claude reads the same context. | c-cheng10 |
| 2026-10-28 | Start with a quick Gemini-only test (simple `.mjs`, no deps) before building the full 4-model bake-off. | c-cheng10 |

| 2026-10-28 | Build the generation harness in `handoff/HARNESS.md`: support every genre (word games included), games ship their own `probe()`, `bot()`, `invariants()` and `tests`, the harness runs its own bots, and the model self-reviews and fixes from test feedback. | kenzo-aspuru-takata |
| 2026-10-28 | Game contract: `probe()` and `bot()` are required. `Math.sin/cos/atan2/pow/exp/log` are banned (use the engine's deterministic versions). Games written before this (b01, b03) must be regenerated. | kenzo-aspuru-takata |
| 2026-10-28 | Bake-off round 1 (one shot) uses the same prompt as the full pipeline: `npm run gen` = `build.mjs --oneshot`. | kenzo-aspuru-takata (Claude, as part of the harness build) |

## Open

- OpenRouter or Groq for the free open-weight model? (from `HANDOFF.md`) Both are now supported by the harness (`--provider openrouter` / `groq`), so this is only a choice of which free model to use.
