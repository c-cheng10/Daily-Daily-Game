// Example: dodge falling rocks. Survival type: score = seconds alive.
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
    px = Math.max(0, Math.min(120, px));

    if (frame() % spawnEvery === 0) {
      rocks.push({ x: rnd(124), y: -4, vy: 1 + rnd(1.5) });
      if (spawnEvery > 6 && frame() % 150 === 0) spawnEvery--;
    }
    for (const r of rocks) r.y += r.vy;
    rocks = rocks.filter((r) => r.y < 132);

    for (const r of rocks) {
      if (r.x + 4 > px && r.x < px + 8 && r.y + 4 > 116 && r.y < 122) {
        alive = false;
        finish();
      }
    }
    score(Math.floor(frame() / 30));
  },

  draw() {
    cls(1);
    rectfill(0, 122, 128, 6, 3);
    for (const r of rocks) rectfill(r.x, r.y, 4, 4, 6);
    rectfill(px, 116, 8, 6, alive ? 12 : 8);
    print("TIME " + Math.floor(frame() / 30), 2, 2, 7);
    if (!alive) print("GAME OVER", 46, 60, 8);
  },
};
