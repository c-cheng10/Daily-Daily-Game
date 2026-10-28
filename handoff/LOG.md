# Session log

Newest first. One entry per session: date, who, what changed, what's next.

---

## 2026-10-28 (5) — kenzo-aspuru-takata (Claude)

On branch `harness` (pushed earlier; these changes are not committed yet).

**Done**: harness improvements.
- Providers: **Claude** via the official `@anthropic-ai/sdk` (streaming + `finalMessage()`, `max_tokens` 64000, effort `high` set explicitly, `fallbacks: "default"` with beta `server-side-fallback-2026-07-01`, refusals raise a clear error, the ~6k-token system prompt is cached, cache tokens are priced). **OpenRouter** and **Groq** through their documented chat-completions API (`--provider openrouter|groq --model <id>`), so the open-weight choice is now just a flag. Request shape verified against a local fake server (no money spent). Env vars are `BAKEOFF_CLAUDE_MODEL` / `BAKEOFF_CLAUDE_EFFORT`, because `CLAUDE_EFFORT` is already set by Claude Code's own shell and silently overrode the effort.
- Fix loop: remembers earlier fixes (problems that survived are marked STILL FAILING, with the model's own analysis and the result), stops after two fixes in a row that don't improve, and tells the model plainly when its reply was cut off at the output limit (cut-off code is still extracted).
- New checks: **controls** (each button held 5 s vs. idle; error if none does anything) and **stuck** (warning: player position and progress unchanged for 20 s while directions are pressed).
- `--critic-with <provider>[:model]` so a different, fixed model judges the screenshots; `--parallel N` briefs at once.
- `npm run report` writes `results/report.md`: per-model pass rate now and first try, fix rounds, playtest fun and brief match, critic, $ and s per game, exact model versions and dates.
- `npm test`: 23/23 (2 new cases). Mock pipeline run with `MOCK_STUBBORN=1` (a first fix that doesn't work) to check the memory and the STILL FAILING flag.

**Not verified**: still no real model call (no keys on this machine).

---

## 2026-10-28 (4) — kenzo-aspuru-takata (Claude)

**Done**: built the generation harness from `HARNESS.md` (see `bakeoff/README.md`).
- Engine: tile map + `move()` (can't pass through walls or leave the map), `mpath`, `spr`, `camera`, `printc/textw`, deterministic `sin/cos/atan2`, `rndi/pick/shuffle/chance`, word list (`isword/wordlist/rndword`, SCOWL via `npm run words`), a separate random stream for `draw()`, and diagnostics. The old API still works.
- Contract: games must now export `probe()` and `bot()`; `invariants()` and `tests` are optional. `engine-api.md` rewritten; 3 example games (dodge/survival, maze/speedrun, word/highscore).
- Harness (`bakeoff/harness/`): static checks with acorn, sandbox (vm with code generation off + worker with time/memory limits), smoke runs, per-frame invariants (walls, off screen, unreachable goals by flood fill, NaN, the game's own), the game's bot on 3 seeds, determinism (init reset, draw purity, bot purity), self-tests, a Go-Explore search bot, type verdicts, diagnostics, and screenshot sheets.
- Pipeline (`bakeoff/build.mjs`): design + code → self-review → evaluate → fix loop (3 issues with replays, keep the best) → critic on screenshots → best of N. `npm run gen` = one-shot mode for round 1. Gemini and mock providers. `gen.mjs` removed (replaced by `build.mjs`).
- `npm test`: the 3 examples pass and 18 deliberately broken games are each caught (walls, sealed level, NaN, init reset, logic in draw, cheating bot, Math.random, typo, infinite loop, crash, syntax, missing probe, idle-wins speedrun, unlosable survival, score that doesn't depend on skill, failing self-test, text off screen). All 21 pass.
- The harness found bugs in my own examples on its first run (a dodge bot that died in 5 s, a `_` the font can't draw) and a real bug in Gemini's b01 (the "FULL X2!" label is drawn off screen).
- Added `briefs-genres.json` (8 briefs: word, puzzle, tower defense, card, word puzzle, sports, rhythm, strategy). The playtest page has a "watch the bot" toggle.
- Installed Node 24 LTS on this machine (winget). `npm install` added `acorn`, `acorn-walk` and (dev) `wordlist-english`.

**Not verified**
- No real model has been run through the new pipeline (no `.env` key here). Only the mock. Next step: `npm run build -- b01 b03 --provider gemini`.
- The system prompt is about 5.9k tokens. A full pipeline run is roughly 4-6 calls per game; on Claude Sonnet probably $0.3-0.6 per game. Check the real number on the first run.
- The old b01/b03 fail the new contract (no `probe`/`bot`, `Math.sin`). Regenerate them with the new prompt before comparing models.

**Next**
- Run Gemini through the pipeline on a few briefs, and read the `*.prompt.md`/`*.reply.md` files to see how it handles the feedback.
- Add the Claude provider (Anthropic SDK, per HANDOFF.md) and the open-weight one; the OpenRouter-or-Groq question is still open.

---

## 2026-10-28 (3) — kenzo-aspuru-takata (Claude)

**Done**
- Pulled `out/gemini-flash-latest/b01` and `b03`.
- Investigated the collision bug in `b03.js` (Gemini, ice cave). Root cause: the wall loops (lines ~299–315 for X, ~324–340 for Y) resolve every overlapping solid tile separately and flip `vx`/`vy` on the first hit. When the skater overlaps two stacked wall tiles (most of the time, since it is 7px tall on an 8px grid), the second tile sees the already-reversed velocity and pushes the skater out the *far* side of the wall. Effects: it ratchets through thick walls about 8px per frame, and at the border walls it lands at x=131.1 / x=-3.1, outside the map, where the bounds check ignores every tile, so it softlocks (can never finish). The Y pass has the same bug for floors and ceilings. Also, a skater overlapping a wall with zero velocity is never pushed out.
- Did not edit `b03.js`: it is a bake-off output and has to stay as the model wrote it.

- Later confirmed by running it (Browser pane + local Python static server, since Node isn't installed): with random input the skater leaves the map in 20/20 runs within a few seconds. Also found a second bug: **stage 3 of b03 is unwinnable** (the start room is sealed; flood fill reaches 12 tiles, 0/3 keys, no exit). A search bot "wins" only by exploiting the wall bug.
- `check.mjs` does fail b03, but only as `works: false` (no finish under random input). That message is also expected for good speedruns, so it doesn't tell a model what is wrong.
- Wrote `handoff/HARNESS.md`: proposed generation harness (design step, static/smoke/invariant checks, `probe()` contract, search bots, screenshot critic, fix loop, best-of-N), the feasibility of the model playing the game, and build-vs-reuse.
- Added `.claude/launch.json` (`bakeoff-static`: Python static server on port 8765) for browser experiments without Node.

**Notes for the bake-off**
- The engine API changes proposed in `HARNESS.md` (tile map, `spr`, deterministic `sin`/`cos`, `probe()`) change the prompt, so they should land before more games are generated, or the existing games should be regenerated.

**Next**
- Review `HARNESS.md` with the team; decide on the engine API changes. Install Node here to run `npm` scripts.

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
