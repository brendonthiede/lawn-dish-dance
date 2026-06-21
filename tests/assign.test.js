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
    const passes = effectivePasses(players.length, null); // n-1 passes (5 for 6 players)
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
  it("effectivePasses is always >= 2 and equals n-1 for n >= 3", () => {
    expect(effectivePasses(2, null)).toBe(2); // min 2
    expect(effectivePasses(3, null)).toBe(2); // 3-1=2
    expect(effectivePasses(4, null)).toBe(3); // 4-1=3 (was 2 before parity fix)
    expect(effectivePasses(5, null)).toBe(4); // 5-1=4
    expect(effectivePasses(6, null)).toBe(5); // 6-1=5 (was 4 before parity fix)
    expect(effectivePasses(7, null)).toBe(6);
    expect(effectivePasses(4, 3)).toBe(3);    // override: max(2,3)=3
    expect(effectivePasses(4, 8)).toBe(8);    // override: max(2,8)=8
  });

  it("startOffset is 1 for odd passes (even player counts), 0 for even passes", () => {
    expect(startOffset(2)).toBe(0); // n=2: passes=2 (even) → word-first
    expect(startOffset(3)).toBe(1); // n=4: passes=3 (odd) → image-first
    expect(startOffset(4)).toBe(0); // n=5: passes=4 (even) → word-first
    expect(startOffset(5)).toBe(1); // n=6: passes=5 (odd) → image-first
    expect(startOffset(6)).toBe(0);
    expect(startOffset(7)).toBe(1);
    expect(startOffset(8)).toBe(0);
  });

  it("segmentType without offset alternates word/image starting with word", () => {
    expect(segmentType(0)).toBe("word");
    expect(segmentType(1)).toBe("image");
    expect(segmentType(2)).toBe("word");
    expect(segmentType(3)).toBe("image");
    expect(segmentType(4)).toBe("word");
  });

  it("segmentType with offset=1 starts with image (draw-first for even players)", () => {
    expect(segmentType(0, 1)).toBe("image");
    expect(segmentType(1, 1)).toBe("word");
    expect(segmentType(2, 1)).toBe("image");
    expect(segmentType(3, 1)).toBe("word");
  });

  it("final pass is always a word/guess for player counts 2–10", () => {
    for (let n = 2; n <= 10; n++) {
      const passes = effectivePasses(n, null);
      const offset = startOffset(passes);
      const finalType = segmentType(passes, offset);
      expect(finalType).toBe("word",
        `n=${n}: passes=${passes}, offset=${offset} → expected "word" but got "${finalType}"`);
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

  it("falls back to 60s when settings are empty", () => {
    expect(getPhaseDuration("image", {})).toBe(60);
    expect(getPhaseDuration("word", {})).toBe(60);
    expect(getPhaseDuration("word")).toBe(60);
  });
});
