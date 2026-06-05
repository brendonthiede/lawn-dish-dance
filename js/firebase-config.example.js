// Copy this file to `firebase-config.js` and paste in your own Firebase web
// config. `firebase-config.js` is gitignored so your keys are not committed.
//
// To get these values:
//   1. https://console.firebase.google.com  ->  Add project (free Spark plan)
//   2. Build > Realtime Database > Create database (start in locked mode;
//      we ship database.rules.json)
//   3. Build > Authentication > Get started > enable "Anonymous"
//   4. Project settings (gear) > General > "Your apps" > Web app (</>) >
//      register, then copy the firebaseConfig values below.
//
// NOTE: a Firebase web API key is NOT a secret — it identifies the project,
// it does not grant access. Access is controlled entirely by database.rules.json.

export const firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME.firebaseapp.com",
  databaseURL: "https://REPLACE_ME-default-rtdb.firebaseio.com",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME.appspot.com",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME",
};
