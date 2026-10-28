# Session log

Newest first. One entry per session: date, who, what changed, what's next.

---

## 2026-10-28 (3) — c-cheng10 (Claude), branch `website`

**Done**
- New branch `website` (worktree at `.worktrees/website` in c-cheng10's checkout). Everything is in `site/`; see `site/README.md`.
- PICO-8-styled site: Today / Scores / Archive / How-to tabs, sandboxed game player, touch controls on phones, countdown to the next UTC day, share button.
- Global leaderboard with server-side replay: the client sends the per-frame input log, the server re-runs the game and stores its own result. Best run per player per day.
- Demo schedule: 10-26 example Rockfall (survival), 10-27 Gemini b03 Ice Cave (speedrun), 10-28 Gemini b01 Deep Sea Hook (highscore).

**Verified**
- A real browser run was replayed on the server and matched the score. A cut-off input log is rejected. Future dates and paths outside the site 404. Mobile layout at 375 px has no horizontal scroll.

**Not done / risks**
- Storage is JSON files on one server; needs a real DB and a host to go public. No hosting chosen.
- `site/public/engine.js` is a copy of `bakeoff/engine/engine.js`. If the harness changes the engine, copy it over or replays break.
- Cross-browser float determinism (e.g. `Math.sin` in Firefox vs V8 on the server) is untested. The server result is authoritative, so the worst case is a displayed score differing from the verified one.
- No anti-spam beyond 20 submits/min per IP; names aren't profanity-filtered.

**Next**
- Pick hosting + DB. Wire the daily generator's output into `site/games/index.json`.

---

## 2026-10-28 (2) — c-cheng10 (Claude)

**Done**
- Built a minimal, dependency-free Gemini-only test setup in `bakeoff/` (see `bakeoff/README.md`): engine, API doc, example game, 10 briefs, `gen.mjs` (Gemini REST), `check.mjs` (headless vm checks), `play.html` + `serve.mjs` (blind playtest).
- Added `.gitignore` (`.env`), `.env.example`, `package.json` scripts `gen` / `check` / `play`.
- Verified: example game passes all checks; a hanging game times out cleanly; `Math.random` is caught; play page runs the example in the browser.

**Not verified**
- No real Gemini call yet (no key in `.env` at the time). Default model `gemini-flash-latest` is an alias; check `npm run gen -- --models` and the `modelVersion` saved in each output's `.json`.

**Deviations from HANDOFF.md** (for speed, agreed with c-cheng10)
- Plain `.mjs`, not TypeScript. Gemini only. No mock provider or report yet.

**Next**
- Generate 2–3 games, run checks, playtest. Then decide whether to build out the full 4-model runner.

---

## 2026-10-28 — c-cheng10 (Claude)

**Done**
- Read `HANDOFF.md`.
- Moved `HANDOFF.md` from the repo root into `handoff/`, added `handoff/README.md`, `LOG.md`, `DECISIONS.md`, and a root `CLAUDE.md` that tells every Claude session to read this folder first and log here.

**Not started**
- The bake-off itself (`bakeoff/`). Nothing built yet.

**Blocked on**
- Open question from the handoff: OpenRouter or Groq for the free open-weight model.

**Next**
- Answer the open question, then build in order: engine → engine-api.md → example game → briefs → mock provider → runner → checks → play.html → report.
