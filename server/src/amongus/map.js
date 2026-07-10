'use strict';

// The Among Us map, in a 1840x1000 "map space" (fills the 1920x1080 TV with a
// small margin). Two mid dividers with central doorways carve four rooms around
// an open hub; obstacle blocks give cover. Characters are circles that collide
// against the walls and the outer bounds.

const MAP = {
  w: 1840,
  h: 1000,
  walls: [
    // horizontal mid divider (central doorway gap x: 760..1080)
    { x: 40, y: 488, w: 720, h: 24 },
    { x: 1080, y: 488, w: 720, h: 24 },
    // vertical mid divider (central doorway gap y: 380..620)
    { x: 908, y: 40, w: 24, h: 340 },
    { x: 908, y: 620, w: 24, h: 340 },
    // room cover blocks
    { x: 250, y: 170, w: 180, h: 150 },
    { x: 1410, y: 170, w: 180, h: 150 },
    { x: 250, y: 680, w: 180, h: 150 },
    { x: 1410, y: 680, w: 180, h: 150 },
    // corridor nooks
    { x: 600, y: 150, w: 24, h: 190 },
    { x: 1216, y: 150, w: 24, h: 190 },
    { x: 600, y: 660, w: 24, h: 190 },
    { x: 1216, y: 660, w: 24, h: 190 },
  ],
  // Spawns cluster in the open central hub.
  spawns: [
    { x: 840, y: 440 }, { x: 1000, y: 440 }, { x: 840, y: 560 }, { x: 1000, y: 560 },
    { x: 920, y: 415 }, { x: 920, y: 585 }, { x: 800, y: 500 }, { x: 1040, y: 500 },
  ],
  // Task stations, spread through the rooms.
  tasks: [
    { id: 't1', x: 150, y: 110 }, { id: 't2', x: 1690, y: 110 },
    { id: 't3', x: 150, y: 890 }, { id: 't4', x: 1690, y: 890 },
    { id: 't5', x: 520, y: 410 }, { id: 't6', x: 1320, y: 410 },
    { id: 't7', x: 520, y: 600 }, { id: 't8', x: 1320, y: 600 },
  ],
};

module.exports = { MAP };
