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

test("ovenState: baking, check it, ready", async () => {
  const { ovenState } = await import("../lib.js");
  const e = { rack: "top", startedAt: 0, minutes: 8 };
  assert.deepEqual(ovenState(e, 60000), { state: "baking", secs: 420 });
  assert.deepEqual(ovenState(e, 59500), { state: "baking", secs: 421 }, "rounds the time left up");
  assert.deepEqual(ovenState(e, 480000), { state: "check", secs: 0 }, "exactly at zero");
  assert.deepEqual(ovenState(e, 520000), { state: "check", secs: 40 });
  assert.deepEqual(ovenState({ ...e, minutes: 10 }, 520000), { state: "baking", secs: 80 }, "+2 min after zero bakes again");
  assert.deepEqual(ovenState({ ...e, readyAt: 500000 }, 600000), { state: "ready", secs: 0 });
  assert.deepEqual(ovenState(undefined, 1), { state: "waiting", secs: 0 });
});

test("clock shows minutes and seconds", async () => {
  const { clock } = await import("../lib.js");
  assert.equal(clock(312), "5:12");
  assert.equal(clock(7), "0:07");
  assert.equal(clock(720), "12:00");
});

test("awards: crowd favorite and most adventurous", async () => {
  const { awards } = await import("../lib.js");
  const ready = (t) => ({ rack: "top", startedAt: 0, minutes: 8, readyAt: t });
  const oven = { P1: ready(1), P2: ready(2), P3: ready(3), P5: ready(5), P6: ready(6) };
  const pizzas = Object.fromEntries(["P1", "P2", "P3", "P4", "P5", "P6"].map((id) => [id, { name: id }]));
  const ratings = { P1: { a: 5, b: 4 }, P2: { a: 5, b: 5 }, P3: { a: 5 }, P4: { a: 5, b: 5 } };
  const r = awards(pizzas, oven, ratings, { a: "P1", b: "P1", c: "P2" });
  assert.equal(r.crowd, "P2");
  assert.equal(r.adventurous, "P1");
  assert.deepEqual(r.avg.P1, { avg: 4.5, n: 2 });
  assert.equal(r.avg.P4, undefined, "not out of the oven, so it doesn't count");
  // A tie on the average goes to more ratings, then to whichever came out first
  assert.equal(awards(pizzas, oven, { P5: { a: 5, b: 4 }, P6: { a: 5, b: 4, c: 4.5 } }, {}).crowd, "P5", "4.5 isn't a valid rating");
  assert.equal(awards(pizzas, oven, { P5: { a: 5, b: 4 }, P6: { a: 4, b: 5, c: 4, d: 5 } }, {}).crowd, "P6", "more ratings wins a tie");
  assert.equal(awards(pizzas, oven, { P6: { a: 5, b: 4 }, P5: { a: 4, b: 5 } }, {}).crowd, "P5", "then the earlier one");
  assert.equal(awards(pizzas, oven, { P1: { a: 7, b: 5 } }, {}).crowd, null, "7 is ignored, leaving one rating");
  assert.equal(awards(pizzas, oven, {}, { a: "P1" }).adventurous, null, "needs 2 picks");
  assert.equal(awards(pizzas, oven, {}, { a: "P6", b: "P6", c: "P5", d: "P5" }).adventurous, "P5", "a tie goes to the earlier one");
  assert.equal(awards(pizzas, oven, {}, { a: "P4", b: "P4" }).adventurous, null, "only ready pizzas");
});
