// Asteroid Belt: Vector Survival
// Rotate and thrust through a dense asteroid field. Survive as long as you can!

let px, py, vx, vy, ang;
let shields, invuln, fireCd, alive;
let rocks, bullets, particles, stars;
let shake, rocksDestroyed;

function wrap(v, max) {
  return (v % max + max) % max;
}

function distSqWrapped(x1, y1, x2, y2) {
  let dx = Math.abs(x1 - x2);
  if (dx > 64) dx = 128 - dx;
  let dy = Math.abs(y1 - y2);
  if (dy > 64) dy = 128 - dy;
  return dx * dx + dy * dy;
}

function createRock(x, y, tier) {
  const r = tier === 3 ? 9 : tier === 2 ? 6 : 3.5;
  const numPts = 7;
  const offsets = [];
  for (let i = 0; i < numPts; i++) {
    offsets.push(r * (0.75 + rnd(0.5)));
  }
  const speed = 0.35 + (3 - tier) * 0.35 + rnd(0.3);
  const moveAng = rnd(Math.PI * 2);
  return {
    x,
    y,
    vx: Math.cos(moveAng) * speed,
    vy: Math.sin(moveAng) * speed,
    ang: rnd(Math.PI * 2),
    vAng: (rnd(0.06) - 0.03),
    r,
    tier,
    pts: offsets,
  };
}

function spawnDebris(x, y, count, colorArr) {
  for (let i = 0; i < count; i++) {
    const a = rnd(Math.PI * 2);
    const spd = 0.5 + rnd(2);
    particles.push({
      x,
      y,
      vx: Math.cos(a) * spd,
      vy: Math.sin(a) * spd,
      col: colorArr[Math.floor(rnd(colorArr.length))],
      life: 8 + Math.floor(rnd(14)),
    });
  }
}

export default {
  type: "survival",

  init(seed) {
    px = 64;
    py = 64;
    vx = 0;
    vy = 0;
    ang = -Math.PI / 2;
    shields = 3;
    invuln = 30;
    fireCd = 0;
    alive = true;
    shake = 0;
    rocksDestroyed = 0;

    rocks = [];
    bullets = [];
    particles = [];
    stars = [];

    // Background stars
    for (let i = 0; i < 35; i++) {
      stars.push({
        x: Math.floor(rnd(128)),
        y: Math.floor(rnd(128)),
        c: rnd(1) > 0.4 ? 5 : 6,
      });
    }

    // Initial safe asteroid ring
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + rnd(0.5);
      const d = 42 + rnd(16);
      rocks.push(createRock(wrap(64 + Math.cos(a) * d, 128), wrap(64 + Math.sin(a) * d, 128), 3));
    }
  },

  update(input) {
    if (!alive) return;

    const t = frame();

    // Controls: Rotate
    if (btn(0)) ang -= 0.11;
    if (btn(1)) ang += 0.11;

    // Thrust with inertia (Up or O)
    const thrusting = btn(2) || btn(4);
    if (thrusting) {
      vx += Math.cos(ang) * 0.16;
      vy += Math.sin(ang) * 0.16;

      // Exhaust thruster particles
      if (t % 2 === 0) {
        const backAng = ang + Math.PI + (rnd(0.6) - 0.3);
        const bx = px - Math.cos(ang) * 4;
        const by = py - Math.sin(ang) * 4;
        particles.push({
          x: bx,
          y: by,
          vx: Math.cos(backAng) * (1 + rnd(1.2)),
          vy: Math.sin(backAng) * (1 + rnd(1.2)),
          col: rnd(1) > 0.5 ? 10 : 9,
          life: 6 + Math.floor(rnd(6)),
        });
      }
    }

    // Space drag & speed limit
    vx *= 0.985;
    vy *= 0.985;
    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed > 3.2) {
      vx = (vx / speed) * 3.2;
      vy = (vy / speed) * 3.2;
    }

    px = wrap(px + vx, 128);
    py = wrap(py + vy, 128);

    // Shooting (X or Down)
    if (fireCd > 0) fireCd--;
    if ((btn(5) || btn(3)) && fireCd <= 0) {
      fireCd = 7;
      bullets.push({
        x: px + Math.cos(ang) * 5,
        y: py + Math.sin(ang) * 5,
        vx: Math.cos(ang) * 4.2 + vx * 0.3,
        vy: Math.sin(ang) * 4.2 + vy * 0.3,
        life: 22,
      });
    }

    // Update Bullets
    for (const b of bullets) {
      b.x = wrap(b.x + b.vx, 128);
      b.y = wrap(b.y + b.vy, 128);
      b.life--;
    }
    bullets = bullets.filter((b) => b.life > 0);

    // Spawn new asteroids over time
    const maxRocks = Math.min(14, 5 + Math.floor(t / 240));
    if (rocks.length < maxRocks && t % 75 === 0) {
      const edge = Math.floor(rnd(4));
      let sx = rnd(128);
      let sy = rnd(128);
      if (edge === 0) sy = 0;
      else if (edge === 1) sx = 127;
      else if (edge === 2) sy = 127;
      else sx = 0;
      // Ensure not spawning right on top of player
      if (distSqWrapped(px, py, sx, sy) > 35 * 35) {
        rocks.push(createRock(sx, sy, rnd(1) > 0.4 ? 3 : 2));
      }
    }

    // Update Rocks
    for (const r of rocks) {
      r.x = wrap(r.x + r.vx, 128);
      r.y = wrap(r.y + r.vy, 128);
      r.ang += r.vAng;
    }

    // Bullet vs Rock Collisions
    const nextRocks = [];
    for (let i = rocks.length - 1; i >= 0; i--) {
      const r = rocks[i];
      let destroyed = false;

      for (let j = bullets.length - 1; j >= 0; j--) {
        const b = bullets[j];
        if (distSqWrapped(b.x, b.y, r.x, r.y) < r.r * r.r) {
          destroyed = true;
          bullets.splice(j, 1);
          rocksDestroyed++;
          shake = 3;
          spawnDebris(r.x, r.y, 6 + r.tier * 3, [6, 7, 5, 10]);

          if (r.tier > 1) {
            nextRocks.push(createRock(r.x, r.y, r.tier - 1));
            nextRocks.push(createRock(r.x, r.y, r.tier - 1));
          }
          break;
        }
      }

      if (!destroyed) {
        nextRocks.push(r);
      }
    }
    rocks = nextRocks;

    // Player vs Rock Collisions
    if (invuln > 0) {
      invuln--;
    } else {
      for (let i = rocks.length - 1; i >= 0; i--) {
        const r = rocks[i];
        const hitRadius = r.r + 3.5;
        if (distSqWrapped(px, py, r.x, r.y) < hitRadius * hitRadius) {
          shields--;
          shake = 8;
          invuln = 45;

          // Impact kickback
          vx = -vx * 1.2 + (px - r.x) * 0.1;
          vy = -vy * 1.2 + (py - r.y) * 0.1;

          spawnDebris(px, py, 12, [8, 9, 10, 7]);
          rocks.splice(i, 1);

          if (shields <= 0) {
            alive = false;
            spawnDebris(px, py, 28, [8, 9, 10, 7, 6]);
            finish();
            break;
          }
        }
      }
    }

    // Update Particles
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.life--;
    }
    particles = particles.filter((p) => p.life > 0);

    if (shake > 0) shake--;

    // Highscore tracking seconds alive
    score(Math.floor(t / 30));
  },

  draw() {
    let ox = 0;
    let oy = 0;
    if (shake > 0) {
      ox = Math.floor(rnd(shake * 2 + 1)) - shake;
      oy = Math.floor(rnd(shake * 2 + 1)) - shake;
    }

    cls(0);

    // Stars
    for (const s of stars) {
      const sx = wrap(s.x + ox, 128);
      const sy = wrap(s.y + oy, 128);
      pset(sx, sy, s.c);
    }

    // Particles
    for (const p of particles) {
      pset(Math.floor(p.x + ox), Math.floor(p.y + oy), p.col);
    }

    // Asteroids
    for (const r of rocks) {
      const num = r.pts.length;
      const rx = r.x + ox;
      const ry = r.y + oy;

      circfill(Math.floor(rx), Math.floor(ry), Math.floor(r.r * 0.7), 0);

      for (let i = 0; i < num; i++) {
        const i2 = (i + 1) % num;
        const a1 = r.ang + (i * Math.PI * 2) / num;
        const a2 = r.ang + (i2 * Math.PI * 2) / num;
        const x1 = Math.floor(rx + Math.cos(a1) * r.pts[i]);
        const y1 = Math.floor(ry + Math.sin(a1) * r.pts[i]);
        const x2 = Math.floor(rx + Math.cos(a2) * r.pts[i2]);
        const y2 = Math.floor(ry + Math.sin(a2) * r.pts[i2]);
        line(x1, y1, x2, y2, r.tier === 3 ? 6 : r.tier === 2 ? 5 : 7);
      }
      // Crater detail
      if (r.tier >= 2) {
        pset(Math.floor(rx - 1), Math.floor(ry - 1), 5);
      }
    }

    // Bullets
    for (const b of bullets) {
      const bx = Math.floor(b.x + ox);
      const by = Math.floor(b.y + oy);
      rectfill(bx - 1, by - 1, 2, 2, 11);
    }

    // Player Ship
    if (alive) {
      // Blink when invulnerable
      if (invuln === 0 || Math.floor(invuln / 3) % 2 === 0) {
        const x = px + ox;
        const y = py + oy;
        const tipX = Math.floor(x + Math.cos(ang) * 6);
        const tipY = Math.floor(y + Math.sin(ang) * 6);
        const leftX = Math.floor(x + Math.cos(ang + 2.4) * 5.5);
        const leftY = Math.floor(y + Math.sin(ang + 2.4) * 5.5);
        const rightX = Math.floor(x + Math.cos(ang - 2.4) * 5.5);
        const rightY = Math.floor(y + Math.sin(ang - 2.4) * 5.5);
        const backX = Math.floor(x - Math.cos(ang) * 2);
        const backY = Math.floor(y - Math.sin(ang) * 2);

        line(tipX, tipY, leftX, leftY, 7);
        line(leftX, leftY, backX, backY, 12);
        line(backX, backY, rightX, rightY, 12);
        line(rightX, rightY, tipX, tipY, 7);
        pset(Math.floor(x), Math.floor(y), 10);

        // Thruster flame
        if ((btn(2) || btn(4)) && frame() % 4 < 3) {
          const fx = Math.floor(x - Math.cos(ang) * (5 + rnd(3)));
          const fy = Math.floor(y - Math.sin(ang) * (5 + rnd(3)));
          line(backX, backY, fx, fy, 9);
        }
      }
    }

    // HUD
    const timeSec = Math.floor(frame() / 30);
    print("TIME:" + timeSec + "S", 2, 2, 7);

    // Shields HUD
    print("SHIELD:", 68, 2, 6);
    for (let s = 0; s < 3; s++) {
      if (s < shields) {
        rectfill(100 + s * 9, 2, 7, 4, 11);
      } else {
        rect(100 + s * 9, 2, 7, 4, 8);
      }
    }

    // Speed indicator bar at bottom
    const curSpd = Math.sqrt(vx * vx + vy * vy);
    const spdW = Math.min(24, Math.floor(curSpd * 7.5));
    print("THRUST", 2, 122, 5);
    rect(28, 123, 26, 3, 5);
    if (spdW > 0) rectfill(29, 124, spdW, 1, 9);

    // Game Over Overlay
    if (!alive) {
      rectfill(18, 36, 92, 56, 0);
      rect(18, 36, 92, 56, 8);
      print("SHIP DESTROYED", 26, 44, 8);
      print("SURVIVED: " + timeSec + " SEC", 26, 56, 7);
      print("BLASTED:  " + rocksDestroyed + " ROCKS", 26, 66, 10);
      print("GAME OVER", 44, 78, 14);
    }
  },
};
