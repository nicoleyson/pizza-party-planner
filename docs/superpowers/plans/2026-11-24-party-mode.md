# Party Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An optional, host-scheduled party mode with a prep list, per-pizza oven timers, and ratings and awards that carry into the keepsake page.

**Architecture:** Pure logic (times, which pizzas get made, prep list, oven state, awards) goes in `lib.js` and is unit-tested. Party-mode UI lives in a new `night.js` module that `app.js` hands a small context to, so `app.js` (already ~1000 lines) doesn't grow much. New data goes under `parties/$party/night`, `ratings` and `adventurous`, with database rules that enforce the cutoffs.

**Tech Stack:** Plain ES modules, no build step; Firebase Realtime Database 10.12.2 from gstatic; `node --test`; Firebase emulator for rules; headless Chrome for browser tests.

**Spec:** `docs/superpowers/specs/2026-11-24-party-mode-design.md`

## Global Constraints

- Work on branch `claude/party-mode`, cut from the commit that adds this plan (`main` plus the design and plan docs). **Never push to `main` or merge**: the host tests it first. Pushing the branch is fine.
- No new dependencies, no build step, Firebase Spark plan only (no Cloud Functions).
- Parties without `meta.nightTime` must behave exactly as today. Every existing test keeps passing unchanged.
- Demo mode (`?demo`, `localDb()`) supports everything.
- Copy: "Party mode starts at", "Bake time (minutes)", "Preview party mode", "Start now", "Back to planning", "Game plan", "Prep", "Oven", "Ratings & awards", "got it ✓", "Top rack", "Bottom rack", "Stop", "+2 min", "Check it! 👀", "Ready 🍕", "Undo", "Keep screen on", "🏆 Crowd favorite", "🌶️ Most adventurous".
- Defaults and limits: bake time 8 minutes (1–30); oven `minutes` 1–60; plan ≤ 1000 chars; prep note ≤ 200 chars; rating integer 1–5; ratings/picks open until `endsAt + 86400000`; Crowd favorite needs ≥ 2 ratings; Most adventurous needs ≥ 2 picks.
- Follow existing patterns: `esc()` for all text into HTML, `morph()` for re-rendering lists, `data-*` attributes plus one delegated click/submit handler, `store.set/add` for writes.
- Never add AI attribution to commits.

## Review Focus

1. **A phone with a wrong clock.** Countdowns must use server-corrected time (`db.now()`), not `Date.now()`. Test: `ovenState` is only ever called with `ctx.now()`; Task 4 adds a `localDb` `now()` override the e2e test uses to shift the clock.
2. **The host moves the date or time after party mode started.** `nightAt` must be recomputed. If it moves into the future, the page goes back to planning and voting reopens, while oven entries and ticks are kept. Test in Task 1 (`nightFields`) and Task 5 (e2e).
3. **A pizza in the oven drops out of the "making" list** (the host moves it below the line). It must still show in the Oven section until it's stopped or ready. Test in Task 6.
4. **Two pizzas use the same ingredient under an old and a new name.** It counts as one ingredient used by 2 pizzas. Test in Task 1 (`prepList`).
5. **Date cleared while a time is set.** Party mode turns off (no `nightAt` without a date), and the form keeps the typed time. Test in Task 1 (`nightFields`).

---

### Task 1: Time, "making" and prep helpers

**Files:**
- Modify: `lib.js` (append)
- Test: `tests/lib.test.js` (append)

**Interfaces:**
- Consumes: `partyEndsAt`, `ingredientKey`, `ingredientIndex`, `groupItems`, `rankPizzas`, `pizzaGoal` (all in `lib.js`).
- Produces:
  - `BAKE_DEFAULT = 8`
  - `nightFields(date: string, time: string, bake: number|"") -> { nightTime?, nightAt?, bakeMinutes? }`. `nightAt` is the local timestamp of `time` on `date`, and only if `partyEndsAt(date)` is valid and `time` matches `/^([01]\d|2[0-3]):[0-5]\d$/`. `bakeMinutes` only if an integer 1–30.
  - `isNight(meta, now) -> boolean`: `typeof meta.nightAt === "number" && now >= meta.nightAt && !isOver(meta, now)`
  - `bakeMinutes(meta) -> number`: `meta.bakeMinutes` if valid, else 8.
  - `makingList(pizzas, goal: number, order: string[]|undefined) -> string[]`: ids. Start from `order` (dropping ids not in `pizzas`) then append the remaining pizzas in `rankPizzas` order. Take the first `goal`, or all if `goal` is 0.
  - `prepKey(name) -> string`: `ingredientKey(name).replace(/ /g, "_")`.
  - `prepList(makingIds, pizzas, items) -> [{ key, name, category, pizzas: string[] (pizza names, in making order), bringers: [{ by, amount }], missing: boolean }]`, sorted by category order `sauce, cheese, topping, other`, then name. Picks resolve through `ingredientIndex(groupItems(...))`. An unresolved pick becomes `{ missing: true, category: "topping", bringers: [] }`. Each pizza counts once per ingredient.

- [ ] **Step 1: Write the failing tests** in `tests/lib.test.js`:
  - `nightFields("2026-12-05", "16:00", 10)` deep-equals `{ nightTime: "16:00", nightAt: new Date(2026, 11, 5, 16, 0).getTime(), bakeMinutes: 10 }`.
  - `nightFields("", "16:00", 8)` → `{}`. `nightFields("2026-12-05", "25:00", "")` → `{}`. `nightFields("2026-12-05", "", 8)` → `{}`. `nightFields("2026-12-05", "16:00", 0)` has no `bakeMinutes`.
  - `isNight` false before `nightAt`, true at it, false once `endsAt` has passed, false with no `nightAt`.
  - `makingList`: three pizzas with votes 3/2/1 and goal 2 → `[top, second]`. With `order: [third]` and goal 2 → `[third, top]`. Goal 0 → all three. An `order` containing a deleted id is ignored.
  - `prepList`: pizzas A `["Mozzarella","Smoked turkey"]` and B `["mozzarella","Basil"]`, items Mozzarella (Matt, "1 lb"), Roasted turkey with `aka: ["Smoked turkey"]`. Expect Mozzarella `pizzas: ["A","B"]`, bringers `[{ by: "Matt", amount: "1 lb" }]`; Roasted turkey `pizzas: ["A"]`; Basil `missing: true`. Cheese comes before topping.
  - `prepKey("Roasted turkey!")` → `"roasted_turkey"`.
- [ ] **Step 2: Run them to see them fail.** Run: `npm test`. Expected: FAIL, the functions aren't exported.
- [ ] **Step 3: Implement the functions above in `lib.js`.**
- [ ] **Step 4: Run them to see them pass.** Run: `npm test`. Expected: all pass.
- [ ] **Step 5: Commit:** `git commit -am "Party mode helpers: start time, which pizzas get made, prep list"`

### Task 2: Oven state and awards helpers

**Files:**
- Modify: `lib.js` (append)
- Test: `tests/lib.test.js` (append)

**Interfaces:**
- Produces:
  - `ovenState(entry, now) -> { state: "waiting"|"baking"|"check"|"ready", secs: number }`. No entry → waiting (secs 0). `readyAt` set → ready. `now < startedAt + minutes*60000` → baking, with `secs` = whole seconds left (rounded up). Otherwise → check, with `secs` = whole seconds over (rounded down).
  - `clock(secs) -> string`: `"5:12"`, `"0:07"`, `"12:00"`.
  - `awards(pizzas, oven, ratings, adventurous) -> { crowd: id|null, adventurous: id|null, avg: { [id]: { avg, n } } }`. Only pizzas whose `oven[id].readyAt` exists count. Crowd favorite: highest average with n ≥ 2, ties → higher n, then earlier `readyAt`. Adventurous: most picks (count values of `adventurous`) with ≥ 2, ties → earlier `readyAt`. Ignore ratings that aren't integers 1–5.

- [ ] **Step 1: Write the failing tests:**
  - `ovenState({ rack: "top", startedAt: 0, minutes: 8 }, 60000)` → `{ state: "baking", secs: 420 }`. At `480000` → `{ state: "check", secs: 0 }`. At `520000` → `{ state: "check", secs: 40 }`. With `minutes: 10` at `520000` → baking, secs 80 (the +2 min case). With `readyAt` → ready. `undefined` → waiting.
  - `clock(312)` → `"5:12"`; `clock(7)` → `"0:07"`.
  - `awards`: P1 ratings `{a:5,b:4}`, P2 `{a:5,b:5}`, P3 `{a:5}` (only one rating), all ready → crowd P2. A tie at 4.5 with n 2 vs 3 → the one with 3. P4 not ready but rated 5,5 → ignored. Picks `{a:"P1", b:"P1", c:"P2"}` → adventurous P1. Picks `{a:"P1"}` → null. A rating of `7` is ignored.
- [ ] **Step 2: Run them to see them fail.** Run: `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement the functions above in `lib.js`.**
- [ ] **Step 4: Run them to see them pass.** Run: `npm test`. Expected: all pass.
- [ ] **Step 5: Commit:** `git commit -am "Party mode helpers: oven timer state and awards"`

### Task 3: Database rules

**Files:**
- Modify: `database.rules.json`
- Test: `tests/rules.emulator.test.js` (append one `test(...)` per bullet group below)

Shorthand used below (expand to the full strings in the JSON):
- `MEMBER` is the existing party-member clause, as at the start of `items.$id[".write"]`, from `$party.matches(...)` through the `guests ... exists())` group.
- `HOST` is `(root.child('parties').child($party).child('meta').child('uid').val() === auth.uid || root.child('parties').child($party).child('cohosts').child(auth.uid).val() === true)`.
- `OPEN` is the existing "not over" clause `(!…endsAt.exists() || now < …endsAt.val())`.
- `NIGHT` is `root.child('parties').child($party).child('meta').child('nightAt').exists() && now >= root.child('parties').child($party).child('meta').child('nightAt').val()`.
- `PRENIGHT` is `(!…meta.nightAt.exists() || now < …meta.nightAt.val())`.
- `WINDOW` is `(!…endsAt.exists() || now < …endsAt.val() + 86400000)`.

Changes:
- `meta`:
  - `nightTime`: string matching `/^([01][0-9]|2[0-3]):[0-5][0-9]$/`, with sibling `nightAt` a number.
  - `nightAt`: number, with siblings `date` and `nightTime` present.
  - `bakeMinutes`: number 1–30.
- `pizzas.$id[".write"]` gains `&& PRENIGHT`. This blocks new pizzas, deletes and creator rewrites after the start; the host's `picks`/`name`/`look` writes have their own rules and stay allowed. `pizzas.$id.votes.$voter[".write"]` gains `&& PRENIGHT`.
- New `night`:
  - `.read`: `MEMBER` plus `meta` exists.
  - `plan`: `.write` = `MEMBER && HOST && OPEN`; validate string ≤ 1000.
  - `order`: `.write` = `MEMBER && HOST && OPEN`; validate `hasChildren()`; `$i` must be a string matching the SAFE_ID regex.
  - `notes.$pizza`: `.write` = `MEMBER && HOST && OPEN`; validate string 1–200.
  - `prep.$ing`: `.write` = `MEMBER && NIGHT && OPEN && $ing.matches(/^[a-z0-9_]{1,60}$/)`; validate `newData.val() === true`.
  - `oven.$pizza`: `.write` = `MEMBER && NIGHT && OPEN && root…pizzas.$pizza.exists()`; validate `hasChildren(['rack','startedAt','minutes'])`. `rack` must be `top|bottom`, `startedAt` a number `<= now`, `minutes` a number 1–60, `readyAt` a number `<= now`, and `$other` is false.
  - `$other` is false.
- New `ratings`:
  - `.read`: as `night`.
  - `$pizza.$uid`: `.write` = `MEMBER && $uid === auth.uid && root…night.oven.$pizza.readyAt.exists() && WINDOW`; validate a number 1–5 with `newData.val() % 1 === 0`.
- New `adventurous`:
  - `.read`: as `night`.
  - `$uid`: `.write` = `MEMBER && $uid === auth.uid && WINDOW && (!newData.exists() || root…night.oven.child(newData.val()).child('readyAt').exists())`; validate a string matching the SAFE_ID regex.

- [ ] **Step 1: Write the failing emulator tests.** Seed a party `nightparty-abc1` with `meta` (date tomorrow, `endsAt`, `nightTime`, `nightAt` = 1 hour ago), pizza `np1` (guest's, ready in the oven), pizza `np2` (not in the oven), and cohost `cohost1`. Assert:
  - **Votes after `nightAt`:** a guest vote on `np2` is denied, as is a new pizza by a guest, and a guest deleting their own pizza. On the `[OLD]` party (no `nightAt`), a vote is allowed.
  - **Prep before the start:** the same party with `nightAt` 1 hour ahead allows votes and denies a prep tick.
  - **Plan, order and notes:** allowed for the host and cohost, denied for a guest. A plan of 1001 chars is denied.
  - **Prep ticks:** `night/prep/roasted_turkey` `true` is allowed for a guest. The key `Roasted Turkey` is denied, as is the value `"yes"`.
  - **Oven:** a guest's `{ rack:"top", startedAt: now-1000, minutes: 8 }` is allowed. `rack:"middle"` is denied, as are `startedAt` 1 minute in the future, `minutes: 61`, an extra field, and an entry for pizza `nope`.
  - **Ratings:** a guest rating 4 on ready `np1` is allowed, as is changing it to 5. A rating on `np2` is denied, as are a rating for someone else's uid, `6`, and `4.5`.
  - **Most adventurous:** a guest pick of `np1` is allowed; `np2` is denied.
  - **The ratings window:** a party whose `endsAt` is 1 hour ago still accepts a rating but refuses an oven write. One whose `endsAt` is 25 hours ago refuses the rating.
  - **Meta:** the host saving `nightTime` `"16:00"` with `nightAt` and `bakeMinutes: 8` is allowed. `nightTime` without `date` is denied, as are `"4pm"` and `bakeMinutes: 31`.
- [ ] **Step 2: Run them to see them fail.** Run: `npm run test:rules`. Expected: the new tests fail, the old ones pass.
- [ ] **Step 3: Edit `database.rules.json` as listed above.** Use a script that loads the JSON, builds the strings from the shorthand and writes it back with `indent=2`, so the long clauses aren't hand-typed.
- [ ] **Step 4: Run them to see them pass.** Run: `npm run test:rules`. Expected: all pass, including every old test.
- [ ] **Step 5: Commit:** `git commit -am "Rules for party mode: voting cutoff, prep, oven, ratings and picks"`

### Task 4: Settings, server time and the voting cutoff

**Files:**
- Modify: `index.html` (the new-party form and `#meta-form`: two fields after the date field), `app.js` (`firebaseDb`, `localDb`, `startParty` store/lock/watches, the new and edit save handlers, `render`, `renderPizzas`, `renderBuilder`), `style.css`
- Test: `tests/e2e.browser.js` (append)

**Interfaces:**
- Consumes: `nightFields`, `isNight`, `bakeMinutes`, `BAKE_DEFAULT` (Task 1).
- Produces, for Tasks 5–7:
  - `db.now() -> number`: Firebase uses `Date.now() + offset` from `.info/serverTimeOffset`. Demo uses `Date.now() + Number(localStorage.clockSkew || 0)` (the test hook).
  - `db.stamp() -> any`: Firebase `fb.serverTimestamp()`, demo `Date.now()`.
  - `state.night = { plan: string, order: string[], notes: {}, prep: {}, oven: {} }`, read raw from `night`. Keep only string `plan`, string ids in `order`, string notes, `true` prep values, and object oven entries with SAFE_ID keys.
  - `state.ratings = { [pizzaId]: { [uid]: number } }` (via `cleanIds`). `state.adventurous = { [uid]: pizzaId }`, keeping only string values with SAFE_ID keys and values.
  - The store's `locked(p)` allows paths starting with `ratings/` or `adventurous/` even when over.
  - `const night = () => isNight(state.meta, db.now())`, and `voting = () => !over() && !night()`.

- [ ] **Step 1: Write the failing e2e test** "the host schedules party mode; voting closes at the start time". Open `basicParty()` as host `nicole` and open Edit party. `#meta-night-time` and `#meta-bake` are hidden until a date is filled. Set the date to `isoDay(1)`, the time to `"16:00"` and the bake time to `10`, then save. The saved `meta` has `nightTime: "16:00"`, `bakeMinutes: 10` and `nightAt === new Date(y, m-1, d, 16).getTime()`. `#party-date` text contains "Party mode starts at". Then re-seed with `nightAt` set 1 minute ago: no `[data-vote]` button is enabled, `#propose-section` shows "Voting closed: it's party time" and has no form, and `#tally` still shows. Finally re-seed with `nightAt` set 1 minute ahead, and voting works.
- [ ] **Step 2: Run it to see it fail.** Run: `npm run test:e2e`. Expected: FAIL, `#meta-night-time` is missing.
- [ ] **Step 3: Implement.**
  - Fields `#new-night-time` / `#meta-night-time` (`type="time"`) and `#new-bake` / `#meta-bake` (`type="number" min=1 max=30`, placeholder 8), with the spec's labels, inside a wrapper hidden until the date input has a value.
  - Both save handlers spread `nightFields(date, time, bake)` next to `dateFields(date)`. The edit handler also strips the old `nightTime/nightAt/bakeMinutes` from `rest`.
  - `db.now/stamp`.
  - Watches for `night`, `ratings` and `adventurous`, with the sanitizing described above.
  - Lock exception.
  - `#party-date` appends " · 🔥 Party mode starts at {time, locale-formatted}. Voting closes then." when `nightAt` exists and `!night()`.
  - Vote buttons are disabled and the builder is replaced when `!voting()`.
  - Re-render at `nightAt` the way `scheduleWrapUp` does at `endsAt`.
- [ ] **Step 4: Run it to see it pass.** Run: `npm run test:e2e && npm test`. Expected: all pass.
- [ ] **Step 5: Commit:** `git commit -am "Party mode settings, server-corrected time, and voting closes at the start time"`

### Task 5: Party mode shell, host preview and Prep

**Files:**
- Create: `night.js`
- Modify: `index.html` (add `<section id="night-section" hidden>` before `#bring-section`, with `#night-banner`, `#night-prep`, `#night-oven`, `#night-ratings`, plus `<details id="planning">` wrapping the planning sections in party mode; my call: toggled by JS, not by moving DOM), `app.js` (import and wire up), `style.css`
- Test: `tests/e2e.browser.js` (append)

**Interfaces:**
- Consumes: Task 1 helpers, Task 4 `state.night`, `db.now`, `voting()`.
- Produces: `export function initNight(ctx) -> { render(): void, isShowing(): boolean }` in `night.js`, where `ctx = { $, esc, state, uid, store, now, stamp, canManage, over, night, myName, iconOf, toast, morph }`. `app.js` calls `nightUI.render()` at the end of `render()`, and folds the planning sections into `#planning` while `nightUI.isShowing()` is true. That's `night() || previewing`, where `previewing` is a host-only local flag that's never saved.

- [ ] **Step 1: Write the failing e2e test** "host previews party mode and preps; guests see it at the start time". Seed `nightAt` 1 hour ahead, `pizzaGoal: 2`, and three pizzas.
  - **As guest `matt`:** there is no `#preview-night` button and `#night-section` is hidden.
  - **As host:**
    - **Preview:** click `#preview-night`. The section shows, the banner contains "guests will see this at", and the planning sections sit inside a closed `#planning`.
    - **Game plan:** edit it to "Oven to 500° at 6" and save. `night.plan` is saved and shown with line breaks preserved.
    - **Prep notes:** set the note on the second pizza to "basil after baking". It's saved to `night/notes/<id>`.
    - **Order:** click ↓ on the first pizza. `night.order` equals `[second, first, third]`, and only the first two are listed as making.
    - **Prep list:** it shows "Mozzarella" with "2 pizzas". A pick nobody brings shows "nobody's bringing this ⚠️".
    - **Back to planning:** click it, and the section hides.
  - **Start now:** click `#start-now` and confirm (stub `confirm` to return true). `meta.nightAt <= Date.now()` and `nightTime` is updated.
  - **As guest at the start time:** the section shows without a preview. Tick Mozzarella and `night.prep.mozzarella === true`. There's no plan Edit button and no ↑ ↓.
- [ ] **Step 2: Run it to see it fail.** Run: `npm run test:e2e`. Expected: FAIL.
- [ ] **Step 3: Implement `night.js`: the banner, preview, Start now, Game plan, making list with ↑ ↓ and prep notes (host/cohost), and prep list with ticks.**
  - Start now sets `meta` via `nightFields(date, "HH:MM" of now, bakeMinutes)`.
  - Plan and notes edit inline, the way the pizza editor does (keep drafts across re-renders).
- [ ] **Step 4: Run it to see it pass.** Run: `npm run test:e2e && npm test`. Expected: all pass.
- [ ] **Step 5: Commit:** `git commit -am "Party mode: host preview, game plan, pizza order, prep notes and prep list"`

### Task 6: Oven

**Files:**
- Modify: `night.js`, `style.css`
- Test: `tests/e2e.browser.js` (append)

**Interfaces:**
- Consumes: `ovenState`, `clock`, `bakeMinutes` (Tasks 1–2); `ctx.stamp()`, `ctx.now()`.
- Produces: `night/oven/$id` writes:
  - start: `{ rack, startedAt: stamp(), minutes: bakeMinutes(meta) }`,
  - +2 min: `minutes + 2`, capped at 60,
  - Ready: `readyAt: stamp()`,
  - Undo: remove `readyAt`,
  - Stop: `null`.

- [ ] **Step 1: Write the failing e2e test** "oven: racks, countdown, check it, ready". Seed party mode started, bake time 1, two pizzas being made.
  - **Starting:** click Top rack on pizza A. `night.oven.A.rack === "top"`. On B, Top rack is disabled and labeled with A's name, while Bottom works.
  - **Countdown:** the row shows a countdown matching `/^0:\d\d$/`.
  - **Check it:** set `localStorage.clockSkew = 61000` and wait. The row shows "Check it! 👀", and a toast containing "check it" appeared.
  - **+2 min:** click it. `minutes === 3` and the row is baking again.
  - **Ready:** click Ready 🍕. `readyAt` is set, the row says "Ready at", and Top rack is free again for B.
  - **Stop:** Stop on B removes `night.oven.B`.
  - **Review Focus 3:** as host, move A below the line while it's in the oven. A still shows in the Oven section.
- [ ] **Step 2: Run it to see it fail.** Run: `npm run test:e2e`. Expected: FAIL.
- [ ] **Step 3: Implement the Oven section.**
  - The rows are the making list plus any pizza with an oven entry.
  - **Busy racks:** a rack counts as busy when another entry is in baking or check state on it.
  - **Ticking:** one `setInterval` of 1s re-renders only the countdown text while anything is baking or checking.
  - **Alarm:** fire once per pizza (remember ids in a Set) when a pizza crosses into check. Play a Web Audio chime (two short sine beeps, about 880 Hz), call `navigator.vibrate?.([200,100,200])`, and show a toast `"{name}: check it! 👀 ({rack} rack)"`.
  - **Keep screen on:** shown only if `"wakeLock" in navigator`. Re-request it on `visibilitychange`.
- [ ] **Step 4: Run it to see it pass.** Run: `npm run test:e2e && npm test`. Expected: all pass.
- [ ] **Step 5: Commit:** `git commit -am "Party mode: oven timers with racks, check-it alarm and keep screen on"`

### Task 7: Ratings, Most adventurous and the keepsake

**Files:**
- Modify: `night.js`, `app.js` (the keepsake view in `renderPizzas` once over), `style.css`
- Test: `tests/e2e.browser.js` (append)

**Interfaces:**
- Consumes: `awards` (Task 2), `state.ratings`, `state.adventurous`.
- Produces: writes to `ratings/$pizza/$uid` (1–5) and `adventurous/$uid` (pizza id, or `null` to take it back).

- [ ] **Step 1: Write the failing e2e test** "rate ready pizzas and pick the most adventurous; keepsake shows awards".
  - **During party mode:** A is ready and B is baking. A shows 5 star buttons and B shows none. As `matt`, tap 4 then 5 on A, and `ratings.A.matt === 5`. Tap 🌶️ on A, and `adventurous.matt === "A"`.
  - **As `brad`:** rate A 4 and pick 🌶️ A. `#night-ratings` shows "🏆 Crowd favorite" with A, and "🌶️ Most adventurous" with A.
  - **Keepsake:** re-seed with `endsAt` 1 hour ago. The pizzas section shows the awards at the top and the made pizzas in `readyAt` order with "★ 4.5 (2)". There are no oven buttons. Rating A as `damian` still saves.
  - **After the window:** re-seed with `endsAt` 25 hours ago. There are no star buttons.
- [ ] **Step 2: Run it to see it fail.** Run: `npm run test:e2e`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Ratings section:** on each ready pizza, stars (`data-rate="id:n"`) and a 🌶️ toggle (`data-spicy="id"`), with the average and count.
  - **Awards block:** at the top of the Ratings section.
  - **Keepsake (over, and any oven entry has `readyAt`):** an awards block plus a "What we made" list by `readyAt`, with ratings shown. Rating controls stay while `now < endsAt + 86400000`.
- [ ] **Step 4: Run it to see it pass.** Run: `npm run test:e2e && npm test`. Expected: all pass.
- [ ] **Step 5: Commit:** `git commit -am "Party mode: ratings, most adventurous picks, and awards on the keepsake"`

### Task 8: Full check and hand-off for testing

**Files:** none new.

- [ ] **Step 1: Run every suite.** Run: `npm test && npm run test:rules && npm run test:e2e`. Expected: all pass, with 0 skipped in rules and e2e.
- [ ] **Step 2: Walk the whole night in the browser pane** (demo mode, `python3 -m http.server 8765`, `?demo`). Check the host preview and Start now, the prep ticks, two pizzas on both racks, Check it!, Ready, ratings, then the keepsake (set the date to yesterday). Check it at phone width (375px) and in dark mode.
- [ ] **Step 3: Update the graph:** `graphify update .`
- [ ] **Step 4: Push the branch only:** `git push -u origin claude/party-mode`. Do **not** push to `main`.
- [ ] **Step 5: Tell the host how to test.** Give them:
  - **Demo mode:** run the server command and open `http://localhost:8765/?demo`.
  - **Real data:** paste the new `database.rules.json` into Firebase first. The new rules only add things and only restrict parties that have a party-mode time, so it's safe to publish before merging. Then run the same server with their `config.js`.
  - **The merge:** waits for their go-ahead.
