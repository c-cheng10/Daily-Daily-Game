// Generate games with Gemini (free tier). No dependencies; needs GEMINI_API_KEY in .env.
//   npm run gen -- --models        list models your key can use
//   npm run gen -- b01 b03         generate those briefs (default: all)
//   npm run gen -- b01 --force     regenerate even if the output exists
// Model: GEMINI_MODEL in .env, default "gemini-flash-latest".
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const API = "https://generativelanguage.googleapis.com/v1beta";
const key = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || "gemini-flash-latest";

if (!key) {
  console.error("GEMINI_API_KEY is missing. Paste your key into .env (see .env.example).");
  process.exit(1);
}

const args = process.argv.slice(2);

if (args.includes("--models")) {
  const res = await fetch(`${API}/models?pageSize=1000`, { headers: { "x-goog-api-key": key } });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  for (const m of data.models.filter((m) => m.supportedGenerationMethods?.includes("generateContent"))) {
    console.log(m.name.replace("models/", "").padEnd(40), m.displayName);
  }
  process.exit(0);
}

const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const SYSTEM = `You write small, fun, complete games for a PICO-8-style fantasy console.

Return ONLY the JavaScript file, nothing else. Use only the API described below. No network, no eval, no Math.random, no Date.

${read("engine/engine-api.md")}

## Example game (follows the contract exactly)

\`\`\`js
${read("engine/example-game.js")}
\`\`\``;

const userPrompt = (b) => `Write today's game.

Type: ${b.type}
Theme: ${b.theme}
Core mechanic: ${b.mechanic}

Make it playable in under 2 minutes, readable at 128x128, and fun. Show the score or timer on screen and a clear end screen.`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One provider, one function: brief -> { code, raw, usage, ms, modelVersion }
async function generateGame(brief, model) {
  const body = {
    system_instruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: "user", parts: [{ text: userPrompt(brief) }] }],
  };
  for (let attempt = 1; ; attempt++) {
    const t0 = Date.now();
    const res = await fetch(`${API}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const ms = Date.now() - t0;
    const data = await res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      console.log(`  ${res.status}, waiting 30s and retrying (${attempt}/3)`);
      await sleep(30000);
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(data.error ?? data)}`);

    const cand = data.candidates?.[0];
    const raw = (cand?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
    return { code: extractCode(raw), raw, finishReason: cand?.finishReason, usage: data.usageMetadata, ms, modelVersion: data.modelVersion };
  }
}

// Take the longest fenced code block if there is one, else the whole reply.
function extractCode(text) {
  const blocks = [...text.matchAll(/```[a-zA-Z]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  return (blocks.sort((a, b) => b.length - a.length)[0] ?? text).trim() + "\n";
}

const briefs = JSON.parse(read("briefs.json"));
const ids = args.filter((a) => !a.startsWith("--"));
const force = args.includes("--force");
const todo = ids.length ? briefs.filter((b) => ids.includes(b.id)) : briefs;
const outDir = path.join(root, "out", model);
fs.mkdirSync(outDir, { recursive: true });

console.log(`Model: ${model}, ${todo.length} brief(s)`);
for (const b of todo) {
  const file = path.join(outDir, `${b.id}.js`);
  if (fs.existsSync(file) && !force) { console.log(`${b.id}: exists, skipping`); continue; }
  process.stdout.write(`${b.id} (${b.type}, ${b.theme}): `);
  try {
    const r = await generateGame(b, model);
    fs.writeFileSync(file, r.code);
    fs.writeFileSync(path.join(outDir, `${b.id}.json`), JSON.stringify({
      brief: b, model, modelVersion: r.modelVersion, date: new Date().toISOString(),
      ms: r.ms, finishReason: r.finishReason, usage: r.usage, raw: r.raw,
    }, null, 2));
    console.log(`ok, ${(r.ms / 1000).toFixed(1)}s, ${r.usage?.candidatesTokenCount ?? "?"} out tokens, ${r.modelVersion}`);
  } catch (e) {
    console.log(`FAILED: ${e.message}`);
  }
}
