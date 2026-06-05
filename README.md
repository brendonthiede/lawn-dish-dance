# Lawn Dish Dance 🎨📝

A Telestrations-style party game. Players alternate **writing a word** and
**drawing it**, and the word/image chain passes virtually around the group —
no physical device passing, everyone uses their own phone. A **game master**
controls the timer and the passes, and a **shared display** (a bar TV) shows a
join QR + code, live counts, and the end-of-game highlight reveals.

Runs entirely on **free** infrastructure: Firebase Realtime Database + Hosting +
Anonymous Auth (Spark plan). No server code, no paid storage — drawings are
stored as compact vector strokes in the database.

## How it works

- **Vanilla HTML/CSS/JS**, no build step. ES modules load the Firebase + QR
  libraries directly from CDNs.
- **Client-authoritative:** the free plan has no server compute, so the GM's
  browser runs all game logic (assignment, branching, rebalancing, advancing)
  and writes results to the DB. Players and the display are pure subscribers.
  *The GM device must stay connected for play to progress.*
- **The pass:** each round, every in-flight chain is matched to a player who
  hasn't authored it (`js/assign.js`). The core invariant is
  **in-flight chains == active players**:
  - a **late joiner** spawns an *alternate branch* of an existing word,
  - a **leaver** collapses an alternate branch (or, if none, one player works
    two chains that round),
  - default passes = `players − 1` rounded down to even so each chain
    **ends on a word** (GM can override).
- **Timer sync** uses a single `endsAt` timestamp; every client counts down
  locally with clock-skew correction — no per-second writes.

## Routes

| URL | Who |
|---|---|
| `#/` | Landing — join by code or host |
| `#/join?g=CODE` | Join form (QR deep-links here) |
| `#/play?id=GAMEID` | Player |
| `#/gm?id=GAMEID` | Game master control panel |
| `#/display?id=GAMEID` | Shared display (TV) |

## Setup (one time, free)

1. Create a project at <https://console.firebase.google.com> (Spark/free plan).
2. **Build → Realtime Database → Create database** (locked mode is fine).
3. **Build → Authentication → Get started → enable Anonymous.**
4. **Project settings → Your apps → Web (`</>`)**, register, and copy the config.
5. `cp js/firebase-config.example.js js/firebase-config.js` and paste your config
   in (it's gitignored).
6. Put your project id in `.firebaserc`.
7. Deploy the security rules: `firebase deploy --only database` (rules are in
   `database.rules.json`).

> The Firebase web API key is **not** a secret — access is controlled entirely
> by `database.rules.json`.

## Run locally

```bash
npm run serve        # serves at http://localhost:5173 (python3 http.server)
```

Open `http://localhost:5173/#/` to host, open the printed
`#/display?id=...` link on a second screen, and join from phones on the same
network (or deploy and use the public URL).

## Deploy (free hosting)

```bash
npm i -g firebase-tools   # if needed
firebase login
firebase deploy           # hosting + database rules
```

## Tests

```bash
npm install
npm test                  # vitest — covers the assignment/branching engine
```

`tests/assign.test.js` verifies: no within-chain author repeats over a full
game, doubling when a player leaves with no branch to collapse, balanced load,
and that pass counts stay even (chains end on a word).

## Manual end-to-end check

1. Host a game (`#/`), open the display link, join from 3+ tabs/phones.
2. Start; write seed words; **Pass to next**; draw; pass; … finish.
3. Mid-game, open a new tab and join → next pass spawns an alternate branch.
4. Close a player tab → next pass collapses a branch (or assigns a double).
5. At review, tap chains to highlight → they reveal on every device + display.
