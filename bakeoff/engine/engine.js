// Minimal deterministic fantasy console. Runs the same in the browser and in Node.
// Everything draws into a 128x128 framebuffer of palette indices; the browser blits it,
// Node just hashes it. No wall-clock time: one tick = one frame at a fixed 30 fps.
// This file must stay self-contained (no imports): play.html inlines it into a sandboxed iframe.

export const W = 128, H = 128, FPS = 30;
export const PALETTE = ["#000000", "#1D2B53", "#7E2553", "#008751", "#AB5236", "#5F574F", "#C2C3C7", "#FFF1E8",
  "#FF004D", "#FFA300", "#FFEC27", "#00E436", "#29ADFF", "#83769C", "#FF77A8", "#FFCCAA"];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 3x5 font, rows top to bottom, "1" = lit pixel.
const FONT = {
  A: "111101111101101", B: "110101110101110", C: "111100100100111", D: "110101101101110", E: "111100110100111",
  F: "111100110100100", G: "111100101101111", H: "101101111101101", I: "111010010010111", J: "111010010010110",
  K: "101101110101101", L: "100100100100111", M: "111111101101101", N: "110101101101101", O: "011101101101110",
  P: "111101111100100", Q: "010101101110011", R: "111101110101101", S: "011100111001110", T: "111010010010010",
  U: "101101101101011", V: "101101101111010", W: "101101101111111", X: "101101010101101", Y: "101101111001111",
  Z: "111001010100111", 0: "111101101101111", 1: "110010010010111", 2: "111001111100111", 3: "111001011001111",
  4: "101101111001001", 5: "111100111001111", 6: "100100111101111", 7: "111001001001001", 8: "111101111101111",
  9: "111101111001001", ":": "000010000010000", ".": "000000000000010", "!": "010010010000010", "-": "000000111000000",
  "/": "001001010100100", "?": "111001011000010", "+": "000010111010000", "%": "101001010100101", ",": "000000000010100",
  "=": "000111000111000", "(": "001010010010001", ")": "100010010010100", "<": "001010100010001", ">": "100010001010100",
  "'": "010010000000000",
};

// Deterministic trig. Math.sin/cos/atan2 may differ between JS engines (browser vs server replay);
// these use only + - * / and Math.round/sqrt, which IEEE 754 makes identical everywhere.
const PI = 3.141592653589793, HALF_PI = PI / 2, TAU = 2 * PI;
const SIN_C = [1, -1 / 6, 1 / 120, -1 / 5040, 1 / 362880, -1 / 39916800, 1 / 6227020800, -1 / 1307674368000];
function dsin(x) {
  if (!Number.isFinite(x)) return NaN;
  x -= TAU * Math.round(x / TAU);
  if (x > HALF_PI) x = PI - x; else if (x < -HALF_PI) x = -PI - x;
  const x2 = x * x;
  let s = SIN_C[7];
  for (let i = 6; i >= 0; i--) s = s * x2 + SIN_C[i];
  return s * x;
}
function datan(z) { // |z| <= 1; halve the angle twice, then a short series
  for (let i = 0; i < 2; i++) z = z / (1 + Math.sqrt(1 + z * z));
  const z2 = z * z;
  let s = 0;
  for (let k = 10; k >= 0; k--) s = s * z2 + (k % 2 ? -1 : 1) / (2 * k + 1);
  return 4 * s * z;
}
function datan2(y, x) {
  if (x === 0 && y === 0) return 0;
  const ax = Math.abs(x), ay = Math.abs(y);
  let a = ay <= ax ? datan(ay / ax) : HALF_PI - datan(ax / ay);
  if (x < 0) a = PI - a;
  return y < 0 ? -a : a;
}

// Buttons can be given as 6 booleans or as a string of letters: L R U D O X (e.g. "RO").
const LETTERS = "LRUDOX";
export function normalizeButtons(b) {
  if (typeof b === "string") { const u = b.toUpperCase(); return [...LETTERS].map((ch) => u.includes(ch)); }
  if (Array.isArray(b)) return [0, 1, 2, 3, 4, 5].map((i) => !!b[i]);
  return [false, false, false, false, false, false];
}
export const buttonsToString = (b) => [...LETTERS].filter((_, i) => b[i]).join("") || ".";

// opts.words = { common: "space separated words", all: "space separated words" } (see words.js).
export function createEngine(seed, opts = {}) {
  const fb = new Uint8Array(W * H);
  const state = { frame: 0, score: 0, finished: false, finishFrame: null, phase: "init" };
  const cam = { x: 0, y: 0 };
  let rand = mulberry32(seed), drawRand = rand;
  let cur = [false, false, false, false, false, false], prev = cur;
  let map = null;

  // Diagnostics the harness reads: counts plus the first occurrence of each problem.
  const diag = {};
  const note = (kind, detail) => {
    const d = diag[kind] ?? (diag[kind] = { count: 0, first: null });
    if (d.count++ === 0) d.first = { frame: state.frame, phase: state.phase, ...detail };
  };
  const finite = (fn, args) => {
    for (const a of args) if (typeof a === "number" && !Number.isFinite(a)) { note("nanArg", { fn, args: args.map(String) }); return false; }
    return true;
  };
  const colour = (fn, c) => {
    if (!Number.isInteger(c) || c < 0 || c > 15) { note("badColour", { fn, c: String(c) }); return Number.isFinite(c) ? Math.floor(c) & 15 : 0; }
    return c;
  };

  const raw = (x, y, c) => {
    x = Math.floor(x - cam.x); y = Math.floor(y - cam.y);
    if (x >= 0 && y >= 0 && x < W && y < H) fb[y * W + x] = c;
  };
  const pset = (x, y, c) => { if (finite("pset", [x, y])) raw(x, y, colour("pset", c)); };
  const rectfill = (x, y, w, h, c) => {
    if (!finite("rectfill", [x, y, w, h])) return;
    c = colour("rectfill", c);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) raw(x + i, y + j, c);
  };
  const line = (x0, y0, x1, y1, c) => {
    if (!finite("line", [x0, y0, x1, y1])) return;
    c = colour("line", c);
    x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.floor(x1); y1 = Math.floor(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let n = 0; n < 512; n++) {
      raw(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  };
  const circle = (fn, cx, cy, r, c, fill) => {
    if (!finite(fn, [cx, cy, r])) return;
    c = colour(fn, c);
    r = Math.floor(r);
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      const d = x * x + y * y;
      if (fill ? d <= r * r + r : d <= r * r + r && d >= r * r - r) raw(cx + x, cy + y, c);
    }
  };
  const textw = (text) => Math.max(0, String(text).length * 4 - 1);
  const print = (text, x = 0, y = 0, c = 7) => {
    if (!finite("print", [x, y])) return;
    c = colour("print", c);
    const s = String(text).toUpperCase();
    const sx = Math.floor(x - cam.x), sy = Math.floor(y - cam.y);
    if (s.trim() && (sx < 0 || sy < 0 || sx + textw(s) > W || sy + 5 > H)) note("printClipped", { text: s.slice(0, 40), x, y });
    [...s].forEach((ch, k) => {
      const g = FONT[ch];
      if (!g) { if (ch !== " ") note("unknownChar", { ch }); return; }
      for (let i = 0; i < 15; i++) if (g[i] === "1") raw(x + k * 4 + (i % 3), y + Math.floor(i / 3), c);
    });
  };
  // Sprite from strings: one string per row, one hex digit (0-f) per pixel, "." or " " = transparent.
  const spr = (rows, x, y, o = {}) => {
    if (!Array.isArray(rows) || !finite("spr", [x, y])) return;
    const s = Math.max(1, Math.floor(o.scale ?? 1)), wmax = Math.max(...rows.map((r) => r.length));
    rows.forEach((row, j) => [...row].forEach((ch, i) => {
      const c = parseInt(ch, 16);
      if (Number.isNaN(c)) return;
      const px = o.flip ? wmax - 1 - i : i;
      for (let a = 0; a < s; a++) for (let b = 0; b < s; b++) raw(x + px * s + b, y + (o.flipy ? rows.length - 1 - j : j) * s + a, c);
    }));
  };

  // Tile map: an array of strings, one character per tile. Outside the map counts as solid.
  const mload = (rows, o = {}) => {
    map = { rows: rows.map((r) => [...r]), w: Math.max(...rows.map((r) => r.length)), h: rows.length,
      ts: o.tile ?? 8, solid: new Set(o.solid ?? "#"), hazard: new Set(o.hazard ?? "") };
    return { w: map.w, h: map.h };
  };
  const mget = (tx, ty) => (map && map.rows[ty] && map.rows[ty][tx] !== undefined ? map.rows[ty][tx] : null);
  const mset = (tx, ty, ch) => { if (map && map.rows[ty] && tx >= 0 && tx < map.w) map.rows[ty][tx] = String(ch)[0]; };
  const msolid = (tx, ty) => { const ch = mget(tx, ty); return ch === null ? !!map : map.solid.has(ch); };
  const mhazard = (tx, ty) => { const ch = mget(tx, ty); return ch !== null && map.hazard.has(ch); };
  const mfind = (ch) => {
    const out = [];
    if (map) map.rows.forEach((row, ty) => row.forEach((c, tx) => { if (c === ch) out.push({ x: tx, y: ty }); }));
    return out;
  };
  const mdraw = (fn) => {
    if (map) map.rows.forEach((row, ty) => row.forEach((ch, tx) => fn(ch, tx * map.ts, ty * map.ts, tx, ty)));
  };
  const solidat = (px, py) => !!map && msolid(Math.floor(px / map.ts), Math.floor(py / map.ts));
  const boxhit = (x, y, w, h) => {
    if (!map) return false;
    const t = map.ts, x0 = Math.floor(x / t), y0 = Math.floor(y / t), x1 = Math.floor((x + w - 0.001) / t), y1 = Math.floor((y + h - 0.001) / t);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (msolid(tx, ty)) return true;
    return false;
  };
  // Move box o = {x, y, w, h} by (dx, dy), one axis at a time in steps of at most 1px, stopping at solid tiles.
  const move = (o, dx, dy) => {
    const hit = { x: false, y: false };
    if (!finite("move", [o.x, o.y, dx, dy])) return hit;
    for (const ax of ["x", "y"]) {
      let d = ax === "x" ? dx : dy;
      while (d !== 0) {
        const step = Math.abs(d) > 1 ? Math.sign(d) : d;
        o[ax] += step;
        if (boxhit(o.x, o.y, o.w, o.h)) { o[ax] -= step; hit[ax] = true; break; }
        d -= step;
      }
    }
    return hit;
  };
  // Shortest 4-way path between tiles, avoiding solid and hazard tiles. Returns [{x, y}, ...] (excluding start) or null.
  const mpath = (tx0, ty0, tx1, ty1) => {
    if (!map) return null;
    const key = (x, y) => y * map.w + x, from = new Map([[key(tx0, ty0), -1]]), q = [[tx0, ty0]];
    for (let qi = 0; qi < q.length; qi++) {
      const [x, y] = q[qi];
      if (x === tx1 && y === ty1) {
        const path = [];
        for (let k = key(x, y); k !== key(tx0, ty0); k = from.get(k)) path.unshift({ x: k % map.w, y: Math.floor(k / map.w) });
        return path;
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = key(nx, ny);
        if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h || from.has(k) || msolid(nx, ny) || mhazard(nx, ny)) continue;
        from.set(k, key(x, y)); q.push([nx, ny]);
      }
    }
    return null;
  };

  // Word lists, parsed on first use.
  let common = null, all = null;
  const words = () => {
    if (!common) {
      common = new Map();
      for (const w of (opts.words?.common ?? "").split(/\s+/).filter(Boolean)) {
        if (!common.has(w.length)) common.set(w.length, []);
        common.get(w.length).push(w.toUpperCase());
      }
      all = new Set([...(opts.words?.all ?? "").split(/\s+/), ...(opts.words?.common ?? "").split(/\s+/)].filter(Boolean).map((w) => w.toUpperCase()));
    }
  };
  const rnd = (n = 1) => (state.phase === "draw" ? drawRand : rand)() * n;

  const api = {
    cls: (c = 0) => fb.fill(colour("cls", c)),
    pset, rectfill, line, print, spr, textw,
    rect: (x, y, w, h, c) => {
      line(x, y, x + w - 1, y, c); line(x, y + h - 1, x + w - 1, y + h - 1, c);
      line(x, y, x, y + h - 1, c); line(x + w - 1, y, x + w - 1, y + h - 1, c);
    },
    circ: (x, y, r, c) => circle("circ", x, y, r, c, false),
    circfill: (x, y, r, c) => circle("circfill", x, y, r, c, true),
    printc: (text, y, c = 7) => print(text, Math.floor((W - textw(text)) / 2) + cam.x, y, c),
    camera: (x = 0, y = 0) => { cam.x = Math.floor(x); cam.y = Math.floor(y); },
    btn: (i) => { if (!(i >= 0 && i < 6)) note("badButton", { i: String(i) }); return !!cur[i]; },
    btnp: (i) => !!cur[i] && !prev[i],
    rnd,
    rndi: (n) => Math.floor(rnd(n)),
    chance: (p) => rnd() < p,
    pick: (arr) => arr[Math.floor(rnd(arr.length))],
    shuffle: (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd(i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; },
    frame: () => state.frame,
    score: (n) => {
      if (!Number.isFinite(Number(n))) note("badScore", { n: String(n) });
      if (!state.finished) state.score = Number(n) || 0;
    },
    finish: () => { if (!state.finished) { state.finished = true; state.finishFrame = state.frame; } },
    flr: Math.floor, ceil: Math.ceil, abs: Math.abs, sqrt: Math.sqrt, min: Math.min, max: Math.max,
    sgn: (v) => (v < 0 ? -1 : 1),
    mid: (a, b, c) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c)),
    clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
    lerp: (a, b, t) => a + (b - a) * t,
    sin: dsin, cos: (x) => dsin(x + HALF_PI), atan2: datan2,
    dist: (x0, y0, x1, y1) => Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0)),
    overlap: (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h,
    mload, mget, mset, msolid, mhazard, mfind, mdraw, mpath, solidat, boxhit, move,
    isword: (w) => { words(); return all.has(String(w).toUpperCase()); },
    wordlist: (len) => { words(); return (common.get(len) ?? []).slice(); },
    rndword: (len) => { words(); const l = common.get(len) ?? []; return l.length ? l[Math.floor(rnd(l.length))] : ""; },
  };

  // Advance one frame: run update with this frame's buttons, then draw (skippable for fast headless search).
  function tick(game, buttons, o = {}) {
    prev = cur; cur = normalizeButtons(buttons);
    state.phase = "update";
    if (!state.finished) game.update(cur);
    if (o.draw !== false) {
      state.phase = "draw";
      // draw() gets its own random stream so drawing (or skipping it) never changes the game logic.
      drawRand = mulberry32((seed ^ Math.imul(state.frame + 1, 0x9E3779B1)) >>> 0);
      game.draw();
    }
    state.phase = "idle";
    state.frame++;
  }

  function start(game) {
    rand = mulberry32(seed);
    cam.x = cam.y = 0; map = null;
    prev = cur = [false, false, false, false, false, false];
    state.phase = "init";
    game.init(seed);
    state.phase = "idle";
  }

  // Result used for leaderboards: speedrun = seconds to finish (lower is better), else score.
  const result = (type) => type === "speedrun"
    ? (state.finished ? state.finishFrame / FPS : null)
    : state.score;

  return { api, fb, state, diag, cam, getMap: () => map, start, tick, result };
}

export function hashFrame(fb) {
  let h = 2166136261;
  for (let i = 0; i < fb.length; i++) h = Math.imul(h ^ fb[i], 16777619);
  return (h >>> 0).toString(16);
}
