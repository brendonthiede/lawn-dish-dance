// Small pure helpers shared across views and game logic.

// Unambiguous alphabet for join codes (no 0/O, 1/I/L).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Generate a short human-typable join code, e.g. "K7QP". */
export function makeCode(len = 4) {
  let s = "";
  for (let i = 0; i < len; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return s;
}

/** Random id for chains/segments when we don't use push() keys. */
export function makeId(len = 12) {
  const a = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let s = "";
  for (let i = 0; i < len; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

/**
 * Segment type for a given round index.
 * Round 0 is the seed word; then odd=image, even=word.
 * @param {number} round
 * @returns {"word"|"image"}
 */
export function segmentType(round) {
  return round % 2 === 0 ? "word" : "image";
}

/**
 * Compute the effective number of passes given player count + optional GM
 * override. Result is always even (so the chain ends on a word) and >= 2.
 * Default = (players - 1) rounded DOWN to even. Override is also nudged to even.
 * @param {number} players
 * @param {number|null} override
 * @returns {number}
 */
export function effectivePasses(players, override) {
  let raw = override != null ? override : players - 1;
  if (!Number.isFinite(raw)) raw = 2;
  let even = Math.floor(raw / 2) * 2; // round down to even
  return Math.max(2, even);
}

/** Total rounds (segments) in a chain = seed + passes. */
export function totalRounds(passes) {
  return passes + 1;
}

/** Build the deep-link URL a player uses to join a given game code. */
export function joinUrl(code) {
  const base = location.origin + location.pathname;
  return `${base}#/join?g=${encodeURIComponent(code)}`;
}

/** Read a query param from a hash route like "#/join?g=ABCD". */
export function hashParam(name) {
  const q = location.hash.split("?")[1] || "";
  return new URLSearchParams(q).get(name);
}

/** Escape user text before inserting as HTML. */
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
