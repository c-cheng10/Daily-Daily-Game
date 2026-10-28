# bakeoff/

Minimal setup for generating games with Gemini (free tier) and testing them. No `npm install` needed; Node 22+.

1. Paste your Gemini key into `.env` at the repo root (`GEMINI_API_KEY=...`). Get one at https://aistudio.google.com/apikey.
2. `npm run gen -- --models` lists the models your key can use. Set `GEMINI_MODEL` in `.env` if you want a different one than `gemini-flash-latest`.
3. `npm run gen -- b01 b03 b04` generates those briefs (see `briefs.json`). No args = all 10. Existing outputs are skipped; add `--force` to redo.
4. `npm run check` runs every game headless: banned APIs, contract shape, 3,600 frames of random input, and a determinism replay. Writes `results/checks.json`.
5. `npm run play`, then open http://localhost:8080/play.html. Games are listed blind in random order. Rate fun and brief-match 1–5; ratings stay in your browser until you export them.

| File | What it is |
|---|---|
| `engine/engine.js` | The deterministic console (browser + Node). |
| `engine/engine-api.md` | API and contract. Goes into every prompt. |
| `engine/example-game.js` | Hand-written example. Also goes into every prompt. |
| `gen.mjs` | Gemini generator. Saves `out/<model>/<brief>.js` and a `.json` with tokens, time, model version and raw reply. |
| `check.mjs` | Headless checks in a `vm` sandbox with a 10 s timeout. |
| `play.html`, `serve.mjs` | Blind playtest page. Games run in a sandboxed iframe with no network. |

Not built yet (from `handoff/HANDOFF.md`): Claude and open-weight providers, mock provider, the TypeScript runner, `report.ts`.
