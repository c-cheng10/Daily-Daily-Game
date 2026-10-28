# Engine API and game contract

The console is 128x128 pixels with a fixed 16-colour palette and runs at a fixed 30 frames per second. (0,0) is the top-left corner. Coordinates are floored to whole pixels; drawing outside the screen is clipped. Six buttons, no mouse, no keyboard text input, no sound.

Any genre works within that: action, platformer, puzzle, word game, card game, rhythm, strategy, sports. For text entry, draw an on-screen letter grid and move a cursor over it with the arrows.

## The game contract

A game is one JavaScript file whose default export is an object:

```js
export default {
  type: "highscore",            // "highscore" | "speedrun" | "survival"
  init(seed) { ... },           // called before the first frame; reset ALL state here
  update(input) { ... },        // once per frame; input = 6 booleans (same as btn)
  draw() { ... },               // once per frame after update; draw the whole screen; must not change game state
  probe() { ... },              // REQUIRED: a snapshot of the game state for the test harness (see below)
  bot(p, f) { ... },            // REQUIRED: your own bot that plays the game well (see below)
  invariants(p) { ... },        // optional: rules that must hold every frame; return [] or a list of broken rules
  tests: [ ... ],               // optional but strongly recommended: scripted self-tests (see below)
};
```

- **highscore**: the result is the last value passed to `score(n)`. Higher is better. Call `finish()` when the game is over (out of lives, out of time, out of moves).
- **survival**: like highscore, but the score measures how long the player stayed alive. Call `finish()` when the player dies. A player who does nothing must eventually die.
- **speedrun**: the result is the time from the first frame until `finish()`. Lower is better. Call `finish()` when the goal is reached. The goal must be reachable.

After `finish()`, `update` is no longer called but `draw` still is, so draw a clear end screen with the result. A game should last under about 2 minutes for a decent player.

Keep all state in module-level variables. `init` must fully reset it (including anything you change at runtime, such as a map), because the same game is run many times.

### probe(): what the harness can see

Return a plain, JSON-serialisable object, cheap to compute. All fields are optional except `progress`:

```js
probe() {
  return {
    progress: keys + level * 10,     // REQUIRED number: goes up as the player gets closer to winning / doing well
    state: "play",                   // e.g. "title", "play", "dead", "won"
    level: level,                    // current level/stage/round, if any
    alive: true,
    player: { x, y, w, h },          // player's box in WORLD pixels, if there is an avatar
    goals: [{ x, y }],               // world-pixel positions the player must be able to reach RIGHT NOW (next key, open exit)
    entities: [{ kind: "enemy", x, y, w, h }],   // up to ~30 important things
    vars: { lives, timeLeft, word },  // anything else useful for testing
  };
}
```

The harness uses it to check the game every frame. For example, a `player` box must never overlap a solid tile of the engine map, and every `goal` must be reachable through non-solid, non-hazard tiles.

### bot(p, f): your own player

`bot(p, f)` gets the current `probe()` result and the frame number, and returns the buttons for this frame: an array of 6 booleans, or a string of letters `L R U D O X` (for example `"RO"`, or `""` for nothing). It should play **well**: finish a speedrun, survive long, score high. It may read your module variables, but must **never change game state** (the harness replays its inputs without it and compares). The harness also runs its own idle, random and search bots, and compares them to yours.

### tests: self-tests

```js
tests: [
  { name: "holding left into the wall never enters it", frames: 120, input: "L",
    each: (p, f) => p.player.x >= 8 || "player at x=" + p.player.x },
  { name: "idle player dies within 20 s", frames: 600, input: "",
    expect: (r) => r.finished || "still alive after 20 s" },
  { name: "bot clears level 1", frames: 900, input: "bot",
    expect: (r) => r.probe.level >= 2 || "bot stuck at " + JSON.stringify(r.probe.player) },
]
```

- `input`: a button string held every frame, `"bot"`, `"random"`, an array of button strings (one per frame, repeating), or a function `(p, f) => buttons`.
- `each(p, f)`: checked every frame. `expect(r)`: checked at the end, with `r = { probe, finished, score, frame }`.
- Each returns `true` to pass, or a string explaining the failure.

## Functions (globals)

### Drawing

| Function | What it does |
|---|---|
| `cls(c=0)` | Fill the screen with colour `c`. |
| `pset(x, y, c)` | Set one pixel. |
| `rect(x, y, w, h, c)` / `rectfill(...)` | Rectangle outline / filled, top-left at (x,y), size w by h. |
| `circ(x, y, r, c)` / `circfill(...)` | Circle outline / filled, centred at (x,y), radius r. |
| `line(x0, y0, x1, y1, c)` | Line between two points. |
| `print(text, x, y, c=7)` | 3x5 font, 4 px per character (so at most 32 characters per line). Letters (shown uppercase), digits, space and `: . ! - / ? + % , = ( ) < > '`. |
| `printc(text, y, c=7)` | Print centred horizontally. |
| `textw(text)` | Width of `text` in pixels. |
| `spr(rows, x, y, {flip, flipy, scale})` | Draw a sprite given as strings, one per row, one hex digit (`0`-`f`) per pixel, `.` = transparent. E.g. `spr([".88.", "8778", ".88."], x, y)`. |
| `camera(x=0, y=0)` | Offset all later drawing by (-x, -y), for scrolling worlds. Stays set until changed. |

Colours: 0 black, 1 dark blue, 2 dark purple, 3 dark green, 4 brown, 5 dark grey, 6 light grey, 7 white, 8 red, 9 orange, 10 yellow, 11 green, 12 blue, 13 lavender, 14 pink, 15 peach.

### Input, time, result

| Function | What it does |
|---|---|
| `btn(i)` | True while button `i` is held. `0` left, `1` right, `2` up, `3` down, `4` O (Z key), `5` X (X key). |
| `btnp(i)` | True only on the frame button `i` was pressed. |
| `frame()` | Frames since the game started (30 per second). The only clock. |
| `score(n)` | Set the current score. |
| `finish()` | End the run. |

### Random (seeded, the only allowed randomness)

`rnd(n=1)` float in [0, n) · `rndi(n)` integer in [0, n) · `chance(p)` true with probability p · `pick(arr)` random element · `shuffle(arr)` shuffles in place and returns it. Calls inside `draw()` use a separate stream, so effects like screen shake never change the game.

### Maths (deterministic on every platform)

`sin(a)`, `cos(a)`, `atan2(y, x)` in radians, like `Math` but identical on every device; **use these, never `Math.sin`/`Math.cos`/`Math.atan2`/`Math.tan`/`Math.exp`/`Math.log`/`Math.pow`**. Also `flr`, `ceil`, `abs`, `sqrt`, `min`, `max`, `sgn(v)`, `mid(a, b, c)` (middle value), `clamp(v, lo, hi)`, `lerp(a, b, t)`, `dist(x0, y0, x1, y1)`, `overlap(a, b)` (two `{x, y, w, h}` boxes overlap).

### Tile map and collision (use these instead of writing your own)

| Function | What it does |
|---|---|
| `mload(rows, {tile=8, solid="#", hazard=""})` | Load a map from strings, one character per tile. `solid` lists characters that block movement; `hazard` lists deadly ones (e.g. spikes). Returns `{w, h}` in tiles. Call it in `init` (and on each new level). |
| `mget(tx, ty)` / `mset(tx, ty, ch)` | Read / change a tile (e.g. open a door, collect a key). `mget` returns `null` outside the map. |
| `msolid(tx, ty)` / `mhazard(tx, ty)` | Is that tile solid / a hazard? Outside the map counts as solid. |
| `mfind(ch)` | All tiles with that character: `[{x, y}]` in tile coordinates (e.g. find the start `"P"`). |
| `mdraw(fn)` | Calls `fn(ch, px, py, tx, ty)` for every tile, with pixel coordinates, so you can draw it. |
| `solidat(px, py)` / `boxhit(x, y, w, h)` | Is that pixel / any part of that box inside a solid tile? |
| `move(o, dx, dy)` | Moves box `o = {x, y, w, h}` by (dx, dy) and stops it at solid tiles, one axis at a time, so it can never pass through walls or leave the map. Returns `{x, y}`: which axes hit something (use it to stop or bounce). |
| `mpath(tx0, ty0, tx1, ty1)` | Shortest path between two tiles avoiding solid and hazard tiles: `[{x, y}, ...]` or `null`. Good for enemy AI and for your bot. |

### Words

`isword(w)` true if `w` is an English word (3-7 letters, any case) · `wordlist(len)` common words of that length, uppercase · `rndword(len)` a random common word of that length (seeded).

## Rules

- Use only the functions above, plain JavaScript and the safe parts of `Math` (`floor`, `ceil`, `round`, `abs`, `min`, `max`, `sqrt`, `sign`, `trunc`, `PI`, `hypot` is **not** safe).
- No `Math.random`, `Date`, `performance`, `setTimeout`/`setInterval`, `fetch`, `XMLHttpRequest`, `eval`, `Function(`, `import(`, `require(`, `globalThis`, `window` or DOM access.
- Deterministic: the same seed and the same inputs must always produce the same game.
- No `import` statements and no `export` other than the single `export default`.
