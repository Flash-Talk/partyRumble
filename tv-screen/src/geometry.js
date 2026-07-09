// Arena geometry: field bounds, per-player triangular zones, goal openings,
// wall segments (with gaps at active goals), and the clamp used to keep a
// player inside their own wedge.

import { CONFIG, DESIGN } from './config.js';

const S = CONFIG.FIELD_SIZE;
const x0 = (DESIGN.W - S) / 2;
const y0 = (DESIGN.H - S) / 2;
const x1 = x0 + S;
const y1 = y0 + S;
const cx = x0 + S / 2;
const cy = y0 + S / 2;
const GH = CONFIG.GOAL_HALF;
const M = CONFIG.WEDGE_MARGIN;

export const FIELD = { x0, y0, x1, y1, cx, cy, size: S };

// Goal opening endpoints (a segment on the owning wall).
export const GOALS = {
  player_1: { side: 'top',    ax: cx - GH, ay: y0, bx: cx + GH, by: y0 },
  player_2: { side: 'right',  ax: x1, ay: cy - GH, bx: x1, by: cy + GH },
  player_3: { side: 'bottom', ax: cx - GH, ay: y1, bx: cx + GH, by: y1 },
  player_4: { side: 'left',   ax: x0, ay: cy - GH, bx: x0, by: cy + GH },
};

// Each player's triangular zone (inset by M).
export const WEDGES = {
  player_1: [{ x: x0 + M, y: y0 + M }, { x: x1 - M, y: y0 + M }, { x: cx, y: cy - M }],
  player_2: [{ x: x1 - M, y: y0 + M }, { x: x1 - M, y: y1 - M }, { x: cx + M, y: cy }],
  player_3: [{ x: x1 - M, y: y1 - M }, { x: x0 + M, y: y1 - M }, { x: cx, y: cy + M }],
  player_4: [{ x: x0 + M, y: y1 - M }, { x: x0 + M, y: y0 + M }, { x: cx - M, y: cy }],
};

// Where each player's disc spawns (near their own goal).
export const SPAWN = {
  player_1: { x: cx, y: y0 + 130 },
  player_2: { x: x1 - 130, y: cy },
  player_3: { x: cx, y: y1 - 130 },
  player_4: { x: x0 + 130, y: cy },
};

export function goalCenter(slot) {
  const g = GOALS[slot];
  return { x: (g.ax + g.bx) / 2, y: (g.ay + g.by) / 2 };
}

export function clampToWedge(slot, p) {
  const w = WEDGES[slot];
  return closestPointOnTriangle(p, w[0], w[1], w[2]);
}

// Returns the slot whose goal the ball has crossed into, or null.
// Only active goals count; solid (unclaimed) walls never score.
export function goalOwnerAt(bx, by, activeSlots) {
  if (activeSlots.includes('player_1') && by <= y0 && bx >= cx - GH && bx <= cx + GH) return 'player_1';
  if (activeSlots.includes('player_2') && bx >= x1 && by >= cy - GH && by <= cy + GH) return 'player_2';
  if (activeSlots.includes('player_3') && by >= y1 && bx >= cx - GH && bx <= cx + GH) return 'player_3';
  if (activeSlots.includes('player_4') && bx <= x0 && by >= cy - GH && by <= cy + GH) return 'player_4';
  return null;
}

// True once the ball is clearly outside the field (failsafe reset trigger).
export function isBallLost(bx, by, pad = 90) {
  return bx < x0 - pad || bx > x1 + pad || by < y0 - pad || by > y1 + pad;
}

// Wall rectangles {cx,cy,w,h}. Active walls leave a gap at the goal; unclaimed
// walls are solid so the ball can't score there.
export function buildWalls(activeSlots) {
  const T = CONFIG.WALL_THICKNESS;
  const rects = [];
  const has = (s) => activeSlots.includes(s);
  const hSeg = (xa, xb, y) => rects.push({ cx: (xa + xb) / 2, cy: y, w: xb - xa + T, h: T });
  const vSeg = (ya, yb, x) => rects.push({ cx: x, cy: (ya + yb) / 2, w: T, h: yb - ya + T });

  if (has('player_1')) { hSeg(x0, cx - GH, y0); hSeg(cx + GH, x1, y0); } else hSeg(x0, x1, y0);
  if (has('player_3')) { hSeg(x0, cx - GH, y1); hSeg(cx + GH, x1, y1); } else hSeg(x0, x1, y1);
  if (has('player_4')) { vSeg(y0, cy - GH, x0); vSeg(cy + GH, y1, x0); } else vSeg(y0, y1, x0);
  if (has('player_2')) { vSeg(y0, cy - GH, x1); vSeg(cy + GH, y1, x1); } else vSeg(y0, y1, x1);
  return rects;
}

// ---- closest point on a triangle (Ericson, Real-Time Collision Detection) ----
// Returns p unchanged if inside; otherwise the nearest point on the triangle.
function closestPointOnTriangle(p, a, b, c) {
  const abx = b.x - a.x, aby = b.y - a.y;
  const acx = c.x - a.x, acy = c.y - a.y;
  const apx = p.x - a.x, apy = p.y - a.y;
  const d1 = abx * apx + aby * apy;
  const d2 = acx * apx + acy * apy;
  if (d1 <= 0 && d2 <= 0) return { x: a.x, y: a.y };

  const bpx = p.x - b.x, bpy = p.y - b.y;
  const d3 = abx * bpx + aby * bpy;
  const d4 = acx * bpx + acy * bpy;
  if (d3 >= 0 && d4 <= d3) return { x: b.x, y: b.y };

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return { x: a.x + abx * v, y: a.y + aby * v };
  }

  const cpx = p.x - c.x, cpy = p.y - c.y;
  const d5 = abx * cpx + aby * cpy;
  const d6 = acx * cpx + acy * cpy;
  if (d6 >= 0 && d5 <= d6) return { x: c.x, y: c.y };

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return { x: a.x + acx * w, y: a.y + acy * w };
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return { x: b.x + (c.x - b.x) * w, y: b.y + (c.y - b.y) * w };
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  return { x: a.x + abx * v + acx * w, y: a.y + aby * v + acy * w };
}
