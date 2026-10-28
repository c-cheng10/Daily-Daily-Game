// Everyone plays the same seed on the same day, so leaderboard runs are comparable.
// Shared by the browser (app.js) and the server (replay).
export function seedFromDate(date) {
  let h = 2166136261;
  for (const ch of "ddg:" + date) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

// One byte per frame: bit i = button i held.
export const packButtons = (b) => b.reduce((n, on, i) => n | (on ? 1 << i : 0), 0);
export const unpackButtons = (n) => [0, 1, 2, 3, 4, 5].map((i) => !!(n & (1 << i)));
