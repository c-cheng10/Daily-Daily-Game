// Turns an evaluation report into short, specific feedback for the model, and ranks reports.
// Few, concrete problems with a replay beat long logs.

export const MAX_PROBLEMS = 3;

export function feedbackText(report, { max = MAX_PROBLEMS } = {}) {
  const chosen = pickIssues(report, max);
  const parts = chosen.map((i, n) => {
    const lines = [`${n + 1}. [${i.severity}]${i.persist ? " [STILL FAILING after your last fix]" : ""} ${i.check}: ${i.message}${i.times > 1 ? ` (seen ${i.times}x)` : ""}`];
    if (i.repro) {
      const r = i.repro;
      lines.push(`   replay: run "${r.run}", seed ${r.seed}, frame ${r.frame}`);
      if (r.inputs) lines.push(`   buttons up to that frame: ${r.inputs}`);
      if (r.probe) lines.push(`   probe() at that frame: ${r.probe}`);
    }
    if (i.detail) lines.push(i.detail.split("\n").map((l) => "   " + l).join("\n"));
    if (i.code) lines.push("   code:\n" + i.code.split("\n").map((l) => "   " + l).join("\n"));
    return lines.join("\n");
  });
  if (chosen.some((i) => i.repro?.inputs)) parts.push("(Buttons: L R U D O X per frame, \".\" = none, \"R*13\" = R held for 13 frames.)");
  const rest = report.issues.length - chosen.length;
  if (rest > 0) parts.push(`(${rest} less important issue(s) not shown; fix these first.)`);
  const good = workingThings(report);
  if (good.length) parts.push(`Working now, keep it that way: ${good.join("; ")}.`);
  return parts.join("\n\n");
}

// Errors before warnings; within a severity, prefer different checks so one root cause doesn't crowd out others.
function pickIssues(report, max) {
  const out = [], checks = new Set();
  for (const sev of ["error", "warn"]) {
    for (const i of report.issues) if (i.severity === sev && !checks.has(i.check) && out.length < max) { out.push(i); checks.add(i.check); }
    for (const i of report.issues) if (i.severity === sev && !out.includes(i) && out.length < max) out.push(i);
  }
  return out;
}

function workingThings(report) {
  const m = report.metrics ?? {}, out = [];
  const failed = new Set(report.issues.filter((i) => i.severity === "error").map((i) => i.check));
  if (report.stagesDone?.includes("smoke") && !failed.has("crash") && !failed.has("timeout")) out.push("no crashes");
  if (m.deterministic) out.push("deterministic");
  const passed = (report.tests ?? []).filter((t) => t.pass).map((t) => `"${t.name}"`);
  if (passed.length) out.push(`self-tests passing: ${passed.join(", ")}`);
  if (m.botFinishSeconds) out.push(`your bot finishes in ${m.botFinishSeconds.toFixed(1)} s`);
  if (m.botScore !== undefined && m.botScore !== null) out.push(`your bot scores ${m.botScore}`);
  return out;
}

// Lower is better: [errors, warnings, -selfTestsPassed]. Used to keep the best attempt and pick the best candidate.
export function rankKey(report, critic) {
  const tests = (report.tests ?? []).filter((t) => t.pass).length;
  const c = critic && !critic.error ? (critic.readable ?? 0) + (critic.brief ?? 0) + (critic.polish ?? 0) : 0;
  return [report.errors ?? 99, report.warnings ?? 99, -tests, -c];
}
export const better = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; };

export function statsLine(report) {
  const m = report.metrics ?? {};
  const bits = [`${report.errors} errors, ${report.warnings} warnings`];
  if (m.type === "speedrun") bits.push(m.botFinishSeconds ? `designer bot finishes in ${m.botFinishSeconds.toFixed(1)} s` : "designer bot didn't finish");
  else if (m.botScore !== undefined) bits.push(`designer bot scores ${m.botScore}, idle scores ${m.idle?.score}`);
  if (m.search) bits.push(m.type === "speedrun"
    ? `search bot: ${m.search.finished ? `finished in ${m.search.finishSeconds} s` : `didn't finish (best progress ${m.search.bestProgress})`}`
    : `search bot: best progress ${m.search.bestProgress}, best score ${m.search.bestScore}`);
  return bits.join("; ");
}
