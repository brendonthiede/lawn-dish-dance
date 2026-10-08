# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Telestrations-style party game (write a word → draw it → guess → …) on Firebase free tier: Realtime Database + Hosting + Anonymous Auth. Vanilla HTML/CSS/JS ES modules, **no build step**; Firebase SDK is imported from the gstatic CDN in `js/firebase.js`.

## Commands

```bash
npm run serve                         # python3 http.server on http://localhost:5173
npm test                              # vitest unit tests (tests/assign.test.js)
npx vitest run -t "assignItems"       # single test / describe by name
npm run test:e2e                      # tests/e2e.mjs — hits the LIVE Firebase project
firebase deploy                       # hosting + database.rules.json
firebase deploy --only database       # rules only
```

`js/firebase-config.js` is gitignored; copy from `js/firebase-config.example.js`. Without it the app renders a "Setup needed" card. The e2e test needs it too, and creates and deletes real data under the real security rules.

## Architecture

- **Hash router** in `js/app.js`: `#/` and `#/join` (join.js), `#/play?id=` (player), `#/gm?id=` (game master), `#/display?id=` (shared TV). Each view in `js/views/` exports `mount(el, params)`, which returns a cleanup function.
- **Client-authoritative, GM-driven.** There's no server compute, so the GM's browser runs all game logic in `js/game.js` (`startGame`, `advance`, timer ops, `endGame`, `playAgain`) and writes multi-path `update()`s. Players and the display only subscribe (`js/stores.js` `watchGame`) and write their own drafts, submissions, word pool and presence. The GM tab must stay open for play to progress.
- **Security model** is entirely `database.rules.json`: `meta/createdBy` (the GM's anon uid) can write the whole game; players can write only `players/$uid`, `presence/$uid`, `wordpool/$uid`, and `drafts/$round/$chainId` when `assignments/$round/$chainId` is their uid. New DB paths that players write need a rule.
- **DB shape under `games/$gid`:** `meta`, `settings`, `round {index,type,state,startOffset}`, `players`, `presence`, `wordpool`, `chains/$cid {seedWord, status: active|complete|collapsed, branchOf?, segments/$round}`, `assignments/$round/$cid → uid`, `drafts`, `submitted`, `timer`, `highlights`. Top-level `codes/$CODE → gameId`.
- **The pass (`advance` in game.js):** captures drafts into chain segments, then enforces the invariant **active chains == active players**. Late joiners spawn alternate branches (`branchOf`), leavers collapse branches, and any remaining excess makes someone work two chains. It then calls `assignItems` (`js/assign.js`, pure and unit-tested) so nobody gets a chain they already authored.
- **Round parity** (`js/util.js`): every chain starts with a word and ends on a word. `effectivePasses` defaults to `players − 1` for 2, 4 or 6 players, and to `players − 1` rounded down to even for everyone else. A GM override is used as typed. An odd pass count sets `startOffset = 1`, which makes round 0 a `"combo"` round: the player writes the word and then draws it, so round 1 is a guess. Always get round types from `segmentType(round, offset)`. A combo segment stores both `word` and `drawing`, so renderers check which fields a segment has instead of its `type`.
- **Timer:** a single `timer` node holds `endsAt`/`state`/`remainingMs`, and clients count down locally using `.info/serverTimeOffset` (`js/timer.js`). There are no per-tick writes. Per-phase durations come from `getPhaseDuration` (`drawTimerSec`/`wordTimerSec`, falling back to the deprecated `timerDurationSec`).
- **`js/task.js`** is the shared "current assignment" UI (word input, word-bank picks, drawing pad). It's used by both the player view and the GM view when the GM also plays (`meta.gmPlays`). Drawings are stored as normalized vector strokes (`js/canvas.js`), never images.

## Gotchas

- `tests/e2e.mjs` contains **hand-ported copies** of the game.js operations, written against the npm `firebase` package rather than the CDN imports. When you change a write path or data shape in `game.js`, update the e2e port to match.
- `firebase.json` hosts the repo root (`public: "."`) with an ignore list. New top-level non-app files may need adding to that list.
