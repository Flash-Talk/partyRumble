'use strict';

// Authoritative Among Us simulation (Phase 1: movement + roles). The server owns
// this so the imposter's identity never reaches the shared TV. publicState() is
// anonymized (color + position only; a name appears only once a player is dead;
// roles are NEVER exposed).

const { MAP } = require('./map');

const SPEED = 330;   // px/s in map space
const RADIUS = 26;

function resolveCircleRect(p, r, rect) {
  const cx = Math.max(rect.x, Math.min(p.x, rect.x + rect.w));
  const cy = Math.max(rect.y, Math.min(p.y, rect.y + rect.h));
  const dx = p.x - cx;
  const dy = p.y - cy;
  const d = Math.hypot(dx, dy);
  if (d >= r) return;
  if (d === 0) { // center inside the rect — push out the nearest side
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
  /** @param {string[]} slots  @param {{[slot]:{name,color}}} meta */
  constructor(slots, meta = {}, opts = {}) {
    this.slots = slots.slice();
    this.rng = opts.rng || Math.random;
    this.map = MAP;
    this.radius = RADIUS;
    this.phase = 'play'; // play | meeting | over
    this.winner = null;
    this.imposter = null;
    this.players = {};
    this._assign(meta);
  }

  _assign(meta) {
    this.imposter = this.slots[Math.floor(this.rng() * this.slots.length)];
    this.slots.forEach((slot, i) => {
      const sp = this.map.spawns[i % this.map.spawns.length];
      const m = meta[slot] || {};
      this.players[slot] = {
        slot,
        name: m.name || slot,
        color: m.color || '#cccccc',
        x: sp.x, y: sp.y,
        input: { x: 0, y: 0 },
        alive: true,
        role: slot === this.imposter ? 'imposter' : 'crew',
      };
    });
  }

  setInputAxis(slot, id, value) {
    const p = this.players[slot];
    if (!p || !p.alive) return;
    if (id === 'x') p.input.x = value;
    else if (id === 'y') p.input.y = value;
  }

  step(dt) {
    if (this.phase !== 'play') return;
    for (const slot of this.slots) {
      const p = this.players[slot];
      if (!p || !p.alive) continue;
      let ix = p.input.x, iy = p.input.y;
      const m = Math.hypot(ix, iy);
      if (m > 1) { ix /= m; iy /= m; }
      p.x += ix * SPEED * dt;
      p.y += iy * SPEED * dt;
      p.x = Math.max(this.radius, Math.min(this.map.w - this.radius, p.x));
      p.y = Math.max(this.radius, Math.min(this.map.h - this.radius, p.y));
      for (const w of this.map.walls) resolveCircleRect(p, this.radius, w);
    }
  }

  publicState() {
    return {
      phase: this.phase,
      winner: this.winner,
      players: this.slots.map((s) => {
        const p = this.players[s];
        return {
          id: s,
          color: p.color,
          x: Math.round(p.x),
          y: Math.round(p.y),
          alive: p.alive,
          name: p.alive ? null : p.name, // revealed only on death
        };
      }),
    };
  }

  roleFor(slot) {
    const p = this.players[slot];
    if (!p) return null;
    return { role: p.role, color: p.color, id: slot };
  }

  removePlayer(slot) {
    delete this.players[slot];
    this.slots = this.slots.filter((s) => s !== slot);
  }
}

module.exports = { AmongUsGame };
