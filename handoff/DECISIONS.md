# Decisions

Settled decisions. Add new ones at the bottom with a date and who decided.

| Date | Decision | Decided by |
|---|---|---|
| 2026-10-28 | Handoffs and session records live in `handoff/` and are committed, so every dev's Claude reads the same context. | c-cheng10 |
| 2026-10-28 | Start with a quick Gemini-only test (simple `.mjs`, no deps) before building the full 4-model bake-off. | c-cheng10 |
| 2026-10-28 | Website lives in `site/` on branch `website`. Days are UTC; everyone gets the same seed per day. Leaderboard keeps each player's best run, scored only by server replay; a run must reach `finish()` to count. No accounts: anonymous id + name. | c-cheng10 |
| 2026-10-28 | Superseded the line above: posting scores needs an account (email + unique username + password). Playing doesn't. Leaderboard shows the username. | c-cheng10 |

## Open

- OpenRouter or Groq for the free open-weight model? (from `HANDOFF.md`)
- Hosting and database for the website.
- Email provider for verification and password reset.
