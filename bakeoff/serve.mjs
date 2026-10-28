// Tiny static server for the playtest page. No dependencies.
//   npm run play   then open http://localhost:8080/play.html
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".md": "text/plain" };

function listGames() {
  const games = [{ path: "engine/example-game.js", model: "example", brief: "example" }];
  const out = path.join(root, "out");
  if (fs.existsSync(out)) {
    for (const model of fs.readdirSync(out)) {
      for (const f of fs.readdirSync(path.join(out, model)).filter((f) => f.endsWith(".js"))) {
        games.push({ path: `out/${model}/${f}`, model, brief: f.replace(/\.js$/, "") });
      }
    }
  }
  return games;
}

http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (url === "/api/games") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(listGames()));
  }
  const file = path.join(root, url === "/" ? "play.html" : url);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404);
    return res.end("not found");
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Playtest: http://localhost:${PORT}/play.html`));
