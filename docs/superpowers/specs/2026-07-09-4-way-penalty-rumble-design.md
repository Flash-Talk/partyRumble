# 4-Way Penalty Rumble — Design Spec

**Date:** 2026-07-09
**Status:** Approved, implementing
**Platform:** Local multiplayer TV game (Android TV / any browser as screen, phones as controllers) per `partyGame.md`.

---

## 1. Concept

A fast, chaotic 4-player free-for-all penalty brawl. One ball, four goals — one goal per wall of a square arena, one per player. When the ball enters **your zone you attack** (trap it, aim, shoot at an opponent's goal); when it's elsewhere **you defend** your own goal as a goalie. Roles flip constantly. Every player is their spec-assigned color.

- **Players:** 2–4 (designed for 4). Unclaimed walls become solid (no goal).
- **Win rule:** timed match; best **goal difference** (scored − conceded) wins. Tie → sudden death (next change in goal-difference wins).
- **Deliverable (this build):** fully playable local web version over Wi-Fi. Capacitor/Android-TV APK packaging is documented future work, not built now.

---

## 2. Arena geometry

Square play field. Two diagonals (corner-to-corner) split it into **4 triangular zones**, one per wall:

- `player_1` → **top** wall/zone
- `player_2` → **right** wall/zone
- `player_3` → **bottom** wall/zone
- `player_4` → **left** wall/zone

Each wall has a **goal opening centered on it**, width ≈ 22% of the wall length; the rest of the wall is solid. A player is a **disc** that can move **only inside its own triangle** (position clamped to the wedge each frame). The **ball ignores zone boundaries** and flies/bounces across the entire field; the zone boundaries constrain players only.

```
        +----[ P1 GOAL ]----+
        | \       P1      / |
        |   \  (top)    /   |
 [P4    |     \  o    /     |    P2
 GOAL]  |  P4   \ *  /  P2  |  GOAL]
        | (left)  \/ (right)|
        |     /  P3  \      |
        |   / (bottom) \    |
        +----[ P3 GOAL ]----+
```

**Wedge clamp math:** field is a square with center `C`. Triangle for a wall = the wall segment + the two triangles' shared apex at `C`. A player's position is clamped so it stays on the wall's side of both diagonals AND inside the field bounds, with a small margin so the disc radius never crosses a boundary.

**Fewer than 4 players:** an unclaimed wall renders as a solid wall (no opening); that triangle is simply empty. 2 and 3 players are fully supported.

---

## 3. Core loop / mechanics

Simulation runs on the **TV** (Phaser). Server only relays inputs. Fixed tunables live in one `CONFIG` object.

| Mechanic | Rule (v1 default) |
|---|---|
| **Movement** | Joystick axis → disc velocity (`speed = 520 px/s` at full tilt), clamped to the player's wedge. |
| **Possession / trap** | When the ball touches your disc and you're off cooldown, it **traps** (sticks just ahead of your disc, moving with you). |
| **Hold timer** | You may hold the ball **2.5 s**; then it auto-releases forward so nobody stalls. |
| **Aiming** | While holding, the joystick sets aim direction; an arrow shows it. Neutral joystick → auto-aim at the nearest opponent goal. |
| **Shooting** | `SHOOT` fires the ball at fixed power (`900 px/s`) along the aim; a short **0.4 s trap cooldown** follows so it doesn't instantly re-trap. |
| **Defending** | No ball = goalie. Disc **body-blocks**; shots bounce off (a save). A loose ball you touch traps to you (possession flips). |
| **Scoring** | Ball fully enters a goal opening → **shooter +1 scored**, **goal owner +1 conceded**; ball resets to center after a 3-2-1, launched at a random player. |
| **Own goals** | If a player shoots into their own goal, that counts as conceded only (no scorer credit). |
| **Match** | **90 s** clock. Best goal difference wins. Tie → **sudden death**: first goal-difference change ends it. |

Ball physics: bounces off solid walls and player discs (restitution 1, capped max speed). One ball only.

---

## 4. Controls (phone / mobile-controller)

Full-screen, no-scroll, `touchstart`/`touchend` (bypass click delay per spec). Layout:

- **Left ~⅔ of screen:** virtual **joystick** (thumb-drag). Emits two `AXIS` events:
  - `{ type:'AXIS', id:'x', value }`, `{ type:'AXIS', id:'y', value }` — each normalized **−1.0 … 1.0**.
- **Right ~⅓:** large **SHOOT** button. Emits `{ type:'BUTTON', id:'shoot', value:true|false }` on `touchstart`/`touchend`.
- Header shows the player's slot/color and connection status.
- **Stretch (not v1):** small **DASH** button (`id:'dash'`) for a defensive lunge.

Only non-zero axis changes are sent (throttled to animation frame) to limit traffic.

---

## 5. Screens & flow (TV, Phaser scenes)

1. **BootScene** — connect to server, `request_room`/create room, load assets, go to Lobby.
2. **LobbyScene** — large **4-letter room code** + **QR code** (`window.location.origin + '/?room=CODE'`), and joined players listed in their colors. Android TV has no cursor, so: once **≥2 players** joined, any player pressing **SHOOT** starts a 3-2-1 countdown → GameScene.
3. **GameScene** — arena, colored zones/discs, ball, per-player **HUD** (scored / conceded / diff), match **timer**. Runs the full simulation, consuming `game_input` events.
4. **ResultScene** — winner + final standings; **press SHOOT to rematch** (returns to Lobby keeping the same players/room).

`Scale.FIT`, locked **16:9 / 1920×1080** design resolution.

---

## 6. Architecture & protocol

Single Node process serves everything on port `3000`:

- **`/server`** — Express + socket.io. **Source of truth for rooms & players only** (not gameplay). Responsibilities:
  - Generate a unique random **4-letter alphabetic** room code on TV request.
  - On player `join_room`: assign next free slot `player_1…player_4` + fixed color; reject with `room_error` if full/invalid.
  - **Relay** `controller_input` → `game_input` to that room's TV.
  - Notify TV of `player_joined` / `player_left`.
  - **Graceful disconnect:** hold a slot for **30 s** for reconnect (same name/slot) before freeing it and emitting `player_left`.
  - State is **scoped per room** (a `Map<roomCode, Room>`), never global.
  - Statically serves `tv-screen/` at `/tv` and `mobile-controller/` at `/`.
- **`/tv-screen`** — Phaser 3 app. **Runs the game simulation** (physics, possession, scoring). Phaser vendored locally for offline LAN play.
- **`/mobile-controller`** — vanilla JS + self-contained CSS controller. Auto-reads `?room=` and joins.

### Socket events (verbatim from `partyGame.md`, plus one bootstrap)

Mobile → Server: `join_room {roomCode, playerName}`, `controller_input {type,id,value}`
Server → TV: `player_joined {id,slot,name,color}`, `player_left {id,slot}`, `game_input {slot,type,id,value}`
Server → Mobile: `join_success {slot,color}`, `room_error {message}`
**Bootstrap (added):** TV → Server `create_room {}` → Server → TV `room_created {roomCode}`. (The spec describes the TV requesting a room but names no event; this fills that gap without altering the defined schema.)

Slot colors (fixed): `player_1` `#ef4444` (red), `player_2` `#3b82f6` (blue), `player_3` `#22c55e` (green), `player_4` `#eab308` (yellow).

---

## 7. File structure

```
Party Game/
  partyGame.md
  docs/superpowers/specs/2026-07-09-4-way-penalty-rumble-design.md
  package.json                 # root: scripts (dev), delegates to server
  server/
    package.json               # express, socket.io, (dev) socket.io-client for tests
    index.js                   # http + socket.io bootstrap, static serving
    src/
      RoomManager.js           # rooms, slots, colors, codes, disconnect grace
      handlers.js              # socket event wiring / relay
      config.js                # colors, grace period, max players
    test/
      protocol.test.js         # node integration test over real sockets
  tv-screen/
    index.html                 # loads vendored phaser + socket.io client
    vendor/phaser.min.js
    vendor/qrcode.min.js
    src/
      main.js                  # Phaser.Game config, Scale.FIT 1920x1080
      net.js                   # socket wrapper, room bootstrap, input bus
      config.js                # gameplay tunables (CONFIG)
      geometry.js              # arena wedges, goal openings, clamp helpers
      scenes/BootScene.js
      scenes/LobbyScene.js
      scenes/GameScene.js
      scenes/ResultScene.js
  mobile-controller/
    index.html                 # controller markup + self-contained CSS
    src/
      controller.js            # joystick + shoot, socket, join flow
```

---

## 8. Build order (milestones)

1. **Server + protocol** — RoomManager, handlers, static serving; node integration test proves create-room / join / slot+color / relay / full / disconnect-grace.
2. **Mobile controller** — joystick + SHOOT, join via `?room=`, emits `controller_input`; verify events arrive at a stub TV socket.
3. **TV shell** — Phaser boots, BootScene creates room, LobbyScene shows code + QR + joining players, SHOOT-to-start.
4. **Gameplay** — GameScene: arena geometry, discs, ball physics, possession/aim/shoot, scoring, timer, HUD.
5. **Result + rematch**, polish (juice: goal flash, trails, sfx optional), and a README with run instructions.

---

## 9. Verification

- **Automated:** `server/test/protocol.test.js` drives real socket.io clients through create-room → join (slot+color) → controller_input → game_input relay → room-full rejection → disconnect 30 s grace/reconnect. Run headless in CI/local.
- **Manual (needs devices):** load `/tv` in a browser, join from ≥2 phones via QR, play a match. Documented in README with the exact URLs and the `<pc-ip>` hint.
- Front-end load is smoke-checked for console errors; full gameplay feel is validated on real devices.

---

## 10. Future work (out of scope now)

- Capacitor config + `android/` project to bundle `tv-screen` as an installable **Android TV APK** (`Scale.FIT` already TV-safe).
- Render/VPS deployment of the server.
- Stretch mechanics: DASH lunge, charge-shots, power-ups, best-of-N series.
```

