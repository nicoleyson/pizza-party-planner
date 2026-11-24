import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CODE_RE, SAFE_ID, parseCode, newCode, esc, cleanIds, voteCount, rankPizzas } from "../lib.js";

test("parseCode accepts a bare code, #code or a full invite link", () => {
  const code = "pepperoni-k3x9q2mf7a";
  assert.equal(parseCode(code), code);
  assert.equal(parseCode("#" + code), code);
  assert.equal(parseCode(`https://someone.github.io/pizza-party/#${code}`), code);
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
    ["a", { name: "Pepperoni", category: "topping", by: "Sam" }],
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
