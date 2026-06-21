// GM-authoritative game operations. The free Firebase plan has no server
// compute, so the GM's browser runs all of this and writes results to the DB;
// players + the shared display are pure subscribers.
import {
  db, ref, get, set, update, onValue, onDisconnect, serverTimestamp, ensureAuth,
} from "./firebase.js";
import { makeCode, makeId, segmentType, startOffset, effectivePasses, getPhaseDuration } from "./util.js";
import { assignItems } from "./assign.js";
import { serverNow } from "./timer.js";

const G = (id) => `games/${id}`;
const snap = async (path) => (await get(ref(db, path))).val();

// --- presence -------------------------------------------------------------

// Standard Firebase presence: re-arm onDisconnect and re-assert "connected"
// every time the socket (re)connects, so a network blip self-heals instead of
// leaving a player stuck as disconnected.
const _presenceArmed = new Set();
function registerPresence(gameId, uid) {
  const key = `${gameId}/${uid}`;
  if (_presenceArmed.has(key)) return;
  _presenceArmed.add(key);
  const pres = ref(db, `${G(gameId)}/presence/${uid}`);
  const conn = ref(db, `${G(gameId)}/players/${uid}/connected`);
  onValue(ref(db, ".info/connected"), (snap) => {
    if (snap.val() !== true) return;
    onDisconnect(pres).remove();
    onDisconnect(conn).set(false);
    set(pres, true).catch(() => {});
    set(conn, true).catch(() => {});
  });
}

// --- lobby ----------------------------------------------------------------

/** Create a game and return { gameId, code, uid }. Caller becomes the GM. */
export async function createGame({
  gmName, gmPlays,
  /**
   * @deprecated Use drawTimerSec and wordTimerSec instead.
   * Kept for backward compatibility; used as a fallback by getPhaseDuration.
   */
  timerDurationSec = 60,
  drawTimerSec = 45, wordTimerSec = 30,
  passesOverride = null, useWordBank = false, wordList = null, crowdWords = false,
}) {
  const uid = await ensureAuth();
  const gameId = makeId(16);
  let code = makeCode(4);
  for (let i = 0; i < 6 && (await snap(`codes/${code}`)); i++) code = makeCode(4);

  await update(ref(db), {
    [`codes/${code}`]: gameId,
    [`${G(gameId)}/meta`]: {
      code, createdBy: uid, status: "lobby", gmPlays: !!gmPlays, createdAt: serverTimestamp(),
    },
    [`${G(gameId)}/settings`]: {
      passesOverride: passesOverride ?? null,
      timerDurationSec,
      drawTimerSec,
      wordTimerSec,
      useWordBank: !!useWordBank,
      wordList: wordList && wordList.length ? wordList : null,
      crowdWords: !!crowdWords,
    },
    [`${G(gameId)}/round`]: { index: -1, type: "word", state: "lobby", startOffset: 0 },
    [`${G(gameId)}/players/${uid}`]: {
      name: gmName || "Host", joinedAt: serverTimestamp(), connected: true, isGM: true,
    },
  });
  await registerPresence(gameId, uid);
  return { gameId, code, uid };
}

/** Join an existing game by code. Returns { gameId, uid, status }. */
export async function joinGame(code, name) {
  const uid = await ensureAuth();
  const gameId = await snap(`codes/${(code || "").toUpperCase()}`);
  if (!gameId) throw new Error("No game found for that code");
  const existing = await snap(`${G(gameId)}/players/${uid}`);
  await update(ref(db, `${G(gameId)}/players/${uid}`), {
    name: name || existing?.name || "Player",
    joinedAt: existing?.joinedAt || serverTimestamp(),
    connected: true,
    isGM: existing?.isGM || false,
  });
  await registerPresence(gameId, uid);
  const status = await snap(`${G(gameId)}/meta/status`);
  return { gameId, uid, status };
}

/** Re-establish presence after a page reload (player or GM). */
export async function reconnect(gameId) {
  const uid = await ensureAuth();
  const exists = await snap(`${G(gameId)}/players/${uid}`);
  if (exists) await registerPresence(gameId, uid);
  return uid;
}

/**
 * Ensure the current device has a player record (re-adding it if it was pruned,
 * e.g. after a "play again" reset). Used by the player view to auto-roll an open
 * tab into a recycled lobby without rejoining.
 */
export async function ensurePlayer(gameId, name) {
  const uid = await ensureAuth();
  const existing = await snap(`${G(gameId)}/players/${uid}`);
  if (!existing) {
    await set(ref(db, `${G(gameId)}/players/${uid}`), {
      name: name || "Player", joinedAt: serverTimestamp(), connected: true, isGM: false,
    });
  }
  registerPresence(gameId, uid);
  return uid;
}

/** GM-only: update lobby settings before the game starts. */
export async function updateSettings(gameId, { gmPlays, timerDurationSec, drawTimerSec, wordTimerSec, passesOverride, useWordBank, wordList, crowdWords }) {
  const updates = {};
  if (gmPlays !== undefined) updates["meta/gmPlays"] = !!gmPlays;
  if (timerDurationSec !== undefined) updates["settings/timerDurationSec"] = timerDurationSec;
  if (drawTimerSec !== undefined) updates["settings/drawTimerSec"] = drawTimerSec;
  if (wordTimerSec !== undefined) updates["settings/wordTimerSec"] = wordTimerSec;
  if (passesOverride !== undefined) updates["settings/passesOverride"] = passesOverride ?? null;
  if (useWordBank !== undefined) updates["settings/useWordBank"] = !!useWordBank;
  if (wordList !== undefined) updates["settings/wordList"] = wordList && wordList.length ? wordList : null;
  if (crowdWords !== undefined) updates["settings/crowdWords"] = !!crowdWords;
  await update(ref(db, G(gameId)), updates);
}

/** A player contributes their list of words to the shared crowd-sourced bank. */
export async function setMyWords(gameId, words) {
  const uid = await ensureAuth();
  const clean = (words || []).map((w) => String(w).trim()).filter(Boolean).slice(0, 5);
  await set(ref(db, `${G(gameId)}/wordpool/${uid}`), clean.length ? clean : null);
}

// --- the player pool ------------------------------------------------------

function poolMembers(game) {
  const players = game.players || {};
  return Object.keys(players).filter((p) => {
    const pl = players[p];
    if (!pl) return false;
    return pl.isGM ? !!game.meta.gmPlays : true;
  });
}

function activeMembers(game) {
  return poolMembers(game).filter((p) => (game.players[p].connected !== false));
}

// --- start ----------------------------------------------------------------

/** GM-only: leave the lobby and start round 0 (everyone writes a seed word or draws). */
export async function startGame(gameId) {
  const game = await snap(G(gameId));
  const pool = poolMembers(game).filter((p) => game.players[p].connected !== false);
  if (pool.length < 2) throw new Error("Need at least 2 connected players to start");

  const passes = effectivePasses(pool.length, game.settings.passesOverride);
  const offset = startOffset(passes);
  const firstType = segmentType(0, offset);
  const updates = {};
  const assignments0 = {};
  pool.forEach((p) => {
    const cid = makeId(10);
    updates[`chains/${cid}`] = { seedWord: "", seedPlayer: p, status: "active", branchOf: null };
    assignments0[cid] = p;
  });
  updates["assignments/0"] = assignments0;
  updates["round"] = { index: 0, type: firstType, state: "active", startOffset: offset };
  updates["meta/status"] = "playing";
  updates["meta/totalPasses"] = passes;
  updates["meta/startOffset"] = offset;
  updates["drafts"] = null;
  updates["submitted"] = null;
  updates["timer"] = startedTimer(getPhaseDuration(firstType, game.settings));
  await update(ref(db, G(gameId)), updates);
  return { passes };
}

// --- timer ----------------------------------------------------------------

function startedTimer(durationSec) {
  const dur = durationSec || 60;
  return { state: "running", durationSec: dur, endsAt: serverNow() + dur * 1000, remainingMs: null };
}

export async function pauseTimer(gameId) {
  const t = await snap(`${G(gameId)}/timer`);
  if (!t || t.state !== "running") return;
  const rem = Math.max(0, (t.endsAt || 0) - serverNow());
  await update(ref(db, `${G(gameId)}/timer`), { state: "paused", remainingMs: rem, endsAt: null });
}

export async function resumeTimer(gameId) {
  const t = await snap(`${G(gameId)}/timer`);
  if (!t || t.state !== "paused") return;
  await update(ref(db, `${G(gameId)}/timer`), {
    state: "running", endsAt: serverNow() + (t.remainingMs || 0), remainingMs: null,
  });
}

export async function addTime(gameId, seconds) {
  const t = await snap(`${G(gameId)}/timer`);
  if (!t) return;
  if (t.state === "running") {
    await update(ref(db, `${G(gameId)}/timer`), { endsAt: (t.endsAt || serverNow()) + seconds * 1000 });
  } else {
    await update(ref(db, `${G(gameId)}/timer`), { remainingMs: Math.max(0, (t.remainingMs || 0) + seconds * 1000) });
  }
}

export async function restartTimer(gameId) {
  const [settings, round] = await Promise.all([
    snap(`${G(gameId)}/settings`),
    snap(`${G(gameId)}/round`),
  ]);
  const dur = getPhaseDuration(round?.type || "word", settings || {});
  await update(ref(db, `${G(gameId)}/timer`), startedTimer(dur));
}

// --- player drafts --------------------------------------------------------

/** A player writes their working buffer for the chain they're assigned. */
export async function saveDraft(gameId, round, chainId, payload) {
  await set(ref(db, `${G(gameId)}/drafts/${round}/${chainId}`), payload);
}

/**
 * A player explicitly submits their work for the current chain/round.
 * Saves the draft and marks the chain as submitted for this round.
 * The host (game.js advance) clears submitted on every phase transition.
 */
export async function submitChain(gameId, round, chainId, payload) {
  const updates = {};
  if (payload) updates[`drafts/${round}/${chainId}`] = payload;
  updates[`submitted/${round}/${chainId}`] = true;
  await update(ref(db, G(gameId)), updates);
}

// --- advance (the pass) ---------------------------------------------------

/**
 * GM-only: capture every player's current work into the chain, then either
 * finish (if we just captured the final word) or rebalance the in-flight chains
 * against the active player set and assign the next round.
 */
export async function advance(gameId) {
  const game = await snap(G(gameId));
  const r = game.round.index;
  const offset = game.meta?.startOffset ?? 0;
  const updates = {};
  const assignR = game.assignments?.[r] || {}; // chainId -> uid
  const draftsR = game.drafts?.[r] || {}; // chainId -> { word | drawing }
  const chains = JSON.parse(JSON.stringify(game.chains || {}));

  // 1. capture current drafts as segments
  Object.keys(assignR).forEach((cid) => {
    const uid = assignR[cid];
    const d = draftsR[cid] || {};
    const seg = { type: segmentType(r, offset), playerId: uid, submittedAt: serverTimestamp() };
    if (segmentType(r, offset) === "word") seg.word = String(d.word || "").slice(0, 80);
    else seg.drawing = d.drawing || { w: 1, h: 1, strokes: [] };
    updates[`chains/${cid}/segments/${r}`] = seg;
    chains[cid] = chains[cid] || {};
    chains[cid].segments = chains[cid].segments || {};
    chains[cid].segments[r] = seg;
    if (r === 0) {
      const w = String(d.word || "").slice(0, 80);
      updates[`chains/${cid}/seedWord`] = w;
      chains[cid].seedWord = w;
    }
  });

  // 2. final round? then finish into review
  if (r >= game.meta.totalPasses) {
    Object.keys(chains).forEach((cid) => {
      if (chains[cid].status === "active") updates[`chains/${cid}/status`] = "complete";
    });
    updates["round/state"] = "review";
    updates["meta/status"] = "review";
    updates["timer"] = { state: "paused", remainingMs: 0, durationSec: game.settings.timerDurationSec, endsAt: null };
    updates["submitted"] = null;
    await update(ref(db, G(gameId)), updates);
    return { finished: true };
  }

  // 3. rebalance in-flight chains against active players (the invariant)
  const active = activeMembers(game);
  let activeChainIds = Object.keys(chains).filter((c) => chains[c].status === "active");
  const rootOf = (cid) => chains[cid].branchOf || cid;
  const authorsOf = (cid) => [...new Set(Object.values(chains[cid].segments || {}).map((s) => s.playerId))];

  let diff = active.length - activeChainIds.length;
  if (diff > 0) {
    // joins: spawn alternate branches off the least-branched active chains
    for (let k = 0; k < diff; k++) {
      const branchCount = {};
      activeChainIds.forEach((c) => { branchCount[rootOf(c)] = (branchCount[rootOf(c)] || 0) + 1; });
      const src = activeChainIds.slice().sort((a, b) => branchCount[rootOf(a)] - branchCount[rootOf(b)])[0];
      const newCid = makeId(10);
      const segs = {};
      for (let i = 0; i <= r; i++) if (chains[src].segments?.[i]) segs[i] = chains[src].segments[i];
      const newChain = {
        seedWord: chains[src].seedWord || "",
        seedPlayer: chains[src].seedPlayer,
        status: "active",
        branchOf: rootOf(src),
        segments: segs,
      };
      chains[newCid] = newChain;
      updates[`chains/${newCid}`] = newChain;
      activeChainIds.push(newCid);
    }
  } else if (diff < 0) {
    // leaves: collapse alternate branches; any remaining excess => "play twice"
    let toRemove = -diff;
    for (const c of activeChainIds.filter((c) => chains[c].branchOf)) {
      if (toRemove <= 0) break;
      updates[`chains/${c}/status`] = "collapsed";
      activeChainIds = activeChainIds.filter((x) => x !== c);
      toRemove--;
    }
  }

  // 4. assign the next round
  const items = activeChainIds.map((cid) => ({ chainId: cid, authors: authorsOf(cid) }));
  const { byChain } = assignItems(items, active);
  const nextType = segmentType(r + 1, offset);
  updates[`assignments/${r + 1}`] = byChain;
  updates["round"] = { index: r + 1, type: nextType, state: "active", startOffset: offset };
  updates["drafts"] = null;
  updates["submitted"] = null;
  updates["timer"] = startedTimer(getPhaseDuration(nextType, game.settings));
  await update(ref(db, G(gameId)), updates);
  return { finished: false, round: r + 1 };
}

// --- review ---------------------------------------------------------------

export async function toggleHighlight(gameId, chainId, on) {
  await set(ref(db, `${G(gameId)}/highlights/${chainId}`), on ? true : null);
}

export async function endGame(gameId) {
  await update(ref(db, G(gameId)), { "round/state": "finished", "meta/status": "finished" });
}

/**
 * GM-only: recycle the room for another game. Clears the previous game's chains,
 * segments, assignments, drafts, highlights and timer, prunes players who have
 * left (no live presence), and returns to the lobby keeping everyone still here.
 * Settings (word bank, passes, etc.) are preserved so the GM can tweak them in
 * the lobby before starting the next game.
 */
export async function playAgain(gameId) {
  const game = await snap(G(gameId));
  const presence = game.presence || {};
  const players = game.players || {};
  const updates = {
    chains: null, assignments: null, drafts: null, highlights: null, timer: null,
    wordpool: null, submitted: null,
    "meta/totalPasses": null,
    "meta/startOffset": null,
    "meta/status": "lobby",
    round: { index: -1, type: "word", state: "lobby", startOffset: 0 },
  };
  Object.keys(players).forEach((uid) => {
    const here = uid === game.meta.createdBy || presence[uid] === true || players[uid].connected === true;
    if (!here) updates[`players/${uid}`] = null;
  });
  await update(ref(db, G(gameId)), updates);
}
