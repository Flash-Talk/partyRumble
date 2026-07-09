// The match. Runs the whole simulation locally on the TV, driven by the
// per-slot input snapshot in Net. Server only relays input.
import Net from '../net.js';
import {
  DESIGN, CONFIG, SLOT_META, hexToNum,
} from '../config.js';
import {
  FIELD, GOALS, WEDGES, SPAWN, goalCenter, clampToWedge, goalOwnerAt, isBallLost, buildWalls,
} from '../geometry.js';

const { DISC_RADIUS: DR, BALL_RADIUS: BR } = CONFIG;

export default class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  create() {
    this.cameras.main.setBackgroundColor('#0a0e1a');

    // Snapshot the roster for this match.
    this.slots = Net.activeSlots();
    this.meta = {};
    for (const slot of this.slots) {
      const p = Net.players.get(slot);
      this.meta[slot] = {
        name: p ? p.name : SLOT_META[slot].label,
        color: p ? p.color : SLOT_META[slot].color,
      };
    }

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
    this.createWalls();
    this.createDiscs();
    this.createBall();
    this.createHud();

    // Keyboard fallback: arrows + SPACE drive the first player (solo testing).
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keyShoot = this.input.keyboard.addKey('SPACE');
    this.debugSlot = this.slots[0];

    // Mid-match leaver: drop their disc; if they held the ball, free it.
    this.onPlayerLeft = (slot) => this.removeSlot(slot);
    Net.events.on('player_left', this.onPlayerLeft);
    this.events.once('shutdown', () => Net.events.off('player_left', this.onPlayerLeft));

    this.dropBall();
  }

  // ---- setup helpers -------------------------------------------------------

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
    // Field backdrop.
    g.fillStyle(0x111731, 1);
    g.fillRect(FIELD.x0, FIELD.y0, FIELD.size, FIELD.size);

    // Faint per-zone tint in each active player's color.
    for (const slot of this.slots) {
      const w = WEDGES[slot];
      g.fillStyle(hexToNum(this.meta[slot].color), 0.07);
      g.beginPath();
      g.moveTo(w[0].x, w[0].y);
      g.lineTo(w[1].x, w[1].y);
      g.lineTo(w[2].x, w[2].y);
      g.closePath();
      g.fillPath();
    }

    // Diagonals + center marker.
    g.lineStyle(2, 0x263056, 0.8);
    g.lineBetween(FIELD.x0, FIELD.y0, FIELD.x1, FIELD.y1);
    g.lineBetween(FIELD.x1, FIELD.y0, FIELD.x0, FIELD.y1);
    g.lineStyle(3, 0x2a3350, 1);
    g.strokeCircle(FIELD.cx, FIELD.cy, 60);

    // Colored goal openings for active players.
    for (const slot of this.slots) {
      const go = GOALS[slot];
      g.lineStyle(10, hexToNum(this.meta[slot].color), 1);
      g.lineBetween(go.ax, go.ay, go.bx, go.by);
    }
  }

  createWalls() {
    this.wallObjs = [];
    for (const r of buildWalls(this.slots)) {
      const w = this.add.rectangle(r.cx, r.cy, r.w, r.h, 0x39406b);
      this.physics.add.existing(w, true); // static body
      this.wallObjs.push(w);
    }
  }

  createDiscs() {
    this.discGroup = this.physics.add.group();
    this.state = {};
    for (const slot of this.slots) {
      const sp = SPAWN[slot];
      const disc = this.discGroup.create(sp.x, sp.y, 'discTex');
      disc.setTint(hexToNum(this.meta[slot].color));
      disc.body.setCircle(DR);
      disc.body.pushable = false;
      disc.slot = slot;

      // A small label so players find their disc.
      const label = this.add.text(sp.x, sp.y, SLOT_META[slot].label, {
        fontFamily: 'system-ui, sans-serif', fontSize: '26px', fontStyle: 'bold', color: '#0a0e1a',
      }).setOrigin(0.5);

      this.state[slot] = {
        disc, label,
        scored: 0, conceded: 0,
        cooldownUntil: 0, prevShoot: false,
        aim: this.defaultAim(slot),
      };
    }
  }

  createBall() {
    this.ball = this.physics.add.image(FIELD.cx, FIELD.cy, 'ballTex');
    this.ball.body.setCircle(BR);
    this.ball.setBounce(1);
    this.ball.body.setDrag(CONFIG.BALL_DRAG, CONFIG.BALL_DRAG);
    this.ball.setDamping(false);
    this.ball.lastTouch = null;

    this.physics.add.collider(this.ball, this.wallObjs);
    this.physics.add.collider(this.ball, this.discGroup, (ball, disc) => {
      // Any contact counts as a touch (deflection/save credits the last toucher).
      if (this.heldBy !== disc.slot) ball.lastTouch = disc.slot;
    });
  }

  createHud() {
    this.timerText = this.add.text(DESIGN.W / 2, 24, '', {
      fontFamily: 'system-ui, sans-serif', fontSize: '52px', fontStyle: 'bold', color: '#eef1f7',
    }).setOrigin(0.5, 0);

    this.banner = this.add.text(FIELD.cx, FIELD.cy - 40, '', {
      fontFamily: 'system-ui, sans-serif', fontSize: '110px', fontStyle: 'bold', color: '#eef1f7',
    }).setOrigin(0.5).setDepth(10);

    // Four corner panels (each labeled with its side so goals are unambiguous).
    const corners = {
      player_1: { x: 30, y: 26, ox: 0 },
      player_2: { x: DESIGN.W - 30, y: 26, ox: 1 },
      player_3: { x: DESIGN.W - 30, y: DESIGN.H - 92, ox: 1 },
      player_4: { x: 30, y: DESIGN.H - 92, ox: 0 },
    };
    this.hud = {};
    for (const slot of this.slots) {
      const c = corners[slot];
      const t = this.add.text(c.x, c.y, '', {
        fontFamily: 'system-ui, sans-serif', fontSize: '34px', fontStyle: 'bold',
        color: this.meta[slot].color, align: c.ox ? 'right' : 'left',
      }).setOrigin(c.ox, 0);
      this.hud[slot] = t;
    }
  }

  // ---- ball lifecycle ------------------------------------------------------

  dropBall() {
    this.heldBy = null;
    this.ballFrozen = true;
    this.ball.lastTouch = null;
    this.ball.body.setVelocity(0, 0);
    this.ball.setPosition(FIELD.cx, FIELD.cy);

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
    const sp = SPAWN[slot];
    const dir = normalize(sp.x - FIELD.cx, sp.y - FIELD.cy);
    this.ball.body.setVelocity(dir.x * CONFIG.RELEASE_SPEED, dir.y * CONFIG.RELEASE_SPEED);
  }

  // ---- per-frame -----------------------------------------------------------

  update(t, dtMs) {
    if (this.over) return;
    const dt = dtMs / 1000;

    this.moveDiscs(dt);

    if (!this.ballFrozen) {
      this.updatePossession(t);
      this.capBallSpeed();
      this.updateIdle(dtMs);
      this.checkGoals();
    }

    // Match clock.
    if (!this.suddenDeath && this.matchStarted && this.time.now >= this.matchEndAt) {
      this.handleTimeUp();
    }
    this.updateHud();

    // Latch shoot state for rising-edge detection next frame.
    for (const slot of this.slots) this.state[slot].prevShoot = this.getSlotInput(slot).shoot;
  }

  moveDiscs(dt) {
    for (const slot of this.slots) {
      const st = this.state[slot];
      const inp = this.getSlotInput(slot);
      let vx = inp.x, vy = inp.y;
      const m = Math.hypot(vx, vy);
      if (m > 1) { vx /= m; vy /= m; }

      st.disc.body.setVelocity(vx * CONFIG.MOVE_SPEED, vy * CONFIG.MOVE_SPEED);

      const c = clampToWedge(slot, { x: st.disc.x, y: st.disc.y });
      if (Math.abs(c.x - st.disc.x) > 0.01 || Math.abs(c.y - st.disc.y) > 0.01) {
        st.disc.body.reset(c.x, c.y);
      }
      st.label.setPosition(st.disc.x, st.disc.y);
    }
  }

  updatePossession(t) {
    if (this.heldBy && this.state[this.heldBy]) {
      const holder = this.heldBy;
      const st = this.state[holder];
      const inp = this.getSlotInput(holder);

      // Aim from the joystick, else auto-aim at the nearest opponent goal.
      let ax = inp.x, ay = inp.y;
      const am = Math.hypot(ax, ay);
      if (am > 0.25) { ax /= am; ay /= am; st.aim = { x: ax, y: ay }; }
      else st.aim = this.autoAim(holder);

      const off = DR + BR + CONFIG.HOLD_OFFSET;
      this.ball.body.setVelocity(0, 0);
      this.ball.setPosition(st.disc.x + st.aim.x * off, st.disc.y + st.aim.y * off);

      const rising = inp.shoot && !st.prevShoot;
      if (t - this.holdStart > CONFIG.HOLD_MS) this.shoot(holder, CONFIG.RELEASE_SPEED, t);
      else if (rising) this.shoot(holder, CONFIG.SHOOT_SPEED, t);
      return;
    }

    // No holder: a slow enough ball near an off-cooldown disc gets trapped.
    if (this.ballSpeed() <= CONFIG.TRAP_SPEED) {
      let best = null, bestD = Infinity;
      for (const slot of this.slots) {
        const st = this.state[slot];
        if (t < st.cooldownUntil) continue;
        const d = Math.hypot(this.ball.x - st.disc.x, this.ball.y - st.disc.y);
        if (d <= DR + BR + CONFIG.TRAP_PAD && d < bestD) { best = slot; bestD = d; }
      }
      if (best) this.trap(best, t);
    }
  }

  trap(slot, t) {
    this.heldBy = slot;
    this.holdStart = t;
    this.ball.lastTouch = slot;
    this.ball.body.setVelocity(0, 0);
    this.state[slot].aim = this.autoAim(slot);
  }

  shoot(slot, speed, t) {
    const a = this.state[slot].aim;
    this.ball.body.setVelocity(a.x * speed, a.y * speed);
    this.ball.lastTouch = slot;
    this.state[slot].cooldownUntil = t + CONFIG.TRAP_COOLDOWN_MS;
    this.heldBy = null;
  }

  capBallSpeed() {
    const b = this.ball.body;
    const s = Math.hypot(b.velocity.x, b.velocity.y);
    if (s > CONFIG.BALL_MAX_SPEED) {
      const k = CONFIG.BALL_MAX_SPEED / s;
      b.velocity.x *= k; b.velocity.y *= k;
    }
  }

  updateIdle(dtMs) {
    if (this.heldBy) { this.ballIdle = 0; return; }
    if (this.ballSpeed() < 25) {
      this.ballIdle += dtMs;
      if (this.ballIdle > CONFIG.IDLE_NUDGE_MS) { this.launchBallToRandom(); this.ballIdle = 0; }
    } else {
      this.ballIdle = 0;
    }
  }

  checkGoals() {
    const owner = goalOwnerAt(this.ball.x, this.ball.y, this.slots);
    if (owner) { this.onGoal(owner); return; }
    if (isBallLost(this.ball.x, this.ball.y)) this.dropBall();
  }

  onGoal(owner) {
    const scorer = this.ball.lastTouch;
    this.state[owner].conceded += 1;
    let msg = 'OWN GOAL';
    let color = this.meta[owner].color;
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
    if (this.uniqueLeader(s)) {
      this.endMatch(s);
    } else {
      this.suddenDeath = true;
      this.showBanner('SUDDEN DEATH', '#fbbf24', 1600);
    }
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
    this.time.delayedCall(600, () => this.scene.start('ResultScene', {
      standings, roomCode: Net.roomCode,
    }));
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

  defaultAim(slot) {
    // Point roughly toward the center of the field to start.
    return normalize(FIELD.cx - SPAWN[slot].x, FIELD.cy - SPAWN[slot].y);
  }

  autoAim(slot) {
    const from = this.state[slot].disc;
    let best = null, bestD = Infinity;
    for (const other of this.slots) {
      if (other === slot) continue;
      const g = goalCenter(other);
      const d = Math.hypot(g.x - from.x, g.y - from.y);
      if (d < bestD) { bestD = d; best = g; }
    }
    if (!best) return this.defaultAim(slot);
    return normalize(best.x - from.x, best.y - from.y);
  }

  // ---- misc ----------------------------------------------------------------

  ballSpeed() {
    return Math.hypot(this.ball.body.velocity.x, this.ball.body.velocity.y);
  }

  removeSlot(slot) {
    const i = this.slots.indexOf(slot);
    if (i === -1) return;
    this.slots.splice(i, 1);
    if (this.heldBy === slot) this.heldBy = null;
    const st = this.state[slot];
    if (st) { st.disc.destroy(); st.label.destroy(); }
    if (this.hud[slot]) { this.hud[slot].setText(''); }
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
      const side = SLOT_META[slot].side.toUpperCase();
      this.hud[slot].setText(`${side} · ${this.meta[slot].name}\n${signed(diff)}   ${st.scored}-${st.conceded}`);
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
