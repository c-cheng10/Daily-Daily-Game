// Daily-Daily-Game website: static files, daily game manifest, and the global leaderboard.
// No dependencies.   node site/server.mjs   then open http://localhost:3000
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { replay } from "./lib/replay.mjs";
import * as store from "./lib/store.mjs";
import * as users from "./lib/users.mjs";
import { seedFromDate } from "./public/seed.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(root, "public");
const gamesDir = path.join(root, "games");
const PORT = Number(process.env.PORT) || 3000;
const MAX_FRAMES = 30 * 60 * 30; // 30 minutes
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

store.init(path.join(root, "data"));
users.init(path.join(root, "data"));

// Days are UTC so everyone in the world shares the same daily game.
const today = () => process.env.TODAY || new Date().toISOString().slice(0, 10);
const days = () => JSON.parse(fs.readFileSync(path.join(gamesDir, "index.json"), "utf8"))
  .filter((d) => d.date <= today())
  .sort((a, b) => a.date.localeCompare(b.date))
  .map((d, i) => ({ ...d, number: i + 1 }));
const findDay = (date) => days().find((d) => d.date === date);

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

function readBody(req, limit = 200000) {
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("body too large")); req.destroy(); } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

// Simple per-IP limits, per bucket (submissions, auth attempts).
const hits = new Map();
function rateLimited(bucket, ip, max) {
  const key = bucket + ip, now = Date.now(), recent = (hits.get(key) ?? []).filter((t) => now - t < 60000);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > max;
}

const SECURE = process.env.SECURE_COOKIES === "1"; // set when served over https
const tokenOf = (req) => /(?:^|;\s*)ddg_session=([a-f0-9]{64})/.exec(req.headers.cookie ?? "")?.[1] ?? null;
const currentUser = (req) => users.fromToken(tokenOf(req));
const setSession = (res, token, maxAge) => res.setHeader("set-cookie",
  `ddg_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${SECURE ? "; Secure" : ""}`);

// POST bodies must be JSON; with SameSite cookies this also blocks cross-site form posts.
async function jsonBody(req) {
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) throw new Error("Bad request");
  return JSON.parse(await readBody(req, 300000));
}

async function auth(req, res, kind) {
  if (rateLimited("auth", req.socket.remoteAddress, 10)) return json(res, 429, { error: "Too many attempts. Wait a minute." });
  let body;
  try { body = await jsonBody(req); } catch { return json(res, 400, { error: "Bad request" }); }
  let user;
  try {
    user = kind === "signup" ? users.signup(body.email, body.username, body.password) : users.login(body.email, body.password);
  } catch (e) {
    return json(res, kind === "signup" ? 400 : 401, { error: e.message });
  }
  const { token, maxAge } = users.createSession(user.id);
  setSession(res, token, maxAge);
  json(res, 200, me(user));
}

const me = (user) => ({ ...users.publicUser(user), bests: store.bests(user.id, days().map((d) => d.date)) });

async function submit(req, res) {
  if (rateLimited("submit", req.socket.remoteAddress, 20)) return json(res, 429, { error: "Too many submissions. Wait a minute." });
  const user = currentUser(req);
  if (!user) return json(res, 401, { error: "Sign in to post your score." });
  let body;
  try { body = await jsonBody(req); } catch { return json(res, 400, { error: "Bad request" }); }
  const { date, inputs } = body;
  const day = findDay(date);
  if (!day) return json(res, 404, { error: "No game for that day" });
  const frames = Buffer.from(String(inputs ?? ""), "base64");
  if (frames.length === 0 || frames.length > MAX_FRAMES) return json(res, 400, { error: "Bad input log" });

  let run;
  try {
    run = replay(fs.readFileSync(path.join(gamesDir, day.file), "utf8"), seedFromDate(date), frames);
  } catch (e) {
    return json(res, 422, { error: "Replay failed: " + String(e.message).split("\n")[0] });
  }
  if (!run.finished) return json(res, 422, { error: "Replay didn't reach the end of the run, so it can't be scored." });

  const newBest = store.submit(date, run.type, user.id, run.value);
  json(res, 200, { verified: run.value, newBest, board: store.board(date, run.type, user.id, users.usernameOf) });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = decodeURIComponent(url.pathname);
  try {
    if (p === "/api/days") return json(res, 200, { today: today(), days: days().map(({ file, ...d }) => d) });

    let m = p.match(/^\/api\/game\/(\d{4}-\d{2}-\d{2})\.js$/);
    if (m) {
      const day = findDay(m[1]);
      if (!day) return json(res, 404, { error: "No game for that day" });
      res.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" });
      return fs.createReadStream(path.join(gamesDir, day.file)).pipe(res);
    }

    m = p.match(/^\/api\/leaderboard\/(\d{4}-\d{2}-\d{2})$/);
    if (m) {
      const day = findDay(m[1]);
      if (!day) return json(res, 404, { error: "No game for that day" });
      return json(res, 200, store.board(day.date, day.type, currentUser(req)?.id, users.usernameOf));
    }

    if (p === "/api/submit" && req.method === "POST") return await submit(req, res);
    if (p === "/api/signup" && req.method === "POST") return await auth(req, res, "signup");
    if (p === "/api/login" && req.method === "POST") return await auth(req, res, "login");
    if (p === "/api/logout" && req.method === "POST") {
      users.endSession(tokenOf(req));
      setSession(res, "", 0);
      return json(res, 200, { ok: true });
    }
    if (p === "/api/me") {
      const user = currentUser(req);
      return user ? json(res, 200, me(user)) : json(res, 401, { error: "Not signed in" });
    }

    const file = path.join(pub, p === "/" ? "index.html" : p);
    if (!file.startsWith(pub + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 404, { error: "Not found" });
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    json(res, 500, { error: "Server error" });
  }
}).listen(PORT, () => console.log(`Daily-Daily-Game: http://localhost:${PORT}  (today = ${today()})`));
