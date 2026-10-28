// Per-model table for the bake-off: joins out/<model>/<brief>.json (generation logs), results/checks.json
// (npm run check) and exported playtest ratings into results/report.md.
//   npm run report                        uses results/ratings.json if it exists
//   npm run report -- path/to/ratings.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const ratingsFile = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, "results/ratings.json");
const ratings = readJson(ratingsFile, { ratings: {} }).ratings ?? {};
const checks = readJson(path.join(root, "results/checks.json"), { results: [] }).results;
const outRoot = path.join(root, "out");

const avg = (xs) => { const v = xs.filter((x) => typeof x === "number" && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "-");
const num = (x, f = 1) => (x === null || x === undefined ? "-" : x.toFixed(f));

const rows = [], details = [];
for (const model of fs.existsSync(outRoot) ? fs.readdirSync(outRoot).filter((m) => fs.statSync(path.join(outRoot, m)).isDirectory()) : []) {
  const logs = fs.readdirSync(path.join(outRoot, model)).filter((f) => f.endsWith(".json")).map((f) => readJson(path.join(outRoot, model, f), null)).filter(Boolean);
  const games = fs.readdirSync(path.join(outRoot, model)).filter((f) => f.endsWith(".js")).map((f) => f.replace(/\.js$/, ""));
  if (!games.length) continue;
  const chk = games.map((b) => checks.find((c) => c.file === `out/${model}/${b}.js`)).filter(Boolean);
  const firstTry = logs.map((l) => l.candidates?.[0]?.attempts?.[0]?.pass).filter((x) => x !== undefined);
  const rated = games.map((b) => ratings[`out/${model}/${b}.js`]).filter(Boolean);
  const critics = logs.map((l) => l.final?.critic).filter((c) => c && !c.error);
  rows.push({
    model,
    versions: [...new Set(logs.map((l) => l.modelVersion).filter(Boolean))].join(", ") || "-",
    games: games.length,
    pass: pct(chk.filter((c) => c.pass).length, chk.length),
    oneShot: pct(firstTry.filter(Boolean).length, firstTry.length),
    fixes: num(avg(logs.map((l) => l.final?.attempt)), 1),
    fun: num(avg(rated.map((r) => r.fun)), 2),
    match: num(avg(rated.map((r) => r.match)), 2),
    rated: rated.length,
    critic: num(avg(critics.map((c) => (c.readable + c.brief + c.polish) / 3)), 2),
    cost: avg(logs.map((l) => l.cost)),
    secs: avg(logs.map((l) => l.ms / 1000)),
    dates: [...new Set(logs.map((l) => l.date?.slice(0, 10)).filter(Boolean))].join(", "),
  });
  for (const c of chk.filter((c) => !c.pass)) details.push(`- \`${c.file}\`: ${c.issues.filter((i) => i.severity === "error").slice(0, 3).map((i) => `${i.check}: ${i.message.slice(0, 120)}`).join("; ")}`);
}

const lines = [
  "# Bake-off report",
  "",
  `Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC from \`out/\`, \`results/checks.json\` and ${Object.keys(ratings).length ? `\`${path.relative(root, ratingsFile)}\`` : "no playtest ratings yet"}.`,
  "",
  "| Model | Exact version | Games | Pass (now) | Pass first try | Avg fix rounds | Fun | Brief match | Rated | Critic | $/game | s/game | Run dates |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.model} | ${r.versions} | ${r.games} | ${r.pass} | ${r.oneShot} | ${r.fixes} | ${r.fun} | ${r.match} | ${r.rated} | ${r.critic} | ${r.cost === null ? "-" : "$" + r.cost.toFixed(3)} | ${num(r.secs, 0)} | ${r.dates} |`),
  "",
  "- **Pass (now)**: share of the model's current games that pass every harness check (`npm run check`).",
  "- **Pass first try**: share whose first attempt passed, before any self-review fixes or fix rounds.",
  "- **Fun / Brief match**: average blind playtest ratings (1-5) exported from `play.html`. **Critic**: average of the screenshot critic's three 1-5 scores.",
  "",
  "## Failing games",
  "",
  ...(details.length ? details : ["None."]),
  "",
];
fs.mkdirSync(path.join(root, "results"), { recursive: true });
fs.writeFileSync(path.join(root, "results/report.md"), lines.join("\n"));
console.log(lines.slice(4, 6 + rows.length).join("\n"));
console.log("\nWrote results/report.md");
