// The generation harness: brief -> design + code -> self-review -> tests -> fix loop -> critic -> best of N.
//   npm run build -- b03 --provider gemini           full pipeline for brief b03
//   npm run build -- --provider mock                  whole pipeline with no API key (all briefs)
//   npm run build -- b01 --oneshot                    round 1 of the bake-off: one call, no review, no fixes
// Options: --provider gemini|mock  --model <id>  --candidates N (default 1)  --attempts N fix rounds (default 3)
//          --no-review  --critic | --no-critic  --oneshot  --force  --briefs <file>  --out <dir>
// Writes out/<model>/<brief>.js (the best version), out/<model>/<brief>.json (summary), and every
// attempt with its raw reply, report and screenshots under out/<model>/<brief>/.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getProvider, extractCode, extractTag, costOf } from "./harness/providers.mjs";
import { systemPrompt, briefPrompt, REVIEW_PROMPT, fixPrompt, criticPrompt } from "./harness/prompts.mjs";
import { evaluate } from "./harness/evaluate.mjs";
import { feedbackText, rankKey, better, statsLine } from "./harness/feedback.mjs";
import { contactSheet } from "./harness/png.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const VALUED = new Set(["provider", "model", "candidates", "attempts", "briefs", "out"]);
const ids = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && VALUED.has(args[i - 1].slice(2))));

if (flag("models")) {
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", { headers: { "x-goog-api-key": process.env.GEMINI_API_KEY ?? "" } });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data.error ?? data));
  for (const m of data.models.filter((m) => m.supportedGenerationMethods?.includes("generateContent"))) console.log(m.name.replace("models/", "").padEnd(40), m.displayName);
  process.exit(0);
}

const oneshot = flag("oneshot");
const cfg = {
  candidates: oneshot ? 1 : Number(opt("candidates", 1)),
  attempts: oneshot ? 0 : Number(opt("attempts", 3)),
  review: !oneshot && !flag("no-review"),
  critic: !oneshot && !flag("no-critic"),
};
const provider = getProvider(opt("provider", "gemini"), opt("model"));
const briefs = JSON.parse(fs.readFileSync(path.resolve(root, opt("briefs", "briefs.json")), "utf8"));
const todo = ids.length ? briefs.filter((b) => ids.includes(b.id)) : briefs;
const outDir = path.resolve(root, opt("out", "out"), provider.model.replace(/[^\w.-]/g, "_"));
const SYSTEM = systemPrompt();
fs.mkdirSync(outDir, { recursive: true });

console.log(`${provider.name}/${provider.model}: ${todo.length} brief(s), ${cfg.candidates} candidate(s), ${cfg.attempts} fix round(s), review ${cfg.review ? "on" : "off"}, critic ${cfg.critic ? "on" : "off"}`);

for (const brief of todo) {
  const finalFile = path.join(outDir, `${brief.id}.js`);
  if (fs.existsSync(finalFile) && !flag("force")) { console.log(`${brief.id}: exists, skipping (--force to redo)`); continue; }
  const dir = path.join(outDir, brief.id);
  fs.mkdirSync(dir, { recursive: true });
  console.log(`\n${brief.id} (${brief.type}${brief.genre ? ", " + brief.genre : ""}: ${brief.theme} / ${brief.mechanic})`);
  const log = { brief, provider: provider.name, model: provider.model, modelVersion: null, date: new Date().toISOString(), config: cfg,
    usage: { input: 0, output: 0, thinking: 0 }, cost: 0, ms: 0, calls: 0, candidates: [] };
  const t0 = Date.now();
  let winner = null;

  try {
    for (let c = 1; c <= cfg.candidates; c++) {
      const cand = await runCandidate(brief, c, dir, log);
      log.candidates.push(cand.summary);
      if (cand.best && (!winner || better(cand.best.key, winner.key))) winner = cand.best;
    }
  } catch (e) {
    console.log(`  FAILED: ${e.message}`);
    log.error = e.message;
  }

  log.ms = Date.now() - t0;
  log.cost = +costOf(provider.model, log.usage).toFixed(4);
  if (winner) {
    fs.writeFileSync(finalFile, winner.code);
    log.final = { candidate: winner.candidate, attempt: winner.attempt, pass: winner.report.pass, errors: winner.report.errors, warnings: winner.report.warnings,
      issues: winner.report.issues.map((i) => `[${i.severity}] ${i.check}: ${i.message}`), metrics: winner.report.metrics, critic: winner.critic ?? null };
    console.log(`  => best: candidate ${winner.candidate} attempt ${winner.attempt}, ${winner.report.pass ? "PASS" : "FAIL"} (${statsLine(winner.report)}); ${log.calls} calls, $${log.cost}, ${(log.ms / 1000).toFixed(0)} s`);
  }
  fs.writeFileSync(path.join(outDir, `${brief.id}.json`), JSON.stringify(log, null, 2));
}

async function call(messages, log, label, dir) {
  const last = messages[messages.length - 1];
  fs.writeFileSync(path.join(dir, `${label}.prompt.md`), typeof last.content === "string" ? last.content : JSON.stringify(last.content));
  const r = await provider.chat({ system: SYSTEM, messages });
  log.calls++;
  for (const k of ["input", "output", "thinking"]) log.usage[k] += r.usage[k] ?? 0;
  log.modelVersion = r.modelVersion ?? log.modelVersion;
  fs.writeFileSync(path.join(dir, `${label}.reply.md`), r.text);
  if (r.finishReason && !["STOP", "end_turn"].includes(r.finishReason)) console.log(`    note: finish reason ${r.finishReason}`);
  return r;
}

async function runCandidate(brief, c, dir, log) {
  const tag = (a) => `c${c}-a${a}`;
  const summary = { candidate: c, attempts: [] };
  const user = { role: "user", content: briefPrompt(brief) };

  // 1. Design + code.
  let r = await call([user], log, `${tag(0)}-gen`, dir);
  let design = extractTag(r.text, "design");
  let code = extractCode(r.text);
  if (!code) { console.log(`  c${c}: no code in the reply`); summary.error = "no code"; return { summary }; }
  if (design) fs.writeFileSync(path.join(dir, `c${c}-design.md`), design);

  // 2. Self-review against the checklist, before any testing.
  if (cfg.review) {
    const asked = [user, { role: "assistant", content: r.text }, { role: "user", content: REVIEW_PROMPT }];
    const rv = await call(asked, log, `${tag(0)}-review`, dir);
    const reviewed = extractCode(rv.text);
    const found = extractTag(rv.text, "review");
    if (reviewed) code = reviewed;
    console.log(`  c${c} review: ${found ? found.split("\n")[0].slice(0, 100) : "(no review block)"}`);
  }

  // 3. Test, then fix up to N times. Keep the best version, not the latest.
  let best = null;
  for (let a = 0; a <= cfg.attempts; a++) {
    fs.writeFileSync(path.join(dir, `${tag(a)}.js`), code);
    const report = await evaluate(code, { brief });
    saveReport(dir, tag(a), report);
    const key = rankKey(report);
    const line = `  c${c} attempt ${a}: ${report.pass ? "PASS" : "FAIL"}, ${statsLine(report)}`;
    console.log(line + (report.issues[0] ? `\n      top issue: [${report.issues[0].severity}] ${report.issues[0].message.slice(0, 140)}` : ""));
    summary.attempts.push({ attempt: a, pass: report.pass, errors: report.errors, warnings: report.warnings, top: report.issues.slice(0, 3).map((i) => i.message.slice(0, 160)) });
    if (!best || better(key, best.key)) best = { code, report, key, candidate: c, attempt: a, design };
    if (report.errors === 0 && report.warnings === 0) break;
    if (a === cfg.attempts) break;
    // Fix the best version so far, with only the latest feedback in context.
    const fb = feedbackText(best.report);
    const prior = `${design ? `<design>\n${design}\n</design>\n\n` : ""}\`\`\`js\n${best.code}\`\`\``;
    r = await call([user, { role: "assistant", content: prior }, { role: "user", content: fixPrompt(fb, { attempt: a + 1, maxAttempts: cfg.attempts }) }], log, `${tag(a + 1)}-fix`, dir);
    const fixed = extractCode(r.text);
    if (!fixed) { console.log(`  c${c}: the fix reply had no code`); break; }
    code = fixed;
  }

  // 4. Critic: a model looks at screenshots of the best version and judges readability and brief match.
  if (cfg.critic && best?.report.snaps?.length && provider.vision) {
    const png = contactSheet(best.report.snaps.map((s) => s.fb));
    const content = [
      { type: "text", text: criticPrompt({ brief, design: best.design, stats: statsLine(best.report) }) },
      { type: "image", mime: "image/png", data: png.toString("base64") },
    ];
    try {
      const cr = await provider.chat({ system: "You are a careful, honest game reviewer.", messages: [{ role: "user", content }] });
      log.calls++;
      for (const k of ["input", "output", "thinking"]) log.usage[k] += cr.usage[k] ?? 0;
      const json = JSON.parse((cr.text.match(/\{[\s\S]*\}/) ?? ["{}"])[0]);
      best.critic = json;
      best.key = rankKey(best.report, json);
      console.log(`  c${c} critic: readable ${json.readable}, brief ${json.brief}, polish ${json.polish}${json.bugs?.length ? `; bugs: ${json.bugs.join("; ").slice(0, 160)}` : ""}`);
    } catch (e) { best.critic = { error: e.message }; }
  }
  summary.best = best ? { attempt: best.attempt, pass: best.report.pass, critic: best.critic ?? null } : null;
  return { summary, best };
}

function saveReport(dir, name, report) {
  const { snaps, ...rest } = report;
  fs.writeFileSync(path.join(dir, `${name}.report.json`), JSON.stringify(rest, null, 2));
  if (snaps?.length) fs.writeFileSync(path.join(dir, `${name}.sheet.png`), contactSheet(snaps.map((s) => s.fb)));
}
