// Parametric arena. Given the ordered list of active player slots (2-8), builds
// a regular polygon where each player owns one edge (their goal) and an equal
// triangular zone from that edge to the center. 2 players get a face-off
// rectangle instead. The ball's wall bounces are resolved here (manual, because
// Arcade physics bodies are axis-aligned and can't represent angled walls).

import { CONFIG, DESIGN } from './config.js';

const C = { x: DESIGN.W / 2, y: DESIGN.H / 2 };

export function buildArena(slots) {
  return new Arena(slots);
}

class Arena {
  constructor(slots) {
    this.slots = slots.slice();
    this.N = this.slots.length;
    this.center = { x: C.x, y: C.y };
    this.verts = [];
    this.edges = [];      // { A, B, ex, ey, len, normal(inward), owner|null, t0, t1 }
    this.zones = {};      // slot -> inset convex polygon [pts]
    this.spawns = {};     // slot -> spawn point
    this.goalMids = {};   // slot -> goal center on the wall

    if (this.N === 2) this._buildDuel();
    else this._buildPolygon();
  }

  _buildPolygon() {
    const R = CONFIG.ARENA_RADIUS;
    const N = this.N;
    const step = (Math.PI * 2) / N;
    const a0 = Math.PI / 2 - Math.PI / N; // orient so edge 0 sits at the bottom
    for (let k = 0; k < N; k++) {
      this.verts.push({ x: C.x + R * Math.cos(a0 + k * step), y: C.y + R * Math.sin(a0 + k * step) });
    }
    const gf = CONFIG.GOAL_FRACTION;
    for (let i = 0; i < N; i++) {
      const A = this.verts[i];
      const B = this.verts[(i + 1) % N];
      const owner = this.slots[i];
      this._addEdge(A, B, owner, (1 - gf) / 2, (1 + gf) / 2);
      this.zones[owner] = insetPolygon([this.center, A, B], CONFIG.WEDGE_MARGIN);
      const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
      this.goalMids[owner] = mid;
      this.spawns[owner] = lerp(mid, this.center, 0.3);
    }
  }

  _buildDuel() {
    const S = CONFIG.ARENA_RADIUS * 1.7;
    const hw = S / 2;
    const x0 = C.x - hw, x1 = C.x + hw, y0 = C.y - hw, y1 = C.y + hw;
    this.verts = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    const gf = CONFIG.GOAL_FRACTION;
    const g0 = (1 - gf) / 2, g1 = (1 + gf) / 2;
    const [p0, p1] = this.slots;

    this._addEdge({ x: x0, y: y0 }, { x: x1, y: y0 }, null);           // top wall
    this._addEdge({ x: x1, y: y0 }, { x: x1, y: y1 }, p1, g0, g1);     // right goal
    this._addEdge({ x: x1, y: y1 }, { x: x0, y: y1 }, null);           // bottom wall
    this._addEdge({ x: x0, y: y1 }, { x: x0, y: y0 }, p0, g0, g1);     // left goal

    this.zones[p0] = insetPolygon(
      [{ x: x0, y: y0 }, { x: C.x, y: y0 }, { x: C.x, y: y1 }, { x: x0, y: y1 }], CONFIG.WEDGE_MARGIN);
    this.zones[p1] = insetPolygon(
      [{ x: C.x, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: C.x, y: y1 }], CONFIG.WEDGE_MARGIN);
    this.goalMids[p0] = { x: x0, y: C.y };
    this.goalMids[p1] = { x: x1, y: C.y };
    this.spawns[p0] = { x: x0 + 130, y: C.y };
    this.spawns[p1] = { x: x1 - 130, y: C.y };
  }

  _addEdge(A, B, owner, t0 = 0, t1 = 0) {
    const ex = B.x - A.x, ey = B.y - A.y;
    const len = Math.hypot(ex, ey);
    let nx = -ey / len, ny = ex / len;
    const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
    if ((C.x - mx) * nx + (C.y - my) * ny < 0) { nx = -nx; ny = -ny; } // point inward
    this.edges.push({ A, B, ex, ey, len, normal: { x: nx, y: ny }, owner, t0, t1 });
  }

  clamp(slot, p) {
    return closestPointInConvexPolygon(p, this.zones[slot]);
  }

  goalCenter(slot) {
    return this.goalMids[slot];
  }

  // Goal opening endpoints for an owner edge (for drawing).
  goalSegment(edge) {
    return [lerp(edge.A, edge.B, edge.t0), lerp(edge.A, edge.B, edge.t1)];
  }

  /**
   * Resolve wall bounces, mutating {pos, vel} in place. Convex containment:
   * each edge is an inward half-plane; if the ball pokes past one (and isn't in
   * that edge's goal mouth) it's pushed back and its velocity reflected.
   * @returns the slot whose goal was scored on, or null.
   */
  collideWall(pos, vel, r) {
    let goalOwner = null;
    for (const e of this.edges) {
      const d = (pos.x - e.A.x) * e.normal.x + (pos.y - e.A.y) * e.normal.y; // + inside
      if (d >= r) continue;
      const t = ((pos.x - e.A.x) * e.ex + (pos.y - e.A.y) * e.ey) / (e.len * e.len);
      if (e.owner && t > e.t0 && t < e.t1) {
        if (d < 0) goalOwner = e.owner; // passed through the opening
        continue;                       // never bounce inside the goal mouth
      }
      const pen = r - d;
      pos.x += e.normal.x * pen;
      pos.y += e.normal.y * pen;
      const vn = vel.x * e.normal.x + vel.y * e.normal.y;
      if (vn < 0) { vel.x -= 2 * vn * e.normal.x; vel.y -= 2 * vn * e.normal.y; }
    }
    return goalOwner;
  }
}

// ---- geometry helpers ------------------------------------------------------

function lerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function insetPolygon(poly, m) {
  const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
  return poly.map((p) => {
    const dx = cx - p.x, dy = cy - p.y;
    const d = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / d) * m, y: p.y + (dy / d) * m };
  });
}

function closestPointOnSegment(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y;
  const len2 = abx * abx + aby * aby || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  return { x: a.x + abx * t, y: a.y + aby * t };
}

function pointInConvexPolygon(p, poly) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cross === 0) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function closestPointInConvexPolygon(p, poly) {
  if (pointInConvexPolygon(p, poly)) return { x: p.x, y: p.y };
  let best = null, bd = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const q = closestPointOnSegment(p, poly[i], poly[(i + 1) % poly.length]);
    const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
    if (d < bd) { bd = d; best = q; }
  }
  return best || { x: p.x, y: p.y };
}
