// Tests the harness itself: the examples must pass, and each deliberately broken copy ("mutant")
// must be caught by the check named in `expect`. Run after changing the engine or the harness.
//   npm test
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate } from "./evaluate.mjs";
import { BLOCKED, isBlocked } from "./blocklist.mjs";
import { createEngine } from "../engine/engine.js";
import { WORDS } from "../engine/words.js";
import { CATEGORIES } from "../engine/categories.js";
import { BIG_CATEGORIES } from "../engine/categories-big.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = (f) => fs.readFileSync(path.join(root, "engine", f), "utf8");
const DODGE = src("example-game.js"), MAZE = src("example-maze.js"), WORD = src("example-word.js");
const LOGIC = src("example-logic.js"), TYPE = src("example-type.js"), CAVE = src("example-cave.js"), CARDS = src("example-cards.js");
const must = (s, from, to) => { if (!s.includes(from)) throw new Error(`mutant source not found: ${from}`); return s.replace(from, to); };
// A word from the blocklist, so no offensive word has to be written in this file.
const BAD = [...BLOCKED].find((w) => /^[A-Z]{4,6}$/.test(w));
const BAD_CODES = [...BAD].map((c) => c.charCodeAt(0)).join(", ");

const CASES = [
  { name: "example: dodge", code: DODGE, pass: true },
  { name: "example: maze", code: MAZE, pass: true },
  { name: "example: word", code: WORD, pass: true },
  { name: "example: logic puzzle", code: LOGIC, pass: true },
  { name: "example: typing (keyboard)", code: TYPE, pass: true },
  { name: "example: generated caves", code: CAVE, pass: true },
  { name: "example: cards", code: CARDS, pass: true },
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
  { name: "no button does anything", code: must(must(DODGE, "if (btn(0)) px -= 2;", ""), "if (btn(1)) px += 2;", ""), expect: ["controls"] },
  { name: "player gets stuck halfway (softlock)", code: must(MAZE, "move(player, dx, dy);", "if (player.y < 40) move(player, dx, dy);"), expect: ["stuck"] },
  // Logic puzzles.
  { name: "puzzle with several answers (no uniqueness check)", code: must(LOGIC, "if (solve(spec(s), { max: 2 }).count === 1) clues--; else s[i] = v;", "clues--;"), expect: ["puzzle-unique"] },
  { name: "puzzle with contradicting clues", code: must(LOGIC, "  grid = givens.slice();", "  givens[0] = givens[1] = 1;\n  grid = givens.slice();"), expect: ["puzzle-unsolvable"] },
  { name: "puzzle apply() changes its input", code: must(LOGIC, "const t = s.slice(); t[m.i] = m.v; return t;", "s[m.i] = m.v; return s;"), expect: ["puzzle-purity"] },
  { name: "puzzle generator never succeeds", code: must(LOGIC, "(s) => s.filter(Boolean).length <= CLUES[level] + 1, 20)", "(s) => false, 20)"), expect: ["engine:makepuzzleFailed"] },
  { name: "solver rules differ from the game (O adds 2)", code: must(LOGIC, "if (btnp(4)) grid[i] = (grid[i] + 1) % (N + 1);", "if (btnp(4)) grid[i] = (grid[i] + 2) % (N + 1);"), expect: ["puzzle-rules"] },
  // Cards.
  { name: "a card gets duplicated", code: must(CARDS, "    shown.push(cur);", "    shown.push(cur, cur);"), expect: ["cards"] },
  // Generated levels.
  { name: "level generator ignores its reqs", code: must(CAVE, "}, reqs, 40);", "}, {}, 40);"), expect: ["level-reqs"] },
  { name: "level() describes a different map", code: must(CAVE, "return done ? null : { rows, reqs };", "return done ? null : { rows: rows.map((r) => r.replace(/#/g, \".\")), reqs: { count: { P: 1 } } };"), expect: ["level-mismatch"] },
  { name: "share() crashes", code: must(CAVE, "share: () => shareText(),", "share: () => times.x.y,"), expect: ["share"] },
  // Offensive words.
  { name: "offensive word in the source", code: must(DODGE, 'print("TIME " + flr(frame() / 30), 2, 2, 7);', `print("TIME " + flr(frame() / 30), 2, 2, 7); const label = "${BAD.toLowerCase()}";`), expect: ["offensive"] },
  { name: "offensive word built at runtime and printed", code: must(TYPE, 'printc("NEXT WORD STARTS WITH", 14, 6);', `printc("NEXT WORD STARTS WITH", 14, 6); printc(String.fromCharCode(${BAD_CODES}), 90, 6);`), expect: ["engine:blockedWord"] },
  { name: "text off screen", code: must(DODGE, 'print("TIME " + flr(frame() / 30), 2, 2, 7);', 'print("TIME " + flr(frame() / 30), 110, 2, 7);'), expect: ["engine:printClipped"] },
];

// Engine helpers, checked directly.
const api = createEngine(5, { words: WORDS, categories: CATEGORIES, bigCategories: BIG_CATEGORIES }).api;
const UNITS = [
  ["anagrams", () => api.anagrams("stop").includes("SPOT") && api.anagrams("stop").every((w) => w.length === 4)],
  ["wordsfrom only uses the given letters", () => api.wordsfrom("planet").every((w) => api.anagrams(w).length && [...w].every((c) => "PLANET".includes(c)))],
  ["matchword", () => api.matchword("c?t").includes("CAT") && api.matchword("c?t").every((w) => w[0] === "C" && w[2] === "T")],
  ["neighbors differ by one letter", () => api.neighbors("cold").includes("GOLD") && !api.neighbors("cold").includes("COLD")],
  ["no offensive word in the word lists", () => ![...WORDS.common.split(" "), ...WORDS.all.split(" ")].some(isBlocked)],
  ["categories are drawable words", () => Object.values(CATEGORIES).flat().every((w) => /^[A-Z]{2,12}$/.test(w))],
  ["big categories: drawable, clean, separate from the checked ones", () => Object.values(BIG_CATEGORIES).flat().every((w) => /^[A-Z]+( [A-Z]+)?$/.test(w) && w.length <= 12 && !w.split(" ").some(isBlocked))
    && api.category("animals", { big: true }).includes("AARDVARK") && !api.category("animals").length && api.category("mammals").includes("DOG") && api.categoryof("cobra", { big: true }).length >= 0],
  ["walk reachability", () => api.checklevel(["#####", "#P#E#", "#####"], { exit: "E" }).problems.length === 1],
  ["platform: a 4-tile climb needs jump >= 4", () => {
    const tall = ["##########", "#.....E..#", "#........#", "#........#", "#........#", "#P.......#", "##########"];
    return !api.checklevel(tall, { mode: "platform", exit: "E", jump: [3, 4] }).ok && api.checklevel(tall, { mode: "platform", exit: "E", jump: [4, 4] }).ok;
  }],
  ["generators are seeded and connected", () => {
    const a = createEngine(9).api, b = createEngine(9).api, m = a.gencave(20, 16), m2 = b.gencave(20, 16);
    const r = a.place(m, "P", 1), r2 = a.place(r, "E", 1, { from: "P", farthest: true });
    return m.join() === m2.join() && a.checklevel(r2, { exit: "E", reach: "E" }).ok && a.checklevel(a.place(a.genmaze(15, 11), "P", 1), {}).ok;
  }],
  ["poker hands", () => {
    const c = (s) => s.split(" ").map((x) => ({ rank: "A23456789TJQK".indexOf(x[0]) + 1, suit: "SHDC".indexOf(x[1]) }));
    const h = (s) => api.pokerhand(c(s));
    return h("AS KS QS JS TS 2H 3D").name === "STRAIGHT FLUSH" && h("AS 2H 3D 4C 5S").name === "STRAIGHT" && h("KS KH KD 2C 2S").name === "FULL HOUSE"
      && h("2S 2H 9D 9C KS").name === "TWO PAIR" && h("AS AH 3D 4C 6S").score > h("KS KH QD JC 9S").score && h("2S 4S 6S 8S TS").name === "FLUSH";
  }],
  ["cards: deck, deal, total", () => {
    const d = api.deck(), top = d[d.length - 1], hand = api.deal(d, 2);
    return d.length === 50 && hand[0] === top && api.cardtotal([{ rank: 1 }, { rank: 13 }]) === 21 && api.cardtotal([{ rank: 1 }, { rank: 1 }, { rank: 9 }]) === 21 && api.cardname({ rank: 10, suit: 1 }) === "10H";
  }],
  ["solve counts solutions", () => {
    const p = { start: [], moves: (s) => (s.length < 3 ? [0, 1] : []), apply: (s, m) => [...s, m], goal: (s) => s.length === 3 };
    return api.solve(p, { max: 100 }).count === 8 && api.solve(p, { max: 2 }).count === 2 && api.solve(p, { shortest: true }).steps === 3;
  }],
];
let unitFailed = 0;
for (let [name, fn] of UNITS) {
  let ok = false;
  try { ok = fn() === true; } catch (e) { name += ` (threw ${e.message})`; }
  if (!ok) unitFailed++;
  console.log(`${ok ? "ok  " : "FAIL"}  unit: ${name}`);
}

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
console.log(`\n${CASES.length - failed}/${CASES.length} harness self-tests passed, ${UNITS.length - unitFailed}/${UNITS.length} engine unit checks passed`);
process.exit(failed || unitFailed ? 1 : 0);
