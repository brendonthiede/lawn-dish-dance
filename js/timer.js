// Timer sync without per-second writes. The GM writes a single `endsAt` epoch
// (ms) into the DB; every client renders the countdown locally as
// `endsAt - serverNow()`. We correct local clock skew once at connect using the
// RTDB `.info/serverTimeOffset` node.
import { db, ref, onValue } from "./firebase.js";

let serverOffset = 0; // ms to add to Date.now() to approximate server time
if (db) {
  onValue(ref(db, ".info/serverTimeOffset"), (snap) => {
    serverOffset = snap.val() || 0;
  });
}

/** Approximate server time in ms (clock-skew corrected). */
export function serverNow() {
  return Date.now() + serverOffset;
}

/**
 * Milliseconds remaining for a timer object, regardless of running/paused.
 * @param {{endsAt?:number, state?:string, remainingMs?:number}|null} timer
 * @returns {number} clamped to >= 0
 */
export function remainingMs(timer) {
  if (!timer) return 0;
  if (timer.state === "paused") return Math.max(0, timer.remainingMs || 0);
  if (timer.state === "running" && timer.endsAt) {
    return Math.max(0, timer.endsAt - serverNow());
  }
  return 0;
}

/** Format ms as M:SS. */
export function fmtClock(ms) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
