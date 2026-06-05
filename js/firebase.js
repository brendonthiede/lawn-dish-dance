// Firebase initialization — anonymous auth + Realtime Database.
// Uses the official ESM builds from gstatic (no bundler / build step needed).
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  get,
  set,
  update,
  remove,
  push,
  onValue,
  onDisconnect,
  serverTimestamp,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-database.js";

import { firebaseConfig } from "./firebase-config.js";

export const isConfigured = firebaseConfig.apiKey !== "REPLACE_ME";

let app, auth, db;
if (isConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getDatabase(app);
}

export { app, auth, db };
export {
  ref,
  get,
  set,
  update,
  remove,
  push,
  onValue,
  onDisconnect,
  serverTimestamp,
  runTransaction,
};

/**
 * Resolve once we have an anonymous auth uid. Caches the promise so callers
 * across views share a single sign-in.
 * @returns {Promise<string>} the current user's uid
 */
let _uidPromise = null;
export function ensureAuth() {
  if (!isConfigured) return Promise.reject(new Error("Firebase not configured"));
  if (_uidPromise) return _uidPromise;
  _uidPromise = new Promise((resolve, reject) => {
    onAuthStateChanged(auth, (user) => {
      if (user) resolve(user.uid);
    });
    signInAnonymously(auth).catch(reject);
  });
  return _uidPromise;
}
