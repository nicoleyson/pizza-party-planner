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

// Cohosts are saved as { uid: true }; keep only plain ids set to true.
export const cohostIds = (obj) =>
  Object.keys(obj || {}).filter((k) => SAFE_ID.test(k) && obj[k] === true);

export const voteCount = (p) => Object.keys(p?.votes || {}).length;

// Most votes first; ties go to whichever was proposed first.
export const rankPizzas = (pizzas) =>
  Object.entries(pizzas || {}).sort((a, b) => voteCount(b[1]) - voteCount(a[1]) || (a[1].createdAt || 0) - (b[1].createdAt || 0));

// "Pepperoni", "pepperoni " and "PEPPERONI!" are the same ingredient.
export const ingredientKey = (name) =>
  String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Merge ingredients that several people are bringing into one group each.
// entries: [[id, item], ...] -> [{ key, name, category, icon, entries }]
export function groupItems(entries) {
  const groups = new Map();
  for (const [id, it] of entries) {
    const key = ingredientKey(it.name) || id;
    if (!groups.has(key)) groups.set(key, { key, name: it.name.trim(), category: it.category, icon: "", entries: [] });
    const g = groups.get(key);
    g.entries.push([id, it]);
    if (!g.icon && it.icon) g.icon = it.icon;
  }
  return [...groups.values()];
}

// "2 cups" + "1 cup" + "lots" (Nicole) -> "3 cups + lots (Nicole)".
// Only says something when at least two amounts in the same unit add up; otherwise "".
const NUM = /^(\d+)\/(\d+)|^(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+))?/;
const singular = (u) => u.replace(/(x|sh|ch|ss)es$/, "$1").replace(/([^s])s$/, "$1");
export function totalAmount(entries) {
  const units = new Map(); // key -> { sum, count, plural }
  const vague = [];
  for (const [, it] of entries) {
    const amt = String(it.amount || "").trim();
    if (!amt) continue;
    const m = amt.match(NUM);
    if (!m) { vague.push(`${amt} (${String(it.by || "").trim()})`); continue; }
    const n = m[1] ? m[1] / m[2] : +m[3] + (m[4] ? m[4] / m[5] : 0);
    const unit = amt.slice(m[0].length).trim().toLowerCase().replace(/\s+/g, " ");
    const key = singular(unit);
    const u = units.get(key) || { sum: 0, count: 0, plural: "" };
    u.sum += n;
    u.count++;
    if (unit !== key) u.plural = unit;
    units.set(key, u);
  }
  if (![...units.values()].some((u) => u.count > 1)) return "";
  const nums = [...units].map(([key, { sum, plural }]) => {
    const n = +sum.toFixed(2);
    const word = n === 1 || !key ? key : plural || (key.length > 2 ? key.replace(/(x|sh|ch|s)$/, "$1e") + "s" : key);
    return word ? `${n} ${word}` : `${n}`;
  });
  return [...nums, ...vague].join(" + ");
}

// ── Party date ──
// A party can have a date ("2026-12-05"). It wraps up at midnight after that day,
// in the host's time zone, and from then on the page is a read-only keepsake.
// Parties without a date never wrap up (that's every party made before dates existed).
// How many pizzas the host plans to make: a whole number from 1 to 50, or 0 for "not set".
export const pizzaGoal = (meta) => {
  const n = meta?.pizzaGoal;
  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : 0;
};

export const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

// "2026-12-05" -> the moment that day ends (local midnight), or null if it isn't a real date.
export function partyEndsAt(date) {
  if (!DATE_RE.test(date || "")) return null;
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(y, m - 1, d);
  if (day.getFullYear() !== y || day.getMonth() !== m - 1 || day.getDate() !== d) return null;
  return new Date(y, m - 1, d + 1).getTime();
}

export const isOver = (meta, now = Date.now()) => typeof meta?.endsAt === "number" && now >= meta.endsAt;

// "2026-12-05" -> "Saturday, December 5"
export function formatPartyDate(date) {
  if (!partyEndsAt(date)) return "";
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

// Today as "YYYY-MM-DD" in local time (for the date picker's minimum).
export function todayISO(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

// Local testing: http://localhost:8765/?demo runs the site in demo mode (no Google sign-in,
// nothing read from or written to the real database, data kept in this browser only).
// Only on your own computer, so the live site can't be switched into it.
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
export const localDemo = (loc) => LOCAL_HOSTS.includes(loc?.hostname) && new URLSearchParams(loc?.search || "").has("demo");
