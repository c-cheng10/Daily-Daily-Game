# Handoff: model bake-off for Daily-Daily-Game

You are picking up a new project in this repo (`Daily-Daily-Game`, currently empty apart from `.git`). Read this whole prompt before writing anything.

## The product (context only; do NOT build all of this)

A daily web game like Wordle, except every day an LLM writes a brand-new small game in a PICO-8 style (128x128 pixels, 16-colour palette). Each day's game has a type: high score, speedrun or survival. A **permanent platform** (engine, leaderboard, anti-cheat, archive) stays fixed; each **daily game is just one JS file** that plugs into a fixed contract. Leaderboard anti-cheat will work by **server-side replay**: the client sends seed + per-frame inputs, the server re-runs the game headlessly and computes the score itself. That only works if the engine is deterministic, so determinism is a hard requirement from day one.

## Your job: the model bake-off only

Answer one question with data: **which LLM writes the best daily games for this engine?** Build a small, reproducible test harness in `bakeoff/`. Do not build the leaderboard, accounts, website or scheduler.

### Models to compare (4 models x 10 briefs = 40 games)

| Model | Access | Notes |
|---|---|---|
| Claude Sonnet 5.5, `claude-sonnet-5-5` | Anthropic API, paid | #1 on BenchLM coding (Oct 2026). $2 / $10 per million input/output tokens. |
| Claude Opus 5.5, `claude-opus-5-5` | Anthropic API, paid | #1 on llm-stats' coding composite. $4 / $20. Thinking is always on; set `output_config: {effort: "high"}` explicitly (its default is `medium`). |
| A current Gemini model on the **free tier** | Google AI Studio key | Check AI Studio for which Flash/Pro models are free today; free-tier prompts may be used by Google for training. |
| The strongest open-weight coding model available **free** | OpenRouter (`:free` models) or Groq | Candidates: Kimi K3, DeepSeek V4, Qwen3-Coder, GLM-5.x, gpt-oss-120b. **Ask the user whether to use OpenRouter or Groq**, then pick whichever strong model is currently free there and record exactly which one. |

Prices are as of early October 2026; verify them before quoting costs. Expected total spend is about $5 on Claude, $0 elsewhere. **Confirm with the user before any run expected to cost more than about $10.**

For the Claude calls, **use the official Anthropic SDK (`@anthropic-ai/sdk`) and load the `claude-api` skill before writing that code**. Do not reach Claude through an OpenAI-compatible shim. Use streaming + `finalMessage()` with a large `max_tokens` (e.g. 64000), handle `stop_reason === "refusal"`, and use the server-side `fallbacks: "default"` option (beta `server-side-fallback-2026-07-01`) as the skill describes. Use each other provider's own documented API.

### What to build (TypeScript on Node)

1. **`bakeoff/engine/engine.js`: a minimal deterministic fantasy console (~100–150 lines).**
   - 128x128 canvas, scaled up crisply. The 16-colour PICO-8 palette: `#000000 #1D2B53 #7E2553 #008751 #AB5236 #5F574F #C2C3C7 #FFF1E8 #FF004D #FFA300 #FFEC27 #00E436 #29ADFF #83769C #FF77A8 #FFCCAA`.
   - API exposed to games: `cls(c)`, `pset(x,y,c)`, `rect(x,y,w,h,c)`, `rectfill(...)`, `circ(x,y,r,c)`, `circfill(...)`, `line(...)`, `print(text,x,y,c)`, `btn(i)` / `btnp(i)` (6 buttons: left, right, up, down, O, X), `rnd(n)` (**seeded**, e.g. mulberry32), `score(n)`, `finish()`.
   - Fixed 30 fps timestep. No wall-clock time anywhere in game logic.
   - The same engine must also run **headless in Node** (draw calls become no-ops or write to a buffer), for the checks and later for server replay.
2. **`bakeoff/engine/engine-api.md`**: the API and the game contract in plain words. This text goes into every prompt. The contract, as a default export:
   `{ type: "highscore" | "speedrun" | "survival", init(seed), update(input), draw() }`.
   Speedrun = time to `finish()`, lower is better. High score / survival = the value passed to `score()`, higher is better.
3. **`bakeoff/engine/example-game.js`**: one small hand-written example that follows the contract exactly (e.g. a dodge game).
4. **`bakeoff/briefs.json`**: 10 briefs, mixed by type (4 highscore, 3 speedrun, 3 survival), each with an id, type, theme and one mechanic, e.g. `{"id": "b03", "type": "speedrun", "theme": "ice cave", "mechanic": "sliding momentum"}`.
5. **`bakeoff/bakeoff.ts`: the runner.**
   - For each model x brief, send the **identical** system prompt (engine docs + example + rules: "return only the JavaScript file; use only this API; no network, no eval, no Math.random, no Date") and the brief as the user message. **One shot; no fix loop in round 1.**
   - Save `out/<model>/<brief-id>.js`, the raw response, input/output tokens, computed cost, and wall time.
   - It must be resumable (skip outputs that already exist) and able to run one model or one brief at a time.
6. **`bakeoff/check.ts`: automated checks**, headless, per game:
   - **static**: none of `fetch`, `XMLHttpRequest`, `eval`, `Function(`, `Math.random`, `Date`, `import(`, `require(`; under a size limit;
   - **loads**: it exports the contract shape, and its `type` matches the brief;
   - **runs**: 3,600 frames of random (seeded) input with no exception;
   - **works**: the score changes, or `finish()` is reachable, as appropriate for the type;
   - **deterministic**: the same seed and the same input log give an identical result twice.
   Run games in an isolated context (e.g. Node `vm` with a timeout) so one broken game can't hang or crash the harness. Write `results/checks.json`.
7. **`bakeoff/play.html`: a blind playtest page.** It loads all 40 games in a **random order without showing the model name**. You can play each one and rate fun (1–5) and "matches the brief" (1–5). Ratings are saved to `localStorage` and can be exported as JSON.
8. **`bakeoff/report.ts`**: joins the checks and ratings into a per-model table (check pass rate, average fun, average brief-match, cost per game, seconds per game) and writes `results/report.md`.
9. **A mock provider**, so the whole pipeline can be tested with no API keys.

### Round 2 (only after round 1 is reviewed with the user)

Add a fix loop: when a check fails, send the error back to the model and regenerate, up to 3 attempts. Rerun the two best models. The research suggests this matters more than model choice: one-shot generation met ~27–37% of behaviour checks against ~67% with a generate-play-fix loop (GUI Agents for Continual Game Generation; self-reported). Spec2Game also showed that "the code runs" can sit near 99% while "the game does what the brief asked" is much lower, so the playtest rating is essential.

## Rules

- **Never commit or push.** Leave every change uncommitted and report what you changed. The user commits.
- API keys live only in `.env` (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, and `OPENROUTER_API_KEY` or `GROQ_API_KEY`). Add `.env` to `.gitignore` **before** creating it. Provide `.env.example`. Never hardcode or print keys.
- Treat generated game code as untrusted: sandbox it in the checks (`vm` + timeout) and in the browser (a sandboxed iframe, no network).
- Keep each provider behind one function, `generateGame(brief, model) -> {code, usage, ms}`, so providers can be swapped.
- Record every model's exact ID and the date in the results, since free models change often.

## Done means

- A clean round-1 run of 40 games, with all checks recorded.
- `results/report.md` with the per-model table (playtest columns are filled in once the user has played).
- A short summary for the user: which model leads on pass rate and on cost, notable failure patterns, and a recommendation for round 2.

## Open question for the user, before you start

OpenRouter or Groq for the free open-weight model?
