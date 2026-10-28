// Server-side replay: re-run a game from seed + per-frame inputs and compute the result ourselves.
// The client's claimed score is never trusted.
import vm from "node:vm";
import { createEngine } from "../public/engine.js";
import { unpackButtons } from "../public/seed.js";

const TIMEOUT_MS = 10000;

export function replay(src, seed, inputs) {
  const eng = createEngine(seed);
  const ctx = vm.createContext({ ...eng.api });
  vm.runInContext("Math.random = () => { throw new Error('Math.random is banned'); }; globalThis.Date = undefined;", ctx);
  vm.runInContext(src.replace(/export\s+default/, "globalThis.__game ="), ctx, { timeout: TIMEOUT_MS, filename: "game.js" });
  const game = ctx.__game;
  if (!game || typeof game.update !== "function") throw new Error("game failed to load");

  ctx.__start = () => eng.start(game);
  ctx.__tick = (i) => eng.tick(game, unpackButtons(inputs[i]));
  ctx.__done = () => eng.state.finished;
  ctx.__n = inputs.length;
  vm.runInContext("__start(); for (let i = 0; i < __n && !__done(); i++) __tick(i);", ctx, { timeout: TIMEOUT_MS });

  return {
    type: game.type,
    finished: eng.state.finished,
    frames: eng.state.frame,
    // Stored value: frames to finish for speedruns (exact integer), score otherwise.
    value: game.type === "speedrun" ? eng.state.finishFrame : eng.state.score,
  };
}
