// Headless checks for every generated game in out/<model>/<brief>.js (plus the example game).
// Each game runs in its own vm context with a timeout, so a broken game can't hang the harness.
//   npm run check
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { createEngine, mulberry32, hashFrame } from "./engine/engine.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const FRAMES = 3600, TIMEOUT_MS = 10000, MAX_BYTES = 50000;
const BANNED = [/\bfetch\b/, /XMLHttpRequest/, /\beval\b/, /\bFunction\s*\(/, /Math\.random/, /\bDate\b/, /\bimport\s*\(/, /\brequire\s*\(/];

const briefs = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(root, "briefs.json"), "utf8")).map((b) => [b.id, b]));

// Random input that holds each button combination for a while, like a player would.
function randomInputs(seed) {
  const r = mulberry32(seed), out = [];
  let held = [false, false, false, false, false, false], left = 0;
  for (let i = 0; i < FRAMES; i++) {
    if (left-- <= 0) { held = held.map(() => r() < 0.3); left = Math.floor(r() * 20); }
    out.push(held);
  }
  return out;
}

function run(src, seed, inputs) {
  const eng = createEngine(seed);
  const ctx = vm.createContext({ ...eng.api });
  vm.runInContext("Math.random = () => { throw new Error('Math.random is banned'); }; globalThis.Date = undefined;", ctx);
  vm.runInContext(src.replace(/export\s+default/, "globalThis.__game ="), ctx, { timeout: TIMEOUT_MS, filename: "game.js" });
  const game = ctx.__game;
  if (!game || typeof game.init !== "function" || typeof game.update !== "function" || typeof game.draw !== "function") {
    throw new Error("default export is missing init/update/draw");
  }
  let firstScore = null, scoreChanged = false;
  ctx.__start = () => eng.start(game);
  ctx.__tick = (b) => {
    eng.tick(game, b);
    if (firstScore === null) firstScore = eng.state.score;
    else if (eng.state.score !== firstScore) scoreChanged = true;
  };
  ctx.__inputs = inputs;
  vm.runInContext(`__start(); for (let i = 0; i < ${FRAMES}; i++) __tick(__inputs[i]);`, ctx, { timeout: TIMEOUT_MS });
  return {
    type: game.type, scoreChanged, finished: eng.state.finished, finishFrame: eng.state.finishFrame,
    score: eng.state.score, result: eng.result(game.type), hash: hashFrame(eng.fb),
  };
}

function check(file, briefId) {
  const src = fs.readFileSync(file, "utf8");
  const c = { file: path.relative(root, file), brief: briefId };
  const banned = BANNED.filter((re) => re.test(src)).map(String);
  c.static = banned.length === 0 && src.length <= MAX_BYTES;
  if (!c.static) c.staticIssues = [...banned, ...(src.length > MAX_BYTES ? [`size ${src.length}`] : [])];
  try {
    const inputs = randomInputs(42);
    const a = run(src, 1234, inputs);
    c.loads = true;
    c.typeMatches = !briefs[briefId] || a.type === briefs[briefId].type;
    c.runs = true;
    c.works = a.type === "speedrun" ? a.finished || a.scoreChanged : a.scoreChanged;
    const b = run(src, 1234, inputs);
    c.deterministic = JSON.stringify(a) === JSON.stringify(b);
    Object.assign(c, { type: a.type, finished: a.finished, result: a.result });
  } catch (e) {
    c.error = String(e.message ?? e).split("\n")[0];
  }
  c.pass = !!(c.static && c.loads && c.typeMatches && c.runs && c.works && c.deterministic);
  return c;
}

const files = [[path.join(root, "engine/example-game.js"), "example"]];
const outRoot = path.join(root, "out");
if (fs.existsSync(outRoot)) {
  for (const model of fs.readdirSync(outRoot)) {
    for (const f of fs.readdirSync(path.join(outRoot, model)).filter((f) => f.endsWith(".js"))) {
      files.push([path.join(outRoot, model, f), f.replace(/\.js$/, "")]);
    }
  }
}

const results = files.map(([f, id]) => check(f, id));
fs.mkdirSync(path.join(root, "results"), { recursive: true });
fs.writeFileSync(path.join(root, "results/checks.json"), JSON.stringify({ date: new Date().toISOString(), results }, null, 2));

const yn = (v) => (v ? "ok" : v === false ? "NO" : "-");
console.log("file".padEnd(42), "static loads type runs works determ  PASS");
for (const c of results) {
  console.log(c.file.padEnd(42), [c.static, c.loads, c.typeMatches, c.runs, c.works, c.deterministic].map((v) => yn(v).padEnd(5)).join(" "), c.pass ? "PASS" : "FAIL",
    c.error ? `  ${c.error}` : "", c.staticIssues ? `  banned: ${c.staticIssues.join(", ")}` : "");
}
console.log(`\n${results.filter((c) => c.pass).length}/${results.length} pass. Details in bakeoff/results/checks.json`);
