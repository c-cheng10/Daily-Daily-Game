// Create the local test accounts listed in site/seed/test-accounts.json (skips ones that exist).
//   node site/seed.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as users from "./lib/users.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
users.init(path.join(root, "data"));

for (const a of JSON.parse(fs.readFileSync(path.join(root, "seed/test-accounts.json"), "utf8"))) {
  try {
    users.signup(a.email, a.username, a.password);
    console.log(`created ${a.email} (@${a.username})`);
  } catch (e) {
    console.log(`skipped ${a.email}: ${e.message}`);
  }
}
