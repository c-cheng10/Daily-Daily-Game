// Every prompt the harness sends. All models get exactly the same text.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const EXAMPLES = ["engine/example-game.js", "engine/example-maze.js", "engine/example-word.js"];

const CHECKLIST = `- Collision: use move() / boxhit() / overlap() from the engine. Never write your own tile-collision loop.
- Every level can be completed. The player can never leave the map, pass through walls, or get stuck forever (no softlocks). Trace the route on every map.
- init() resets every variable, including maps changed with mset() and arrays you mutate.
- No NaN: guard divisions, clamp indexes, initialise every field.
- Text fits: at most 32 characters per line, nothing printed off screen, readable against its background (use printc/textw).
- The first 5 seconds show what to do (a short hint), and the game starts at a fair difficulty that ramps up.
- An idle player must not win or score well. Survival: an idle player dies. Speedrun: a good player finishes in 20-90 s. Highscore/survival rounds end within about 2 minutes for most players.
- finish() is called exactly when the run ends, and the end screen shows the result.
- draw() only draws. All game logic lives in update().
- btnp() for one-shot actions (jump, shoot, menu choice, typing a letter); btn() for held movement.
- probe() is cheap and JSON-safe and reports progress honestly; bot() plays well and never changes game state; tests cover the risks you listed.
- No placeholders, TODOs or unfinished features. The whole file, every time.`;

export function systemPrompt() {
  return `You are an expert game designer and JavaScript engineer. Each request asks you for one small, complete, polished game for a PICO-8-style fantasy console. Real players get one new game per day; it is judged on, in order: no bugs, matching the brief, fun.

An automated harness will test your game before anyone plays it: it runs your self-tests, your bot, its own random and search bots, checks invariants every frame (for example "the player never overlaps a solid tile" and "every goal is reachable"), checks determinism, and looks at screenshots.

# How to answer

1. Think the game through first. Then write a <design> block (about 150-300 words) with:
   - concept: one sentence; how the theme and the mechanic show up on screen
   - controls: every button you use and what it does
   - goal and end: how the player wins or loses, and exactly when finish() is called
   - scoring: the exact formula (for speedrun: what the timer measures)
   - difficulty: what a new player sees in the first 5 seconds, and how it ramps over about 2 minutes
   - layout check: if there are levels or maps, trace the route from the start to every goal, tile by tile, and confirm nothing (walls, hazards, closed doors) blocks it
   - probe and bot: the probe() fields, and the bot's strategy
   - risks: the 3 parts most likely to be buggy, and how the code and the tests guard against them
2. Then write the complete game in one \`\`\`js code block.
3. Write nothing after the code block.

# Quality checklist (check every item before you answer)

${CHECKLIST}

# The engine

${read("engine/engine-api.md")}

# Example games

These follow the contract exactly. They show the style, not the content: your game should be different and more interesting.

${EXAMPLES.map((f) => "```js\n" + read(f).trim() + "\n```").join("\n\n")}`;
}

export function briefPrompt(b) {
  return `Write today's game.

Type: ${b.type}
${b.genre ? `Genre: ${b.genre}\n` : ""}Theme: ${b.theme}
Core mechanic: ${b.mechanic}

Make it playable in under 2 minutes, readable at 128x128, and fun. Show the score or timer on screen and a clear end screen.`;
}

// Self-review before any testing (Self-Refine style): the model checks its own work against the checklist.
export const REVIEW_PROMPT = `Before the harness tests it, review your game as a strict senior reviewer who has to sign off on it.

Simulate it in your head, step by step:
1. init(), then frame 0: is every variable set? What is on screen?
2. The first 3 seconds holding each direction, and holding every direction into every wall and screen edge.
3. Each way the run can end: is finish() called, is the end screen right, does draw() still work after finish()?
4. init() called a second time after a full game: is everything reset?
5. Your bot playing a whole run, and each of your tests: would they pass? Are your probe() fields right?

Then go through the quality checklist item by item.

Answer with a <review> block that lists each REAL bug you found (where it is and how you fix it), or "no bugs found". Ignore style. Then return the COMPLETE corrected file in one \`\`\`js block (the same file if nothing was wrong). Keep the design; don't add features.`;

// Execution feedback: concrete failures with a replay, asking for root causes (Self-Debugging / SWE-agent style).
export function fixPrompt(feedbackText, { attempt, maxAttempts, history = [] }) {
  const past = history.filter((h) => h.after).map((h) =>
    `- Fix ${h.attempt}: you said "${(h.analysis ?? "(no analysis)").replace(/\s+/g, " ").slice(0, 400)}". Result: ${h.before.errors} errors -> ${h.after.errors} errors${h.after.kept ? "" : " (worse or no better, so that version was thrown away; the code below is the best version so far)"}.`);
  return `The test harness ran your game (attempt ${attempt} of ${maxAttempts}). It found these problems, most serious first:

${feedbackText}
${past.length ? `\nEarlier fixes (problems marked STILL FAILING survived them, so that approach didn't work; think again about the cause):\n${past.join("\n")}\n` : ""}

How to fix them:
- For each problem, find the ROOT CAUSE in the code. The replay (seed, frame, buttons, probe) shows exactly what happened; walk through what the code does on that frame.
- Fix the cause, not the symptom. Never weaken a check, hide state from probe(), special-case the test, or make the bot cheat.
- If a check is about the game design (for example "an idle player never dies"), change the design so the check passes for a real player.
- Don't break what already works.

Answer with an <analysis> block: one short paragraph per problem, "cause -> fix". Then return the COMPLETE corrected file in one \`\`\`js block.`;
}

export function criticPrompt({ brief, design, stats }) {
  return `You are reviewing a small 128x128 game for a daily game website before it is published.

The image is a contact sheet: frames from one playthrough by a bot, in order left to right, top to bottom. The last frame is the end screen.

Brief: ${brief.type} game. Theme: ${brief.theme}. Core mechanic: ${brief.mechanic}.${brief.genre ? ` Genre: ${brief.genre}.` : ""}
The author's design notes: ${design ? design.slice(0, 1500) : "(none)"}
Harness stats: ${stats}

Rate from 1 (bad) to 5 (excellent):
- readable: can you tell what everything is? Is the text legible and inside the screen?
- brief: do the theme and the mechanic clearly show?
- polish: does it look finished and intentional?
List visible bugs only (text cut off or overlapping, things inside walls, an empty or broken screen, a missing end screen, a HUD that covers the action). Don't guess about things you can't see.

Reply with JSON only, no code fence: {"readable": n, "brief": n, "polish": n, "bugs": ["..."], "summary": "one sentence"}`;
}
