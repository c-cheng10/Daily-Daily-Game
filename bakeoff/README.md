# bakeoff/

The engine, the generation harness and the playtest page. Node 22+ (`npm install` once). Design notes and the reasoning behind the harness: [`handoff/HARNESS.md`](../handoff/HARNESS.md).

## Commands

| Command | What it does |
|---|---|
| `npm run build -- b03` | Full pipeline for brief b03 with Gemini: design → code → self-review → test → fix (up to 3×) → critic. |
| `npm run build -- b03 --provider claude --model claude-opus-5-5` | Same with Claude (official SDK, effort `high`, prompt caching, `fallbacks: "default"`). Also `--provider openrouter` / `groq` with `--model <free model id>`. |
| `npm run build -- --parallel 3 --critic-with gemini` | 3 briefs at once; screenshots judged by a different, fixed model (recommended for the bake-off). |
| `npm run build -- --provider mock` | The whole pipeline with no API key (a mock model that returns a buggy game first, then fixes it). |
| `npm run build -- b01 --candidates 3` | Best of 3 candidates. |
| `npm run gen -- b01` | Bake-off round 1: one call per game, no review, no fixes (same prompt). |
| `npm run build -- --briefs briefs-genres.json` | Other genres: word, puzzle, card, tower defense, rhythm, sports, strategy. |
| `npm run build -- --models` | List the Gemini models your key can use. |
| `npm run check` | Run every check (no model calls) on all games in `out/` and the examples. Writes `results/checks.json` and screenshot sheets in `results/sheets/`. |
| `npm test` | Tests the harness itself: the 7 examples must pass, 31 deliberately broken copies must each be caught, and 12 unit checks on the engine helpers must pass. Run after changing the engine or harness. |
| `npm run play` | Blind playtest at http://localhost:8080/play.html. Tick "watch the bot" to see a game's own bot play. |
| `npm run report` | Per-model table in `results/report.md`: pass rate now and first try, fix rounds, playtest fun and brief match, critic score, $ and seconds per game, exact model versions. Export ratings from the playtest page to `results/ratings.json` first. |
| `npm run words` | Rebuild `engine/words.js` from SCOWL, with offensive words removed (`harness/blocklist.mjs`; add your own to `engine/blocklist-extra.txt`). |

Other `build` options: `--model <id>`, `--attempts N`, `--no-review`, `--no-critic`, `--force`, `--out <dir>`. Keys go in `.env` (see `.env.example`).

## What the harness checks

Every game, every time, in a worker thread with a time and memory limit:

1. **Static** (acorn parser): syntax errors with line numbers, banned APIs (`Math.random`, `Math.sin`, `Date`, network…), undefined names (typos), module shape, a hand-rolled tile map that bypasses `mload()`, offensive words in any string.
2. **Contract**: `type` matches the brief; `init/update/draw/probe/bot` exist; `probe().progress` is a number.
3. **Smoke**: idle and 3 random button-mashers for up to 3 minutes each. Crashes and hangs are reported with the frame, the buttons and the code line.
   **Controls**: each button held for 5 s vs. doing nothing; an error if no button does anything.
4. **Invariants on every frame of every run**: card games never duplicate or lose a card (`probe().cards`), the player never overlaps a solid tile or leaves the map, isn't off screen for a second, every `goal` is reachable through the map (flood fill), `probe()` has no NaN, plus the game's own `invariants()`. A warning when the player hasn't moved or progressed for 20 s although directions were pressed (softlock).
5. **The game's own bot** on 3 seeds: a speedrun must be finished; the bot must beat an idle player; survival must be losable.
6. **Determinism**: a fresh copy vs. a reused copy (does `init()` reset everything?), with vs. without `draw()` (is `draw()` pure?), the bot's recorded buttons without the bot (does `bot()` cheat?).
7. **The game's self-tests** (`tests: [...]`).
   **Generated content**: if the game exports `puzzle()`, the harness solves it with the engine's solver on 3 seeds and at each new level: it must be solvable, have exactly one solution when it says `unique`, match its `par`, and `apply()` must not change its input; with `buttons()`, the solver's solution is played through the real game, which must count it as solved (so the solver uses the game's real rules). If it exports `level()`, the harness checks the level against the game's own `reqs` (reachability, exit distance, counts, open space, platform jumps, the game's `check()`) and that it matches the loaded map. A game that generates levels or is a logic puzzle but doesn't export them gets a warning.
   **Share text**: `share()` must be short, clean and must not contain `probe().secret`.
8. **Search bot** (Go-Explore): knows nothing about the game, explores from `probe()` or coarse screenshots, replays states deterministically. Finds unreachable goals, exploits and softlocks the model's own bot misses.
9. **Engine diagnostics and screen**: NaN passed to drawing, text cut off at the edge, unknown characters, bad colours, offensive words on screen, `makelevel()`/`makepuzzle()` that never succeed, a frozen screen, ms per frame.

The fix loop sends back the 3 most important problems, each with a replay (seed, frame, buttons, `probe()`) and the code around the line, keeps the best version so far, and stops when nothing is left. It remembers earlier fixes: problems that survived the last fix are marked STILL FAILING, together with what the model said it changed. It stops early after two fixes in a row that don't improve on the best version, and says so plainly when a reply was cut off at the output limit. The critic is a model looking at a sheet of 16 screenshots against the brief.

## Output

`out/<model>/<brief>.js` is the best version; `out/<model>/<brief>.json` has tokens, cost, time, model version and the final issues. `out/<model>/<brief>/` keeps every attempt: `*.prompt.md`, `*.reply.md`, `*.js`, `*.report.json`, `*.sheet.png`.

## Files

| File | What it is |
|---|---|
| `engine/engine.js` | The deterministic console (browser + Node): drawing, sprites, tile map + `move()`, deterministic `sin/cos/atan2`, seeded random, words and word tools, categories, playing cards, on-screen keyboard, puzzle solver, level generators + `checklevel`, `sharegrid`, `dailySeed`, diagnostics. |
| `engine/engine-api.md` | API and contract (`probe`, `bot`, `invariants`, `tests`, `puzzle`, `level`, `share`). Goes into every prompt. |
| `engine/example-*.js` | Examples: dodge (action), cave (generated levels + share), type (keyboard), logic (generated unique puzzles) go into every prompt; maze, word and cards (higher/lower with poker-hand bonuses) are test fixtures. |
| `engine/categories.js` | Hand-checked themed word lists (28 categories). |
| `engine/categories-big.js` | 53 bigger lists (5.6k entries) generated from Darius Kazemi's CC0 [Corpora](https://github.com/dariusk/corpora) by `npm run categories -- <corpora>/data` (download the repo first); family-friendly lists only, cleaned to drawable text, offensive words removed, ordinary words checked against SCOWL. |
| `engine/words.js` | 6k common + 24k accepted words (generated). |
| `harness/prompts.mjs` | System prompt, self-review, fix and critic prompts. |
| `harness/evaluate-core.mjs` | All the checks. `runs.mjs` plays games and runs the search bot; `generated.mjs` checks puzzles and levels; `static.mjs` parses; `sandbox.mjs` isolates; `blocklist.mjs` is the offensive-word list (never shipped to the browser). |
| `harness/providers.mjs` | Claude (Anthropic SDK), Gemini, OpenRouter, Groq, mock. Prices for cost tracking. |
| `build.mjs`, `check.mjs`, `report.mjs`, `serve.mjs`, `play.html` | CLI, batch checks, bake-off report, playtest server and page. |
| `briefs.json`, `briefs-genres.json` | The 10 bake-off briefs; 8 extra briefs across genres. |
