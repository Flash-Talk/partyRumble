# Penalty Rumble 🥅⚽

A party game for a TV + phones, **2–8 players**. The **TV** is a shared arena that
reshapes to the player count — a regular polygon (triangle → … → octagon) where
each player owns one side (their goal) and an equal wedge. Each player's **phone**
is a wireless joystick. When the ball is in your zone you attack and shoot at
everyone else's goal; when it isn't, you're the goalie. Timed match,
**best goal difference wins**.

Built on the platform described in [`partyGame.md`](./partyGame.md): a Node +
socket.io relay server, a Phaser TV screen, and a vanilla-JS phone controller.
Full design spec: [`docs/superpowers/specs/2026-07-09-4-way-penalty-rumble-design.md`](./docs/superpowers/specs/2026-07-09-4-way-penalty-rumble-design.md).

---

## Quick start

**Prerequisites:** Node.js v20+, and a phone + TV/laptop on the **same Wi-Fi**.

```bash
# from the project root
npm install        # installs the server's dependencies
npm run dev        # starts the server on http://localhost:3000
```

Then:

1. **On the TV** (or any browser), open **`http://<your-pc-ip>:3000/tv`**.
   It shows a 4-letter room code and a QR code.
2. **On each phone**, scan the QR (or open `http://<your-pc-ip>:3000/` and type
   the code). Enter a name, tap **JOIN**.
3. Once **2+ players** are in, **anyone taps SHOOT** on their phone to start.

> **Find your PC's LAN IP (Windows):** run `ipconfig` and look for the
> `IPv4 Address` on your Wi-Fi adapter (e.g. `192.168.1.42`). Phones must use
> that IP, not `localhost`.

### Playing solo / on one machine (no phones)

Open `http://localhost:3000/tv?debug=1`, join a phone (or another browser tab at
`http://localhost:3000/`), and you can also drive **Player 1 from the keyboard**:
**arrow keys** move, **SPACE** shoots / starts the match.

---

## How to play

- **Arena:** a regular polygon that fits the player count — each player owns one
  side (their goal) and an equal triangular wedge from that side to the center.
  You can move only **inside your own zone**; the ball flies across the whole field.
- **Attack:** when the ball touches your disc it **sticks** to you. Aim with the
  joystick, tap **SHOOT** to fire it at an opponent's goal. You can only hold it
  ~2.5s before it auto-releases.
- **Defend:** when you don't have the ball, block shots headed for your goal —
  the ball bounces off your disc, and a loose ball you touch becomes yours.
- **Score:** put the ball in someone's goal → **+1 for you, −1 for them**.
- **Power-ups:** icons spawn on the field — touch one with your disc for a few
  seconds of ⚡ **Speed**, 🛡️ **Big Wall** (bigger blocker), 💥 **Power Shot**
  (faster shots), or ❄️ **Freeze** (everyone else slows to a crawl).
- **Win:** after **90 seconds**, best **goal difference** (scored − conceded)
  wins. A tie goes to **sudden death** — next goal decides.
- **2–8 players:** the arena reshapes each round to however many joined (2 = a
  face-off rectangle, 3 = triangle, 4 = square, … 8 = octagon).

**Controller:** left ⅔ of the screen is a floating joystick, right is the SHOOT
button. Uses `touchstart`/`touchend` for zero tap-delay.

---

## Project layout

```
server/            Node + Express + socket.io relay (rooms, players, input relay)
  index.js         server factory + static hosting of the two web apps
  src/             RoomManager, socket handlers, config
  test/            protocol integration tests (node:test)
tv-screen/         Phaser 3 TV app (the game simulation runs here)
  src/             scenes/, geometry, net, config
  vendor/          phaser.min.js + qrcode.min.js (vendored for offline LAN play)
mobile-controller/ vanilla-JS phone controller (joystick + SHOOT)
docs/…             design spec
```

The server hosts everything on one port: `/tv` → TV app, `/` → controller.

---

## Testing

```bash
npm test           # runs the server protocol integration tests
```

Covers: room creation (4-letter code), slot + color assignment, input relay
(`controller_input` → `game_input`), room-full rejection, and 30-second
disconnect grace with same-slot reconnect. The gameplay (physics, possession,
scoring) runs on the TV and is best verified by playing a round.

---

## Tuning

All gameplay numbers live in **`tv-screen/src/config.js`** (`CONFIG`): match
length, move/shoot speeds, hold timer, goal width, ball drag, etc. Server-side
knobs (max players, colors, disconnect grace) are in **`server/src/config.js`**.

---

## Deploy it online (permanent public site)

The whole app is one Node server, so hosting it anywhere with WebSocket support
makes it playable from any browser — no install, no LAN. It's set up for
**Render** (free tier) via the included [`render.yaml`](./render.yaml).

**One-time setup (~10 min):**

1. **Put the code on GitHub.** Create an empty repo at github.com, then from the
   project root:
   ```bash
   git init && git add -A && git commit -m "Penalty Rumble"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
2. **Deploy on Render.** Sign in at [render.com](https://render.com) → **New +**
   → **Blueprint** → pick your repo. Render reads `render.yaml`, builds, and
   gives you a URL like `https://penalty-rumble.onrender.com`.
   *(No blueprint? Use **New + → Web Service** instead: Build `npm install`,
   Start `npm start`, Health check path `/healthz`.)*
3. **Play.** Open **`https://<your-app>.onrender.com/tv`** on the shared screen;
   players open **`https://<your-app>.onrender.com/`** on their phones (or scan
   the QR). The join links/QR use the deployed domain automatically.

**Notes on the free tier:**

- The service **sleeps after ~15 min idle**; the first visit then takes ~30–60s
  to wake. During a match there's constant traffic, so it stays awake mid-game.
- HTTPS/WSS is provided by Render — nothing to configure.
- If the **host screen's** connection blips, the room + scores survive for 60s so
  the host can reconnect (open the same `/tv` tab) without losing the party.

Other hosts work too (Railway, Fly.io, any VPS): they just need to run
`npm install` then `npm start` and expose the `PORT` env var — all already wired.

## Troubleshooting

- **Phone can't connect:** confirm phone and PC share the same Wi-Fi and you're
  using the PC's LAN IP (not `localhost`). Some routers block device-to-device
  traffic ("AP/client isolation") — disable it or use a phone hotspot.
- **QR won't scan:** just type the 4-letter code on the phone at
  `http://<pc-ip>:3000/`.
- **Windows Firewall prompt** on first `npm run dev`: allow Node on private
  networks so phones can reach it.

---

## Future work (not built yet)

- **Android TV APK** via Capacitor (wrap `tv-screen`; it already uses
  `Scale.FIT` and a locked 16:9 canvas).
- **Server deployment** to Render / a VPS for play beyond the LAN.
- Stretch mechanics: a DASH lunge, charge-shots, power-ups, best-of-N series.
