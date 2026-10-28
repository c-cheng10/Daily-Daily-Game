// Runs the full harness evaluation (no model calls) on every game in out/<model>/<brief>.js and on the examples.
//   npm run check                 everything
//   npm run check -- b03 example  only files whose name contains one of these
// Writes results/checks.json and a screenshot sheet per game in results/sheets/.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { evaluate } from "./harness/evaluate.mjs";
import { contactSheet } from "./harness/png.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const filters = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const briefs = Object.fromEntries(["briefs.json", "briefs-genres.json"].filter((f) => fs.existsSync(path.join(root, f)))
  .flatMap((f) => JSON.parse(fs.readFileSync(path.join(root, f), "utf8"))).map((b) => [b.id, b]));

const files = fs.readdirSync(path.join(root, "engine")).filter((f) => /^example-.*\.js$/.test(f)).map((f) => ({ file: `engine/${f}`, model: "example", brief: f.replace(/\.js$/, "") }));
const outRoot = path.join(root, "out");
if (fs.existsSync(outRoot)) {
  for (const model of fs.readdirSync(outRoot).filter((m) => fs.statSync(path.join(outRoot, m)).isDirectory())) {
    for (const f of fs.readdirSync(path.join(outRoot, model)).filter((f) => f.endsWith(".js"))) {
      files.push({ file: `out/${model}/${f}`, model, brief: f.replace(/\.js$/, "") });
    }
  }
}
const todo = filters.length ? files.filter((f) => filters.some((x) => f.file.includes(x))) : files;
fs.mkdirSync(path.join(root, "results/sheets"), { recursive: true });

const results = [];
const queue = todo.slice();
const workers = Math.max(1, Math.min(4, os.cpus().length - 1));
await Promise.all(Array.from({ length: workers }, async () => {
  for (let job; (job = queue.shift());) {
    const src = fs.readFileSync(path.join(root, job.file), "utf8");
    const report = await evaluate(src, { brief: briefs[job.brief] });
    if (report.snaps?.length) fs.writeFileSync(path.join(root, "results/sheets", `${job.model}-${job.brief}.png`), contactSheet(report.snaps.map((s) => s.fb)));
    const { snaps, ...rest } = report;
    results.push({ ...job, ...rest });
    const top = report.issues.filter((i) => i.severity === "error").slice(0, 3).map((i) => `      [${i.check}] ${i.message.slice(0, 150)}`).join("\n");
    console.log(`${report.pass ? "PASS" : "FAIL"}  ${job.file}  (${report.errors} errors, ${report.warnings} warnings)${top ? "\n" + top : ""}`);
  }
}));

results.sort((a, b) => a.file.localeCompare(b.file));
fs.writeFileSync(path.join(root, "results/checks.json"), JSON.stringify({ date: new Date().toISOString(), results }, null, 2));
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} passed. Details: results/checks.json; screenshots: results/sheets/`);
