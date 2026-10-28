# Session log

Newest first. One entry per session: date, who, what changed, what's next.

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
