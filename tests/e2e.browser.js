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
  chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
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
    await until(`document.readyState === "complete"`);
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
