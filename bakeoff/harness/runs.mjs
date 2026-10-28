// Running a game headless: one play() for every input source, per-frame invariant checks, and the search bot.
import { normalizeButtons, buttonsToString, hashFrame, mulberry32, W, H } from "../engine/engine.js";
import { describeError } from "./sandbox.mjs";

export const MAX_FRAMES = 5400; // 3 minutes
const RUN_TIMEOUT_MS = 10000; // a normal 3-minute run takes well under a second

const fnv = (h, s) => { for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
export const jsonOf = (v, max = 1500) => {
  let s;
  try { s = JSON.stringify(v); } catch (e) { s = `"<not JSON-serialisable: ${e.message}>"`; }
  if (s === undefined) s = "undefined";
  return s.length > max ? s.slice(0, max) + "…" : s;
};

// "R*12 RO .*3": run-length encoded buttons, for feedback.
export function compressInputs(inputs, last = 60) {
  const tail = inputs.slice(-last).map(buttonsToString), out = [];
  for (let i = 0; i < tail.length;) {
    let j = i;
    while (j < tail.length && tail[j] === tail[i]) j++;
    out.push(j - i > 1 ? `${tail[i]}*${j - i}` : tail[i]);
    i = j;
  }
  return (inputs.length > last ? `(${inputs.length - last} earlier frames) ` : "") + out.join(" ");
}

function findNonFinite(v, path = "probe", depth = 0, budget = { n: 400 }) {
  if (budget.n-- <= 0 || depth > 4) return null;
  if (typeof v === "number") return Number.isFinite(v) ? null : `${path} = ${v}`;
  if (v && typeof v === "object") {
    for (const k of Object.keys(v).slice(0, 60)) {
      const r = findNonFinite(v[k], Array.isArray(v) ? `${path}[${k}]` : `${path}.${k}`, depth + 1, budget);
      if (r) return r;
    }
  }
  return null;
}

// Flood fill from the player's tile through tiles that are neither solid nor hazards.
function reachability(api, map, from) {
  const seen = new Set([from.y * map.w + from.x]), q = [from];
  for (let i = 0; i < q.length; i++) {
    const { x, y } = q[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = ny * map.w + nx;
      if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h || seen.has(k) || api.msolid(nx, ny) || api.mhazard(nx, ny)) continue;
      seen.add(k); q.push({ x: nx, y: ny });
    }
  }
  return seen;
}

// Harness-side invariants, checked every frame. memo carries state between frames.
export function harnessInvariants(p, eng, memo) {
  const out = [];
  if (!p || typeof p !== "object") return out;
  const bad = findNonFinite(p);
  if (bad) out.push({ check: "nan", message: `probe has a non-finite number: ${bad}` });
  // Card games: probe().cards = { pile: ["AS", ...], hand: [...], ... } lists every card zone. Cards may move
  // between zones but never appear, vanish, or exist in more copies than at the start.
  if (p.cards && typeof p.cards === "object") {
    const all = Object.values(p.cards).flatMap((z) => (Array.isArray(z) ? z : []));
    const counts = {};
    for (const c of all) counts[c] = (counts[c] ?? 0) + 1;
    if (!memo.cards) memo.cards = { total: all.length, counts };
    else {
      const extra = Object.keys(counts).filter((c) => counts[c] > (memo.cards.counts[c] ?? 0));
      const gone = Object.keys(memo.cards.counts).filter((c) => (counts[c] ?? 0) < memo.cards.counts[c]);
      if (all.length !== memo.cards.total || extra.length || gone.length) {
        out.push({ check: "cards", message: `cards appeared or vanished: ${memo.cards.total} cards at the start, ${all.length} now${extra.length ? `; extra copies of ${extra.slice(0, 6).join(" ")}` : ""}${gone.length ? `; missing ${gone.slice(0, 6).join(" ")}` : ""}. Every card must stay in exactly one zone of probe().cards` });
        memo.cards = { total: all.length, counts }; // report each change once
      }
    }
  }
  const pl = p.player, map = eng.getMap();
  const box = pl && [pl.x, pl.y, pl.w ?? 1, pl.h ?? 1].every(Number.isFinite) ? { x: pl.x, y: pl.y, w: pl.w ?? 1, h: pl.h ?? 1 } : null;
  if (box && map && eng.api.boxhit(box.x + 0.01, box.y + 0.01, box.w - 0.02, box.h - 0.02)) {
    const tx = Math.floor((box.x + box.w / 2) / map.ts), ty = Math.floor((box.y + box.h / 2) / map.ts);
    const where = tx < 0 || ty < 0 || tx >= map.w || ty >= map.h ? "outside the map" : `inside a solid tile near tile (${tx},${ty})`;
    out.push({ check: "wall", message: `the player's box {x:${+box.x.toFixed(2)}, y:${+box.y.toFixed(2)}, w:${box.w}, h:${box.h}} is ${where}` });
  }
  if (box) {
    const sx = box.x - eng.cam.x, sy = box.y - eng.cam.y;
    const visible = sx + box.w > 0 && sx < W && sy + box.h > 0 && sy < H;
    memo.off = visible ? 0 : (memo.off ?? 0) + 1;
    if (memo.off === 30) out.push({ check: "offscreen", message: `the player has been off screen for 1 s (screen position ${sx.toFixed(1)},${sy.toFixed(1)})` });
  }
  if (box && map && Array.isArray(p.goals) && p.goals.length) {
    const key = `${p.level}|${jsonOf(p.goals, 400)}`;
    if (key !== memo.goalKey) {
      memo.goalKey = key;
      const from = { x: Math.floor((box.x + box.w / 2) / map.ts), y: Math.floor((box.y + box.h / 2) / map.ts) };
      const seen = reachability(eng.api, map, from);
      const lost = p.goals.filter((g) => !seen.has(Math.floor(g.y / map.ts) * map.w + Math.floor(g.x / map.ts)));
      if (lost.length) {
        const rows = map.rows.map((row, ty) => row.map((ch, tx) => {
          if (tx === from.x && ty === from.y) return "@";
          if (lost.some((g) => Math.floor(g.x / map.ts) === tx && Math.floor(g.y / map.ts) === ty)) return "!";
          return seen.has(ty * map.w + tx) ? "+" : ch;
        }).join(""));
        out.push({ check: "unreachable", message: `${lost.length} goal(s) can't be reached from the player through non-solid, non-hazard tiles`,
          detail: `map (@ player, + reachable, ! unreachable goal):\n${rows.join("\n")}` });
      }
    }
  }
  return out;
}

// Play one run. input(p, f) returns buttons. Returns everything the evaluator needs.
export function play(G, o) {
  const { seed = 1234, frames = MAX_FRAMES, input, draw = true, afterFinish = 0, snapEvery = 0, label = "run",
    invariants = true, keepProbes = false, type } = o;
  const eng = G.newEngine(seed);
  const out = { label, seed, frames: 0, finished: false, score: 0, violations: [], inputs: [], probes: keepProbes ? [] : null,
    snaps: [], perf: { mean: 0, max: 0 }, maxSame: 0, progressMax: -Infinity, progressFinal: null, moved: false };
  const memo = {}, times = [], seenViol = new Set();
  let where = "init", h = 2166136261, lastFb = null, same = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let lastSig = null, lastChange = 0, dirFrames = 0; // stuck detection
  const probeOf = () => { where = "probe"; return typeof G.game.probe === "function" ? G.game.probe() : null; };

  const body = () => {
    eng.start(G.game);
    let p = probeOf();
    for (let f = 0; f < frames; f++) {
      where = "input";
      const b = normalizeButtons(input(p, f));
      out.inputs.push(b);
      const t0 = performance.now();
      where = "update/draw";
      eng.tick(G.game, b, { draw });
      times.push(performance.now() - t0);
      out.frames = f + 1;
      p = probeOf();

      const js = jsonOf(p);
      h = fnv(h, js + "|" + eng.state.score);
      if (keepProbes) out.probes.push(js + "|" + eng.state.score);
      if (p && Number.isFinite(p.progress)) out.progressMax = Math.max(out.progressMax, p.progress);
      if (p?.player && Number.isFinite(p.player.x)) {
        minX = Math.min(minX, p.player.x); maxX = Math.max(maxX, p.player.x); minY = Math.min(minY, p.player.y); maxY = Math.max(maxY, p.player.y);
        // Stuck: position, progress and state unchanged for 20 s although directions were pressed most of that time.
        const sig = `${Math.round(p.player.x)},${Math.round(p.player.y)},${p.progress},${p.state},${p.level}`;
        if (sig !== lastSig) { lastSig = sig; lastChange = f; dirFrames = 0; }
        else if (b[0] || b[1] || b[2] || b[3]) dirFrames++;
        if (!out.stuck && f - lastChange >= 600 && dirFrames >= 300) {
          out.stuck = { frame: f, since: lastChange, probe: jsonOf(p, 600), inputs: compressInputs(out.inputs) };
        }
      }
      if (draw) {
        const fh = hashFrame(eng.fb);
        same = fh === lastFb ? same + 1 : 0; lastFb = fh;
        out.maxSame = Math.max(out.maxSame, same);
        if (snapEvery && f % snapEvery === 0) out.snaps.push({ frame: f, fb: eng.fb.slice() });
      }
      if (invariants) {
        const found = harnessInvariants(p, eng, memo);
        if (typeof G.game.invariants === "function") {
          where = "invariants";
          const r = G.game.invariants(p);
          for (const m of Array.isArray(r) ? r : []) if (m) found.push({ check: "game-invariant", message: String(m) });
        }
        for (const v of found) {
          if (seenViol.has(v.check) || out.violations.length >= 6) continue; // first occurrence of each kind
          seenViol.add(v.check);
          out.violations.push({ ...v, run: label, seed, frame: f, probe: jsonOf(p, 600), inputs: compressInputs(out.inputs) });
        }
      }
      if (eng.state.finished) break;
    }
    where = "draw";
    for (let i = 0; i < afterFinish && eng.state.finished; i++) eng.tick(G.game, "", { draw: true });
    if (eng.state.finished && typeof G.game.share === "function") {
      where = "share";
      try { out.share = G.game.share(); } catch (e) { out.shareError = describeError(e).message; }
    }
    if (snapEvery) out.snaps.push({ frame: out.frames, fb: eng.fb.slice(), end: true });
    out.progressFinal = p?.progress ?? null;
    out.probe = p;
  };

  try { G.guard(body, RUN_TIMEOUT_MS); }
  catch (e) { out.error = { ...describeError(e), where, frame: out.frames, inputs: compressInputs(out.inputs) }; }

  const steady = times.slice(5);
  out.perf = { mean: steady.length ? steady.reduce((a, b) => a + b, 0) / steady.length : 0, max: steady.length ? Math.max(...steady) : 0 };
  out.finished = eng.state.finished;
  out.finishFrame = eng.state.finishFrame;
  out.score = eng.state.score;
  out.result = type ? eng.result(type) : null;
  out.hash = h.toString(16);
  out.fbHash = hashFrame(eng.fb);
  out.diag = JSON.parse(JSON.stringify(eng.diag));
  out.moved = maxX - minX > 4 || maxY - minY > 4;
  return out;
}

// Input sources.
export const idle = () => () => "";
export function randomInput(inputSeed) {
  const r = mulberry32(inputSeed);
  let held = "", left = 0;
  return () => {
    if (left-- <= 0) { held = [0, 1, 2, 3, 4, 5].map(() => r() < 0.3); left = Math.floor(r() * 20); }
    return held;
  };
}
export const designerBot = (G) => (p, f) => G.game.bot(p, f);
export const replayInputs = (inputs) => (_p, f) => inputs[f] ?? "";

// Go-Explore style search: keep an archive of "cells" (coarse states) with the shortest input log that reached each,
// pick promising cells, restore them by deterministic replay, and try random macro-actions from there.
const COMBOS = ["", "L", "R", "U", "D", "LU", "RU", "LD", "RD", "O", "X", "LO", "RO", "UO", "DO", "LX", "RX", "UX", "DX"];
export function explore(G, { seed = 1234, budgetMs = 8000, maxLen = MAX_FRAMES, rngSeed = 7, type, stopOnFinish = true } = {}) {
  const r = mulberry32(rngSeed);
  let eng = null, memo = {};
  const res = { iterations: 0, sims: 0, cells: 0, bestProgress: null, bestScore: null, finished: false, finishFrames: null, violation: null, error: null };
  const restore = (log) => {
    eng = G.newEngine(seed); memo = {};
    eng.start(G.game);
    for (const b of log) eng.tick(G.game, b, { draw: false });
  };
  const probe = () => (typeof G.game.probe === "function" ? G.game.probe() : null);
  const coarse = () => { // 8x8 grid of the screen's dominant colours: novelty for games with no avatar
    let s = "";
    for (let gy = 0; gy < 8; gy++) for (let gx = 0; gx < 8; gx++) {
      const counts = new Uint16Array(16);
      for (let y = 0; y < 16; y += 4) for (let x = 0; x < 16; x += 4) counts[eng.fb[(gy * 16 + y) * W + gx * 16 + x]]++;
      s += counts.indexOf(Math.max(...counts)).toString(16);
    }
    return s;
  };
  const cellOf = (p) => {
    const prog = p && Number.isFinite(p.progress) ? Math.round(p.progress * 4) / 4 : eng.state.score;
    if (p?.player && Number.isFinite(p.player.x)) return `${p.state}|${p.level}|${prog}|${Math.floor(p.player.x / 8)}|${Math.floor(p.player.y / 8)}`;
    return `${p?.state}|${p?.level}|${prog}|${coarse()}`;
  };
  const value = (p) => (p && Number.isFinite(p.progress) ? p.progress : eng.state.score);

  const archive = new Map();
  const t0 = performance.now();
  try {
    G.guard(() => {
      restore([]);
      if (!probe()?.player) eng.tick(G.game, "", { draw: true }); // fill the framebuffer once for coarse cells
      const p0 = probe();
      archive.set(cellOf(p0), { log: [], visits: 0, value: value(p0) });
    }, 5000);
    while (performance.now() - t0 < budgetMs && !(stopOnFinish && res.finished)) {
      res.iterations++;
      const cells = [...archive.values()];
      const top = Math.max(...cells.map((c) => c.value));
      const pool = cells.filter((c) => c.value >= top - Math.max(1, Math.abs(top) * 0.1) || r() < 0.1);
      let pick = pool[0], bw = -1;
      for (const c of pool) { const w = r() / Math.sqrt(c.visits + 1); if (w > bw) { bw = w; pick = c; } }
      pick.visits++;
      G.guard(() => {
        restore(pick.log);
        const log = pick.log.slice();
        for (let m = 0; m < 4 && log.length < maxLen; m++) {
          const combo = COMBOS[Math.floor(r() * COMBOS.length)];
          const tap = r() < 0.3, n = tap ? 2 * (1 + Math.floor(r() * 4)) : 2 + Math.floor(r() * 11);
          for (let i = 0; i < n && log.length < maxLen; i++) {
            const b = normalizeButtons(tap && i % 2 ? "" : combo);
            eng.tick(G.game, b, { draw: i === n - 1 });
            log.push(b); res.sims++;
            const p = probe();
            if (!res.violation) {
              const v = harnessInvariants(p, eng, memo);
              if (typeof G.game.invariants === "function") for (const msg of G.game.invariants(p) || []) v.push({ check: "game-invariant", message: String(msg) });
              if (v.length) res.violation = { ...v[0], run: "search", seed, frame: log.length - 1, probe: jsonOf(p, 600), inputs: compressInputs(log) };
            }
            if (eng.state.finished) {
              if (!res.finished || log.length < res.finishFrames) { res.finished = true; res.finishFrames = log.length; }
              if (type !== "speedrun") res.bestScore = Math.max(res.bestScore ?? -Infinity, eng.state.score);
              return;
            }
            if (i === n - 1) {
              const k = cellOf(p), ex = archive.get(k), val = value(p);
              res.bestProgress = Math.max(res.bestProgress ?? -Infinity, val);
              res.bestScore = Math.max(res.bestScore ?? -Infinity, eng.state.score);
              if (!ex || ex.log.length > log.length) archive.set(k, { log: log.slice(), visits: ex ? ex.visits : 0, value: val });
            }
          }
        }
      }, 5000);
    }
  } catch (e) { res.error = describeError(e); }
  res.cells = archive.size;
  res.ms = Math.round(performance.now() - t0);
  return res;
}
