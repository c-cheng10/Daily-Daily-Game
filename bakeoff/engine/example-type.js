// Example 5 (highscore, typing): a word chain. Each word must start with the last letter of the one before.
// Typed with the engine's on-screen keyboard: arrows move, O types the letter, X deletes, OK submits. 60 seconds.
const LIMIT = 60 * 30;
let kb, typed, need, used, points, msg, msgUntil, over, byFirst;

// A letter that starts plenty of common words (words ending in X or Q would be dead ends).
function goodStart(ch) {
  return (byFirst[ch] ?? []).length >= 20 ? ch : pick("STBCPMRDF".split(""));
}

function submit() {
  const word = typed;
  typed = "";
  msgUntil = frame() + 45;
  if (word.length < 3) return (msg = "TOO SHORT");
  if (word[0] !== need) return (msg = "MUST START WITH " + need);
  if (used.includes(word)) return (msg = "ALREADY USED");
  if (!isword(word)) return (msg = "NOT A WORD");
  used.push(word);
  points += word.length * 10;
  score(points);
  need = goodStart(word[word.length - 1]);
  msg = "+" + word.length * 10;
}

export default {
  type: "highscore",

  init(seed) {
    kb = keyboard();
    byFirst = {};
    for (const n of [3, 4, 5, 6, 7]) for (const w of wordlist(n)) (byFirst[w[0]] ??= []).push(w);
    typed = "";
    need = pick("STBCPMRDF".split(""));
    used = [];
    points = 0;
    msg = "";
    msgUntil = 0;
    over = false;
    score(0);
  },

  update(input) {
    if (frame() >= LIMIT) { over = true; finish(); return; }
    const k = kb.update();
    if (k === "DEL") typed = typed.slice(0, -1);
    else if (k === "ENTER") submit();
    else if (k && typed.length < 7) typed += k;
  },

  draw() {
    cls(1);
    print("SCORE " + points, 2, 2, 7);
    const t = Math.max(0, ceil((LIMIT - frame()) / 30)) + "S";
    print(t, 126 - textw(t), 2, frame() > LIMIT - 300 ? 8 : 7);
    printc("NEXT WORD STARTS WITH", 14, 6);
    printc(need, 22, 10);
    rectfill(24, 32, 80, 13, 0);
    printc(typed || "-", 36, 7);
    if (frame() < msgUntil) printc(msg, 50, msg[0] === "+" ? 11 : 8);
    used.slice(-6).forEach((w, i) => print(w, 4 + (i % 3) * 42, 62 + flr(i / 3) * 8, 13));
    printc("ARROWS + O TYPE  X DELETE", 82, 6);
    kb.draw(14, 98);
    if (over) {
      rectfill(14, 40, 100, 30, 0);
      printc("TIME UP", 46, 10);
      printc(used.length + " WORDS  " + points + " PTS", 58, 7);
    }
  },

  probe() {
    return {
      progress: points,
      state: over ? "over" : "play",
      vars: { typed, need, words: used.length, key: kb.key(), timeLeft: LIMIT - frame() },
    };
  },

  // Type the first unused 5-letter word that fits, then OK. kb.type() handles moving, pressing and deleting.
  bot(p, f) {
    const word = (byFirst[need] ?? []).find((w) => w.length === 5 && !used.includes(w)) ?? (byFirst[need] ?? []).find((w) => !used.includes(w));
    return word ? kb.type(word, typed) : "";
  },

  tests: [
    { name: "idle scores zero and the game ends at 60 s", frames: LIMIT + 5, input: "", expect: (r) => (r.finished && r.score === 0) || "finished=" + r.finished + " score=" + r.score },
    { name: "the bot chains many words", frames: LIMIT, input: "bot", expect: (r) => r.score >= 150 || "bot only scored " + r.score },
    { name: "O types the letter under the cursor, X deletes it", frames: 6, input: ["O", "", "O", "", "X", ""], expect: (r) => r.probe.vars.typed === "A" || "typed " + r.probe.vars.typed },
  ],
};
