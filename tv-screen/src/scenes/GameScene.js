// The match. Runs the whole simulation locally on the TV with a manual physics
// loop (so the polygon arena's angled walls bounce correctly). Server only
// relays input. Supports 2-8 players on an arena that fits the player count.
import Net from '../net.js';
import { DESIGN, CONFIG, SLOT_META, hexToNum } from '../config.js';
import { buildArena } from '../geometry.js';

const { DISC_RADIUS: DR, BALL_RADIUS: BR } = CONFIG;

export default class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  create() {
    this.cameras.main.setBackgroundColor('#0a0e1a');

    this.slots = Net.activeSlots();
    this.meta = {};
    for (const slot of this.slots) {
      const p = Net.players.get(slot);
      this.meta[slot] = {
        name: p ? p.name : SLOT_META[slot].label,
        color: p ? p.color : SLOT_META[slot].color,
      };
    }
    this.arena = buildArena(this.slots);

    this.bvel = { x: 0, y: 0 };
    this.lastTouch = null;
    this.heldBy = null;
    this.holdStart = 0;
    this.ballFrozen = true;
    this.ballIdle = 0;
    this.over = false;
    this.suddenDeath = false;
    this.matchStarted = false;
    this.matchEndAt = this.time.now + CONFIG.MATCH_SECONDS * 1000;

    this.makeCircleTexture('discTex', DR);
    this.makeCircleTexture('ballTex', BR);

    this.drawField();
    this.createDiscs();
    this.createBall();
    this.createHud();

    this.cursors = this.input.keyboard.createCursorKeys();
    this.keyShoot = this.input.keyboard.addKey('SPACE');
    this.debugSlot = this.slots[0];

    this.onPlayerLeft = (slot) => this.removeSlot(slot);
    Net.events.on('player_left', this.onPlayerLeft);
    this.events.once('shutdown', () => Net.events.off('player_left', this.onPlayerLeft));

    this.dropBall();
  }

  // ---- setup ---------------------------------------------------------------

  makeCircleTexture(key, r) {
    if (this.textures.exists(key)) return;
    const g = this.make.graphics({ add: false });
    g.fillStyle(0xffffff, 1);
    g.fillCircle(r, r, r);
    g.generateTexture(key, r * 2, r * 2);
    g.destroy();
  }

  drawField() {
    const g = this.add.graphics();
    const v = this.arena.verts;

    // Arena floor.
    g.fillStyle(0x111731, 1);
    g.beginPath();
    g.moveTo(v[0].x, v[0].y);
    for (let i = 1; i < v.length; i++) g.lineTo(v[i].x, v[i].y);
    g.closePath();
    g.fillPath();

    // Zone tints per player.
    for (const slot of this.slots) {
      const poly = this.arena.zones[slot];
      g.fillStyle(hexToNum(this.meta[slot].color), 0.08);
      g.beginPath();
      g.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) g.lineTo(poly[i].x, poly[i].y);
      g.closePath();
      g.fillPath();
    }

    // Walls (neutral) + goal openings (owner color).
    for (const e of this.arena.edges) {
      if (e.owner) {
        const [ga, gb] = this.arena.goalSegment(e);
        g.lineStyle(6, 0x39406b, 1);
        g.lineBetween(e.A.x, e.A.y, ga.x, ga.y);
        g.lineBetween(gb.x, gb.y, e.B.x, e.B.y);
        g.lineStyle(12, hexToNum(this.meta[e.owner].color), 1);
        g.lineBetween(ga.x, ga.y, gb.x, gb.y);
      } else {
        g.lineStyle(6, 0x39406b, 1);
        g.lineBetween(e.A.x, e.A.y, e.B.x, e.B.y);
      }
    }

    g.lineStyle(3, 0x2a3350, 1);
    g.strokeCircle(this.arena.center.x, this.arena.center.y, 46);
  }

  createDiscs() {
    this.state = {};
    for (const slot of this.slots) {
      const sp = this.arena.spawns[slot];
      const disc = this.add.image(sp.x, sp.y, 'discTex').setTint(hexToNum(this.meta[slot].color));
      const label = this.add.text(sp.x, sp.y, SLOT_META[slot].label, {
        fontFamily: 'system-ui, sans-serif', fontSize: '24px', fontStyle: 'bold', color: '#0a0e1a',
      }).setOrigin(0.5);
      this.state[slot] = {
        disc, label,
        scored: 0, conceded: 0,
        cooldownUntil: 0, prevShoot: false,
        aim: this.autoAimFrom(sp, slot),
        discVel: { x: 0, y: 0 },
      };
    }
  }

  createBall() {
    this.ball = this.add.image(this.arena.center.x, this.arena.center.y, 'ballTex');
    this.ball.setDepth(5);
  }

  createHud() {
    this.timerText = this.add.text(DESIGN.W / 2, 20, '', {
      fontFamily: 'system-ui, sans-serif', fontSize: '52px', fontStyle: 'bold', color: '#eef1f7',
    }).setOrigin(0.5, 0).setDepth(20);

    this.banner = this.add.text(this.arena.center.x, this.arena.center.y - 40, '', {
      fontFamily: 'system-ui, sans-serif', fontSize: '104px', fontStyle: 'bold', color: '#eef1f7',
    }).setOrigin(0.5).setDepth(20);

    this.add.text(30, 92, 'SCORES', {
      fontFamily: 'system-ui, sans-serif', fontSize: '24px', color: '#8b93a7',
    }).setDepth(20);

    this.hudRows = {};
    this.slots.forEach((slot, i) => {
      const y = 140 + i * 58;
      const swatch = this.add.rectangle(44, y + 15, 30, 30, hexToNum(this.meta[slot].color)).setDepth(20);
      const text = this.add.text(70, y, '', {
        fontFamily: 'system-ui, sans-serif', fontSize: '28px', fontStyle: 'bold', color: this.meta[slot].color,
      }).setDepth(20);
      this.hudRows[slot] = { swatch, text };
    });
  }

  // ---- ball lifecycle ------------------------------------------------------

  dropBall() {
    this.heldBy = null;
    this.ballFrozen = true;
    this.lastTouch = null;
    this.bvel.x = 0; this.bvel.y = 0;
    this.ball.setPosition(this.arena.center.x, this.arena.center.y);

    this.time.delayedCall(CONFIG.RESET_DELAY_MS, () => {
      if (this.over) return;
      this.ballFrozen = false;
      this.ballIdle = 0;
      if (!this.matchStarted) {
        this.matchStarted = true;
        this.matchEndAt = this.time.now + CONFIG.MATCH_SECONDS * 1000;
      }
      this.launchBallToRandom();
    });
  }

  launchBallToRandom() {
    if (this.slots.length === 0) return;
    const slot = this.slots[Phaser.Math.Between(0, this.slots.length - 1)];
    const sp = this.arena.spawns[slot];
    const d = normalize(sp.x - this.arena.center.x, sp.y - this.arena.center.y);
    this.bvel.x = d.x * CONFIG.RELEASE_SPEED;
    this.bvel.y = d.y * CONFIG.RELEASE_SPEED;
  }

  // ---- per-frame -----------------------------------------------------------

  update(t, dtMs) {
    if (this.over) return;
    const dt = Math.min(dtMs, 50) / 1000;

    this.moveDiscs(dt);
    if (!this.ballFrozen && dt > 0) this.simulateBall(dt, t);

    if (!this.suddenDeath && this.matchStarted && this.time.now >= this.matchEndAt) {
      this.handleTimeUp();
    }
    this.updateHud();

    for (const slot of this.slots) this.state[slot].prevShoot = this.getSlotInput(slot).shoot;
  }

  moveDiscs(dt) {
    for (const slot of this.slots) {
      const st = this.state[slot];
      const inp = this.getSlotInput(slot);
      let vx = inp.x, vy = inp.y;
      const m = Math.hypot(vx, vy);
      if (m > 1) { vx /= m; vy /= m; }

      const target = { x: st.disc.x + vx * CONFIG.MOVE_SPEED * dt, y: st.disc.y + vy * CONFIG.MOVE_SPEED * dt };
      const c = this.arena.clamp(slot, target);
      st.discVel = dt > 0 ? { x: (c.x - st.disc.x) / dt, y: (c.y - st.disc.y) / dt } : { x: 0, y: 0 };
      st.disc.setPosition(c.x, c.y);
      st.label.setPosition(c.x, c.y);
    }
  }

  simulateBall(dt, t) {
    if (!this.heldBy) this.tryTrap(t);
    if (this.heldBy) { this.holdLogic(t); return; }

    // Drag, then integrate.
    const sp = this.ballSpeed();
    if (sp > 0) {
      const ns = Math.max(0, sp - CONFIG.BALL_DRAG * dt);
      this.bvel.x = this.bvel.x / sp * ns;
      this.bvel.y = this.bvel.y / sp * ns;
    }
    this.ball.x += this.bvel.x * dt;
    this.ball.y += this.bvel.y * dt;

    const pos = { x: this.ball.x, y: this.ball.y };
    const owner = this.arena.collideWall(pos, this.bvel, BR);
    this.ball.setPosition(pos.x, pos.y);

    this.collideDiscs();
    this.capSpeed();
    this.updateIdle(dt);

    if (owner) this.onGoal(owner);
  }

  tryTrap(t) {
    if (this.ballSpeed() > CONFIG.TRAP_SPEED) return;
    let best = null, bestD = Infinity;
    for (const slot of this.slots) {
      const st = this.state[slot];
      if (t < st.cooldownUntil) continue;
      const d = Math.hypot(this.ball.x - st.disc.x, this.ball.y - st.disc.y);
      if (d <= DR + BR + CONFIG.TRAP_PAD && d < bestD) { best = slot; bestD = d; }
    }
    if (best) {
      this.heldBy = best;
      this.holdStart = t;
      this.lastTouch = best;
      this.bvel.x = 0; this.bvel.y = 0;
      this.state[best].aim = this.autoAim(best);
    }
  }

  holdLogic(t) {
    const holder = this.heldBy;
    const st = this.state[holder];
    if (!st) { this.heldBy = null; return; }
    const inp = this.getSlotInput(holder);

    let ax = inp.x, ay = inp.y;
    const am = Math.hypot(ax, ay);
    if (am > 0.25) { st.aim = { x: ax / am, y: ay / am }; }
    else st.aim = this.autoAim(holder);

    const off = DR + BR + CONFIG.HOLD_OFFSET;
    this.ball.setPosition(st.disc.x + st.aim.x * off, st.disc.y + st.aim.y * off);
    this.bvel.x = 0; this.bvel.y = 0;

    const rising = inp.shoot && !st.prevShoot;
    if (t - this.holdStart > CONFIG.HOLD_MS) this.shoot(holder, CONFIG.RELEASE_SPEED, t);
    else if (rising) this.shoot(holder, CONFIG.SHOOT_SPEED, t);
  }

  shoot(slot, speed, t) {
    const a = this.state[slot].aim;
    this.bvel.x = a.x * speed;
    this.bvel.y = a.y * speed;
    this.lastTouch = slot;
    this.state[slot].cooldownUntil = t + CONFIG.TRAP_COOLDOWN_MS;
    this.heldBy = null;
  }

  collideDiscs() {
    const minD = DR + BR;
    for (const slot of this.slots) {
      const st = this.state[slot];
      const dx = this.ball.x - st.disc.x;
      const dy = this.ball.y - st.disc.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= 0 || dist >= minD) continue;

      const nx = dx / dist, ny = dy / dist;
      this.ball.setPosition(st.disc.x + nx * minD, st.disc.y + ny * minD);
      const vn = this.bvel.x * nx + this.bvel.y * ny;
      if (vn < 0) { this.bvel.x -= 2 * vn * nx; this.bvel.y -= 2 * vn * ny; }
      this.bvel.x += st.discVel.x * CONFIG.DISC_KICK;
      this.bvel.y += st.discVel.y * CONFIG.DISC_KICK;
      this.lastTouch = slot;
    }
  }

  capSpeed() {
    const s = this.ballSpeed();
    if (s > CONFIG.BALL_MAX_SPEED) {
      const k = CONFIG.BALL_MAX_SPEED / s;
      this.bvel.x *= k; this.bvel.y *= k;
    }
  }

  updateIdle(dt) {
    if (this.heldBy) { this.ballIdle = 0; return; }
    if (this.ballSpeed() < 25) {
      this.ballIdle += dt * 1000;
      if (this.ballIdle > CONFIG.IDLE_NUDGE_MS) { this.launchBallToRandom(); this.ballIdle = 0; }
    } else {
      this.ballIdle = 0;
    }
  }

  onGoal(owner) {
    const scorer = this.lastTouch;
    let msg = 'OWN GOAL';
    let color = this.meta[owner] ? this.meta[owner].color : '#ffffff';
    if (this.state[owner]) this.state[owner].conceded += 1;
    if (scorer && scorer !== owner && this.state[scorer]) {
      this.state[scorer].scored += 1;
      msg = `${this.meta[scorer].name} SCORES!`;
      color = this.meta[scorer].color;
    }

    this.cameras.main.flash(250, 255, 255, 255);
    this.showBanner(msg, color);
    this.dropBall();

    if (this.suddenDeath) {
      const s = this.standings();
      if (this.uniqueLeader(s)) this.endMatch(s);
    }
  }

  // ---- match end -----------------------------------------------------------

  handleTimeUp() {
    const s = this.standings();
    if (this.uniqueLeader(s)) this.endMatch(s);
    else { this.suddenDeath = true; this.showBanner('SUDDEN DEATH', '#fbbf24', 1600); }
  }

  standings() {
    return this.slots
      .map((slot) => ({
        slot,
        name: this.meta[slot].name,
        color: this.meta[slot].color,
        scored: this.state[slot].scored,
        conceded: this.state[slot].conceded,
        diff: this.state[slot].scored - this.state[slot].conceded,
      }))
      .sort((a, b) => (b.diff - a.diff) || (b.scored - a.scored));
  }

  uniqueLeader(s) {
    return s.length > 0 && (s.length === 1 || s[0].diff > s[1].diff);
  }

  endMatch(standings) {
    if (this.over) return;
    this.over = true;
    this.time.delayedCall(600, () => this.scene.start('ResultScene', { standings, roomCode: Net.roomCode }));
  }

  // ---- input / aim ---------------------------------------------------------

  getSlotInput(slot) {
    const net = Net.getInput(slot);
    if (slot === this.debugSlot && this.cursors) {
      const kx = (this.cursors.right.isDown ? 1 : 0) - (this.cursors.left.isDown ? 1 : 0);
      const ky = (this.cursors.down.isDown ? 1 : 0) - (this.cursors.up.isDown ? 1 : 0);
      const ks = this.keyShoot.isDown;
      if (kx || ky || ks) return { x: kx || net.x, y: ky || net.y, shoot: ks || net.shoot };
    }
    return net;
  }

  autoAim(slot) {
    return this.autoAimFrom(this.state[slot].disc, slot);
  }

  autoAimFrom(from, slot) {
    let best = null, bestD = Infinity;
    for (const other of this.slots) {
      if (other === slot) continue;
      const g = this.arena.goalCenter(other);
      const d = Math.hypot(g.x - from.x, g.y - from.y);
      if (d < bestD) { bestD = d; best = g; }
    }
    if (!best) return normalize(this.arena.center.x - from.x, this.arena.center.y - from.y);
    return normalize(best.x - from.x, best.y - from.y);
  }

  // ---- misc ----------------------------------------------------------------

  ballSpeed() {
    return Math.hypot(this.bvel.x, this.bvel.y);
  }

  removeSlot(slot) {
    const i = this.slots.indexOf(slot);
    if (i === -1) return;
    this.slots.splice(i, 1);
    if (this.heldBy === slot) this.heldBy = null;
    const st = this.state[slot];
    if (st) { st.disc.destroy(); st.label.destroy(); delete this.state[slot]; }
    if (this.hudRows[slot]) { this.hudRows[slot].text.setText(''); this.hudRows[slot].swatch.setVisible(false); }
  }

  showBanner(text, color, ms = 1100) {
    this.banner.setText(text).setColor(color).setAlpha(1);
    this.tweens.add({ targets: this.banner, alpha: 0, delay: ms * 0.5, duration: ms * 0.5 });
  }

  updateHud() {
    const remaining = this.suddenDeath
      ? 0
      : Math.max(0, this.matchStarted ? this.matchEndAt - this.time.now : CONFIG.MATCH_SECONDS * 1000);
    this.timerText.setText(this.suddenDeath ? 'SUDDEN DEATH' : formatClock(remaining));

    for (const slot of this.slots) {
      const st = this.state[slot];
      const diff = st.scored - st.conceded;
      this.hudRows[slot].text.setText(`${this.meta[slot].name}   ${signed(diff)}   ${st.scored}-${st.conceded}`);
    }
  }
}

function normalize(x, y) {
  const m = Math.hypot(x, y);
  if (m === 0) return { x: 0, y: -1 };
  return { x: x / m, y: y / m };
}
function signed(n) { return (n > 0 ? '+' : '') + n; }
function formatClock(ms) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
