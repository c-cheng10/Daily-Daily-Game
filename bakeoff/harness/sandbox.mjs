// Loads one game into an isolated vm context. Engine functions are globals that forward to the
// current engine instance, so many runs (fresh engines) can share one compiled game.
// This isolates globals and stops runaway loops; it is NOT a security boundary (use a separate
// process or isolated-vm in production). The whole evaluation also runs in a worker with a hard kill.
import vm from "node:vm";
import { createEngine } from "../engine/engine.js";
import { WORDS } from "../engine/words.js";
import { CATEGORIES } from "../engine/categories.js";
import { BIG_CATEGORIES } from "../engine/categories-big.js";
import { isBlocked } from "./blocklist.mjs";

export const API_NAMES = Object.keys(createEngine(0).api);

export function loadGame(src, { timeoutMs = 3000 } = {}) {
  const holder = { eng: null };
  const sandbox = { console: { log() {}, warn() {}, error() {}, info() {} } };
  for (const k of API_NAMES) sandbox[k] = (...a) => holder.eng.api[k](...a);
  const ctx = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(
    "Math.random = () => { throw new Error('Math.random is not allowed; use rnd()'); };" +
    "globalThis.Date = undefined; globalThis.WebAssembly = undefined;", ctx);
  // Keep line numbers: the replacement stays on the same line.
  const code = src.replace(/export\s+default/, "globalThis.__game =");
  new vm.Script(code, { filename: "game.js" }).runInContext(ctx, { timeout: timeoutMs });
  const game = ctx.__game;

  // Run fn with a hard time limit. The limit also covers host code called from the game, since it all
  // runs on this isolate.
  const guard = (fn, ms) => {
    ctx.__host = fn;
    try { return vm.runInContext("__host()", ctx, { timeout: ms }); } finally { ctx.__host = null; }
  };

  const newEngine = (seed) => (holder.eng = createEngine(seed, { words: WORDS, categories: CATEGORIES, bigCategories: BIG_CATEGORIES, blocked: isBlocked }));
  return { game, ctx, guard, newEngine, holder };
}

// Turn anything thrown inside the sandbox into { message, line }.
export function describeError(e) {
  const message = String(e?.message ?? e).split("\n")[0];
  const m = String(e?.stack ?? "").match(/game\.js:(\d+)/);
  const timeout = /Script execution timed out/.test(message);
  return { message: timeout ? "the game took too long (infinite loop or very slow code)" : message, line: m ? Number(m[1]) : undefined, timeout };
}
