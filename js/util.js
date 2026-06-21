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
 * Segment type for a given round index, taking an optional start offset into
 * account. The offset is 1 when even player counts shift the chain to start
 * with an image so the final pass is always a word/guess.
 * @param {number} round
 * @param {number} [offset=0] - 0 for odd player counts, 1 for even
 * @returns {"word"|"image"}
 */
export function segmentType(round, offset = 0) {
  return (round + offset) % 2 === 0 ? "word" : "image";
}

/**
 * Start offset for a game with the given number of passes. Returns 1 when
 * passes is odd (even player count, draw-first) so that the final pass is
 * always a word/guess. Returns 0 otherwise (word-first).
 * @param {number} passes
 * @returns {0|1}
 */
export function startOffset(passes) {
  return passes % 2 === 0 ? 0 : 1;
}

/**
 * Compute the effective number of passes given player count + optional GM
 * override. Default = players - 1 (minimum 2). With even player counts this
 * yields an odd passes value; callers use startOffset(passes) to flip the
 * initial segment type so the chain still ends on a word/guess.
 * @param {number} players
 * @param {number|null} override
 * @returns {number}
 */
export function effectivePasses(players, override) {
  let raw = override != null ? override : players - 1;
  if (!Number.isFinite(raw)) raw = 2;
  return Math.max(2, Math.floor(raw));
}

/** Total rounds (segments) in a chain = seed + passes. */
export function totalRounds(passes) {
  return passes + 1;
}

/**
 * Returns the correct timer duration for a phase type.
 * Draw phases use drawTimerSec; word/guess phases use wordTimerSec.
 * Falls back to timerDurationSec for backward compatibility, then to 60s.
 * @param {"word"|"image"} roundType
 * @param {object} [settings]
 * @returns {number} duration in seconds
 */
export function getPhaseDuration(roundType, settings = {}) {
  if (roundType === "image") return settings.drawTimerSec ?? settings.timerDurationSec ?? 60;
  return settings.wordTimerSec ?? settings.timerDurationSec ?? 60;
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
