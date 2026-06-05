// Headless end-to-end test against the LIVE Firebase project.
// Spins up several anonymous clients (real auth), plays a full game through the
// real Realtime Database (real security rules), asserts the data model, checks
// a late-join branch + a rules rejection, then cleans up.
//
//   node tests/e2e.mjs
//
// Mirrors the operations in js/game.js and reuses the real js/assign.js logic.
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getDatabase, ref, get, set, update, remove } from "firebase/database";
import { firebaseConfig } from "../js/firebase-config.js";
import { assignItems } from "../js/assign.js";
import { makeCode, makeId, segmentType, effectivePasses } from "../js/util.js";

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✓ ${msg}`); } else { fail++; console.error(`  ✗ ${msg}`); } };
const G = (id) => `games/${id}`;
const snap = async (db, path) => (await get(ref(db, path))).val();

let clientSeq = 0;
async function makeClient(label) {
  const app = initializeApp(firebaseConfig, `${label}-${clientSeq++}`);
  const auth = getAuth(app);
  const db = getDatabase(app);
  const cred = await signInAnonymously(auth);
  return { app, db, uid: cred.user.uid, label };
}

// --- ported game ops (faithful to js/game.js) ---
async function createGame(c, { gmPlays = false } = {}) {
  const gameId = makeId(16);
  let code = makeCode(4);
  await update(ref(c.db), {
    [`codes/${code}`]: gameId,
    [`${G(gameId)}/meta`]: { code, createdBy: c.uid, status: "lobby", gmPlays, createdAt: Date.now() },
    [`${G(gameId)}/settings`]: { passesOverride: null, timerDurationSec: 60, useWordBank: false, wordList: null },
    [`${G(gameId)}/round`]: { index: -1, type: "word", state: "lobby" },
    [`${G(gameId)}/players/${c.uid}`]: { name: c.label, joinedAt: Date.now(), connected: true, isGM: true },
    [`${G(gameId)}/presence/${c.uid}`]: true,
  });
  return { gameId, code };
}

async function joinGame(c, gameId) {
  await update(ref(c.db, `${G(gameId)}/players/${c.uid}`), {
    name: c.label, joinedAt: Date.now(), connected: true, isGM: false,
  });
  await set(ref(c.db, `${G(gameId)}/presence/${c.uid}`), true);
}

// Simulate a client leaving (what onDisconnect does server-side).
async function leaveGame(c, gameId) {
  await remove(ref(c.db, `${G(gameId)}/presence/${c.uid}`));
  await set(ref(c.db, `${G(gameId)}/players/${c.uid}/connected`), false);
}

async function playAgain(host, gameId) {
  const game = await snap(host.db, G(gameId));
  const presence = game.presence || {};
  const players = game.players || {};
  const updates = {
    chains: null, assignments: null, drafts: null, highlights: null, timer: null,
    wordpool: null, "meta/totalPasses": null, "meta/status": "lobby",
    round: { index: -1, type: "word", state: "lobby" },
  };
  Object.keys(players).forEach((uid) => {
    const here = uid === game.meta.createdBy || presence[uid] === true || players[uid].connected === true;
    if (!here) updates[`players/${uid}`] = null;
  });
  await update(ref(host.db, G(gameId)), updates);
}

async function startGame(host, gameId) {
  const game = await snap(host.db, G(gameId));
  const pool = Object.keys(game.players).filter((p) => (game.players[p].isGM ? game.meta.gmPlays : true));
  const passes = effectivePasses(pool.length, game.settings.passesOverride);
  const updates = {}; const a0 = {};
  pool.forEach((p) => { const cid = makeId(10); updates[`chains/${cid}`] = { seedWord: "", seedPlayer: p, status: "active", branchOf: null }; a0[cid] = p; });
  updates["assignments/0"] = a0;
  updates["round"] = { index: 0, type: "word", state: "active" };
  updates["meta/status"] = "playing";
  updates["meta/totalPasses"] = passes;
  await update(ref(host.db, G(gameId)), updates);
  return passes;
}

async function saveDraft(c, gameId, round, chainId, payload) {
  await set(ref(c.db, `${G(gameId)}/drafts/${round}/${chainId}`), payload);
}

async function advance(host, gameId) {
  const game = await snap(host.db, G(gameId));
  const r = game.round.index;
  const updates = {};
  const assignR = game.assignments?.[r] || {};
  const draftsR = game.drafts?.[r] || {};
  const chains = JSON.parse(JSON.stringify(game.chains || {}));

  Object.keys(assignR).forEach((cid) => {
    const uid = assignR[cid]; const d = draftsR[cid] || {};
    const seg = { type: segmentType(r), playerId: uid, submittedAt: Date.now() };
    if (segmentType(r) === "word") seg.word = String(d.word || "").slice(0, 80);
    else seg.drawing = d.drawing || { w: 1, h: 1, strokes: [] };
    updates[`chains/${cid}/segments/${r}`] = seg;
    chains[cid].segments = chains[cid].segments || {}; chains[cid].segments[r] = seg;
    if (r === 0) { updates[`chains/${cid}/seedWord`] = seg.word; chains[cid].seedWord = seg.word; }
  });

  if (r >= game.meta.totalPasses) {
    Object.keys(chains).forEach((cid) => { if (chains[cid].status === "active") updates[`chains/${cid}/status`] = "complete"; });
    updates["round/state"] = "review"; updates["meta/status"] = "review";
    await update(ref(host.db, G(gameId)), updates);
    return { finished: true };
  }

  const players = game.players || {};
  const active = Object.keys(players).filter((p) => { const pl = players[p]; if (!pl) return false; if (pl.isGM && !game.meta.gmPlays) return false; return pl.connected !== false; });
  let activeChainIds = Object.keys(chains).filter((c) => chains[c].status === "active");
  const rootOf = (cid) => chains[cid].branchOf || cid;
  const authorsOf = (cid) => [...new Set(Object.values(chains[cid].segments || {}).map((s) => s.playerId))];

  let diff = active.length - activeChainIds.length;
  if (diff > 0) {
    for (let k = 0; k < diff; k++) {
      const bc = {}; activeChainIds.forEach((c) => { bc[rootOf(c)] = (bc[rootOf(c)] || 0) + 1; });
      const src = activeChainIds.slice().sort((a, b) => bc[rootOf(a)] - bc[rootOf(b)])[0];
      const newCid = makeId(10); const segs = {};
      for (let i = 0; i <= r; i++) if (chains[src].segments?.[i]) segs[i] = chains[src].segments[i];
      const nc = { seedWord: chains[src].seedWord || "", seedPlayer: chains[src].seedPlayer, status: "active", branchOf: rootOf(src), segments: segs };
      chains[newCid] = nc; updates[`chains/${newCid}`] = nc; activeChainIds.push(newCid);
    }
  } else if (diff < 0) {
    let toRemove = -diff;
    for (const c of activeChainIds.filter((c) => chains[c].branchOf)) { if (toRemove <= 0) break; updates[`chains/${c}/status`] = "collapsed"; activeChainIds = activeChainIds.filter((x) => x !== c); toRemove--; }
  }

  const items = activeChainIds.map((cid) => ({ chainId: cid, authors: authorsOf(cid) }));
  const { byChain } = assignItems(items, active);
  updates[`assignments/${r + 1}`] = byChain;
  updates["round"] = { index: r + 1, type: segmentType(r + 1), state: "active" };
  await update(ref(host.db, G(gameId)), updates);
  return { finished: false, round: r + 1, assignments: byChain };
}

// Players fill their assigned chains for the current round.
async function everyoneSubmits(clients, gameId, round, label) {
  const assignR = await snap(clients[0].db, `${G(gameId)}/assignments/${round}`) || {};
  const byUid = {}; Object.entries(assignR).forEach(([cid, uid]) => { (byUid[uid] = byUid[uid] || []).push(cid); });
  for (const c of clients) {
    for (const cid of byUid[c.uid] || []) {
      const payload = segmentType(round) === "word"
        ? { word: `${label}-${c.label}` }
        : { drawing: { w: 400, h: 300, strokes: [{ color: "#111", width: 0.02, points: [[0.1, 0.1], [0.9, 0.9]] }] } };
      await saveDraft(c, gameId, round, cid, payload);
    }
  }
  return assignR;
}

function assertNoRepeats(label, assignByChain, chainsAuthors) {
  let repeats = 0;
  for (const [cid, uid] of Object.entries(assignByChain)) {
    if ((chainsAuthors[cid] || new Set()).has(uid)) repeats++;
  }
  ok(repeats === 0, `${label}: no player assigned a chain they already authored`);
}

async function main() {
  console.log("\n=== Lawn Dish Dance — live E2E ===\n");
  const created = [];
  let host;
  try {
    console.log("1. Anonymous auth (3 clients)");
    const A = host = await makeClient("Ann");
    const B = await makeClient("Bob");
    const C = await makeClient("Cy");
    ok(A.uid && B.uid && C.uid && new Set([A.uid, B.uid, C.uid]).size === 3, "three distinct anonymous uids (Anonymous auth is enabled)");

    console.log("2. Create + join");
    const { gameId, code } = await createGame(A, { gmPlays: true });
    created.push({ db: A.db, gameId, code });
    ok(!!(await snap(A.db, `codes/${code}`)), "join code resolves to the game");
    await joinGame(B, gameId);
    await joinGame(C, gameId);
    const players = await snap(A.db, `${G(gameId)}/players`);
    ok(Object.keys(players).length === 3, "lobby has 3 players");

    console.log("3. Security rules");
    let denied = false;
    try { await set(ref(B.db, `${G(gameId)}/players/${A.uid}/name`), "hacked"); } catch { denied = true; }
    ok(denied, "a player cannot overwrite another player's record");

    console.log("3b. Crowd-sourced words");
    await set(ref(B.db, `${G(gameId)}/wordpool/${B.uid}`), ["banana phone", "pirate"]);
    await set(ref(C.db, `${G(gameId)}/wordpool/${C.uid}`), ["volcano"]);
    ok((await snap(A.db, `${G(gameId)}/wordpool/${B.uid}`)).length === 2, "a player can contribute words, visible to others");
    let wpDenied = false;
    try { await set(ref(B.db, `${G(gameId)}/wordpool/${C.uid}`), ["hack"]); } catch { wpDenied = true; }
    ok(wpDenied, "a player cannot edit another player's contributed words");
    const pool = Object.values(await snap(A.db, `${G(gameId)}/wordpool`)).flat();
    ok(pool.length === 3 && pool.includes("banana phone") && pool.includes("volcano"), "all contributions merge into one pool");

    console.log("4. Start game");
    const passes = await startGame(A, gameId);
    ok(passes % 2 === 0 && passes >= 2, `pass count is even (ends on a word): ${passes}`);
    const chains0 = await snap(A.db, `${G(gameId)}/chains`);
    ok(Object.keys(chains0).length === 3, "one seed chain per player");

    // track authors per chain to verify no-repeat across the whole game
    const authors = {}; Object.keys(chains0).forEach((cid) => (authors[cid] = new Set()));

    console.log("5. Play all rounds");
    const clients = [A, B, C];
    for (let r = 0; r <= passes; r++) {
      const assignR = await everyoneSubmits(clients, gameId, r, `r${r}`);
      Object.entries(assignR).forEach(([cid, uid]) => authors[cid]?.add(uid));
      // a player cannot write a draft for a chain not assigned to them
      if (r === 0) {
        const someoneElsesChain = Object.keys(assignR).find((cid) => assignR[cid] !== B.uid);
        let draftDenied = false;
        try { await saveDraft(B, gameId, r, someoneElsesChain, { word: "sneaky" }); } catch { draftDenied = true; }
        ok(draftDenied, "a player cannot write a draft for a chain they aren't assigned");
      }
      const res = await advance(A, gameId);
      if (!res.finished) {
        Object.keys(res.assignments).forEach((cid) => { if (!authors[cid]) authors[cid] = new Set(); });
        assertNoRepeats(`round ${res.round}`, res.assignments, authors);
      }
    }

    console.log("6. Review state");
    const game = await snap(A.db, G(gameId));
    ok(game.meta.status === "review", "game reached review");
    const finished = Object.values(game.chains).filter((c) => c.status === "complete");
    ok(finished.length === 3, "all 3 chains completed");
    const sample = finished[0];
    const segIdx = Object.keys(sample.segments).map(Number).sort((a, b) => a - b);
    ok(segIdx.length === passes + 1, `each chain has ${passes + 1} segments (seed + ${passes} passes)`);
    ok(sample.segments[segIdx[segIdx.length - 1]].type === "word", "final segment is a word");
    ok(typeof sample.seedWord === "string" && sample.seedWord.length > 0, "seed word captured for review");

    console.log("7. Highlight broadcast");
    const hid = Object.keys(game.chains)[0];
    await set(ref(A.db, `${G(gameId)}/highlights/${hid}`), true);
    ok((await snap(B.db, `${G(gameId)}/highlights/${hid}`)) === true, "highlight set by GM is visible to a player");

    console.log("8. Play again (recycle the same room)");
    await leaveGame(C, gameId); // C bows out before the next game
    await playAgain(A, gameId);
    const recycled = await snap(A.db, G(gameId));
    ok(recycled.meta.status === "lobby", "recycled game is back in the lobby");
    ok(!recycled.chains && !recycled.assignments && !recycled.highlights && !recycled.drafts, "previous game data cleared");
    ok(!recycled.wordpool, "crowd-sourced words cleared for the new game");
    ok(recycled.round.index === -1 && !recycled.meta.totalPasses, "round + pass count reset");
    ok(!!recycled.players[A.uid] && !!recycled.players[B.uid], "continuing players kept (no rejoin)");
    ok(!recycled.players[C.uid], "departed player pruned");
    ok((await snap(A.db, `codes/${code}`)) === gameId, "join code still valid (same room)");
    await joinGame(C, gameId); // C changes their mind and rolls back into the lobby
    await startGame(A, gameId);
    const restarted = await snap(A.db, G(gameId));
    ok(restarted.meta.status === "playing" && Object.keys(restarted.chains).length === 3, "recycled room starts a fresh 3-player game");

    console.log("9. Late-join branch (fresh game)");
    const D = await makeClient("Dee");
    const { gameId: g2, code: code2 } = await createGame(A, { gmPlays: true });
    created.push({ db: A.db, gameId: g2, code: code2 });
    await joinGame(B, g2); await joinGame(C, g2);
    await startGame(A, g2);
    await everyoneSubmits([A, B, C], g2, 0, "seed");
    await advance(A, g2); // -> round 1, 3 chains
    const before = Object.keys((await snap(A.db, `${G(g2)}/chains`))).length;
    await joinGame(D, g2); // late joiner during round 1
    await everyoneSubmits([A, B, C], g2, 1, "img"); // existing players draw
    await advance(A, g2); // rebalance: should spawn a branch for the 4th player
    const after = await snap(A.db, `${G(g2)}/chains`);
    const branches = Object.values(after).filter((c) => c.branchOf);
    ok(Object.keys(after).length === before + 1, "late join spawned exactly one new chain");
    ok(branches.length === 1, "the new chain is an alternate branch of an existing word");
    const a2 = await snap(A.db, `${G(g2)}/assignments/2`);
    ok(Object.keys(a2).length === 4 && new Set(Object.values(a2)).size === 4, "round 2 assigns all 4 players, one chain each");
  } catch (e) {
    fail++; console.error("\n✗ UNCAUGHT:", e?.code || "", e?.message || e);
  } finally {
    console.log("\n9. Cleanup");
    for (const { db, gameId, code } of created) {
      try { await remove(ref(db, G(gameId))); await remove(ref(db, `codes/${code}`)); } catch (e) { console.error("  cleanup err:", e?.message); }
    }
    console.log("  removed test games");
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail ? 1 : 0);
}

main();
