// TV-side networking. Boots a room, tracks the player roster, and keeps a live
// per-slot input snapshot fed by the server's relayed `game_input` events.
// A single shared instance is imported by every scene.

class Net {
  constructor() {
    this.socket = null;
    this.roomCode = null;
    this.players = new Map();  // slot -> { slot, name, color, id }
    this.inputs = new Map();   // slot -> { x, y, shoot }
    this.events = new Phaser.Events.EventEmitter();
    this._started = false;
  }

  init() {
    if (this._started) return;
    this._started = true;

    this.hostToken = this._loadHostToken();
    this.socket = io();

    this.socket.on('connect', () => {
      // Send our host token (+ last room) so a reconnect reclaims the same room
      // and roster instead of orphaning the party.
      this.socket.emit('create_room', {
        token: this.hostToken,
        roomCode: this.roomCode || this._read('pg_host_room'),
      });
    });

    this.socket.on('room_created', ({ roomCode }) => {
      this.roomCode = roomCode;
      this._write('pg_host_room', roomCode);
      this.events.emit('room_ready', roomCode);
    });

    this.socket.on('player_joined', (p) => {
      this.players.set(p.slot, { slot: p.slot, name: p.name, color: p.color, id: p.id });
      if (!this.inputs.has(p.slot)) this.inputs.set(p.slot, { x: 0, y: 0, shoot: false });
      this.events.emit('players_changed');
    });

    this.socket.on('player_left', ({ slot }) => {
      this.players.delete(slot);
      this.inputs.delete(slot);
      this.events.emit('players_changed');
      this.events.emit('player_left', slot);
    });

    this.socket.on('game_input', ({ slot, type, id, value }) => {
      let s = this.inputs.get(slot);
      if (!s) { s = { x: 0, y: 0, shoot: false }; this.inputs.set(slot, s); }
      if (type === 'AXIS') {
        if (id === 'x') s.x = value;
        else if (id === 'y') s.y = value;
      } else if (type === 'BUTTON' && id === 'shoot') {
        s.shoot = !!value;
      }
    });

    // UNO (server-authoritative): the TV just renders public state.
    this.unoState = null;
    this.socket.on('uno_state', (state) => { this.unoState = state; this.events.emit('uno_state', state); });
    this.socket.on('uno_over', (data) => { this.unoState = null; this.events.emit('uno_over', data); });

    // Among Us (server-authoritative): TV renders the map + anonymous characters.
    this.amongusMap = null;
    this.amongusState = null;
    this.socket.on('amongus_start', ({ map }) => { this.amongusMap = map; this.events.emit('amongus_start', map); });
    this.socket.on('amongus_state', (state) => { this.amongusState = state; this.events.emit('amongus_state', state); });
    this.socket.on('amongus_over', (data) => { this.amongusState = null; this.events.emit('amongus_over', data); });

    // Poker (server-authoritative): the TV renders public table state.
    this.pokerState = null;
    this.socket.on('poker_state', (state) => { this.pokerState = state; this.events.emit('poker_state', state); });
    this.socket.on('poker_over', (data) => { this.pokerState = null; this.events.emit('poker_over', data); });

    // Rummy (server-authoritative): the TV renders the public table.
    this.rummyState = null;
    this.socket.on('rummy_state', (state) => { this.rummyState = state; this.events.emit('rummy_state', state); });
    this.socket.on('rummy_over', (data) => { this.rummyState = null; this.events.emit('rummy_over', data); });
  }

  startUno() {
    if (this.socket) this.socket.emit('start_uno');
  }

  startAmongUs() {
    if (this.socket) this.socket.emit('start_amongus');
  }

  startPoker() {
    if (this.socket) this.socket.emit('start_poker');
  }

  startRummy() {
    if (this.socket) this.socket.emit('start_rummy');
  }

  getInput(slot) {
    return this.inputs.get(slot) || { x: 0, y: 0, shoot: false };
  }

  activeSlots() {
    return [...this.players.keys()].sort();
  }

  joinUrl() {
    return `${window.location.origin}/?room=${this.roomCode}`;
  }

  // localStorage helpers (guarded — TVs in private mode may throw).
  _read(key) { try { return localStorage.getItem(key); } catch { return null; } }
  _write(key, val) { try { localStorage.setItem(key, val); } catch { /* ignore */ } }

  _loadHostToken() {
    let t = this._read('pg_host_token');
    if (!t) {
      t = `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
      this._write('pg_host_token', t);
    }
    return t;
  }
}

export default new Net();
