// Party mode: the pure helpers in lib.js (start time, which pizzas get made, prep list, oven, awards).
import { test } from "node:test";
import assert from "node:assert/strict";
import { nightFields, isNight, bakeMinutes, makingList, prepKey, prepList } from "../lib.js";

test("nightFields turns a date and time into the party-mode start", () => {
  assert.deepEqual(nightFields("2026-12-05", "16:00", 10), { nightTime: "16:00", nightAt: new Date(2026, 11, 5, 16, 0).getTime(), bakeMinutes: 10 });
  assert.equal(nightFields("2026-12-05", "16:00", "").bakeMinutes, undefined, "no bake time typed");
  assert.equal(nightFields("2026-12-05", "16:00", 0).bakeMinutes, undefined, "bake time 0 is ignored");
  assert.equal(nightFields("2026-12-05", "16:00", 31).bakeMinutes, undefined, "bake time over 30 is ignored");
});

test("nightFields needs a real date and a real time", () => {
  assert.deepEqual(nightFields("", "16:00", 8), {}, "date cleared turns party mode off");
  assert.deepEqual(nightFields("2026-12-05", "25:00", ""), {});
  assert.deepEqual(nightFields("2026-12-05", "4pm", 8), {});
  assert.deepEqual(nightFields("2026-12-05", "", 8), {});
  assert.deepEqual(nightFields("2026-02-30", "16:00", 8), {});
});

test("isNight is on from the start time until the party is over", () => {
  const meta = { nightAt: 1000, endsAt: 5000 };
  assert.equal(isNight(meta, 999), false);
  assert.equal(isNight(meta, 1000), true);
  assert.equal(isNight(meta, 5000), false, "over");
  assert.equal(isNight({ endsAt: 5000 }, 2000), false, "no party mode");
});

test("bakeMinutes defaults to 8", () => {
  assert.equal(bakeMinutes({}), 8);
  assert.equal(bakeMinutes({ bakeMinutes: 12 }), 12);
  assert.equal(bakeMinutes({ bakeMinutes: 99 }), 8);
});

const pz = (name, votes, createdAt, picks = []) => ({ name, by: "x", uid: "x", createdAt, picks, votes: Object.fromEntries(Array.from({ length: votes }, (_, i) => [`v${i}`, "V"])) });

test("makingList takes the top pizzas, or the host's order", () => {
  const pizzas = { a: pz("A", 3, 1), b: pz("B", 2, 2), c: pz("C", 1, 3) };
  assert.deepEqual(makingList(pizzas, 2), ["a", "b"]);
  assert.deepEqual(makingList(pizzas, 2, ["c"]), ["c", "a"], "a moved pizza goes first, the rest by votes");
  assert.deepEqual(makingList(pizzas, 0), ["a", "b", "c"], "no goal: every pizza");
  assert.deepEqual(makingList(pizzas, 2, ["gone", "b"]), ["b", "a"], "deleted ids are skipped");
});

test("prepKey makes a safe database key", () => {
  assert.equal(prepKey("Roasted turkey!"), "roasted_turkey");
});

test("prepList says what to prep, for how many pizzas and which", () => {
  const pizzas = { A: pz("A", 2, 1, ["Mozzarella", "Smoked turkey"]), B: pz("B", 1, 2, ["mozzarella", "Basil"]) };
  const items = {
    m: { name: "Mozzarella", category: "cheese", by: "Matt", uid: "matt", amount: "1 lb" },
    t: { name: "Roasted turkey", category: "topping", by: "Nicole", uid: "nicole", aka: ["Smoked turkey"] },
  };
  const list = prepList(["A", "B"], pizzas, items);
  assert.deepEqual(list.map((g) => g.name), ["Mozzarella", "Basil", "Roasted turkey"], "cheese first, then toppings by name");
  const moz = list.find((g) => g.name === "Mozzarella");
  assert.deepEqual(moz.pizzas, ["A", "B"], "counted once per pizza, either spelling");
  assert.deepEqual(moz.bringers, [{ by: "Matt", amount: "1 lb" }]);
  assert.equal(moz.key, "mozzarella");
  assert.deepEqual(list.find((g) => g.name === "Roasted turkey").pizzas, ["A"], "the old name still finds it");
  const basil = list.find((g) => g.name === "Basil");
  assert.equal(basil.missing, true);
  assert.deepEqual(basil.bringers, []);
  assert.deepEqual(prepList(["B"], pizzas, items).map((g) => g.name), ["Mozzarella", "Basil"], "only pizzas being made");
  const twins = { A: pz("Margherita", 2, 1, ["Mozzarella"]), B: pz("Margherita", 1, 2, ["Mozzarella"]) };
  assert.deepEqual(prepList(["A", "B"], twins, items)[0].pizzas, ["Margherita", "Margherita"], "two pizzas with the same name count twice");
});
