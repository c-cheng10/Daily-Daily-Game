// GLACIER SLIDE - Speedrun Ice Cave
// Use D-pad to skate & drift.
// Hold X to BRAKE (sharp turn).
// Press Z/O to DASH (burst momentum).

const TILE_FLOOR = 0;
const TILE_WALL = 1;
const TILE_SPIKE = 2;
const TILE_BOOST_R = 3;
const TILE_BOOST_L = 4;
const TILE_BOOST_U = 5;
const TILE_BOOST_D = 6;
const TILE_BUMPER = 7;
const TILE_GATE = 8;
const TILE_KEY = 9;
const TILE_EXIT = 10;

const MAPS = [
  // Stage 1: Drift Basin (1 Key)
  [
    "################",
    "#P.............#",
    "#..####...####.#",
    "#..####...####.#",
    "#..............#",
    "#####...##...###",
    "#.......##.....#",
    "#..B....##..K..#",
    "#.......##.....#",
    "###...######...#",
    "#..............#",
    "#..####..####..#",
    "#..#..G..#.....#",
    "#..#..#..#..E..#",
    "#..............#",
    "################"
  ],
  // Stage 2: Icicle Canyon (2 Keys, Boosters & Spikes)
  [
    "################",
    "#P...S....S...K#",
    "#....S....S....#",
    "#.>..........<.#",
    "#....######....#",
    "#S...#....#...S#",
    "#....#.B..#....#",
    "#....#....#....#",
    "#....######....#",
    "#S............S#",
    "#...B......B...#",
    "#.v..........v.#",
    "#K....####....G#",
    "######....####E#",
    "#..............#",
    "################"
  ],
  // Stage 3: Core of Frost (3 Keys, High Speed Chaos)
  [
    "################",
    "#P...#....#...K#",
    "#.>..#..S.#..<.#",
    "#....#....#....#",
    "##S######S######",
    "#..............#",
    "#.B...K..B...B.#",
    "#..............#",
    "######S######S##",
    "#....#....#....#",
    "#.^..#..S.#..^.#",
    "#....#....#....#",
    "##S######G######",
    "#K...S....S...E#",
    "#..............#",
    "################"
  ]
];

let stageIndex = 0;
let levelMap = [];
let keysLeft = 0;
let totalKeys = 0;
let px = 0, py = 0;
let startX = 0, startY = 0;
let vx = 0, vy = 0;
let faceX = 1, faceY = 0;
let dashCooldown = 0;
let dashTrail = 0;
let deathTimer = 0;
let winTimer = 0;
let gameFinished = false;
let finalTimeFrames = 0;
let particles = [];
let trails = [];
let scarf = [];
let shake = 0;

function parseMap(index) {
  const raw = MAPS[index];
  levelMap = [];
  keysLeft = 0;
  for (let y = 0; y < 16; y++) {
    levelMap[y] = [];
    for (let x = 0; x < 16; x++) {
      const ch = raw[y][x];
      let t = TILE_FLOOR;
      if (ch === "#") t = TILE_WALL;
      else if (ch === "S") t = TILE_SPIKE;
      else if (ch === ">") t = TILE_BOOST_R;
      else if (ch === "<") t = TILE_BOOST_L;
      else if (ch === "^") t = TILE_BOOST_U;
      else if (ch === "v") t = TILE_BOOST_D;
      else if (ch === "B") t = TILE_BUMPER;
      else if (ch === "G") t = TILE_GATE;
      else if (ch === "K") { t = TILE_KEY; keysLeft++; }
      else if (ch === "E") t = TILE_EXIT;
      else if (ch === "P") {
        startX = x * 8 + 4;
        startY = y * 8 + 4;
      }
      levelMap[y][x] = t;
    }
  }
  totalKeys = keysLeft;
  px = startX;
  py = startY;
  vx = 0;
  vy = 0;
  scarf = [];
  for (let i = 0; i < 6; i++) scarf.push({ x: px, y: py });
}

function spawnParticle(x, y, vx, vy, col, life) {
  if (particles.length < 80) {
    particles.push({ x, y, vx, vy, col, life, maxLife: life });
  }
}

function addTrail(x, y) {
  if (trails.length < 60) {
    trails.push({ x, y, alpha: 20 });
  }
}

function restartLevel(penalty = true) {
  deathTimer = 20;
  shake = 6;
  for (let i = 0; i < 16; i++) {
    const a = rnd(6.28);
    const spd = 0.5 + rnd(2.5);
    spawnParticle(px, py, Math.cos(a) * spd, Math.sin(a) * spd, rnd() < 0.5 ? 7 : 8, 20);
  }
  px = startX;
  py = startY;
  vx = 0;
  vy = 0;
}

function nextStage() {
  stageIndex++;
  shake = 4;
  for (let i = 0; i < 24; i++) {
    const a = rnd(6.28);
    const spd = 1 + rnd(2);
    spawnParticle(px, py, Math.cos(a) * spd, Math.sin(a) * spd, 10, 25);
  }
  if (stageIndex >= MAPS.length) {
    gameFinished = true;
    finalTimeFrames = frame();
    finish();
  } else {
    parseMap(stageIndex);
  }
}

function formatTime(f) {
  const totalSec = f / 30;
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  const cs = Math.floor((totalSec * 100) % 100);
  const sm = m < 10 ? "0" + m : "" + m;
  const ss = s < 10 ? "0" + s : "" + s;
  const sc = cs < 10 ? "0" + cs : "" + cs;
  return sm + ":" + ss + "." + sc;
}

export default {
  type: "speedrun",

  init(seed) {
    stageIndex = 0;
    gameFinished = false;
    winTimer = 0;
    deathTimer = 0;
    dashCooldown = 0;
    dashTrail = 0;
    particles = [];
    trails = [];
    shake = 0;
    parseMap(0);
  },

  update(input) {
    if (gameFinished) {
      winTimer++;
      return;
    }

    if (shake > 0) shake--;

    if (deathTimer > 0) {
      deathTimer--;
      return;
    }

    if (dashCooldown > 0) dashCooldown--;

    // Movement & Acceleration
    const acc = 0.22;
    let ix = 0;
    let iy = 0;
    if (btn(0)) ix -= 1;
    if (btn(1)) ix += 1;
    if (btn(2)) iy -= 1;
    if (btn(3)) iy += 1;

    if (ix !== 0 && iy !== 0) {
      ix *= 0.7071;
      iy *= 0.7071;
    }

    if (ix !== 0 || iy !== 0) {
      faceX = ix;
      faceY = iy;
      vx += ix * acc;
      vy += iy * acc;
    }

    // Brake mechanic (btn 5 / X key)
    const isBraking = btn(5);
    const friction = isBraking ? 0.82 : 0.968;
    vx *= friction;
    vy *= friction;

    if (isBraking && (Math.abs(vx) > 0.3 || Math.abs(vy) > 0.3)) {
      if (frame() % 2 === 0) {
        spawnParticle(px + (rnd(4) - 2), py + (rnd(4) - 2), -vx * 0.4 + (rnd(0.6) - 0.3), -vy * 0.4 + (rnd(0.6) - 0.3), 7, 8);
      }
    }

    // Dash burst mechanic (btn 4 / Z key)
    if (btnp(4) && dashCooldown <= 0) {
      dashCooldown = 22;
      dashTrail = 8;
      shake = 3;
      let dLen = Math.sqrt(faceX * faceX + faceY * faceY);
      if (dLen < 0.1) {
        dLen = 1;
        faceX = 1;
        faceY = 0;
      }
      vx += (faceX / dLen) * 3.4;
      vy += (faceY / dLen) * 3.4;
      for (let i = 0; i < 10; i++) {
        spawnParticle(px, py, -faceX * 1.5 + (rnd(2) - 1), -faceY * 1.5 + (rnd(2) - 1), 12, 12);
      }
    }

    // Clamp absolute top speed to avoid tunneling
    const spd = Math.sqrt(vx * vx + vy * vy);
    if (spd > 4.2) {
      vx = (vx / spd) * 4.2;
      vy = (vy / spd) * 4.2;
    }

    // Scarf trail logic
    if (scarf.length === 0) {
      for (let i = 0; i < 6; i++) scarf.push({ x: px, y: py });
    }
    scarf[0].x = px;
    scarf[0].y = py;
    for (let i = 1; i < scarf.length; i++) {
      scarf[i].x += (scarf[i - 1].x - scarf[i].x) * 0.45;
      scarf[i].y += (scarf[i - 1].y - scarf[i].y) * 0.45;
    }

    // Skate mark trail
    if (spd > 0.8 && frame() % 3 === 0) {
      addTrail(px, py);
    }

    // Integrate X
    px += vx;
    // Check horizontal collisions (radius 3)
    let leftTile = Math.floor((px - 3) / 8);
    let rightTile = Math.floor((px + 3) / 8);
    let topTile = Math.floor((py - 3) / 8);
    let bottomTile = Math.floor((py + 3) / 8);

    for (let ty = topTile; ty <= bottomTile; ty++) {
      for (let tx = leftTile; tx <= rightTile; tx++) {
        if (ty >= 0 && ty < 16 && tx >= 0 && tx < 16) {
          const t = levelMap[ty][tx];
          const isSolid = (t === TILE_WALL) || (t === TILE_GATE && keysLeft > 0);
          if (isSolid) {
            if (vx > 0) {
              px = tx * 8 - 3.1;
              vx = -vx * 0.45;
            } else if (vx < 0) {
              px = (tx + 1) * 8 + 3.1;
              vx = -vx * 0.45;
            }
          }
        }
      }
    }

    // Integrate Y
    py += vy;
    leftTile = Math.floor((px - 3) / 8);
    rightTile = Math.floor((px + 3) / 8);
    topTile = Math.floor((py - 3) / 8);
    bottomTile = Math.floor((py + 3) / 8);

    for (let ty = topTile; ty <= bottomTile; ty++) {
      for (let tx = leftTile; tx <= rightTile; tx++) {
        if (ty >= 0 && ty < 16 && tx >= 0 && tx < 16) {
          const t = levelMap[ty][tx];
          const isSolid = (t === TILE_WALL) || (t === TILE_GATE && keysLeft > 0);
          if (isSolid) {
            if (vy > 0) {
              py = ty * 8 - 3.1;
              vy = -vy * 0.45;
            } else if (vy < 0) {
              py = (ty + 1) * 8 + 3.1;
              vy = -vy * 0.45;
            }
          }
        }
      }
    }

    // Interact with center tile & surrounding
    const ctx = Math.floor(px / 8);
    const cty = Math.floor(py / 8);

    if (ctx >= 0 && ctx < 16 && cty >= 0 && cty < 16) {
      const tile = levelMap[cty][ctx];

      // Spike check
      if (tile === TILE_SPIKE) {
        restartLevel();
        return;
      }

      // Boosters
      if (tile === TILE_BOOST_R) { vx += 0.8; vy *= 0.5; }
      else if (tile === TILE_BOOST_L) { vx -= 0.8; vy *= 0.5; }
      else if (tile === TILE_BOOST_U) { vy -= 0.8; vx *= 0.5; }
      else if (tile === TILE_BOOST_D) { vy += 0.8; vx *= 0.5; }

      // Key collection
      if (tile === TILE_KEY) {
        levelMap[cty][ctx] = TILE_FLOOR;
        keysLeft--;
        shake = 3;
        for (let i = 0; i < 12; i++) {
          spawnParticle(ctx * 8 + 4, cty * 8 + 4, (rnd(2) - 1) * 2, (rnd(2) - 1) * 2, 10, 15);
        }
      }

      // Bumper bounce
      if (tile === TILE_BUMPER) {
        const bx = ctx * 8 + 4;
        const by = cty * 8 + 4;
        const dx = px - bx;
        const dy = py - by;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 6.5) {
          const nx = dist > 0.01 ? dx / dist : 1;
          const ny = dist > 0.01 ? dy / dist : 0;
          vx = nx * 3.8;
          vy = ny * 3.8;
          shake = 4;
          for (let i = 0; i < 8; i++) {
            spawnParticle(bx, by, nx * 2 + (rnd(2) - 1), ny * 2 + (rnd(2) - 1), 14, 12);
          }
        }
      }

      // Exit ladder
      if (tile === TILE_EXIT) {
        nextStage();
        return;
      }
    }

    // Update trails
    for (let i = trails.length - 1; i >= 0; i--) {
      trails[i].alpha--;
      if (trails[i].alpha <= 0) trails.splice(i, 1);
    }

    // Update particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life--;
      if (p.life <= 0) particles.splice(i, 1);
    }
  },

  draw() {
    cls(1);

    const ox = shake > 0 ? Math.floor(rnd(3) - 1) : 0;
    const oy = shake > 0 ? Math.floor(rnd(3) - 1) : 0;

    // Draw Ice Arena Map
    for (let ty = 0; ty < 16; ty++) {
      for (let tx = 0; tx < 16; tx++) {
        const x = tx * 8 + ox;
        const y = ty * 8 + oy;
        const t = levelMap[ty][tx];

        if (t === TILE_WALL) {
          rectfill(x, y, 8, 8, 2);
          rectfill(x + 1, y + 1, 6, 6, 1);
          pset(x + 2, y + 2, 5);
        } else {
          // Ice floor
          rectfill(x, y, 8, 8, 12);
          // Subtle ice tile texture
          if ((tx + ty) % 2 === 0) {
            pset(x + 7, y + 7, 13);
          }
          if ((tx * 7 + ty * 13) % 11 === 0) {
            line(x + 2, y + 2, x + 5, y + 4, 7);
          }

          if (t === TILE_SPIKE) {
            // Deadly red/lavender spikes
            line(x + 1, y + 6, x + 3, y + 1, 8);
            line(x + 3, y + 1, x + 5, y + 6, 8);
            line(x + 4, y + 7, x + 6, y + 2, 7);
            line(x + 6, y + 2, x + 7, y + 7, 7);
          } else if (t === TILE_BUMPER) {
            circfill(x + 4, y + 4, 3, 14);
            circfill(x + 4, y + 4, 1, 7);
          } else if (t === TILE_BOOST_R) {
            line(x + 2, y + 4, x + 6, y + 4, 11);
            line(x + 5, y + 2, x + 7, y + 4, 7);
            line(x + 5, y + 6, x + 7, y + 4, 7);
          } else if (t === TILE_BOOST_L) {
            line(x + 6, y + 4, x + 2, y + 4, 11);
            line(x + 3, y + 2, x + 1, y + 4, 7);
            line(x + 3, y + 6, x + 1, y + 4, 7);
          } else if (t === TILE_BOOST_U) {
            line(x + 4, y + 6, x + 4, y + 2, 11);
            line(x + 2, y + 3, x + 4, y + 1, 7);
            line(x + 6, y + 3, x + 4, y + 1, 7);
          } else if (t === TILE_BOOST_D) {
            line(x + 4, y + 2, x + 4, y + 6, 11);
            line(x + 2, y + 5, x + 4, y + 7, 7);
            line(x + 6, y + 5, x + 4, y + 7, 7);
          } else if (t === TILE_GATE) {
            if (keysLeft > 0) {
              rectfill(x, y, 8, 8, 8);
              rect(x + 1, y + 1, 6, 6, 7);
              line(x + 2, y + 2, x + 6, y + 6, 0);
              line(x + 2, y + 6, x + 6, y + 2, 0);
            } else {
              rect(x + 1, y + 1, 6, 6, 11);
            }
          } else if (t === TILE_KEY) {
            circfill(x + 4, y + 4, 2, 10);
            pset(x + 4, y + 3, 7);
            pset(x + 4, y + 5, 9);
          } else if (t === TILE_EXIT) {
            rectfill(x + 1, y + 1, 6, 6, 0);
            rect(x + 2, y + 2, 4, 4, 11);
            line(x + 3, y + 3, x + 5, y + 5, 7);
          }
        }
      }
    }

    // Skate scratch trails
    for (let i = 0; i < trails.length; i++) {
      const tr = trails[i];
      pset(tr.x + ox, tr.y + oy, tr.alpha > 10 ? 7 : 13);
    }

    // Particles
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      pset(p.x + ox, p.y + oy, p.col);
    }

    // Player scarf
    if (deathTimer <= 0) {
      for (let i = scarf.length - 1; i >= 1; i--) {
        const seg = scarf[i];
        circfill(seg.x + ox, seg.y + oy, i > 3 ? 1 : 1.5, i % 2 === 0 ? 9 : 10);
      }

      // Player body (Frost Skater)
      const curX = px + ox;
      const curY = py + oy;
      circfill(curX, curY, 3.5, 7);
      circfill(curX, curY - 1, 2, 15);
      // Goggles
      const gx = curX + (faceX > 0.3 ? 1 : faceX < -0.3 ? -1 : 0);
      const gy = curY - 1;
      pset(gx, gy, 8);
      pset(gx + 1, gy, 8);

      // Dash ready ring / indicator
      if (dashCooldown <= 0) {
        pset(curX - 4, curY, 11);
        pset(curX + 4, curY, 11);
      }
    }

    // HUD banner
    rectfill(0, 0, 128, 9, 0);
    line(0, 9, 128, 9, 5);

    const timeStr = formatTime(gameFinished ? finalTimeFrames : frame());
    print("TIME " + timeStr, 2, 2, 7);

    // Crystals / Keys remaining
    if (!gameFinished) {
      const cStr = "KEY:" + (totalKeys - keysLeft) + "/" + totalKeys;
      print(cStr, 88, 2, keysLeft === 0 ? 11 : 10);
    }

    // Floor title banner briefly on stage entry
    if (deathTimer > 0) {
      rectfill(28, 56, 72, 16, 0);
      rect(28, 56, 72, 16, 8);
      print("SHATTERED!", 42, 61, 8);
    }

    // Speedrun Finish Screen
    if (gameFinished) {
      rectfill(16, 28, 96, 72, 0);
      rect(16, 28, 96, 72, 11);
      rect(18, 30, 92, 68, 12);
      rectfill(20, 32, 88, 64, 0);

      print("CAVERN CLEARED!", 32, 38, 10);
      print("FINAL TIME", 44, 52, 7);
      print(formatTime(finalTimeFrames), 42, 62, 11);
      print("RANK: " + (finalTimeFrames < 900 ? "S (ICE GOD)" : finalTimeFrames < 1400 ? "A (PRO DRIFT)" : "B (GLACIER)"), 26, 76, 7);
      print("Z: DASH  X: BRAKE", 30, 86, 6);
    }
  }
};
