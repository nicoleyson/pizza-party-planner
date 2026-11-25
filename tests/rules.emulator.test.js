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
const cohost = { uid: "cohost1", email: "cohost@gmail.com" };

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

test("cohosts: the host picks them, and they can run the party's settings", { skip }, async () => {
  const P = "parties/cohostparty-abc1";
  await allowed(put(P, { meta: oldMeta, people: { [cohost.uid]: { name: "Cohost", joinedAt: 1 }, [guest.uid]: { name: "Guest", joinedAt: 2 } } }, "admin"), "seed");
  // Only the host picks cohosts, only from people who joined, and never themselves
  await denied(put(`${P}/cohosts/${guest.uid}`, true, guest), "a guest can't make themselves a cohost");
  await denied(put(`${P}/cohosts/${stranger.uid}`, true, host), "someone who hasn't joined");
  await denied(put(`${P}/cohosts/${host.uid}`, true, host), "the host themselves");
  await denied(put(`${P}/cohosts/${cohost.uid}`, "yes", host), "anything but true");
  await allowed(put(`${P}/cohosts/${cohost.uid}`, true, host), "the host adds a cohost");
  await allowed(get(`${P}/cohosts`, guest), "everyone at the party can see who's cohosting");
  await denied(put(`${P}/cohosts/${guest.uid}`, true, cohost), "a cohost can't add more cohosts");
  // A cohost runs the settings, but the party stays the host's
  await allowed(put(`${P}/meta`, { ...oldMeta, title: "Renamed by cohost", pizzaGoal: 4, date: "2030-03-03", endsAt: Date.now() + 9 * DAY }, cohost), "edit name, goal and date");
  await denied(put(`${P}/meta`, { ...oldMeta, uid: cohost.uid }, cohost), "take over the party");
  await denied(put(`${P}/meta`, null, cohost), "delete the party");
  await denied(put(`${P}/meta`, { ...oldMeta, title: "Guest was here" }, guest), "a guest still can't edit settings");
  await allowed(put(`${P}/guests`, { "guest@gmail,com": "guest@gmail.com" }, cohost), "manage the guest list");
  await allowed(get(`${P}/guests`, cohost), "see the guest list");
  await denied(get(`${P}/guests`, guest), "guests still can't");
  await allowed(put(`${P}/meta/guestOnly`, true, cohost), "make it invite-only");
  await allowed(get(`${P}/items`, cohost), "a cohost isn't locked out of invite-only, even off the list");
  await allowed(put(`${P}/meta/guestOnly`, null, host), "the host can still change everything");
  // Stepping down, and the host removing a cohost
  await allowed(del(`${P}/cohosts/${cohost.uid}`, cohost), "a cohost can step down");
  await denied(put(`${P}/meta`, oldMeta, cohost), "and then can't edit settings");
  await allowed(put(`${P}/cohosts/${cohost.uid}`, true, host), "added again");
  await allowed(del(`${P}/cohosts/${cohost.uid}`, host), "the host removes them");
  await denied(get(`${P}/guests`, cohost), "and the guest list is private again");
});

test("cohosts can reopen a finished party, and invite-only hides who's cohosting", { skip }, async () => {
  const P = "parties/cohostover-abc12";
  const ended = datedMeta(Date.now() - DAY);
  await allowed(put(P, { meta: { ...ended, guestOnly: true }, guests: { "cohost@gmail,com": "cohost@gmail.com" }, people: { [cohost.uid]: { name: "Cohost", joinedAt: 1 } } }, "admin"), "seed an ended, invite-only party");
  await allowed(put(`${P}/cohosts/${cohost.uid}`, true, host), "the host can still pick cohosts after the party");
  await denied(get(`${P}/cohosts`, stranger), "a stranger can't see who's cohosting");
  await denied(put(`${P}/items/late`, item(cohost), cohost), "it's over, so even a cohost can't bring things");
  await allowed(put(`${P}/meta`, { ...ended, guestOnly: true, date: "2030-04-04", endsAt: Date.now() + DAY }, cohost), "the cohost moves the date later");
  await allowed(put(`${P}/items/back`, item(cohost), cohost), "and the party is open again");
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

test("renamed ingredients keep their old names, and the host fixes any pizza's toppings", { skip }, async () => {
  const P = "parties/toppingparty-abc1";
  await allowed(put(P, {
    meta: oldMeta,
    cohosts: { [cohost.uid]: true },
    people: { [cohost.uid]: { name: "Cohost", joinedAt: 1 } },
    pizzas: { gp: { name: "Turkey time", by: "Guest", uid: guest.uid, createdAt: 1, picks: ["Smoked turkey"], votes: { [guest.uid]: "Guest", [host.uid]: "Host" } } },
  }, "admin"), "seed");
  await allowed(put(`${P}/items/t1`, item(guest, { name: "Roasted turkey", category: "topping", aka: ["Smoked turkey"] }), guest), "rename, keeping the old name");
  await denied(put(`${P}/items/t2`, item(guest, { aka: "Smoked turkey" }), guest), "old names as text");
  await denied(put(`${P}/items/t3`, item(guest, { aka: ["a", "b", "c", "d", "e", "f"] }), guest), "more than five old names");
  await denied(put(`${P}/items/t4`, item(guest, { aka: ["x".repeat(61)] }), guest), "old name too long");
  await allowed(put(`${P}/pizzas/gp/picks`, ["Roasted turkey", "Basil"], host), "the host changes a guest's toppings");
  await allowed(put(`${P}/pizzas/gp/picks`, ["Roasted turkey"], cohost), "so can a cohost");
  await allowed(put(`${P}/pizzas/gp/picks`, ["Roasted turkey", "Garlic"], guest), "and whoever proposed it");
  await denied(put(`${P}/pizzas/gp/picks`, ["Anchovies"], stranger), "nobody else");
  await denied(put(`${P}/pizzas/gp/picks`, "Anchovies", host), "toppings as text");
  await denied(put(`${P}/pizzas/nope/picks`, ["Basil"], host), "a pizza that doesn't exist");
});

// ── Party mode ──
const HOUR = 60 * 60 * 1000;
const nightParty = (nightIn, endsIn = 10 * HOUR) => {
  const date = isoDate(Date.now() + endsIn - DAY / 2);
  return {
    meta: { ...oldMeta, date, endsAt: Date.now() + endsIn, nightTime: "16:00", nightAt: Date.now() + nightIn, bakeMinutes: 8 },
    cohosts: { [cohost.uid]: true },
    people: { [cohost.uid]: { name: "Cohost", joinedAt: 1 }, [guest.uid]: { name: "Guest", joinedAt: 2 } },
    pizzas: {
      np1: { name: "Ready one", by: "Guest", uid: guest.uid, createdAt: 1, picks: ["Basil"], votes: { [guest.uid]: "Guest" } },
      np2: { name: "Not yet", by: "Guest", uid: guest.uid, createdAt: 2, picks: ["Basil"], votes: { [guest.uid]: "Guest" } },
    },
    night: { oven: { np1: { rack: "top", startedAt: Date.now() - HOUR, minutes: 8, readyAt: Date.now() - HOUR / 2 } } },
  };
};
function isoDate(ms) { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

test("party mode: voting and new pizzas stop at the start time", { skip }, async () => {
  const P = "parties/nightparty-abc1";
  await allowed(put(P, nightParty(-HOUR), "admin"), "seed");
  await denied(put(`${P}/pizzas/np2/votes/${cohost.uid}`, "Cohost", cohost), "vote after party mode starts");
  await denied(put(`${P}/pizzas/late`, pizza(guest), guest), "propose a pizza after it starts");
  await denied(del(`${P}/pizzas/np2`, guest), "delete your own pizza after it starts");
  await allowed(put(`${P}/pizzas/np2/picks`, ["Basil", "Garlic"], host), "the host can still change toppings");
  await allowed(put(`${P}/pizzas/np2/name`, "Renamed", guest), "renaming still works");
  const S = "parties/nightsoon-abc1";
  await allowed(put(S, nightParty(HOUR), "admin"), "seed");
  await allowed(put(`${S}/pizzas/np2/votes/${cohost.uid}`, "Cohost", cohost), "vote before it starts");
  await denied(put(`${S}/night/prep/basil`, true, guest), "no prep ticks before it starts");
  await denied(put(`${S}/night/oven/np2`, { rack: "top", startedAt: Date.now() - 1000, minutes: 8 }, guest), "no oven before it starts");
  await allowed(put(`parties/${OLD}/pizzas/oldpizza/votes/${cohost.uid}`, "Cohost", cohost), "parties without party mode vote as before");
});

test("party mode: the plan, order and prep notes are the host's", { skip }, async () => {
  const P = "parties/nightplan-abc1";
  await allowed(put(P, nightParty(HOUR), "admin"), "seed");
  await allowed(put(`${P}/night/plan`, "Oven to 500° at 6\nDamian on toppings", host), "host writes the plan");
  await allowed(put(`${P}/night/plan`, "Cohost edit", cohost), "so can a cohost");
  await denied(put(`${P}/night/plan`, "Guest edit", guest), "not a guest");
  await denied(put(`${P}/night/plan`, "x".repeat(1001), host), "plan too long");
  await allowed(put(`${P}/night/order`, ["np2", "np1"], host), "host moves a pizza");
  await denied(put(`${P}/night/order`, ["np2"], guest), "not a guest");
  await denied(put(`${P}/night/order`, ["bad id!"], host), "odd ids");
  await allowed(put(`${P}/night/notes/np1`, "basil after baking", cohost), "prep note");
  await denied(put(`${P}/night/notes/np1`, "mine", guest), "guests can't write prep notes");
  await denied(put(`${P}/night/notes/np1`, "x".repeat(201), host), "note too long");
  await denied(put(`${P}/night/sneaky`, true, host), "nothing else under night");
  await allowed(get(`${P}/night`, guest), "everyone at the party can read it");
  await denied(get(`${P}/night`, unverified), "unverified accounts can't");
});

test("party mode: anyone at the party ticks prep and runs the oven", { skip }, async () => {
  const P = "parties/nightoven-abc1";
  await allowed(put(P, nightParty(-HOUR), "admin"), "seed");
  await allowed(put(`${P}/night/prep/roasted_turkey`, true, guest), "tick prep");
  await allowed(del(`${P}/night/prep/roasted_turkey`, guest), "untick it");
  await denied(put(`${P}/night/prep/Roasted Turkey`, true, guest), "odd key");
  await denied(put(`${P}/night/prep/basil`, "yes", guest), "only true");
  const oven = { rack: "top", startedAt: Date.now() - 1000, minutes: 8 };
  await allowed(put(`${P}/night/oven/np2`, oven, guest), "start a timer");
  await allowed(put(`${P}/night/oven/np2`, { ...oven, startedAt: { ".sv": "timestamp" } }, guest), "with the server's clock");
  await allowed(put(`${P}/night/oven/np2/minutes`, 10, guest), "+2 min");
  await allowed(put(`${P}/night/oven/np2/readyAt`, { ".sv": "timestamp" }, guest), "ready");
  await allowed(del(`${P}/night/oven/np2`, guest), "stop");
  await denied(put(`${P}/night/oven/np2`, { ...oven, rack: "middle" }, guest), "no middle rack");
  await denied(put(`${P}/night/oven/np2`, { ...oven, startedAt: Date.now() + 60000 }, guest), "start time in the future");
  await denied(put(`${P}/night/oven/np2`, { ...oven, minutes: 61 }, guest), "over an hour");
  await denied(put(`${P}/night/oven/np2`, { ...oven, minutes: 0 }, guest), "zero minutes");
  await denied(put(`${P}/night/oven/np2`, { ...oven, extra: 1 }, guest), "extra field");
  await denied(put(`${P}/night/oven/nope`, oven, guest), "a pizza that doesn't exist");
  await denied(put(`${P}/night/oven/np2`, oven, unverified), "unverified accounts can't");
});

test("party mode: ratings and 🌶️ picks on ready pizzas, until the end of the next day", { skip }, async () => {
  const P = "parties/nightrate-abc1";
  await allowed(put(P, nightParty(-HOUR), "admin"), "seed");
  await allowed(put(`${P}/ratings/np1/${guest.uid}`, 4, guest), "rate a ready pizza");
  await allowed(put(`${P}/ratings/np1/${guest.uid}`, 5, guest), "change it");
  await denied(put(`${P}/ratings/np2/${guest.uid}`, 4, guest), "not out of the oven yet");
  await denied(put(`${P}/ratings/np1/${host.uid}`, 4, guest), "someone else's rating");
  await denied(put(`${P}/ratings/np1/${guest.uid}`, 6, guest), "6 stars");
  await denied(put(`${P}/ratings/np1/${guest.uid}`, 4.5, guest), "half stars");
  await allowed(put(`${P}/adventurous/${guest.uid}`, "np1", guest), "🌶️ a ready pizza");
  await allowed(del(`${P}/adventurous/${guest.uid}`, guest), "take it back");
  await denied(put(`${P}/adventurous/${guest.uid}`, "np2", guest), "not ready");
  await denied(put(`${P}/adventurous/${host.uid}`, "np1", guest), "someone else's pick");
  await allowed(get(`${P}/ratings`, guest), "everyone sees ratings");
  const A = "parties/nightafter-abc1";
  await allowed(put(A, nightParty(-20 * HOUR, -HOUR), "admin"), "seed: ended an hour ago");
  await allowed(put(`${A}/ratings/np1/${guest.uid}`, 4, guest), "still rate the morning after");
  await allowed(put(`${A}/adventurous/${guest.uid}`, "np1", guest), "and pick");
  await denied(put(`${A}/night/oven/np2`, { rack: "top", startedAt: Date.now() - 1000, minutes: 8 }, guest), "but the oven is closed");
  await denied(put(`${A}/night/prep/basil`, true, guest), "and prep");
  const L = "parties/nightlate-abc1";
  await allowed(put(L, nightParty(-40 * HOUR, -25 * HOUR), "admin"), "seed: ended 25 hours ago");
  await denied(put(`${L}/ratings/np1/${guest.uid}`, 4, guest), "too late to rate");
  await denied(put(`${L}/adventurous/${guest.uid}`, "np1", guest), "too late to pick");
});

test("party mode settings on the party", { skip }, async () => {
  const P = "parties/nightmeta-abc1";
  await allowed(put(P, { meta: datedMeta(Date.now() + DAY) }, "admin"), "seed");
  const base = datedMeta(Date.now() + DAY);
  await allowed(put(`${P}/meta`, { ...base, nightTime: "16:00", nightAt: Date.now() + HOUR, bakeMinutes: 8 }, host), "turn party mode on");
  await allowed(put(`${P}/meta`, base, host), "and off");
  const { date: _d, endsAt: _e, ...undated } = base;
  await denied(put(`${P}/meta`, { ...undated, nightTime: "16:00", nightAt: Date.now() }, host), "needs a party date");
  await denied(put(`${P}/meta`, { ...base, nightTime: "4pm", nightAt: Date.now() }, host), "time like 16:00");
  await denied(put(`${P}/meta`, { ...base, nightTime: "16:00" }, host), "time needs its timestamp");
  await denied(put(`${P}/meta`, { ...base, nightAt: Date.now() }, host), "timestamp needs its time");
  await denied(put(`${P}/meta`, { ...base, bakeMinutes: 31 }, host), "bake time over 30");
  await denied(put(`${P}/meta`, { ...base, bakeMinutes: 0 }, host), "bake time 0");
});

test("party mode: hosts add a pizza after the start, and write notes on prep list ingredients", { skip }, async () => {
  const P = "parties/nightmore-abc1";
  await allowed(put(P, nightParty(-HOUR), "admin"), "seed");
  const extra = (who) => ({ name: "Extra dough", by: "Host", uid: who.uid, picks: ["Basil"], createdAt: Date.now() });
  await allowed(put(`${P}/pizzas/more1`, extra(host), host), "the host adds a pizza after it starts");
  await allowed(put(`${P}/pizzas/more2`, extra(cohost), cohost), "so can a cohost");
  await denied(put(`${P}/pizzas/more3`, extra(guest), guest), "guests still can't");
  await denied(put(`${P}/pizzas/more4`, extra(guest), host), "only as themselves");
  await denied(put(`${P}/pizzas/more1/votes/${guest.uid}`, "Guest", guest), "voting is still closed");
  await allowed(put(`${P}/night/ingNotes/basil`, "pick the leaves", cohost), "a note on an ingredient");
  await allowed(put(`${P}/night/ingNotes/roasted_turkey`, "slice thin", host), "keys like the prep list's");
  await denied(put(`${P}/night/ingNotes/basil`, "mine", guest), "guests can't write ingredient notes");
  await denied(put(`${P}/night/ingNotes/Basil Leaves`, "x", host), "odd key");
  await denied(put(`${P}/night/ingNotes/basil`, "x".repeat(201), host), "note too long");
  await denied(put(`${P}/night/ingNotes/basil`, "", host), "empty");
});

test("party mode: hosts plan prep by day, add prep tasks, and tick early", { skip }, async () => {
  const S = "parties/nightdays-abc1";
  await allowed(put(S, nightParty(2 * DAY), "admin"), "seed (starts in two days)");
  await allowed(put(`${S}/night/prepDay/tomato_sauce`, 1, host), "the host sets a day");
  await allowed(put(`${S}/night/prepDay/mozzarella`, 7, cohost), "a cohost, up to a week before");
  await denied(put(`${S}/night/prepDay/basil`, 2, guest), "guests can't");
  await denied(put(`${S}/night/prepDay/basil`, 8, host), "not more than a week");
  await denied(put(`${S}/night/prepDay/basil`, 1.5, host), "whole days");
  await denied(put(`${S}/night/prepDay/Basil Leaves`, 1, host), "odd key");
  const task = { text: "Make the dough", days: 2, createdAt: Date.now() };
  await allowed(put(`${S}/night/tasks/t1abc`, task, host), "the host adds a prep task");
  await allowed(put(`${S}/night/tasks/t2abc`, { ...task, days: 0 }, cohost), "so can a cohost");
  await denied(put(`${S}/night/tasks/t3abc`, task, guest), "not guests");
  await denied(put(`${S}/night/tasks/t4abc`, { ...task, text: "" }, host), "no empty task");
  await denied(put(`${S}/night/tasks/t4abc`, { ...task, text: "x".repeat(81) }, host), "task too long");
  await denied(put(`${S}/night/tasks/t4abc`, { ...task, days: 9 }, host), "a week at most");
  await denied(put(`${S}/night/tasks/T-4`, task, host), "odd id");
  await denied(put(`${S}/night/tasks/t4abc`, { ...task, sneaky: 1 }, host), "nothing extra");
  await allowed(del(`${S}/night/tasks/t2abc`, host), "remove a task");
  await allowed(put(`${S}/night/prep/task_t1abc`, true, host), "the host ticks off the dough before the start");
  await allowed(put(`${S}/night/prep/tomato_sauce`, true, cohost), "a cohost ticks early too");
  await denied(put(`${S}/night/prep/basil`, true, guest), "guests tick once it starts");
  await allowed(get(`${S}/night/tasks`, guest), "everyone at the party can read the tasks");
});

test("party mode: hosts put things people bring on the prep list", { skip }, async () => {
  const S = "parties/nightextra-abc1";
  await allowed(put(S, nightParty(2 * DAY), "admin"), "seed");
  await allowed(put(`${S}/night/extra/dough`, true, host), "the host adds the dough");
  await allowed(put(`${S}/night/extra/garlic_knots`, true, cohost), "so can a cohost");
  await denied(put(`${S}/night/extra/dough`, true, guest), "not guests");
  await denied(put(`${S}/night/extra/Dough!`, true, host), "odd key");
  await denied(put(`${S}/night/extra/dough`, "yes", host), "only true");
  await allowed(del(`${S}/night/extra/dough`, host), "take it off again");
});
