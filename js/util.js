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
 * Segment type for a given round index. Every chain starts with a word and ends
 * on a word. Offset 1 (odd pass count) makes round 0 a "combo": the player
 * writes their word and then draws it, so round 1 is a guess.
 * @param {number} round
 * @param {number} [offset=0] - startOffset(passes)
 * @returns {"word"|"image"|"combo"}
 */
export function segmentType(round, offset = 0) {
  if (round === 0 && offset === 1) return "combo";
  return (round + offset) % 2 === 0 ? "word" : "image";
}

/**
 * Start offset for a game with the given number of passes: 1 when passes is
 * odd (round 0 is write + draw), 0 otherwise.
 * @param {number} passes
 * @returns {0|1}
 */
export function startOffset(passes) {
  return passes % 2 === 0 ? 0 : 1;
}

/**
 * Number of passes after the seed round. A GM override is used as typed (min 1);
 * odd values give a write + draw opener. Auto: players - 1 for 2, 4 or 6 players
 * (write + draw opener), otherwise players - 1 rounded down to even (min 2).
 * @param {number} players
 * @param {number|null} override
 * @returns {number}
 */
export function effectivePasses(players, override) {
  if (override != null && Number.isFinite(override)) return Math.max(1, Math.floor(override));
  if ([2, 4, 6].includes(players)) return players - 1;
  return Math.max(2, Math.floor((players - 1) / 2) * 2);
}

/** Total rounds (segments) in a chain = seed + passes. */
export function totalRounds(passes) {
  return passes + 1;
}

/**
 * Returns the correct timer duration for a phase type.
 * Draw phases use drawTimerSec; word/guess phases use wordTimerSec; a combo
 * (write + draw) opener gets both. Falls back to timerDurationSec, then 60s.
 * @param {"word"|"image"|"combo"} roundType
 * @param {object} [settings]
 * @returns {number} duration in seconds
 */
export function getPhaseDuration(roundType, settings = {}) {
  const draw = settings.drawTimerSec ?? settings.timerDurationSec ?? 60;
  const word = settings.wordTimerSec ?? settings.timerDurationSec ?? 60;
  if (roundType === "combo") return draw + word;
  return roundType === "image" ? draw : word;
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
