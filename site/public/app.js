// Daily-Daily-Game front end: hash routes, the sandboxed game player, and the leaderboard.
import { seedFromDate } from "/seed.js";

const view = document.getElementById("view");
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
function playerId() {
  let id = store.get("playerId", null);
  if (!id) { id = crypto.randomUUID(); store.set("playerId", id); }
  return id;
}

const GOALS = {
  highscore: "Score as many points as you can.",
  speedrun: "Reach the goal as fast as you can.",
  survival: "Stay alive as long as you can.",
};
const fmt = (type, v) => (v == null ? "-" : type === "speedrun" ? (v / 30).toFixed(2) + "s" : String(v));
const fmtDate = (d) => new Date(d + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).toUpperCase();
const better = (type, a, b) => b == null || (type === "speedrun" ? a < b : a > b);

let days = [], today = "", engineSrc = "";
const dayOf = (date) => days.find((d) => d.date === date);
const latest = () => days[days.length - 1];

async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

// ---------- Router ----------

let cleanup = null;
async function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  const [, page = "", arg] = location.hash.replace(/^#\/?/, "/").split("/");
  const tab = { "": "play", play: "play", leaderboard: "leaderboard", archive: "archive", how: "how" }[page] ?? "play";
  document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("active", a.dataset.tab === tab));
  if (!days.length) return;
  if (page === "archive") return archivePage();
  if (page === "leaderboard") return leaderboardPage(arg && dayOf(arg) ? arg : latest().date);
  if (page === "how") return howPage();
  return playPage(page === "play" && dayOf(arg) ? arg : latest().date);
}

// ---------- Play ----------

async function playPage(date) {
  const day = dayOf(date);
  const isLatest = date === latest().date;
  const best = store.get("best", {})[date];
  view.innerHTML = `
  <section class="play">
    <div class="cart">
      <div class="cart-head">
        <span>#${day.number}</span><span>${fmtDate(date)}</span><span class="badge ${day.type}">${day.type}</span>
      </div>
      <h1>${esc(day.title)}</h1>
      ${isLatest && date !== today ? `<p class="notice">No new game yet today. Here's the latest one.</p>` : ""}
      ${!isLatest ? `<p class="notice">Archive game. <a href="#/">Play today's game</a></p>` : ""}
      <div class="bezel">
        <div class="screen">
          <iframe title="${esc(day.title)}" sandbox="allow-scripts"></iframe>
          <button class="overlay" type="button">
            <span class="big blink">PRESS Z TO START</span>
            <span class="small">or tap here</span>
          </button>
        </div>
      </div>
      <div class="hud"><span class="live" id="live">${day.type === "speedrun" ? "TIME 0.00s" : "SCORE 0"}</span><span id="hudbest">BEST ${fmt(day.type, best)}</span></div>
      <div class="pad" aria-label="Touch controls">
        <div class="dpad">
          <button data-b="2" aria-label="Up">&#9650;</button><button data-b="0" aria-label="Left">&#9664;</button>
          <button data-b="1" aria-label="Right">&#9654;</button><button data-b="3" aria-label="Down">&#9660;</button>
        </div>
        <div class="ab"><button data-b="4" aria-label="O button">O</button><button data-b="5" aria-label="X button">X</button></div>
      </div>
    </div>
    <aside>
      <div class="panel result" id="result" hidden></div>
      <div class="panel">
        <h2>Goal</h2>
        <p class="goal">${GOALS[day.type]}</p>
        <p class="brief">${esc(day.theme)}: ${esc(day.mechanic)}.</p>
      </div>
      <div class="panel">
        <h2>Controls</h2>
        <dl class="keys">
          <dt><kbd>&larr;</kbd><kbd>&uarr;</kbd><kbd>&darr;</kbd><kbd>&rarr;</kbd></dt><dd>Move</dd>
          <dt><kbd>Z</kbd> <kbd>C</kbd></dt><dd>O button</dd>
          <dt><kbd>X</kbd> <kbd>V</kbd></dt><dd>X button</dd>
          <dt><kbd>R</kbd></dt><dd>Restart</dd>
        </dl>
      </div>
      <div class="panel">
        <h2>Top scores</h2>
        <div id="mini">Loading&hellip;</div>
        <p style="margin:10px 0 0"><a href="#/leaderboard/${date}">Full leaderboard &rarr;</a></p>
      </div>
    </aside>
  </section>`;

  const frame = $("iframe"), overlay = $(".overlay"), live = $("#live");
  const [src] = await Promise.all([fetch(`/api/game/${date}.js`).then((r) => r.text()), engineSrc || loadEngine()]);
  let player = null;

  const load = () => {
    player?.destroy();
    $("#result").hidden = true;
    overlay.hidden = false;
    player = createPlayer(frame, src, seedFromDate(date), {
      restart: () => load(),
      started: () => { overlay.hidden = true; },
      status: (s) => { live.textContent = day.type === "speedrun" ? `TIME ${(s.frame / 30).toFixed(2)}s` : `SCORE ${s.score}`; },
      finish: (run) => showResult(day, run, load),
      error: (msg) => { overlay.hidden = false; overlay.innerHTML = `<span class="big err">GAME ERROR</span><span class="small">${esc(msg)}</span>`; },
    });
  };
  load();
  overlay.onclick = () => player.start();

  // Keyboard on the page (when the game frame itself isn't focused) is forwarded to the game.
  const KEYS = { ArrowLeft: 0, ArrowRight: 1, ArrowUp: 2, ArrowDown: 3, z: 4, c: 4, n: 4, x: 5, v: 5, m: 5 };
  const onKey = (down) => (e) => {
    if (e.target.closest("input, textarea")) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k in KEYS) {
      e.preventDefault();
      if (down && !player.running) player.start();
      player.key(KEYS[k], down);
    } else if (down && k === "r") load();
    else if (down && k === "Enter" && !player.running && e.target === document.body) player.start();
  };
  const kd = onKey(true), ku = onKey(false);
  addEventListener("keydown", kd);
  addEventListener("keyup", ku);

  document.querySelectorAll(".pad button").forEach((b) => {
    const i = Number(b.dataset.b);
    const set = (down) => (e) => {
      e.preventDefault();
      b.classList.toggle("on", down);
      if (down && !player.running) player.start();
      player.key(i, down);
    };
    b.addEventListener("pointerdown", set(true));
    for (const ev of ["pointerup", "pointercancel", "pointerleave"]) b.addEventListener(ev, set(false));
  });

  cleanup = () => { removeEventListener("keydown", kd); removeEventListener("keyup", ku); player?.destroy(); };
  renderBoard($("#mini"), await api(`/api/leaderboard/${date}?player=${playerId()}`).catch(() => null), 10);
}

function showResult(day, run, restart) {
  const box = $("#result");
  if (!box) return;
  const name = store.get("name", "");
  box.hidden = false;
  box.innerHTML = `
    <h2>${day.type === "speedrun" ? "Cleared!" : "Game over"}</h2>
    <div class="score">${fmt(day.type, run.value)}</div>
    <div class="verdict" id="verdict">${name ? "Verifying your run&hellip;" : "Enter a name to post your score."}</div>
    <form id="nameform" ${name ? "hidden" : ""}>
      <input id="name" maxlength="10" placeholder="YOUR NAME" autocomplete="nickname" value="${esc(name)}" aria-label="Your name">
      <button class="btn warn" type="submit">Post</button>
    </form>
    <div class="row">
      <button class="btn" id="again" type="button">Play again</button>
      <button class="btn alt" id="share" type="button">Share</button>
      ${name ? `<button class="btn alt" id="rename" type="button">Change name</button>` : ""}
    </div>`;
  $("#again").onclick = restart;
  $("#rename")?.addEventListener("click", () => { $("#nameform").hidden = false; $("#name").focus(); });
  $("#share").onclick = async () => {
    const text = `Daily Daily Game #${day.number}: ${day.title}\n${day.type === "speedrun" ? "Time" : "Score"}: ${fmt(day.type, run.value)}\n${location.origin}/#/play/${day.date}`;
    try { await navigator.clipboard.writeText(text); $("#share").textContent = "Copied!"; } catch { prompt("Copy this:", text); }
  };
  $("#nameform").onsubmit = (e) => {
    e.preventDefault();
    const n = $("#name").value.toUpperCase().replace(/[^A-Z0-9 _-]/g, "").trim().slice(0, 10);
    if (!n) { $("#verdict").textContent = "Letters and numbers only."; return; }
    store.set("name", n);
    $("#nameform").hidden = true;
    post(day, run, n);
  };
  if (name) post(day, run, name);
  else $("#name").focus();
}

async function post(day, run, name) {
  const verdict = $("#verdict");
  verdict.textContent = "Verifying your run…";
  try {
    const r = await api("/api/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date: day.date, playerId: playerId(), name, inputs: toBase64(run.inputs) }),
    });
    const bests = store.get("best", {});
    if (better(day.type, r.verified, bests[day.date])) { bests[day.date] = r.verified; store.set("best", bests); }
    const hud = $("#hudbest");
    if (hud) hud.textContent = `BEST ${fmt(day.type, bests[day.date])}`;
    const rank = r.board.you ? `#${r.board.you.rank} of ${r.board.total}` : "";
    verdict.textContent = r.newBest ? `Verified. New personal best! You're ${rank}.` : `Verified. Your best is still ${fmt(day.type, r.board.you.value)} (${rank}).`;
    const mini = $("#mini");
    if (mini) renderBoard(mini, r.board, 10);
  } catch (e) {
    verdict.innerHTML = `<span class="err">${esc(e.message)}</span>`;
  }
}

function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.slice(i, i + 0x8000));
  return btoa(s);
}

// ---------- Sandboxed player ----------
// The daily game is untrusted generated code, so it runs in a sandboxed iframe with no network
// (CSP default-src 'none'). The frame records one input byte per frame; the server replays them.

async function loadEngine() {
  engineSrc = (await fetch("/engine.js").then((r) => r.text())).replace(/^export /gm, "");
  return engineSrc;
}

function createPlayer(frame, gameSrc, seed, on) {
  const scriptSafe = (s) => s.replace(/<\/script/gi, "<\\/script");
  frame.srcdoc = `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}canvas{width:100%;height:100%;image-rendering:pixelated;display:block}</style>
</head><body><canvas width="128" height="128"></canvas>
<script>${scriptSafe(engineSrc)}
const eng = createEngine(${seed});
Object.assign(window, eng.api);
<\/script>
<script>try { ${scriptSafe(gameSrc.replace(/export\s+default/, "window.__game ="))} } catch (e) { parent.postMessage({ ev: "error", msg: "Load: " + e.message }, "*"); }<\/script>
<script>
const say = (m) => parent.postMessage(m, "*");
const game = window.__game;
const cv = document.querySelector("canvas"), cx = cv.getContext("2d"), img = cx.createImageData(128, 128);
const rgb = PALETTE.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
const KEYS = { ArrowLeft: 0, ArrowRight: 1, ArrowUp: 2, ArrowDown: 3, z: 4, c: 4, n: 4, x: 5, v: 5, m: 5 };
const held = [false, false, false, false, false, false];
const log = [];
let running = false, sent = false, acc = 0, last = null;
function blit() {
  const d = img.data;
  for (let i = 0; i < eng.fb.length; i++) { const c = rgb[eng.fb[i]]; d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255; }
  cx.putImageData(img, 0, 0);
}
function fail(e) { running = false; say({ ev: "error", msg: e.message }); }
function start() {
  if (running || !game) return;
  try { eng.start(game); } catch (e) { return fail(e); }
  running = true; say({ ev: "started" });
  requestAnimationFrame(loop);
}
function loop(now) {
  if (!running) return;
  if (last !== null) acc += Math.min(now - last, 250);
  last = now;
  try {
    while (acc >= 1000 / 30) {
      acc -= 1000 / 30;
      const b = held.slice();
      if (!eng.state.finished) log.push(b.reduce((n, on, i) => n | (on ? 1 << i : 0), 0));
      eng.tick(game, b);
      if (eng.state.frame % 3 === 0 && !eng.state.finished) say({ ev: "status", score: eng.state.score, frame: eng.state.frame });
      if (eng.state.finished && !sent) {
        sent = true;
        say({ ev: "status", score: eng.state.score, frame: eng.state.finishFrame });
        say({ ev: "finish", inputs: new Uint8Array(log), value: game.type === "speedrun" ? eng.state.finishFrame : eng.state.score });
      }
    }
  } catch (e) { return fail(e); }
  blit();
  requestAnimationFrame(loop);
}
const key = (k, down) => { if (k in KEYS) held[KEYS[k]] = down; };
addEventListener("keydown", (e) => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k in KEYS) { e.preventDefault(); if (!running) start(); key(k, true); }
  if (k === "r") say({ ev: "restart" });
});
addEventListener("keyup", (e) => key(e.key.length === 1 ? e.key.toLowerCase() : e.key, false));
addEventListener("message", (e) => {
  if (e.source !== parent) return;
  if (e.data.cmd === "start") start();
  if (e.data.cmd === "key") held[e.data.i] = e.data.down;
});
// Show the first frame behind the start overlay.
if (game) { try { eng.start(game); game.draw(); blit(); } catch (e) { fail(e); } }
<\/script></body></html>`;

  const player = {
    running: false,
    start() { if (!player.running) frame.contentWindow?.postMessage({ cmd: "start" }, "*"); frame.focus(); },
    key(i, down) { frame.contentWindow?.postMessage({ cmd: "key", i, down }, "*"); },
    destroy() { removeEventListener("message", onMsg); },
  };
  function onMsg(e) {
    if (e.source !== frame.contentWindow) return;
    const m = e.data || {};
    if (m.ev === "started") { player.running = true; on.started(); }
    else if (m.ev === "status") on.status(m);
    else if (m.ev === "finish") on.finish({ inputs: m.inputs, value: m.value });
    else if (m.ev === "error") on.error(m.msg);
    else if (m.ev === "restart") { player.destroy(); on.restart?.(); }
  }
  addEventListener("message", onMsg);
  return player;
}

// ---------- Leaderboard ----------

function renderBoard(el, board, limit) {
  if (!board) { el.innerHTML = `<p class="empty err">Couldn't load scores.</p>`; return; }
  if (!board.top.length) { el.innerHTML = `<p class="empty">No scores yet. Be the first.</p>`; return; }
  const rows = board.top.slice(0, limit).map((r) => `
    <tr class="${r.you ? "you" : ""} r${r.rank}"><td class="n">${r.rank}</td><td>${esc(r.name)}${r.you ? " (you)" : ""}</td><td class="v">${fmt(board.type, r.value)}</td></tr>`).join("");
  const youBelow = board.you && board.you.rank > limit
    ? `<p class="yourrank">YOU: #${board.you.rank} of ${board.total}, ${fmt(board.type, board.you.value)}</p>` : "";
  el.innerHTML = `<table class="board"><thead><tr><th>#</th><th>Name</th><th class="v">${board.type === "speedrun" ? "Time" : "Score"}</th></tr></thead><tbody>${rows}</tbody></table>${youBelow}`;
}

async function leaderboardPage(date) {
  const day = dayOf(date), i = days.indexOf(day);
  const prev = days[i - 1], next = days[i + 1];
  view.innerHTML = `
    <div class="daynav">
      <a class="btn alt" href="#/leaderboard/${prev?.date ?? ""}" aria-disabled="${!prev}" aria-label="Previous day">&larr;</a>
      <div class="mid">
        <div class="cart-head" style="justify-content:center"><span>#${day.number}</span><span>${fmtDate(date)}</span><span class="badge ${day.type}">${day.type}</span></div>
        <h1>${esc(day.title)}</h1>
      </div>
      <a class="btn alt" href="#/leaderboard/${next?.date ?? ""}" aria-disabled="${!next}" aria-label="Next day">&rarr;</a>
    </div>
    <div class="panel">
      <h2>${day.type === "speedrun" ? "Fastest times" : "Top scores"}</h2>
      <div id="board"><p class="empty">Loading&hellip;</p></div>
    </div>
    <p class="row" style="margin-top:16px"><a class="btn" href="#/play/${date}">Play this game</a></p>`;
  renderBoard($("#board"), await api(`/api/leaderboard/${date}?player=${playerId()}`).catch(() => null), 50);
}

// ---------- Archive ----------

function archivePage() {
  const best = store.get("best", {});
  view.innerHTML = `
    <div class="pagehead"><h1>Archive</h1><p>Every daily game so far. Old leaderboards stay open.</p></div>
    <div class="grid">${[...days].reverse().map((d) => `
      <a class="card ${d.type}" href="#/play/${d.date}">
        <div class="num">#${d.number} &middot; ${fmtDate(d.date)}</div>
        <h3>${esc(d.title)}</h3>
        <span class="badge ${d.type}">${d.type}</span>
        <div class="best ${best[d.date] == null ? "none" : ""}">${best[d.date] == null ? "NOT PLAYED" : "YOUR BEST " + fmt(d.type, best[d.date])}</div>
      </a>`).join("")}
    </div>`;
}

// ---------- How to ----------

function howPage() {
  view.innerHTML = `
  <div class="how">
    <div class="pagehead"><h1>How to play</h1></div>
    <div class="panel">
      <h2>One new game a day</h2>
      <p>Every day at midnight UTC a brand-new tiny game appears. It's written fresh each day by an AI, so nobody has played it before. Everyone in the world gets the same game with the same random seed.</p>
    </div>
    <div class="panel">
      <h2>Three kinds of game</h2>
      <ul>
        <li><span class="badge highscore">highscore</span> Get the most points.</li>
        <li><span class="badge speedrun">speedrun</span> Reach the goal in the shortest time.</li>
        <li><span class="badge survival">survival</span> Stay alive the longest.</li>
      </ul>
    </div>
    <div class="panel">
      <h2>Controls</h2>
      <p>Arrow keys to move, <kbd>Z</kbd> for O and <kbd>X</kbd> for X. On a phone, use the on-screen pad. <kbd>R</kbd> restarts.</p>
    </div>
    <div class="panel">
      <h2>The leaderboard is fair</h2>
      <p>When you finish, your button presses are sent to the server, which replays the whole game itself and works out your score. You can play as many times as you like; only your best run counts.</p>
    </div>
  </div>`;
}

// ---------- Countdown + boot ----------

function tickCountdown() {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const s = Math.max(0, Math.floor((next - now) / 1000));
  $("#countdown").textContent = [s / 3600, (s / 60) % 60, s % 60].map((n) => String(Math.floor(n)).padStart(2, "0")).join(":");
}

async function boot() {
  tickCountdown();
  setInterval(tickCountdown, 1000);
  try {
    ({ days, today } = await api("/api/days"));
  } catch (e) {
    view.innerHTML = `<p class="msg err">Couldn't reach the server. ${esc(e.message)}</p>`;
    return;
  }
  if (!days.length) { view.innerHTML = `<p class="msg">No games yet. Check back soon.</p>`; return; }
  addEventListener("hashchange", route);
  route();
}
boot();
