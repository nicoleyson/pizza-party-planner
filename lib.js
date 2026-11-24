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
