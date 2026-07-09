# Local Multiplayer TV Game (TV + Mobile Controller)

A local party game system where an Android TV acts as the central display and players use their mobile phone web browsers as real-time joysticks via WebSockets.

---

## 🛠️ Tech Stack & Architecture

### 1. The Relay Server (`/server`)
* **Runtime:** Node.js (v20+)
* **Framework:** Express
* **Real-time Engine:** `socket.io` (WebSockets)
* **Deployment target:** Render / Linux VPS

### 2. The TV App (`/tv-screen`)
* **Engine:** HTML5 / Phaser.js (v3)
* **Wrapper:** Capacitor (for compilation to Android TV APK)
* **Resolution:** Locked 16:9 aspect ratio (Target: 1920x1080)

### 3. The Controller App (`/mobile-controller`)
* **Frontend:** Vanilla JS / HTML5 / Tailwind CSS
* **UI Focus:** Full-screen touch zones, no-scroll, web-app capable

---

## 🧭 System Workflow & Data Layout
[ Mobile Phone Browser ] --(Socket.io Event)--> [ Node.js Server ] --(Emit)--> [ Android TV App ]
### Room Connection Sequence
1. **TV Boot:** The TV app connects to the server and requests a room. Server returns a unique, random 4-character alphabetic room code (e.g., `ABCD`).
2. **Player Join:** Player scans a QR code displayed on the TV (`https://[domain]/?room=ABCD`).
3. **Handshake:** Mobile browser automatically submits the room code to join the matching Socket.io room.
4. **Assignment:** Server registers the player and assigns them a slot (`player_1`, `player_2`, etc.) and a specific color hex code.

---

## 📋 Communication Protocol (Socket Events)

When modifying or adding network events, strictly adhere to this schema:

### Mobile to Server
* `join_room` -> `{ roomCode: string, playerName: string }`
* `controller_input` -> `{ type: 'AXIS' | 'BUTTON', id: string, value: number | boolean }`

### Server to TV
* `player_joined` -> `{ id: string, slot: string, name: string, color: string }`
* `player_left` -> `{ id: string, slot: string }`
* `game_input` -> `{ slot: string, type: 'AXIS' | 'BUTTON', id: string, value: number | boolean }`

### Server to Mobile
* `join_success` -> `{ slot: string, color: string }`
* `room_error` -> `{ message: string }`

---

## 🤖 Instructions for Claude Code

When writing or refactoring code in this repository, follow these precise rules:

### 1. State Management
* **Server-Centric Rooms:** The Node.js server is the source of truth for active rooms and connected players. Do not store state globally across instances; keep it scoped per room.
* **Graceful Disconnects:** If a player's phone locks or loses Wi-Fi, the server must hold their slot for 30 seconds before freeing it up, allowing them to reconnect without losing their score.

### 2. Frontend Latency & UX
* **Zero UI Lag:** The mobile controller UI must use `touchstart`/`touchend` events instead of `click` to completely bypass mobile browser touch delays.
* **D-Pad Calculations:** For directional joysticks, normalize values between `-1.0` and `1.0`.

### 3. Android TV Constraints
* No cursor input. All initial setups must be automated or bypassable.
* Ensure the canvas scales gracefully via Phaser's `Scale.FIT` mode to prevent clipping on diverse TV display setups.

---

## 🚀 Getting Started

### Prerequisites
* Node.js installed locally.
* Android Studio (only required for `/tv-screen` native bundling via Capacitor).

### Development Spin-up
1. Start the server:
   ```bash
   cd server && npm install && npm run dev