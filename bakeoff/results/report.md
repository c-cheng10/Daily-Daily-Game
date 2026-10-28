# Bake-off report

Generated 2026-10-28 06:19 UTC from `out/`, `results/checks.json` and no playtest ratings yet.

| Model | Exact version | Games | Pass (now) | Pass first try | Avg fix rounds | Fun | Brief match | Rated | Critic | $/game | s/game | Run dates |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gemini-flash-latest | gemini-3.8-flash | 3 | 0% | - | - | - | - | 0 | - | - | 132 | 2026-10-28 |

- **Pass (now)**: share of the model's current games that pass every harness check (`npm run check`).
- **Pass first try**: share whose first attempt passed, before any self-review fixes or fix rounds.
- **Fun / Brief match**: average blind playtest ratings (1-5) exported from `play.html`. **Critic**: average of the screenshot critic's three 1-5 scores.

## Failing games

- `out/gemini-flash-latest/b01.js`: banned: Math.sin: use the engine's sin(); contract: probe() is missing, so the harness can't see the game state; contract: bot() is missing, so nobody shows the game can be played well
- `out/gemini-flash-latest/b03.js`: banned: Math.cos: use the engine's cos(); banned: Math.sin: use the engine's sin(); contract: probe() is missing, so the harness can't see the game state
- `out/gemini-flash-latest/b04.js`: banned: Math.cos: use the engine's cos(); banned: Math.sin: use the engine's sin(); contract: probe() is missing, so the harness can't see the game state
