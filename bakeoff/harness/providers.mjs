// Model providers behind one interface:
//   provider.chat({ system, messages, maxTokens }) -> { text, usage: { input, output, thinking }, ms, modelVersion, finishReason }
// messages: [{ role: "user" | "assistant", content: string | [{ type: "text", text } | { type: "image", mime, data (base64) }] }]
// Claude and the open-weight provider are not added yet; see handoff/HANDOFF.md for how they must be called.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// $ per million tokens (input, output). Thinking tokens bill as output. Free tiers cost 0.
// Verify before quoting costs; these are from handoff/HANDOFF.md (early October 2026).
export const PRICES = { "claude-sonnet-5-5": [2, 10], "claude-opus-5-5": [4, 20] };
export const costOf = (model, u) => {
  const p = PRICES[model];
  return p ? ((u.input ?? 0) * p[0] + ((u.output ?? 0) + (u.thinking ?? 0)) * p[1]) / 1e6 : 0;
};

export function getProvider(name, model) {
  if (name === "gemini") return gemini(model || process.env.GEMINI_MODEL || "gemini-flash-latest");
  if (name === "mock") return mock();
  throw new Error(`unknown provider "${name}" (have: gemini, mock)`);
}

function gemini(model) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is missing. Put it in .env (see .env.example).");
  const API = "https://generativelanguage.googleapis.com/v1beta";
  const part = (c) => (c.type === "image" ? { inline_data: { mime_type: c.mime, data: c.data } } : { text: c.text });
  return {
    name: "gemini", model, vision: true,
    async chat({ system, messages, maxTokens = 65536 }) {
      const body = {
        system_instruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: (typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content).map(part) })),
        generationConfig: { maxOutputTokens: maxTokens },
      };
      for (let attempt = 1; ; attempt++) {
        const t0 = Date.now();
        const res = await fetch(`${API}/models/${model}:generateContent`, {
          method: "POST", headers: { "x-goog-api-key": key, "content-type": "application/json" }, body: JSON.stringify(body),
        });
        const ms = Date.now() - t0;
        const data = await res.json().catch(() => ({}));
        if ((res.status === 429 || res.status >= 500) && attempt <= 4) {
          // Free-tier rate limits say how long to wait.
          const hint = JSON.stringify(data).match(/"retryDelay":\s*"(\d+)/);
          const wait = Math.min(120, hint ? Number(hint[1]) + 2 : 30 * attempt);
          console.log(`    ${res.status} from Gemini, waiting ${wait}s (retry ${attempt}/4)`);
          await sleep(wait * 1000);
          continue;
        }
        if (!res.ok) throw new Error(`Gemini ${res.status}: ${JSON.stringify(data.error ?? data).slice(0, 500)}`);
        const cand = data.candidates?.[0];
        const text = (cand?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
        const u = data.usageMetadata ?? {};
        return { text, ms, modelVersion: data.modelVersion, finishReason: cand?.finishReason,
          usage: { input: u.promptTokenCount ?? 0, output: u.candidatesTokenCount ?? 0, thinking: u.thoughtsTokenCount ?? 0 } };
      }
    },
  };
}

// Mock: answers with the hand-written examples, so the whole pipeline runs with no keys.
// With MOCK_BUGGY=1 (the default) its first answer has a deliberate bug, so the fix loop is exercised too.
function mock() {
  const pickExample = (type) => ({ survival: "example-game.js", speedrun: "example-maze.js", highscore: "example-word.js" })[type] ?? "example-game.js";
  const BUGS = {
    "example-maze.js": (s) => s.replace("move(player, dx, dy);", "player.x += dx; player.y += dy; // moves without collision"),
    "example-game.js": (s) => s.replace("px = clamp(px, 0, 122);", ""),
    "example-word.js": (s) => s.replace("points += word.length * word.length;", "points += word.length * word.length / (found.length - 1);"),
  };
  const buggy = process.env.MOCK_BUGGY !== "0";
  const answer = (file, broken) => {
    let code = fs.readFileSync(path.join(root, "engine", file), "utf8");
    if (broken) code = BUGS[file](code);
    return `<design>\nMock design for ${file}: see the example's comments.\n</design>\n\n\`\`\`js\n${code}\`\`\``;
  };
  return {
    name: "mock", model: "mock", vision: true,
    async chat({ messages }) {
      const first = typeof messages[0].content === "string" ? messages[0].content : "";
      const last = messages[messages.length - 1], lastText = typeof last.content === "string" ? last.content : last.content.map((c) => c.text ?? "").join("");
      const type = (first.match(/Type: (\w+)/) ?? [])[1];
      const file = pickExample(type);
      let text;
      if (/contact sheet/.test(lastText)) text = JSON.stringify({ readable: 4, brief: 3, polish: 3, bugs: [], summary: "Mock critic: looks fine." });
      else if (/The test harness ran your game/.test(lastText)) text = "<analysis>Mock: restored the correct code.</analysis>\n\n" + answer(file, false).split("\n\n").slice(1).join("\n\n");
      else if (/review your game as a strict senior reviewer/.test(lastText)) text = "<review>no bugs found</review>\n\n" + answer(file, buggy).split("\n\n").slice(1).join("\n\n");
      else text = answer(file, buggy);
      return { text, ms: 1, modelVersion: "mock-1", finishReason: "STOP", usage: { input: 0, output: 0, thinking: 0 } };
    },
  };
}

// Pull the code and the design notes out of a reply.
export function extractCode(text) {
  const blocks = [...text.matchAll(/```(?:js|javascript)?[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const code = blocks.sort((a, b) => b.length - a.length)[0];
  if (code) return code.trim() + "\n";
  return /export\s+default/.test(text) ? text.trim() + "\n" : null;
}
export const extractTag = (text, tag) => (text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)) ?? [])[1]?.trim() ?? null;
