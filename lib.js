// Small pure helpers shared by the app and the tests (no DOM, no network).

// Party codes live after the # in the invite link. Keep in sync with database.rules.json.
export const CODE_RE = /^[a-z0-9-]{12,40}$/;
// Item / pizza ids. Keep in sync with database.rules.json.
export const SAFE_ID = /^[-_A-Za-z0-9]{1,40}$/;

// Accepts a bare code, "#code" or a whole invite link. Returns null if it isn't a valid code.
export function parseCode(s) {
  s = String(s || "").trim().toLowerCase();
  if (s.includes("#")) s = s.split("#").pop();
  return CODE_RE.test(s) ? s : null;
}

const WORDS = ["pepperoni", "basil", "mozz", "crust", "oregano", "calzone", "garlic", "olive", "funghi", "marinara"];
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export function newCode() {
  const rand = [...crypto.getRandomValues(new Uint8Array(10))].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${WORDS[Math.floor(Math.random() * WORDS.length)]}-${rand}`;
}

// Escape text before putting it in HTML.
const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);

// Drop entries with odd keys or non-object values (anything weird in the database).
export const cleanIds = (obj) =>
  Object.fromEntries(Object.entries(obj || {}).filter(([k, v]) => SAFE_ID.test(k) && v && typeof v === "object"));

export const voteCount = (p) => Object.keys(p?.votes || {}).length;

// Most votes first; ties go to whichever was proposed first.
export const rankPizzas = (pizzas) =>
  Object.entries(pizzas || {}).sort((a, b) => voteCount(b[1]) - voteCount(a[1]) || (a[1].createdAt || 0) - (b[1].createdAt || 0));
