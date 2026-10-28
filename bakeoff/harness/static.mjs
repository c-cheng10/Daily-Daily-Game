// Static checks on a game's source, before anything runs: parse errors, banned APIs, unknown globals, module shape.
import * as acorn from "acorn";
import * as walk from "acorn-walk";

export const MAX_BYTES = 60000;

// Not available, or not deterministic across browsers/servers.
const BANNED_GLOBALS = {
  Date: "no wall clock; use frame()", performance: "no wall clock; use frame()",
  setTimeout: "no timers; use frame()", setInterval: "no timers; use frame()", requestAnimationFrame: "the engine drives frames",
  fetch: "no network", XMLHttpRequest: "no network", WebSocket: "no network",
  eval: "no eval", Function: "no Function()", globalThis: "no global access", window: "no DOM", self: "no DOM",
  document: "no DOM", localStorage: "no storage", process: "not available", require: "no modules", Worker: "not available",
};
const MATH_BANNED = new Set(["random", "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh",
  "asinh", "acosh", "atanh", "exp", "expm1", "log", "log2", "log10", "log1p", "pow", "hypot", "cbrt"]);

const JS_GLOBALS = new Set(["Math", "Number", "String", "Array", "Object", "JSON", "Boolean", "Symbol", "Map", "Set",
  "WeakMap", "WeakSet", "Infinity", "NaN", "undefined", "parseInt", "parseFloat", "isNaN", "isFinite", "Error",
  "TypeError", "RangeError", "Uint8Array", "Int8Array", "Uint16Array", "Int16Array", "Uint32Array", "Int32Array",
  "Float32Array", "Float64Array", "Uint8ClampedArray", "BigInt", "Reflect", "Proxy", "console", "arguments"]);

const lineOf = (src, n) => src.split("\n")[n - 1] ?? "";

// apiNames: the engine's global function names.
export function staticCheck(src, apiNames) {
  const issues = [];
  const add = (severity, check, message, line) => issues.push({ severity, check, message, ...(line ? { line } : {}) });

  if (src.length > MAX_BYTES) add("error", "size", `file is ${src.length} bytes; the limit is ${MAX_BYTES}`);

  let ast;
  try {
    ast = acorn.parse(src, { ecmaVersion: "latest", sourceType: "module", locations: true });
  } catch (e) {
    add("error", "syntax", `syntax error: ${e.message.replace(/\s*\(\d+:\d+\)$/, "")}`, e.loc?.line);
    return { issues, ok: false };
  }

  const api = new Set(apiNames);
  const declared = new Set(), refs = [];
  let defaults = 0, usesMload = false, mapLike = 0;
  // Names bound by a declaration, a parameter, or a catch clause (not plain assignments, so `typo = 1` is caught).
  const bind = (p) => {
    if (!p) return;
    if (p.type === "Identifier") declared.add(p.name);
    else if (p.type === "ObjectPattern") p.properties.forEach((q) => bind(q.type === "RestElement" ? q.argument : q.value));
    else if (p.type === "ArrayPattern") p.elements.forEach(bind);
    else if (p.type === "RestElement") bind(p.argument);
    else if (p.type === "AssignmentPattern") bind(p.left);
  };

  walk.full(ast, (node, _st, type) => {
    if (type === "VariableDeclarator") bind(node.id);
    else if (/Function/.test(type) && node.params) { bind(node.id); node.params.forEach(bind); }
    else if (type === "ClassDeclaration" || type === "ClassExpression") bind(node.id);
    else if (type === "CatchClause") bind(node.param);
    if (type === "Identifier" || type === "VariablePattern") refs.push(node);
    if (type === "ImportDeclaration" || type === "ImportExpression") add("error", "banned", "imports are not allowed", node.loc.start.line);
    else if (type === "ExportNamedDeclaration" || type === "ExportAllDeclaration") add("error", "shape", "only `export default` is allowed", node.loc.start.line);
    else if (type === "ExportDefaultDeclaration") defaults++;
    else if (type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "mload") usesMload = true;
    else if (type === "ArrayExpression" && node.elements.length >= 6 && node.elements.every((e) => e?.type === "Literal" && typeof e.value === "string" && e.value.length >= 8)) mapLike = node.loc.start.line;
    else if (type === "MemberExpression" && node.object.type === "Identifier" && node.object.name === "Math") {
      const prop = node.computed ? node.property.value : node.property.name;
      if (MATH_BANNED.has(prop)) {
        const alt = prop === "random" ? "use rnd()" : ["sin", "cos", "atan2"].includes(prop) ? `use the engine's ${prop}()` : "not deterministic across devices; avoid it or use the engine's sin/cos/atan2/sqrt";
        add("error", "banned", `Math.${prop}: ${alt}`, node.loc.start.line);
      }
    } else if (type === "BinaryExpression" && node.operator === "**") {
      const r = node.right;
      if (!(r.type === "Literal" && Number.isInteger(r.value) && r.value >= 0 && r.value <= 4)) {
        add("warn", "determinism", "`**` with a non-integer or variable exponent may differ between devices; use multiplication", node.loc.start.line);
      }
    }
  });

  if (defaults !== 1) add("error", "shape", defaults ? "more than one `export default`" : "missing `export default { ... }`");

  const seen = new Set();
  for (const r of refs) {
    if (declared.has(r.name) || seen.has(r.name)) continue;
    if (BANNED_GLOBALS[r.name]) { seen.add(r.name); add("error", "banned", `${r.name}: ${BANNED_GLOBALS[r.name]}`, r.loc.start.line); }
    else if (!api.has(r.name) && !JS_GLOBALS.has(r.name)) { seen.add(r.name); add("error", "unknown-global", `\`${r.name}\` is not defined anywhere (typo, missing variable, or an API the engine doesn't have)`, r.loc.start.line); }
  }

  if (mapLike && !usesMload) add("warn", "own-collision", "this looks like a tile map, but it isn't loaded with mload(); use mload() and move() so walls work and the harness can check them", mapLike);

  // Cheap hints from the source text.
  if (/\b(TODO|FIXME|placeholder)\b/i.test(src)) add("warn", "unfinished", "the code mentions TODO/FIXME/placeholder");

  return { issues, ok: !issues.some((i) => i.severity === "error"), lines: src.split("\n").length };
}

export const codeAround = (src, line, pad = 2) => {
  if (!line) return "";
  const out = [];
  for (let n = Math.max(1, line - pad); n <= line + pad; n++) {
    const l = lineOf(src, n);
    if (n > 1 && !l && n > line) break;
    out.push(`${n === line ? ">" : " "}${String(n).padStart(4)} | ${l}`);
  }
  return out.join("\n");
};
