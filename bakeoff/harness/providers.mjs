// Model providers behind one interface:
//   provider.chat({ system, messages, maxTokens }) -> { text, usage: { input, output, thinking }, ms, modelVersion, finishReason }
// messages: [{ role: "user" | "assistant", content: string | [{ type: "text", text } | { type: "image", mime, data (base64) }] }]
// usage: input = uncached input tokens; cacheWrite / cacheRead = prompt-cache tokens (Claude only).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// $ per million tokens: input, output, cache read. Cache writes (5-minute) cost 1.25x input.
// Thinking tokens bill as output. Free tiers cost 0. Verify before quoting costs (October 2026 prices).
export const PRICES = { "claude-sonnet-5-5": [2, 10, 0.2], "claude-opus-5-5": [4, 20, 0.2] };
export const costOf = (model, u) => {
  const p = PRICES[model];
  if (!p) return 0;
  return ((u.input ?? 0) * p[0] + (u.cacheWrite ?? 0) * p[0] * 1.25 + (u.cacheRead ?? 0) * p[2] + ((u.output ?? 0) + (u.thinking ?? 0)) * p[1]) / 1e6;
};

export const PROVIDERS = ["claude", "gemini", "openrouter", "groq", "mock"];
export function getProvider(name, model) {
  if (name === "claude") return claude(model || process.env.BAKEOFF_CLAUDE_MODEL || "claude-sonnet-5-5");
  if (name === "gemini") return gemini(model || process.env.GEMINI_MODEL || "gemini-flash-latest");
  if (name === "openrouter") return openaiCompatible("openrouter", "https://openrouter.ai/api/v1", "OPENROUTER_API_KEY", model || process.env.OPENROUTER_MODEL);
  if (name === "groq") return openaiCompatible("groq", "https://api.groq.com/openai/v1", "GROQ_API_KEY", model || process.env.GROQ_MODEL);
  if (name === "mock") return mock();
  throw new Error(`unknown provider "${name}" (have: ${PROVIDERS.join(", ")})`);
}

// Claude through the official SDK. Streaming + finalMessage() so a long game never hits an HTTP timeout.
// The system prompt is identical on every call, so it is cached (cache reads cost a fraction of input).
// fallbacks: "default" re-runs a request the safety classifiers decline on Anthropic's recommended model.
function claude(model) {
  const client = new Anthropic({ maxRetries: 4 });
  // Opus 5.5 defaults to medium, so set it explicitly. (Own variable name: CLAUDE_* may already be set by tools.)
  const effort = process.env.BAKEOFF_CLAUDE_EFFORT || "high";
  const block = (c) => (c.type === "image"
    ? { type: "image", source: { type: "base64", media_type: c.mime, data: c.data } }
    : { type: "text", text: c.text });
  return {
    name: "claude", model, vision: true,
    async chat({ system, messages, maxTokens = 64000 }) {
      const t0 = Date.now();
      const stream = client.beta.messages.stream({
        model,
        max_tokens: maxTokens,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort },
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: messages.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : m.content.map(block) })),
      });
      const msg = await stream.finalMessage();
      const ms = Date.now() - t0;
      if (msg.stop_reason === "refusal") {
        const d = msg.stop_details;
        throw new Error(`Claude declined the request (category: ${d?.category ?? "unknown"}${d?.explanation ? `: ${d.explanation}` : ""})`);
      }
      const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      const u = msg.usage;
      const fellBack = (u.iterations ?? []).some((e) => e.type === "fallback_message");
      return { text, ms, modelVersion: fellBack ? `${msg.model} (fallback from ${model})` : msg.model, finishReason: msg.stop_reason,
        truncated: msg.stop_reason === "max_tokens",
        usage: { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, thinking: 0, cacheWrite: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0 } };
    },
  };
}

// OpenRouter and Groq both document an OpenAI-style chat completions endpoint; this calls it directly.
// Pick a model that is free today on that service and record the exact ID (the harness saves it per game).
function openaiCompatible(name, base, keyVar, model) {
  const key = process.env[keyVar];
  if (!key) throw new Error(`${keyVar} is missing. Put it in .env (see .env.example).`);
  if (!model) throw new Error(`no model given for ${name}: pass --model <id> or set ${name.toUpperCase()}_MODEL in .env`);
  const vision = process.env.OPEN_MODEL_VISION === "1";
  const part = (c) => (c.type === "image" ? { type: "image_url", image_url: { url: `data:${c.mime};base64,${c.data}` } } : { type: "text", text: c.text });
  return {
    name, model, vision,
    async chat({ system, messages, maxTokens = 32000 }) {
      const body = { model, max_tokens: maxTokens,
        messages: [{ role: "system", content: system }, ...messages.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : m.content.map(part) }))] };
      for (let attempt = 1; ; attempt++) {
        const t0 = Date.now();
        const res = await fetch(`${base}/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) });
        const ms = Date.now() - t0;
        const data = await res.json().catch(() => ({}));
        if ((res.status === 429 || res.status >= 500) && attempt <= 4) {
          const wait = Math.min(120, Number(res.headers.get("retry-after")) || 30 * attempt);
          console.log(`    ${res.status} from ${name}, waiting ${wait}s (retry ${attempt}/4)`);
          await sleep(wait * 1000);
          continue;
        }
        if (!res.ok) throw new Error(`${name} ${res.status}: ${JSON.stringify(data.error ?? data).slice(0, 500)}`);
        const choice = data.choices?.[0];
        const u = data.usage ?? {};
        return { text: choice?.message?.content ?? "", ms, modelVersion: data.model ?? model, finishReason: choice?.finish_reason,
          truncated: choice?.finish_reason === "length",
          usage: { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0, thinking: 0 } };
      }
    },
  };
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
        return { text, ms, modelVersion: data.modelVersion, finishReason: cand?.finishReason, truncated: cand?.finishReason === "MAX_TOKENS",
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
      else if (/The test harness ran your game/.test(lastText)) {
        // MOCK_STUBBORN=1: the first fix doesn't work, to exercise the fix loop's memory of earlier attempts.
        const stubborn = process.env.MOCK_STUBBORN === "1" && !/Earlier fixes/.test(lastText);
        text = `<analysis>Mock: ${stubborn ? "tweaked something unrelated" : "restored the correct code"}.</analysis>\n\n` + answer(file, stubborn).split("\n\n").slice(1).join("\n\n");
      }
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
  const open = text.match(/```(?:js|javascript)[^\n]*\n([\s\S]*)$/); // a reply cut off before the closing fence
  if (open) return open[1].trim() + "\n";
  return /export\s+default/.test(text) ? text.trim() + "\n" : null;
}
export const extractTag = (text, tag) => (text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)) ?? [])[1]?.trim() ?? null;
