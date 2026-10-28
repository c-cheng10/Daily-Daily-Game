// Example 1 (survival): dodge falling rocks. Score = seconds alive.
const SHIP = ["..cc..", ".c77c.", "cccccc", "c.88.c"];
let px, rocks, alive, spawnEvery;

export default {
  type: "survival",

  init(seed) {
    px = 60;
    rocks = [];
    alive = true;
    spawnEvery = 20;
  },

  update(input) {
    if (btn(0)) px -= 2;
    if (btn(1)) px += 2;
    px = clamp(px, 0, 122);

    if (frame() % spawnEvery === 0) {
      rocks.push({ x: rnd(124), y: -4, w: 4, h: 4, vy: 1 + rnd(1.5) });
      if (spawnEvery > 6 && frame() % 150 === 0) spawnEvery--;
    }
    for (const r of rocks) r.y += r.vy;
    rocks = rocks.filter((r) => r.y < 132);

    const me = { x: px, y: 118, w: 6, h: 4 };
    if (rocks.some((r) => overlap(r, me))) {
      alive = false;
      finish();
    }
    score(flr(frame() / 30));
  },

  draw() {
    cls(1);
    rectfill(0, 122, 128, 6, 3);
    for (const r of rocks) rectfill(r.x, r.y, 4, 4, 6);
    spr(SHIP, px, 118);
    print("TIME " + flr(frame() / 30), 2, 2, 7);
    if (!alive) {
      printc("GAME OVER", 56, 8);
      printc("YOU LASTED " + flr(frame() / 30) + "S", 64, 7);
    }
  },

  probe() {
    return {
      progress: flr(frame() / 30),
      state: alive ? "play" : "dead",
      alive,
      player: { x: px, y: 118, w: 6, h: 4 },
      entities: rocks.slice(0, 30).map((r) => ({ kind: "rock", x: r.x, y: r.y, w: 4, h: 4, vy: r.vy })),
    };
  },

  // Look ahead: for staying, going left and going right, simulate the next 40 frames and pick
  // the move that gets hit latest (or never), preferring the middle of the screen.
  bot(p) {
    const firstHit = (dir) => {
      for (let t = 1; t <= 40; t++) {
        const x = clamp(p.player.x + dir * 2 * t, 0, 122);
        const me = { x, y: 118, w: 6, h: 4 };
        if (p.entities.some((e) => overlap({ x: e.x, y: e.y + e.vy * t, w: 4, h: 4 }, me))) return t;
      }
      return 99;
    };
    let best = "", bestScore = -1;
    for (const [b, dir] of [["", 0], ["L", -1], ["R", 1]]) {
      const s = firstHit(dir) * 100 - abs(p.player.x + dir * 20 - 61);
      if (s > bestScore) { bestScore = s; best = b; }
    }
    return best;
  },

  invariants(p) {
    return p.player.x < 0 || p.player.x > 122 ? ["ship left the screen at x=" + p.player.x] : [];
  },

  tests: [
    { name: "an idle player dies within 40 s", frames: 1200, input: "", expect: (r) => r.finished || "never died" },
    { name: "holding left keeps the ship on screen", frames: 120, input: "L", each: (p) => p.player.x >= 0 || "x=" + p.player.x },
    { name: "the bot outlives an idle player", frames: 1800, input: "bot", expect: (r) => r.score >= 20 || "bot died at " + r.score + "s" },
  ],
};
