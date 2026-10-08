import { describe, it, expect } from "vitest";
import { assignItems } from "../js/assign.js";
import { effectivePasses, startOffset, segmentType, getPhaseDuration } from "../js/util.js";

// deterministic RNG so tests are stable
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("assignItems", () => {
  it("gives each player a distinct, non-authored chain when counts match", () => {
    const rng = mulberry32(1);
    const players = ["a", "b", "c", "d", "e"];
    const items = players.map((p, i) => ({ chainId: "c" + i, authors: [p] }));
    const { byChain, repeats, doubles } = assignItems(items, players, rng);
    expect(Object.keys(byChain).length).toBe(items.length);
    expect(repeats).toEqual([]);
    expect(doubles).toEqual([]);
    // nobody gets their own chain
    items.forEach((it) => expect(byChain[it.chainId]).not.toBe(it.authors[0]));
    // each player used exactly once
    expect(new Set(Object.values(byChain)).size).toBe(players.length);
  });

  it("never repeats an author across a full game when players >= chains", () => {
    const rng = mulberry32(42);
    const players = ["a", "b", "c", "d", "e", "f"];
    const chains = players.map((p, i) => ({ chainId: "c" + i, authors: new Set([p]) }));
    const passes = effectivePasses(players.length, null); // 5 passes for 6 players
    for (let r = 1; r <= passes; r++) {
      const items = chains.map((c) => ({ chainId: c.chainId, authors: [...c.authors] }));
      const { byChain, repeats } = assignItems(items, players, rng);
      expect(repeats).toEqual([]);
      chains.forEach((c) => c.authors.add(byChain[c.chainId]));
    }
    // With n=6 players and passes=5, every chain has 6 distinct authors (one per player).
    // Each author set started with 1 (seed player) and gained 1 per pass = 6 total.
    chains.forEach((c) => expect(c.authors.size).toBe(passes + 1));
  });

  it("assigns every chain and forces doubles when chains > players (leave w/o branch)", () => {
    const rng = mulberry32(7);
    const players = ["a", "b", "c"];
    const items = [
      { chainId: "c0", authors: ["a"] },
      { chainId: "c1", authors: ["b"] },
      { chainId: "c2", authors: ["c"] },
      { chainId: "c3", authors: ["a"] },
    ];
    const { byChain, byPlayer, doubles } = assignItems(items, players, rng);
    expect(Object.keys(byChain).length).toBe(4); // all chains worked
    expect(doubles.length).toBe(1); // exactly one player plays twice
    // load balanced: max 2 per player
    Object.values(byPlayer).forEach((arr) => expect(arr.length).toBeLessThanOrEqual(2));
  });

  it("handles fewer chains than players (every chain to a distinct eligible player)", () => {
    const rng = mulberry32(3);
    const players = ["a", "b", "c", "d"];
    const items = [{ chainId: "c0", authors: ["a"] }, { chainId: "c1", authors: ["b"] }];
    const { byChain, repeats } = assignItems(items, players, rng);
    expect(Object.keys(byChain).length).toBe(2);
    expect(repeats).toEqual([]);
    expect(new Set(Object.values(byChain)).size).toBe(2);
  });

  it("empty inputs are safe", () => {
    expect(assignItems([], ["a"]).byChain).toEqual({});
    expect(assignItems([{ chainId: "x", authors: [] }], []).byChain).toEqual({});
  });
});

describe("util", () => {
  it("effectivePasses: n-1 for 2/4/6 players, else n-1 rounded down to even", () => {
    const expected = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 6, 9: 8, 10: 8 };
    for (const [n, passes] of Object.entries(expected)) expect(effectivePasses(Number(n), null)).toBe(passes);
    expect(effectivePasses(5, 3)).toBe(3); // override used as typed
    expect(effectivePasses(4, 8)).toBe(8);
    expect(effectivePasses(4, 1)).toBe(1);
    expect(effectivePasses(4, 0)).toBe(1); // min 1
  });

  it("startOffset is 1 for odd passes, 0 for even passes", () => {
    expect(startOffset(1)).toBe(1);
    expect(startOffset(2)).toBe(0);
    expect(startOffset(3)).toBe(1);
    expect(startOffset(4)).toBe(0);
  });

  it("segmentType without offset alternates word/image starting with word", () => {
    expect(segmentType(0)).toBe("word");
    expect(segmentType(1)).toBe("image");
    expect(segmentType(2)).toBe("word");
    expect(segmentType(3)).toBe("image");
    expect(segmentType(4)).toBe("word");
  });

  it("segmentType with offset=1 opens with write + draw, then guesses", () => {
    expect(segmentType(0, 1)).toBe("combo");
    expect(segmentType(1, 1)).toBe("word");
    expect(segmentType(2, 1)).toBe("image");
    expect(segmentType(3, 1)).toBe("word");
  });

  it("every game starts with a word and ends on a word; combo only for 2/4/6 players", () => {
    const cases = [];
    for (let n = 2; n <= 10; n++) cases.push([n, null]);
    cases.push([5, 3], [5, 1], [8, 7], [3, 4]);
    for (const [n, override] of cases) {
      const passes = effectivePasses(n, override);
      const offset = startOffset(passes);
      const label = `n=${n} override=${override} passes=${passes}`;
      expect(["word", "combo"], label).toContain(segmentType(0, offset));
      expect(segmentType(passes, offset), label).toBe("word");
      for (let r = 1; r < passes; r++) {
        expect(segmentType(r, offset), label).not.toBe(segmentType(r + 1, offset));
      }
      if (override == null) expect(segmentType(0, offset) === "combo", label).toBe([2, 4, 6].includes(n));
    }
  });
});

describe("getPhaseDuration", () => {
  it("returns drawTimerSec for image phases", () => {
    expect(getPhaseDuration("image", { drawTimerSec: 45, wordTimerSec: 30 })).toBe(45);
  });

  it("returns wordTimerSec for word phases", () => {
    expect(getPhaseDuration("word", { drawTimerSec: 45, wordTimerSec: 30 })).toBe(30);
  });

  it("falls back to timerDurationSec when phase-specific timer is absent", () => {
    expect(getPhaseDuration("image", { timerDurationSec: 60 })).toBe(60);
    expect(getPhaseDuration("word", { timerDurationSec: 60 })).toBe(60);
  });

  it("gives the combo opener both timers", () => {
    expect(getPhaseDuration("combo", { drawTimerSec: 45, wordTimerSec: 30 })).toBe(75);
  });

  it("falls back to 60s when settings are empty", () => {
    expect(getPhaseDuration("image", {})).toBe(60);
    expect(getPhaseDuration("word", {})).toBe(60);
    expect(getPhaseDuration("word")).toBe(60);
  });
});
