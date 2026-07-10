// Gameplay tunables and slot metadata for the TV simulation.
// All positions are in the 1920x1080 design space (Phaser Scale.FIT scales it).

export const DESIGN = { W: 1920, H: 1080 };

export const CONFIG = {
  ARENA_RADIUS: 470,      // circumradius of the polygon arena (fits 1080 height)
  WEDGE_MARGIN: 40,       // inset of each player's zone (keeps discs off walls/apex)
  GOAL_FRACTION: 0.52,    // goal opening as a fraction of each polygon edge
  DISC_RADIUS: 32,
  BALL_RADIUS: 16,

  MOVE_SPEED: 520,        // px/s at full joystick tilt
  DISC_KICK: 0.45,        // how much a moving disc's velocity transfers to the ball
  SHOOT_SPEED: 900,       // px/s launch speed on SHOOT
  RELEASE_SPEED: 520,     // px/s when the hold timer forces a release
  BALL_MAX_SPEED: 950,
  BALL_DRAG: 140,         // px/s^2 — shots gradually slow so they become trappable
  TRAP_SPEED: 380,        // only a ball slower than this can be trapped
  TRAP_PAD: 6,            // extra reach when trapping

  HOLD_MS: 2500,          // max time you can hold the ball before it auto-releases
  TRAP_COOLDOWN_MS: 400,  // after shooting, you can't instantly re-trap
  IDLE_NUDGE_MS: 2500,    // a near-stationary loose ball gets nudged back into play

  MATCH_SECONDS: 90,
  RESET_DELAY_MS: 1200,   // pause after a goal before the ball drops again
  HOLD_OFFSET: 8,         // gap between disc and held ball, beyond the two radii

  MIN_PLAYERS: 2,
  MAX_PLAYERS: 8,
};

export const SLOT_ORDER = [
  'player_1', 'player_2', 'player_3', 'player_4',
  'player_5', 'player_6', 'player_7', 'player_8',
];

// Color (matches the server) + short label per slot.
export const SLOT_META = {
  player_1: { color: '#ef4444', label: 'P1' },
  player_2: { color: '#3b82f6', label: 'P2' },
  player_3: { color: '#22c55e', label: 'P3' },
  player_4: { color: '#eab308', label: 'P4' },
  player_5: { color: '#a855f7', label: 'P5' },
  player_6: { color: '#f97316', label: 'P6' },
  player_7: { color: '#ec4899', label: 'P7' },
  player_8: { color: '#14b8a6', label: 'P8' },
};

export function hexToNum(hex) {
  return parseInt(String(hex).replace('#', ''), 16);
}
