// Tests database.rules.json against the Firebase Realtime Database emulator: an offline copy of
// Firebase on this computer. It never talks to the live database.
//
//   npm run test:rules
//
// Each test writes the same shapes app.js writes, as different people (a host, a guest, a stranger,
// someone with an unverified email, someone not signed in with Google), and checks the rules
// allow or refuse it. Skipped unless the emulator is running (test:rules starts it for you).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
const NS = "pizza-rules-test";
const skip = !HOST && "set FIREBASE_DATABASE_EMULATOR_HOST (npm run test:rules does this)";

// ── Talking to the emulator ──
const url = (path) => `http://${HOST}/${path}.json?ns=${NS}`;
// Admin goes in the Authorization header. A person's sign-in token goes in ?auth=, because the
// emulator treats any bearer token in the header as an admin, which would make every rule pass.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
// The emulator accepts unsigned sign-in tokens, so tests can be anyone.
function token({ uid, email, verified = true, provider = "google.com", picture }) {
  const now = Math.floor(Date.now() / 1000);
  return [
    b64({ alg: "none", typ: "JWT" }),
    b64({
      iss: `https://securetoken.google.com/${NS}`, aud: NS, iat: now, exp: now + 3600, auth_time: now,
      sub: uid, user_id: uid, email, email_verified: verified, ...(picture && { picture }),
      firebase: { sign_in_provider: provider, identities: {} },
    }),
    "",
  ].join(".");
}
async function call(method, path, body, who) {
  const headers = { "Content-Type": "application/json" };
  if (who === "admin") headers.Authorization = "Bearer owner";
  const res = await fetch(url(path) + (who && who !== "admin" ? `&auth=${token(who)}` : ""), { method, headers, ...(body !== undefined && { body: JSON.stringify(body) }) });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
}
const put = (path, body, who) => call("PUT", path, body, who);
const get = (path, who) => call("GET", path, undefined, who);
const del = (path, who) => call("DELETE", path, undefined, who);
const allowed = async (p, msg) => { const r = await p; assert.ok(r.ok, `${msg}: expected allowed, got ${r.status} ${JSON.stringify(r.body)}`); };
const denied = async (p, msg) => { const r = await p; assert.equal(r.status, 401, `${msg}: expected refused, got ${r.status}`); };

// ── People ──
const host = { uid: "host1", email: "host@gmail.com" };
const guest = { uid: "guest1", email: "guest@gmail.com" };
const stranger = { uid: "stranger1", email: "stranger@gmail.com" };
const unverified = { uid: "unverified1", email: "unverified@gmail.com", verified: false };
const passwordUser = { uid: "password1", email: "pw@gmail.com", provider: "password" };

// ── Parties, in the shapes already in the live database ──
const DAY = 24 * 60 * 60 * 1000;
const OLD = "oldparty-abc123"; // made before party dates existed
const PAST = "pastparty-abc123"; // its date has passed
const SOON = "soonparty-abc123"; // its date is coming up
const PRIVATE = "privateparty-abc1"; // invite-only
const oldMeta = { title: "Old party", details: "Saturday", uid: host.uid, createdAt: 1700000000000 };
const datedMeta = (endsAt) => ({ ...oldMeta, title: "Dated party", date: "2026-01-01", endsAt });

before(async () => {
  if (skip) return;
  await allowed(put(".settings/rules", JSON.parse(readFileSync(process.env.RULES_FILE || new URL("../database.rules.json", import.meta.url), "utf8")), "admin"), "load rules");
  await allowed(put("", {
    hosts: { "host@gmail,com": true },
    parties: {
      [OLD]: {
        meta: oldMeta,
        // An older pizza that lists ingredient ids instead of names
        pizzas: { oldpizza: { name: "Old pizza", by: "Host", uid: host.uid, createdAt: 1, ingredients: ["olditem"], votes: { [host.uid]: "Host" } } },
        items: { olditem: { name: "Basil", category: "topping", by: "Host", uid: host.uid, createdAt: 1, icon: "🌿" } },
      },
      [PAST]: {
        meta: datedMeta(Date.now() - DAY),
        items: { hostitem: { name: "Dough", category: "other", by: "Host", uid: host.uid, createdAt: 1 } },
        pizzas: { p1: { name: "Margherita", by: "Host", uid: host.uid, createdAt: 1, picks: ["Dough"], votes: { [host.uid]: "Host" } } },
        people: { [guest.uid]: { name: "Guest", joinedAt: 1 } },
      },
      [SOON]: { meta: datedMeta(Date.now() + 7 * DAY) },
      [PRIVATE]: { meta: { ...oldMeta, guestOnly: true }, guests: { "guest@gmail,com": "guest@gmail.com" } },
    },
  }, "admin"), "seed");
});

// What app.js writes, field for field
const item = (who, extra = {}) => ({ name: "Garlic", category: "sauce", by: "Guest", uid: who.uid, createdAt: Date.now(), ...extra });
const diet = (who) => ({ note: "No nuts", by: "Guest", uid: who.uid, createdAt: Date.now() });
const pizza = (who) => ({ name: "Basil Instinct", by: "Guest", uid: who.uid, picks: ["Garlic", "Basil"], createdAt: Date.now(), votes: { [who.uid]: "Guest" } });

test("a party from before party dates works exactly as before", { skip }, async () => {
  const P = `parties/${OLD}`;
  await allowed(put(`${P}/people/${guest.uid}`, { name: "Guest", joinedAt: Date.now() }, guest), "join");
  await allowed(put(`${P}/items/i1`, item(guest, { amount: "1 jar" }), guest), "bring a sauce");
  await allowed(put(`${P}/items/i2`, item(guest, { name: "Cotija", category: "cheese", icon: "🇲🇽" }), guest), "a cheese with a flag icon");
  await allowed(put(`${P}/items/i3`, item(guest, { name: "Wine", category: "other", icon: "🍷" }), guest), "drinks with an icon");
  await allowed(put(`${P}/diets/d1`, diet(guest), guest), "dietary need");
  await allowed(put(`${P}/pizzas/z1`, pizza(guest), guest), "propose a pizza");
  await allowed(put(`${P}/pizzas/oldpizza/votes/${guest.uid}`, "Guest", guest), "vote on an older pizza");
  await allowed(del(`${P}/pizzas/oldpizza/votes/${guest.uid}`, guest), "take the vote back");
  await allowed(put(`${P}/pizzas/z1/name`, "Basil Instinct 2", guest), "rename");
  await allowed(put(`${P}/pizzas/z1/look/sauce`, "pesto", guest), "sauce color");
  await allowed(put(`${P}/items/i1`, item(guest, { amount: "2 jars", icon: "🧄" }), guest), "edit your item");
  await allowed(del(`${P}/items/i3`, guest), "delete your item");
  const { body } = await get(`${P}/items`, guest);
  assert.equal(body.olditem.name, "Basil", "older items are still readable");
});

test("nobody can change or delete someone else's things", { skip }, async () => {
  const P = `parties/${OLD}`;
  await denied(del(`${P}/items/olditem`, guest), "delete the host's item");
  await denied(put(`${P}/items/olditem`, item(guest), guest), "overwrite the host's item");
  await denied(put(`${P}/items/fake`, item(host), guest), "add an item in someone else's name");
  await denied(put(`${P}/pizzas/oldpizza/votes/${host.uid}`, null, guest), "remove someone else's vote");
  await denied(put(`${P}/people/${host.uid}`, { name: "Hacked" }, guest), "change someone else's name");
});

test("odd data is refused", { skip }, async () => {
  const P = `parties/${OLD}`;
  await denied(put(`${P}/items/x1`, item(guest, { category: "dessert" }), guest), "unknown type");
  await denied(put(`${P}/items/x2`, item(guest, { icon: "🍕🍕🍕🍕🍕" }), guest), "icon too long");
  await denied(put(`${P}/items/x3`, item(guest, { sneaky: true }), guest), "extra field");
  await denied(put(`${P}/items/x4`, item(guest, { name: "x".repeat(61) }), guest), "name too long");
});

test("after the party date, guests can look but not change anything", { skip }, async () => {
  const P = `parties/${PAST}`;
  await denied(put(`${P}/people/${guest.uid}`, { name: "Guest 2", joinedAt: 1 }, guest), "change name");
  await denied(put(`${P}/items/late`, item(guest), guest), "bring something");
  await denied(put(`${P}/diets/late`, diet(guest), guest), "add a dietary need");
  await denied(put(`${P}/pizzas/late`, pizza(guest), guest), "propose a pizza");
  await denied(put(`${P}/pizzas/p1/votes/${guest.uid}`, "Guest", guest), "vote");
  await denied(put(`${P}/pizzas/p1/name`, "Renamed", guest), "rename");
  await denied(put(`${P}/pizzas/p1/look/sauce`, "pesto", guest), "sauce color");
  await denied(del(`${P}/items/hostitem`, host), "even the host can't delete items once it's over");
  const { ok, body } = await get(`${P}/pizzas`, guest);
  assert.ok(ok && body.p1.name === "Margherita", "it's still readable as a keepsake");
});

test("the host can reopen a finished party by changing or clearing the date", { skip }, async () => {
  const P = `parties/${PAST}`;
  await allowed(put(`${P}/guests`, { "friend@gmail,com": "friend@gmail.com" }, host), "guest list still editable");
  await allowed(put(`${P}/guests`, null, host), "and clearable");
  await allowed(put(`${P}/meta`, { ...datedMeta(Date.now() + DAY), date: "2030-05-05" }, host), "move the date later");
  await allowed(put(`${P}/items/reopened`, item(guest), guest), "guests can bring things again");
  await allowed(put(`${P}/meta`, datedMeta(Date.now() - DAY), host), "set it back in the past");
  await denied(put(`${P}/items/again`, item(guest), guest), "locked again");
  await allowed(put(`${P}/meta`, oldMeta, host), "clear the date");
  await allowed(put(`${P}/items/cleared`, item(guest), guest), "no date means open");
});

test("a party whose date hasn't come yet is open", { skip }, async () => {
  await allowed(put(`parties/${SOON}/items/s1`, item(guest), guest), "bring something");
  await allowed(put(`parties/${SOON}/pizzas/s1`, pizza(guest), guest), "propose a pizza");
});

test("party settings: only the host, and only sensible values", { skip }, async () => {
  const P = `parties/${OLD}/meta`;
  await allowed(put(P, { ...oldMeta, pizzaGoal: 6 }, host), "set a pizza goal");
  await allowed(put(P, { ...oldMeta, pizzaGoal: 1 }, host), "goal of 1");
  await allowed(put(P, { ...oldMeta, pizzaGoal: 50 }, host), "goal of 50");
  await denied(put(P, { ...oldMeta, pizzaGoal: 0 }, host), "goal of 0");
  await denied(put(P, { ...oldMeta, pizzaGoal: 51 }, host), "goal of 51");
  await denied(put(P, { ...oldMeta, pizzaGoal: "6" }, host), "goal as text");
  await denied(put(P, { ...oldMeta, date: "2030-01-01" }, host), "date without its end time");
  await denied(put(P, { ...oldMeta, endsAt: Date.now() }, host), "end time without a date");
  await denied(put(P, { ...oldMeta, date: "Jan 1", endsAt: Date.now() }, host), "date in the wrong format");
  await denied(put(P, { ...oldMeta, theme: "dark" }, host), "unknown setting");
  await denied(put(P, { ...oldMeta, title: "Mine now", uid: guest.uid }, guest), "a guest can't take over the party");
  await denied(put(`${P}/guestOnly`, true, guest), "a guest can't make it invite-only");
  await allowed(put(P, oldMeta, host), "back to how it was");
});

test("creating parties: hosts only, with or without a date", { skip }, async () => {
  const meta = { title: "New", details: "", uid: host.uid, createdAt: Date.now() };
  await allowed(put("parties/newparty-abc12345/meta", meta, host), "host creates a party");
  await allowed(put("parties/newparty-dated123/meta", { ...meta, date: "2030-02-02", endsAt: Date.now() + 9 * DAY }, host), "with a date");
  await denied(put("parties/newparty-guest1234/meta", { ...meta, uid: guest.uid }, guest), "non-host creates a party");
});

test("invite-only parties stay private", { skip }, async () => {
  const P = `parties/${PRIVATE}`;
  await allowed(get(`${P}/meta`, guest), "invited guest reads");
  await allowed(put(`${P}/items/g1`, item(guest), guest), "invited guest brings something");
  await denied(get(`${P}/items`, stranger), "stranger reads");
  await denied(put(`${P}/items/s1`, item(stranger), stranger), "stranger writes");
  await denied(get(`${P}/guests`, guest), "guests can't see the guest list");
  await allowed(get(`${P}/guests`, host), "the host can");
});

test("guest emails with dots (first.last@gmail.com) work like the app stores them", { skip }, async () => {
  const dotted = { uid: "dotted1", email: "First.Last@gmail.com" };
  const P = `parties/${PRIVATE}`;
  // app.js: emailKey = lowercase, every "." becomes ","
  const key = dotted.email.toLowerCase().replaceAll(".", ",");
  await allowed(put(`${P}/guests`, { "guest@gmail,com": "guest@gmail.com", [key]: dotted.email.toLowerCase() }, host), "host saves the list");
  await allowed(get(`${P}/items`, dotted), "the dotted guest gets in");
  await allowed(put(`${P}/items/d1`, item(dotted), dotted), "and can bring something");
  await denied(put(`${P}/guests`, { "someone,else@gmail,com": "first.last@gmail.com" }, host), "a key that doesn't match its email");
});

test("only verified Google accounts get in", { skip }, async () => {
  await denied(get(`parties/${OLD}/items`, unverified), "unverified email reads");
  await denied(put(`parties/${OLD}/items/u1`, item(unverified), unverified), "unverified email writes");
  await denied(put(`parties/${OLD}/items/p1`, item(passwordUser), passwordUser), "non-Google sign-in writes");
  await denied(get(`parties/${OLD}/items`, null), "signed-out reads");
  await denied(get("parties", guest), "nobody can list every party");
});
