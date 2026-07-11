# Indian Rummy (13-card) — Design Spec

Date: 2026-07-11
Status: Approved

Part of "add rummy and poker to the games." **Sub-project 2 of 2** (Poker
shipped first). Reuses the shared `server/src/cards.js` deck utility introduced
with poker; adds a printed-joker option to it.

## Goal

Add **Indian Rummy** (13-card, with jokers) as a fifth party game, selectable in
the lobby. Played as a **points-pool tournament**: each deal, losers accumulate
deadwood points; a player who reaches **101** is eliminated; the last player
standing wins and the room returns to the lobby.

Non-goals (v1): drop/first-drop/middle-drop, rejoin/re-buy pools, 21-card /
Deals rummy variants, betting/points value in currency.

## Rules implemented

- **Deck:** two standard 52-card decks + **two printed jokers** (106 cards).
- **Players:** 2–6 (enforced; a lobby with >6 gets an error).
- **Deal:** 13 cards each. One card turned up starts the **open discard**; the
  rest form the face-down **stock**. One further card is flipped to pick the
  **wild-joker rank** — every card of that rank (either deck, any suit) is wild,
  as are the two printed jokers. (If the flip is itself a printed joker, re-flip
  until a ranked card is found.)
- **Turn:** on your turn you **draw** one card — from the closed **stock** or the
  top of the **open discard** — giving you 14, then either **discard** one
  (turn ends) or **declare**. If the stock empties, the discard pile (minus its
  top) is reshuffled to reform the stock.
- **Melds:**
  - **Sequence (run):** 3+ consecutive cards of the **same suit**. Ace is low
    (A-2-3) or high (Q-K-A); no wrap (K-A-2 invalid).
    - **Pure:** no joker used as a substitute (no printed joker in it; every card
      natural). A wild-rank card used at its own natural rank/suit still counts
      as pure.
    - **Impure:** uses ≥1 joker (printed, or a wild-rank card standing in for a
      missing card) to complete the run.
  - **Set (trio/quad):** 3 or 4 cards of the **same rank, all different suits**
    (no duplicate suit). Jokers may substitute for missing suits.
- **Valid declaration:** the 13 cards partition exactly into valid melds with
  **at least 2 sequences, of which at least 1 is pure**. The remaining melds may
  be sequences or sets. (Declaring means discarding your 14th card and showing
  the 13 grouped.)
- **Scoring (deadwood points):** J/Q/K/Ace = 10, number cards = face value,
  jokers = 0. When someone declares validly:
  - Declarer scores **0**.
  - Each opponent scores their **minimum deadwood** (see solver), capped at
    **80**. The tiered rule: with **no pure sequence** you take **full count**
    (min(80, sum of all 13)); with a pure sequence, sequences always count as
    melded, but **sets only count once you also have a second sequence**
    (the "two life" rule); everything not in a counted meld is deadwood.
  - A player crossing **101** total is eliminated. Last player left wins.
- **Wrong declaration:** friendly for a party — the server rejects an invalid
  declare with a clear reason and the player’s turn continues (no 80-point
  penalty in v1).

## Architecture

Server-authoritative, same split as UNO/Poker. TV renders public state
(open discard, wild joker, counts, whose turn, results); each phone gets its own
13/14-card hand privately.

| Layer | File | Role |
|---|---|---|
| Shared | `server/src/cards.js` | Extend `buildStandardDeck` with a `jokers` count. |
| Engine | `server/src/rummy/melds.js` | Pure: card points, meld validation, `validateDeclaration`, `minDeadwood` solver. |
| Engine | `server/src/rummy/RummyGame.js` | Deal, wild joker, draw/discard/declare, scoring, pool elimination, tournament flow. |
| Service | `server/src/rummyService.js` | socket glue: start, actions, resend, broadcast, idle-turn timer. |
| Wiring | `handlers.js`, `index.js`, `RoomManager.js`, `config.js` | `start_rummy`/`rummy_action`, `room.rummy`, `MIN_PLAYERS_RUMMY`. |
| TV | `net.js`, `LobbyScene.js`, `scenes/RummyScene.js` | `startRummy()`, register "Rummy", render the table. |
| Phone | `mobile-controller/index.html` + `controller.js` | `#rummy` mode: draw, arrange groups, discard, declare. |
| Tests | `server/test/melds.test.js`, `rummy.test.js` | Validation, solver, and engine flows. |

## `melds.js` (pure) — the crux

```
cardPoints(card, wildRank) -> 0..10          // jokers/wild = 0
isJoker(card, wildRank) -> bool              // printed OR rank === wildRank
isValidSet(cards, wildRank) -> bool          // same rank, distinct suits, jokers fill
isValidSequence(cards, wildRank) -> { valid, pure }
validateDeclaration(groups, wildRank) -> { valid, reason? }
minDeadwood(cards, wildRank) -> number       // best-arrangement deadwood, tiered rules, cap 80
```

- `isValidSequence`: sort natural (non-joker) cards; all one suit; fill gaps and
  extend using available jokers; length ≥ 3; `pure` iff zero jokers used as
  substitutes. Ace handled both low and high (no wrap).
- `validateDeclaration`: every group a valid set/sequence, groups partition all
  13 distinct card ids, ≥2 sequences, ≥1 pure. Returns a human reason on failure
  (used by the phone).
- `minDeadwood`: the opponent-scoring solver. Generate candidate melds from the
  hand (joker-aware), backtrack over disjoint-meld arrangements, and for each
  complete arrangement apply the tiered counting rule; return the minimum
  deadwood. 13 cards → the search space is small. **Built test-first**, this is
  the highest-risk module.

## `RummyGame.js`

State: `seats`, `hands{slot:[]}`, `stock[]`, `discard[]` (open pile), `wildRank`,
`wildCard`, `turnIndex`, `phase` (`draw|discard|over`), `drawnFrom`, `scores{}`,
`status{slot:'in'|'out'}`, `winner`, `lastAction`, `dealNumber`.

Actions (`{ ok, error? }`):
- `draw(slot, source)` — `source ∈ {stock, discard}`; only on your turn in the
  `draw` phase; hand goes 13→14; `phase='discard'`.
- `discard(slot, cardId)` — from 14→13, turn advances to the next `in` player;
  `phase='draw'`.
- `declare(slot, discardId, groups)` — validate via `validateDeclaration` on the
  13 that remain after removing `discardId`; on success end the deal, score all
  opponents (`minDeadwood`), apply pool elimination, and either set `winner`
  (`phase='over'`) or start the next deal; on failure return the reason and leave
  the turn unchanged.

Views: `publicState()` (open discard top, wild joker, per-player hand counts +
scores + status, whose turn, last deal result, winner — never hands);
`handState(slot)` (that player's cards + legal actions).

Deterministic via `opts.rng`/`opts.testState`, like `UnoGame`/`PokerGame`.

## Service

Mirrors `unoService`/`pokerService`. Broadcast `rummy_state` to the TV and
`rummy_hand` to each seat. A generous **idle-turn timer (~45s)** auto-plays a
stalled seat (draw from stock, discard the drawn card) so the table never hangs.
On game over emit `rummy_over { winner, winnerName }`, null `room.rummy`, reset to
penalty. `resendHand` on reconnect/mid-round join.

## TV scene (`RummyScene.js`)

Felt: the **wild-joker** card shown prominently (this rank is wild), the closed
stock (count) and the open discard top, each seat with name/hand-count/pool-score
and an eliminated stamp at 101, the active seat highlighted, running action text,
and a deal-result panel (who declared, everyone's deadwood) plus the final
tournament-winner banner. Audio via the existing module (`card`, `ding`, `win`).

## Phone UI (`#rummy` mode)

- **Draw row:** buttons for **Stock** (face-down) and **Discard** (shows the top
  card); enabled only in your `draw` phase.
- **Hand grouping:** your cards as tiles with the wild joker highlighted. Tap
  tiles to select, **Group** to bind them into a labelled group row, **Ungroup**
  to release. A **Sort** helper arranges by suit/rank. Ungrouped tiles sit in a
  tray.
- **Finish:** pick a card as the **discard**, then **Discard** (normal turn end)
  or **Declare** (validates your groups; on rejection shows the server’s reason).
- Everything disables with a "Waiting for {name}…" banner off-turn.

## Testing

- `melds.test.js` — sequence purity (pure vs joker-filled), Ace low/high & no
  wrap, sets with distinct suits + joker fill, `validateDeclaration` accept/reject
  (too few sequences, no pure, unused/duplicate cards), and `minDeadwood` across
  the tiered rules (no pure → full count; pure but one sequence → sets not
  counted; two sequences → sets counted; jokers = 0).
- `rummy.test.js` — deal sizes and wild-joker pick, draw/discard turn rotation,
  a valid declare ends the deal and scores opponents, pool elimination at 101,
  tournament ends with one winner, stock reshuffle when empty. Seeded rng.
- A socket smoke test (`rummy-protocol.test.js`) guards the wiring.

## Risk

- `minDeadwood` and sequence/joker handling are the highest-risk; both pure and
  test-first.
- Additive to the server: new room fields, new events, one lobby entry. No change
  to existing games’ paths.
