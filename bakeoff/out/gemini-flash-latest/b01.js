let bx, bvx, hookX, hookY, hookVy, shockTimer;
let hooked, fishes, jellies, particles, popups, bubbles, respawnQueue;
let totScore, totFish, maxDepth, bestCatchVal, bestFishName;
let timeLeft, finished;

const FISH_DEFS = [
  { type: 0, name: "MINNOW", val: 10, minY: 20, maxY: 42, spd: 0.85, r: 4 },
  { type: 1, name: "CLOWNFISH", val: 25, minY: 36, maxY: 62, spd: 0.65, r: 5 },
  { type: 2, name: "ANGLERFISH", val: 60, minY: 60, maxY: 90, spd: 0.5, r: 6 },
  { type: 3, name: "GIANT SQUID", val: 100, minY: 84, maxY: 114, spd: 0.8, r: 6 },
  { type: 4, name: "COELACANTH", val: 200, minY: 96, maxY: 118, spd: 0.5, r: 7 }
];

function createFish(type, xPos, dir) {
  const def = FISH_DEFS[type];
  const d = dir !== undefined ? dir : (rnd(1) < 0.5 ? 1 : -1);
  const x = xPos !== undefined ? xPos : rnd(120) + 4;
  const y = def.minY + rnd(def.maxY - def.minY);
  return {
    type: def.type,
    name: def.name,
    val: def.val,
    minY: def.minY,
    maxY: def.maxY,
    baseSpd: def.spd * (0.8 + rnd(0.4)),
    vx: d * def.spd,
    r: def.r,
    dir: d,
    x: x,
    y: y,
    phase: rnd(6.28)
  };
}

function createJelly(xPos) {
  const d = rnd(1) < 0.5 ? 1 : -1;
  const x = xPos !== undefined ? xPos : rnd(120) + 4;
  const baseY = 35 + rnd(68);
  return {
    x: x,
    baseY: baseY,
    y: baseY,
    vx: d * (0.25 + rnd(0.2)),
    dir: d,
    phase: rnd(6.28)
  };
}

function shockHook(j) {
  shockTimer = 30;
  if (hooked.length > 0) {
    popups.push({ text: "LOST CATCH!", x: Math.floor(hookX - 18), y: Math.floor(hookY - 8), c: 8, life: 30 });
    hooked = [];
  } else {
    popups.push({ text: "ZAP!", x: Math.floor(hookX - 8), y: Math.floor(hookY - 8), c: 8, life: 25 });
  }
  for (let i = 0; i < 8; i++) {
    particles.push({
      x: hookX,
      y: hookY,
      vx: rnd(4) - 2,
      vy: rnd(4) - 2,
      c: rnd(1) < 0.5 ? 10 : 7,
      life: 12 + Math.floor(rnd(8))
    });
  }
}

function bankCatch() {
  if (hooked.length === 0) return;
  let raw = 0;
  for (const f of hooked) raw += f.val;
  const mult = hooked.length === 3 ? 2 : (hooked.length === 2 ? 1.5 : 1);
  const gain = Math.floor(raw * mult);

  totScore += gain;
  totFish += hooked.length;
  score(totScore);

  let msg = "+" + gain;
  if (mult === 2) msg += " X2!";
  else if (mult === 1.5) msg += " X1.5";

  popups.push({
    text: msg,
    x: Math.floor(bx - 10),
    y: 12,
    c: mult >= 2 ? 10 : (mult > 1 ? 9 : 7),
    life: 38
  });

  for (let i = 0; i < 8; i++) {
    particles.push({
      x: bx + 6 + (rnd(6) - 3),
      y: 14,
      vx: rnd(2) - 1,
      vy: -rnd(2) - 0.5,
      c: rnd(1) < 0.5 ? 7 : 12,
      life: 14 + Math.floor(rnd(8))
    });
  }
  hooked = [];
}

export default {
  type: "highscore",

  init(seed) {
    bx = 60;
    bvx = 0;
    hookX = 66;
    hookY = 15;
    hookVy = 0;
    shockTimer = 0;

    hooked = [];
    fishes = [];
    jellies = [];
    particles = [];
    popups = [];
    bubbles = [];
    respawnQueue = [];

    totScore = 0;
    totFish = 0;
    maxDepth = 0;
    bestCatchVal = 0;
    bestFishName = "NONE";
    timeLeft = 60 * 30; // 60 seconds
    finished = false;

    // Populate initial sea life
    for (let i = 0; i < 4; i++) fishes.push(createFish(0));
    for (let i = 0; i < 3; i++) fishes.push(createFish(1));
    for (let i = 0; i < 3; i++) fishes.push(createFish(2));
    for (let i = 0; i < 2; i++) fishes.push(createFish(3));
    fishes.push(createFish(4));

    for (let i = 0; i < 4; i++) jellies.push(createJelly());

    for (let i = 0; i < 10; i++) {
      bubbles.push({
        x: rnd(128),
        y: 16 + rnd(106),
        spd: 0.3 + rnd(0.5),
        seed: rnd(6.28)
      });
    }

    score(0);
  },

  update(input) {
    if (finished) return;

    timeLeft--;
    if (timeLeft <= 0) {
      timeLeft = 0;
      finished = true;
      finish();
      return;
    }

    // Boat movement
    if (btn(0)) bvx -= 0.35;
    if (btn(1)) bvx += 0.35;
    bvx *= 0.82;
    bx += bvx;
    bx = Math.max(12, Math.min(116, bx));

    const rodX = bx + 6;

    // Hook movement
    hookX += (rodX - hookX) * 0.14;

    if (shockTimer > 0) {
      shockTimer--;
      hookY -= 0.4;
    } else {
      const loadPenalty = hooked.length * 0.35;
      const maxRise = 2.4 - loadPenalty;
      const maxFall = 2.1;

      const reelUp = btn(2) || btn(4);
      const reelDown = btn(3) || btn(5);

      if (reelUp) {
        hookVy -= 0.4;
      } else if (reelDown) {
        hookVy += 0.4;
      } else {
        if (hookY > 16) {
          hookVy += 0.05; // Gentle natural sink
        } else {
          hookVy *= 0.8;
        }
      }

      hookVy = Math.max(-maxRise, Math.min(maxFall, hookVy));
      hookY += hookVy;
    }

    // Surface docking & catch banking
    if (hookY <= 15) {
      hookY = 15;
      if (hooked.length > 0) bankCatch();
      if (!btn(3) && !btn(5)) hookVy = 0;
    }
    if (hookY > 120) {
      hookY = 120;
      hookVy = 0;
    }

    // Depth record
    const curDepth = Math.max(0, Math.floor((hookY - 14) * 1.5));
    if (curDepth > maxDepth) maxDepth = curDepth;

    // Fish updates
    for (const f of fishes) {
      if (f.type === 3) {
        // Squids dart in pulses
        const jet = Math.max(0, Math.sin(frame() * 0.12 + f.phase));
        f.x += f.vx + f.dir * jet * 0.9;
      } else {
        f.x += f.vx;
      }

      if (f.dir === 1 && f.x > 140) {
        f.x = -15;
        f.y = f.minY + rnd(f.maxY - f.minY);
      } else if (f.dir === -1 && f.x < -15) {
        f.x = 140;
        f.y = f.minY + rnd(f.maxY - f.minY);
      }
    }

    // Jellyfish updates
    for (const j of jellies) {
      j.x += j.vx;
      j.y = j.baseY + Math.sin(frame() * 0.08 + j.phase) * 4;
      if (j.dir === 1 && j.x > 138) {
        j.x = -10;
        j.baseY = 35 + rnd(68);
      } else if (j.dir === -1 && j.x < -10) {
        j.x = 138;
        j.baseY = 35 + rnd(68);
      }
    }

    // Hook collisions with jellyfish
    if (shockTimer === 0 && hookY > 18) {
      for (const j of jellies) {
        const dx = hookX - j.x;
        const dy = hookY - j.y;
        if (dx * dx + dy * dy < 28) {
          shockHook(j);
          break;
        }
      }
    }

    // Hook collisions with fish
    if (shockTimer === 0 && hooked.length < 3 && hookY > 18) {
      for (let i = fishes.length - 1; i >= 0; i--) {
        const f = fishes[i];
        const dx = hookX - f.x;
        const dy = hookY - f.y;
        if (dx * dx + dy * dy < f.r * f.r) {
          hooked.push({ type: f.type, val: f.val, name: f.name });
          if (f.val > bestCatchVal) {
            bestCatchVal = f.val;
            bestFishName = f.name;
          }

          for (let b = 0; b < 5; b++) {
            particles.push({
              x: f.x,
              y: f.y,
              vx: rnd(2) - 1,
              vy: -rnd(1.5) - 0.5,
              c: 7,
              life: 10 + Math.floor(rnd(6))
            });
          }

          popups.push({ text: "+" + f.val, x: Math.floor(hookX + 4), y: Math.floor(hookY - 4), c: 10, life: 22 });

          const caughtType = f.type;
          fishes.splice(i, 1);
          respawnQueue.push({ type: caughtType, timer: 50 });
          break;
        }
      }
    }

    // Respawn queue
    for (let i = respawnQueue.length - 1; i >= 0; i--) {
      respawnQueue[i].timer--;
      if (respawnQueue[i].timer <= 0) {
        const t = respawnQueue[i].type;
        respawnQueue.splice(i, 1);
        const dir = rnd(1) < 0.5 ? 1 : -1;
        const x = dir === 1 ? -14 : 140;
        fishes.push(createFish(t, x, dir));
      }
    }

    // Ambient Bubbles
    for (const b of bubbles) {
      b.y -= b.spd;
      b.x += Math.sin(frame() * 0.05 + b.seed) * 0.25;
      if (b.y < 15) {
        b.y = 122 + rnd(4);
        b.x = rnd(128);
      }
    }

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life--;
      if (p.life <= 0) particles.splice(i, 1);
    }

    // Popups
    for (let i = popups.length - 1; i >= 0; i--) {
      const pop = popups[i];
      pop.y -= 0.35;
      pop.life--;
      if (pop.life <= 0) popups.splice(i, 1);
    }
  },

  draw() {
    cls(0);

    // Sky
    rectfill(0, 0, 128, 14, 1);
    circfill(116, 5, 3, 10);
    circfill(118, 4, 3, 1);
    pset(14, 4, 7);
    pset(44, 7, 7);
    pset(82, 3, 7);
    pset(98, 8, 7);

    // Water surface line
    for (let x = 0; x < 128; x += 2) {
      const wy = 14 + Math.sin(x * 0.15 + frame() * 0.08) * 0.8;
      rectfill(x, Math.floor(wy), 2, 128 - Math.floor(wy), 12);
    }

    // Twilight zone
    rectfill(0, 44, 128, 84, 1);
    for (let x = 0; x < 128; x++) {
      if ((x + 42) % 2 === 0) pset(x, 42, 1);
      if ((x + 43) % 2 === 1) pset(x, 43, 1);
    }

    // Abyssal midnight zone
    rectfill(0, 80, 128, 48, 0);
    for (let x = 0; x < 128; x++) {
      if ((x + 78) % 2 === 0) pset(x, 78, 0);
      if ((x + 79) % 2 === 1) pset(x, 79, 0);
    }

    // Trench seabed
    rectfill(0, 123, 128, 5, 2);
    rectfill(0, 126, 128, 2, 4);
    circfill(20, 124, 3, 5);
    circfill(65, 125, 2, 5);
    circfill(96, 124, 4, 5);
    pset(38, 122, 11);
    pset(85, 122, 14);

    // Ambient Bubbles
    for (const b of bubbles) {
      pset(Math.floor(b.x), Math.floor(b.y), 12);
    }

    // Jellyfish
    for (const j of jellies) {
      const jx = Math.floor(j.x);
      const jy = Math.floor(j.y);
      const r = Math.sin(frame() * 0.15 + j.phase) > 0 ? 3 : 2;
      circfill(jx, jy, r, 13);
      rectfill(jx - r, jy, r * 2 + 1, 1, 14);
      const tw = Math.sin(frame() * 0.15 + jy) * 1.2;
      line(jx - 2, jy + 1, Math.floor(jx - 2 + tw), jy + 5, 14);
      line(jx, jy + 1, jx, jy + 6, 13);
      line(jx + 2, jy + 1, Math.floor(jx + 2 - tw), jy + 5, 14);
    }

    // Swimming fish
    for (const f of fishes) {
      const fx = Math.floor(f.x);
      const fy = Math.floor(f.y);
      const d = f.dir;

      if (f.type === 0) {
        rectfill(fx - 2, fy - 1, 5, 3, 12);
        pset(fx + 2 * d, fy - 1, 7);
        pset(fx - 3 * d, fy - 1, 6);
        pset(fx - 3 * d, fy + 1, 6);
      } else if (f.type === 1) {
        rectfill(fx - 3, fy - 2, 7, 5, 9);
        rectfill(fx, fy - 2, 1, 5, 7);
        pset(fx + 3 * d, fy - 1, 0);
        line(fx - 4 * d, fy - 2, fx - 4 * d, fy + 2, 9);
      } else if (f.type === 2) {
        rectfill(fx - 4, fy - 2, 9, 5, 2);
        circfill(fx - 1 * d, fy, 2, 1);
        pset(fx + 3 * d, fy - 1, 10);
        pset(fx + 3 * d, fy - 3, 5);
        pset(fx + 4 * d, fy - 4, 5);
        circfill(fx + 5 * d, fy - 4, 1, (frame() % 6 < 3) ? 10 : 7);
        pset(fx + 4 * d, fy + 1, 7);
        pset(fx + 3 * d, fy + 2, 7);
        line(fx - 5 * d, fy - 2, fx - 5 * d, fy + 2, 2);
      } else if (f.type === 3) {
        rectfill(fx - 3, fy - 2, 7, 5, 14);
        circfill(fx + 2 * d, fy, 1, 7);
        pset(fx + 2 * d, fy, 0);
        pset(fx - 4 * d, fy - 1, 8);
        pset(fx - 4 * d, fy + 1, 8);
        const w = Math.sin(frame() * 0.25 + fx) * 1.5;
        pset(fx + 4 * d, Math.floor(fy - 1 + w), 14);
        pset(fx + 5 * d, Math.floor(fy - 1 + w), 8);
        pset(fx + 6 * d, Math.floor(fy - 1 + w), 14);
        pset(fx + 4 * d, Math.floor(fy + 1 - w), 14);
        pset(fx + 5 * d, Math.floor(fy + 2 - w), 8);
        pset(fx + 6 * d, Math.floor(fy + 2 - w), 14);
      } else if (f.type === 4) {
        rectfill(fx - 5, fy - 3, 11, 7, 10);
        circfill(fx, fy, 2, 9);
        pset(fx + 4 * d, fy - 1, 7);
        pset(fx + 4 * d, fy, 0);
        line(fx - 6 * d, fy - 3, fx - 6 * d, fy + 3, 10);
        line(fx - 2 * d, fy - 4, fx + 1 * d, fy - 4, 9);
        line(fx - 2 * d, fy + 4, fx + 1 * d, fy + 4, 9);
        if ((frame() + fx) % 8 < 4) {
          pset(fx - 2 * d, fy - 1, 7);
          pset(fx + 1 * d, fy + 1, 7);
        }
      }
    }

    // Boat
    const ibx = Math.floor(bx);
    rectfill(ibx - 8, 10, 16, 4, 4);
    pset(ibx - 9, 10, 4);
    pset(ibx + 8, 10, 4);
    rectfill(ibx - 6, 14, 12, 1, 0);
    rectfill(ibx - 4, 6, 7, 4, 7);
    rectfill(ibx - 2, 7, 3, 2, 12);
    line(ibx + 3, 7, ibx + 7, 3, 5);
    line(ibx + 7, 3, ibx + 7, 10, 6);

    // Fishing line
    const rodTipX = ibx + 7;
    const rodTipY = 10;
    line(rodTipX, rodTipY, Math.floor(hookX), Math.floor(hookY - 3), 6);

    // Hook lantern glow in the deep
    const ihx = Math.floor(hookX);
    const ihy = Math.floor(hookY);
    if (ihy > 45) {
      circ(ihx, ihy, 14, 1);
      circ(ihx, ihy, 9, 12);
      circ(ihx, ihy, 4, 7);
    }

    // Lantern box
    rectfill(ihx - 1, ihy - 3, 3, 2, 10);
    pset(ihx, ihy - 2, 7);

    // Hook
    line(ihx, ihy - 1, ihx, ihy + 2, 6);
    pset(ihx + 1, ihy + 2, 7);
    pset(ihx + 2, ihy + 1, 7);

    // Shock sparks
    if (shockTimer > 0) {
      line(ihx - 3 + Math.floor(rnd(6)), ihy - 3 + Math.floor(rnd(6)),
           ihx + 3 - Math.floor(rnd(6)), ihy + 3 - Math.floor(rnd(6)),
           frame() % 2 === 0 ? 10 : 7);
    }

    // Caught fish dangling on hook
    for (let i = 0; i < hooked.length; i++) {
      const hFish = hooked[i];
      const sway = Math.sin(frame() * 0.18 + i * 1.5) * 2;
      const hx = Math.floor(ihx + sway);
      const hy = Math.floor(ihy + 4 + i * 5);

      if (hFish.type === 0) {
        rectfill(hx - 1, hy - 1, 3, 2, 12);
        pset(hx, hy + 1, 7);
      } else if (hFish.type === 1) {
        rectfill(hx - 1, hy - 2, 3, 4, 9);
        pset(hx, hy, 7);
      } else if (hFish.type === 2) {
        rectfill(hx - 2, hy - 2, 4, 4, 2);
        pset(hx - 1, hy - 3, 10);
      } else if (hFish.type === 3) {
        rectfill(hx - 1, hy - 2, 3, 5, 14);
        pset(hx, hy - 3, 8);
      } else {
        rectfill(hx - 2, hy - 2, 4, 5, 10);
        pset(hx, hy - 1, 7);
      }
    }

    // Hook status tag
    if (hooked.length === 3) {
      if (frame() % 6 < 3) print("FULL x2!", ihx + 4, ihy - 5, 10);
    } else if (hooked.length === 2) {
      print("x1.5", ihx + 4, ihy - 5, 9);
    }

    // Particles
    for (const p of particles) {
      pset(Math.floor(p.x), Math.floor(p.y), p.c);
    }

    // Popups
    for (const pop of popups) {
      print(pop.text, Math.floor(pop.x), Math.floor(pop.y), pop.c);
    }

    // HUD Header
    print("SCORE:" + totScore, 2, 2, 7);

    const sec = Math.ceil(timeLeft / 30);
    const timeCol = sec <= 10 ? ((frame() % 6 < 3) ? 8 : 7) : 10;
    print(sec + "S", 108, 2, timeCol);

    // Bag indicator pips
    print("BAG:", 2, 8, 6);
    for (let i = 0; i < 3; i++) {
      const col = i < hooked.length ? 10 : 5;
      rectfill(18 + i * 5, 9, 3, 3, col);
    }

    const curDepthM = Math.max(0, Math.floor((hookY - 14) * 1.5));
    print(curDepthM + "M", 100, 8, 12);

    // Initial controls prompt
    if (frame() < 90 && hookY < 20) {
      print("MOVE: LEFT/RIGHT", 32, 54, 7);
      print("REEL: UP/DOWN", 38, 62, 7);
    }

    // Game Over Overlay
    if (finished) {
      rectfill(14, 18, 100, 92, 0);
      rect(14, 18, 100, 92, 12);
      rect(16, 20, 96, 88, 7);

      print("EXPEDITION OVER!", 32, 26, 10);
      line(20, 34, 108, 34, 6);

      print("FINAL SCORE:", 22, 40, 7);
      print("" + totScore, 74, 40, 10);

      print("FISH CAUGHT:", 22, 52, 7);
      print("" + totFish, 74, 52, 11);

      print("MAX DEPTH:", 22, 64, 7);
      print(maxDepth + "M", 74, 64, 12);

      print("BEST CATCH:", 22, 76, 7);
      print(bestFishName, 22, 84, 14);

      print("THANKS FOR PLAYING", 28, 97, 6);
    }
  }
};
