import { test } from "node:test";
import assert from "node:assert/strict";
import { toppingColor, sauceColor, safeIcon, pieHTML, ICONS } from "../pie.js";

test("weird sauces get their own colors", () => {
  assert.equal(sauceColor("Vodka sauce"), "#e8735a");
  assert.equal(sauceColor("Cranberry sauce"), "#9b1b30");
  assert.equal(sauceColor("Pesto"), "#7da443");
  assert.equal(sauceColor("Garlic white sauce"), "#f6ecd6");
  assert.equal(sauceColor("Marinara"), "#d9472b"); // plain tomato
});

test("toppings match whole words only", () => {
  assert.equal(toppingColor("Ham"), "#f0a99a");
  assert.notEqual(toppingColor("Graham crackers"), "#f0a99a");
  assert.equal(toppingColor("Olive oil"), "#d8b740"); // oil beats olive
  assert.equal(toppingColor("Kalamata olives"), "#3a2f2b");
  assert.equal(toppingColor("Jalapeños"), "#5cb85c"); // accents are ignored
});

test("unknown toppings get a stable color", () => {
  assert.equal(toppingColor("Gummy bears"), toppingColor("gummy bears"));
  assert.match(toppingColor("Gummy bears"), /^#[0-9a-f]{6}$/);
});

test("safeIcon only allows icons from the list", () => {
  assert.equal(safeIcon(ICONS[0][0]), ICONS[0][0]);
  assert.equal(safeIcon("<script>"), "");
  assert.equal(safeIcon("💣"), "");
  assert.equal(safeIcon(undefined), "");
});

test("pieHTML draws sauce, cheese and toppings", () => {
  const html = pieHTML([
    { category: "sauce", name: "Vodka sauce" },
    { category: "sauce", name: "Pesto" },
    { category: "cheese", name: "Mozzarella" },
    { category: "topping", name: "Pepperoni" },
    { category: "topping", name: "Turkey", icon: "🍗" },
  ]);
  assert.match(html, /--sauce:#e8735a;--sauce2:#7da443/); // half and half
  assert.match(html, /class="cheese"/);
  assert.equal((html.match(/class="top/g) || []).length, 10); // at least 10 dots
  assert.match(html, /🍗/);
});

test("pieHTML ignores icons that aren't on the list", () => {
  const html = pieHTML([{ category: "topping", name: "x", icon: '"><img src=x onerror=alert(1)>' }]);
  assert.doesNotMatch(html, /<img/);
});

test("plain dough still draws", () => {
  const html = pieHTML([]);
  assert.match(html, /class="pie"/);
  assert.doesNotMatch(html, /class="top/);
});

test("icon list has no duplicates and every icon fits the database limit", () => {
  const emojis = ICONS.map(([e]) => e);
  assert.equal(new Set(emojis).size, emojis.length, "duplicate icon");
  for (const e of emojis) assert.ok(e.length <= 8, `${e} is too long for the rules (max 8)`);
  for (const e of ["🍓", "🫐", "🍒", "🍇", "🥒", "🦑"]) assert.equal(safeIcon(e), e);
});

test("berries and other new foods get sensible auto colors", () => {
  assert.equal(toppingColor("Blueberries"), "#4b3f8f");
  assert.equal(toppingColor("Raspberries"), "#d63a4f");
  assert.equal(toppingColor("Dill pickles"), "#8fae3a");
  assert.equal(toppingColor("Grapes"), "#7d3c98");
});

test("a picked sauce color and cheese level override the guess", () => {
  const items = [{ category: "sauce", name: "Marinara" }, { category: "cheese", name: "Mozz" }];
  assert.match(pieHTML(items, { sauce: "pesto" }), /--sauce:#7da443;--sauce2:#7da443/);
  assert.doesNotMatch(pieHTML(items, { cheese: "none" }), /class="cheese/);
  assert.match(pieHTML([], { cheese: "lots" }), /class="cheese lots"/);
  assert.match(pieHTML(items, { sauce: "made-up", cheese: "made-up" }), /--sauce:#d9472b/); // junk falls back to auto
  assert.match(pieHTML(items, { sauce: "made-up", cheese: "made-up" }), /class="cheese"/);
});

test("look options match what the database rules allow", async () => {
  const { readFileSync } = await import("node:fs");
  const { SAUCE_LOOKS, CHEESE_LOOKS } = await import("../pie.js");
  const rules = JSON.parse(readFileSync(new URL("../database.rules.json", import.meta.url), "utf8"));
  const look = rules.rules.parties.$party.pizzas.$id.look;
  const allowed = (v) => v.match(/\^\(([^)]+)\)\$/)[1].split("|").sort();
  assert.deepEqual(allowed(look.sauce[".validate"]), SAUCE_LOOKS.map(([k]) => k).filter((k) => k !== "auto").sort());
  assert.deepEqual(allowed(look.cheese[".validate"]), CHEESE_LOOKS.map(([k]) => k).filter((k) => k !== "auto").sort());
});
