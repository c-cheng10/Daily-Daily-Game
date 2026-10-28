import { parentPort, workerData } from "node:worker_threads";
import { evaluateSource } from "./evaluate-core.mjs";

const { src, brief, exploreMs } = workerData;
const report = evaluateSource(src, {
  brief, exploreMs,
  progress: (stage, issues) => parentPort.postMessage({ kind: "progress", stage, issues: issues.slice(0, 20) }),
});
parentPort.postMessage({ kind: "done", report });
