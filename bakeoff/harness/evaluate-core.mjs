// Every check on one game, in order of cost. Produces a report: issues (error / warn / info), metrics,
// self-test results and screenshots. Runs inside a worker (see evaluate.mjs).
import { staticCheck, codeAround } from "./static.mjs";
import { loadGame, describeError, API_NAMES } from "./sandbox.mjs";
import { play, explore, idle, randomInput, designerBot, replayInputs, compressInputs, jsonOf, MAX_FRAMES } from "./runs.mjs";
import { normalizeButtons } from "../engine/engine.js";

const TYPES = ["highscore", "speedrun", "survival"];
const SEEDS = [1234, 99, 7];

export function evaluateSource(src, { brief, exploreMs = 8000, progress = () => {} } = {}) {
  const issues = [], metrics = {}, tests = [];
  const report = { issues, metrics, tests, snaps: [], stagesDone: [] };
  const add = (severity, check, message, extra = {}) => {
    if (extra.line) extra.code = codeAround(src, extra.line);
    issues.push({ severity, check, message, ...extra });
  };
  const stage = (name) => { report.stagesDone.push(name); progress(name, issues); };

  // 1. Static.
  stage("static");
  const st = staticCheck(src, API_NAMES);
  for (const i of st.issues) add(i.severity, i.check, i.message, i.line ? { line: i.line } : {});
  metrics.lines = st.lines;
  metrics.bytes = src.length;
  if (issues.some((i) => i.check === "syntax" || i.check === "shape")) return finish(report);

  // 2. Load and contract shape.
  stage("load");
  let G;
  try { G = loadGame(src); }
  catch (e) { const d = describeError(e); add("error", "load", `the file throws while loading: ${d.message}`, { line: d.line }); return finish(report); }
  const g = G.game;
  if (!g || typeof g !== "object") { add("error", "contract", "the default export is not an object"); return finish(report); }
  for (const fn of ["init", "update", "draw"]) if (typeof g[fn] !== "function") add("error", "contract", `the default export has no ${fn}() function`);
  if (!TYPES.includes(g.type)) add("error", "contract", `type is ${jsonOf(g.type)}; it must be one of ${TYPES.join(", ")}`);
  else if (brief?.type && g.type !== brief.type) add("error", "contract", `type is "${g.type}" but the brief asks for "${brief.type}"`);
  const hasProbe = typeof g.probe === "function", hasBot = typeof g.bot === "function";
  if (!hasProbe) add("error", "contract", "probe() is missing, so the harness can't see the game state");
  if (!hasBot) add("error", "contract", "bot() is missing, so nobody shows the game can be played well");
  if (g.tests !== undefined && !Array.isArray(g.tests)) add("error", "contract", "tests must be an array");
  if (!Array.isArray(g.tests) || !g.tests.length) add("warn", "tests", "no self-tests; add tests for the risks in your design");
  if (issues.some((i) => i.severity === "error" && i.check === "contract" && /init|update|draw|not an object/.test(i.message))) return finish(report);
  const type = TYPES.includes(g.type) ? g.type : brief?.type ?? "highscore";
  metrics.type = type;

  const runErr = (r) => {
    if (!r.error) return false;
    const e = r.error;
    add("error", e.timeout ? "timeout" : "crash", `${r.label}: ${e.message} (in ${e.where}, frame ${e.frame})`,
      { line: e.line, repro: { run: r.label, seed: r.seed, frame: e.frame, inputs: e.inputs } });
    return true;
  };
  const violations = (r) => {
    for (const v of r.violations) {
      add("error", v.check === "game-invariant" ? "invariant" : v.check, `${v.message} (${v.run}, frame ${v.frame})`,
        { detail: v.detail, repro: { run: v.run, seed: v.seed, frame: v.frame, inputs: v.inputs, probe: v.probe } });
    }
  };

  // 3. Smoke: idle and random mashing, with drawing.
  stage("smoke");
  const idleRun = play(G, { label: "idle", input: idle(), type, afterFinish: 30 });
  runErr(idleRun); violations(idleRun);
  // A game that hangs once will hang every run; stop here instead of waiting out each timeout.
  if (idleRun.error?.timeout) return finish(report);
  const randomRuns = [];
  for (const s of [1, 2, 3]) {
    const r = play(G, { label: `random#${s}`, input: randomInput(s), type, afterFinish: 30 });
    randomRuns.push(r);
    if (!runErr(r)) violations(r);
    if (r.error?.timeout) return finish(report);
  }

  // 4. probe() contract.
  stage("probe");
  if (hasProbe && !idleRun.error) {
    const p = idleRun.probe;
    if (!p || typeof p !== "object") add("error", "probe", `probe() returned ${jsonOf(p)}, not an object`);
    else if (!Number.isFinite(p.progress)) add("error", "probe", `probe().progress is ${jsonOf(p.progress)}; it must be a number`);
    if (p?.player && !["x", "y"].every((k) => Number.isFinite(p.player[k]))) add("error", "probe", `probe().player must have numeric x and y, got ${jsonOf(p.player)}`);
  }

  // 5. The game's own bot, on several seeds; the first run also gives the screenshots.
  stage("bot");
  let botRuns = [];
  if (hasBot && hasProbe) {
    botRuns = SEEDS.map((seed, i) => play(G, { label: `bot(seed ${seed})`, seed, input: designerBot(G), type, afterFinish: 30, snapEvery: i === 0 ? 15 : 0 }));
    for (const r of botRuns) { if (!runErr(r)) violations(r); }
    report.snaps = pickSnaps(botRuns[0].snaps);
    if (botRuns.some((r) => r.error?.timeout)) return finish(report);
  } else {
    const r = play(G, { label: "random#1", input: randomInput(1), type, afterFinish: 30, snapEvery: 15 });
    report.snaps = pickSnaps(r.snaps);
  }

  // 6. Determinism: fresh copy vs fresh copy, init reset, draw purity, bot purity.
  stage("determinism");
  const base = botRuns[0] && !botRuns[0].error ? botRuns[0] : randomRuns[0];
  if (!base.error) {
    const inputs = base.inputs, frames = base.frames;
    const opts = { seed: base.seed, frames, input: replayInputs(inputs), type, invariants: false, keepProbes: true };
    let G2 = null;
    try { G2 = loadGame(src); } catch { /* already reported */ }
    const a = G2 ? play(G2, { ...opts, label: "replay A" }) : null;
    const b = play(G, { ...opts, label: "replay B" });            // same context, after many runs: tests init()
    const c = play(G, { ...opts, label: "replay, no draw", draw: false });
    if (a && b) {
      const same = (x, y) => x.hash === y.hash && x.score === y.score && x.finished === y.finished;
      const diff = (x, y) => { const i = x.probes.findIndex((s, k) => s !== y.probes[k]); return i < 0 ? null : { frame: i, a: x.probes[i]?.slice(0, 500), b: y.probes[i]?.slice(0, 500) }; };
      if (!same(a, b)) {
        const d = diff(a, b);
        add("error", "init-reset", `running the same inputs again after init() gives a different game${d ? ` from frame ${d.frame}` : ""}: init() doesn't reset all state`, { detail: d ? `first run:  ${d.a}\nsecond run: ${d.b}` : undefined });
      }
      if (!same(b, c)) {
        const d = diff(b, c);
        add("error", "draw-purity", `the game plays differently when draw() is skipped${d ? ` (from frame ${d.frame})` : ""}: draw() changes game state; move that logic into update()`, { detail: d ? `with draw:    ${d.a}\nwithout draw: ${d.b}` : undefined });
      }
      // Bot purity: the base run's own hash vs a plain replay of its recorded inputs.
      if (same(a, b) && base === botRuns[0] && (base.hash !== b.hash || base.score !== b.score)) {
        add("error", "bot-purity", "replaying the bot's recorded buttons without calling bot() gives a different game: bot() changes game state");
      }
    }
    metrics.deterministic = !issues.some((i) => ["init-reset", "draw-purity", "bot-purity"].includes(i.check));
  }

  // 7. The game's self-tests.
  stage("tests");
  if (Array.isArray(g.tests)) {
    g.tests.slice(0, 12).forEach((t, i) => tests.push(runTest(G, t, i, type)));
    for (const t of tests) if (!t.pass) add("error", "self-test", `self-test "${t.name}" failed: ${t.message}`, { line: t.line, repro: t.repro });
  }

  // 8. Search bot: can the harness, knowing nothing about the game, finish it or score?
  stage("search");
  const ex = explore(G, { budgetMs: exploreMs, type, stopOnFinish: type === "speedrun" });
  if (ex.error) add("error", ex.error.timeout ? "timeout" : "crash", `search bot: ${ex.error.message}`, { line: ex.error.line });
  if (ex.violation) {
    const v = ex.violation;
    add("error", v.check === "game-invariant" ? "invariant" : v.check, `${v.message} (found by the search bot at frame ${v.frame})`,
      { detail: v.detail, repro: { run: "search", seed: v.seed, frame: v.frame, inputs: v.inputs, probe: v.probe } });
  }

  // 9. Verdicts per game type.
  stage("verdicts");
  const ok = (r) => r && !r.error;
  const bots = botRuns.filter(ok);
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  metrics.idle = summary(idleRun);
  metrics.random = randomRuns.map(summary);
  metrics.bot = botRuns.map(summary);
  metrics.search = { iterations: ex.iterations, cells: ex.cells, finished: ex.finished, finishSeconds: ex.finishFrames ? +(ex.finishFrames / 30).toFixed(2) : null, bestProgress: ex.bestProgress, bestScore: ex.bestScore };

  if (type === "speedrun") {
    if (ok(idleRun) && idleRun.finished) add("error", "design", `an idle player finishes in ${(idleRun.finishFrame / 30).toFixed(1)} s without pressing anything`);
    const botDone = bots.filter((r) => r.finished);
    if (hasBot && bots.length && botDone.length < bots.length) {
      const stuck = bots.find((r) => !r.finished);
      add("error", "bot-goal", `your bot didn't finish within 3 minutes on seed ${stuck.seed} (progress reached ${stuck.progressMax}; final probe ${jsonOf(stuck.probe, 400)})${ex.finished ? "; the search bot did finish, so the bot is probably wrong" : "; the search bot couldn't finish either, so check that every level can be completed"}`,
        { repro: { run: stuck.label, seed: stuck.seed, frame: stuck.frames, inputs: compressInputs(stuck.inputs) } });
    }
    if (!botDone.length && !ex.finished) add("error", "finishable", "nobody could finish the game: not your bot, not the search bot. Make sure the goal is reachable and finish() is called when it is reached");
    const t = avg(botDone.map((r) => r.finishFrame / 30));
    metrics.botFinishSeconds = t;
    if (t !== null && t < 8) add("warn", "length", `your bot finishes in ${t.toFixed(1)} s; aim for 20-90 s for a good player`);
    if (t !== null && t > 120) add("warn", "length", `your bot needs ${t.toFixed(0)} s; aim for 20-90 s`);
    const fastRandom = randomRuns.filter((r) => ok(r) && r.finished && r.finishFrame < 600).length;
    if (fastRandom >= 2) add("warn", "too-easy", `random button mashing finishes in under 20 s in ${fastRandom}/3 runs`);
  } else {
    const anyChange = [idleRun, ...randomRuns, ...botRuns].some((r) => ok(r) && r.score !== 0);
    if (!anyChange) add("error", "score", "score() never changes from 0 in any run (idle, random, bot)");
    const botScore = avg(bots.map((r) => r.score));
    metrics.botScore = botScore;
    if (type === "highscore" && hasBot && bots.length && ok(idleRun) && botScore <= idleRun.score) {
      add("error", "skill", `skill doesn't matter: your bot averages ${botScore} but an idle player scores ${idleRun.score}`);
    }
    if (type === "survival") {
      if (ok(idleRun) && !idleRun.finished) add("error", "design", "an idle player never dies in 3 minutes; survival games must be losable");
      if (hasBot && bots.length && ok(idleRun) && idleRun.finished && avg(bots.map((r) => r.frames)) <= idleRun.frames) {
        add("error", "skill", `your bot survives ${(avg(bots.map((r) => r.frames)) / 30).toFixed(1)} s, no longer than an idle player (${(idleRun.frames / 30).toFixed(1)} s)`);
      }
    }
    if ([idleRun, ...bots].every((r) => ok(r) && !r.finished)) add("warn", "length", "the game never ends within 3 minutes (idle or bot); rounds should end in about 2 minutes");
    if (ok(idleRun) && idleRun.finished && idleRun.finishFrame < 90 && type === "highscore") add("warn", "length", `an idle player's game ends after ${(idleRun.finishFrame / 30).toFixed(1)} s`);
  }
  if (hasBot && bots.length && !bots.some((r) => r.moved) && bots.some((r) => r.probe?.player)) add("warn", "bot", "your bot never moves the player");
  if (bots.length && bots.every((r) => r.progressMax === bots[0].progressMax) && bots[0].progressMax === (idleRun.progressMax ?? 0) && type !== "survival") {
    add("warn", "progress", `probe().progress stays at ${bots[0].progressMax} for both the bot and an idle player; it should rise as the player gets closer to winning`);
  }

  // 10. Engine diagnostics, screen and speed.
  stage("diagnostics");
  const runs = [idleRun, ...randomRuns, ...botRuns].filter(ok);
  const diag = mergeDiag(runs);
  metrics.diag = diag;
  const D = (k, sev, msg) => { if (diag[k]) add(sev, `engine:${k}`, `${msg} (${diag[k].count}×, first at frame ${diag[k].first.frame} in ${diag[k].first.phase}: ${jsonOf(diag[k].first, 200)})`); };
  D("nanArg", "error", "a drawing or move() call got NaN/Infinity; some value in your state is broken");
  D("badScore", "error", "score() got a non-number");
  D("badButton", "error", "btn() was called with an invalid button number (use 0-5)");
  D("badColour", "warn", "a colour outside 0-15 was used");
  D("printClipped", "warn", "text was cut off at the screen edge (at most 32 characters per line; use printc/textw)");
  D("unknownChar", "warn", "print() got characters the font doesn't have");
  const sameMax = Math.max(0, ...bots.map((r) => r.maxSame));
  if (sameMax >= 150) add("warn", "frozen", `the screen didn't change for ${(sameMax / 30).toFixed(1)} s while your bot was playing`);
  const perf = runs.map((r) => r.perf);
  metrics.msPerFrame = perf.length ? +(Math.max(...perf.map((p) => p.mean))).toFixed(3) : null;
  metrics.msPerFrameMax = perf.length ? +(Math.max(...perf.map((p) => p.max))).toFixed(2) : null;
  if (metrics.msPerFrame > 4) add("warn", "perf", `update+draw takes ${metrics.msPerFrame} ms per frame on average (budget about 4 ms on a fast PC; phones are slower)`);
  if (metrics.msPerFrameMax > 40) add("warn", "perf", `a single frame took ${metrics.msPerFrameMax} ms`);
  return finish(report);
}

function runTest(G, t, i, type) {
  const name = typeof t?.name === "string" ? t.name : `test #${i + 1}`;
  if (!t || typeof t !== "object") return { name, pass: false, message: "not an object" };
  const frames = Math.min(Math.max(1, Math.floor(t.frames ?? 300)), MAX_FRAMES);
  let input;
  if (t.input === "bot") input = designerBot(G);
  else if (t.input === "random") input = randomInput(1);
  else if (typeof t.input === "function") input = (p, f) => t.input(p, f);
  else if (Array.isArray(t.input)) input = (_p, f) => t.input[f % t.input.length];
  else input = () => normalizeButtons(String(t.input ?? ""));
  let failure = null;
  const wrapped = (p, f) => input(p, f);
  // Per-frame check: run frame by frame through play()'s input hook, checking the state the previous frame produced.
  const r = play(G, {
    label: `test "${name}"`, frames, type, invariants: false,
    input: (p, f) => {
      if (!failure && f > 0 && typeof t.each === "function") {
        const ok = t.each(p, f - 1);
        if (ok !== true && ok !== undefined) failure = { message: `each() at frame ${f - 1}: ${ok}`, frame: f - 1, probe: jsonOf(p, 400) };
      }
      return wrapped(p, f);
    },
  });
  if (r.error) return { name, pass: false, message: `crashed: ${r.error.message}`, line: r.error.line };
  if (!failure && typeof t.each === "function" && r.probe) {
    const ok = safeCall(G, () => t.each(r.probe, r.frames - 1));
    if (ok !== true && ok !== undefined) failure = { message: `each() at frame ${r.frames - 1}: ${ok}`, frame: r.frames - 1, probe: jsonOf(r.probe, 400) };
  }
  if (!failure && typeof t.expect === "function") {
    const ok = safeCall(G, () => t.expect({ probe: r.probe, finished: r.finished, score: r.score, frame: r.frames }));
    if (ok !== true) failure = { message: `expect(): ${ok === false ? "returned false" : ok}`, probe: jsonOf(r.probe, 400) };
  }
  if (failure) return { name, pass: false, message: failure.message, repro: { run: `test "${name}"`, seed: 1234, frame: failure.frame ?? r.frames, inputs: compressInputs(r.inputs), probe: failure.probe } };
  return { name, pass: true };
}

function safeCall(G, fn) {
  try { return G.guard(fn, 2000); } catch (e) { return `threw ${describeError(e).message}`; }
}

function summary(r) {
  return { label: r.label, seed: r.seed, frames: r.frames, finished: r.finished, finishSeconds: r.finishFrame !== null && r.finishFrame !== undefined ? +(r.finishFrame / 30).toFixed(2) : null,
    score: r.score, progressMax: Number.isFinite(r.progressMax) ? r.progressMax : null, error: r.error?.message ?? null, violations: r.violations.length };
}

function mergeDiag(runs) {
  const out = {};
  for (const r of runs) for (const [k, v] of Object.entries(r.diag)) {
    if (!out[k]) out[k] = { count: 0, first: v.first };
    out[k].count += v.count;
  }
  return out;
}

function pickSnaps(snaps) {
  if (!snaps.length) return [];
  const end = snaps[snaps.length - 1], body = snaps.slice(0, -1), n = 15, out = [];
  for (let i = 0; i < n && body.length; i++) out.push(body[Math.floor((i * (body.length - 1)) / Math.max(1, n - 1))]);
  out.push(end);
  return out.filter((s, i, a) => a.indexOf(s) === i);
}

const RANK = { error: 0, warn: 1, info: 2 };
function finish(report) {
  // Collapse duplicates (the same check + message start from several runs), most serious first.
  const seen = new Map();
  for (const i of report.issues) {
    const k = i.check + "|" + i.message.replace(/\(.*?\)/g, "").slice(0, 60);
    if (seen.has(k)) seen.get(k).times = (seen.get(k).times ?? 1) + 1; else seen.set(k, i);
  }
  report.issues = [...seen.values()].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  report.errors = report.issues.filter((i) => i.severity === "error").length;
  report.warnings = report.issues.filter((i) => i.severity === "warn").length;
  report.pass = report.errors === 0;
  return report;
}
