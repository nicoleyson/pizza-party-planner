import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CODE_RE, SAFE_ID, parseCode, newCode, esc, cleanIds, voteCount, rankPizzas, cohostIds } from "../lib.js";

test("parseCode accepts a bare code, #code or a full invite link", () => {
  const code = "pepperoni-k3x9q2mf7a";
  assert.equal(parseCode(code), code);
  assert.equal(parseCode("#" + code), code);
  assert.equal(parseCode(`https://someone.github.io/pizza-party-planner/#${code}`), code);
  assert.equal(parseCode(`  ${code.toUpperCase()}  `), code);
});

test("parseCode rejects junk", () => {
  for (const bad of ["", null, undefined, "short", "has spaces in it ok", "a".repeat(41), "../../etc/passwd", "evil<script>code"]) {
    assert.equal(parseCode(bad), null, `should reject ${bad}`);
  }
});

test("newCode makes valid, different codes", () => {
  const codes = new Set(Array.from({ length: 200 }, newCode));
  assert.equal(codes.size, 200);
  for (const c of codes) assert.ok(CODE_RE.test(c), c);
});

test("esc neutralises HTML", () => {
  assert.equal(esc(`<img src=x onerror="alert('hi')">&`), "&lt;img src=x onerror=&quot;alert(&#39;hi&#39;)&quot;&gt;&amp;");
  assert.equal(esc(null), "");
  assert.equal(esc(42), "42");
});

test("cleanIds drops unsafe keys and non-object values", () => {
  const out = cleanIds({
    good_1: { name: "Basil" },
    "bad id": { name: "x" },
    '"><img>': { name: "x" },
    str: "not an object",
    nil: null,
  });
  assert.deepEqual(Object.keys(out), ["good_1"]);
  assert.deepEqual(cleanIds(undefined), {});
});

test("rankPizzas puts most votes first, ties go to the earliest", () => {
  const ranked = rankPizzas({
    late: { createdAt: 3, votes: { a: "A", b: "B" } },
    early: { createdAt: 1, votes: { c: "C", d: "D" } },
    none: { createdAt: 0 },
    top: { createdAt: 5, votes: { a: "A", b: "B", c: "C" } },
  }).map(([id]) => id);
  assert.deepEqual(ranked, ["top", "early", "late", "none"]);
  assert.equal(voteCount({}), 0);
});

test("app and database rules use the same patterns", () => {
  const rules = readFileSync(new URL("../database.rules.json", import.meta.url), "utf8");
  JSON.parse(rules); // must be valid JSON to paste into Firebase
  assert.ok(rules.includes(CODE_RE.toString()), "party code pattern differs from database.rules.json");
  assert.ok(rules.includes(SAFE_ID.toString()), "id pattern differs from database.rules.json");
});

test("database rules allow every kind of thing the app saves, and nothing else", () => {
  const rules = JSON.parse(readFileSync(new URL("../database.rules.json", import.meta.url), "utf8"));
  const party = rules.rules.parties.$party;
  for (const node of ["meta", "items", "pizzas", "diets", "people", "guests"]) assert.ok(party[node], `rules are missing ${node}`);
  assert.equal(party.$other[".validate"], false);
  assert.equal(rules.rules.parties[".read"], false, "nobody should be able to list all parties");
  assert.match(party.diets.$id.note[".validate"], /<= 80/); // matches the input's maxlength
});

test("every write rule requires a signed-in user", () => {
  const rules = JSON.parse(readFileSync(new URL("../database.rules.json", import.meta.url), "utf8"));
  const writes = [];
  const walk = (node, path) => {
    for (const [k, v] of Object.entries(node)) {
      if (k === ".write") writes.push([path, v]);
      else if (v && typeof v === "object") walk(v, `${path}/${k}`);
    }
  };
  walk(rules.rules, "");
  assert.ok(writes.length > 5);
  for (const [path, rule] of writes) assert.ok(rule === false || rule.includes("auth != null"), `${path} allows writes without sign-in`);
});

test("only Google-signed-in people get in, and only the host sees the guest list", () => {
  const rules = JSON.parse(readFileSync(new URL("../database.rules.json", import.meta.url), "utf8"));
  const party = rules.rules.parties.$party;
  assert.equal(party[".read"], undefined, "no blanket read: each part is checked on its own");
  for (const node of ["meta", "items", "pizzas", "diets", "people"]) {
    assert.match(party[node][".read"], /sign_in_provider === 'google.com'/, `${node} must require Google`);
    assert.match(party[node][".read"], /guestOnly/, `${node} must respect invite-only`);
  }
  assert.match(party.guests[".read"], /meta'\)\.child\('uid'\)\.val\(\) === auth\.uid/, "guest list must be host-only");
  const stored = Object.keys(party.people.$uid).filter((k) => !k.startsWith(".") && k !== "$other");
  assert.deepEqual(stored.sort(), ["joinedAt", "name", "photo"], "the who's-coming list must only store name + photo");
  assert.equal(party.people.$uid.$other[".validate"], false);
});

test("ingredientKey treats small spelling differences as the same ingredient", async () => {
  const { ingredientKey } = await import("../lib.js");
  assert.equal(ingredientKey("  Pepperoni "), ingredientKey("pepperoni"));
  assert.equal(ingredientKey("Jalapeño"), ingredientKey("jalapeno"));
  assert.equal(ingredientKey("Hot-honey!"), ingredientKey("hot honey"));
  assert.notEqual(ingredientKey("Basil"), ingredientKey("Basil pesto"));
});

test("groupItems merges duplicates and keeps everyone who's bringing it", async () => {
  const { groupItems } = await import("../lib.js");
  const groups = groupItems([
    ["a", { name: "Pepperoni", category: "topping", by: "Matt" }],
    ["b", { name: "Basil", category: "topping", by: "Alex" }],
    ["c", { name: "pepperoni ", category: "topping", by: "Alex", icon: "🌶️" }],
  ]);
  assert.equal(groups.length, 2);
  const pep = groups.find((g) => g.name === "Pepperoni");
  assert.deepEqual(pep.entries.map(([id]) => id), ["a", "c"]);
  assert.equal(pep.icon, "🌶️"); // the first icon anyone picked
});

test("pizzas can store ingredient names (picks), kept short", () => {
  const rules = JSON.parse(readFileSync(new URL("../database.rules.json", import.meta.url), "utf8"));
  const pz = rules.rules.parties.$party.pizzas.$id;
  assert.match(pz.picks.$i[".validate"], /isString\(\)/);
  assert.match(pz.picks.$i[".validate"], /<= 60/); // matches the ingredient input's maxlength
});

test("only people on the hosts list can start a party, and party data needs a real party", () => {
  const rules = JSON.parse(readFileSync(new URL("../database.rules.json", import.meta.url), "utf8"));
  const { hosts, parties } = rules.rules;
  assert.equal(hosts.$key[".write"], false, "nobody can add themselves as a host from the site");
  assert.match(hosts.$key[".read"], /\$key === auth\.token\.email/, "people can only check their own hosts entry");
  assert.match(parties.$party.meta[".write"], /!data\.exists\(\) && newData\.child\('uid'\)\.val\(\) === auth\.uid && root\.child\('hosts'\)/, "new parties need a host");
  assert.match(parties.$party.meta[".write"], /newData\.child\('uid'\)\.val\(\) === data\.child\('uid'\)\.val\(\)/, "nobody can take over a party");
  assert.match(parties.$party.cohosts.$uid[".write"], /child\('meta'\)\.child\('uid'\)\.val\(\) === auth\.uid \|\| \(\$uid === auth\.uid && !newData\.exists\(\)\)/, "only the host picks cohosts; a cohost can only step down");
  for (const node of ["items", "pizzas", "diets", "people"]) {
    assert.match(parties.$party[node][".read"], /child\('meta'\)\.exists\(\)/, `${node} needs an existing party`);
    const write = parties.$party[node].$id?.[".write"] ?? parties.$party[node].$uid[".write"];
    assert.match(write, /child\('meta'\)\.exists\(\)/, `${node} writes need an existing party`);
  }
});

test("the deploy publishes every file the page loads", () => {
  const workflow = readFileSync(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");
  const copied = workflow.match(/cp (.+) _site\//)[1].split(/\s+/);
  const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  const used = new Set(["index.html", "config.js", "config.example.js"]);
  for (const m of read("index.html").matchAll(/(?:src|href)="([\w.-]+\.(?:js|css|svg))"/g)) used.add(m[1]);
  for (const m of read("style.css").matchAll(/url\("?([\w.-]+\.(?:svg|png|jpg|webp))"?\)/g)) used.add(m[1]);
  for (const m of read("app.js").matchAll(/from "\.\/([\w.-]+\.js)"/g)) used.add(m[1]);
  for (const f of used) assert.ok(copied.includes(f), `${f} isn't copied to the site in pages.yml`);
});

test("totalAmount adds up amounts that share a unit and names the vague ones", async () => {
  const { totalAmount } = await import("../lib.js");
  const e = (by, amount) => [by, { by, amount }];
  assert.equal(totalAmount([e("Matt", "2 cups"), e("Alex", "1 cup")]), "3 cups");
  assert.equal(totalAmount([e("Matt", "2 cups"), e("Alex", "1 Cups"), e("Nicole", "lots"), e("Damian", "some")]), "3 cups + lots (Nicole) + some (Damian)");
  assert.equal(totalAmount([e("Matt", "1/2 lb"), e("Alex", "1.5 lbs"), e("Jo", "2 bags")]), "2 lbs + 2 bags");
  assert.equal(totalAmount([e("Matt", "2"), e("Alex", "3"), e("Jo", "")]), "5");
  assert.equal(totalAmount([e("Matt", "1 box"), e("Alex", "2 boxes")]), "3 boxes");
  assert.equal(totalAmount([e("Matt", "1 bag"), e("Alex", "2 bag")]), "3 bags");
});

test("totalAmount stays quiet when there's nothing to add up", async () => {
  const { totalAmount } = await import("../lib.js");
  const e = (by, amount) => [by, { by, amount }];
  assert.equal(totalAmount([e("Matt", "2 cups"), e("Alex", "")]), "");
  assert.equal(totalAmount([e("Nicole", "lots"), e("Damian", "some")]), "");
  assert.equal(totalAmount([e("Matt", "2 cups"), e("Alex", "1 lb")]), "");
});

test("partyEndsAt: a party wraps up at midnight after its day", async () => {
  const { partyEndsAt } = await import("../lib.js");
  assert.equal(partyEndsAt("2026-12-05"), new Date(2026, 11, 6).getTime());
  assert.equal(partyEndsAt("2026-12-31"), new Date(2027, 0, 1).getTime());
  for (const bad of ["", null, undefined, "2026-13-01", "2026-02-30", "12/05/2026", "2026-12-5"]) assert.equal(partyEndsAt(bad), null, `${bad}`);
});

test("isOver: only parties with a date that has passed are over", async () => {
  const { isOver } = await import("../lib.js");
  assert.equal(isOver({}), false, "old parties without a date never lock");
  assert.equal(isOver(undefined), false);
  assert.equal(isOver({ endsAt: 1000 }, 999), false);
  assert.equal(isOver({ endsAt: 1000 }, 1000), true);
  assert.equal(isOver({ endsAt: "1000" }, 5000), false, "junk is ignored");
});

test("todayISO pads months and days", async () => {
  const { todayISO } = await import("../lib.js");
  assert.equal(todayISO(new Date(2026, 0, 7)), "2026-01-07");
});

test("once a party's date has passed, the rules lock everything but the host's settings", async () => {
  const { DATE_RE } = await import("../lib.js");
  const rules = JSON.parse(readFileSync(new URL("../database.rules.json", import.meta.url), "utf8"));
  const p = rules.rules.parties.$party;
  const lock = /!root\.child\('parties'\)\.child\(\$party\)\.child\('meta'\)\.child\('endsAt'\)\.exists\(\) \|\| now < /;
  const writes = {
    people: p.people.$uid, items: p.items.$id, diets: p.diets.$id, pizzas: p.pizzas.$id,
    "pizza name": p.pizzas.$id.name, votes: p.pizzas.$id.votes.$voter, "pizza look": p.pizzas.$id.look,
  };
  for (const [what, node] of Object.entries(writes)) assert.match(node[".write"], lock, `${what} must lock after the party`);
  assert.doesNotMatch(p.meta[".write"], /endsAt/, "the host must always be able to change the date to reopen");
  assert.ok(p.meta.date[".validate"].includes(DATE_RE.toString()), "date pattern differs from database.rules.json");
  assert.match(p.meta.endsAt[".validate"], /isNumber\(\)/);
});

test("?demo only switches to demo mode on your own computer", async () => {
  const { localDemo } = await import("../lib.js");
  assert.equal(localDemo({ hostname: "localhost", search: "?demo" }), true);
  assert.equal(localDemo({ hostname: "127.0.0.1", search: "?x=1&demo" }), true);
  assert.equal(localDemo({ hostname: "localhost", search: "" }), false);
  assert.equal(localDemo({ hostname: "nicoleyson.github.io", search: "?demo" }), false, "never on the live site");
  assert.equal(localDemo({ hostname: "localhost.evil.com", search: "?demo" }), false);
  assert.equal(localDemo(undefined), false);
});

test("dark mode hangs off data-theme, set by theme.js before the page draws", () => {
  const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(css, /:root\[data-theme="dark"\]/);
  const head = html.slice(0, html.indexOf("</head>"));
  assert.match(head, /<script src="theme\.js"><\/script>/, "theme.js must load in <head>, not as a deferred module");
  for (const c of ["light", "dark"]) assert.match(html, new RegExp(`data-theme-choice="${c}"`));
  assert.doesNotMatch(html, /data-theme-choice="auto"/, "no Auto: the site is light unless you pick Dark");
});

test("sauces and cheeses get a sensible icon when nobody picked one", async () => {
  const { guessIcon, ICONS, safeIcon } = await import("../pie.js");
  assert.equal(guessIcon("Garlic", "sauce"), "🧄");
  assert.equal(guessIcon("Red", "sauce"), "🍅");
  assert.equal(guessIcon("Basil pesto", "sauce"), "🌿");
  assert.equal(guessIcon("Cotija", "cheese"), "🧀");
  assert.equal(guessIcon("Paper plates", "topping"), "", "no known word in the name: the list shows ✨");
  assert.equal(safeIcon(guessIcon("Granny Smith apples", "topping")), "🍎");
  assert.equal(safeIcon("🇲🇽"), "🇲🇽");
  for (const [e] of ICONS) assert.ok(e.length <= 8, `${e} must fit the database's 8-character icon limit`);
});

test("toppings and extras get an icon from the picker's words when nobody picked one", async () => {
  const { guessIcon } = await import("../pie.js");
  const cases = {
    "Granny Smith apples": "🍎", "Green apples": "🍏", "Pineapple": "🍍", "Mushrooms": "🍄",
    "Cherries": "🍒", "Sweet potato": "🍠", "Potatoes": "🥔", "Jalapeños": "🌶️", "Fried eggs": "🍳",
    "Canadian bacon": "🥓", "Mexican chorizo": "🇲🇽", "Red onion": "🧅", "Hot honey": "🍯",
    "Watermelon": "🍉", "Paper plates": "", "Pepperoni": "🔴", "Spicy pepperoni": "🔴",
    "Fresh herbs": "🌿", "Herb mix": "🌿", "Parsley": "🌿", "Rosemary": "🌿", "Chives": "🌿", "Italian sausage": "🌭",
  };
  for (const [name, icon] of Object.entries(cases)) assert.equal(guessIcon(name, "topping"), icon, name);
  assert.equal(guessIcon("Sparkling water", "other"), "💧");
});

test("the host's pizza goal is a whole number from 1 to 50, or not set", async () => {
  const { pizzaGoal } = await import("../lib.js");
  assert.equal(pizzaGoal({ pizzaGoal: 4 }), 4);
  assert.equal(pizzaGoal({}), 0, "parties without a goal keep working");
  assert.equal(pizzaGoal(undefined), 0);
  for (const bad of [0, -1, 2.5, 51, "4", null]) assert.equal(pizzaGoal({ pizzaGoal: bad }), 0);
  const rules = JSON.parse(readFileSync(new URL("../database.rules.json", import.meta.url), "utf8"));
  const meta = rules.rules.parties.$party.meta;
  assert.match(meta.pizzaGoal[".validate"], /newData\.isNumber\(\)/, "the database has to accept pizzaGoal, or saving it fails");
});

test("cohostIds keeps only plain ids set to true", () => {
  assert.deepEqual(cohostIds({ abc123: true, "bad id": true, nope: "yes", off: false, "<x>": true }), ["abc123"]);
  assert.deepEqual(cohostIds(null), []);
});
