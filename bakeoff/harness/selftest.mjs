// Tests the harness itself: the examples must pass, and each deliberately broken copy ("mutant")
// must be caught by the check named in `expect`. Run after changing the engine or the harness.
//   npm test
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate } from "./evaluate.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = (f) => fs.readFileSync(path.join(root, "engine", f), "utf8");
const DODGE = src("example-game.js"), MAZE = src("example-maze.js"), WORD = src("example-word.js");
const must = (s, from, to) => { if (!s.includes(from)) throw new Error(`mutant source not found: ${from}`); return s.replace(from, to); };

const CASES = [
  { name: "example: dodge", code: DODGE, pass: true },
  { name: "example: maze", code: MAZE, pass: true },
  { name: "example: word", code: WORD, pass: true },
  // Code bugs.
  { name: "walks through walls (own movement instead of move())", code: must(MAZE, "move(player, dx, dy);", "player.x += dx; player.y += dy;"), expect: ["wall"] },
  { name: "sealed level: exit walled in", code: must(MAZE, '"#g#######.....E#",', '"#g#######....#E#",').replace('"#.........#....#",', '"#.........#...##",'), expect: ["unreachable"] },
  { name: "ship can leave the screen", code: must(DODGE, "px = clamp(px, 0, 122);", ""), expect: ["invariant"] },
  { name: "NaN score", code: must(WORD, "points += word.length * word.length;", "points += word.length * word.length / (found.length - 1);"), expect: ["engine:badScore"] },
  { name: "init() doesn't reset rocks", code: must(DODGE, "    rocks = [];\n", "    rocks = rocks || [];\n"), expect: ["init-reset"] },
  { name: "game logic inside draw()", code: must(must(DODGE, "for (const r of rocks) r.y += r.vy;", ""), "for (const r of rocks) rectfill(r.x, r.y, 4, 4, 6);", "for (const r of rocks) { r.y += r.vy; rectfill(r.x, r.y, 4, 4, 6); }"), expect: ["draw-purity"] },
  { name: "bot changes game state", code: must(WORD, "if (f % 2) return \"\";", "points += 0.5; if (f % 2) return \"\";"), expect: ["bot-purity"] },
  { name: "Math.random", code: must(DODGE, "rocks.push({ x: rnd(124)", "rocks.push({ x: Math.random() * 124"), expect: ["banned"] },
  { name: "typo in a variable name", code: must(DODGE, "if (btn(1)) px += 2;", "if (btn(1)) pz += 2;"), expect: ["unknown-global"] },
  { name: "infinite loop after 3 s", code: must(DODGE, "  update(input) {\n", "  update(input) {\n    if (frame() === 90) { let i = 0; while (true) i++; }\n"), expect: ["timeout"] },
  { name: "crash: reading a missing object", code: must(DODGE, "score(flr(frame() / 30));", "score(flr(frame() / 30)); if (frame() === 60) rocks[999].x = 1;"), expect: ["crash"] },
  { name: "syntax error", code: must(DODGE, "spawnEvery = 20;", "spawnEvery = 20;;}"), expect: ["syntax"] },
  { name: "probe() missing", code: must(DODGE, "  probe() {", "  probeX() {"), expect: ["contract"] },
  // Design bugs.
  { name: "speedrun an idle player finishes", code: must(MAZE, "if (ch === \"E\" && gems === 0) {", "if (true) {"), expect: ["design"] },
  { name: "survival where idle never dies", code: must(DODGE, "alive = false;\n      finish();", "alive = alive;"), expect: ["design"] },
  { name: "highscore where skill doesn't matter", code: must(WORD, "points += word.length * word.length; score(points);", "score(points);"), expect: ["score"] },
  { name: "self-test that fails", code: must(DODGE, "frames: 1200, input: \"\", expect: (r) => r.finished || \"never died\"", "frames: 30, input: \"\", expect: (r) => r.finished || \"never died\""), expect: ["self-test"] },
  { name: "text off screen", code: must(DODGE, 'print("TIME " + flr(frame() / 30), 2, 2, 7);', 'print("TIME " + flr(frame() / 30), 110, 2, 7);'), expect: ["engine:printClipped"] },
];

const results = [];
const queue = CASES.slice();
await Promise.all(Array.from({ length: 4 }, async () => {
  for (let c; (c = queue.shift());) {
    const t0 = Date.now();
    const r = await evaluate(c.code, { exploreMs: 4000 });
    const checks = new Set(r.issues.map((i) => i.check));
    const ok = c.pass ? r.pass && r.warnings === 0 : c.expect.every((e) => checks.has(e));
    results.push({ ...c, ok, r, s: ((Date.now() - t0) / 1000).toFixed(1) });
  }
}));

let failed = 0;
for (const c of CASES) {
  const x = results.find((y) => y.name === c.name);
  if (!x.ok) failed++;
  const found = x.r.issues.filter((i) => i.severity === "error").map((i) => i.check);
  console.log(`${x.ok ? "ok  " : "FAIL"}  ${c.name}  [${x.s}s]  ${c.pass ? `pass=${x.r.pass} warnings=${x.r.warnings}` : `expected ${c.expect.join(",")}; caught: ${[...new Set(found)].join(",") || "nothing"}`}`);
  if (!x.ok) for (const i of x.r.issues.slice(0, 5)) console.log(`        [${i.severity}] ${i.check}: ${i.message.slice(0, 160)}`);
}
console.log(`\n${CASES.length - failed}/${CASES.length} harness self-tests passed`);
process.exit(failed ? 1 : 0);
