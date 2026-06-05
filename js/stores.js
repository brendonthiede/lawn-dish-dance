// Thin wrappers over RTDB realtime subscriptions.
import { db, ref, onValue } from "./firebase.js";

/** Subscribe to a DB path; cb(value) on every change. Returns an unsubscribe fn. */
export function watch(path, cb) {
  return onValue(ref(db, path), (snap) => cb(snap.val()));
}

/** Subscribe to a whole game node. cb(game) where game may be null. */
export function watchGame(gameId, cb) {
  return watch(`games/${gameId}`, cb);
}
