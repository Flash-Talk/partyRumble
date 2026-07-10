'use strict';

/*
 * Mobile controller: a floating joystick + a SHOOT button.
 * Emits the spec's `controller_input` events:
 *   { type:'AXIS',   id:'x'|'y', value: -1.0..1.0 }
 *   { type:'BUTTON', id:'shoot', value: true|false }
 * Uses touchstart/touchend (never click) to avoid mobile tap delay.
 */

const socket = io({ reconnection: true });

// ---- DOM ----
const $ = (id) => document.getElementById(id);
const joinEl = $('join');
const controllerEl = $('controller');
const codeField = $('codeField');
const codeInput = $('codeInput');
const codeBadge = $('codeBadge');
const nameInput = $('nameInput');
const joinBtn = $('joinBtn');
const joinError = $('joinError');
const statusEl = $('status');
const slotLabel = $('slotLabel');
const dot = $('dot');
const joyZone = $('joyZone');
const joyBase = $('joyBase');
const joyKnob = $('joyKnob');
const joyHint = $('joyHint');
const shootBtn = $('shootBtn');

// ---- state ----
const params = new URLSearchParams(location.search);
let roomCode = (params.get('room') || localStorage.getItem('pg_room') || '').toUpperCase();
let playerName = localStorage.getItem('pg_name') || '';
let wantJoin = false; // true once the user has committed to joining (drives auto-rejoin)
let joined = false;

// If the room came from the QR link, show it as a fixed badge instead of an input.
const roomFromUrl = !!params.get('room');

function initJoinScreen() {
  nameInput.value = playerName || `Player${Math.floor(Math.random() * 90 + 10)}`;
  if (roomFromUrl && roomCode) {
    codeField.style.display = 'none';
    codeBadge.style.display = '';
    codeBadge.textContent = roomCode;
  } else {
    codeInput.value = roomCode;
  }
}

// ---- networking ----
function attemptJoin() {
  if (!roomCode || !playerName || !socket.connected) return;
  socket.emit('join_room', { roomCode, playerName });
}

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = cls || '';
}

socket.on('connect', () => {
  setStatus(joined ? 'connected' : 'connecting…', joined ? 'live' : '');
  if (wantJoin) attemptJoin(); // reclaim slot after a reconnect (phone unlock / wifi blip)
});

socket.on('disconnect', () => {
  if (joined) setStatus('reconnecting…', 'warn');
});

socket.on('join_success', ({ slot, color }) => {
  joined = true;
  wantJoin = true;
  localStorage.setItem('pg_name', playerName);
  localStorage.setItem('pg_room', roomCode);

  document.documentElement.style.setProperty('--slot', color);
  dot.style.background = color;
  dot.style.boxShadow = `0 0 10px ${color}`;
  slotLabel.textContent = `${playerName} · ${slot.replace('player_', 'P')}`;
  setStatus('connected', 'live');

  joinEl.style.display = 'none';
  controllerEl.style.display = 'flex';
});

socket.on('room_error', ({ message }) => {
  wantJoin = false;
  const msg = message || 'Could not join room';
  if (joined) {
    // Already playing (e.g. host dropped): surface it and return to join.
    joined = false;
    setStatus(msg, 'warn');
    controllerEl.style.display = 'none';
    joinEl.style.display = 'flex';
  }
  joinError.textContent = msg;
});

joinBtn.addEventListener('click', () => {
  joinError.textContent = '';
  playerName = (nameInput.value || '').trim() || `Player${Math.floor(Math.random() * 90 + 10)}`;
  if (!roomFromUrl) roomCode = (codeInput.value || '').trim().toUpperCase();
  if (!roomCode) { joinError.textContent = 'Enter a room code'; return; }
  wantJoin = true;
  attemptJoin();
});

// ---- axis sending (batched to one frame to limit traffic) ----
let pendingX = 0, pendingY = 0, lastX = null, lastY = null, rafQueued = false;

function queueAxis(x, y) {
  pendingX = x; pendingY = y;
  if (!rafQueued) { rafQueued = true; requestAnimationFrame(flushAxis); }
}
function flushAxis() {
  rafQueued = false;
  const rx = Math.round(pendingX * 100) / 100;
  const ry = Math.round(pendingY * 100) / 100;
  if (rx !== lastX) { socket.emit('controller_input', { type: 'AXIS', id: 'x', value: rx }); lastX = rx; }
  if (ry !== lastY) { socket.emit('controller_input', { type: 'AXIS', id: 'y', value: ry }); lastY = ry; }
}

// ---- floating joystick ----
const JOY_RADIUS = 90; // px; matches #joyBase half-size
let joyTouchId = null;
let joyBaseX = 0, joyBaseY = 0;

function showJoy(x, y) {
  joyBase.style.left = joyKnob.style.left = `${x}px`;
  joyBase.style.top = joyKnob.style.top = `${y}px`;
  joyBase.style.display = joyKnob.style.display = 'block';
  joyHint.style.display = 'none';
}
function moveKnob(x, y) {
  joyKnob.style.left = `${x}px`;
  joyKnob.style.top = `${y}px`;
}
function hideJoy() {
  joyBase.style.display = joyKnob.style.display = 'none';
  joyHint.style.display = 'flex';
  queueAxis(0, 0);
}

joyZone.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (joyTouchId !== null) return;
  const t = e.changedTouches[0];
  joyTouchId = t.identifier;
  const r = joyZone.getBoundingClientRect();
  joyBaseX = t.clientX - r.left;
  joyBaseY = t.clientY - r.top;
  showJoy(joyBaseX, joyBaseY);
}, { passive: false });

joyZone.addEventListener('touchmove', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier !== joyTouchId) continue;
    const r = joyZone.getBoundingClientRect();
    let dx = (t.clientX - r.left) - joyBaseX;
    let dy = (t.clientY - r.top) - joyBaseY;
    const mag = Math.hypot(dx, dy);
    if (mag > JOY_RADIUS) { dx = dx / mag * JOY_RADIUS; dy = dy / mag * JOY_RADIUS; }
    moveKnob(joyBaseX + dx, joyBaseY + dy);
    queueAxis(dx / JOY_RADIUS, dy / JOY_RADIUS); // y+ = down (matches screen/Phaser)
  }
}, { passive: false });

function endJoy(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === joyTouchId) { joyTouchId = null; hideJoy(); }
  }
}
joyZone.addEventListener('touchend', (e) => { e.preventDefault(); endJoy(e); }, { passive: false });
joyZone.addEventListener('touchcancel', (e) => { e.preventDefault(); endJoy(e); }, { passive: false });

// ---- shoot button ----
function setShoot(down) {
  shootBtn.classList.toggle('pressed', down);
  socket.emit('controller_input', { type: 'BUTTON', id: 'shoot', value: down });
}
shootBtn.addEventListener('touchstart', (e) => { e.preventDefault(); setShoot(true); }, { passive: false });
shootBtn.addEventListener('touchend', (e) => { e.preventDefault(); setShoot(false); }, { passive: false });
shootBtn.addEventListener('touchcancel', (e) => { e.preventDefault(); setShoot(false); }, { passive: false });
// Mouse fallback so the controller is testable on a desktop browser.
shootBtn.addEventListener('mousedown', () => setShoot(true));
window.addEventListener('mouseup', () => shootBtn.classList.contains('pressed') && setShoot(false));

// ---- UNO mode ----
const unoEl = $('uno');
const unoTurn = $('unoTurn');
const unoTopCard = $('unoTopCard');
const unoColor = $('unoColor');
const unoHand = $('unoHand');
const unoMsg = $('unoMsg');
const unoDraw = $('unoDraw');
const unoPass = $('unoPass');
const unoUno = $('unoUno');
const colorPicker = $('colorPicker');
const cpCancel = $('cpCancel');

const UNO_COLORS = { red: '#ef4444', yellow: '#eab308', green: '#22c55e', blue: '#3b82f6' };
const unoColorHex = (c) => UNO_COLORS[c] || '#9aa4bf';
function unoSymbol(kind) {
  if (/^[0-9]$/.test(kind)) return kind;
  return { skip: 'Ø', reverse: '⇄', draw2: '+2', wild: '★', wild4: '+4' }[kind] || kind;
}

let pendingWild = null;

socket.on('uno_hand', (h) => enterUno(h));
socket.on('uno_over', (d) => exitUno(d));
socket.on('uno_error', ({ message }) => {
  unoMsg.textContent = message || '';
  unoMsg.className = 'err';
  setTimeout(() => { if (unoMsg.textContent === message) { unoMsg.textContent = ''; unoMsg.className = ''; } }, 1500);
});

function enterUno(h) {
  joinEl.style.display = 'none';
  controllerEl.style.display = 'none';
  unoEl.style.display = 'flex';
  renderUno(h);
}
function exitUno() {
  unoEl.style.display = 'none';
  controllerEl.style.display = 'flex';
  unoMsg.textContent = '';
  colorPicker.classList.remove('show');
}

function turnName(st) {
  const p = st.players.find((x) => x.slot === st.currentSlot);
  return p ? p.name : '…';
}

function styleCard(el, card) {
  el.textContent = unoSymbol(card.kind);
  if (card.color === 'wild') { el.classList.add('wildcard'); el.style.background = ''; }
  else { el.classList.remove('wildcard'); el.style.background = unoColorHex(card.color); }
}

function renderUno(h) {
  const st = h.state;
  const waiting = !h.yourTurn;
  const pending = st.pendingDraw > 0;
  const stackName = st.pendingType === 'draw4' ? 'Draw Four' : 'Draw Two';

  unoEl.classList.toggle('waiting', waiting);
  unoTurn.textContent = waiting ? `Waiting for ${turnName(st)}…` : 'YOUR TURN';
  unoTurn.className = waiting ? 'waiting-turn' : 'your-turn';

  const top = st.topCard;
  unoTopCard.textContent = unoSymbol(top.kind);
  unoTopCard.classList.remove('wildcard');
  unoTopCard.style.background = unoColorHex(top.color === 'wild' ? st.currentColor : top.color);
  unoColor.textContent = pending ? `STACK +${st.pendingDraw}` : st.currentColor;
  unoColor.style.color = pending ? '#ff6b6b' : unoColorHex(st.currentColor);

  // Dim every card that can't be tapped — including the whole hand when waiting.
  const playable = new Set(h.playableIds);
  unoHand.innerHTML = '';
  h.cards.forEach((c) => {
    const el = document.createElement('div');
    el.className = 'card';
    styleCard(el, c);
    if (h.yourTurn && playable.has(c.id)) {
      el.classList.add('legal');
      el.addEventListener('touchstart', (e) => { e.preventDefault(); onCardTap(c); }, { passive: false });
      el.addEventListener('click', () => onCardTap(c));
    } else {
      el.classList.add('illegal');
    }
    unoHand.appendChild(el);
  });

  // Action buttons: hide DRAW when it isn't your turn; make it obvious when
  // drawing is the required move (and label the stacked penalty).
  unoDraw.style.display = h.yourTurn ? '' : 'none';
  unoDraw.disabled = !h.canDraw;
  unoDraw.textContent = pending ? `TAKE +${st.pendingDraw}` : 'DRAW';
  unoDraw.classList.toggle('accent', h.yourTurn && h.playableIds.length === 0);
  unoPass.style.display = h.canPass ? '' : 'none';
  unoUno.style.display = h.canCallUno ? '' : 'none';

  // One-line guidance so a legal state never looks stuck.
  let hint = '';
  if (!waiting) {
    if (pending) {
      hint = h.playableIds.length
        ? `Stack a ${stackName} or tap TAKE +${st.pendingDraw}`
        : `No ${stackName} to stack — tap TAKE +${st.pendingDraw}`;
    } else if (h.playableIds.length === 0 && h.canDraw) {
      hint = 'No playable card — tap DRAW';
    }
  }
  unoMsg.textContent = hint;
  unoMsg.className = hint ? 'hint' : '';

  // Safety: never leave the color picker open once it's no longer your turn.
  if (!h.yourTurn && colorPicker.classList.contains('show')) {
    colorPicker.classList.remove('show');
    pendingWild = null;
  }
}

function onCardTap(card) {
  if (card.kind === 'wild' || card.kind === 'wild4') { pendingWild = card; colorPicker.classList.add('show'); }
  else socket.emit('uno_action', { action: 'play', cardId: card.id });
}

colorPicker.querySelectorAll('.cp').forEach((btn) => {
  const pick = (e) => {
    if (e) e.preventDefault();
    if (!pendingWild) return;
    socket.emit('uno_action', { action: 'play', cardId: pendingWild.id, color: btn.dataset.color });
    pendingWild = null;
    colorPicker.classList.remove('show');
  };
  btn.addEventListener('touchstart', pick, { passive: false });
  btn.addEventListener('click', pick);
});

const cancelPick = (e) => { if (e) e.preventDefault(); pendingWild = null; colorPicker.classList.remove('show'); };
cpCancel.addEventListener('touchstart', cancelPick, { passive: false });
cpCancel.addEventListener('click', cancelPick);

function bindUno(btn, action, guard) {
  const fire = (e) => { if (e) e.preventDefault(); if (guard && guard()) return; socket.emit('uno_action', { action }); };
  btn.addEventListener('touchstart', fire, { passive: false });
  btn.addEventListener('click', fire);
}
bindUno(unoDraw, 'draw', () => unoDraw.disabled);
bindUno(unoPass, 'pass');
bindUno(unoUno, 'uno');

// ---- Among Us ----
const amongusRole = $('amongusRole');

socket.on('amongus_role', (r) => {
  const imp = r && r.role === 'imposter';
  amongusRole.querySelector('.ar-title').textContent = imp ? 'IMPOSTER' : 'CREWMATE';
  amongusRole.querySelector('.ar-sub').textContent = imp
    ? 'Blend in. Don’t get caught. Move with the joystick.'
    : 'Find the imposter. Move with the joystick.';
  amongusRole.style.background = imp ? '#3a0d0d' : '#0d2a17';
  amongusRole.querySelector('.ar-title').style.color = imp ? '#ff6b6b' : '#4ade80';

  // Make sure the joystick controller is what's under the banner.
  joinEl.style.display = 'none';
  unoEl.style.display = 'none';
  controllerEl.style.display = 'flex';
  amongusRole.classList.add('show');
  setTimeout(() => amongusRole.classList.remove('show'), 3500);
});

socket.on('amongus_over', () => { amongusRole.classList.remove('show'); });

// ---- boot ----
initJoinScreen();
