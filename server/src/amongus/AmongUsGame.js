'use strict';

// Authoritative Among Us simulation (Phases 1-4): movement, hidden roles,
// proximity kill + death reveal, meetings + live voting + win conditions, and
// task minigames (crew win path). Server-owned so the imposter's identity never
// reaches the shared TV. publicState() is anonymized.

const { MAP } = require('./map');

const SPEED = 385;              // a touch faster for the bigger map
const RADIUS = 26;
const KILL_RANGE = 110;
const KILL_COOLDOWN_MS = 12000; // shorter -> more action
const MEETING_MS = 30000;
const REVEAL_MS = 4500;
const TASK_RANGE = 105;
const TASKS_PER_PLAYER = 3;
const TASK_TYPES = ['hold', 'tap'];

function resolveCircleRect(p, r, rect) {
  const cx = Math.max(rect.x, Math.min(p.x, rect.x + rect.w));
  const cy = Math.max(rect.y, Math.min(p.y, rect.y + rect.h));
  const dx = p.x - cx, dy = p.y - cy;
  const d = Math.hypot(dx, dy);
  if (d >= r) return;
  if (d === 0) {
    const left = p.x - rect.x, right = rect.x + rect.w - p.x;
    const top = p.y - rect.y, bottom = rect.y + rect.h - p.y;
    const m = Math.min(left, right, top, bottom);
    if (m === left) p.x = rect.x - r;
    else if (m === right) p.x = rect.x + rect.w + r;
    else if (m === top) p.y = rect.y - r;
    else p.y = rect.y + rect.h + r;
    return;
  }
  const push = r - d;
  p.x += (dx / d) * push;
  p.y += (dy / d) * push;
}

class AmongUsGame {
  constructor(slots, meta = {}, opts = {}) {
    this.slots = slots.slice();
    this.rng = opts.rng || Math.random;
    this.map = MAP;
    this.radius = RADIUS;
    this.phase = 'play';
    this.winner = null;
    this.imposter = null;
    this.players = {};
    this.votes = {};
    this.result = null;
    this.killedThisMeeting = null;
    this.killReadyAt = 0;
    this.meetingEndAt = 0;
    this.revealEndAt = 0;
    this.realTaskTotal = 0;
    this._assign(meta);
    this._assignTasks();
  }

  _assign(meta) {
    this.imposter = this.slots[Math.floor(this.rng() * this.slots.length)];
    this.slots.forEach((slot, i) => {
      const sp = this.map.spawns[i % this.map.spawns.length];
      const m = meta[slot] || {};
      this.players[slot] = {
        slot, name: m.name || slot, color: m.color || '#cccccc',
        x: sp.x, y: sp.y, input: { x: 0, y: 0 },
        alive: true, role: slot === this.imposter ? 'imposter' : 'crew', tasks: [],
      };
    });
  }

  _assignTasks() {
    const stationIds = this.map.tasks.map((t) => t.id);
    let realTotal = 0;
    this.slots.forEach((slot, idx) => {
      const p = this.players[slot];
      const shuffled = stationIds.slice().sort(() => this.rng() - 0.5);
      const picks = shuffled.slice(0, Math.min(TASKS_PER_PLAYER, stationIds.length));
      p.tasks = picks.map((sid, i) => ({ stationId: sid, type: TASK_TYPES[(idx + i) % TASK_TYPES.length], done: false }));
      if (p.role === 'crew') realTotal += p.tasks.length; // imposter tasks are fake (cover)
    });
    this.realTaskTotal = realTotal;
  }

  // ---- helpers ----
  aliveSlots() { return this.slots.filter((s) => this.players[s].alive); }
  aliveCrew() { return this.aliveSlots().filter((s) => this.players[s].role === 'crew').length; }
  aliveImp() { return this.aliveSlots().filter((s) => this.players[s].role === 'imposter').length; }

  _nearestCrew(slot) {
    const me = this.players[slot];
    let best = null, bd = Infinity;
    for (const s of this.slots) {
      const p = this.players[s];
      if (s === slot || !p.alive || p.role === 'imposter') continue;
      const d = Math.hypot(p.x - me.x, p.y - me.y);
      if (d < bd) { bd = d; best = s; }
    }
    return best && bd <= KILL_RANGE ? best : null;
  }

  canKill(slot, now) {
    const p = this.players[slot];
    return this.phase === 'play' && p && p.alive && p.role === 'imposter'
      && now >= this.killReadyAt && !!this._nearestCrew(slot);
  }

  taskNear(slot) {
    const p = this.players[slot];
    if (!p) return null;
    for (const t of p.tasks) {
      if (t.done) continue;
      const st = this.map.tasks.find((s) => s.id === t.stationId);
      if (st && Math.hypot(p.x - st.x, p.y - st.y) <= TASK_RANGE) return { stationId: t.stationId, type: t.type };
    }
    return null;
  }

  taskProgress() {
    if (this.realTaskTotal === 0) return 0;
    let done = 0;
    for (const s of this.slots) {
      const p = this.players[s];
      if (p.role === 'crew') done += p.tasks.filter((t) => t.done).length;
    }
    return done / this.realTaskTotal;
  }

  // ---- movement (ghosts move too and phase through walls) ----
  setInputAxis(slot, id, value) {
    const p = this.players[slot];
    if (!p || this.phase !== 'play') return;
    if (id === 'x') p.input.x = value;
    else if (id === 'y') p.input.y = value;
  }

  step(dt) {
    if (this.phase !== 'play') return;
    for (const slot of this.slots) {
      const p = this.players[slot];
      if (!p) continue;
      let ix = p.input.x, iy = p.input.y;
      const m = Math.hypot(ix, iy);
      if (m > 1) { ix /= m; iy /= m; }
      p.x += ix * SPEED * dt;
      p.y += iy * SPEED * dt;
      p.x = Math.max(this.radius, Math.min(this.map.w - this.radius, p.x));
      p.y = Math.max(this.radius, Math.min(this.map.h - this.radius, p.y));
      if (p.alive) for (const w of this.map.walls) resolveCircleRect(p, this.radius, w);
    }
  }

  // ---- actions ----
  tryKill(slot, now) {
    if (!this.canKill(slot, now)) return { ok: false };
    const victim = this._nearestCrew(slot);
    if (!victim) return { ok: false };
    this.players[victim].alive = false;
    this.players[victim].input = { x: 0, y: 0 };
    this._startMeeting(now, victim);
    return { ok: true, victim };
  }

  completeTask(slot, stationId) {
    if (this.phase !== 'play') return { ok: false };
    const p = this.players[slot];
    if (!p) return { ok: false };
    const task = p.tasks.find((t) => t.stationId === stationId && !t.done);
    if (!task) return { ok: false };
    const st = this.map.tasks.find((s) => s.id === stationId);
    if (!st || Math.hypot(p.x - st.x, p.y - st.y) > TASK_RANGE) return { ok: false };
    task.done = true;
    if (this.realTaskTotal > 0 && this.taskProgress() >= 1) { this.winner = 'crew'; this.phase = 'over'; }
    return { ok: true };
  }

  _startMeeting(now, killedSlot) {
    this.phase = 'meeting';
    this.meetingEndAt = now + MEETING_MS;
    this.votes = {};
    this.killedThisMeeting = killedSlot || null;
    for (const s of this.slots) this.players[s].input = { x: 0, y: 0 };
  }

  vote(slot, target) {
    if (this.phase !== 'meeting') return { ok: false };
    const p = this.players[slot];
    if (!p || !p.alive || this.votes[slot] !== undefined) return { ok: false };
    if (target !== 'skip' && !(this.players[target] && this.players[target].alive)) return { ok: false };
    this.votes[slot] = target;
    return { ok: true };
  }

  allVoted() { return this.aliveSlots().every((s) => this.votes[s] !== undefined); }
  shouldResolve(now) { return this.phase === 'meeting' && (this.allVoted() || now >= this.meetingEndAt); }
  revealDone(now) { return this.phase === 'reveal' && now >= this.revealEndAt; }

  _tally() {
    const counts = {};
    let skip = 0;
    for (const s of this.aliveSlots()) {
      const t = this.votes[s];
      if (t === undefined) continue;
      if (t === 'skip') skip += 1;
      else counts[t] = (counts[t] || 0) + 1;
    }
    return { counts, skip };
  }

  resolveMeeting(now) {
    const { counts, skip } = this._tally();
    let top = null, topN = 0, tie = false;
    for (const [id, n] of Object.entries(counts)) {
      if (n > topN) { top = id; topN = n; tie = false; }
      else if (n === topN) tie = true;
    }
    let ejected = null;
    if (top && !tie && topN > skip) { ejected = top; this.players[top].alive = false; }

    this.result = {
      ejected,
      ejectedName: ejected ? this.players[ejected].name : null,
      ejectedColor: ejected ? this.players[ejected].color : null,
      wasImposter: ejected ? this.players[ejected].role === 'imposter' : false,
      skipped: !ejected,
    };

    const winner = this._winner();
    if (winner) { this.result.winner = winner; this.winner = winner; this.phase = 'over'; }
    else { this.phase = 'reveal'; this.revealEndAt = now + REVEAL_MS; }
    return this.result;
  }

  _winner() {
    if (this.aliveImp() === 0) return 'crew';
    if (this.aliveImp() >= this.aliveCrew()) return 'imposter';
    if (this.realTaskTotal > 0 && this.taskProgress() >= 1) return 'crew';
    return null;
  }

  startPlayRound(now) {
    this.phase = 'play';
    this.killReadyAt = now + KILL_COOLDOWN_MS;
    this.result = null;
    this.killedThisMeeting = null;
    this.votes = {};
  }

  // ---- state for clients ----
  publicState(now) {
    return {
      phase: this.phase,
      winner: this.winner,
      taskBar: this.taskProgress(),
      players: this.slots.map((s) => {
        const p = this.players[s];
        return {
          id: s, color: p.color, x: Math.round(p.x), y: Math.round(p.y),
          alive: p.alive, name: p.alive ? null : p.name,
        };
      }),
      meeting: this.phase === 'meeting' ? {
        tally: this._tally(),
        candidates: this.aliveSlots().map((s) => ({ id: s, color: this.players[s].color })),
        killed: this.killedThisMeeting
          ? { name: this.players[this.killedThisMeeting].name, color: this.players[this.killedThisMeeting].color } : null,
        timeLeft: Math.max(0, Math.ceil((this.meetingEndAt - now) / 1000)),
      } : null,
      result: (this.phase === 'reveal' || this.phase === 'over') ? this.result : null,
    };
  }

  privateFor(slot, now) {
    const p = this.players[slot];
    if (!p) return { alive: false, role: 'crew', phase: this.phase };
    const out = { alive: p.alive, role: p.role, phase: this.phase };
    if (this.phase === 'play') {
      out.canKill = this.canKill(slot, now);
      out.killCooldown = Math.max(0, Math.ceil((this.killReadyAt - now) / 1000));
      out.taskHere = this.taskNear(slot);
      out.tasksLeft = p.tasks.filter((t) => !t.done).length;
      out.tasksTotal = p.tasks.length;
    } else if (this.phase === 'meeting') {
      out.candidates = this.aliveSlots().map((s) => ({ id: s, color: this.players[s].color }));
      out.canVote = p.alive;
      out.hasVoted = this.votes[slot] !== undefined;
      out.myVote = this.votes[slot] ?? null;
      out.tally = this._tally();
      out.killed = this.killedThisMeeting
        ? { name: this.players[this.killedThisMeeting].name, color: this.players[this.killedThisMeeting].color } : null;
      out.timeLeft = Math.max(0, Math.ceil((this.meetingEndAt - now) / 1000));
    } else if (this.phase === 'reveal') {
      out.result = this.result;
    }
    return out;
  }

  roleFor(slot) {
    const p = this.players[slot];
    return p ? { role: p.role, color: p.color, id: slot } : null;
  }

  removePlayer(slot) {
    delete this.players[slot];
    this.slots = this.slots.filter((s) => s !== slot);
    delete this.votes[slot];
    // recompute crew task total so a departed crew doesn't block the task win
    let realTotal = 0;
    for (const s of this.slots) { const p = this.players[s]; if (p.role === 'crew') realTotal += p.tasks.length; }
    this.realTaskTotal = realTotal;
  }
}

module.exports = { AmongUsGame };
