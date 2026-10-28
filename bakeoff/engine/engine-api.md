# Engine API and game contract

The console is 128x128 pixels with a fixed 16-colour palette and runs at a fixed 30 frames per second. (0,0) is the top-left corner. All coordinates are floored to whole pixels; drawing outside the screen is clipped.

## The game contract

A game is one JavaScript file whose default export is an object:

```js
export default {
  type: "highscore",          // "highscore" | "speedrun" | "survival"
  init(seed) { ... },         // called once before the first frame; reset all state here
  update(input) { ... },      // called once per frame; input is an array of 6 booleans (same as btn)
  draw() { ... },             // called once per frame after update; draw the whole screen
};
```

- **highscore**: the result is the last value passed to `score(n)`. Higher is better. Call `finish()` when the game is over.
- **survival**: same as highscore, but the score should measure how long the player stayed alive. Call `finish()` when the player dies.
- **speedrun**: the result is the time from the first frame until `finish()` is called. Lower is better. Call `finish()` when the goal is reached.

After `finish()`, `update` is no longer called, but `draw` still is, so draw a game-over or "clear" screen.

Keep all state inside the module (variables or the exported object). `init` must fully reset it, because the same game may be run many times.

## Functions (globals)

| Function | What it does |
|---|---|
| `cls(c=0)` | Fill the screen with colour `c`. |
| `pset(x, y, c)` | Set one pixel. |
| `rect(x, y, w, h, c)` | Rectangle outline, top-left at (x,y), size w by h. |
| `rectfill(x, y, w, h, c)` | Filled rectangle. |
| `circ(x, y, r, c)` | Circle outline centred at (x,y), radius r. |
| `circfill(x, y, r, c)` | Filled circle. |
| `line(x0, y0, x1, y1, c)` | Line between two points. |
| `print(text, x, y, c=7)` | Text in a 3x5 font, 4 pixels per character. Letters A-Z (shown uppercase), digits, and `: . ! - / ? + % , = ( ) < > '`. |
| `btn(i)` | True while button `i` is held. |
| `btnp(i)` | True only on the frame button `i` was pressed. |
| `rnd(n=1)` | Seeded random float in [0, n). The only allowed source of randomness. |
| `frame()` | Number of frames since the game started (30 per second). The only allowed clock. |
| `score(n)` | Set the current score. |
| `finish()` | End the run. |

Buttons: `0` left, `1` right, `2` up, `3` down, `4` O (Z key), `5` X (X key).

## Colours

| # | Colour | # | Colour |
|---|---|---|---|
| 0 | black | 8 | red |
| 1 | dark blue | 9 | orange |
| 2 | dark purple | 10 | yellow |
| 3 | dark green | 11 | green |
| 4 | brown | 12 | blue |
| 5 | dark grey | 13 | lavender |
| 6 | light grey | 14 | pink |
| 7 | white | 15 | peach |

## Rules

- Use only the functions above plus plain JavaScript and `Math` (except `Math.random`).
- No `Math.random`, `Date`, `performance`, `setTimeout`/`setInterval`, `fetch`, `XMLHttpRequest`, `eval`, `Function(`, `import(`, `require(`, DOM or `window` access.
- The game must be deterministic: the same seed and the same inputs must always produce the same result.
- No other `import` or `export` statements besides the single `export default`.
