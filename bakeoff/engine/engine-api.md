# Engine API and game contract

The console is 128x128 pixels with a fixed 16-colour palette and runs at a fixed 30 frames per second. (0,0) is the top-left corner. Coordinates are floored to whole pixels; drawing outside the screen is clipped. Six buttons, no mouse, no keyboard text input, no sound.

Any genre works within that: action, platformer, puzzle, word game, card game, rhythm, strategy, sports. For text entry, use the engine's `keyboard()`.

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
  puzzle() { ... },             // REQUIRED for logic puzzles: the current puzzle as a search problem (see below)
  level() { ... },              // REQUIRED if levels are generated: { rows, reqs } for the current level (see below)
  share() { ... },              // optional: short, spoiler-free result text the player can copy after the run
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
    secret: "PLANET",                // the hidden answer, if the game has one (checked against share())
    cards: { pile: pile.map(cardname), hand: hand.map(cardname) },  // card games: EVERY card zone (no card may appear or vanish)
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

### Your own generators and solvers

Your game has its own rules, so you write its generator and its solver; the engine only does the searching and checking. The built-in `genmaze`/`gencave`/`genrooms` and `checklevel` reqs are building blocks for plain walking games. As soon as your mechanic is different (ice that slides until a wall, boxes to push, gravity, teleporters, colour switches, a deal of cards, a set of words), write:

1. **A generator** `make(i)` for YOUR content: build a candidate from `rnd()` (a level, a puzzle, a deal, a word set), using the built-in generators as a starting point if they help.
2. **A solver for YOUR rules**: a `puzzle()` spec whose `apply()` calls the **same rule function your `update()` uses**, so the solver can never disagree with the game. For level games whose movement isn't plain walking, also put a check in `reqs.check(rows)` that runs `solve()` on your own movement rules (e.g. "the exit is reachable by sliding").
3. **Generate-and-test**: `makepuzzle(make, accept)` / `makelevel(make, reqs)` keep only candidates your solver accepts (solvable, unique, the right difficulty: e.g. `solve(...).steps` between 8 and 20), with a known-good fallback if every try fails.
4. **Exports** `puzzle()` / `level()`, so the harness re-runs your solver and your reqs on other seeds.

```js
// Ice puzzle: the player slides until something stops them. One rule function, used by update() AND the solver.
function slide(s, dir) { /* returns the new position, or null if it doesn't move */ }
update() { if (btnp(0)) { const n = slide(pos, 0); if (n) pos = n; } ... }
const spec = (start) => ({ start, moves: () => [0, 1, 2, 3], apply: (s, d) => slide(s, d), goal: (s) => s.x === exit.x && s.y === exit.y, key: (s) => s.x + "," + s.y });
const level = makepuzzle(() => randomIceRoom(), (room) => { const r = solve(spec(room.start), { shortest: true }); return r.steps >= 6 && r.steps <= 14; });
puzzle() { return { ...spec(pos0), shortest: true, par: parMoves }; }
```

### puzzle(): logic puzzles must be solvable (and unique)

Never hand-write or randomly generate a logic puzzle and hope it works. Describe it as a search problem, build each puzzle with the engine's `solve()` (generate a candidate, solve it, keep it only if it has the right number of solutions), and export the current puzzle so the harness can solve it too:

```js
function spec(start) {
  return {
    start,                                   // the puzzle as posed (clues only, not the player's moves)
    moves: (s) => [...],                     // possible moves from state s
    apply: (s, m) => newState or null,       // a NEW state (never change s); null if the move breaks a rule
    goal: (s) => true/false,                 // solved?
    key: (s) => s.join(""),                  // optional: a string id for a state (default JSON)
    show: (s) => "...",                      // optional: text picture of a state, for error messages
  };
}
puzzle() { return { ...spec(clues), unique: true }; }   // or { ..., shortest: true, par: 12 } for move puzzles; null if none on screen
```

- `buttons: (m) => ["R", "R", "O"]` (strongly recommended): the buttons that make move `m` in the real game from its current state, one entry per press. The harness plays the solver's solution through `update()` with them and fails the game if it doesn't advance a level or finish, which catches a solver whose rules differ from the game. `wait: n` adds idle frames after each move (for animations).
- `unique: true`: the harness fails the game if the puzzle has 0 or 2+ solutions (deduction puzzles: grids, nonograms, logic grids).
- `shortest: true` / `par: n`: for move puzzles (sliding, pushing, switching); the harness finds the shortest solution and checks `par`.
- Fill puzzles: `moves` fills the first empty cell; returning `null` from `apply` as soon as a rule breaks keeps the search small.
- The harness checks the puzzle at the start on 3 seeds and at each new `probe().level`.

### level(): generated levels must meet their own requirements

Generated maps are easy to get wrong (sealed rooms, unreachable keys, an exit next to the start). Write down the requirements, generate with `makelevel(make, reqs)` so only passing levels are used, and export them:

```js
reqs = { start: "P", reach: "KE", exit: "E", minPath: 20, count: { P: 1, E: 1, K: 3 }, open: [0.3, 0.8] };
rows = makelevel(() => place(place(gencave(16, 15), "P", 1), "E", 1, { from: "P", farthest: true }), reqs);
...
level() { return { rows, reqs }; }   // the rows as generated (before the player changes them); null if none
```

The harness runs `checklevel(rows, reqs)` itself on 3 seeds and at each new level, and checks the rows match the map loaded with `mload()`.

### share(): the result to copy

Called after `finish()`. Return a short text (under 280 characters, at most 10 lines) such as the score or time and a `sharegrid()` row of coloured squares. It must not give away the answer (`probe().secret`).

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

### Generated levels

Levels are arrays of strings, like `mload()` takes. Generators use the seeded random numbers, so each day's seed gives a new level.

| Function | What it does |
|---|---|
| `genmaze(w, h, {loops, wall, floor})` | A maze (odd sizes work best); every floor tile is connected. `loops` (0-1) opens extra passages. |
| `gencave(w, h, {fill=0.45, steps=4})` | An organic cave; only the biggest connected area is kept, so all floor is connected. |
| `genrooms(w, h, {rooms=6, min=3, max=6})` | Rooms joined by corridors, all connected. |
| `place(rows, ch, n=1, {on=".", from, min, max, farthest})` | Puts `n` copies of `ch` on random tiles that are `on`. With `from` (a character): only tiles at a walking distance between `min` and `max` from it; `farthest: true` picks the farthest. Returns new rows. |
| `checklevel(rows, reqs)` | `{ ok, problems, stats }`. `reqs`: `start` (default `"P"`), `reach` (characters that must all be reachable from start), `exit` with `minPath`/`maxPath` (steps), `count` (`{K: 3}` or `{K: [2, 4]}`), `open` (`[min, max]` fraction of non-solid tiles), `solid` (default `"#"`), `hazard`, `mode` (`"walk"` 4-way, or `"platform"`: gravity, with `jump: [tiles up, tiles sideways in the air]`, default `[3, 4]`; match your physics), `check(rows)` (your own rule: `true` or a message). |
| `makelevel(make, reqs, tries=50)` | Calls `make(i)` until `checklevel` passes; returns the rows, or `null` (handle it: fall back to a simple level that passes). |

### Puzzles

| Function | What it does |
|---|---|
| `solve(p, {max=2, limit=50000, shortest})` | Searches the puzzle `p` (see `puzzle()` above). Returns `{ count, solutions, path, steps, explored, complete }`. `count` stops at `max` (2 tells "unique" from "not unique"). `shortest: true` finds the fewest moves (`path`, `steps`). `complete: false` means it ran out of `limit` states. Use it in `init()`, not every frame. |
| `makepuzzle(make, accept, tries=100)` | Calls `make(i)` until `accept(puzzle)` is true; returns it, or `null`. |

### Words

`isword(w)` true if `w` is an English word (3-7 letters, any case) · `wordlist(len)` common words of that length, uppercase · `rndword(len)` a random common word of that length (seeded). Offensive words are not in the lists.

`anagrams(letters)` common words using exactly these letters · `wordsfrom(letters, min=3)` common words that can be made from these letters · `matchword("C?T")` common words matching a pattern (`?` = any letter) · `neighbors(word)` common words one letter different · `letterfreq(ch)` how common a letter is (0-1) · `letterscore(ch)` 1 (common) to 10 (rare). These scan the list: call them in `init()` or on a key press, not every frame.

### Categories

Hand-checked themed lists (uppercase, drawable): `categories()` the names (`MAMMALS`, `BIRDS`, `FISH`, `INSECTS`, `FRUITS`, `VEGETABLES`, `COLOURS`, `COUNTRIES`, `SPORTS`, `INSTRUMENTS`, `BODY`, `WEATHER`, `SHAPES`, `JOBS`, `CLOTHING`, `KITCHEN`, `VEHICLES`, `TREES`, `PLANETS`, `METALS`, `GEMS`, `FURNITURE`, `TOOLS`, `DRINKS`, `DESSERTS`, `MONTHS`, `DAYS`, `NUMBERS`) · `category(name)` its words · `categoryof(word)` every category containing the word. Some words are in two lists (ORANGE); check `categoryof` when a puzzle needs one group per word. Use these instead of inventing facts.

Bigger lists (about 5,600 entries, not hand-checked, so less certain: e.g. PLANETS includes dwarf planets): pass `{ big: true }` to all three, e.g. `category("DOG BREEDS", { big: true })`. Entries may be two words (`"POLAR BEAR"`, at most 12 characters). Names: ANIMALS, CAT BREEDS, DOG BREEDS, HORSE BREEDS, DINOSAURS, ROOMS, CRAYONS, COLOUR NAMES, ZODIAC, CHINESE ZODIAC, BREADS, PASTRIES, CONDIMENTS, SEAFOOD, FRUITS, HERBS, SPICES, PIZZA TOPPINGS, SANDWICHES, SHELLFISH, VEGETABLES, COUNTRIES, OCEANS, SEAS, RIVERS, LANDFORMS, BODY, FAMILY, JOBS, FABRICS, GEMS, METALS, BUILDING MATERIALS, MUSIC GENRES, INSTRUMENTS, GREEK GODS, GREEK MONSTERS, ROMAN GODS, NORSE GODS, EGYPTIAN GODS, MONSTERS, CLOTHING, CONTAINERS, OBJECTS, FLOWERS, PLANTS, ELEMENTS, PLANETS, SPORTS, APPLIANCES, KNOTS, TIME UNITS, WEAPONS. Prefer the checked lists for answers players must agree on.

### Cards

A card is `{ rank, suit }`: rank 1-13 (1 ace, 11 J, 12 Q, 13 K), suit 0-3 (spades, hearts, diamonds, clubs).

| Function | What it does |
|---|---|
| `deck(n=1)` | `n` standard 52-card decks, in order. Use `shuffle(deck())`. |
| `deal(pile, n=1)` | Removes `n` cards from the top (end) of `pile` and returns them. |
| `cardname(c)` | `"AS"`, `"10H"`, `"QD"`: for `probe().cards` and text. |
| `drawcard(c, x, y, {back, sel})` | Draws a 12x16 card (face down with `back`, highlighted with `sel`). |
| `cardtotal(cards)` | Best total up to 21: J Q K count 10, aces 1 or 11. |
| `pokerhand(cards)` | Best 5-card hand among 5-7 cards: `{ name, rank, score, cards }`. `rank` 0 (high card) to 8 (straight flush); a higher `score` wins. |

For a card game, put every zone in `probe().cards`; the harness checks no card is ever duplicated or lost. For solitaire-style deals that must be winnable, write a solver (see "Your own generators and solvers") and export `puzzle()`.

### Keyboard (text entry)

```js
kb = keyboard({ keys: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", cols: 10, del: true, enter: true });   // in init()
const k = kb.update();   // in update(): null, a letter, "DEL" or "ENTER". Arrows move, O presses, X = DEL
kb.draw(14, 98, { colour: (key) => 7, bg: 5 });   // in draw(); kb.w x kb.h pixels (10 columns: 99x26)
return kb.type(target, typed);   // in bot(): moves to and presses the next letter (DEL if typed is wrong, ENTER when done)
```

`kb.press(key)` presses one key; `kb.key()` is the key under the cursor.

### Share

`sharegrid(rows)` turns letters into coloured squares for `share()`: `G` green, `Y` yellow, `R` red, `B` blue, `O` orange, `P` purple, `W` white, `N` brown, anything else black. One string per line.

## Rules

- Use only the functions above, plain JavaScript and the safe parts of `Math` (`floor`, `ceil`, `round`, `abs`, `min`, `max`, `sqrt`, `sign`, `trunc`, `PI`, `hypot` is **not** safe).
- No `Math.random`, `Date`, `performance`, `setTimeout`/`setInterval`, `fetch`, `XMLHttpRequest`, `eval`, `Function(`, `import(`, `require(`, `globalThis`, `window` or DOM access.
- Deterministic: the same seed and the same inputs must always produce the same game.
- Everyone plays it: no offensive words anywhere (the harness checks all text).
- No `import` statements and no `export` other than the single `export default`.
