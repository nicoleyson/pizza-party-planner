// ── Firebase (free shared database + Google sign-in) ──────────────────
// None of these values are secrets: Firebase web config is meant to live in
// public website code. What protects your data is database.rules.json (only
// signed-in guests, only their own stuff) plus the secret party code in each
// invite link (after the #), which is never in the repo.
//
// Copy this file to config.js and fill in your own project's values (config.js
// is gitignored). On GitHub, the deploy builds config.js from repo secrets instead.
// Without an apiKey the site still runs, just without sign-in.
// Set databaseURL to "" to run in "demo mode" (saved only in your own browser).
export const firebaseConfig = {
  apiKey: "",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  appId: "",
};
