// Server configuration. Room/player lifecycle only — no gameplay state lives here.
module.exports = {
  MAX_PLAYERS: 4,

  // Hold a disconnected player's slot this long before freeing it (spec: 30s).
  DISCONNECT_GRACE_MS: 30_000,

  // Keep a room alive this long if the TV/host screen drops, so it can
  // reconnect (same code + roster) after a network blip instead of the whole
  // party being lost. Matters most for internet play.
  TV_GRACE_MS: 60_000,

  // Fixed color per slot. Distinct + high-contrast on a TV.
  SLOT_COLORS: {
    player_1: '#ef4444', // red    (top)
    player_2: '#3b82f6', // blue   (right)
    player_3: '#22c55e', // green  (bottom)
    player_4: '#eab308', // yellow (left)
  },

  ROOM_CODE_LENGTH: 4,
  // Alphabetic only (per spec), ambiguous letters (I, O) removed for QR/typing clarity.
  ROOM_CODE_ALPHABET: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
};
