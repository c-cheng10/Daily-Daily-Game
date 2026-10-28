// Accounts: email + unique username + password (scrypt-hashed), with cookie sessions.
// Stored as JSON in site/data/. Swap for a real database when deploying.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const SESSION_DAYS = 30;
let usersFile, sessionsFile, db = { users: {} }, sessions = {};

export function init(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  usersFile = path.join(dataDir, "users.json");
  sessionsFile = path.join(dataDir, "sessions.json");
  if (fs.existsSync(usersFile)) db = JSON.parse(fs.readFileSync(usersFile, "utf8"));
  if (fs.existsSync(sessionsFile)) sessions = JSON.parse(fs.readFileSync(sessionsFile, "utf8"));
}
const save = () => fs.writeFileSync(usersFile, JSON.stringify(db, null, 1));
const saveSessions = () => fs.writeFileSync(sessionsFile, JSON.stringify(sessions));

const hash = (password, salt) => crypto.scryptSync(password, salt, 64).toString("hex");
const findBy = (field, value) => Object.values(db.users).find((u) => u[field] === value);

export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
export const USERNAME_RE = /^[A-Za-z0-9_]{3,12}$/;

// Throws an Error with a user-facing message on bad input.
export function signup(email, username, password) {
  email = String(email ?? "").trim().toLowerCase();
  username = String(username ?? "").trim();
  password = String(password ?? "");
  if (!EMAIL_RE.test(email)) throw new Error("That email doesn't look right.");
  if (!USERNAME_RE.test(username)) throw new Error("Username: 3-12 letters, numbers or _.");
  if (password.length < 8) throw new Error("Password must be at least 8 characters.");
  if (findBy("email", email)) throw new Error("There's already an account with that email.");
  if (findBy("usernameKey", username.toLowerCase())) throw new Error("That username is taken.");
  const salt = crypto.randomBytes(16).toString("hex");
  const user = { id: crypto.randomUUID(), email, username, usernameKey: username.toLowerCase(), salt, hash: hash(password, salt), createdAt: Date.now() };
  db.users[user.id] = user;
  save();
  return user;
}

export function login(email, password) {
  const user = findBy("email", String(email ?? "").trim().toLowerCase());
  // Hash anyway when the email is unknown so response time doesn't reveal which emails exist.
  const attempt = hash(String(password ?? ""), user?.salt ?? "x");
  if (!user || !crypto.timingSafeEqual(Buffer.from(attempt, "hex"), Buffer.from(user.hash, "hex"))) {
    throw new Error("Wrong email or password.");
  }
  return user;
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions[token] = { userId, exp: Date.now() + SESSION_DAYS * 864e5 };
  saveSessions();
  return { token, maxAge: SESSION_DAYS * 86400 };
}

export function endSession(token) {
  if (sessions[token]) { delete sessions[token]; saveSessions(); }
}

export function fromToken(token) {
  const s = token && sessions[token];
  if (!s) return null;
  if (s.exp < Date.now()) { endSession(token); return null; }
  return db.users[s.userId] ?? null;
}

export const usernameOf = (id) => db.users[id]?.username ?? "?";
export const publicUser = (u) => ({ username: u.username, email: u.email });
