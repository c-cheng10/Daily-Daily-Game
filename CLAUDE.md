# Daily-Daily-Game

A daily PICO-8-style web game written by an LLM each day. Current phase: the model bake-off in `bakeoff/`.

## Read first, every session

Read everything in [`handoff/`](handoff/) before doing anything else:

1. `handoff/HANDOFF.md` — the spec and rules.
2. `handoff/DECISIONS.md` — settled decisions and open questions.
3. `handoff/LOG.md` — what previous sessions did and what's next.

## Keep the records current

- Handoffs, session logs and decision records go in `handoff/` only, never in the repo root or in local Claude memory. Other devs' Claude sessions can only see what's committed here.
- Add a `LOG.md` entry for your session (newest at the top) and update `DECISIONS.md` as decisions are made, during the session.
- These files get committed and pushed along with the code.

## Rules

- Don't commit or push unless the dev you're working with tells you to.
- API keys only in `.env` (gitignored). Never print or commit them.
