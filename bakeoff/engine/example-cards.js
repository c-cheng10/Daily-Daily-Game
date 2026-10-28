// Example 7 (highscore, cards): higher or lower. Up = the next card is higher, down = lower. A right guess scores
// 1 + your streak, a wrong one resets the streak. The game ends when the pile runs out. Every 5 cards also score
// their poker hand.
const LIMIT = 90 * 30;
let pile, shown, cur, points, streak, best, msg, msgUntil, over;

function bonusFor(cards) {
  const h = pokerhand(cards);
  return h.rank >= 1 ? { pts: h.rank * 5, name: h.name } : null;
}

export default {
  type: "highscore",

  init(seed) {
    pile = shuffle(deck());
    cur = deal(pile, 1)[0];
    shown = [];
    points = 0; streak = 0; best = 0;
    msg = ""; msgUntil = 0;
    over = false;
    score(0);
  },

  update(input) {
    if (frame() >= LIMIT || !pile.length) { over = true; finish(); return; }
    const up = btnp(2), down = btnp(3);
    if (!up && !down) return;
    const next = deal(pile, 1)[0];
    shown.push(cur);
    if (next.rank === cur.rank) msg = "SAME - NO SCORE";
    else if ((next.rank > cur.rank) === up) { streak++; best = Math.max(best, streak); points += streak; msg = "+" + streak; }
    else { streak = 0; msg = "WRONG"; }
    cur = next;
    if (shown.length % 5 === 4) {
      const b = bonusFor([...shown.slice(-4), cur]);
      if (b) { points += b.pts; msg = b.name + " +" + b.pts; }
    }
    score(points);
    msgUntil = frame() + 40;
  },

  draw() {
    cls(3);
    print("SCORE " + points, 2, 2, 7);
    const t = Math.max(0, ceil((LIMIT - frame()) / 30)) + "S";
    print(t, 126 - textw(t), 2, 7);
    print("STREAK " + streak, 2, 10, 10);
    drawcard(null, 40, 40, { back: true });
    print(pile.length + "", 43, 58, 7);
    drawcard(cur, 70, 40, { sel: true });
    shown.slice(-4).forEach((c, i) => drawcard(c, 36 + i * 14, 76));
    printc("THE LAST 5 CARDS MAKE A HAND", 96, 6);
    printc("UP HIGHER  DOWN LOWER", 112, 10);
    if (frame() < msgUntil) printc(msg, 26, msg === "WRONG" ? 8 : 10);
    if (over) {
      rectfill(14, 44, 100, 30, 0);
      printc("GAME OVER", 50, 10);
      printc(points + " POINTS", 60, 7);
    }
  },

  probe() {
    return {
      progress: points,
      state: over ? "over" : "play",
      cards: { pile: pile.map(cardname), shown: shown.map(cardname), current: [cardname(cur)] },
      vars: { streak, best },
    };
  },

  share() {
    return "HIGHER/LOWER " + points + " PTS, BEST STREAK " + best;
  },

  // Count the cards still in the pile (the ones not seen yet) and guess the likelier side.
  bot(p, f) {
    if (f % 2) return "";
    const higher = pile.filter((c) => c.rank > cur.rank).length, lower = pile.filter((c) => c.rank < cur.rank).length;
    return higher >= lower ? "U" : "D";
  },

  tests: [
    { name: "52 cards always", frames: 600, input: "bot", each: (p) => p.cards.pile.length + p.cards.shown.length + 1 === 52 || "card count wrong" },
    { name: "the bot plays the whole deck and scores well", frames: LIMIT, input: "bot", expect: (r) => (r.finished && r.score >= 60) || "finished=" + r.finished + " score=" + r.score },
  ],
};
