'use strict';

// The Among Us map, in a 1600x1000 "map space". The TV renders it centered in
// the 1920x1080 design space. Walls are axis-aligned rectangles; characters are
// circles that collide against them and the outer bounds.

const MAP = {
  w: 1600,
  h: 1000,
  walls: [
    { x: 330, y: 190, w: 220, h: 190 },   // top-left room block
    { x: 1050, y: 190, w: 220, h: 190 },  // top-right room block
    { x: 330, y: 620, w: 220, h: 190 },   // bottom-left room block
    { x: 1050, y: 620, w: 220, h: 190 },  // bottom-right room block
    { x: 760, y: 90, w: 80, h: 150 },     // top divider
    { x: 760, y: 760, w: 80, h: 150 },    // bottom divider
  ],
  // Spawn points in the open central area (kept clear of walls).
  spawns: [
    { x: 660, y: 430 }, { x: 800, y: 430 }, { x: 940, y: 430 }, { x: 720, y: 500 },
    { x: 880, y: 500 }, { x: 660, y: 570 }, { x: 800, y: 570 }, { x: 940, y: 570 },
  ],
  // Task stations (used in Phase 4).
  tasks: [
    { id: 't1', x: 200, y: 160 }, { id: 't2', x: 1400, y: 160 },
    { id: 't3', x: 200, y: 840 }, { id: 't4', x: 1400, y: 840 },
    { id: 't5', x: 800, y: 120 }, { id: 't6', x: 800, y: 880 },
  ],
};

module.exports = { MAP };
