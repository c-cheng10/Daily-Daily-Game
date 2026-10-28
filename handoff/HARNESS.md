# Generation harness design

How to turn "an LLM writes a game" into "a game that has been checked, played and fixed before anyone sees it". Written 2026-10-28 by kenzo-aspuru-takata (Claude).

**Status (2026-10-28, later the same day): built**, see `bakeoff/README.md`. Built as described below, except:
- One model call does design + code (with a `<design>` block first), not two.
- On top of the plan: a self-review step before testing (the model checks its own code against the checklist), model-written `tests` and `invariants()` in the game contract, three different example games in the prompt, a word list for word games, engine diagnostics (NaN in drawing, text cut off, frozen screen), and `npm test`, a suite of 18 broken games that the harness must catch.
- Not built: frame-by-frame play by a model (not worth it, see below). Claude, OpenRouter and Groq providers were added afterwards, along with fix-loop memory, a plateau stop, controls and softlock checks, a separate critic model and `npm run report` (see `LOG.md`, session 5).
- Not yet run against a real model: there is no API key on the machine where it was built. Verified with the mock provider (the full fix loop) and on the examples and the old b01/b03.

## TL;DR

- **Build our own small harness; don't wrap a general coding agent.** The output is one file against our own API, and the checks that matter (play the game, look at the screen) are specific to our engine. The harness has to treat all 4 bake-off models identically. Claude Code, the Agent SDK, Aider and OpenHands are built for editing repositories, and the Agent SDK only drives Claude. A custom loop is a few hundred lines.
- **Most bug reduction comes from three things, in this order:** (1) engine helpers that remove whole bug classes (tile collision, sprites, deterministic `sin`/`cos`); (2) a small required `probe()` in the game contract, so the harness can see the player and check invariants; (3) search bots that actually play the game at thousands of frames per second.
- **The model playing the game frame by frame is technically possible but the wrong tool.** Our engine is deterministic and can be paused, so the usual latency problem disappears. But it costs about $1 and 10+ minutes per playthrough and plays worse than a search bot. Use the model where it is strong: writing a bot for its own game, and judging a sheet of screenshots.
- **Generate several candidates and keep the best.** Generation is offline and once a day, so a slow, thorough pipeline costs us nothing in user-facing speed.

## Evidence from b03 (Gemini, ice cave)

Run in the browser on 2026-10-28; script in "Experiments" below.

| Test | Result |
|---|---|
| Invariant "player not inside a wall and not off the map", 20 random-input runs × 3,600 frames | **Bug found in 20/20 runs**, first hit at a median of about 40 frames (about 1.3 s). In every run the skater ends up outside the map and stays there (a softlock). |
| Current `check.mjs` | Fails b03 only as `works: false` (never finished). That says nothing about walls, and random input rarely finishes a *good* 3-stage speedrun either, so this check is noisy for speedruns. |
| Search bot (Go-Explore style), original game | **"Won" in 17 s, by exploiting the bug**: about 350k frames inside walls or off the map along the way. Without invariants this would look like a healthy, finishable speedrun. Players would find the same exploit and it would top the leaderboard. |
| Search bot, same game with the collision loop fixed in memory | 0 invariant violations, cleared stages 1–2, **stuck at the start of stage 3** after 90 s. |
| Flood fill of the 3 level maps | Stages 1 and 2: keys and exit reachable. **Stage 3: the start room is sealed by walls and spikes, so only 12 tiles are reachable, with 0/3 keys and no exit.** The level is unwinnable without the bug. |
| Speed | 0.13 ms per frame including `draw()` in the browser (about 250× faster than real time); `update()` alone is faster. |

So b03 has **two** bugs that no "does it run" check finds: wall clipping (a code bug) and an impossible level (a design bug), and the first hides the second. Invariants catch the first; a search bot (or a flood fill over the map, if the engine owns the tile map) catches the second. Root cause of the wall bug: see `LOG.md`, session 3.

## The pipeline

```
brief ─► 1 design ─► 2 code ─► 3 static ─► 4 smoke ─► 5 invariants ─► 6 bots ─► 7 critic ─► score
                        ▲                                                                  │
                        └──────────── 8 fix loop: compact failure report (≤3 tries) ◄──────┘
         × N candidates per day ─► 9 pick the best ─► human playtest (bake-off) / publish (prod)
```

Steps 3–6 are pure code (free, deterministic, seconds). Steps 1, 2, 7 and 8 call the model.

### 1. Design first (one model call, or the first part of the same call)

The model returns a short structured design before any code: goal, controls, how you win or lose, the score formula, the difficulty curve, and **testable claims** such as "the player can't pass through walls", "the exit is reachable", "an idle player dies within 20 s" and "the score only goes up". The harness turns those claims into extra checks in step 5, and the critic (step 7) checks them against the brief. Brief match is the weakest area in the research (Spec2Game), and this gives it a written spec to check against.

### 2. Code

Same prompt as now, plus the helper API and the `probe()` contract below.

### 3. Static (exists, extend it)

- Banned APIs (exists). Add `Math.sin`/`Math.cos` once the engine provides deterministic versions.
- **Parse with a real JS parser** (acorn, which has no dependencies) instead of regexes. That gives exact syntax errors with a line number, which a model can fix in one try.
- Undefined globals: any identifier that isn't a local, an engine function or a JS built-in is a typo or an unsupported API. This is cheap and catches a lot.
- Size limit (exists).

### 4. Smoke (exists, extend it)

- Loads, the contract shape is right, the type matches the brief, 3,600 random frames run without throwing, and the run is deterministic (all exist).
- **Init really resets:** run → `init` → run again with the same inputs; the hashes must match. That catches state that leaks between runs, which breaks server replay.
- **NaN/Infinity:** the score and every `probe()` number must stay finite.
- **Performance budget:** the average and worst `update+draw` time per frame. A game that takes 30 ms per frame stutters on phones.
- **Draw purity:** `draw()` must not change game state. Today `b03` calls `rnd()` in `draw()` for screen shake, so skipping or adding a draw changes the random stream the game logic sees. The engine should give `draw()` its own random stream, or `rnd()` should be off-limits in `draw()`. Replay on the server should never depend on drawing.

### 5. Invariants, which need `probe()`

Add one required function to the contract:

```js
probe() { return { player: {x, y, w, h}, alive, progress, solids?: (tx, ty) => bool } }
```

- `progress` is a number that goes up as the player gets closer to winning (keys collected, stage, distance). Bots and the fix loop use it.
- If the engine provides a tile map (`mset`/`mget`/`fget`), the harness reads solids from the engine itself and the game doesn't report them, which can't be faked.

Generic invariants, run on every frame of every bot run:

- player on screen (or in an allowed area), not inside a solid tile;
- no teleporting: per-frame movement under a cap;
- for survival, the score doesn't go down; for highscore, `score()` is called at all;
- after `finish()`, the end screen still draws without throwing.

Plus the design-specific claims from step 1. On a failure, keep the **seed + input log + frame number**, so the bug can be replayed exactly. That is the main input to the fix loop.

### 6. Bots: playing the game without a model

Deterministic replay is a big advantage: any state can be restored by replaying its input log, so bots can search.

| Bot | What it answers |
|---|---|
| Idle (no input) | Does doing nothing win or score well? (a broken design) Does idle death happen at all in survival? |
| Mashers (random, hold-each-direction) | Crashes and invariants under silly input (exists, as random). |
| **Go-Explore search** over macro-actions, cells from `probe()` | Can the speedrun be finished, and how fast? What score can the best play reach? Is there an unbeatable wall in progress? |
| Model-written bot (see below) | The same, guided by an understanding of the game. |

The harness reports **difficulty bands**: idle score, random score, best search score, and the frame by which most random runs die. "Search finishes in 9 s, random never finishes" is a healthy speedrun. "Idle survives forever" or "search can't finish" goes to the fix loop.

### 7. Critic: the model judges what it can see

One call per candidate, cheap:

- A **contact sheet**: about 16 frames sampled across a bot run, scaled up and tiled into one PNG, plus the end screen. The engine already renders into a framebuffer in Node, so making PNGs needs only `zlib`.
- The step 6 stats, the design, and the brief.
- A rubric: readable at 128×128? HUD visible? Does it match the theme and mechanic? Is the end screen clear? Does anything look broken (overlapping text, a sprite stuck in a wall)?

**Use a different model from the one that wrote the game.** Models judge their own work too kindly. In the bake-off, use one fixed critic for every candidate so its bias is the same everywhere.

### 8. Fix loop

- Send back **at most 3 problems**, the most serious first, each with the failing check, the frame, the `probe()` state there and the relevant code lines. Long logs make fixes worse.
- The model returns the full file. It's under 50 KB, so diffs aren't worth the fragility.
- Re-run every step on the new version. **Keep the best version so far**, not the latest, because fixes can break things that worked.
- At most 3 tries, then drop the candidate.

### 9. Best of N

Generate N = 3–5 candidates per brief (different seeds or temperatures, or different models), run them all, and rank them on: hard gates (steps 3–5 pass) → bot health (step 6) → critic score (step 7). In production the top candidate is published; in the bake-off we report per-model pass rates both one-shot and with the loop.

## Can the model play the game itself?

Three options, from best to worst fit:

| Option | How | Cost per game | Verdict |
|---|---|---|---|
| **A. The model writes a bot** (code as policy) | Give the model its game code and the `probe()` shape; it returns `policy(probe, frame) -> buttons`. The harness runs it headless at full speed. | 1 call, about $0.02–0.05 on Sonnet | **Yes.** Cheap and fast, and it plays the way the designer meant. Use it alongside search: if neither the designer's bot nor search can win, the game is broken. |
| **B. The model judges screenshots** | The contact sheet in step 7. | 1 call, about $0.01–0.03 | **Yes.** The only automatic check for "looks right" and "matches the brief". |
| **C. The model plays frame by frame** | Pause the engine, send a frame (a 128×128 image or a text/ASCII state), get buttons for the next 5–10 frames, repeat. | About 180 decisions for a 60 s game. At about 3k input + 100 output tokens each, roughly $1.30 on Sonnet ($2/$10 per M) and 6–15 minutes. Free Gemini rate limits make that slower. | **Not as a routine check.** Real-time benchmarks show LLMs fail mostly on latency (VideoGameBench, Orak); our pause-anywhere engine removes that, but a search bot still plays better for the cost. Keep it as an optional final QA run on the day's chosen game. |

## Build vs reuse

| Option | Fit |
|---|---|
| **Custom orchestrator** (Node, providers behind `generateGame`) | **Recommended.** Same pipeline for every model; all steps are ours anyway. |
| Claude Agent SDK / Claude Code headless with custom tools (`run_checks`, `play`, `screenshot`) | Good agent loop with custom in-process tools, but Claude only and the loop is less predictable. Worth testing in **production** if Claude wins the bake-off: expose steps 3–7 as tools and let it drive. |
| Gemini CLI, Aider, OpenHands | General repo editors. Overkill for one file and no help with playing the game. |
| Libraries to use | `acorn` (parse), `isolated-vm` or a worker process for the production sandbox (Node's `vm` is **not** a security boundary; fine for the bake-off, not for running other people's code on the server). |

## Order of work

1. Engine: tile map + `spr` + `mid`/`flr`/deterministic `sin`/`cos`, a separate random stream for `draw()`, and `probe()` in the contract. Update `engine-api.md` and the example game. (Changes the prompt, so do it **before** more bake-off generation.)
2. `check.mjs`: parser, undefined globals, init-reset, NaN, perf, draw purity, invariants.
3. Bots: idle, masher, Go-Explore. Difficulty bands in the results.
4. Contact sheet PNG + critic call.
5. Fix loop + best-of-N.
6. Optional: model-written bots; frame-by-frame play as final QA.

## Experiments

Run in the Browser pane against a local static server (`.claude/launch.json` → `bakeoff-static`), because Node isn't installed on this machine. The experiment code was throwaway and is not in the repo. It reached into b03's internal variables (`px`, `py`, `levelMap`) in place of a real `probe()`. Rebuild it properly in `bakeoff/` as part of steps 2–3 above: invariant loop, Go-Explore over macro-actions (8 directions + none, optional dash/brake, held 4–13 frames) with cells = (stage, keys, tile x, tile y), restoring states by deterministic replay without `draw()`.

## Sources

- GBQA: a benchmark of LLMs as game QA engineers; autonomous bug discovery is still hard. https://arxiv.org/abs/2604.02648
- TITAN: LLM agents for automated game testing. https://arxiv.org/abs/2509.22170
- Orak: real-time games, latency results. https://arxiv.org/pdf/2506.03610
- VideoGameBench results via VGBench write-up. https://epochs.getmaxim.ai/vgbench-evaluating-vision-language-models-in-real-time-gaming-environments-21b5641c011d
- Claude Agent SDK, headless use. https://code.claude.com/docs/en/headless
- Fix-loop and Spec2Game numbers: see `HANDOFF.md` (self-reported by those papers).
