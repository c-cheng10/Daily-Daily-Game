// The generation harness: brief -> design + code -> self-review -> tests -> fix loop -> critic -> best of N.
//   npm run build -- b03 --provider gemini           full pipeline for brief b03
//   npm run build -- --provider mock                  whole pipeline with no API key (all briefs)
//   npm run build -- b01 --oneshot                    round 1 of the bake-off: one call, no review, no fixes
// Options: --provider claude|gemini|openrouter|groq|mock  --model <id>  --candidates N (default 1)
//          --attempts N fix rounds (default 3)  --no-review  --no-critic  --critic-with <provider>[:<model>]
//          --parallel N briefs at once (default 1)  --oneshot  --force  --briefs <file>  --out <dir>
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
const VALUED = new Set(["provider", "model", "candidates", "attempts", "briefs", "out", "critic-with", "parallel"]);
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
// The critic should not be the model that wrote the game (models grade their own work kindly). In the bake-off,
// use one fixed critic for every model so its bias is the same everywhere, e.g. --critic-with gemini.
const criticProvider = opt("critic-with") ? getProvider(...opt("critic-with").split(/:(.*)/s, 2)) : provider;
const briefs = JSON.parse(fs.readFileSync(path.resolve(root, opt("briefs", "briefs.json")), "utf8"));
const todo = ids.length ? briefs.filter((b) => ids.includes(b.id)) : briefs;
const outDir = path.resolve(root, opt("out", "out"), provider.model.replace(/[^\w.-]/g, "_"));
const SYSTEM = systemPrompt();
const parallel = Math.max(1, Number(opt("parallel", 1)));
fs.mkdirSync(outDir, { recursive: true });

console.log(`${provider.name}/${provider.model}: ${todo.length} brief(s), ${cfg.candidates} candidate(s), ${cfg.attempts} fix round(s), review ${cfg.review ? "on" : "off"}, critic ${cfg.critic ? `${criticProvider.name}/${criticProvider.model}` : "off"}${parallel > 1 ? `, ${parallel} at a time` : ""}`);

const queue = todo.slice();
await Promise.all(Array.from({ length: Math.min(parallel, queue.length || 1) }, async () => {
  for (let brief; (brief = queue.shift());) await runBrief(brief);
}));

async function runBrief(brief) {
  const finalFile = path.join(outDir, `${brief.id}.js`);
  if (fs.existsSync(finalFile) && !flag("force")) { console.log(`${brief.id}: exists, skipping (--force to redo)`); return; }
  const dir = path.join(outDir, brief.id);
  fs.mkdirSync(dir, { recursive: true });
  const usage0 = () => ({ input: 0, output: 0, thinking: 0, cacheWrite: 0, cacheRead: 0 });
  const log = { brief, provider: provider.name, model: provider.model, modelVersion: null, date: new Date().toISOString(), config: cfg,
    usage: usage0(), criticModel: cfg.critic ? criticProvider.model : null, criticUsage: usage0(), cost: 0, ms: 0, calls: 0, candidates: [] };
  // With several briefs at once, print each brief's lines together when it finishes.
  const lines = [];
  log.say = (s) => (parallel > 1 ? lines.push(s) : console.log(s));
  log.say(`\n${brief.id} (${brief.type}${brief.genre ? ", " + brief.genre : ""}: ${brief.theme} / ${brief.mechanic})`);
  const t0 = Date.now();
  let winner = null;

  try {
    for (let c = 1; c <= cfg.candidates; c++) {
      const cand = await runCandidate(brief, c, dir, log);
      log.candidates.push(cand.summary);
      if (cand.best && (!winner || better(cand.best.key, winner.key))) winner = cand.best;
    }
  } catch (e) {
    log.say(`  FAILED: ${e.message}`);
    log.error = e.message;
  }

  log.ms = Date.now() - t0;
  log.cost = +(costOf(provider.model, log.usage) + costOf(criticProvider.model, log.criticUsage)).toFixed(4);
  if (winner) {
    fs.writeFileSync(finalFile, winner.code);
    log.final = { candidate: winner.candidate, attempt: winner.attempt, pass: winner.report.pass, errors: winner.report.errors, warnings: winner.report.warnings,
      issues: winner.report.issues.map((i) => `[${i.severity}] ${i.check}: ${i.message}`), metrics: winner.report.metrics, critic: winner.critic ?? null };
    log.say(`  => best: candidate ${winner.candidate} attempt ${winner.attempt}, ${winner.report.pass ? "PASS" : "FAIL"} (${statsLine(winner.report)}); ${log.calls} calls, $${log.cost}, ${(log.ms / 1000).toFixed(0)} s`);
  }
  const { say, ...saved } = log;
  fs.writeFileSync(path.join(outDir, `${brief.id}.json`), JSON.stringify(saved, null, 2));
  if (lines.length) console.log(lines.join("\n"));
}

function addUsage(into, u) { for (const k of Object.keys(into)) into[k] += u[k] ?? 0; }

async function call(messages, log, label, dir) {
  const last = messages[messages.length - 1];
  fs.writeFileSync(path.join(dir, `${label}.prompt.md`), typeof last.content === "string" ? last.content : JSON.stringify(last.content));
  const r = await provider.chat({ system: SYSTEM, messages });
  log.calls++;
  addUsage(log.usage, r.usage);
  log.modelVersion = r.modelVersion ?? log.modelVersion;
  fs.writeFileSync(path.join(dir, `${label}.reply.md`), r.text);
  if (r.truncated) log.say(`    note: the reply was cut off at the output limit (${r.finishReason})`);
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
  if (!code) { log.say(`  c${c}: no code in the reply`); summary.error = "no code"; return { summary }; }
  if (design) fs.writeFileSync(path.join(dir, `c${c}-design.md`), design);

  // 2. Self-review against the checklist, before any testing.
  if (cfg.review) {
    const asked = [user, { role: "assistant", content: r.text }, { role: "user", content: REVIEW_PROMPT }];
    const rv = await call(asked, log, `${tag(0)}-review`, dir);
    const reviewed = extractCode(rv.text);
    const found = extractTag(rv.text, "review");
    if (reviewed) code = reviewed;
    log.say(`  c${c} review: ${found ? found.split("\n")[0].slice(0, 100) : "(no review block)"}`);
  }

  // 3. Test, then fix up to N times. Keep the best version, not the latest. The model is told which problems
  // survived its last fix and what it said it changed (memory across attempts), and the loop stops when two
  // fixes in a row don't improve on the best version.
  let best = null, stalled = 0, truncated = r.truncated;
  const history = [];
  for (let a = 0; a <= cfg.attempts; a++) {
    fs.writeFileSync(path.join(dir, `${tag(a)}.js`), code);
    const report = await evaluate(code, { brief });
    if (truncated && report.issues.some((i) => i.check === "syntax")) {
      report.issues.unshift({ severity: "error", check: "truncated", message: "your reply was cut off at the output limit, so the file is incomplete. Write a more compact game (aim for under 600 lines) and return the WHOLE file" });
      report.errors++;
    }
    saveReport(dir, tag(a), report);
    const key = rankKey(report);
    const line = `  c${c} attempt ${a}: ${report.pass ? "PASS" : "FAIL"}, ${statsLine(report)}`;
    log.say(line + (report.issues[0] ? `\n      top issue: [${report.issues[0].severity}] ${report.issues[0].message.slice(0, 140)}` : ""));
    summary.attempts.push({ attempt: a, pass: report.pass, errors: report.errors, warnings: report.warnings, top: report.issues.slice(0, 3).map((i) => i.message.slice(0, 160)) });
    if (history.length) history[history.length - 1].after = { errors: report.errors, warnings: report.warnings, kept: !best || better(key, best.key) };
    if (!best || better(key, best.key)) { best = { code, report, key, candidate: c, attempt: a, design }; stalled = 0; }
    else if (++stalled >= 2) { log.say(`  c${c}: two fixes in a row didn't improve on attempt ${best.attempt}; stopping this candidate`); break; }
    if (report.errors === 0 && report.warnings === 0) break;
    if (a === cfg.attempts) break;
    // Fix the best version so far, with only the latest feedback (plus a short memory of earlier fixes) in context.
    // A problem "still fails" when a fix was tried and the latest attempt has it too.
    const latest = new Set(a > 0 ? report.issues.map(issueKey) : []);
    const fb = feedbackText({ ...best.report, issues: best.report.issues.map((i) => ({ ...i, persist: latest.has(issueKey(i)) })) });
    const prior = `${design ? `<design>\n${design}\n</design>\n\n` : ""}\`\`\`js\n${best.code}\`\`\``;
    r = await call([user, { role: "assistant", content: prior }, { role: "user", content: fixPrompt(fb, { attempt: a + 1, maxAttempts: cfg.attempts, history }) }], log, `${tag(a + 1)}-fix`, dir);
    truncated = r.truncated;
    history.push({ attempt: a + 1, analysis: extractTag(r.text, "analysis"), before: { errors: best.report.errors, warnings: best.report.warnings } });
    const fixed = extractCode(r.text);
    if (!fixed) { log.say(`  c${c}: the fix reply had no code`); break; }
    code = fixed;
  }

  // 4. Critic: a model looks at screenshots of the best version and judges readability and brief match.
  if (cfg.critic && best?.report.snaps?.length && criticProvider.vision) {
    const png = contactSheet(best.report.snaps.map((s) => s.fb));
    const content = [
      { type: "text", text: criticPrompt({ brief, design: best.design, stats: statsLine(best.report) }) },
      { type: "image", mime: "image/png", data: png.toString("base64") },
    ];
    try {
      const cr = await criticProvider.chat({ system: "You are a careful, honest game reviewer.", messages: [{ role: "user", content }] });
      log.calls++;
      addUsage(log.criticUsage, cr.usage);
      const json = JSON.parse((cr.text.match(/\{[\s\S]*\}/) ?? ["{}"])[0]);
      best.critic = json;
      best.key = rankKey(best.report, json);
      log.say(`  c${c} critic: readable ${json.readable}, brief ${json.brief}, polish ${json.polish}${json.bugs?.length ? `; bugs: ${json.bugs.join("; ").slice(0, 160)}` : ""}`);
    } catch (e) { best.critic = { error: e.message }; }
  }
  summary.best = best ? { attempt: best.attempt, pass: best.report.pass, critic: best.critic ?? null } : null;
  return { summary, best };
}

// Same problem across attempts: same check, same message ignoring numbers (frames, positions change).
function issueKey(i) { return i.check + "|" + i.message.replace(/-?\d+(\.\d+)?/g, "#").slice(0, 70); }

function saveReport(dir, name, report) {
  const { snaps, ...rest } = report;
  fs.writeFileSync(path.join(dir, `${name}.report.json`), JSON.stringify(rest, null, 2));
  if (snaps?.length) fs.writeFileSync(path.join(dir, `${name}.sheet.png`), contactSheet(snaps.map((s) => s.fb)));
}
