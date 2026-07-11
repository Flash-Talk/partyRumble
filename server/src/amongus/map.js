'use strict';

// The Among Us map, in a 2000x1150 "map space" (the TV scales it to fit). A
// central hub connects four quadrant rooms via doorways, with partial dividers
// and cover blocks carving more distinct areas. Characters are circles that
// collide against the walls and outer bounds.

const MAP = {
  w: 2000,
  h: 1150,
  walls: [
    // central "+" dividers (doorways: x 820..1180, y 435..715)
    { x: 40, y: 563, w: 780, h: 24 }, { x: 1180, y: 563, w: 780, h: 24 },
    { x: 988, y: 40, w: 24, h: 395 }, { x: 988, y: 715, w: 24, h: 395 },
    // quadrant sub-dividers (partial — carve rooms without enclosing)
    { x: 480, y: 40, w: 24, h: 300 }, { x: 1496, y: 40, w: 24, h: 300 },
    { x: 480, y: 810, w: 24, h: 300 }, { x: 1496, y: 810, w: 24, h: 300 },
    { x: 40, y: 300, w: 300, h: 24 }, { x: 1660, y: 300, w: 300, h: 24 },
    { x: 40, y: 826, w: 300, h: 24 }, { x: 1660, y: 826, w: 300, h: 24 },
    // cover blocks
    { x: 640, y: 210, w: 180, h: 150 }, { x: 1180, y: 210, w: 180, h: 150 },
    { x: 640, y: 790, w: 180, h: 150 }, { x: 1180, y: 790, w: 180, h: 150 },
  ],
  // Spawns cluster in the open central hub.
  spawns: [
    { x: 920, y: 500 }, { x: 1080, y: 500 }, { x: 920, y: 650 }, { x: 1080, y: 650 },
    { x: 1000, y: 470 }, { x: 1000, y: 680 }, { x: 860, y: 575 }, { x: 1140, y: 575 },
  ],
  // Task stations, spread through the rooms (kept in reachable open areas).
  tasks: [
    { id: 't1', x: 180, y: 150 }, { id: 't2', x: 1820, y: 150 },
    { id: 't3', x: 180, y: 1000 }, { id: 't4', x: 1820, y: 1000 },
    { id: 't5', x: 620, y: 470 }, { id: 't6', x: 1380, y: 470 },
    { id: 't7', x: 620, y: 690 }, { id: 't8', x: 1380, y: 690 },
    { id: 't9', x: 1000, y: 150 }, { id: 't10', x: 1000, y: 1000 },
  ],
  // Vents (imposter-only). Each connects only to adjacent neighbors.
  vents: [
    { id: 'v1', label: 'NW', x: 700, y: 460, to: ['v2', 'v3'] },
    { id: 'v2', label: 'NE', x: 1300, y: 460, to: ['v1', 'v4'] },
    { id: 'v3', label: 'SW', x: 700, y: 700, to: ['v1', 'v4'] },
    { id: 'v4', label: 'SE', x: 1300, y: 700, to: ['v2', 'v3'] },
  ],
  // Sabotage fix stations.
  sab: {
    reactor: { x: 700, y: 900 },
    lights: { x: 1300, y: 260 },
  },
};

module.exports = { MAP };
