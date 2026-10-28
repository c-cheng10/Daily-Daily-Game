// Checks for generated content, against the game's own requirements:
// - puzzle(): the current puzzle as a search problem ({start, moves, apply, goal, key?, unique?, shortest?, par?, show?}).
//   The harness solves it with the engine's solve(): it must be solvable, have exactly one solution when it says
//   unique, and match its par.
// - level(): the current level as {rows, reqs}. The harness runs checklevel(rows, reqs) itself (reachability, exit
//   distance, counts, open space, the game's own check()), and compares the rows with the map actually loaded.
// Both are checked at the start on every seed, and at each new level while the game's bot plays the first seed.
import { normalizeButtons } from "../engine/engine.js";
import { describeError } from "./sandbox.mjs";
import { jsonOf, MAX_FRAMES } from "./runs.mjs";

export const PUZZLE_LIMIT = 200000; // states; solve() inside the game should use far fewer
const SOLVE_MS = 8000;
const MAX_CHECKS = 6;

export function checkGenerated(G, seeds) {
  const issues = [], stats = { puzzle: [], level: [] };
  const add = (severity, check, message, extra = {}) => issues.push({ severity, check, message, ...extra });
  const hasPuzzle = typeof G.game.puzzle === "function", hasLevel = typeof G.game.level === "function";
  const playbacks = [];

  const checkPuzzle = (eng, where, seed) => {
    let spec;
    try { spec = G.guard(() => G.game.puzzle(), 2000); }
    catch (e) { const d = describeError(e); add("error", "puzzle", `puzzle() threw (${where}): ${d.message}`, { line: d.line }); return false; }
    if (spec === null || spec === undefined) return true; // no puzzle on screen right now (title, between levels)
    const missing = ["moves", "apply", "goal"].filter((k) => typeof spec[k] !== "function");
    if (typeof spec !== "object" || missing.length || spec.start === undefined) {
      add("error", "puzzle", `puzzle() must return {start, moves(s), apply(s, m), goal(s)}${missing.length ? `; missing ${missing.join(", ")}` : ""}${spec?.start === undefined ? "; start is undefined" : ""} (${where})`);
      return false;
    }
    const show = (s) => {
      if (typeof spec.show === "function") { try { return String(G.guard(() => spec.show(s), 1000)); } catch { /* fall back to JSON */ } }
      return jsonOf(s, 400);
    };
    const before = jsonOf(spec.start, 1e6);
    let solved, shortest = null;
    try {
      G.guard(() => {
        if (spec.goal(spec.start)) solved = "already";
        else {
          solved = eng.api.solve(spec, { max: spec.unique ? 2 : 1, limit: PUZZLE_LIMIT });
          if ((spec.shortest || Number.isFinite(spec.par)) && solved.count) shortest = eng.api.solve(spec, { shortest: true, limit: PUZZLE_LIMIT });
        }
      }, SOLVE_MS);
    } catch (e) {
      const d = describeError(e);
      if (d.timeout) add("warn", "puzzle-size", `solving the puzzle took over ${SOLVE_MS / 1000} s (${where}); the search space is too big to check. Prune it: have apply() return null as soon as a move breaks a rule`);
      else add("error", "puzzle", `the puzzle's moves/apply/goal threw while solving (${where}): ${d.message}`, { line: d.line });
      return false;
    }
    if (jsonOf(spec.start, 1e6) !== before) {
      add("error", "puzzle-purity", `apply() changed the state it was given (${where}); copy the state and change the copy (e.g. s.slice() or {...s, grid: s.grid.slice()})`);
      return false;
    }
    if (solved === "already") { add("error", "puzzle", `the puzzle is already solved before the player does anything (${where})`, { detail: show(spec.start) }); return false; }
    stats.puzzle.push({ where, solutions: solved.count, explored: solved.explored, complete: solved.complete, steps: shortest?.steps ?? solved.steps });
    if (!solved.complete) {
      add("warn", "puzzle-size", `the solver gave up after ${PUZZLE_LIMIT} states (${where}), so solvability${spec.unique ? " and uniqueness" : ""} couldn't be checked. Prune the search: have apply() return null as soon as a move breaks a rule`);
      return true;
    }
    if (solved.count === 0) {
      add("error", "puzzle-unsolvable", `the puzzle has no solution (${where}). Generate puzzles with makepuzzle() and accept only ones solve() can solve`, { detail: `start:\n${show(spec.start)}` });
      return false;
    }
    if (spec.unique && solved.count > 1) {
      add("error", "puzzle-unique", `the puzzle has more than one solution (${where}), so the player can't deduce the answer. Accept only puzzles where solve(p).count === 1 (add givens/clues until it is)`,
        { detail: `start:\n${show(spec.start)}\nsolution 1:\n${show(solved.solutions[0])}\nsolution 2:\n${show(solved.solutions[1])}` });
    }
    if (Number.isFinite(spec.par) && Number.isFinite(shortest?.steps) && spec.par !== shortest.steps) {
      add("error", "puzzle-par", `par is ${spec.par} but the shortest solution takes ${shortest.steps} moves (${where}): ${jsonOf(shortest.path, 300)}`);
    }
    if (Number.isFinite(shortest?.steps) && shortest.steps <= 2) add("warn", "puzzle-easy", `the puzzle can be solved in ${shortest.steps} move(s) (${where})`);
    // Played later: the game's module state is shared, so playing now would disturb the run being followed.
    if (typeof spec.buttons === "function" && seed !== undefined) playbacks.push([seed, (shortest ?? solved).path, where]);
    return true;
  };

  // The solver must follow the game's real rules: play its solution through update() with the buttons the spec
  // says each move takes, from a fresh start, and check that the game counts the puzzle as solved.
  const playSolution = (seed, path, where) => {
    const prev = G.holder.eng; // the caller keeps using its engine afterwards
    const eng = G.newEngine(seed);
    let result;
    try {
      result = G.guard(() => {
        eng.start(G.game);
        const level0 = G.game.probe()?.level;
        const solvedNow = () => eng.state.finished || G.game.probe()?.level !== level0;
        let frames = 0;
        for (const [n, m] of path.entries()) {
          const spec = G.game.puzzle();
          if (!spec || solvedNow()) return { ok: solvedNow(), at: n };
          let seq = spec.buttons(m);
          seq = Array.isArray(seq) ? seq : [seq];
          for (const b of seq) { eng.tick(G.game, normalizeButtons(b), { draw: false }); eng.tick(G.game, "", { draw: false }); frames += 2; }
          for (let i = 0; i < (spec.wait ?? 0); i++) eng.tick(G.game, "", { draw: false });
          if (frames > MAX_FRAMES) return { ok: false, at: n, probe: jsonOf(G.game.probe(), 400) };
        }
        for (let i = 0; i < 60 && !solvedNow(); i++) eng.tick(G.game, "", { draw: false });
        return { ok: solvedNow(), at: path.length, probe: jsonOf(G.game.probe(), 400) };
      }, 10000);
    } catch (e) { const d = describeError(e); add("error", "puzzle-rules", `playing the solver's solution through the game crashed (${where}): ${d.message}`, { line: d.line }); return; }
    finally { G.holder.eng = prev; }
    if (!result.ok) {
      add("error", "puzzle-rules", `the solver's solution doesn't solve the real game (${where}): after pressing buttons() for ${result.at} of ${path.length} moves the game didn't advance a level or finish. The solver's rules differ from update(): make apply() call the same rule function update() uses`,
        { detail: `solution moves: ${jsonOf(path, 300)}\nprobe after: ${result.probe}` });
    }
  };

  const checkLevel = (eng, where) => {
    let spec;
    try { spec = G.guard(() => G.game.level(), 2000); }
    catch (e) { const d = describeError(e); add("error", "level", `level() threw (${where}): ${d.message}`, { line: d.line }); return false; }
    if (spec === null || spec === undefined) return true;
    if (typeof spec !== "object" || !Array.isArray(spec.rows) || !spec.rows.every((r) => typeof r === "string")) {
      add("error", "level", `level() must return {rows: [strings], reqs: {...}} (${where}), got ${jsonOf(spec, 200)}`);
      return false;
    }
    const reqs = spec.reqs && typeof spec.reqs === "object" ? spec.reqs : {};
    if (!spec.reqs || !Object.keys(reqs).length) add("warn", "level", `level() has no reqs (${where}); declare what every generated level must satisfy (start, reach, exit, minPath, count...)`);
    let r;
    try { r = G.guard(() => eng.api.checklevel(spec.rows, reqs), 4000); }
    catch (e) { const d = describeError(e); add("error", "level", `checking the level failed (${where}): ${d.message}`, { line: d.line }); return false; }
    stats.level.push({ where, ok: r.ok, ...r.stats });
    if (!r.ok) {
      add("error", "level-reqs", `the level breaks its own requirements (${where}): ${r.problems.join("; ")}. Generate levels with makelevel(make, reqs) so only passing levels are used`,
        { detail: `level:\n${spec.rows.join("\n")}` });
      return false;
    }
    // The described level should be the one that is actually loaded (same size and walls).
    const map = eng.getMap();
    if (map) {
      const solidAt = (rows, x, y) => map.solid.has(rows[y]?.[x] ?? "#");
      const loaded = map.rows.map((q) => q.join(""));
      const same = map.h === spec.rows.length && map.w === Math.max(...spec.rows.map((x) => x.length))
        && map.rows.every((row, y) => row.every((_, x) => solidAt(loaded, x, y) === solidAt(spec.rows, x, y)));
      if (!same) add("warn", "level-mismatch", `level() describes a different map from the one loaded with mload() (${where}); return the rows you loaded, so the checks test the real level`);
    }
    return true;
  };

  const checkBoth = (eng, where, seed) => (hasPuzzle ? checkPuzzle(eng, where, seed) : true) && (hasLevel ? checkLevel(eng, where) : true);

  for (const seed of seeds) {
    const eng = G.newEngine(seed);
    try { G.guard(() => eng.start(G.game), 3000); } catch { continue; } // init crashes are reported elsewhere
    const ok = checkBoth(eng, `seed ${seed}, start`, seed);
    if (seed !== seeds[0] || !ok || typeof G.game.bot !== "function" || typeof G.game.probe !== "function") continue;
    // Follow the bot through the levels of the first seed and check each new one.
    let f = 0, level, checks = 1;
    try {
      level = G.guard(() => G.game.probe()?.level, 1000);
      while (checks < MAX_CHECKS && f < MAX_FRAMES) {
        const changed = G.guard(() => {
          while (f < MAX_FRAMES) {
            eng.tick(G.game, normalizeButtons(G.game.bot(G.game.probe(), f)), { draw: false });
            f++;
            if (eng.state.finished) return false;
            const l = G.game.probe()?.level;
            if (l !== level) { level = l; return true; }
          }
          return false;
        }, 10000);
        if (!changed) break;
        checks++;
        if (!checkBoth(eng, `seed ${seed}, level ${level} (frame ${f})`)) break;
      }
    } catch { /* bot crashes and timeouts are reported by the bot stage */ }
  }
  for (const [seed, path, where] of playbacks) playSolution(seed, path, where);
  return { issues, stats };
}
