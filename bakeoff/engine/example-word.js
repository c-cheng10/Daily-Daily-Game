// Example 3 (highscore): make as many words as you can from 6 letters in 60 seconds.
// Left/right move the cursor, O adds a letter, down deletes one, X submits the word.
const LIMIT = 60 * 30;
let letters, used, typed, cursor, found, points, msg, msgUntil, answers, over;

function canMake(word, pool) {
  const left = pool.slice();
  for (const ch of word) {
    const i = left.indexOf(ch);
    if (i < 0) return false;
    left.splice(i, 1);
  }
  return true;
}

function clearTyped() {
  typed = [];
  used = letters.map(() => false);
}

export default {
  type: "highscore",

  init(seed) {
    letters = shuffle(rndword(6).split(""));
    clearTyped();
    cursor = 0;
    found = [];
    points = 0;
    msg = "";
    msgUntil = 0;
    over = false;
    answers = [3, 4, 5, 6].flatMap((n) => wordlist(n)).filter((w) => canMake(w, letters));
    score(0);
  },

  update(input) {
    if (frame() >= LIMIT) { over = true; finish(); return; }
    if (btnp(0)) cursor = (cursor + 5) % 6;
    if (btnp(1)) cursor = (cursor + 1) % 6;
    if (btnp(4) && !used[cursor]) { used[cursor] = true; typed.push(cursor); }
    if (btnp(3) && typed.length) used[typed.pop()] = false;
    if (btnp(5)) {
      const word = typed.map((i) => letters[i]).join("");
      if (word.length < 3) msg = "TOO SHORT";
      else if (found.includes(word)) msg = "ALREADY FOUND";
      else if (!isword(word)) msg = "NOT A WORD";
      else { found.push(word); points += word.length * word.length; score(points); msg = "+" + word.length * word.length; }
      msgUntil = frame() + 45;
      clearTyped();
    }
  },

  draw() {
    cls(1);
    printc("WORD SMITH", 4, 10);
    print("SCORE " + points, 2, 12, 7);
    const t = Math.max(0, ceil((LIMIT - frame()) / 30));
    print(t + "S", 126 - textw(t + "S"), 12, t <= 10 ? 8 : 7);
    letters.forEach((ch, i) => {
      const x = 10 + i * 18;
      rectfill(x, 30, 16, 16, used[i] ? 5 : 6);
      print(ch, x + 7, 36, used[i] ? 6 : 0);
      if (i === cursor) rect(x - 1, 29, 18, 18, 10);
    });
    printc(typed.map((i) => letters[i]).join("") || "-", 56, 7);
    if (frame() < msgUntil) printc(msg, 66, msg[0] === "+" ? 11 : 8);
    found.slice(-6).forEach((w, i) => print(w, 4 + (i % 3) * 42, 82 + flr(i / 3) * 8, 13));
    print("FOUND " + found.length + "/" + answers.length, 2, 120, 6);
    if (over) {
      rectfill(16, 44, 96, 34, 0);
      printc("TIME UP", 50, 10);
      printc(found.length + " WORDS  " + points + " PTS", 60, 7);
    }
  },

  probe() {
    return {
      progress: points,
      state: over ? "over" : "play",
      vars: { letters: letters.join(""), typed: typed.map((i) => letters[i]).join(""), cursor, found: found.length, timeLeft: LIMIT - frame() },
    };
  },

  // Type the next answer it hasn't found yet, one button press every other frame (btnp needs a release).
  bot(p, f) {
    if (f % 2) return "";
    const target = answers.find((w) => !found.includes(w));
    if (!target) return "";
    const word = typed.map((i) => letters[i]).join("");
    if (!target.startsWith(word)) return "D";
    if (word === target) return "X";
    const want = target[word.length];
    const idx = letters.findIndex((ch, i) => ch === want && !used[i]);
    if (idx === cursor) return "O";
    return (idx - cursor + 6) % 6 <= 3 ? "R" : "L";
  },

  invariants(p) {
    return p.vars.typed.length > 6 ? ["typed more letters than there are tiles"] : [];
  },

  tests: [
    { name: "idle scores zero and the game ends at 60 s", frames: LIMIT + 5, input: "", expect: (r) => (r.finished && r.score === 0) || "finished=" + r.finished + " score=" + r.score },
    { name: "the bot finds several words", frames: LIMIT, input: "bot", expect: (r) => r.score >= 20 || "bot only scored " + r.score },
    { name: "submitting one letter is rejected", frames: 4, input: ["O", "", "X", ""], expect: (r) => r.score === 0 || "scored " + r.score },
  ],
};
