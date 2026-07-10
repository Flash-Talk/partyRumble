# Among Us (social deduction) — design spec

**Date:** 2026-07-10 · **Status:** Approved, building Phase 1

A third game for the party platform: a walkable-map social-deduction game. Runs
best with players **in the same room or on a voice call** (deduction happens by
talking). **4–8 players, 1 imposter (v1).**

## Core rules (v1)
- **Server-authoritative** (roles are hidden, so the imposter's identity must
  never reach the shared TV). The server runs a real-time loop: moves every
  character from phone joysticks, does wall collision, validates kills, tracks
  votes/tasks/phase, and broadcasts. The **TV is a pure renderer**; **phones**
  send movement + actions and show role-based UI.
- **Anonymity:** each player is a distinctly-**colored** character with **no name
  shown** during play. A name is revealed only when the player is **killed** or
  **ejected** (their character then shows name + KILLED/EJECTED).
- **Loop:** roles dealt privately → walk the map + crew do task minigames →
  imposter **KILL** (proximity + cooldown) → victim's **name pops up as KILLED**
  on the TV → **instant meeting** → alive players **vote live** (pick a color or
  Skip) → most-voted **ejected**, role revealed → repeat.
- **Win:** crew win if the imposter is **ejected** or **all tasks done**; imposter
  wins on **parity** (can't be outvoted). Dead players are **ghosts** (roam +
  finish tasks, can't vote).

## Architecture / protocol
- Room gains `currentGame:'amongus'` + an `AmongUsGame` instance + a tick loop.
- `controller_input` (joystick AXIS + action BUTTON) is **consumed by the server**
  for amongus (not relayed to the TV).
- TV→server: `start_amongus`. Server→TV: `amongus_start {map}` once, then
  `amongus_state {phase, players:[{id,color,x,y,alive,name?}], winner}` ~20 Hz.
  Server→phone (private): `amongus_role {role,color}`, `amongus_you {...}`.
  phone→server: `amongus_action {type:'kill'|'vote'|'report'|'task', ...}`.
  Server→room: `amongus_over {winner}`.

## Phased build (each verified before the next)
1. **Map + movement + roles** — server sim (move/collision), TV renders map +
   anonymous characters, private role reveal on phones. ← *this phase*
2. **Kill + death reveal** — proximity KILL, name-pops-KILLED on TV, ghosts.
3. **Meetings + live voting + win conditions.**
4. **Task minigames + task bar** (crew win path).
5. **Audio pass** across all games (lobby/gameplay loops, victory jingle, SFX,
   TV "tap to enable sound") — fulfills the separate music request too.

## Phase 1 detail
- `server/src/amongus/map.js` — bounds, wall rects, spawn points (task stations
  reserved for Phase 4).
- `server/src/amongus/AmongUsGame.js` — players {slot,color,name,x,y,input,alive,
  role}; `assignRoles` (1 random imposter); `setInput`; `step(dt)` (move + clamp
  bounds + circle-vs-rect wall resolve); `publicState()` (anonymized: color/pos/
  alive, name only when dead, **never role**); `roleFor(slot)`.
- `server/src/amongusService.js` — `start` (assign, spawn, begin 20 Hz loop,
  emit `amongus_start`+`amongus_role`), loop (`step`+broadcast `amongus_state`),
  `handleInput`, disconnect handling, stop.
- TV `AmongUsScene` renders the map walls + colored characters (no names) and
  moves them from `amongus_state`.
- Phone: on `amongus_role`, show a role banner; keep the joystick for movement
  (joystick already emits `controller_input`).
- Lobby game selector gains **Among Us** (min 4 players).
