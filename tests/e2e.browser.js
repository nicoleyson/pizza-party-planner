// Walks through the real page in headless Chrome, in demo mode: a made-up party saved only in
// that test browser. It never signs in and never touches the live database.
//
//   npm run test:e2e
//
// It drives the Chrome already on this computer (set CHROME=/path/to/chrome to use another one)
// and is skipped when there's no Chrome, so it can never block a deploy.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CHROME = process.env.CHROME || [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((p) => existsSync(p));
const skip = !CHROME && "no Chrome found (set CHROME=/path/to/chrome)";
// On GitHub a skipped run would look like a pass, so a missing Chrome fails it instead
if (skip && process.env.CI) throw new Error(skip);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── A tiny web server for the site's files ──
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
let server, base;
function serve() {
  server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^\/+/, "") || "index.html";
    const file = join(ROOT, path);
    // config.js is skipped on purpose: demo mode never needs the real keys
    if (!file.startsWith(ROOT) || path.startsWith(".") || path === "config.js" || !existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(readFileSync(file));
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => { base = `http://localhost:${server.address().port}`; r(); }));
}

// ── Headless Chrome over the DevTools protocol (built into Node, nothing to install) ──
let chrome, profile, ws, nextId = 0;
const pending = new Map();
let errors = [];
async function launch() {
  profile = mkdtempSync(join(tmpdir(), "pizza-e2e-"));
  // GitHub's Ubuntu machines don't allow Chrome's sandbox; it only ever opens this local test site there
  chrome = spawn(CHROME, ["--headless=new", ...(process.env.CI ? ["--no-sandbox"] : []), "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const wsBrowser = await new Promise((resolve, reject) => {
    let log = "";
    chrome.stderr.on("data", (d) => { log += d; const m = log.match(/ws:\/\/[^\s]+/); if (m) resolve(m[0]); });
    chrome.on("exit", () => reject(new Error("Chrome quit: " + log)));
  });
  const port = new URL(wsBrowser).port;
  const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
  });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
}
const send = (method, params = {}) => new Promise((r) => { const n = ++nextId; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
// Runs code in the page and returns its value
async function js(code) {
  const r = (await send("Runtime.evaluate", { expression: code, awaitPromise: true, returnByValue: true })).result;
  if (r.exceptionDetails) throw new Error(`In the page: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}\n${code}`);
  return r.result.value;
}
// Waits until code in the page is true
async function until(code, what = code, ms = 4000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (await js(`!!(${code})`)) return;
  assert.fail(`Timed out waiting for: ${what}`);
}

// ── The made-up party ──
const CODE = "e2e-pizza-party1";
const DAY = 864e5;
const isoDay = (offset) => new Date(Date.now() + offset * DAY).toLocaleDateString("en-CA");
const endOf = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d + 1).getTime(); };
const item = (name, category, by, uid, extra = {}) => ({ name, category, by, uid, createdAt: 1, ...extra });
const basicParty = () => ({
  meta: { title: "Test Pizza Night", details: "7pm", uid: "nicole", createdAt: 1 },
  people: { nicole: { name: "Nicole", joinedAt: 1 }, damian: { name: "Damian", joinedAt: 2 }, matt: { name: "Matt", joinedAt: 3 }, brad: { name: "Brad", joinedAt: 4 } },
  items: {
    i1: item("Tomato sauce", "sauce", "Damian", "damian"),
    i2: item("Mozzarella", "cheese", "Matt", "matt", { amount: "1 lb" }),
    i3: item("Mushrooms", "topping", "Brad", "brad", { icon: "🍄" }),
    i4: item("Fresh basil", "topping", "Nicole", "nicole", { icon: "🌿" }),
  },
});
let visit = 0;
// Opens the party as someone, starting from exactly this data
async function open(party, as, name = as) {
  if (party) {
    await send("Page.navigate", { url: `${base}/?demo` });
    // The page's fonts come from Google, which is sometimes slow, so the first load gets longer
    await until(`document.readyState === "complete"`, "the page to load", 15000);
    await js(`localStorage.clear(); localStorage.uid = ${JSON.stringify(as)}; localStorage.myName = ${JSON.stringify(name)};
      localStorage["pizza-demo"] = ${JSON.stringify(JSON.stringify({ parties: { [CODE]: party } }))}; true`);
  } else {
    await js(`localStorage.uid = ${JSON.stringify(as)}; localStorage.myName = ${JSON.stringify(name)}; true`);
  }
  await send("Page.navigate", { url: `${base}/?demo&visit=${++visit}#${CODE}` });
  await until(`document.getElementById("title")?.textContent && !document.getElementById("party").hidden`, "the party page");
}
const saved = () => js(`JSON.parse(localStorage["pizza-demo"]).parties[${JSON.stringify(CODE)}]`);
const click = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).click(); true`);
const fill = (sel, value) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.value = ${JSON.stringify(value)};
  el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
const submit = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).requestSubmit(); true`);
const visible = (sel) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return !!el && !el.closest("[hidden]"); })()`);
const text = (sel) => js(`document.querySelector(${JSON.stringify(sel)})?.textContent.replace(/\\s+/g, " ").trim() ?? ""`);
const cardOf = (name) => `[...document.querySelectorAll("#pizzas [data-key]")].find((c) => c.querySelector("h3, .pizza-name, [class*=name]")?.textContent.includes(${JSON.stringify(name)}) || c.textContent.includes(${JSON.stringify(name)}))`;

before(async () => {
  if (skip) return;
  await serve();
  await launch();
});
after(async () => {
  if (skip) return;
  ws?.close();
  chrome?.kill();
  server?.close();
  await sleep(200);
  rmSync(profile, { recursive: true, force: true });
});
const check = (name, fn) => test(name, { skip }, async () => {
  errors = [];
  await fn();
  assert.deepEqual(errors, [], "the page logged errors");
});

// (Joining the "who's coming" list needs a Google sign-in, so demo mode can't test it;
// the rules tests cover who can join.)
check("a guest brings something, and says me too", async () => {
  await open(basicParty(), "matt", "");
  await fill("#item-name", "Pepperoni");
  await submit("#item-form");
  await sleep(200);
  assert.ok(!Object.values((await saved()).items).some((i) => i.name === "Pepperoni"), "nothing saves without a name");
  await fill("#my-name", "Matt");

  await fill("#item-name", "Pepperoni");
  await fill("#item-cat", "topping");
  await fill("#item-amount", "2 packs");
  await submit("#item-form");
  await until(`Object.values(JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].items).some((i) => i.name === "Pepperoni")`, "pepperoni saved");
  const pep = Object.values((await saved()).items).find((i) => i.name === "Pepperoni");
  assert.deepEqual([pep.uid, pep.by, pep.category, pep.amount], ["matt", "Matt", "topping", "2 packs"]);
  await until(`document.getElementById("items").textContent.includes("Pepperoni")`, "pepperoni on the list");

  await click(`[data-me-too="i3"]`);
  await until(`Object.values(JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].items).filter((i) => i.name === "Mushrooms").length === 2`, "a second Mushrooms");
  assert.ok(Object.values((await saved()).items).some((i) => i.name === "Mushrooms" && i.uid === "matt"), "the me-too is Matt's");
});

check("building a pizza puts it on the table, and one vote moves the cut line", async () => {
  const party = basicParty();
  party.meta.pizzaGoal = 2;
  party.pizzas = {
    z1: { name: "Basil Instinct", by: "Nicole", uid: "nicole", createdAt: 1, picks: ["Tomato sauce", "Mozzarella", "Fresh basil"], votes: { nicole: "Nicole", damian: "Damian", brad: "Brad" } },
    z2: { name: "Hot Honey Situation", by: "Matt", uid: "matt", createdAt: 2, picks: ["Tomato sauce", "Mozzarella"], votes: { matt: "Matt", damian: "Damian" } },
    z3: { name: "Fungi Fiesta", by: "Brad", uid: "brad", createdAt: 3, picks: ["Mozzarella", "Mushrooms"], votes: { brad: "Brad", matt: "Matt" } },
  };
  await open(party, "nicole", "Nicole");
  const tally = () => js(`[...document.querySelectorAll("#tally li")].map((li) => li.classList.contains("tally-cut") ? "✂" : li.querySelector(".tally-name").textContent)`);
  assert.deepEqual(await tally(), ["Basil Instinct", "Hot Honey Situation", "✂", "Fungi Fiesta"], "ties go to whichever was proposed first");

  await fill("#pizza-name", "Mushroom Party");
  for (const name of ["Tomato sauce", "Mushrooms"]) {
    await js(`[...document.querySelectorAll("#builder label.chip")].find((l) => l.textContent.includes(${JSON.stringify(name)})).click(); true`);
  }
  await submit("#pizza-form");
  await until(`Object.values(JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].pizzas).some((p) => p.name === "Mushroom Party")`, "the new pizza saved");
  const made = Object.values((await saved()).pizzas).find((p) => p.name === "Mushroom Party");
  assert.deepEqual([made.uid, made.by, made.picks.sort()], ["nicole", "Nicole", ["Mushrooms", "Tomato sauce"]]);
  await until(`document.getElementById("pizzas").textContent.includes("Mushroom Party")`, "the new pizza on the table");
  assert.equal(await js(`document.getElementById("pizza-name").value`), "", "the builder resets");

  await js(`${cardOf("Fungi Fiesta")}.querySelector("[data-vote]").click(); true`);
  await until(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].pizzas.z3.votes.nicole`, "the vote saved");
  await until(`document.querySelector("#tally li.tally-cut + li .tally-name")?.textContent === "Hot Honey Situation"`, "Hot Honey dropping below the cut");
  assert.deepEqual((await tally()).slice(0, 3), ["Basil Instinct", "Fungi Fiesta", "✂"]);
  assert.deepEqual(await js(`[...document.querySelectorAll("#tally .tally-row")].map((r) => r.classList.contains("cut"))`), [false, false, true, true], "only the ones below the line are crossed off");
  assert.equal(await js(`(() => { const line = document.querySelector("#pizzas .cut-line");
    return line && [...document.querySelectorAll("#pizzas [data-vote]")].filter((b) => b.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).length; })()`), 2, "the line on the table sits under the top 2");
  assert.match(await text("#tally-lede"), /top 2 get made and 2 are cut/);

  await js(`${cardOf("Fungi Fiesta")}.querySelector("[data-vote]").click(); true`);
  await until(`!JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].pizzas.z3.votes?.nicole`, "the vote taken back");
});

check("the host picks a cohost, who can edit the party; guests can't", async () => {
  await open(basicParty(), "nicole", "Nicole");
  assert.ok(await visible("#edit-meta"), "the host sees Edit party");
  await click("#edit-meta");
  assert.ok(!(await visible("#edit-meta")), "Edit party hides while the form is open");
  assert.ok(await visible("#cohost-field"), "the host sees the cohost picker");
  assert.deepEqual(await js(`[...document.querySelectorAll("#cohost-chips label")].map((l) => l.textContent.trim())`), ["Damian", "Matt", "Brad"]);
  await click(`[data-cohost="damian"]`);
  await submit("#meta-form");
  await until(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].cohosts?.damian === true`, "Damian saved as cohost");
  await until(`document.querySelector('#people [data-key="damian"]').textContent.includes("cohost")`, "the cohost tag");
  assert.ok(await visible("#edit-meta"), "Edit party is back after saving");

  await open(null, "damian", "Damian");
  assert.ok(await visible("#edit-meta"), "the cohost sees Edit party");
  await click("#edit-meta");
  assert.ok(!(await visible("#cohost-field")), "only the host picks cohosts");
  await fill("#meta-goal", "3");
  await submit("#meta-form");
  await until(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].meta.pizzaGoal === 3`, "the cohost's goal saved");
  assert.equal((await saved()).meta.uid, "nicole", "the party is still Nicole's");

  await open(null, "matt", "Matt");
  assert.ok(!(await visible("#edit-meta")), "a guest doesn't see Edit party");
  assert.ok(!(await visible("#guest-btn")), "or the guest list");
});

check("after the party date it's a keepsake, and the host can reopen it", async () => {
  const party = basicParty();
  const yesterday = isoDay(-1);
  party.meta = { ...party.meta, date: yesterday, endsAt: endOf(yesterday) };
  party.pizzas = { z1: { name: "Basil Instinct", by: "Nicole", uid: "nicole", createdAt: 1, picks: ["Fresh basil"], votes: { nicole: "Nicole" } } };
  await open(party, "matt", "Matt");
  assert.ok(await visible("#party-over"), "guests see that it's over");
  assert.ok(!(await visible("#over-host")), "but not the reopen note");
  assert.ok(await js(`${cardOf("Basil Instinct")}.querySelector("[data-vote]").disabled`), "voting is off");
  const before = Object.keys((await saved()).items).length;
  await fill("#item-name", "Late pepperoni");
  await submit("#item-form");
  await sleep(300);
  assert.equal(Object.keys((await saved()).items).length, before, "nothing new gets added");

  await open(null, "nicole", "Nicole");
  assert.ok(await visible("#over-host"), "the host sees how to reopen it");
  await click("#reopen");
  await fill("#meta-date", isoDay(7));
  await submit("#meta-form");
  await until(`!document.getElementById("party-over").checkVisibility()`, "the party reopening");
  assert.ok((await saved()).meta.endsAt > Date.now(), "the new end is in the future");
});

check("parties saved by older versions still show up right", async () => {
  // Before picks and party dates: pizzas listed ingredient ids, and there's no date, goal or people
  await open({
    meta: { title: "Old Party", details: "Saturday", uid: "nicole", createdAt: 1 },
    items: { olditem: item("Basil", "topping", "Nicole", "nicole", { icon: "🌿" }), gone: item("Olives", "topping", "Matt", "matt") },
    pizzas: { oldpizza: { name: "Old Faithful", by: "Nicole", uid: "nicole", createdAt: 1, ingredients: ["olditem", "deleteditem"], votes: { nicole: "Nicole" } } },
  }, "brad", "Brad");
  await until(`document.getElementById("pizzas").textContent.includes("Old Faithful")`, "the old pizza");
  assert.match(await js(`${cardOf("Old Faithful")}.textContent`), /Basil/, "its ingredient names come from the ids");
  assert.ok(!(await visible("#party-date")), "no date shown");
  assert.match(await text("#tally-lede"), /hasn't set how many/);
});

check("✏️ edits a pizza's name, toppings and look; toppings lock for its maker once others vote", async () => {
  const party = basicParty();
  party.pizzas = { z1: { name: "Fungi Fiesta", by: "Brad", uid: "brad", createdAt: 1, picks: ["Mozzarella", "Mushrooms"], votes: { brad: "Brad", damian: "Damian" } } };
  await open(party, "brad", "Brad");
  const form = `#pizzas [data-pizza-form="z1"]`;
  await click(`#pizzas [data-edit-pizza="z1"]`);
  await until(`!!document.querySelector('${form}')`, "the pizza editor");
  assert.equal(await js(`!!document.querySelector('${form} [data-f="pick"]')`), false, "Damian voted, so Brad can't change toppings");
  assert.match(await text(`${form} .edit-note`), /only the host/);
  await fill(`${form} [data-f="name"]`, "Fungi Forever");
  await js(`document.querySelector('${form} [data-f="cheese"][value="lots"]').click(); true`);
  await submit(form);
  await until(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].pizzas.z1.name === "Fungi Forever"`, "the new name saved");
  const z1 = (await saved()).pizzas.z1;
  assert.equal(z1.look?.cheese, "lots");
  assert.deepEqual(z1.picks, ["Mozzarella", "Mushrooms"], "toppings untouched");

  // Brad renames what he's bringing: the pizza follows instead of crossing it out
  await click(`#items [data-edit-item="i3"]`);
  await fill(`#items [data-edit-form] [data-f="name"]`, "Wild mushrooms");
  await submit(`#items [data-edit-form]`);
  await until(`document.querySelector('#pizzas [data-key="z1"] .ings')?.textContent.includes("Wild mushrooms")`, "the renamed topping on the pizza");
  assert.equal(await js(`!!document.querySelector('#pizzas .ing.gone')`), false, "nothing crossed out");

  // The host can still change the toppings
  await open(null, "nicole", "Nicole");
  await click(`#pizzas [data-edit-pizza="z1"]`);
  await until(`!!document.querySelector('${form} [data-f="pick"]')`, "toppings in the host's editor");
  assert.deepEqual(await js(`[...document.querySelectorAll('${form} [data-f="pick"]:checked')].map((i) => i.value).sort()`), ["Mozzarella", "Wild mushrooms"]);
  await js(`document.querySelector('${form} [data-f="pick"][value="Fresh basil"]').click(); true`);
  await submit(form);
  await until(`(JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].pizzas.z1.picks || []).includes("Fresh basil")`, "the new toppings saved");
  assert.deepEqual((await saved()).pizzas.z1.picks.sort(), ["Fresh basil", "Mozzarella", "Wild mushrooms"]);
  assert.equal((await saved()).pizzas.z1.name, "Fungi Forever", "the name stays");
});

check("the host schedules party mode, and voting closes at the start time", async () => {
  const party = basicParty();
  party.pizzas = { z1: { name: "Basil Instinct", by: "Nicole", uid: "nicole", createdAt: 1, picks: ["Tomato sauce", "Mozzarella"], votes: { nicole: "Nicole" } } };
  await open(party, "nicole", "Nicole");
  await click("#edit-meta");
  await fill("#meta-date", "");
  assert.equal(await visible("#meta-night-time"), false, "party mode needs a date first");
  const day = isoDay(1);
  await fill("#meta-date", day);
  assert.equal(await visible("#meta-night-time"), true);
  await fill("#meta-night-time", "16:00");
  await fill("#meta-bake", "10");
  await fill("#meta-rotate", "5");
  await submit("#meta-form");
  await until(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].meta.nightTime === "16:00"`, "party mode saved");
  const [y, m, d] = day.split("-").map(Number);
  const meta = (await saved()).meta;
  assert.equal(meta.nightAt, new Date(y, m - 1, d, 16).getTime());
  assert.equal(meta.bakeMinutes, 10);
  assert.equal(meta.rotateMinutes, 5, "🔄 rotate halfway");
  await click("#edit-meta");
  assert.equal(await js(`document.getElementById("meta-rotate").value`), "5", "the form shows it next time");
  await fill("#meta-rotate", "");
  await submit("#meta-form");
  await until(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].meta.rotateMinutes === undefined`, "emptied: no turn");
  assert.match(await text("#party-date"), /Party mode starts at/);

  // Once it starts, voting and new pizzas stop; the tally stays
  const started = { ...party, meta: { ...meta, nightAt: Date.now() - 60000, date: isoDay(0), endsAt: endOf(isoDay(0)) } };
  await open(started, "matt", "Matt");
  assert.equal(await js(`[...document.querySelectorAll("#pizzas [data-vote]")].some((b) => !b.disabled)`), false, "no voting");
  assert.match(await text("#propose-section"), /Voting closed: it's party time/);
  assert.equal(await js(`!!document.querySelector("#propose-section #pizza-form:not([hidden])")`), false, "no pizza builder");
  assert.equal(await visible("#tally-section"), false, "planning folds away in party mode");
  await click("#planning-toggle");
  assert.equal(await visible("#tally-section"), true, "the tally is one tap away");

  // Before it starts, voting works
  const soon = { ...party, meta: { ...meta, nightAt: Date.now() + 60000, date: isoDay(0), endsAt: endOf(isoDay(0)) } };
  await open(soon, "matt", "Matt");
  await js(`document.querySelector("#pizzas [data-vote]").click(); true`);
  await until(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].pizzas.z1.votes.matt`, "a vote before party mode");
});

// A party happening today, with party mode `startsIn` ms from now
const nightParty = (startsIn, extra = {}) => {
  const party = basicParty();
  const today = isoDay(0);
  const at = new Date(Date.now() + startsIn);
  party.meta = { ...party.meta, date: today, endsAt: endOf(today), pizzaGoal: 2, nightTime: `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`, nightAt: Date.now() + startsIn, bakeMinutes: 1, ...extra };
  party.pizzas = {
    z1: { name: "Basil Instinct", by: "Nicole", uid: "nicole", createdAt: 1, picks: ["Tomato sauce", "Mozzarella", "Fresh basil"], votes: { nicole: "Nicole", damian: "Damian", brad: "Brad" } },
    z2: { name: "Fungi Fiesta", by: "Brad", uid: "brad", createdAt: 2, picks: ["Mozzarella", "Mushrooms", "Goat cheese"], votes: { brad: "Brad", matt: "Matt" } },
    z3: { name: "Hot Honey", by: "Matt", uid: "matt", createdAt: 3, picks: ["Tomato sauce"], votes: { matt: "Matt" } },
  };
  return party;
};

check("the host previews party mode and preps; guests get it at the start time", async () => {
  await open(nightParty(60 * 60000), "matt", "Matt");
  assert.equal(await visible("#preview-night"), false, "guests can't preview");
  assert.equal(await visible("#night-section"), false);

  await open(null, "nicole", "Nicole");
  await click("#preview-night");
  assert.equal(await visible("#night-section"), true);
  assert.match(await text("#night-banner"), /guests will see this at/);
  assert.equal(await visible("#planning-body"), false, "planning folds away");
  assert.equal(await visible("#planning-toggle"), true);

  // Game plan
  await click("#night-prep [data-edit-plan]");
  await fill("#night-prep [data-plan-form] textarea", "Oven to 500° at 6\nDamian on toppings");
  await submit("#night-prep [data-plan-form]");
  await until(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].night?.plan?.startsWith("Oven")`, "the plan saved");
  assert.equal(await js(`getComputedStyle(document.querySelector("#night-prep .plan-text")).whiteSpace`), "pre-line", "line breaks kept");

  // Prep note on the second pizza
  await click(`#night-prep [data-edit-note="z2"]`);
  await fill(`#night-prep [data-note-form="z2"] input`, "slice mushrooms thin");
  await submit(`#night-prep [data-note-form="z2"]`);
  await until(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].night?.notes?.z2 === "slice mushrooms thin"`, "the note saved");

  // Move the first pizza down: the order changes and only 2 get made
  await click(`#night-prep [data-move="z1:1"]`);
  await until(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].night?.order?.join() === "z2,z1,z3"`, "the new order");
  assert.deepEqual(await js(`[...document.querySelectorAll("#night-prep [data-making]")].map((li) => li.dataset.making)`), ["z2", "z1"]);

  // Prep list: counts, which pizzas, who's bringing it, and what nobody's bringing
  const row = (name) => `[...document.querySelectorAll("#night-prep [data-prep-row]")].find((r) => r.textContent.includes(${JSON.stringify(name)}))?.textContent.replace(/\\s+/g, " ")`;
  assert.match(await js(row("Mozzarella")), /2 pizzas.*Fungi Fiesta, Basil Instinct.*Matt/);
  assert.match(await js(row("Goat cheese")), /nobody's bringing this ⚠️/);

  await click("#night-banner [data-back-to-planning]");
  assert.equal(await visible("#night-section"), false);
  assert.equal(await visible("#planning-body"), true);

  // Start now
  await click("#preview-night");
  await js(`window.confirm = () => true; true`);
  await click("#night-banner [data-start-now]");
  await until(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].meta.nightAt <= Date.now()`, "party mode started");
  assert.match((await saved()).meta.nightTime, /^\d\d:\d\d$/);

  // A guest, now that it's started: tick prep, but no host controls
  await open(null, "matt", "Matt");
  assert.equal(await visible("#night-section"), true, "no preview needed");
  assert.match(await text("#night-banner h2"), /🥳\s*Party mode/);
  assert.match(await text("#night-banner .voting-lock"), /^🔒 Voting's closed\. Here's the plan for tonight\.$/);
  assert.equal(await js(`document.getElementById("night-banner").classList.contains("ticket")`), true, "its own card");
  assert.equal(await js(`!!document.querySelector("#night-prep [data-edit-plan], #night-prep [data-move], #night-prep [data-edit-note]")`), false, "host controls hidden");
  await js(`document.querySelector('#night-prep [data-prep="mozzarella"]').click(); true`);
  await until(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].night?.prep?.mozzarella === true`, "the tick saved");

  // Review Focus 2: the host moves party mode later, and it's back to planning (ticks kept)
  const later = await saved();
  later.meta.nightAt = Date.now() + 60 * 60000;
  await open(later, "matt", "Matt");
  assert.equal(await visible("#night-section"), false, "back to planning");
  assert.equal(await js(`[...document.querySelectorAll("#pizzas [data-vote]")].some((b) => !b.disabled)`), true, "voting reopens");
  assert.equal((await saved()).night.prep.mozzarella, true, "ticks kept");
});

check("oven: racks, a countdown, check it, +2 min, ready and stop", async () => {
  await open(nightParty(-60000), "matt", "Matt");
  const oven = () => js(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].night?.oven || {}`);
  const row = (id) => text(`#night-oven [data-oven="${id}"]`);
  assert.match(await text("#night-oven"), /Bake time: 1 min/);

  await click(`#night-oven [data-rack="z1:top"]`);
  await until(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].night?.oven?.z1?.rack === "top"`, "z1 on the top rack");
  assert.equal((await oven()).z1.minutes, 1, "uses the party's bake time");
  assert.equal(await js(`document.querySelector('#night-oven [data-rack="z2:top"]').disabled`), true, "the top rack is taken");
  assert.match(await text(`#night-oven [data-rack="z2:top"]`), /Basil Instinct/, "and says by what");
  assert.equal(await js(`document.querySelector('#night-oven [data-rack="z2:bottom"]').disabled`), false);
  assert.match(await text(`#night-oven [data-oven="z1"] .countdown`), /^[01]:\d\d$/, "counting down from 1:00");

  // Time's up: Check it! and a heads-up on every open phone
  await js(`window.__toasts = []; new MutationObserver(() => window.__toasts.push(document.getElementById("toast").textContent)).observe(document.getElementById("toast"), { childList: true, characterData: true, subtree: true }); localStorage.clockSkew = "61000"; true`);
  await until(`document.querySelector('#night-oven [data-oven="z1"]')?.textContent.includes("Check it! 👀")`, "check it", 4000);
  await until(`window.__toasts.some((t) => /check it/i.test(t) && t.includes("Basil Instinct"))`, "the check-it toast");

  await click(`#night-oven [data-plus="z1"]`);
  await until(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].night.oven.z1.minutes === 3`, "+2 min");
  await until(`!document.querySelector('#night-oven [data-oven="z1"]').textContent.includes("Check it")`, "baking again");
  await js(`localStorage.clockSkew = "181000"; true`);
  await until(`!!document.querySelector('#night-oven [data-ready="z1"]')`, "check it again after the extra 2 minutes", 4000);

  await click(`#night-oven [data-ready="z1"]`);
  await until(`typeof JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].night.oven.z1.readyAt === "number"`, "ready");
  assert.match(await row("z1"), /Ready 🍕 at/);
  assert.equal(await js(`document.querySelector('#night-oven [data-rack="z2:top"]').disabled`), false, "the rack is free again");
  await click(`#night-oven [data-undo="z1"]`);
  await until(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].night.oven.z1.readyAt === undefined`, "undo ready");
  await click(`#night-oven [data-ready="z1"]`);
  await until(`typeof JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].night.oven.z1.readyAt === "number"`, "ready again");

  await click(`#night-oven [data-rack="z2:bottom"]`);
  await until(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].night.oven.z2?.rack === "bottom"`, "z2 on the bottom");
  await click(`#night-oven [data-stop="z2"]`);
  await until(`!JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].night.oven.z2`, "stopped");

  // Review Focus 3: a pizza in the oven stays on screen even if the host moves it below the line
  await click(`#night-oven [data-rack="z2:top"]`);
  await until(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].night.oven.z2?.rack === "top"`, "z2 in");
  await open(null, "nicole", "Nicole");
  await click(`#night-prep [data-move="z2:1"]`);
  await until(`!document.querySelector('#night-prep [data-making="z2"]')`, "z2 below the line");
  assert.equal(await visible(`#night-oven [data-oven="z2"]`), true, "still in the oven list");
  await js(`delete localStorage.clockSkew; true`);
});

check("🔄 the timer stops at the rotate mark, waits while it's out, and the sound is off until you turn it on", async () => {
  await open(nightParty(-60000, { bakeMinutes: 2, rotateMinutes: 1 }), "matt", "Matt");
  // Counts the beeps: every chime makes oscillators
  await js(`window.__beeps = 0; const make = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () { window.__beeps++; return make.call(this); }; true`);
  const row = () => text(`#night-oven [data-oven="z1"]`);
  assert.match(await text("#night-oven"), /Rotate at 1 min/);
  assert.equal(await js(`document.querySelector("#night-oven [data-sound]").checked`), false, "sound starts off");

  await click(`#night-oven [data-rack="z1:top"]`);
  await until(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].night?.oven?.z1?.rotateAt === 1`, "the timer knows when to turn");
  assert.match(await row(), /🔄 in [01]:\d\d/);

  await watchToasts();
  await js(`localStorage.clockSkew = "61000"; true`);
  await until(`document.querySelector('#night-oven [data-oven="z1"]')?.textContent.includes("Rotate! 🔄")`, "rotate", 4000);
  await until(`window.__toasts.some((t) => /rotate/i.test(t) && t.includes("Basil Instinct"))`, "the rotate heads-up");
  assert.equal(await js(`window.__beeps`), 0, "no sound while it's off");
  assert.match(await text(`#night-oven [data-oven="z1"] .countdown`), /^1:00$/, "a minute still to go");
  assert.equal(await js(`document.querySelector('#night-oven [data-rack="z2:top"]').disabled`), true, "its rack stays taken while it's out");

  // Turning it takes a while: the clock waits
  await js(`localStorage.clockSkew = "150000"; true`);
  await sleep(1200);
  assert.match(await row(), /Rotate! 🔄/);
  assert.match(await text(`#night-oven [data-oven="z1"] .countdown`), /^1:00$/, "still a minute to go");

  await click(`#night-oven [data-sound]`);
  await until(`localStorage.ovenSound === "on"`, "sound on, on this phone");
  await until(`window.__beeps > 0`, "a beep to show it works");
  const beeps = await js(`window.__beeps`);

  await click(`#night-oven [data-back="z1"]`);
  await until(`typeof JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].night.oven.z1.backAt === "number"`, "back in the oven");
  await until(`/^[01]:\\d\\d$/.test(document.querySelector('#night-oven [data-oven="z1"] .countdown')?.textContent || "")`, "counting down the last minute");
  assert.doesNotMatch(await row(), /Rotate|🔄 in/);

  await js(`localStorage.clockSkew = "211000"; true`);
  await until(`document.querySelector('#night-oven [data-oven="z1"]')?.textContent.includes("Check it! 👀")`, "check it, a minute after it went back in", 4000);
  await until(`window.__beeps > ${beeps}`, "and it beeps now");

  await open(null, "matt", "Matt");
  assert.equal(await js(`document.querySelector("#night-oven [data-sound]").checked`), true, "sound stays on after a reload");
  await js(`delete localStorage.clockSkew; delete localStorage.ovenSound; true`);
});

check("rate ready pizzas, pick the most adventurous, and the keepsake shows the awards", async () => {
  const party = nightParty(-60 * 60000);
  const t = Date.now();
  party.night = { oven: {
    z1: { rack: "top", startedAt: t - 30 * 60000, minutes: 8, readyAt: t - 20 * 60000 },
    z2: { rack: "bottom", startedAt: t - 60000, minutes: 8 },
  } };
  await open(party, "matt", "Matt");
  const db = () => js(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"]`);
  assert.equal(await js(`document.querySelectorAll('#night-ratings [data-rate^="z1:"]').length`), 5, "five stars on the ready pizza");
  assert.equal(await js(`!!document.querySelector('#night-ratings [data-rate^="z2:"]')`), false, "nothing to rate until it's out");
  await click(`#night-ratings [data-rate="z1:4"]`);
  await until(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].ratings?.z1?.matt === 4`, "rated 4");
  await click(`#night-ratings [data-rate="z1:5"]`);
  await until(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].ratings?.z1?.matt === 5`, "changed to 5");
  await click(`#night-ratings [data-spicy="z1"]`);
  await until(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].adventurous?.matt === "z1"`, "picked 🌶️");

  await open(null, "brad", "Brad");
  await click(`#night-ratings [data-rate="z1:4"]`);
  await click(`#night-ratings [data-spicy="z1"]`);
  await until(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].adventurous?.brad === "z1"`, "brad's pick");
  await until(`document.querySelector("#night-ratings .awards")?.textContent.includes("Crowd favorite")`, "the awards");
  assert.match(await text("#night-ratings .awards"), /🏆 Crowd favorite.*Basil Instinct.*🌶️ Most adventurous.*Basil Instinct/);

  // The morning after: a keepsake with the awards, still open for ratings
  const after = await db();
  after.meta.endsAt = Date.now() - 60 * 60000;
  after.night.oven.z2.startedAt = Date.now() - 18 * 60000;
  after.night.oven.z2.readyAt = Date.now() - 10 * 60000; // came out after z1
  await open(after, "damian", "Damian");
  assert.equal(await visible("#night-section"), false, "no party mode once it's over");
  assert.equal(await visible("#keepsake"), true);
  assert.match(await text("#keepsake .awards"), /Crowd favorite.*Basil Instinct/);
  assert.deepEqual(await js(`[...document.querySelectorAll("#keepsake [data-made]")].map((li) => li.dataset.made)`), ["z1", "z2"], "in the order they came out");
  assert.match(await text(`#keepsake [data-made="z1"]`), /★ 4\.5 \(2\)/);
  await click(`#keepsake [data-rate="z1:3"]`);
  await until(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].ratings?.z1?.damian === 3`, "a rating the morning after");

  const late = await db();
  late.meta.endsAt = Date.now() - 25 * 60 * 60000;
  await open(late, "damian", "Damian");
  assert.equal(await visible("#keepsake"), true);
  assert.equal(await js(`!!document.querySelector("#keepsake [data-rate]")`), false, "ratings closed after a day");
});

check("review fixes: the server's clock decides when it's over; drafts, pizza edits and tilts behave", async () => {
  // A phone whose clock is an hour slow still knows the party ended at the server's midnight
  await open(nightParty(-60000, { endsAt: Date.now() + 30 * 60000 }), "matt", "Matt");
  await js(`localStorage.clockSkew = "3600000"; true`);
  await open(null, "matt", "Matt");
  assert.equal(await visible("#party-over"), true, "over by the server's clock");
  assert.equal(await visible("#night-section"), false);
  await js(`delete localStorage.clockSkew; true`);

  // A half-typed prep note doesn't jump to another pizza
  await open(nightParty(-60000), "nicole", "Nicole");
  await click(`#night-prep [data-edit-note="z1"]`);
  await fill(`#night-prep [data-note-form="z1"] input`, "half typed");
  await click(`#night-prep [data-edit-note="z2"]`);
  assert.equal(await js(`document.querySelector('#night-prep [data-note-form="z2"] input').value`), "", "z2's own (empty) note");

  // Once party mode starts, a pizza's maker can't delete it or change its toppings (the rules refuse it)
  await open(null, "matt", "Matt");
  await click("#planning-toggle");
  assert.equal(await js(`!!document.querySelector('#pizzas [data-del="pizza:z3"]')`), false, "no delete in party mode");
  await click(`#pizzas [data-edit-pizza="z3"]`);
  assert.equal(await js(`!!document.querySelector('#pizzas [data-pizza-form="z3"] [data-f="pick"]')`), false, "toppings locked");

  // Parties without party mode look exactly as before: every other section's icon tilts the other way
  await open(basicParty(), "matt", "Matt");
  await sleep(700);
  const tilt = (sel) => js(`getComputedStyle(document.querySelector(${JSON.stringify(sel)})).transform`);
  assert.equal(await tilt("#table-section .h-emoji"), await tilt("#diet-section .h-emoji"), "On the table tilts like the 2nd section");
});

check("party mode: hosts change the count, add a pizza for extra dough, and note prep list ingredients", async () => {
  const saved = (path) => js(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"]${path}`);
  await open(nightParty(-60000), "matt", "Matt");
  assert.equal(await js(`!!document.querySelector("#night-prep [data-count]")`), false, "guests don't change the count");
  assert.equal(await js(`!!document.querySelector("#night-prep [data-add-pizza]")`), false, "or add pizzas");
  assert.equal(await js(`!!document.querySelector("#night-prep [data-edit-ing]")`), false, "or write ingredient notes");
  assert.equal(await visible("#pizza-form"), false, "guests can't propose once it starts");

  await open(null, "nicole", "Nicole");
  // + brings the next pizza by votes onto the list; − takes the last one off
  assert.equal(await js(`document.querySelectorAll("#night-prep li[data-making]").length`), 2);
  await click(`#night-prep [data-count="1"]`);
  await until(`document.querySelectorAll("#night-prep li[data-making]").length === 3`, "the next pizza joins");
  assert.equal(await saved(".meta.pizzaGoal"), 3);
  assert.equal(await js(`document.querySelector('#night-prep [data-count="1"]').disabled`), true, "no more pizzas to add");
  await click(`#night-prep [data-count="-1"]`);
  await until(`document.querySelectorAll("#night-prep li[data-making]").length === 2`, "the last one comes off");

  // A note on a prep list ingredient
  await click(`#night-prep [data-edit-ing="mozzarella"]`);
  await fill(`#night-prep [data-ing-form="mozzarella"] input`, "Shred 2 cups");
  await submit(`#night-prep [data-ing-form="mozzarella"]`);
  await until(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].night?.ingNotes?.mozzarella === "Shred 2 cups"`, "the note saved");
  assert.match(await text(`#night-prep li[data-prep-row="mozzarella"]`), /Shred 2 cups/);

  // Extra dough: the host adds a pizza, and it goes on the end of the list
  await click("#night-prep [data-add-pizza]");
  assert.equal(await visible("#pizza-form"), true, "the builder opens for the host");
  await fill("#pizza-name", "Extra Dough");
  await js(`document.querySelector('#builder input[value="mozzarella"]').click(); true`);
  await submit("#pizza-form");
  await until(`[...document.querySelectorAll("#night-prep li[data-making] b")].map((b) => b.textContent).join("|") === "Basil Instinct|Fungi Fiesta|Extra Dough"`, "it joins the end of the making list");
  assert.equal(await saved(".meta.pizzaGoal"), 3, "the count goes up by one");
  const extra = await js(`Object.values(JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].pizzas).find((p) => p.name === "Extra Dough")`);
  assert.deepEqual(extra.votes, undefined, "no vote: voting's closed");
  assert.ok(await js(`!!document.querySelector('#night-oven li[data-oven] ') && [...document.querySelectorAll("#night-oven li[data-oven]")].some((li) => li.textContent.includes("Extra Dough"))`), "it gets an oven row");
});

check("party mode: hosts plan prep by day, add tasks like the dough, and tick them before the start", async () => {
  const saved = (path) => js(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"]${path}`);
  const groups = () => js(`[...document.querySelectorAll("#night-prep [data-prep-days]")].map((g) => g.dataset.prepDays + ":" + [...g.querySelectorAll("li b")].map((b) => b.textContent).join(","))`);
  await open(nightParty(60 * 60000), "nicole", "Nicole");
  await click("#preview-night");
  assert.equal(await js(`getComputedStyle(document.querySelector("#night-prep [data-task-form] select")).wordSpacing`), "0px", "the task's day picker reads normally, without wide gaps");
  // Everything starts on the day
  assert.deepEqual((await groups()).map((g) => g.split(":")[0]), ["0"]);
  assert.match(await text(`#night-prep [data-prep-days="0"] .prep-day-head`), /day of/);

  // Sauce the day before
  await js(`(() => { const s = document.querySelector('#night-prep select[data-prep-day="tomato_sauce"]'); s.value = "1"; s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  await until(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].night?.prepDay?.tomato_sauce === 1`, "the day saved");
  // The dough, two days before
  await fill("#night-prep [data-task-form] input", "Make the dough");
  await js(`document.querySelector("#night-prep [data-task-form] select").value = "2"; true`);
  await submit("#night-prep [data-task-form]");
  await until(`Object.values(JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].night?.tasks || {}).some((t) => t.text === "Make the dough" && t.days === 2)`, "the task saved");
  await until(`document.querySelectorAll("#night-prep [data-prep-days]").length === 3`, "three days");
  const g = await groups();
  assert.equal(g[0], "2:Make the dough", "earliest day first");
  assert.equal(g[1], "1:Tomato sauce");
  assert.match(g[2], /^0:/);
  assert.match(await text(`#night-prep [data-prep-days="2"] .prep-day-head`), /2 days before/);

  // The host ticks the dough off before party mode starts
  const taskId = await js(`Object.keys(JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].night.tasks)[0]`);
  assert.equal(await js(`document.querySelector('#night-prep input[data-prep="task_${taskId}"]').disabled`), false, "hosts tick early");
  await click(`#night-prep input[data-prep="task_${taskId}"]`);
  await until(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].night?.prep?.task_${taskId} === true`, "ticked");

  // Guests see the days once it starts, but don't plan them
  const party = await saved("");
  party.meta.nightAt = Date.now() - 60000;
  await js(`(() => { const d = JSON.parse(localStorage["pizza-demo"]); d.parties["${CODE}"] = ${JSON.stringify(party)}; localStorage["pizza-demo"] = JSON.stringify(d); return true; })()`);
  await open(null, "matt", "Matt");
  assert.equal((await groups()).length, 3);
  assert.equal(await js(`!!document.querySelector("#night-prep select[data-prep-day], #night-prep [data-task-form], #night-prep [data-del-task]")`), false, "no planning controls for guests");
  assert.equal(await js(`document.querySelector('#night-prep input[data-prep="task_${taskId}"]').checked`), true, "the dough shows as done");

  // The host removes a task
  await open(null, "nicole", "Nicole");
  await click(`#night-prep [data-del-task="${taskId}"]`);
  await until(`!document.querySelector('#night-prep [data-del-task="${taskId}"]')`, "the task is gone");
});

check("in the host preview, oven buttons look switched off and say why", async () => {
  // Timers left from earlier, then the start time moved later: the host is back in preview
  await open(nightParty(60 * 60000, {}), "nicole", "Nicole");
  await js(`(() => { const d = JSON.parse(localStorage["pizza-demo"]); d.parties["${CODE}"].night = { oven: { z1: { rack: "top", startedAt: Date.now() - 30 * 60000, minutes: 1 } } }; localStorage["pizza-demo"] = JSON.stringify(d); return true; })()`);
  await open(null, "nicole", "Nicole");
  await click("#preview-night");
  const ready = `#night-oven [data-ready="z1"]`;
  assert.equal(await js(`document.querySelector('${ready}').disabled`), true);
  assert.ok(Number(await js(`getComputedStyle(document.querySelector('${ready}')).opacity`)) < 0.7, "faded");
  assert.equal(await js(`getComputedStyle(document.querySelector('${ready}')).cursor`), "not-allowed");
  assert.match(await text("#night-oven .oven-locked"), /🔒 Preview: the oven opens at/);
});

check("party mode: hosts put the dough someone's bringing on the prep list, and pick its day", async () => {
  const party = nightParty(60 * 60000);
  party.items.dough1 = { name: "Dough", category: "other", by: "Damian", uid: "damian", amount: "Enough for all the pizzas", createdAt: 9 };
  party.items.water1 = { name: "Sparkling Water", category: "other", by: "Brad", uid: "brad", createdAt: 10 };
  await open(party, "nicole", "Nicole");
  await click("#preview-night");
  assert.equal(await js(`!!document.querySelector('#night-prep li[data-prep-row="dough"]')`), false, "not on the list by itself");
  const options = await js(`[...document.querySelectorAll("#night-prep [data-extra-form] option")].map((o) => o.value)`);
  assert.ok(options.includes("dough") && options.includes("sparkling_water"), "anything people bring can be added");
  assert.ok(!options.includes("mozzarella"), "but not what's already on the list");

  await js(`document.querySelector("#night-prep [data-extra-form] select").value = "dough"; true`);
  await submit("#night-prep [data-extra-form]");
  await until(`!!document.querySelector('#night-prep li[data-prep-row="dough"]')`, "the dough joins the prep list");
  assert.equal(await js(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].night.extra.dough`), true);
  assert.match(await text(`#night-prep li[data-prep-row="dough"]`), /Damian, Enough for all the pizzas/, "who's bringing it");
  assert.equal(await js(`!!document.querySelector('#night-prep li[data-prep-row="sparkling_water"]')`), false, "the drinks stay off");
  // Two days before
  await js(`(() => { const s = document.querySelector('#night-prep select[data-prep-day="dough"]'); s.value = "2"; s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  await until(`!!document.querySelector('#night-prep [data-prep-days="2"] li[data-prep-row="dough"]')`, "the dough moves to two days before");

  // Guests see it, but can't add or remove things
  const saved = await js(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"]`);
  saved.meta.nightAt = Date.now() - 60000;
  await js(`(() => { const d = JSON.parse(localStorage["pizza-demo"]); d.parties["${CODE}"] = ${JSON.stringify(saved)}; localStorage["pizza-demo"] = JSON.stringify(d); return true; })()`);
  await open(null, "matt", "Matt");
  assert.equal(await js(`!!document.querySelector('#night-prep li[data-prep-row="dough"]')`), true);
  assert.equal(await js(`!!document.querySelector("#night-prep [data-extra-form], #night-prep [data-del-extra]")`), false);

  // The host takes it off again
  await open(null, "nicole", "Nicole");
  await click(`#night-prep [data-del-extra="dough"]`);
  await until(`!document.querySelector('#night-prep li[data-prep-row="dough"]')`, "off the list");
});

check("party mode: hosts tag prep items, and everyone filters the prep list by tag", async () => {
  const saved = () => js(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].night?.prepTags || {}`);
  const rowsShown = () => js(`[...document.querySelectorAll("#night-prep li[data-prep-row]")].map((li) => li.dataset.prepRow).sort()`);
  await open(nightParty(60 * 60000), "nicole", "Nicole");
  await click("#preview-night");
  assert.equal(await js(`!!document.querySelector("#night-prep [data-filter]")`), false, "no filters until something's tagged");

  await click(`#night-prep [data-edit-tags="mushrooms"]`);
  await click(`#night-prep [data-tag="mushrooms:cut"]`);
  await until(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].night?.prepTags?.mushrooms?.cut === true`, "cut saved");
  await click(`#night-prep [data-tag="mushrooms:cook"]`);
  await until(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].night?.prepTags?.mushrooms?.cook === true`, "cook saved");
  assert.equal(await js(`document.querySelector('#night-prep [data-tag="mushrooms:cut"]').getAttribute("aria-pressed")`), "true");
  await click(`#night-prep [data-close-tags]`);
  assert.match(await text(`#night-prep li[data-prep-row="mushrooms"] .prep-tags`), /🔪 Cut.*🍳 Cook/);
  await click(`#night-prep [data-edit-tags="mozzarella"]`);
  await click(`#night-prep [data-tag="mozzarella:shred"]`);
  await until(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].night?.prepTags?.mozzarella?.shred === true`, "shred saved");
  await click(`#night-prep [data-close-tags]`);

  // Filters: only tags in use, with how many
  assert.match(await text(`#night-prep [data-filter="cut"]`), /🔪 Cut 1/);
  assert.equal(await js(`!!document.querySelector('#night-prep [data-filter="thaw"]')`), false, "unused tags don't show");
  const all = await rowsShown();
  await click(`#night-prep [data-filter="cut"]`);
  assert.deepEqual(await rowsShown(), ["mushrooms"]);
  await click(`#night-prep [data-filter="shred"]`);
  assert.deepEqual(await rowsShown(), ["mozzarella"]);
  await click(`#night-prep [data-filter="all"]`);
  assert.deepEqual(await rowsShown(), all);

  // Tapping a tag again takes it off
  await click(`#night-prep [data-edit-tags="mushrooms"]`);
  await click(`#night-prep [data-tag="mushrooms:cook"]`);
  await until(`!JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].night?.prepTags?.mushrooms?.cook`, "cook removed");
  assert.deepEqual(await saved(), { mushrooms: { cut: true }, mozzarella: { shred: true } });

  // Guests see tags and filter, but don't edit them
  const party = await js(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"]`);
  party.meta.nightAt = Date.now() - 60000;
  await js(`(() => { const d = JSON.parse(localStorage["pizza-demo"]); d.parties["${CODE}"] = ${JSON.stringify(party)}; localStorage["pizza-demo"] = JSON.stringify(d); return true; })()`);
  await open(null, "matt", "Matt");
  assert.equal(await js(`!!document.querySelector("#night-prep [data-edit-tags], #night-prep [data-tag]")`), false, "no tag editing for guests");
  await click(`#night-prep [data-filter="shred"]`);
  assert.deepEqual(await rowsShown(), ["mozzarella"]);
});

// ── Extra coverage ──
const watchToasts = () => js(`window.__toasts = []; new MutationObserver(() => window.__toasts.push(document.getElementById("toast").textContent))
  .observe(document.getElementById("toast"), { childList: true, characterData: true, subtree: true }); true`);
const db = () => js(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"]`);
// Saves a change the way another phone would, then tells this page, like a real update from a friend
const fromAnotherPhone = (fn) => js(`(() => { const d = JSON.parse(localStorage["pizza-demo"]); (${fn})(d.parties["${CODE}"]);
  localStorage["pizza-demo"] = JSON.stringify(d); dispatchEvent(new StorageEvent("storage", { key: "pizza-demo" })); return true; })()`);
const setWidth = (width) => send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: true });

check("nothing sticks out sideways on a phone, on any screen", async () => {
  // Anything wider than the screen, or poking out past its edge, gets named
  // Measured with the real fonts, like people see it
  const sticksOut = () => js(`document.fonts.ready.then(() => { const W = document.documentElement.clientWidth, out = [];
    if (document.documentElement.scrollWidth > W + 1) out.push("the page scrolls sideways (" + document.documentElement.scrollWidth + "px)");
    // Name the innermost culprits, not every box that holds them
    const bad = [...document.querySelectorAll("body *")].filter((el) => {
      if (!el.getClientRects().length || el.closest("[hidden]")) return false;
      const r = el.getBoundingClientRect();
      return r.width && (r.right > W + 1 || r.left < -1);
    });
    for (const el of bad.filter((el) => !bad.some((o) => o !== el && el.contains(o)))) {
      const r = el.getBoundingClientRect();
      out.push((el.id ? "#" + el.id : el.tagName.toLowerCase() + [...el.classList].map((c) => "." + c).join("")) + " in " + (el.closest("[id]")?.id || "?") + " " + Math.round(r.left) + "→" + Math.round(r.right));
    }
    return out.slice(0, 8); })`);
  const screens = [
    ["planning, with my list and an ingredient being edited", async () => {
      await open(basicParty(), "nicole", "Nicole");
      await click("#list-btn");
      await click(`#items [data-edit-item="i4"]`);
    }],
    ["the host's party mode preview, with tags and a prep note open", async () => {
      await open(nightParty(60 * 60000), "nicole", "Nicole");
      await click("#preview-night");
      await click(`#night-prep [data-edit-tags="mushrooms"]`);
      await click(`#night-prep [data-edit-ing="mozzarella"]`);
    }],
    ["a guest during party mode, with a pizza in the oven", async () => {
      const party = nightParty(-60000);
      party.night = { oven: { z1: { rack: "top", startedAt: Date.now(), minutes: 8 } } };
      await open(party, "matt", "Matt");
    }],
    ["the keepsake", async () => {
      const party = nightParty(-60 * 60000);
      party.meta.endsAt = Date.now() - 60000;
      party.night = { oven: { z1: { rack: "top", startedAt: Date.now() - 20 * 60000, minutes: 8, readyAt: Date.now() - 10 * 60000 } } };
      party.ratings = { z1: { matt: 5 } };
      await open(party, "matt", "Matt");
    }],
  ];
  try {
    for (const width of [390, 320]) {
      await setWidth(width);
      for (const [name, show] of screens) {
        await show();
        await sleep(150);
        assert.deepEqual(await sticksOut(), [], `${name}, ${width}px wide`);
      }
    }
  } finally {
    await setWidth(390);
  }
});

check("anything people type shows up as plain text everywhere, never as page code", async () => {
  const BAD = `<img src=x onerror="window.__xss=1">`;
  const party = nightParty(-60 * 60000);
  party.meta = { ...party.meta, title: "Party " + BAD, details: "At " + BAD, pizzaGoal: 4 };
  party.people.zed = { name: BAD, joinedAt: 5 };
  party.items.i5 = item(BAD, "topping", "Nicole", "nicole", { amount: BAD });
  party.pizzas.z4 = { name: BAD, by: BAD, uid: "zed", createdAt: 4, picks: [BAD, "Mozzarella"], votes: { zed: BAD } };
  party.diets = { d1: { note: BAD, by: BAD, uid: "zed", createdAt: 1 } };
  party.night = {
    plan: "Plan " + BAD,
    notes: { z4: BAD },
    tasks: { t1: { text: BAD, days: 0, createdAt: 1 } },
    ingNotes: { mozzarella: BAD },
    oven: { z4: { rack: "top", startedAt: Date.now() - 20 * 60000, minutes: 8, readyAt: Date.now() - 10 * 60000 } },
  };
  party.ratings = { z4: { matt: 5 } };
  party.adventurous = { matt: "z4" };
  const noCode = async (where) => {
    assert.equal(await js(`document.querySelectorAll('img[src="x"], [onerror]').length`), 0, `${where}: typed text turned into page code`);
    assert.equal(await js(`window.__xss`), undefined, where);
  };
  await open(party, "nicole", "Nicole");
  await click("#planning-toggle");
  await click("#list-btn");
  await noCode("party mode and planning");
  const page = await js(`document.body.textContent`);
  for (const spot of ["Party " + BAD, "At " + BAD, "Plan " + BAD]) assert.ok(page.includes(spot), `shows ${spot} as typed`);
  assert.ok(await js(`document.querySelector("#night-prep").textContent.includes(${JSON.stringify(BAD)})`), "the task and prep note show as typed");
  assert.ok(await js(`document.querySelector("#grocery").textContent.includes(${JSON.stringify(BAD)})`), "my list shows it as typed");
  assert.ok(await js(`document.querySelector("#diets").textContent.includes(${JSON.stringify(BAD)})`), "dietary needs show it as typed");

  const after = await db();
  after.meta.endsAt = Date.now() - 60000;
  await open(after, "nicole", "Nicole");
  await noCode("the keepsake");
  assert.ok(await js(`document.querySelector("#keepsake").textContent.includes(${JSON.stringify(BAD)})`), "the keepsake shows it as typed");
});

check("🛒 my list: just your things, ticks stay after a reload, and it copies", async () => {
  await open(basicParty(), "zoe", "Zoe");
  assert.equal(await visible("#list-btn"), false, "no list when you're not bringing anything");

  await open(basicParty(), "nicole", "Nicole");
  await fill("#item-name", "Pepperoni");
  await fill("#item-cat", "topping");
  await fill("#item-amount", "2 packs");
  await submit("#item-form");
  await until(`document.getElementById("list-btn").textContent.includes("2")`, "two things on my list");
  await click("#list-btn");
  const names = await js(`[...document.querySelectorAll("#grocery .g-name")].map((n) => n.textContent)`);
  assert.deepEqual(names, ["Fresh basil", "Pepperoni"], "only my things, not Damian's sauce or Matt's cheese");
  assert.equal(await text(`#grocery li:nth-child(2) .amt`), "2 packs");

  await click(`#grocery [data-got="i4"]`);
  await until(`document.getElementById("list-btn").textContent.includes("1")`, "one left");
  await open(null, "nicole", "Nicole");
  await click("#list-btn");
  assert.equal(await js(`document.querySelector('#grocery [data-got="i4"]').checked`), true, "the tick is still there after a reload");
  assert.equal((await db()).items.i4.got, undefined, "ticks only live in this browser, not the party");

  const pep = await js(`Object.entries(JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].items).find(([, i]) => i.name === "Pepperoni")[0]`);
  await click(`#grocery [data-got="${pep}"]`);
  await until(`document.getElementById("list-btn").textContent.includes("All set")`, "all set");

  await js(`Object.defineProperty(navigator.clipboard, "writeText", { value: async (t) => { window.__copied = t; } }); true`);
  await click("#grocery-copy");
  await until(`window.__copied`, "the list copied");
  assert.equal(await js(`window.__copied`), "🛒 Test Pizza Night\n✓ Fresh basil\n✓ Pepperoni (2 packs)");

  await open(null, "matt", "Matt");
  await click("#list-btn");
  assert.deepEqual(await js(`[...document.querySelectorAll("#grocery .g-name")].map((n) => n.textContent)`), ["Mozzarella"], "Matt sees only his");
  assert.equal(await js(`document.querySelector('#grocery input').checked`), false, "and not Nicole's ticks");
});

check("dietary needs: add one, see it, and only its writer deletes it", async () => {
  await open(basicParty(), "matt", "Matt");
  assert.match(await text("#diets"), /Nothing specified yet/);
  await fill("#diet-note", "Nut allergy");
  await submit("#diet-form");
  await until(`Object.values(JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].diets || {}).length === 1`, "the note saved");
  const [id, note] = Object.entries((await db()).diets)[0];
  assert.deepEqual([note.note, note.by, note.uid], ["Nut allergy", "Matt", "matt"]);
  await until(`document.getElementById("diets").textContent.includes("Nut allergy")`, "the note on the list");
  assert.match(await text("#diets"), /Matt.*Nut allergy/);
  assert.equal(await js(`document.getElementById("diet-note").value`), "", "the box clears");

  await open(null, "nicole", "Nicole");
  assert.equal(await js(`!!document.querySelector('#diets [data-del]')`), false, "others can't delete it");

  await open(null, "matt", "Matt");
  await click(`#diets [data-del="diet:${id}"]`);
  assert.match(await text("#diets"), /tap again to delete/, "one tap only asks");
  assert.equal(Object.keys((await db()).diets || {}).length, 1);
  await click(`#diets [data-del="diet:${id}"]`);
  await until(`!Object.keys(JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].diets || {}).length`, "deleted");
  await until(`document.getElementById("diets").textContent.includes("Nothing specified yet")`, "back to empty");

  const over = await db();
  over.meta.endsAt = Date.now() - 60000;
  await open(over, "matt", "Matt");
  assert.match(await text("#diets"), /No dietary needs were noted/);
});

check("🔒 invite-only: the host checks the emails and gets a heads-up before locking anyone out", async () => {
  await open(basicParty(), "matt", "Matt");
  assert.equal(await visible("#guest-btn"), false, "guests don't get the guest list");

  await open(null, "nicole", "Nicole");
  await watchToasts();
  await click("#guest-btn");
  assert.equal(await visible("#guest-panel"), true);
  await fill("#guest-emails", "matt at gmail");
  await click("#guest-save");
  await until(`window.__toasts.some((t) => t.includes("doesn't look like an email"))`, "a bad email caught");
  await fill("#guest-emails", "");
  await js(`document.getElementById("guest-only").checked = true; document.getElementById("guest-only").dispatchEvent(new Event("change")); true`);
  await click("#guest-save");
  await until(`window.__toasts.some((t) => t.includes("Add at least one guest email"))`, "an empty list caught");

  await fill("#guest-emails", "Damian@Gmail.com\nmatt.lee@gmail.com");
  await click("#guest-save");
  assert.equal(await visible("#guest-warn"), true, "a heads-up first");
  assert.match(await text("#guest-warn"), /3 people have already joined \(Damian, Matt, Brad\)/);
  assert.equal(await text("#guest-save"), "Yes, make it invite-only");
  assert.equal((await db()).meta.guestOnly, undefined, "nothing saved yet");

  await click("#guest-save");
  await until(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].meta.guestOnly === true`, "invite-only on");
  assert.deepEqual((await db()).guests, { "damian@gmail,com": "damian@gmail.com", "matt,lee@gmail,com": "matt.lee@gmail.com" }, "emails saved lowercase, the way sign-in checks them");
  await until(`!document.getElementById("invite-only").hidden`, "the 🔒 Invite-only note");
  assert.equal(await visible("#guest-panel"), false);

  // Turning it off doesn't need the heads-up
  await click("#guest-btn");
  await js(`document.getElementById("guest-only").checked = false; document.getElementById("guest-only").dispatchEvent(new Event("change")); true`);
  await click("#guest-save");
  await until(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].meta.guestOnly === undefined`, "invite-only off");
  assert.equal(await visible("#guest-warn"), false);
});

check("the tag filter goes back to All when its last item loses that tag", async () => {
  await open(nightParty(60 * 60000), "nicole", "Nicole");
  await click("#preview-night");
  const all = await js(`document.querySelectorAll("#night-prep li[data-prep-row]").length`);
  await click(`#night-prep [data-edit-tags="mushrooms"]`);
  await click(`#night-prep [data-tag="mushrooms:cut"]`);
  await until(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].night?.prepTags?.mushrooms?.cut`, "cut saved");
  await click(`#night-prep [data-close-tags]`);
  await click(`#night-prep [data-filter="cut"]`);
  assert.equal(await js(`document.querySelectorAll("#night-prep li[data-prep-row]").length`), 1);

  await click(`#night-prep [data-edit-tags="mushrooms"]`);
  await click(`#night-prep [data-tag="mushrooms:cut"]`);
  await until(`!JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].night?.prepTags?.mushrooms?.cut`, "cut removed");
  assert.equal(await js(`!!document.querySelector("#night-prep [data-filter]")`), false, "no filters left");
  assert.equal(await js(`document.querySelectorAll("#night-prep li[data-prep-row]").length`), all, "everything shows again");

  // ...and tagging something later starts on All, not the old filter
  await click(`#night-prep [data-tag="mushrooms:cook"]`);
  await until(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].night?.prepTags?.mushrooms?.cook`, "cook saved");
  assert.equal(await js(`document.querySelector('#night-prep [data-filter="all"]').getAttribute("aria-pressed")`), "true");
  assert.equal(await js(`document.querySelectorAll("#night-prep li[data-prep-row]").length`), all);
});

check("a busy oven rack can't take a second pizza, even if its button gets pressed", async () => {
  await open(nightParty(-60000), "matt", "Matt");
  await watchToasts();
  await click(`#night-oven [data-rack="z1:top"]`);
  await until(`JSON.parse(localStorage["pizza-demo"]).parties["${CODE}"].night?.oven?.z1?.rack === "top"`, "z1 on top");
  // Like a tap that lands just before the screen catches up
  await js(`const b = document.querySelector('#night-oven [data-rack="z2:top"]'); b.disabled = false; b.click(); true`);
  await until(`window.__toasts.some((t) => t.includes("The top rack is busy"))`, "the busy message");
  assert.equal((await db()).night.oven.z2, undefined, "z2 stays out");
  assert.equal((await db()).night.oven.z1.rack, "top", "z1 untouched");
});

check("when a friend changes something, what you're typing stays put", async () => {
  await open(basicParty(), "nicole", "Nicole");
  await fill("#item-name", "Garl");
  await fill("#pizza-name", "Half a ");
  await js(`[...document.querySelectorAll("#builder label.chip")].find((l) => l.textContent.includes("Mushrooms")).click(); true`);
  await js(`document.getElementById("pizza-name").focus(); document.getElementById("pizza-name").setSelectionRange(7, 7); true`);

  await fromAnotherPhone(`(p) => { p.items.i9 = { name: "Pineapple", category: "topping", by: "Brad", uid: "brad", createdAt: 9 };
    p.pizzas = { z1: { name: "Brad's Special", by: "Brad", uid: "brad", createdAt: 1, picks: ["Mushrooms"], votes: { brad: "Brad" } } }; }`);
  await until(`document.getElementById("items").textContent.includes("Pineapple")`, "Brad's pineapple shows up");
  await until(`document.getElementById("pizzas").textContent.includes("Brad's Special")`, "Brad's pizza shows up");
  assert.ok(await js(`[...document.querySelectorAll("#builder label.chip")].some((l) => l.textContent.includes("Pineapple"))`), "and you can pick it");
  assert.equal(await js(`document.getElementById("item-name").value`), "Garl");
  assert.equal(await js(`document.getElementById("pizza-name").value`), "Half a ");
  assert.equal(await js(`document.activeElement.id`), "pizza-name", "still typing in the same box");
  assert.equal(await js(`document.getElementById("pizza-name").selectionStart`), 7, "with the cursor where it was");
  assert.ok(await js(`[...document.querySelectorAll("#builder label.chip")].find((l) => l.textContent.includes("Mushrooms")).querySelector("input").checked`), "your ticked topping stays ticked");
});
