# Party mode: prep, oven timers, ratings and awards

Date: 2026-11-24
Status: draft, waiting for approval

## Why

Today the site is for planning: who brings what, which pizzas to make, voting. On the night itself it goes quiet, and the kitchen runs on shouting. The host wants the site to run the night too:

- one shared plan everyone can read ("oven to 500° at 6, Damian on toppings"),
- a prep list that says what has to be prepped, for how many pizzas, and for which ones,
- a timer per pizza so everyone knows what's in the oven, on which rack, and when to come back to the kitchen,
- and afterwards, ratings and a few awards on the keepsake page.

## Goals

- **Optional.** A party without a party-mode time works exactly as it does today.
- **Host-scheduled.** The host picks when party mode starts (on the party's date), ahead of time, because ingredient prep starts before the party. It can be set when making the party or later in Edit party.
- **Host preview.** Before the start time, the host and cohosts can open party mode to see it and write notes. Guests can't.
- **Automatic.** At the start time everyone's page switches to party mode. At the end of the day it becomes the keepsake on its own, as today. Nobody has to press anything.
- **Live.** Every open phone sees the same prep ticks, oven state and countdowns within a second or so.

## Non-goals

- Push notifications, emails or texts. A phone only updates and chimes while the page is open. (Reminders were considered and set aside.)
- More than one oven, or racks other than Top and Bottom.
- Per-pizza bake times. One bake time for the whole party, plus "+2 min" on the spot.
- Photos.

## Anti-goals (would make it a failure even if it works)

- A late vote reshuffling the queue or the prep list mid-prep.
- Timers that drift between phones, or reset when someone reloads.
- Two pizzas sent to the same rack.
- Breaking or cluttering parties that don't use party mode, or older parties already in the database.

## Constraints

- Plain HTML/CSS/JS, no build step, GitHub Pages + Firebase Realtime Database on the free Spark plan. No servers, no Cloud Functions.
- Every rule lives in `database.rules.json`, and the database must enforce the important ones (voting cutoff, ratings window, who can edit the plan), not just the page. The host has to paste new rules into the Firebase console after deploy.
- Today a party is **over** from midnight after its date (`meta.endsAt`), and from then on the database refuses every write except the host's settings. Ratings need a narrow exception to that.
- Demo mode (`?demo`, `localDb()`) must support everything, since the browser tests run there.

## Approaches considered

1. **Everything at once, page split into three sections (chosen).** Settings, preview, prep, oven, ratings and awards ship together. Party mode is organized into three sections that match how the night goes: **Prep**, **Oven**, **Ratings & awards**. The host wanted to see the whole thing together and adjust from there.
2. Three separate releases (prep, then oven, then ratings). Each usable on its own and easier to try at a real party, but a longer wait to see the whole night. Not chosen.

Within the chosen approach, two parts of the how have one sensible answer:

- **Timers store a start time and a length, never a ticking value.** Each phone counts down on its own from `startedAt + minutes`. In Firebase mode `startedAt` is the server's time (`serverTimestamp()`), and phones correct their clock with `.info/serverTimeOffset`, so they agree to within about a second and a reload mid-bake shows the right time left.
- **The database enforces the cutoffs**, using the rules' `now`: votes stop at the party-mode start time; ratings are allowed from when a pizza is marked ready until the end of the day after the party.

## What it looks like

### Settings (new-party form and Edit party)

Two new optional fields, shown only once a party date is set:

```
Party date            [ 2026-12-05 ]
Party mode starts at  [ 16:00 ]   (optional: prep time, voting closes then)
Bake time (minutes)   [ 8 ]       (optional: default 8)
```

Saved on `meta` next to `date`/`endsAt`, following the same pattern:

- `nightTime`: `"HH:MM"` as typed, and
- `nightAt`: the matching timestamp on the party's date in the host's time zone (like `endsAt`). Recomputed whenever the date or time changes, so reopening a party by moving its date moves party mode too.
- `bakeMinutes`: whole number 1–30. Missing means 8.

Clearing the time turns party mode off for that party.

Under the date on the party card, everyone sees a line once a time is set: "🔥 Party mode starts at 4:00 PM. Voting closes then."

### Host preview

Before `nightAt`, the host and cohosts see a **"Preview party mode"** button in the party card. It shows party mode exactly as it will look (not saved anywhere, just a local view switch), with a banner: "Preview: guests will see this at 4:00 PM. [Start now] [Back to planning]". **Start now** sets the time to now (after a confirm), for when prep starts early.

### Party mode

From `nightAt` until the end of the party, the page shows party mode instead of the planning sections. My call: the planning sections (bringing, notes, builder, tally) stay reachable but collapsed under a "Planning" link at the bottom, so someone can still check who's bringing what.

#### 1. Prep

- **Game plan.** The host's notes, at the top for everyone. Host and cohosts see an Edit button. Up to 1000 characters, line breaks kept.
- **Pizzas we're making**, in order. These are the top pizzas by votes (`pizzaGoal` of them; all of them if the host never set a goal). Voting is closed, so the order only changes when the host or a cohost moves a pizza up or down (↑ ↓ buttons). Moving a pizza across the line changes which get made, and the prep list follows. Each pizza shows its toppings and an optional **prep note** ("slice mushrooms thin", "basil after baking") that the host or cohosts can add.
- **Prep list.** Every ingredient used by the pizzas being made, grouped by type (sauce, cheese, toppings), with:
  - how many pizzas need it and which ones,
  - who's bringing it and how much,
  - a **got it ✓** tick anyone can set or clear, shared live.

```
🧀 Cheese
  [✓] Mozzarella      3 pizzas: Margherita, Fungi Fiesta, Turkey time
                      Matt, 1 lb
  [ ] Goat cheese     1 pizza: Hot Honey Situation
                      nobody's bringing this ⚠️
```

Ingredient lookup uses `ingredientIndex()`, so renamed ingredients still count. A topping nobody brings any more shows with ⚠️, so it gets noticed before the night.

#### 2. Oven

Each pizza being made has an oven row. Its states:

| State | Shows | Buttons |
|---|---|---|
| Waiting | "Up next" | **Top rack** / **Bottom rack** (a busy rack is disabled and labeled with what's on it) |
| In the oven 🔥 | rack, live countdown `5:12` | **Stop** (back to waiting, timer cleared), **+2 min** |
| Check it! 👀 | countdown reached zero, counting up how long over `+0:40` | **Ready 🍕**, **+2 min**, **Stop** |
| Ready 🍕 | "Ready at 7:42 PM" | **Undo** (back to Check it!) |

Anyone at the party can run the oven: whoever is in the kitchen helps. Tapping a rack starts the timer with the party's bake time.

When a timer reaches zero, every phone with the page open:
- plays a short chime (Web Audio, so no sound file; browsers only play it after the person has tapped the page at least once, which on a party night they will have),
- vibrates where the phone supports it (Android; iPhones don't allow it),
- shows a toast: "Fungi Fiesta: check it! 👀 (top rack)".

A **Keep screen on** toggle in the Oven section asks the phone not to sleep (Screen Wake Lock API, where supported; hidden where it isn't).

#### 3. Ratings & awards

- Once a pizza is **Ready**, anyone at the party can rate it **1–5 ⭐** right on its card. One rating per person per pizza, changeable. Shows the average and count.
- Each person can also tap **🌶️ Most adventurous** on one ready pizza. One pick per person for the whole party; tapping it on another pizza moves it.
- Ratings stay open until the end of the day after the party, so people who forgot can still rate from the keepsake page.
- **Awards** show on the keepsake page (after the party), and live during party mode as a preview:
  - 🏆 **Crowd favorite**: highest average rating, at least 2 ratings. Ties go to more ratings, then to whichever was made first.
  - 🌶️ **Most adventurous**: the pizza with the most 🌶️ picks, at least 2. Ties go to whichever was made first.

### Keepsake page (after the party)

Same as today, plus: the pizzas that were made, in the order they came out, with their ratings, and the awards at the top. Party-mode controls (oven buttons, ticks, plan editing) are gone. Rating stays possible until the end of the next day.

## Data (Firebase Realtime Database, under `parties/$party`)

| Path | Value | Who can write | When |
|---|---|---|---|
| `meta/nightTime` | `"HH:MM"` | host, cohosts (via meta) | like other settings |
| `meta/nightAt` | number, needs `date` | host, cohosts | like other settings |
| `meta/bakeMinutes` | integer 1–30 | host, cohosts | like other settings |
| `night/plan` | string ≤ 1000 | host, cohosts | before the party ends |
| `night/order` | list of pizza ids | host, cohosts | before the party ends |
| `night/notes/$pizza` | string ≤ 200 | host, cohosts | before the party ends |
| `night/prep/$ingredient` | `true` | anyone at the party | from `nightAt` until the party ends |
| `night/oven/$pizza` | `{ rack, startedAt, minutes, readyAt? }` | anyone at the party | from `nightAt` until the party ends |
| `ratings/$pizza/$uid` | integer 1–5 | that person only | pizza is ready, until `endsAt` + 1 day |
| `adventurous/$uid` | a pizza id | that person only | that pizza is ready, until `endsAt` + 1 day |

Notes:
- `$ingredient` is `ingredientKey(name)` with spaces turned into `_`, so it's a safe database key.
- `night/order` is only written when the host first moves a pizza. Until then the order is the vote ranking, which is frozen because voting is closed.
- `night/oven/$pizza`: `rack` is `"top"` or `"bottom"`; `minutes` 1–60 (bake time plus any +2s); `startedAt` must not be in the future (`<= now`); `readyAt` set when Ready is tapped. Stop deletes the entry. Rack conflicts are prevented in the page (the rules can't compare sibling entries); a clash from two people tapping at the same instant shows both pizzas on the rack, and either can be stopped.
- **Votes**: the vote rule gains "and (no `nightAt`, or `now < nightAt`)". New pizzas, and deleting pizzas, are also refused after `nightAt` (my call: a pizza vanishing mid-prep would break the queue and prep list). Renaming, toppings and look edits stay allowed as today.
- **The page's own lock**: `app.js` refuses writes once the party is over (`locked()` in the store wrapper). It needs the same exception as the rules so ratings still save until the end of the next day.
- **Ratings window**: the general "party is over" lock stays as is. `ratings` and `adventurous` get their own write rules: party member, `$uid === auth.uid`, the pizza's `night/oven/$pizza/readyAt` exists, and `now < endsAt + 86400000`.
- The meta rules must still accept today's parties (no new fields required).

## Pure helpers (in `lib.js`, unit-tested)

- `nightAt(date, "HH:MM")`: timestamp or null, same style as `partyEndsAt`.
- `isNight(meta, now)`: `nightAt` set, `now >= nightAt`, not over.
- `makingList(pizzas, goal, order)`: the pizza ids being made, in order.
- `prepList(making, pizzas, items)`: `[{ key, name, category, pizzas: [names], bringers: [{ by, amount }], missing }]` grouped by category.
- `ovenState(entry, now)`: `waiting | baking | check | ready` plus seconds left or over.
- `awards(made, ratings, adventurous)`: the award winners.

## Testing

- **Unit** (`tests/lib.test.js`): each helper above, including time-zone-safe `nightAt`, an empty goal, a moved pizza, renamed ingredients in the prep list, countdown edges (exactly zero, +2 min after zero), award ties.
- **Rules** (`tests/rules.emulator.test.js`): votes and new pizzas refused after `nightAt` but fine before and on parties without it; plan, order and notes are host/cohost only; anyone at the party can tick prep and run the oven, only after `nightAt`; bad racks, future `startedAt`, and `minutes` out of range refused; ratings and 🌶️ picks only on ready pizzas, only your own, 1–5 for ratings, until the end of the next day, refused after that; older parties unaffected.
- **Browser** (`tests/e2e.browser.js`, demo mode): host sets a time and bake time; host preview shows party mode while a guest sees planning; at the time, the page switches; voting buttons are gone; prep list counts and ticks; start a timer, rack becomes busy, +2 min, zero → Check it!, Ready; rating a ready pizza and picking it 🌶️; keepsake shows Crowd favorite and Most adventurous. Time is controlled in the test by setting `nightAt` relative to now and a short bake time.

## Decided by the host

- Party mode is optional, starts at a time the host sets ahead (including when creating the party), with a host-only preview before then.
- At the end of the day it turns into the keepsake by itself.
- Prep: shows each ingredient, how many pizzas need it and which ones; optional prep notes per pizza; "got it ✓" ticks.
- One timer per pizza, with Top or Bottom rack, Start/Stop.
- Voting closes when party mode starts; the host can move pizzas up or down.
- One bake time set once for every timer.
- At zero: "Check it! 👀", then someone taps Ready or adds 2 minutes; open phones chime or buzz.
- Busy racks shown as taken.
- Rate each pizza once it's ready, open until the end of the next day; awards on the keepsake.
- Most adventurous is voted by guests.
- Build it all at once, page organized as Prep / Oven / Ratings & awards.

## My calls (correct any of these)

- Anyone at the party can tick prep and run the oven; the plan, order, prep notes, start time and bake time are host/cohost only.
- Ratings are 1–5 stars, one per person per pizza, changeable.
- No goal set → every pizza is made.
- Planning sections stay reachable, collapsed, during party mode.
- "Start now" in the host preview.
- "Keep screen on" toggle.
- A party-mode line under the date for guests, saying when it starts and that voting closes then.
- Crowd favorite needs at least 2 ratings; Most adventurous needs at least 2 picks. One 🌶️ pick per person for the whole party.

## Left to the builder

- Exact styling, within the site's existing look (paper cards, chips, swatches).
- Chime sound design.
- How "Planning" collapses.
- Splitting `app.js` if it gets unwieldy (it is ~1000 lines today).
