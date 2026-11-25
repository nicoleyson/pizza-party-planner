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

// An ingredient's earlier names (saved when its bringer renames it), newest first.
export const MAX_AKA = 5;
export const akaOf = (it) =>
  Object.values(it?.aka || {}).filter((n) => typeof n === "string" && n.trim()).slice(0, MAX_AKA);

// The earlier names to save when an ingredient goes from it.name to `name`.
// Going back to an old name drops it from the list; spelling-only changes add nothing.
export function nextAka(it, name) {
  const now = ingredientKey(name);
  const seen = new Set([now]);
  return [it.name, ...akaOf(it)]
    .map((n) => String(n).trim().slice(0, 60))
    .filter((n) => { const k = ingredientKey(n); return k && !seen.has(k) && seen.add(k); })
    .slice(0, MAX_AKA);
}

// Pizzas remember their toppings by name. Look a name up here to find who's bringing it:
// a current name wins; otherwise an earlier name finds the renamed ingredient
// ("Smoked turkey" still finds what's now "Roasted turkey").
export function ingredientIndex(groups) {
  const index = new Map(groups.map((g) => [g.key, g]));
  for (const g of groups)
    for (const [, it] of g.entries)
      for (const old of akaOf(it)) {
        const k = ingredientKey(old);
        if (k && !index.has(k)) index.set(k, g);
      }
  return index;
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

// ── Party mode ──
// The host picks a time on the party's date when party mode starts (prep time, and voting closes).
export const BAKE_DEFAULT = 8;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const okBake = (n) => Number.isInteger(n) && n >= 1 && n <= 30;

// What to save on meta for a date, a "HH:MM" start time and a bake time. Nothing without a real date and time.
export function nightFields(date, time, bake) {
  if (!partyEndsAt(date) || !TIME_RE.test(time || "")) return {};
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  const out = { nightTime: time, nightAt: new Date(y, m - 1, d, h, min).getTime() };
  const n = typeof bake === "number" ? bake : bake === "" || bake == null ? NaN : Number(bake);
  if (okBake(n)) out.bakeMinutes = n;
  return out;
}

export const isNight = (meta, now = Date.now()) => typeof meta?.nightAt === "number" && now >= meta.nightAt && !isOver(meta, now);
export const bakeMinutes = (meta) => (okBake(meta?.bakeMinutes) ? meta.bakeMinutes : BAKE_DEFAULT);

// The pizzas being made, in order: the host's moves first, then the rest by votes. `goal` of them (0 = all).
export function makingList(pizzas, goal, order) {
  const ids = new Set(Object.keys(pizzas || {}));
  const first = (Array.isArray(order) ? order : []).filter((id) => ids.has(id) && ids.delete(id));
  const all = [...first, ...rankPizzas(pizzas).map(([id]) => id).filter((id) => ids.has(id))];
  return goal ? all.slice(0, goal) : all;
}

// A safe database key for an ingredient's "got it ✓" tick.
export const prepKey = (name) => ingredientKey(name).replace(/ /g, "_");

// Every ingredient the pizzas being made need: how many pizzas and which, and who's bringing it.
const PREP_ORDER = ["sauce", "cheese", "topping", "other"];
export function prepList(makingIds, pizzas, items, extra = []) {
  const groups = groupItems(Object.entries(items || {}));
  const index = ingredientIndex(groups);
  const out = new Map();
  for (const id of makingIds) {
    const p = pizzas?.[id];
    if (!p || !Array.isArray(p.picks)) continue;
    const counted = new Set(); // each pizza counts once per ingredient, however it's spelled
    for (const pick of p.picks) {
      if (typeof pick !== "string" || !ingredientKey(pick)) continue;
      const g = index.get(ingredientKey(pick));
      const key = prepKey(g ? g.name : pick);
      if (!out.has(key)) {
        out.set(key, g
          ? { key, name: g.name, category: g.category, pizzas: [], bringers: g.entries.map(([, it]) => ({ by: it.by, amount: it.amount || "" })), missing: false }
          : { key, name: pick.trim(), category: "topping", pizzas: [], bringers: [], missing: true });
      }
      if (counted.has(key)) continue;
      counted.add(key);
      out.get(key).pizzas.push(p.name);
    }
  }
  // Things people bring that the host put on the list (like the dough), even though no pizza picks them
  const wanted = new Set(extra);
  for (const g of groups) {
    const key = prepKey(g.name);
    if (!wanted.has(key) || out.has(key)) continue;
    out.set(key, { key, name: g.name, category: g.category, pizzas: [], bringers: g.entries.map(([, it]) => ({ by: it.by, amount: it.amount || "" })), missing: false, extra: true });
  }
  const rank = (c) => { const i = PREP_ORDER.indexOf(c); return i < 0 ? 99 : i; };
  return [...out.values()].sort((a, b) => rank(a.category) - rank(b.category) || a.name.localeCompare(b.name));
}

// What the host can still add to the prep list: things people are bringing that aren't on it yet
export function prepChoices(items, list) {
  const taken = new Set(list.map((r) => r.key));
  return groupItems(Object.entries(items || {}))
    .map((g) => ({ key: prepKey(g.name), name: g.name, by: [...new Set(g.entries.map(([, it]) => it.by))].join(", ") }))
    .filter((c) => c.key && !taken.has(c.key))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Where a pizza is in the oven. Timers save a start time and a length, so every phone
// counts down on its own: waiting -> baking (secs left) -> check (secs over) -> ready.
export function ovenState(entry, now) {
  if (!entry || typeof entry !== "object") return { state: "waiting", secs: 0 };
  if (typeof entry.readyAt === "number") return { state: "ready", secs: 0 };
  const left = entry.startedAt + entry.minutes * 60000 - now;
  return left > 0 ? { state: "baking", secs: Math.ceil(left / 1000) } : { state: "check", secs: Math.floor(Math.abs(left) / 1000) };
}

// 312 -> "5:12"
export const clock = (secs) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

// 🏆 Crowd favorite (best average, 2+ ratings) and 🌶️ Most adventurous (most picks, 2+).
// Only pizzas that came out of the oven count. Ties go to more ratings, then whichever came out first.
export function awards(pizzas, oven, ratings, adventurous) {
  const made = Object.keys(pizzas || {}).filter((id) => typeof oven?.[id]?.readyAt === "number");
  const out = oven || {};
  const avg = {};
  for (const id of made) {
    const stars = Object.values(ratings?.[id] || {}).filter((n) => Number.isInteger(n) && n >= 1 && n <= 5);
    if (stars.length) avg[id] = { avg: stars.reduce((a, b) => a + b, 0) / stars.length, n: stars.length };
  }
  const earlier = (a, b) => out[a].readyAt - out[b].readyAt;
  const crowd = made.filter((id) => avg[id]?.n >= 2).sort((a, b) => avg[b].avg - avg[a].avg || avg[b].n - avg[a].n || earlier(a, b))[0] ?? null;
  const picks = {};
  for (const id of Object.values(adventurous || {})) if (made.includes(id)) picks[id] = (picks[id] || 0) + 1;
  const spicy = Object.keys(picks).filter((id) => picks[id] >= 2).sort((a, b) => picks[b] - picks[a] || earlier(a, b))[0] ?? null;
  return { crowd, adventurous: spicy, avg, picks };
}
