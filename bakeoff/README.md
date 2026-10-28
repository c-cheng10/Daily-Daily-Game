# bakeoff/

The engine, the generation harness and the playtest page. Node 22+ (`npm install` once). Design notes and the reasoning behind the harness: [`handoff/HARNESS.md`](../handoff/HARNESS.md).

## Commands

| Command | What it does |
|---|---|
| `npm run build -- b03` | Full pipeline for brief b03 with Gemini: design → code → self-review → test → fix (up to 3×) → critic. |
| `npm run build -- --provider mock` | The whole pipeline with no API key (a mock model that returns a buggy game first, then fixes it). |
| `npm run build -- b01 --candidates 3` | Best of 3 candidates. |
| `npm run gen -- b01` | Bake-off round 1: one call per game, no review, no fixes (same prompt). |
| `npm run build -- --briefs briefs-genres.json` | Other genres: word, puzzle, card, tower defense, rhythm, sports, strategy. |
| `npm run build -- --models` | List the Gemini models your key can use. |
| `npm run check` | Run every check (no model calls) on all games in `out/` and the examples. Writes `results/checks.json` and screenshot sheets in `results/sheets/`. |
| `npm test` | Tests the harness itself: the examples must pass and 18 deliberately broken copies must each be caught. Run after changing the engine or harness. |
| `npm run play` | Blind playtest at http://localhost:8080/play.html. Tick "watch the bot" to see a game's own bot play. |
| `npm run words` | Rebuild `engine/words.js` from SCOWL. |

Other `build` options: `--model <id>`, `--attempts N`, `--no-review`, `--no-critic`, `--force`, `--out <dir>`.

## What the harness checks

Every game, every time, in a worker thread with a time and memory limit:

1. **Static** (acorn parser): syntax errors with line numbers, banned APIs (`Math.random`, `Math.sin`, `Date`, network…), undefined names (typos), module shape, a hand-rolled tile map that bypasses `mload()`.
2. **Contract**: `type` matches the brief; `init/update/draw/probe/bot` exist; `probe().progress` is a number.
3. **Smoke**: idle and 3 random button-mashers for up to 3 minutes each. Crashes and hangs are reported with the frame, the buttons and the code line.
4. **Invariants on every frame of every run**: the player never overlaps a solid tile or leaves the map, isn't off screen for a second, every `goal` is reachable through the map (flood fill), `probe()` has no NaN, plus the game's own `invariants()`.
5. **The game's own bot** on 3 seeds: a speedrun must be finished; the bot must beat an idle player; survival must be losable.
6. **Determinism**: a fresh copy vs. a reused copy (does `init()` reset everything?), with vs. without `draw()` (is `draw()` pure?), the bot's recorded buttons without the bot (does `bot()` cheat?).
7. **The game's self-tests** (`tests: [...]`).
8. **Search bot** (Go-Explore): knows nothing about the game, explores from `probe()` or coarse screenshots, replays states deterministically. Finds unreachable goals, exploits and softlocks the model's own bot misses.
9. **Engine diagnostics and screen**: NaN passed to drawing, text cut off at the edge, unknown characters, bad colours, a frozen screen, ms per frame.

The fix loop sends back the 3 most important problems, each with a replay (seed, frame, buttons, `probe()`) and the code around the line, keeps the best version so far, and stops when nothing is left. The critic is a model looking at a sheet of 16 screenshots against the brief.

## Output

`out/<model>/<brief>.js` is the best version; `out/<model>/<brief>.json` has tokens, cost, time, model version and the final issues. `out/<model>/<brief>/` keeps every attempt: `*.prompt.md`, `*.reply.md`, `*.js`, `*.report.json`, `*.sheet.png`.

## Files

| File | What it is |
|---|---|
| `engine/engine.js` | The deterministic console (browser + Node): drawing, sprites, tile map + `move()`, deterministic `sin/cos/atan2`, seeded random, words, diagnostics. |
| `engine/engine-api.md` | API and contract (`probe`, `bot`, `invariants`, `tests`). Goes into every prompt. |
| `engine/example-*.js` | Three examples in different genres (dodge, maze, word game). Go into every prompt. |
| `engine/words.js` | 6k common + 24k accepted words (generated). |
| `harness/prompts.mjs` | System prompt, self-review, fix and critic prompts. |
| `harness/evaluate-core.mjs` | All the checks. `runs.mjs` plays games and runs the search bot; `static.mjs` parses; `sandbox.mjs` isolates. |
| `harness/providers.mjs` | Gemini and mock. Claude and the open-weight model still to add. |
| `build.mjs`, `check.mjs`, `serve.mjs`, `play.html` | CLI, batch checks, playtest server and page. |
| `briefs.json`, `briefs-genres.json` | The 10 bake-off briefs; 8 extra briefs across genres. |
