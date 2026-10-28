// Words no daily game may show: the LDNOOBW list (npm naughty-words, CC-BY-4.0) plus
// bakeoff/engine/blocklist-extra.txt (one word per line, optional). Used by build-words.mjs to filter the
// word lists, and by the harness to check game text. The list stays on the build/test side; the browser never gets it.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const extraFile = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "engine", "blocklist-extra.txt");
const extra = fs.existsSync(extraFile) ? fs.readFileSync(extraFile, "utf8").split(/\r?\n/) : [];

export const BLOCKED = new Set([...require("naughty-words").en, ...extra]
  .map((w) => w.trim().toUpperCase()).filter((w) => /^[A-Z]{3,}$/.test(w)));

const SUFFIXES = ["", "S", "ES", "ED", "ER", "ERS", "ING", "Y", "IES"];
// A blocked word or a simple inflection of one. Inflections only count for roots of 4+ letters, so short roots
// don't block unrelated longer words.
export function isBlocked(word) {
  const w = String(word).toUpperCase();
  if (BLOCKED.has(w)) return true;
  for (const s of SUFFIXES) {
    if (!s || !w.endsWith(s)) continue;
    const root = w.slice(0, -s.length);
    if (root.length >= 4 && (BLOCKED.has(root) || BLOCKED.has(root + "E"))) return true;
  }
  return false;
}

// Blocked words inside a piece of text (split on anything that isn't a letter).
export const blockedIn = (text) => [...new Set(String(text).toUpperCase().split(/[^A-Z]+/).filter((t) => t && isBlocked(t)))];
