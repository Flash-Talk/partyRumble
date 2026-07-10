'use strict';

/**
 * Source of truth for rooms and players (NOT gameplay — that runs on the TV).
 * State is scoped strictly per room in `this.rooms`; nothing is global across rooms.
 *
 * A room:
 *   {
 *     code,                       // 4-letter code
 *     tvSocketId,                 // the TV screen socket
 *     players: Map<socketId, {id, slot, name, color}>,
 *     slotOwners: { [slot]: socketId },   // currently-connected slot owners
 *     grace: Map<slot, { name, color, id, timer }>, // disconnected, slot reserved
 *   }
 *
 * @param {object} config  see ./config.js
 * @param {{ onPlayerLeft: (roomCode:string, payload:{id:string,slot:string}) => void }} deps
 *        called when a reserved slot is finally freed (grace expired).
 */
class RoomManager {
  constructor(config, deps = {}) {
    this.config = config;
    this.deps = { onPlayerLeft() {}, onRoomClosed() {}, ...deps };
    this.rooms = new Map();
  }

  // ---- rooms ---------------------------------------------------------------

  createRoom(tvSocketId, hostToken = null) {
    const code = this._generateUniqueCode();
    this.rooms.set(code, {
      code,
      tvSocketId,
      hostToken,
      tvGraceTimer: null,
      players: new Map(),
      slotOwners: {},
      grace: new Map(),
      currentGame: 'penalty', // 'penalty' | 'uno' | 'amongus'
      unoGame: null,          // active UnoGame instance, if any
      amongus: null,          // active AmongUsGame instance, if any
      amongusLoop: null,      // its tick interval
    });
    return code;
  }

  getRoom(code) {
    return this.rooms.get(code);
  }

  /**
   * Reattach a reconnecting TV/host to its existing room (same code + roster)
   * when the host token matches. Cancels the pending TV-grace teardown.
   * @returns {room | null}
   */
  resumeRoom(code, tvSocketId, hostToken) {
    const room = this.rooms.get(code);
    if (!room || !hostToken || room.hostToken !== hostToken) return null;
    if (room.tvGraceTimer) { clearTimeout(room.tvGraceTimer); room.tvGraceTimer = null; }
    room.tvSocketId = tvSocketId;
    return room;
  }

  /** TV dropped: keep the room for TV_GRACE_MS so the host can reconnect. */
  startTvGrace(code, tvSocketId = null) {
    const room = this.rooms.get(code);
    if (!room) return;
    // If a newer host socket already took over this room, ignore the stale drop.
    if (tvSocketId && room.tvSocketId !== tvSocketId) return;
    if (room.tvGraceTimer) clearTimeout(room.tvGraceTimer);
    room.tvGraceTimer = setTimeout(() => {
      this.deps.onRoomClosed(code);
      this.closeRoom(code);
    }, this.config.TV_GRACE_MS);
    if (typeof room.tvGraceTimer.unref === 'function') room.tvGraceTimer.unref();
  }

  /** Tear a room down. Clears any pending grace timers and game loops. */
  closeRoom(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    if (room.tvGraceTimer) clearTimeout(room.tvGraceTimer);
    if (room.amongusLoop) clearInterval(room.amongusLoop);
    for (const { timer } of room.grace.values()) clearTimeout(timer);
    this.rooms.delete(code);
  }

  findRoomByTv(tvSocketId) {
    for (const room of this.rooms.values()) {
      if (room.tvSocketId === tvSocketId) return room;
    }
    return null;
  }

  // ---- players -------------------------------------------------------------

  /**
   * Add (or resume) a player. If a reserved (graced) slot has a matching name,
   * that exact slot+color is reclaimed so a reconnecting player keeps identity.
   * @returns {{room, player, resumed:boolean} | {error:string}}
   */
  addPlayer(code, socketId, playerName) {
    const room = this.rooms.get(code);
    if (!room) return { error: 'Room not found' };

    const name = String(playerName || '').trim();

    let slot = this._reclaimableSlot(room, name);
    let resumed = false;
    if (slot) {
      clearTimeout(room.grace.get(slot).timer);
      room.grace.delete(slot);
      resumed = true;
    } else {
      slot = this._nextFreeSlot(room);
      if (!slot) return { error: 'Room is full' };
    }

    const color = this.config.SLOT_COLORS[slot];
    const player = { id: socketId, slot, name: name || slot, color };
    room.players.set(socketId, player);
    room.slotOwners[slot] = socketId;
    return { room, player, resumed };
  }

  getPlayer(code, socketId) {
    const room = this.rooms.get(code);
    return room ? room.players.get(socketId) : undefined;
  }

  /**
   * A player socket dropped: reserve their slot for DISCONNECT_GRACE_MS.
   * If they don't return in time, deps.onPlayerLeft frees it for real.
   */
  startGrace(code, socketId) {
    const room = this.rooms.get(code);
    if (!room) return;
    const player = room.players.get(socketId);
    if (!player) return;

    room.players.delete(socketId);
    if (room.slotOwners[player.slot] === socketId) delete room.slotOwners[player.slot];

    const timer = setTimeout(() => {
      // Only fire if still reserved (not reclaimed) and room still exists.
      const r = this.rooms.get(code);
      if (!r || !r.grace.has(player.slot)) return;
      r.grace.delete(player.slot);
      this.deps.onPlayerLeft(code, { id: player.id, slot: player.slot });
    }, this.config.DISCONNECT_GRACE_MS);
    if (typeof timer.unref === 'function') timer.unref();

    room.grace.set(player.slot, {
      name: player.name,
      color: player.color,
      id: player.id,
      timer,
    });
  }

  // ---- internals -----------------------------------------------------------

  _reclaimableSlot(room, name) {
    if (!name) return null;
    for (const [slot, g] of room.grace) {
      if (g.name.toLowerCase() === name.toLowerCase()) return slot;
    }
    return null;
  }

  /** First slot that is neither connected nor reserved by a graced player. */
  _nextFreeSlot(room) {
    for (let i = 1; i <= this.config.MAX_PLAYERS; i++) {
      const slot = `player_${i}`;
      if (!room.slotOwners[slot] && !room.grace.has(slot)) return slot;
    }
    return null;
  }

  _generateUniqueCode() {
    const { ROOM_CODE_LENGTH: len, ROOM_CODE_ALPHABET: abc } = this.config;
    for (let attempt = 0; attempt < 1000; attempt++) {
      let code = '';
      for (let i = 0; i < len; i++) {
        code += abc[Math.floor(Math.random() * abc.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('Unable to allocate a unique room code');
  }
}

module.exports = RoomManager;
