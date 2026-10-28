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

// sharegrid() letters -> coloured squares for a shareable result (G green, Y yellow, R red, B blue, O orange,
// P purple, W white, N brown; anything else black).
const SHARE = { G: "\u{1F7E9}", Y: "\u{1F7E8}", R: "\u{1F7E5}", B: "\u{1F7E6}", O: "\u{1F7E7}", P: "\u{1F7EA}", W: "⬜", N: "\u{1F7EB}" };

// The seed for a day ("2026-10-28"), so every player gets the same game that day. Used by the site, not by games.
export function dailySeed(date) {
  let h = 2166136261;
  for (const ch of String(date)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
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
// opts.categories = { NAME: ["WORD", ...] } (see categories.js); opts.bigCategories the same (categories-big.js). opts.blocked(word): harness-only offensive-word check.
export function createEngine(seed, opts = {}) {
  const fb = new Uint8Array(W * H);
  const state = { frame: 0, score: 0, finished: false, finishFrame: null, phase: "init" };
  const cam = { x: 0, y: 0 };
  let rand = mulberry32(seed), drawRand = rand;
  let cur = [false, false, false, false, false, false], prev = cur;
  let map = null;
  const checked = new Set();

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
    if (opts.blocked && !checked.has(s)) { // harness only: flag offensive words on screen
      if (checked.size < 5000) checked.add(s);
      for (const t of s.split(/[^A-Z]+/)) if (t && opts.blocked(t)) note("blockedWord", { word: t[0] + "*".repeat(t.length - 1) });
    }
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

  // Puzzle search. p = { start, moves(s), apply(s, m), goal(s), key?(s) }; apply() returns a NEW state, or null when
  // the move breaks a rule (that prunes the search). o.shortest: breadth-first, stops at the shortest solution.
  // Otherwise depth-first, counting distinct solutions up to o.max (2 is enough to tell "unique" from "not unique").
  // complete = the answer is certain (whole space searched, or max solutions found); false = o.limit states ran out first.
  const solve = (p, o = {}) => {
    if (!p || typeof p.moves !== "function" || typeof p.apply !== "function" || typeof p.goal !== "function") {
      throw new Error("solve(p): p needs start, moves(s), apply(s, m) and goal(s)");
    }
    const max = o.max ?? 2, limit = o.limit ?? 50000, key = typeof p.key === "function" ? p.key : (s) => JSON.stringify(s);
    const res = { count: 0, solutions: [], path: null, steps: null, explored: 0, complete: false };
    const seen = new Set([key(p.start)]), list = [{ s: p.start, parent: null, m: null }];
    let head = 0;
    while (head < list.length) {
      if (res.explored >= limit) return res;
      const node = o.shortest ? list[head++] : list.pop();
      res.explored++;
      if (p.goal(node.s)) {
        res.count++;
        res.solutions.push(node.s);
        if (!res.path) {
          res.path = [];
          for (let n = node; n.parent; n = n.parent) res.path.unshift(n.m);
          res.steps = res.path.length;
        }
        if (o.shortest || res.count >= max) { res.complete = true; return res; }
        continue;
      }
      const kids = [];
      for (const m of p.moves(node.s) ?? []) {
        const t = p.apply(node.s, m);
        if (t === null || t === undefined) continue;
        const k = key(t);
        if (seen.has(k)) continue;
        seen.add(k);
        kids.push({ s: t, parent: node, m });
      }
      if (o.shortest) list.push(...kids); else for (let i = kids.length - 1; i >= 0; i--) list.push(kids[i]); // first move tried first
    }
    res.complete = true;
    return res;
  };
  // Generate-and-test: calls make(i) until accept(puzzle) is true, at most `tries` times. Returns the puzzle, or null.
  const makepuzzle = (make, accept, tries = 100) => {
    for (let i = 0; i < tries; i++) { const pz = make(i); if (accept(pz)) return pz; }
    note("makepuzzleFailed", { tries });
    return null;
  };

  // On-screen keyboard for typing with six buttons: arrows move the cursor, O presses the key under it, X = delete.
  // Create it in init() (kb = keyboard()), call kb.update() in update() and kb.draw(x, y) in draw().
  const keyboard = (o = {}) => {
    const keys = [...String(o.keys ?? "ABCDEFGHIJKLMNOPQRSTUVWXYZ").toUpperCase()];
    if (o.del !== false) keys.push("DEL");
    if (o.enter !== false) keys.push("ENTER");
    const cols = Math.max(1, Math.min(12, o.cols ?? 10)), rows = Math.ceil(keys.length / cols), CW = 10, CH = 9;
    const rowLen = (r) => Math.min(cols, keys.length - r * cols);
    const step = (i, b) => {
      let r = Math.floor(i / cols), c = i % cols;
      if (b === 0) c = (c - 1 + rowLen(r)) % rowLen(r);
      else if (b === 1) c = (c + 1) % rowLen(r);
      else { r = (r + (b === 2 ? rows - 1 : 1)) % rows; c = Math.min(c, rowLen(r) - 1); }
      return r * cols + c;
    };
    const label = (k) => (k === "DEL" ? "<-" : k === "ENTER" ? "OK" : k);
    const kb = {
      keys, cursor: 0, w: cols * CW - 1, h: rows * CH - 1,
      key: () => keys[kb.cursor],
      // Returns the key pressed this frame ("A", "DEL", "ENTER") or null.
      update() {
        for (const b of [0, 1, 2, 3]) if (cur[b] && !prev[b]) kb.cursor = step(kb.cursor, b);
        if (cur[4] && !prev[4]) return keys[kb.cursor];
        if (cur[5] && !prev[5] && o.del !== false) return "DEL";
        return null;
      },
      // o2.colour(key) -> text colour for that key (e.g. grey out used letters); o2.bg = key background colour.
      draw(x, y, o2 = {}) {
        keys.forEach((k, i) => {
          const kx = x + (i % cols) * CW, ky = y + Math.floor(i / cols) * CH, on = i === kb.cursor;
          rectfill(kx, ky, CW - 1, CH - 1, on ? 10 : (o2.bg ?? 5));
          print(label(k), kx + Math.floor((CW - 1 - textw(label(k))) / 2), ky + 2, on ? 0 : (o2.colour?.(k) ?? 7));
        });
      },
      // For bot(): the buttons for this frame that move toward `target` and press it. Every other frame is "",
      // because a key press only counts when the button was released the frame before.
      press(target) {
        const t = keys.indexOf(String(target).toUpperCase());
        if (t < 0 || cur.some(Boolean)) return "";
        if (t === kb.cursor) return "O";
        const from = new Map([[kb.cursor, null]]), q = [kb.cursor];
        for (let qi = 0; qi < q.length && !from.has(t); qi++) {
          for (const b of [0, 1, 2, 3]) { const n = step(q[qi], b); if (!from.has(n)) { from.set(n, [q[qi], b]); q.push(n); } }
        }
        let n = t;
        while (from.get(n)[0] !== kb.cursor) n = from.get(n)[0];
        return "LRUD"[from.get(n)[1]];
      },
      // For bot(): type `word` given what is typed so far; deletes wrong letters, presses ENTER when done.
      type(word, typed) {
        const w = String(word).toUpperCase(), sofar = String(typed).toUpperCase();
        if (!w.startsWith(sofar)) return cur.some(Boolean) ? "" : "X";
        return kb.press(sofar === w ? "ENTER" : w[sofar.length]);
      },
    };
    return kb;
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

  // Word tools over the common words. Slow-ish (they scan the list): call them in init() or on a key press, not every frame.
  let byKey = null, freq = null;
  const commonWords = () => { words(); return [...common.values()].flat(); };
  const sortKey = (w) => [...String(w).toUpperCase()].sort().join("");
  const letterCounts = (s) => { const n = {}; for (const ch of String(s).toUpperCase()) n[ch] = (n[ch] ?? 0) + 1; return n; };
  const fits = (w, pool) => { const need = letterCounts(w); return Object.keys(need).every((ch) => (pool[ch] ?? 0) >= need[ch]); };
  const anagrams = (letters) => {
    if (!byKey) { byKey = new Map(); for (const w of commonWords()) { const k = sortKey(w); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(w); } }
    return (byKey.get(sortKey(letters)) ?? []).slice();
  };
  const wordsfrom = (letters, min = 3) => { const pool = letterCounts(letters); return commonWords().filter((w) => w.length >= min && fits(w, pool)); };
  const matchword = (pattern) => {
    const p = String(pattern).toUpperCase();
    words();
    return (common.get(p.length) ?? []).filter((w) => [...p].every((ch, i) => ch === "?" || ch === w[i]));
  };
  const neighbors = (word) => {
    const w = String(word).toUpperCase();
    words();
    return (common.get(w.length) ?? []).filter((x) => { let d = 0; for (let i = 0; i < w.length; i++) if (x[i] !== w[i]) d++; return d === 1; });
  };
  const letterStats = () => {
    if (!freq) {
      const n = {}, all = commonWords().join("");
      for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") n[ch] = 0;
      for (const ch of all) n[ch]++;
      const ranked = Object.keys(n).sort((a, b) => n[b] - n[a] || (a < b ? -1 : 1));
      freq = { share: Object.fromEntries(Object.keys(n).map((ch) => [ch, n[ch] / all.length])), score: Object.fromEntries(ranked.map((ch, i) => [ch, 1 + Math.floor((i * 10) / 26)])) };
    }
    return freq;
  };

  // Categories (see categories.js): hand-checked themed word lists.
  // Default: the hand-checked lists. o.big: the bigger generated lists (more words, less certain).
  const catsOf = (o) => (o?.big ? opts.bigCategories ?? {} : opts.categories ?? {});
  const categoryof = (word, o) => { const w = String(word).toUpperCase(), c = catsOf(o); return Object.keys(c).filter((k) => c[k].includes(w)); };

  // Playing cards: { rank: 1-13 (1 = ace, 11-13 = J Q K), suit: 0-3 (spades, hearts, diamonds, clubs) }.
  const RANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"], SUITS = "SHDC";
  const SUIT_SPR = [
    ["..0..", ".000.", "00000", "..0..", ".000."], [".8.8.", "88888", "88888", ".888.", "..8.."],
    ["..8..", ".888.", "88888", ".888.", "..8.."], [".000.", ".000.", "00000", "..0..", ".000."]];
  const deck = (n = 1) => { const d = []; for (let k = 0; k < n; k++) for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) d.push({ rank: r, suit: s }); return d; };
  const deal = (pile, n = 1) => pile.splice(Math.max(0, pile.length - n), n).reverse(); // from the top (end) of the pile
  const cardname = (c) => (c && RANKS[c.rank] && SUITS[c.suit] ? RANKS[c.rank] + SUITS[c.suit] : "??");
  // A 12x16 card at (x, y). o.back: face down; o.sel: highlighted.
  const drawcard = (c, x, y, o = {}) => {
    rectfill(x, y, 12, 16, o.back ? 1 : 7);
    api.rect(x, y, 12, 16, o.sel ? 10 : 6);
    if (o.back) { for (let j = 2; j < 14; j += 3) line(x + 2, y + j, x + 9, y + j, 12); return; }
    if (!c || !SUIT_SPR[c.suit]) return;
    print(RANKS[c.rank], x + 2, y + 2, c.suit === 1 || c.suit === 2 ? 8 : 0);
    spr(SUIT_SPR[c.suit], x + 4, y + 9);
  };
  // Best total at most 21 counting aces as 1 or 11 and J Q K as 10 (or the smallest total if all go over).
  const cardtotal = (cards) => {
    let t = 0, aces = 0;
    for (const c of cards) { t += Math.min(10, c.rank); if (c.rank === 1) aces++; }
    while (aces-- > 0 && t + 10 <= 21) t += 10;
    return t;
  };
  // Best poker hand among 5-7 cards: { name, rank (0 high card .. 8 straight flush), score (higher wins), cards }.
  const HANDS = ["HIGH CARD", "PAIR", "TWO PAIR", "THREE OF A KIND", "STRAIGHT", "FLUSH", "FULL HOUSE", "FOUR OF A KIND", "STRAIGHT FLUSH"];
  const five = (cs) => {
    const v = cs.map((c) => (c.rank === 1 ? 14 : c.rank)).sort((a, b) => b - a);
    const flush = cs.every((c) => c.suit === cs[0].suit);
    let straight = v.every((x, i) => !i || v[i - 1] - x === 1) ? v[0] : 0;
    if (!straight && v.join() === "14,5,4,3,2") straight = 5;
    const groups = Object.entries(v.reduce((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {})).map(([r, n]) => [n, +r]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    const shape = groups.map((g) => g[0]).join("");
    const rank = straight && flush ? 8 : shape === "41" ? 7 : shape === "32" ? 6 : flush ? 5 : straight ? 4 : shape === "311" ? 3 : shape === "221" ? 2 : shape === "2111" ? 1 : 0;
    const order = straight ? [straight] : groups.map((g) => g[1]);
    let score = order.reduce((s, x) => s * 15 + x, rank);
    for (let k = order.length; k < 5; k++) score *= 15;
    return { rank, score };
  };
  const pokerhand = (cards) => {
    if (!Array.isArray(cards) || cards.length < 5) return { name: "", rank: -1, score: -1, cards: [] };
    let best = null;
    const pick = (start, chosen) => {
      if (chosen.length === 5) { const h = five(chosen); if (!best || h.score > best.score) best = { ...h, cards: chosen.slice() }; return; }
      for (let i = start; i <= cards.length - (5 - chosen.length); i++) { chosen.push(cards[i]); pick(i + 1, chosen); chosen.pop(); }
    };
    pick(0, []);
    return { name: HANDS[best.rank], ...best };
  };

  // Level generation. Levels are arrays of strings, the same format as mload(); generators use the seeded rnd().
  const grid = (w, h, ch) => Array.from({ length: h }, () => Array(w).fill(ch));
  const rowsOf = (g) => g.map((r) => r.join(""));
  // Perfect maze (one route between any two cells), carved on odd coordinates. o.loops: chance to knock out extra walls.
  const genmaze = (w, h, o = {}) => {
    const wall = o.wall ?? "#", floor = o.floor ?? ".", g = grid(w, h, wall), stack = [[1, 1]];
    g[1][1] = floor;
    while (stack.length) {
      const [x, y] = stack[stack.length - 1];
      const opts2 = [[2, 0], [-2, 0], [0, 2], [0, -2]].filter(([dx, dy]) => x + dx > 0 && y + dy > 0 && x + dx < w - 1 && y + dy < h - 1 && g[y + dy][x + dx] === wall);
      if (!opts2.length) { stack.pop(); continue; }
      const [dx, dy] = opts2[Math.floor(rnd(opts2.length))];
      g[y + dy / 2][x + dx / 2] = floor; g[y + dy][x + dx] = floor;
      stack.push([x + dx, y + dy]);
    }
    if (o.loops) for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      if (g[y][x] === wall && rnd() < o.loops && ((g[y][x - 1] === floor && g[y][x + 1] === floor) || (g[y - 1][x] === floor && g[y + 1][x] === floor))) g[y][x] = floor;
    }
    return rowsOf(g);
  };
  // Cave by cellular automaton; only the biggest connected open area is kept, so all floor is connected.
  const gencave = (w, h, o = {}) => {
    const wall = o.wall ?? "#", floor = o.floor ?? ".";
    let g = grid(w, h, wall);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) g[y][x] = rnd() < (o.fill ?? 0.45) ? wall : floor;
    for (let s = 0; s < (o.steps ?? 4); s++) {
      g = g.map((row, y) => row.map((ch, x) => {
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return wall;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && g[y + dy][x + dx] === wall) n++;
        return n >= 5 ? wall : n <= 3 ? floor : ch;
      }));
    }
    let best = null;
    const seen = new Set();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (g[y][x] !== floor || seen.has(y * w + x)) continue;
      const area = [[x, y]];
      seen.add(y * w + x);
      for (let i = 0; i < area.length; i++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = area[i][0] + dx, ny = area[i][1] + dy;
        if (g[ny]?.[nx] === floor && !seen.has(ny * w + nx)) { seen.add(ny * w + nx); area.push([nx, ny]); }
      }
      if (!best || area.length > best.length) best = area;
    }
    const keep = new Set((best ?? []).map(([x, y]) => y * w + x));
    return rowsOf(g.map((row, y) => row.map((ch, x) => (ch === floor && !keep.has(y * w + x) ? wall : ch))));
  };
  // Rectangular rooms joined by L-shaped corridors, each room to the previous one, so everything is connected.
  const genrooms = (w, h, o = {}) => {
    const wall = o.wall ?? "#", floor = o.floor ?? ".", g = grid(w, h, wall), rooms = [];
    const mn = o.min ?? 3, mx = o.max ?? 6;
    for (let t = 0; t < 60 * (o.rooms ?? 6) && rooms.length < (o.rooms ?? 6); t++) {
      const rw = mn + Math.floor(rnd(mx - mn + 1)), rh = mn + Math.floor(rnd(mx - mn + 1));
      const x = 1 + Math.floor(rnd(Math.max(1, w - rw - 1))), y = 1 + Math.floor(rnd(Math.max(1, h - rh - 1)));
      if (x + rw > w - 1 || y + rh > h - 1 || rooms.some((r) => x <= r.x + r.w && r.x <= x + rw && y <= r.y + r.h && r.y <= y + rh)) continue;
      rooms.push({ x, y, w: rw, h: rh });
    }
    rooms.forEach((r, i) => {
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) g[y][x] = floor;
      if (!i) return;
      const a = rooms[i - 1], ax = a.x + Math.floor(a.w / 2), ay = a.y + Math.floor(a.h / 2), bx = r.x + Math.floor(r.w / 2), by = r.y + Math.floor(r.h / 2);
      const hFirst = rnd() < 0.5, cy = hFirst ? ay : by, cx = hFirst ? bx : ax;
      for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) g[cy][x] = floor;
      for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) g[y][cx] = floor;
    });
    return rowsOf(g);
  };

  // Shortest step counts from every `from` tile. mode "walk": 4-way through non-solid, non-hazard tiles.
  // mode "platform": gravity; from standing you can rise up to jump[0] tiles and move jump[1] tiles sideways while in the air.
  const levelDist = (rows, fromChars, o = {}) => {
    const h = rows.length, w = Math.max(...rows.map((r) => r.length)), solid = o.solid ?? "#", hazard = o.hazard ?? "";
    const open = (x, y) => x >= 0 && y >= 0 && x < w && y < h && rows[y][x] !== undefined && !solid.includes(rows[y][x]) && !hazard.includes(rows[y][x]);
    const dist = new Map(), q = [];
    const [J, S] = o.jump ?? [3, 4], plat = o.mode === "platform";
    const standing = (x, y) => !open(x, y + 1) && (y + 1 >= h || solid.includes(rows[y + 1][x] ?? solid[0]));
    const push = (x, y, j, s, d) => {
      if (!open(x, y)) return;
      if (plat && standing(x, y)) { j = J; s = S; }
      const k = plat ? `${x},${y},${j},${s}` : `${x},${y}`;
      if (dist.has(k)) return;
      dist.set(k, d); q.push([x, y, j, s, d]);
    };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (fromChars.includes(rows[y][x])) push(x, y, 0, 0, 0);
    for (let i = 0; i < q.length; i++) {
      const [x, y, j, s, d] = q[i];
      if (!plat) { for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) push(x + dx, y + dy, 0, 0, d + 1); continue; }
      const air = !standing(x, y);
      if (j > 0) push(x, y - 1, j - 1, s, d + 1);  // rise
      push(x, y + 1, 0, s, d + 1);                  // fall (can't rise again until landing)
      // Walk, or steer in the air (limited). Walking off a ledge means falling, not jumping.
      for (const dx of [-1, 1]) if (!air) push(x + dx, y, 0, S - 1, d + 1); else if (s > 0) push(x + dx, y, j, s - 1, d + 1);
    }
    const best = new Map(); // per tile
    for (const [k, d] of dist) { const [x, y] = k.split(",").map(Number), t = y * w + x; if (!best.has(t) || best.get(t) > d) best.set(t, d); }
    return { w, h, at: (x, y) => best.get(y * w + x) };
  };
  // Put n copies of ch on random tiles whose current character is in o.on (default "."). With o.from (a character),
  // only tiles reachable from it at a walking distance between o.min and o.max; o.farthest picks the farthest ones.
  const place = (rows, ch, n = 1, o = {}) => {
    const g = rows.map((r) => [...r]);
    let spots = [];
    const d = o.from ? levelDist(rows, o.from, o) : null;
    for (let y = 0; y < g.length; y++) for (let x = 0; x < g[y].length; x++) {
      if (!(o.on ?? ".").includes(g[y][x])) continue;
      const dd = d ? d.at(x, y) : 0;
      if (dd === undefined || dd < (o.min ?? 0) || dd > (o.max ?? Infinity)) continue;
      spots.push({ x, y, d: dd, r: rnd() });
    }
    spots.sort((a, b) => (o.farthest ? b.d - a.d : 0) || a.r - b.r);
    spots = spots.slice(0, n);
    if (spots.length < n) note("placeShort", { ch, wanted: n, placed: spots.length });
    for (const s of spots) g[s.y][s.x] = String(ch)[0];
    return rowsOf(g);
  };
  // Check a level against requirements. Returns { ok, problems: [strings], stats }.
  //   reqs = { start: "P", reach: "EK", exit: "E", minPath, maxPath, count: { K: 3, P: 1, E: [1, 2] },
  //            open: [0.3, 0.7], solid: "#", hazard: "^", mode: "walk" | "platform", jump: [3, 4], check(rows) }
  const checklevel = (rows, reqs = {}) => {
    const problems = [], stats = {};
    if (!Array.isArray(rows) || !rows.length || !rows.every((r) => typeof r === "string")) return { ok: false, problems: ["rows must be a non-empty array of strings"], stats };
    const w = rows[0].length, solid = reqs.solid ?? "#";
    if (!rows.every((r) => r.length === w)) problems.push("rows have different lengths");
    const find = (ch) => { const out = []; rows.forEach((r, y) => [...r].forEach((c, x) => { if (c === ch) out.push({ x, y }); })); return out; };
    for (const [ch, want] of Object.entries(reqs.count ?? {})) {
      const n = find(ch).length, [lo, hi] = Array.isArray(want) ? want : [want, want];
      if (n < lo || n > hi) problems.push(`"${ch}" appears ${n} times; wanted ${lo === hi ? lo : `${lo}-${hi}`}`);
    }
    const openTiles = rows.join("").split("").filter((c) => !solid.includes(c)).length;
    stats.open = +(openTiles / (w * rows.length)).toFixed(2);
    if (reqs.open && (stats.open < reqs.open[0] || stats.open > reqs.open[1])) problems.push(`${Math.round(stats.open * 100)}% of tiles are open; wanted ${reqs.open[0] * 100}-${reqs.open[1] * 100}%`);
    const start = reqs.start ?? "P", starts = find(start);
    if (reqs.reach || reqs.exit) {
      if (!starts.length) problems.push(`no start tile "${start}"`);
      else {
        const d = levelDist(rows, start, reqs);
        for (const ch of reqs.reach ?? "") {
          const lost = find(ch).filter((t) => d.at(t.x, t.y) === undefined);
          if (lost.length) problems.push(`${lost.length} "${ch}" tile(s) can't be reached from "${start}": ${lost.slice(0, 4).map((t) => `(${t.x},${t.y})`).join(" ")}`);
        }
        if (reqs.exit) {
          const ds = find(reqs.exit).map((t) => d.at(t.x, t.y)).filter((x) => x !== undefined);
          stats.path = ds.length ? Math.min(...ds) : null;
          if (stats.path === null) problems.push(`the exit "${reqs.exit}" can't be reached from "${start}"`);
          else {
            if (reqs.minPath && stats.path < reqs.minPath) problems.push(`the shortest route to the exit is ${stats.path} steps; wanted at least ${reqs.minPath}`);
            if (reqs.maxPath && stats.path > reqs.maxPath) problems.push(`the shortest route to the exit is ${stats.path} steps; wanted at most ${reqs.maxPath}`);
          }
        }
      }
    }
    if (typeof reqs.check === "function") { const r = reqs.check(rows); if (r !== true && r !== undefined) problems.push(String(r || "check(rows) failed")); }
    return { ok: !problems.length, problems, stats };
  };
  // Generate-and-test for levels: calls make(i) until checklevel(rows, reqs) passes, at most `tries` times. Returns rows, or null.
  const makelevel = (make, reqs, tries = 50) => {
    let last = null;
    for (let i = 0; i < tries; i++) { const rows = make(i); last = checklevel(rows, reqs); if (last.ok) return rows; }
    note("makelevelFailed", { tries, problems: last?.problems.slice(0, 3) });
    return null;
  };

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
    anagrams, wordsfrom, matchword, neighbors,
    letterfreq: (ch) => letterStats().share[String(ch).toUpperCase()] ?? 0,
    letterscore: (ch) => letterStats().score[String(ch).toUpperCase()] ?? 0,
    categories: (o) => Object.keys(catsOf(o)),
    category: (name, o) => (catsOf(o)[String(name).toUpperCase()] ?? []).slice(),
    categoryof,
    solve, makepuzzle, keyboard,
    deck, deal, cardname, drawcard, cardtotal, pokerhand,
    genmaze, gencave, genrooms, place, checklevel, makelevel,
    sharegrid: (rows) => rows.map((r) => [...String(r).toUpperCase()].map((ch) => SHARE[ch] ?? "⬛").join("")).join("\n"),
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
