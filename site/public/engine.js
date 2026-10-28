// Minimal deterministic fantasy console. Runs the same in the browser and in Node.
// Everything draws into a 128x128 framebuffer of palette indices; the browser blits it,
// Node just hashes it. No wall-clock time: one tick = one frame at a fixed 30 fps.

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

export function createEngine(seed) {
  const fb = new Uint8Array(W * H);
  const state = { frame: 0, score: 0, finished: false, finishFrame: null };
  let rand = mulberry32(seed);
  let cur = [false, false, false, false, false, false], prev = cur;

  const pset = (x, y, c) => {
    x = Math.floor(x); y = Math.floor(y);
    if (x >= 0 && y >= 0 && x < W && y < H) fb[y * W + x] = c & 15;
  };
  const rectfill = (x, y, w, h, c) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) pset(x + i, y + j, c);
  };
  const line = (x0, y0, x1, y1, c) => {
    x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.floor(x1); y1 = Math.floor(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let n = 0; n < 512; n++) {
      pset(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  };
  const circle = (cx, cy, r, c, fill) => {
    r = Math.floor(r);
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      const d = x * x + y * y;
      if (fill ? d <= r * r + r : d <= r * r + r && d >= r * r - r) pset(cx + x, cy + y, c);
    }
  };

  const api = {
    cls: (c = 0) => fb.fill(c & 15),
    pset,
    rect: (x, y, w, h, c) => {
      line(x, y, x + w - 1, y, c); line(x, y + h - 1, x + w - 1, y + h - 1, c);
      line(x, y, x, y + h - 1, c); line(x + w - 1, y, x + w - 1, y + h - 1, c);
    },
    rectfill,
    circ: (x, y, r, c) => circle(x, y, r, c, false),
    circfill: (x, y, r, c) => circle(x, y, r, c, true),
    line,
    print: (text, x, y, c = 7) => {
      String(text).toUpperCase().split("").forEach((ch, k) => {
        const g = FONT[ch];
        if (g) for (let i = 0; i < 15; i++) if (g[i] === "1") pset(x + k * 4 + (i % 3), y + Math.floor(i / 3), c);
      });
    },
    btn: (i) => !!cur[i],
    btnp: (i) => !!cur[i] && !prev[i],
    rnd: (n = 1) => rand() * n,
    frame: () => state.frame,
    score: (n) => { if (!state.finished) state.score = Number(n) || 0; },
    finish: () => { if (!state.finished) { state.finished = true; state.finishFrame = state.frame; } },
  };

  // Advance one frame: run update with this frame's buttons, then draw.
  function tick(game, buttons) {
    prev = cur; cur = buttons;
    if (!state.finished) game.update(buttons);
    game.draw();
    state.frame++;
  }

  function start(game) {
    rand = mulberry32(seed);
    game.init(seed);
  }

  // Result used for leaderboards: speedrun = seconds to finish (lower is better), else score.
  const result = (type) => type === "speedrun"
    ? (state.finished ? state.finishFrame / FPS : null)
    : state.score;

  return { api, fb, state, start, tick, result };
}

export function hashFrame(fb) {
  let h = 2166136261;
  for (let i = 0; i < fb.length; i++) h = Math.imul(h ^ fb[i], 16777619);
  return (h >>> 0).toString(16);
}
