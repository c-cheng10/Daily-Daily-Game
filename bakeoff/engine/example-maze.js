// Example 2 (speedrun): collect every gem, then reach the exit. Uses the engine tile map and move().
const LEVELS = [
  [
    "################",
    "#P.....#.......#",
    "#.####.#.#####.#",
    "#.#g...#.#...#.#",
    "#.#.####.#.#.#.#",
    "#...#....#.#g..#",
    "###.#.####.###.#",
    "#...#.....^#...#",
    "#.###.####.#.###",
    "#.....#g...#...#",
    "#####.#.####.#.#",
    "#.....#......#.#",
    "#.#########.##.#",
    "#.........#....#",
    "#g#######.....E#",
    "################",
  ],
];
const GEM = [".a.", "a7a", ".a."];
let level, player, start, gems, deaths, won;

function loadLevel(n) {
  mload(LEVELS[n], { solid: "#", hazard: "^" });
  const p = mfind("P")[0];
  start = { x: p.x * 8 + 1, y: p.y * 8 + 1 };
  player = { x: start.x, y: start.y, w: 6, h: 6 };
  gems = mfind("g").length;
}

const tileOf = (o) => ({ x: flr((o.x + o.w / 2) / 8), y: flr((o.y + o.h / 2) / 8) });

export default {
  type: "speedrun",

  init(seed) {
    level = 0;
    deaths = 0;
    won = false;
    loadLevel(0);
  },

  update(input) {
    const dx = (btn(1) ? 1.5 : 0) - (btn(0) ? 1.5 : 0);
    const dy = (btn(3) ? 1.5 : 0) - (btn(2) ? 1.5 : 0);
    move(player, dx, dy);

    const t = tileOf(player), ch = mget(t.x, t.y);
    if (ch === "g") { mset(t.x, t.y, "."); gems--; }
    if (mhazard(t.x, t.y)) { deaths++; player.x = start.x; player.y = start.y; }
    if (ch === "E" && gems === 0) {
      if (level + 1 < LEVELS.length) loadLevel(++level);
      else { won = true; finish(); }
    }
  },

  draw() {
    cls(0);
    mdraw((ch, x, y) => {
      if (ch === "#") rectfill(x, y, 8, 8, 5);
      else if (ch === "g") spr(GEM, x + 2, y + 2);
      else if (ch === "^") { line(x + 1, y + 7, x + 4, y + 1, 8); line(x + 4, y + 1, x + 7, y + 7, 8); }
      else if (ch === "E") rect(x + 1, y + 1, 6, 6, gems === 0 ? 11 : 5);
    });
    rectfill(player.x, player.y, 6, 6, 12);
    print("GEMS " + gems + "  TIME " + (frame() / 30).toFixed(1), 2, 1, 7);
    if (won) {
      rectfill(24, 52, 80, 22, 0);
      printc("ESCAPED!", 56, 11);
      printc((frame() / 30).toFixed(2) + "S", 64, 7);
    }
  },

  probe() {
    const goals = gems > 0 ? mfind("g") : mfind("E");
    return {
      progress: level * 100 + (mfind("g").length === 0 ? 50 : 0) + (10 - gems),
      state: won ? "won" : "play",
      level,
      player: { x: player.x, y: player.y, w: 6, h: 6 },
      goals: goals.map((g) => ({ x: g.x * 8 + 4, y: g.y * 8 + 4 })),
      vars: { gems, deaths },
    };
  },

  // Follow the shortest tile path to the nearest goal, steering toward the next tile's centre.
  bot(p) {
    const me = tileOf(p.player);
    let best = null;
    for (const g of p.goals) {
      const path = mpath(me.x, me.y, flr(g.x / 8), flr(g.y / 8));
      if (path && (!best || path.length < best.length)) best = path;
    }
    if (!best) return "";
    const next = best[0] ?? me;
    const tx = next.x * 8 + 1, ty = next.y * 8 + 1;
    let b = "";
    if (tx > p.player.x + 0.5) b += "R"; else if (tx < p.player.x - 0.5) b += "L";
    if (ty > p.player.y + 0.5) b += "D"; else if (ty < p.player.y - 0.5) b += "U";
    return b;
  },

  invariants(p) {
    return p.vars.gems < 0 ? ["gem count went negative"] : [];
  },

  tests: [
    { name: "holding up-left at the start stays inside the map", frames: 60, input: "LU",
      each: (p) => (p.player.x >= 8 && p.player.y >= 8) || "player at " + p.player.x + "," + p.player.y },
    { name: "the bot escapes within 60 s", frames: 1800, input: "bot", expect: (r) => r.finished || "bot stuck, progress " + r.probe.progress },
    { name: "an idle player never finishes", frames: 300, input: "", expect: (r) => !r.finished || "finished without moving" },
  ],
};
