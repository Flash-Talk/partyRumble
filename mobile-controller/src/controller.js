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
let amongusActive = false; // true between amongus_role and amongus_over
let amongusYou = null;     // latest private Among Us state

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
// During Among Us play the SHOOT button becomes the imposter's KILL button.
function shootDown() {
  if (amongusActive && amongusYou && amongusYou.phase === 'play') {
    const mode = shootBtn.dataset.amode;
    if (mode === 'kill') { if (amongusYou.canKill) socket.emit('amongus_action', { type: 'kill' }); return; }
    if (mode === 'fix') { if (amongusYou.fixHere) openFix(); return; }
    if (mode === 'vent') { if (amongusYou.ventHere) socket.emit('amongus_action', { type: 'vent' }); return; }
    if (mode === 'task') { if (amongusYou.taskHere) openTask(amongusYou.taskHere); return; }
    return;
  }
  setShoot(true);
}
function shootUp() {
  if (amongusActive && amongusYou) return; // amongus action buttons are tap, not hold
  setShoot(false);
}
shootBtn.addEventListener('touchstart', (e) => { e.preventDefault(); shootDown(); }, { passive: false });
shootBtn.addEventListener('touchend', (e) => { e.preventDefault(); shootUp(); }, { passive: false });
shootBtn.addEventListener('touchcancel', (e) => { e.preventDefault(); shootUp(); }, { passive: false });
// Mouse fallback so the controller is testable on a desktop browser.
shootBtn.addEventListener('mousedown', shootDown);
window.addEventListener('mouseup', () => { if (shootBtn.classList.contains('pressed')) setShoot(false); });

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
const amongusVote = $('amongusVote');
const amongusDead = $('amongusDead');
const amongusTasks = $('amongusTasks');
const amongusTask = $('amongusTask');
const atTitle = $('atTitle');
const atArea = $('atArea');
const atClose = $('atClose');
const amongusVent = $('amongusVent');
const avnGrid = $('avnGrid');
const avnExit = $('avnExit');
avnExit.addEventListener('click', () => socket.emit('amongus_action', { type: 'vent_exit' }));
avnExit.addEventListener('touchstart', (e) => { e.preventDefault(); socket.emit('amongus_action', { type: 'vent_exit' }); }, { passive: false });

const amongusSab = $('amongusSab');
const amongusSabMenu = $('amongusSabMenu');
const sabCancel = $('sabCancel');
const openSabMenu = (e) => { if (e) e.preventDefault(); if (amongusYou && amongusYou.canSabotage) amongusSabMenu.classList.add('show'); };
amongusSab.addEventListener('click', openSabMenu);
amongusSab.addEventListener('touchstart', openSabMenu, { passive: false });
const closeSabMenu = (e) => { if (e) e.preventDefault(); amongusSabMenu.classList.remove('show'); };
sabCancel.addEventListener('click', closeSabMenu);
sabCancel.addEventListener('touchstart', closeSabMenu, { passive: false });
amongusSabMenu.querySelectorAll('.sm-btn').forEach((btn) => {
  const fire = (e) => {
    if (e) e.preventDefault();
    socket.emit('amongus_action', { type: 'sabotage', kind: btn.dataset.kind });
    amongusSabMenu.classList.remove('show');
  };
  btn.addEventListener('click', fire);
  btn.addEventListener('touchstart', fire, { passive: false });
});
const avKilled = $('avKilled');
const avTitle = $('avTitle');
const avTimer = $('avTimer');
const avGrid = $('avGrid');
const avStatus = $('avStatus');
atClose.addEventListener('click', () => closeTask());
atClose.addEventListener('touchstart', (e) => { e.preventDefault(); closeTask(); }, { passive: false });

socket.on('amongus_role', (r) => {
  amongusActive = true;
  const imp = r && r.role === 'imposter';
  amongusRole.querySelector('.ar-title').textContent = imp ? 'IMPOSTER' : 'CREWMATE';
  const sub = amongusRole.querySelector('.ar-sub');
  sub.textContent = imp
    ? 'Kill up close, vent to escape, blend in.'
    : 'Find the imposter. Move + do tasks with the joystick.';
  if (imp && r.teammates && r.teammates.length) {
    sub.appendChild(document.createElement('br'));
    sub.appendChild(document.createTextNode('Your team: '));
    r.teammates.forEach((tm) => {
      const dot = document.createElement('span');
      dot.textContent = '●';
      dot.style.color = tm.color;
      dot.style.fontSize = '30px';
      dot.style.verticalAlign = 'middle';
      sub.appendChild(dot);
    });
  }
  amongusRole.style.background = imp ? '#3a0d0d' : '#0d2a17';
  amongusRole.querySelector('.ar-title').style.color = imp ? '#ff6b6b' : '#4ade80';

  joinEl.style.display = 'none';
  unoEl.style.display = 'none';
  controllerEl.style.display = 'flex';
  amongusRole.classList.add('show');
  setTimeout(() => amongusRole.classList.remove('show'), 3500);
});

socket.on('amongus_you', (you) => { amongusYou = you; renderAmongus(you); });

socket.on('amongus_over', () => {
  amongusActive = false;
  amongusYou = null;
  amongusRole.classList.remove('show');
  amongusVote.classList.remove('show');
  amongusDead.classList.remove('show');
  amongusVent.classList.remove('show');
  amongusSab.style.display = 'none';
  amongusSabMenu.classList.remove('show');
  amongusTasks.style.display = 'none';
  closeTask();
  shootBtn.style.display = '';
  shootBtn.textContent = 'SHOOT';
  shootBtn.classList.remove('killready', 'taskmode', 'ventmode', 'fixmode');
  shootBtn.style.opacity = '1';
  controllerEl.style.display = 'flex';
});

function renderAmongus(you) {
  if (!amongusActive) return;
  if (you.phase === 'meeting' || you.phase === 'reveal') {
    if (currentTask) closeTask();
    controllerEl.style.display = 'none';
    amongusDead.classList.remove('show');
    amongusTasks.style.display = 'none';
    amongusVent.classList.remove('show');
    amongusSab.style.display = 'none';
    amongusSabMenu.classList.remove('show');
    amongusVote.classList.add('show');
    if (you.phase === 'meeting') renderMeeting(you);
    else renderReveal(you);
    return;
  }
  // play phase
  amongusVote.classList.remove('show');

  if (you.vented) { // imposter in the vents
    controllerEl.style.display = 'none';
    amongusTasks.style.display = 'none';
    amongusSab.style.display = 'none';
    amongusSabMenu.classList.remove('show');
    amongusVent.classList.add('show');
    renderVent(you);
    return;
  }
  amongusVent.classList.remove('show');
  controllerEl.style.display = 'flex';
  amongusDead.classList.toggle('show', you.alive === false);
  amongusTasks.style.display = '';
  amongusTasks.textContent = `Tasks ${(you.tasksTotal || 0) - (you.tasksLeft || 0)}/${you.tasksTotal || 0}`;
  configureAction(you);

  if (you.role === 'imposter' && you.alive) {
    amongusSab.style.display = '';
    amongusSab.disabled = !you.canSabotage;
    amongusSab.textContent = you.sabActive ? 'SABOTAGE ✓'
      : (you.canSabotage ? 'SABOTAGE' : `SABOTAGE ${you.sabCooldown || ''}s`);
  } else {
    amongusSab.style.display = 'none';
  }
}

function configureAction(you) {
  shootBtn.classList.remove('killready', 'taskmode', 'ventmode', 'fixmode');
  if (you.role === 'imposter' && you.alive && you.canKill) {
    shootBtn.style.display = ''; shootBtn.textContent = 'KILL'; shootBtn.style.opacity = '1';
    shootBtn.classList.add('killready'); shootBtn.dataset.amode = 'kill';
  } else if (you.fixHere) {
    shootBtn.style.display = ''; shootBtn.textContent = 'FIX'; shootBtn.style.opacity = '1';
    shootBtn.classList.add('fixmode'); shootBtn.dataset.amode = 'fix';
  } else if (you.role === 'imposter' && you.alive && you.ventHere) {
    shootBtn.style.display = ''; shootBtn.textContent = 'VENT'; shootBtn.style.opacity = '1';
    shootBtn.classList.add('ventmode'); shootBtn.dataset.amode = 'vent';
  } else if (you.taskHere) {
    shootBtn.style.display = ''; shootBtn.textContent = 'DO TASK'; shootBtn.style.opacity = '1';
    shootBtn.classList.add('taskmode'); shootBtn.dataset.amode = 'task';
  } else if (you.role === 'imposter' && you.alive) {
    shootBtn.style.display = ''; shootBtn.style.opacity = '0.45'; shootBtn.dataset.amode = 'kill';
    shootBtn.textContent = you.killCooldown ? `KILL ${you.killCooldown}s` : 'KILL';
  } else {
    shootBtn.style.display = 'none'; shootBtn.dataset.amode = 'none';
  }
}

function renderVent(you) {
  avnGrid.textContent = '';
  (you.vents || []).forEach((v) => {
    const btn = document.createElement('button');
    btn.className = 'avn-btn' + (v.current ? ' current' : '');
    btn.textContent = v.label;
    if (!v.current) {
      const jump = (e) => { if (e) e.preventDefault(); socket.emit('amongus_action', { type: 'vent_move', ventId: v.id }); };
      btn.addEventListener('click', jump);
      btn.addEventListener('touchstart', jump, { passive: false });
    }
    avnGrid.appendChild(btn);
  });
}

// ---- task minigames ----
let currentTask = null;
function openTask(th) {
  currentTask = { kind: 'task', stationId: th.stationId };
  atArea.textContent = '';
  amongusTask.classList.add('show');
  if (th.type === 'hold') startHoldTask();
  else startTapTask();
}
function openFix() {
  currentTask = { kind: 'fix' };
  atArea.textContent = '';
  amongusTask.classList.add('show');
  startHoldTask();
}
function closeTask() { currentTask = null; amongusTask.classList.remove('show'); atArea.textContent = ''; }
function completeCurrentTask() {
  if (!currentTask) return;
  if (currentTask.kind === 'fix') socket.emit('amongus_action', { type: 'fix' });
  else socket.emit('amongus_action', { type: 'task', stationId: currentTask.stationId });
  closeTask();
}

function startHoldTask() {
  atTitle.textContent = 'Hold the button to fix it';
  const btn = document.createElement('div');
  btn.className = 'task-hold';
  btn.textContent = 'HOLD';
  const wrap = document.createElement('div');
  wrap.className = 'task-barwrap';
  const fill = document.createElement('div');
  fill.className = 'task-fill';
  wrap.appendChild(fill);
  atArea.appendChild(btn);
  atArea.appendChild(wrap);

  const DURATION = 1600;
  let held = false, t0 = 0;
  const tick = () => {
    if (!held || !currentTask) return;
    const pct = Math.min(1, (performance.now() - t0) / DURATION);
    fill.style.width = `${pct * 100}%`;
    if (pct >= 1) { completeCurrentTask(); return; }
    requestAnimationFrame(tick);
  };
  const down = (e) => { if (e) e.preventDefault(); held = true; t0 = performance.now(); tick(); };
  const up = (e) => { if (e) e.preventDefault(); held = false; fill.style.width = '0%'; };
  btn.addEventListener('touchstart', down, { passive: false });
  btn.addEventListener('touchend', up, { passive: false });
  btn.addEventListener('touchcancel', up, { passive: false });
  btn.addEventListener('mousedown', down);
  window.addEventListener('mouseup', up);
}

function startTapTask() {
  atTitle.textContent = 'Tap all the dots';
  let remaining = 5;
  for (let i = 0; i < 5; i++) {
    const d = document.createElement('button');
    d.className = 'task-dot';
    const tap = (e) => {
      if (e) e.preventDefault();
      if (d.classList.contains('hit')) return;
      d.classList.add('hit');
      remaining -= 1;
      if (remaining <= 0) completeCurrentTask();
    };
    d.addEventListener('touchstart', tap, { passive: false });
    d.addEventListener('click', tap);
    atArea.appendChild(d);
  }
}

function renderMeeting(you) {
  avKilled.textContent = you.killed ? `${you.killed.name} was found KILLED` : 'Emergency meeting';
  avTimer.textContent = `Vote — ${you.timeLeft || 0}s left`;
  avTitle.textContent = 'Who is the imposter?';
  const tally = you.tally || { counts: {}, skip: 0 };
  const canTap = you.canVote && !you.hasVoted;

  avGrid.textContent = '';
  (you.candidates || []).forEach((c) => {
    const b = document.createElement('button');
    b.className = 'av-btn' + (you.myVote === c.id ? ' voted' : '');
    b.style.background = c.color;
    if (!canTap) b.style.opacity = '0.75';
    const cnt = document.createElement('span');
    cnt.className = 'av-count';
    cnt.textContent = (tally.counts[c.id] || '') + '';
    b.appendChild(cnt);
    if (canTap) b.addEventListener('click', () => castVote(c.id));
    avGrid.appendChild(b);
  });

  const skip = document.createElement('button');
  skip.className = 'av-btn skip' + (you.myVote === 'skip' ? ' voted' : '');
  if (!canTap) skip.style.opacity = '0.75';
  skip.appendChild(document.createTextNode('SKIP'));
  const sc = document.createElement('span');
  sc.className = 'av-count';
  sc.textContent = (tally.skip || '') + '';
  skip.appendChild(sc);
  if (canTap) skip.addEventListener('click', () => castVote('skip'));
  avGrid.appendChild(skip);

  avStatus.style.color = '#64d2ff';
  avStatus.textContent = !you.canVote ? '👻 Ghosts can’t vote'
    : you.hasVoted ? 'Vote locked in — waiting for others' : 'Tap who you suspect';
}

function castVote(target) {
  if (amongusYou && amongusYou.hasVoted) return;
  socket.emit('amongus_action', { type: 'vote', target });
}

function renderReveal(you) {
  const r = you.result || {};
  avKilled.textContent = '';
  avTimer.textContent = '';
  avGrid.textContent = '';
  if (r.skipped) {
    avTitle.textContent = 'No one was ejected';
    avStatus.textContent = '';
  } else {
    avTitle.textContent = `${r.ejectedName} was ejected`;
    avStatus.style.color = r.wasImposter ? '#4ade80' : '#ff6b6b';
    avStatus.textContent = r.wasImposter ? '…and WAS the imposter! 🎉' : '…was NOT the imposter.';
  }
}

// ---- boot ----
initJoinScreen();
