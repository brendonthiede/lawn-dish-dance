import { describe, it, expect } from "vitest";
import { assignItems } from "../js/assign.js";
import { effectivePasses, segmentType } from "../js/util.js";

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
    const passes = effectivePasses(players.length, null); // even, <= players-1
    for (let r = 1; r <= passes; r++) {
      const items = chains.map((c) => ({ chainId: c.chainId, authors: [...c.authors] }));
      const { byChain, repeats } = assignItems(items, players, rng);
      expect(repeats).toEqual([]);
      chains.forEach((c) => c.authors.add(byChain[c.chainId]));
    }
    // every chain has distinct authors
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
  it("effectivePasses is always even and >= 2", () => {
    expect(effectivePasses(2, null)).toBe(2); // players-1=1 -> 2
    expect(effectivePasses(5, null)).toBe(4); // 4
    expect(effectivePasses(6, null)).toBe(4); // 5 -> round down to 4
    expect(effectivePasses(7, null)).toBe(6);
    expect(effectivePasses(4, 3)).toBe(2); // override 3 -> 2
    expect(effectivePasses(4, 8)).toBe(8);
  });

  it("segmentType alternates word/image starting with word", () => {
    expect(segmentType(0)).toBe("word");
    expect(segmentType(1)).toBe("image");
    expect(segmentType(2)).toBe("word");
    expect(segmentType(4)).toBe("word"); // chains end on a word
  });
});
