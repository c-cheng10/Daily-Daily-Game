// Leaderboard storage: one JSON file per day under site/data/scores/.
// Keeps each player's best run. Swap this module for a real database when deploying.
import fs from "node:fs";
import path from "node:path";

let dir;
export function init(dataDir) {
  dir = path.join(dataDir, "scores");
  fs.mkdirSync(dir, { recursive: true });
}

const file = (date) => path.join(dir, `${date}.json`);
const load = (date) => (fs.existsSync(file(date)) ? JSON.parse(fs.readFileSync(file(date), "utf8")) : { entries: {} });
const better = (type, a, b) => (type === "speedrun" ? a < b : a > b);

// Returns true if this run became the player's new best.
export function submit(date, type, playerId, name, value) {
  const data = load(date);
  const prev = data.entries[playerId];
  const isBest = !prev || better(type, value, prev.value);
  if (isBest) data.entries[playerId] = { name, value, at: Date.now() };
  else prev.name = name;
  fs.writeFileSync(file(date), JSON.stringify(data));
  return isBest;
}

export function board(date, type, playerId, limit = 50) {
  const rows = Object.entries(load(date).entries)
    .map(([id, e]) => ({ id, ...e }))
    .sort((a, b) => (a.value === b.value ? a.at - b.at : better(type, a.value, b.value) ? -1 : 1));
  const top = rows.slice(0, limit).map((r, i) => ({ rank: i + 1, name: r.name, value: r.value, you: r.id === playerId }));
  const mine = rows.findIndex((r) => r.id === playerId);
  return {
    date, type, total: rows.length, top,
    you: mine < 0 ? null : { rank: mine + 1, name: rows[mine].name, value: rows[mine].value },
  };
}
