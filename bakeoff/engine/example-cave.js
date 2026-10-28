// Example 6 (speedrun, generated levels): three caves, a new layout every day. Grab 3 crystals, then reach the door.
// Levels are generated from the seed with gencave() + place(), and makelevel() keeps only layouts that meet the
// requirements (everything reachable, the door far enough away). level() hands the same requirements to the harness.
const SPEED = 1, LEVELS = 3;
let level, rows, reqs, player, crystals, times, levelStart, done;

function levelReqs() {
  return { start: "P", reach: "KE", exit: "E", minPath: 10 + level * 3, count: { P: 1, E: 1, K: 3 }, open: [0.35, 0.8] };
}

function buildLevel() {
  reqs = levelReqs();
  rows = makelevel(() => {
    let r = gencave(16, 15, { fill: 0.4 });
    r = place(r, "P", 1);
    r = place(r, "E", 1, { from: "P", farthest: true });
    return place(r, "K", 3, { from: "P", min: 4 });
  }, reqs, 40);
  // makelevel() returns null only if 40 caves in a row fail; fall back to a plain room that meets the reqs (route: 25 steps).
  if (!rows) rows = ["################", "#P.............#", ...Array(11).fill("#..............#"), "#K....K....K..E#", "################"];
  mload(rows, { solid: "#" });
  const p = mfind("P")[0];
  mset(p.x, p.y, ".");
  player = { x: p.x * 8 + 1, y: p.y * 8 + 1, w: 6, h: 6 };
  crystals = 0;
  levelStart = frame();
}

// The text the player can copy after a run: total time, then a coloured square per cave
// (green under 15 s, yellow under 30 s, red slower). No map, so it spoils nothing.
function shareText() {
  return "CRYSTAL CAVES " + (frame() / 30).toFixed(1) + "S\n" + sharegrid([times.map((t) => (t < 450 ? "G" : t < 900 ? "Y" : "R")).join("")]);
}

const tileOf = (o) => ({ x: flr((o.x + o.w / 2) / 8), y: flr((o.y + o.h / 2) / 8) });

export default {
  type: "speedrun",

  init(seed) {
    level = 0;
    times = [];
    done = false;
    buildLevel();
  },

  update(input) {
    move(player, ((btn(1) ? 1 : 0) - (btn(0) ? 1 : 0)) * SPEED, ((btn(3) ? 1 : 0) - (btn(2) ? 1 : 0)) * SPEED);
    const t = tileOf(player), ch = mget(t.x, t.y);
    if (ch === "K") { mset(t.x, t.y, "."); crystals++; }
    if (ch === "E" && crystals === 3) {
      times.push(frame() - levelStart);
      level++;
      if (level >= LEVELS) { done = true; finish(); } else buildLevel();
    }
  },

  draw() {
    cls(0);
    camera(0, -8);
    mdraw((ch, x, y) => {
      if (ch === "#") { rectfill(x, y, 8, 8, 1); line(x, y, x + 7, y, 13); }
      else if (ch === "K") spr(["..c..", ".ccc.", "cc7cc", ".ccc.", "..c.."], x + 1, y + 1);
      else if (ch === "E") { rectfill(x + 1, y, 6, 8, crystals === 3 ? 11 : 5); pset(x + 5, y + 4, 10); }
    });
    spr([".9999.", "999999", "970790", "999999", "999999", ".9..9."], player.x, player.y);
    camera(0, 0);
    rectfill(0, 0, 128, 8, 0);
    print("CAVE " + Math.min(level + 1, LEVELS) + "/" + LEVELS + "  CRYSTALS " + crystals + "/3", 2, 2, 7);
    const t = (frame() / 30).toFixed(1) + "S";
    print(t, 126 - textw(t), 2, 10);
    if (frame() < 90) { rectfill(4, 58, 120, 11, 0); printc("GET 3 CRYSTALS, THEN THE DOOR", 61, 12); }
    if (done) {
      rectfill(14, 44, 100, 30, 0);
      printc("ESCAPED!", 50, 11);
      printc("TIME " + (frame() / 30).toFixed(1) + "S", 60, 7);
    }
  },

  probe() {
    const goals = crystals < 3 ? mfind("K") : mfind("E");
    return {
      progress: level * 10 + crystals * 2,
      state: done ? "won" : "play",
      level: level + 1,
      player: { ...player },
      goals: goals.map((g) => ({ x: g.x * 8 + 4, y: g.y * 8 + 4 })),
      vars: { crystals },
    };
  },

  // The level as generated (before the player picked anything up), with the rules it was generated to meet.
  level() {
    return done ? null : { rows, reqs };
  },

  share: () => shareText(),

  // Walk the shortest tile path to the nearest goal, lining up with each tile before moving on.
  bot(p, f) {
    const from = tileOf(player);
    let best = null;
    for (const g of p.goals) {
      const path = mpath(from.x, from.y, flr(g.x / 8), flr(g.y / 8));
      if (path && (!best || path.length < best.length)) best = path;
    }
    if (!best) return "";
    const next = best[0] ?? from, tx = next.x * 8 + 1, ty = next.y * 8 + 1;
    return (player.x < tx ? "R" : player.x > tx ? "L" : "") + (player.y < ty ? "D" : player.y > ty ? "U" : "");
  },

  tests: [
    { name: "the bot escapes all three caves", frames: 5000, input: "bot", expect: (r) => r.finished || "stuck at " + JSON.stringify(r.probe) },
    { name: "every level meets its reqs", frames: 1, input: "", expect: () => checklevel(rows, reqs).ok || checklevel(rows, reqs).problems.join("; ") },
    { name: "the share text has one square per cave", frames: 5000, input: "bot", expect: (r) => [...shareText().split("\n")[1]].length === LEVELS || "share: " + shareText() },
  ],
};
