// Gameplay tunables and slot metadata for the TV simulation.
// All positions are in the 1920x1080 design space (Phaser Scale.FIT scales it).

export const DESIGN = { W: 1920, H: 1080 };

export const CONFIG = {
  FIELD_SIZE: 980,        // square play field, centered
  WEDGE_MARGIN: 40,       // inset of each player's triangle (keeps discs off walls/apex)
  DISC_RADIUS: 34,
  BALL_RADIUS: 16,

  MOVE_SPEED: 520,        // px/s at full joystick tilt
  SHOOT_SPEED: 900,       // px/s launch speed on SHOOT
  RELEASE_SPEED: 520,     // px/s when the hold timer forces a release
  BALL_MAX_SPEED: 950,
  BALL_DRAG: 140,         // px/s^2 — shots gradually slow so they become trappable
  TRAP_SPEED: 380,        // only a ball slower than this can be trapped
  TRAP_PAD: 6,            // extra reach when trapping

  HOLD_MS: 2500,          // max time you can hold the ball before it auto-releases
  TRAP_COOLDOWN_MS: 400,  // after shooting, you can't instantly re-trap
  IDLE_NUDGE_MS: 2500,    // a near-stationary loose ball gets nudged back into play

  GOAL_HALF: 120,         // half-width of each goal opening
  WALL_THICKNESS: 24,

  MATCH_SECONDS: 90,
  RESET_DELAY_MS: 1200,   // pause after a goal before the ball drops again
  HOLD_OFFSET: 8,         // gap between disc and held ball, beyond the two radii

  MIN_PLAYERS: 2,
};

export const SLOT_ORDER = ['player_1', 'player_2', 'player_3', 'player_4'];

// side + default color (matches the server) + short label.
export const SLOT_META = {
  player_1: { side: 'top',    color: '#ef4444', label: 'P1' },
  player_2: { side: 'right',  color: '#3b82f6', label: 'P2' },
  player_3: { side: 'bottom', color: '#22c55e', label: 'P3' },
  player_4: { side: 'left',   color: '#eab308', label: 'P4' },
};

export function hexToNum(hex) {
  return parseInt(String(hex).replace('#', ''), 16);
}
