// Server configuration. Room/player lifecycle only — no gameplay state lives here.
module.exports = {
  MAX_PLAYERS: 8,
  MIN_PLAYERS_UNO: 2,
  MIN_PLAYERS_AMONGUS: 4,
  MIN_PLAYERS_POKER: 2,
  MIN_PLAYERS_RUMMY: 2,

  // Hold a disconnected player's slot this long before freeing it (spec: 30s).
  DISCONNECT_GRACE_MS: 30_000,

  // Keep a room alive this long if the TV/host screen drops, so it can
  // reconnect (same code + roster) after a network blip instead of the whole
  // party being lost. Matters most for internet play.
  TV_GRACE_MS: 60_000,

  // Fixed color per slot. 8 distinct, high-contrast hues for a TV.
  SLOT_COLORS: {
    player_1: '#ef4444', // red
    player_2: '#3b82f6', // blue
    player_3: '#22c55e', // green
    player_4: '#eab308', // yellow
    player_5: '#a855f7', // purple
    player_6: '#f97316', // orange
    player_7: '#ec4899', // pink
    player_8: '#14b8a6', // teal
  },

  ROOM_CODE_LENGTH: 4,
  // Alphabetic only (per spec), ambiguous letters (I, O) removed for QR/typing clarity.
  ROOM_CODE_ALPHABET: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
};
