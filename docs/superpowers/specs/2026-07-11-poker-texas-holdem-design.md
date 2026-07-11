# Texas Hold'em Poker — Design Spec

Date: 2026-07-11
Status: Approved

Part of "add rummy and poker to the games." This is **sub-project 1 of 2**
(Poker first, then Indian Rummy). The two games are independent and share only a
small standard-deck utility (`server/src/cards.js`), introduced here.

## Goal

Add **Texas Hold'em** as a fourth party game, selectable in the lobby alongside
Penalty Rumble, UNO, and Among Us. Full betting, played as a **tournament**:
equal starting stacks, blinds every hand, bust-out at zero chips, keep dealing
until one player holds all the chips — that player wins and the room returns to
the lobby.

Non-goals (v1): escalating blind levels, rebuys, tournament payout tables,
rabbit-hunting, run-it-twice, per-hand chat, hand history.

## Architecture

Server-authoritative, exactly like UNO and Among Us. The Node server owns the
game; the TV renders **public** state; each phone receives only **its own** two
hole cards. This mirrors the existing `UnoGame`/`unoService` split.

| Layer | File | Role |
|---|---|---|
| Shared | `server/src/cards.js` | Standard 52-card deck builder + Fisher–Yates shuffle (rng-injectable). Reused by Rummy later. |
| Engine | `server/src/poker/handRank.js` | Pure 7-card hand evaluator + comparator. No state, no networking. |
| Engine | `server/src/poker/PokerGame.js` | Authoritative game: dealing, betting rounds, blinds, min-raise, side pots, showdown, tournament flow. Pure logic, `opts.rng`/`opts.testState` injectable like `UnoGame`. |
| Service | `server/src/pokerService.js` | socket.io glue: `startPoker`, `handlePokerAction`, `resendHole`, `handlePlayerLeft`, `broadcastPoker`; owns the turn timer + between-hand timer. |
| Wiring | `server/src/handlers.js` | `start_poker` (TV), `poker_action` (player); resend hole cards on rejoin. |
| Wiring | `server/index.js` | `onPlayerLeft` → `poker.handlePlayerLeft`. |
| Wiring | `server/src/RoomManager.js` | Add `poker: null`, `pokerTimers` to the room record. |
| Wiring | `server/src/config.js` | `MIN_PLAYERS_POKER: 2`. |
| TV | `tv-screen/src/net.js` | `startPoker()`, listeners for `poker_state` / `poker_over`. |
| TV | `tv-screen/src/scenes/LobbyScene.js` | Register `{ key:'poker', name:"Texas Hold'em", min:2 }`; branch in `startSelectedGame`. |
| TV | `tv-screen/src/scenes/PokerScene.js` | Felt-table render of public state, with juice + audio. |
| Phone | `mobile-controller/index.html` | `#poker` DOM block. |
| Phone | `mobile-controller/src/controller.js` | Poker mode: render hole cards + betting controls, emit `poker_action`. |
| Tests | `server/test/handRank.test.js` | Evaluator categories, tie-breaks, wheel, best-5-of-7. |
| Tests | `server/test/poker.test.js` | Blinds, heads-up, min-raise, all-in side pots, fold-to-win, bust-out, tournament end. |

## Defaults (approved, centralised as constants in `PokerGame.js`)

- Starting stack: **1000** chips each.
- Blinds: **small 10 / big 20**, fixed (no escalation in v1).
- Turn timer: **30s**. On expiry the server auto-acts: **check** if checking is
  free, otherwise **fold**. Prevents an idle/disconnected phone from stalling
  the table.
- Between-hand pause: **~4s** to show the result before the next deal.

## `server/src/cards.js` (shared)

```
RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A']   // index = rank strength, A high
SUITS = ['s','h','d','c']
buildStandardDeck({ decks = 1 } = {}) -> [{ id, rank, suit }]    // 52 * decks cards, stable ids
shuffle(arr, rng = Math.random) -> arr                           // in-place Fisher–Yates
RANK_VALUE = map rank -> 2..14                                    // A = 14
```

Rummy will later extend this (2 decks + printed jokers); v1 exposes only what
poker needs, but the module is written to be game-neutral.

## `server/src/poker/handRank.js` (pure)

```
evaluateSeven(cards7) -> { category, ranks, name }
```

- `category`: integer 0..8 — `0` high card, `1` pair, `2` two pair, `3` trips,
  `4` straight, `5` flush, `6` full house, `7` quads, `8` straight flush.
- `ranks`: tie-break array (rank values, high→low) comparable lexicographically
  against another hand of the same category.
- `name`: display string ("Full House").
- Evaluates the **best 5 of 7**. Handles the **A-2-3-4-5 "wheel"** straight
  (treated as 5-high). Cards use the `{rank,suit}` shape from `cards.js`.

```
compareHands(a, b) -> -1 | 0 | 1     // by category, then ranks lexicographically
```

Correctness of this module is critical, so it is built test-first with an
exhaustive category/tie-break suite.

## `server/src/poker/PokerGame.js`

### State

Per player (`this.players[slot]`):
`{ slot, stack, bet, committed, status, hole, hasActed }`
- `stack`: chips behind.
- `bet`: chips committed **in the current betting round** (reset each street).
- `committed`: total chips committed **this hand** (drives side pots).
- `status`: `active | folded | allin | out`. `out` = busted, sits out all hands.
- `hole`: two cards (private).
- `hasActed`: whether they've acted since the last aggressive action this street.

Table:
`seats` (slot order), `button`, `deck`, `community[]`, `street`
(`preflop|flop|turn|river|showdown|handover`), `toAct`, `currentBet` (amount to
match this street), `minRaise` (size of the last legal raise), `phase`
(`playing|over`), `winner`, `lastAction { slot, text }`.

### Hand lifecycle

1. `startHand()` — only players with `status !== 'out'` and `stack > 0` are dealt
   in. Rotate `button` to the next live player. Post blinds (heads-up: **button
   posts the small blind and acts first preflop**; 3+: SB left of button, BB next,
   action starts left of BB). Deal two hole cards each. `street = 'preflop'`.
2. Betting round: `toAct` acts; a street closes when every non-folded,
   non-all-in player has `hasActed` and matched `currentBet` (or is all-in).
   Then `_advanceStreet()` deals flop (3) / turn (1) / river (1), resets `bet`,
   `currentBet`, `hasActed`.
3. `showdown` — reveal remaining players' holes, build side pots from
   `committed`, award each pot to the best hand(s) among its eligible players
   (split on ties, odd chip to the first seat left of the button).
4. Fold-to-win — if all but one fold at any point, that player takes the pot
   immediately without showing.
5. `handover` — mark busted players `out`. If one live player remains overall →
   `phase='over'`, `winner` set. Else the service schedules the next `startHand()`.

### Actions — `act(slot, action, amount)` → `{ ok, error? }`

- `fold` — always legal on your turn.
- `check` — legal only when `currentBet === player.bet` (nothing to call).
- `call` — pay `min(currentBet - bet, stack)`; going all-in for less is allowed.
- `raise` — to a total `amount`; must be ≥ `currentBet + minRaise` unless it's an
  all-in for less than a full raise (allowed, but doesn't reopen betting for
  players already acted). Updates `minRaise`, resets others' `hasActed`.
- `allin` — shove entire stack; treated as a call or raise depending on size.

`legalActions(slot)` returns `{ canFold, canCheck, callAmount, minRaiseTo,
maxRaiseTo }` for the phone to render controls precisely.

### Public vs private state

- `publicState()` — `street`, `community`, `pot` (total + side pots), `button`,
  blinds, `toAct`, `currentBet`, `minRaise`, `lastAction`, `winner`, and per
  player `{ slot, stack, bet, status, hasCards, revealedHole? }`. Hole cards are
  included **only** for players shown at showdown.
- `holeState(slot)` — that player's `hole`, `yourTurn`, and `legalActions`.

## `server/src/pokerService.js`

Mirrors `unoService`. Adds two timers, cleared/reset on every state change and on
teardown:

- **Turn timer** (30s): when it fires, call `act` with the auto-action
  (`check` if free, else `fold`) for `toAct`, then broadcast.
- **Between-hand timer** (~4s): after a hand reaches `handover`, schedule
  `startHand()` + broadcast, unless `phase === 'over'`.

Broadcast: `poker_state` (public) to the TV; `poker_hole` (`{...holeState,
state: public}`) to each seated player's socket. On `phase === 'over'`, emit
`poker_over { winner, winnerName }` to the room, clear timers, null `room.poker`,
`room.currentGame = 'penalty'`.

`handlePlayerLeft(slot)` — treat as fold if it's a live hand; if they were
`toAct`, advance. A player who leaves for good keeps their seat as `out` for
tournament bookkeeping but never acts again (auto-folded each hand). If leaving
drops the table to a single live player, the tournament ends.

`resendHole(slot)` — re-emit that player's hole cards + public state on
reconnect / mid-round join (called from `join_room`, like `uno.resendHand`).

## Handlers (`server/src/handlers.js`)

- `start_poker` (TV only) → `poker.startPoker(io, room)`.
- `poker_action` (player only) → `poker.handlePokerAction(io, room, slot,
  payload)` where payload is `{ action:'fold'|'check'|'call'|'raise'|'allin',
  amount? }`.
- In `join_room`, add `if (room.poker) poker.resendHole(io, room, player.slot)`.

## TV scene (`PokerScene.js`)

Green felt. Community cards + pot in the centre; seats arranged around an oval,
each showing name, chip stack, current bet as chips, and status (folded dims the
seat, all-in tags it). A dealer **button** disc and small/big-blind markers. The
`toAct` seat is highlighted with a countdown ring driven by the turn timer.
Running action text ("Bob raises to 80"). At showdown, winners' hole cards flip
up and the pot slides to them with a chip sound; busted players get an "OUT"
stamp. A final tournament-winner banner before returning to the lobby. Sounds and
music via the existing `audio` module (reuse the closest existing cues).

## Phone UI (`#poker` mode)

Self-sufficient so a player can look down and act. Shows: the two hole cards
(large), your stack, the pot, the shared community cards (small mirror of the
TV), and the amount to call. Controls:

- **FOLD**
- **CHECK / CALL** — one button, label switches to `CHECK` when free or
  `CALL 40` when there's a bet; disabled if illegal.
- **RAISE** — opens a size picker: a slider from `minRaiseTo` to `maxRaiseTo`
  plus quick chips (½-pot, pot, all-in); confirm sends `raise` with the total.
- **ALL-IN** — shoves `maxRaiseTo`.

When it isn't your turn everything disables under a "Waiting for {name}…" banner;
the turn timer is shown. All buttons use `touchstart` (repo latency rule). On
`poker_over`, return to the standard controller view (as UNO does).

## Testing

- `handRank.test.js` — each category detected; tie-breaks (higher pair, kicker,
  two-pair kicker, full-house ranks); the A-2-3-4-5 wheel; A-high straight;
  best-5-of-7 selection; `compareHands` ordering and split ties.
- `poker.test.js` — blind posting (heads-up vs 3+), first-to-act positions,
  check/call/raise legality and `minRaise`, an **all-in producing correct main +
  side pots** with a worked payout, fold-to-win awards the pot without showing,
  bust-out marks `out`, tournament ends with a single `winner`. Deterministic via
  seeded `opts.rng` and `opts.testState`.
- Existing `protocol.test.js` remains green (no schema regressions for the shared
  events).

## Rollout / risk

- The hand evaluator and side-pot math are the highest-risk pieces; both are pure
  and built test-first.
- No changes to the Penalty Rumble input relay or the UNO/Among Us paths beyond
  additive wiring (new room fields, new socket events, one new lobby entry).
- Blinds are fixed, so a heads-up endgame with deep stacks could run long; that's
  an accepted property of "tournament, last one standing" and tunable via the
  blind constants.
