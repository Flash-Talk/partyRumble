'use strict';

/**
 * The lobby roster = currently-connected slot owners PLUS slots temporarily
 * reserved for a briefly-disconnected player (grace). Games seat this full
 * roster, not just `slotOwners`, so a phone whose socket blipped while waiting
 * in the lobby (screen lock / wifi hiccup) is still dealt in and receives its
 * private state the moment it reconnects — instead of being stranded on the
 * joystick with no cards.
 *
 * @param {{ slotOwners: Object, grace: Map }} room
 * @returns {string[]} slots like ['player_1', 'player_2', ...]
 */
function rosterSlots(room) {
  return [...new Set([...Object.keys(room.slotOwners), ...room.grace.keys()])].sort();
}

module.exports = { rosterSlots };
