// Per-round assignment ("the pass"): decide which active player works which
// in-flight chain next. Pure functions, no Firebase — unit-tested in tests/.
//
// Priority order:
//   1. Every in-flight item is assigned to exactly one player (nothing idle).
//   2. No player works a chain they already authored (avoid within-chain repeats).
//   3. Load is balanced (no player does more than ceil(items/players)).
// When items > players, some players necessarily get 2+ items ("play twice").
// When a no-repeat assignment is impossible we relax and minimise repeats.

/** Fisher–Yates copy using an injectable RNG (for deterministic tests). */
function shuffled(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function doublesOf(byPlayer) {
  return Object.keys(byPlayer).filter((p) => byPlayer[p].length > 1);
}

/**
 * @param {{chainId:string, authors:string[]}[]} items in-flight chains + who has authored each
 * @param {string[]} players active player uids
 * @param {() => number} [rand] RNG in [0,1) — defaults to Math.random
 * @returns {{ byChain: Record<string,string>,
 *             byPlayer: Record<string,string[]>,
 *             repeats: string[], doubles: string[] }}
 */
export function assignItems(items, players, rand = Math.random) {
  const byChain = {};
  const byPlayer = {};
  players.forEach((p) => (byPlayer[p] = []));
  const repeats = [];
  if (players.length === 0 || items.length === 0) {
    return { byChain, byPlayer, repeats, doubles: [] };
  }

  const cap = Math.max(1, Math.ceil(items.length / players.length));

  // item index -> eligible player indices (players who have NOT authored it)
  const eligible = items.map((it) => {
    const authored = new Set(it.authors || []);
    return players.map((p, i) => (authored.has(p) ? -1 : i)).filter((i) => i >= 0);
  });

  // Phase A: try a capacity-1 perfect no-repeat matching (Kuhn's algorithm).
  // Only attempted when there are at least as many players as items.
  if (items.length <= players.length) {
    const matchPlayer = new Array(players.length).fill(-1); // playerIdx -> itemIdx
    const order = [...items.keys()].sort((a, b) => eligible[a].length - eligible[b].length);
    const augment = (itemIdx, seen) => {
      for (const pj of shuffled(eligible[itemIdx], rand)) {
        if (seen[pj]) continue;
        seen[pj] = true;
        if (matchPlayer[pj] === -1 || augment(matchPlayer[pj], seen)) {
          matchPlayer[pj] = itemIdx;
          return true;
        }
      }
      return false;
    };
    let ok = true;
    for (const itemIdx of order) {
      if (!augment(itemIdx, new Array(players.length).fill(false))) {
        ok = false;
        break;
      }
    }
    if (ok) {
      matchPlayer.forEach((itemIdx, pj) => {
        if (itemIdx >= 0) {
          const chainId = items[itemIdx].chainId;
          byChain[chainId] = players[pj];
          byPlayer[players[pj]].push(chainId);
        }
      });
      return { byChain, byPlayer, repeats, doubles: doublesOf(byPlayer) };
    }
    players.forEach((p) => (byPlayer[p] = [])); // reset before greedy
  }

  // Phase B: greedy with capacity + doubling, most-constrained item first.
  const load = {};
  players.forEach((p) => (load[p] = 0));
  const itemOrder = [...items.keys()].sort((a, b) => eligible[a].length - eligible[b].length);
  for (const itemIdx of itemOrder) {
    const chainId = items[itemIdx].chainId;
    const authored = new Set(items[itemIdx].authors || []);

    let pool = players.filter((p) => !authored.has(p) && load[p] < cap);
    if (pool.length === 0) pool = players.filter((p) => load[p] < cap); // allow repeat, keep cap
    if (pool.length === 0) pool = players.slice(); // everyone at cap (rare): bump

    const minLoad = Math.min(...pool.map((p) => load[p]));
    const tied = pool.filter((p) => load[p] === minLoad);
    const nonAuthorTied = tied.filter((p) => !authored.has(p));
    const choices = nonAuthorTied.length ? nonAuthorTied : tied;
    const chosen = choices[Math.floor(rand() * choices.length)];

    if (authored.has(chosen)) repeats.push(chainId);
    byChain[chainId] = chosen;
    byPlayer[chosen].push(chainId);
    load[chosen]++;
  }
  return { byChain, byPlayer, repeats, doubles: doublesOf(byPlayer) };
}
