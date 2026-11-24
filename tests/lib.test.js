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
  for (const node of ["meta", "items", "pizzas", "diets"]) assert.ok(party[node], `rules are missing ${node}`);
  assert.equal(party.$other[".validate"], false);
  assert.equal(rules.rules.parties[".read"], false, "nobody should be able to list all parties");
  assert.match(party.diets.$id.note[".validate"], /<= 80/); // matches the input's maxlength
});
