// Runs evaluateSource() in a worker thread with a memory cap and a hard time limit, so a game that
// hangs or eats memory can't take the harness down. Streams progress so a timeout still says where it hung.
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";

const WORKER = fileURLToPath(new URL("./evaluate-worker.mjs", import.meta.url));

export function evaluate(src, { brief, timeoutMs = 120000, exploreMs = 8000 } = {}) {
  return new Promise((resolve) => {
    const w = new Worker(WORKER, { workerData: { src, brief, exploreMs }, resourceLimits: { maxOldGenerationSizeMb: 512 } });
    let lastStage = "start", partial = [], done = false;
    const end = (report) => { if (!done) { done = true; clearTimeout(timer); w.terminate(); resolve(report); } };
    const fail = (message) => end({
      pass: false, errors: 1, warnings: 0, metrics: {}, tests: [], snaps: [], stagesDone: [],
      issues: [{ severity: "error", check: "timeout", message }, ...partial],
    });
    const timer = setTimeout(() => fail(`the evaluation took over ${timeoutMs / 1000} s and was stopped during "${lastStage}"; something in the game is extremely slow or never ends`), timeoutMs);
    w.on("message", (m) => {
      if (m.kind === "progress") { lastStage = m.stage; partial = m.issues; }
      else if (m.kind === "done") end(m.report);
    });
    w.on("error", (e) => fail(`the evaluation crashed during "${lastStage}": ${e.message}${/memory/i.test(e.message) ? " (the game used too much memory)" : ""}`));
    w.on("exit", (code) => { if (!done) fail(`the evaluation stopped unexpectedly during "${lastStage}" (exit ${code})`); });
  });
}
