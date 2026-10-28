// Example 4 (speedrun, logic puzzle): fill a 5x5 grid so every row and column has 1-5 exactly once.
// Three puzzles, fewer clues each time. Puzzles are generated with the engine's solver: start from a full grid,
// remove clues one by one, and keep a removal only if solve() still finds exactly one solution.
// Arrows move, O raises the number in a cell, X clears it.
const N = 5, ROUNDS = 3, CLUES = [14, 11, 9];
let level, grid, givens, solution, cx, cy, msgUntil, done;

function conflicts(s, i, v) {
  const r = Math.floor(i / N), c = i % N;
  for (let k = 0; k < N; k++) if ((k !== c && s[r * N + k] === v) || (k !== r && s[k * N + c] === v)) return true;
  return false;
}

// The puzzle as a search problem: fill the first empty cell with a number that breaks no rule.
function spec(start) {
  return {
    start,
    moves: (s) => { const i = s.indexOf(0); return i < 0 ? [] : [1, 2, 3, 4, 5].map((v) => ({ i, v })); },
    apply: (s, m) => { if (conflicts(s, m.i, m.v)) return null; const t = s.slice(); t[m.i] = m.v; return t; },
    goal: (s) => !s.includes(0),
    key: (s) => s.join(""),
    show: (s) => [0, 1, 2, 3, 4].map((r) => s.slice(r * N, r * N + N).join("").replace(/0/g, ".")).join("\n"),
    // The buttons that make move m in the real game (from where the cursor is now), so the harness can play the
    // solver's solution through update() and confirm both use the same rules.
    buttons: (m) => {
      const out = [], tx = m.i % N, ty = Math.floor(m.i / N);
      for (let x = cx; x !== tx; x += tx > x ? 1 : -1) out.push(tx > x ? "R" : "L");
      for (let y = cy; y !== ty; y += ty > y ? 1 : -1) out.push(ty > y ? "D" : "U");
      for (let k = 0; k < (m.v - grid[m.i] + N + 1) % (N + 1); k++) out.push("O");
      return out;
    },
  };
}

function newPuzzle() {
  // A random full grid: shuffle the rows, columns and numbers of (r + c) % N.
  const rows = shuffle([0, 1, 2, 3, 4]), cols = shuffle([0, 1, 2, 3, 4]), nums = shuffle([1, 2, 3, 4, 5]);
  const full = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) full.push(nums[(rows[r] + cols[c]) % N]);
  // Remove clues while the answer stays unique, down to this level's target.
  const p = makepuzzle(() => {
    const s = full.slice();
    let clues = N * N;
    for (const i of shuffle([...Array(N * N).keys()])) {
      if (clues <= CLUES[level]) break;
      const v = s[i];
      s[i] = 0;
      if (solve(spec(s), { max: 2 }).count === 1) clues--; else s[i] = v;
    }
    return s;
  }, (s) => s.filter(Boolean).length <= CLUES[level] + 1, 20);
  solution = full;
  givens = p ?? full.map((v, i) => (i % 2 ? 0 : v)); // never null in practice; the harness would flag makepuzzle failing
  grid = givens.slice();
}

const bad = (i) => grid[i] && conflicts(grid, i, grid[i]);

export default {
  type: "speedrun",

  init(seed) {
    level = 0;
    cx = 0; cy = 0;
    msgUntil = 0;
    done = false;
    newPuzzle();
  },

  update(input) {
    if (btnp(0)) cx = (cx + N - 1) % N;
    if (btnp(1)) cx = (cx + 1) % N;
    if (btnp(2)) cy = (cy + N - 1) % N;
    if (btnp(3)) cy = (cy + 1) % N;
    const i = cy * N + cx;
    if (!givens[i]) {
      if (btnp(4)) grid[i] = (grid[i] + 1) % (N + 1);
      if (btnp(5)) grid[i] = 0;
    }
    if (!grid.includes(0) && !grid.some((_, k) => bad(k))) {
      level++;
      msgUntil = frame() + 45;
      if (level >= ROUNDS) { done = true; finish(); } else newPuzzle();
    }
  },

  draw() {
    cls(1);
    print("PUZZLE " + Math.min(level + 1, ROUNDS) + "/" + ROUNDS, 2, 2, 7);
    const t = (frame() / 30).toFixed(1) + "S";
    print(t, 126 - textw(t), 2, 10);
    for (let k = 0; k < N * N; k++) {
      const x = 24 + (k % N) * 16, y = 14 + Math.floor(k / N) * 16;
      rectfill(x, y, 15, 15, givens[k] ? 5 : 0);
      if (grid[k]) print(grid[k], x + 6, y + 5, bad(k) ? 8 : givens[k] ? 7 : 12);
    }
    rect(23 + cx * 16, 13 + cy * 16, 17, 17, 10);
    printc("EACH ROW AND COLUMN: 1-5 ONCE", 98, 6);
    printc("ARROWS MOVE  O NUMBER  X CLEAR", 106, 13);
    if (frame() < msgUntil && !done) printc("SOLVED!", 116, 11);
    if (done) {
      rectfill(14, 44, 100, 30, 0);
      printc("ALL SOLVED", 50, 11);
      printc("TIME " + (frame() / 30).toFixed(1) + "S", 60, 7);
    }
  },

  probe() {
    return {
      progress: level * N * N + grid.filter((v, i) => v && v === solution[i]).length,
      state: done ? "won" : "play",
      level: level + 1,
      vars: { cursor: [cx, cy], empty: grid.filter((v) => !v).length },
    };
  },

  // The current puzzle as posed (its clues), for the harness to solve: it must have exactly one answer.
  puzzle() {
    return done ? null : { ...spec(givens.slice()), unique: true };
  },

  // Walk to the first wrong cell and press O until it shows the answer (one press every other frame).
  bot(p, f) {
    if (f % 2) return "";
    const i = grid.findIndex((v, k) => v !== solution[k]);
    if (i < 0) return "";
    const tx = i % N, ty = Math.floor(i / N);
    if (tx !== cx) return tx > cx ? "R" : "L";
    if (ty !== cy) return ty > cy ? "D" : "U";
    return "O";
  },

  invariants(p) {
    return givens.every((v, i) => !v || grid[i] === v) ? [] : ["a clue cell was changed"];
  },

  tests: [
    { name: "the bot solves all three puzzles", frames: 2400, input: "bot", expect: (r) => r.finished || "stopped at " + JSON.stringify(r.probe) },
    { name: "mashing buttons doesn't solve it", frames: 600, input: "random", expect: (r) => !r.finished || "random input finished" },
    { name: "puzzles get fewer clues", frames: 1, input: "", expect: () => givens.filter(Boolean).length <= CLUES[0] + 1 || "too many clues: " + givens.filter(Boolean).length },
  ],
};
