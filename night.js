// 🔥 Party mode: what the page shows from the host's start time until the party's over.
// Prep (game plan, the pizzas being made, the prep list), the oven, and ratings & awards.
// app.js owns the data and hands it over in `ctx`; this file only draws it and saves changes.
import { nightFields, makingList, prepList, prepChoices, pizzaGoal, ovenState, clock, bakeMinutes, rotateMinutes, awards } from "./lib.js";

export function initNight(ctx) {
  const { $, esc, state, store, morph, toast } = ctx;
  let previewing = false; // a host looking ahead (never saved)
  let editingPlan = false;
  let editingNote = null; // pizza id
  let editingIng = null; // prep list key
  let editingTags = null; // prep list key whose tags are open
  let prepFilter = "all"; // which tag the prep list shows (only on this phone)
  // What a prep item needs. Tapping a filter shows just those.
  const TAGS = { cut: "🔪 Cut", cook: "🍳 Cook", shred: "🧀 Shred", thaw: "🧊 Thaw", ready: "✅ Ready as is" };
  const tagsOf = (key) => Object.keys(TAGS).filter((t) => state.night.prepTags[key]?.[t] === true);

  const isShowing = () => ctx.night() || (previewing && ctx.canManage() && !ctx.over() && typeof state.meta.nightAt === "number");
  // Prep days: 0 is the party day, up to 7 days before
  const prepDays = (n) => (Number.isInteger(n) && n >= 0 && n <= 7 ? n : 0);
  const dayLabel = (n, long) => {
    const rel = n === 0 ? "day of" : n === 1 ? "day before" : `${n} days before`;
    const [y, m, d] = String(state.meta.date || "").split("-").map(Number);
    if (!y) return rel;
    const date = new Date(y, m - 1, d - n).toLocaleDateString([], long ? { weekday: "long", month: "short", day: "numeric" } : { weekday: "short" });
    return `${date} · ${rel}`;
  };
  // Short labels ("Wed 25") fit beside each item on a phone; the day headings say "2 days before"
  const shortDay = (n) => {
    const [y, m, d] = String(state.meta.date || "").split("-").map(Number);
    if (!y) return n === 0 ? "Day of" : `${n} day${n === 1 ? "" : "s"} before`;
    const date = new Date(y, m - 1, d - n);
    return `${date.toLocaleDateString([], { weekday: "short" })} ${date.getDate()}`;
  };
  const dayOptions = (sel, short) => Array.from({ length: 8 }, (_, n) => `<option value="${n}" ${n === sel ? "selected" : ""}>${esc(short ? shortDay(n) : dayLabel(n))}</option>`).join("");
  const timeOf = (ms) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  // All pizzas in order (host's moves first, then votes), and the ones being made
  const ordered = () => makingList(state.pizzas, 0, state.night.order);
  const making = () => makingList(state.pizzas, pizzaGoal(state.meta), state.night.order);

  function render() {
    const host = ctx.canManage();
    $("preview-night").hidden = !(host && typeof state.meta.nightAt === "number" && !ctx.night() && !ctx.over() && !previewing);
    const show = isShowing();
    $("night-section").hidden = !show;
    renderKeepsake();
    if (!show) return;
    renderBanner();
    renderPrep(host);
    renderOven();
    renderRatings();
  }

  function renderBanner() {
    morph($("night-banner"), ctx.night()
      ? `<h2 data-key="h"><span class="h-emoji" aria-hidden="true">🥳</span>Party mode</h2><p data-key="p" class="voting-lock">🔒 Voting's closed. Here's the plan for tonight.</p>`
      : `<p data-key="p"><b>👀 Preview:</b> guests will see this at ${esc(timeOf(state.meta.nightAt))}.</p>
         <div class="row" data-key="b"><button type="button" data-start-now>Start now</button><button type="button" class="secondary" data-back-to-planning>Back to planning</button></div>`);
  }

  function renderPrep(host) {
    const el = $("night-prep");
    // Keep what's being typed across live updates
    const planDraft = el.querySelector("[data-plan-form] textarea")?.value;
    const noteForm = el.querySelector("[data-note-form]");
    const noteDraft = noteForm?.dataset.noteForm === editingNote ? noteForm.querySelector("input")?.value : undefined;
    const ingForm = el.querySelector("[data-ing-form]");
    const ingDraft = ingForm?.dataset.ingForm === editingIng ? ingForm.querySelector("input")?.value : undefined;
    const focusForm = el.contains(document.activeElement) ? document.activeElement.closest("form") : null;
    const hadFocus = !focusForm ? null : focusForm.matches("[data-plan-form]") ? "plan" : focusForm.matches("[data-ing-form]") ? "ing" : focusForm.matches("[data-task-form]") ? "task" : "note";
    const taskInput = el.querySelector("[data-task-form] input")?.value;
    const taskDays = el.querySelector("[data-task-form] select")?.value;
    const all = ordered();
    const made = making();
    const plan = state.night.plan;

    const planHTML = editingPlan && host
      ? `<form class="plan-form" data-plan-form><textarea maxlength="1000" rows="5" aria-label="Game plan" placeholder="Oven to 500° at 6. Dough out at 6:15. Damian on toppings.">${esc(planDraft ?? plan)}</textarea>
           <div class="row edit-actions"><button>Save</button><button type="button" class="secondary" data-cancel-plan>Cancel</button></div></form>`
      : `<p class="plan-text${plan ? "" : " empty"}">${plan ? esc(plan) : host ? "No plan yet. Write down how tonight goes: oven times, who does what." : "The host hasn't written a plan yet."}</p>`;

    const pizzaRow = (id, i) => {
      const p = state.pizzas[id];
      const note = state.night.notes[id];
      const noteHTML = editingNote === id && host
        ? `<form class="note-form" data-note-form="${id}"><input maxlength="200" value="${esc(noteDraft ?? note ?? "")}" aria-label="Prep note for ${esc(p.name)}" placeholder="Slice the mushrooms thin"><button>Save</button><button type="button" class="secondary" data-cancel-note>Cancel</button></form>`
        : note ? `<p class="prep-note">📝 ${esc(note)}</p>` : "";
      const tools = host
        ? `<span class="making-tools">
             <button type="button" class="ghost icon-btn" data-move="${id}:-1" aria-label="Move ${esc(p.name)} up" data-tip="Move up" ${i === 0 ? "disabled" : ""}><span>↑</span></button>
             <button type="button" class="ghost icon-btn" data-move="${id}:1" aria-label="Move ${esc(p.name)} down" data-tip="Move down" ${i === all.length - 1 ? "disabled" : ""}><span>↓</span></button>
             ${editingNote === id ? "" : `<button type="button" class="ghost icon-btn" data-edit-note="${id}" aria-label="Prep note for ${esc(p.name)}" data-tip="Prep note"><span>📝</span></button>`}
           </span>`
        : "";
      const picks = (Array.isArray(p.picks) ? p.picks : []).filter((n) => typeof n === "string");
      // 🔥 while it bakes, ✓ once it's out, so you can see what's left to make
      const where = state.night.oven[id] ? ovenState(state.night.oven[id], ctx.now()).state : "waiting";
      const done = where === "ready";
      const mark = done ? ` <span class="made-mark">✓ Made</span>` : where !== "waiting" ? ` <span class="made-mark baking">🔥 In the oven</span>` : "";
      return `<li data-making="${id}" data-key="m-${id}" class="${done ? "made" : ""}"><div class="making-head"><b>${esc(p.name)}${mark}</b>${tools}</div>
        <small class="making-picks">${esc(picks.join(", "))}</small>${noteHTML}</li>`;
    };

    const rows = prepList(made, state.pizzas, state.items, Object.keys(state.night.extra));
    const cats = Object.keys(ctx.CATS);
    const canTick = ctx.night() || host; // hosts tick off early prep before the start
    const tick = (key) => {
      const got = !!state.night.prep[key];
      return `<input type="checkbox" data-prep="${key}" ${got ? "checked" : ""} ${canTick ? "" : "disabled title=\"Ticks start when party mode does\""}>`;
    };
    const dayOf = (key) => prepDays(state.night.prepDay[key]);
    const tasks = Object.entries(state.night.tasks).sort(([, a], [, b]) => a.createdAt - b.createdAt);
    const badges = (key) => {
      const tags = tagsOf(key);
      return tags.length ? `<span class="prep-tags">${tags.map((t) => `<span class="tag">${TAGS[t]}</span>`).join("")}</span>` : "";
    };
    const tagBtn = (key, name) => (editingTags === key ? "" : `<button type="button" class="ghost icon-btn" data-edit-tags="${key}" aria-label="Tags for ${esc(name)}" data-tip="Cut, cook…"><span>🏷️</span></button>`);
    const tagPicker = (key) => (editingTags === key && host
      ? `<div class="tag-picker" data-tag-picker="${key}">${Object.entries(TAGS)
          .map(([t, label]) => `<button type="button" class="tag-chip" data-tag="${key}:${t}" aria-pressed="${tagsOf(key).includes(t)}">${label}</button>`).join("")}
          <button type="button" class="ghost" data-close-tags>Done</button></div>`
      : "");
    const shown = (key) => prepFilter === "all" || tagsOf(key).includes(prepFilter);
    const rowHTML = (r) => {
      const got = !!state.night.prep[r.key];
      const ingNote = state.night.ingNotes[r.key];
      const ingNoteHTML = editingIng === r.key && host
        ? `<form class="note-form" data-ing-form="${r.key}"><input maxlength="200" value="${esc(ingDraft ?? ingNote ?? "")}" aria-label="Prep note for ${esc(r.name)}" placeholder="Shred it, slice it thin, warm it up…"><button>Save</button><button type="button" class="secondary" data-cancel-ing>Cancel</button></form>`
        : ingNote ? `<p class="prep-note">📝 ${esc(ingNote)}</p>` : "";
      const tools = host
        ? `<span class="prep-tools"><select data-prep-day="${r.key}" aria-label="When to prep ${esc(r.name)}">${dayOptions(dayOf(r.key), true)}</select>${tagBtn(r.key, r.name)}${editingIng === r.key ? "" : `<button type="button" class="ghost icon-btn prep-note-btn" data-edit-ing="${r.key}" aria-label="Prep note for ${esc(r.name)}" data-tip="Prep note"><span>📝</span></button>`}${r.extra ? `<button type="button" class="ghost icon-btn" data-del-extra="${r.key}" aria-label="Take ${esc(r.name)} off the prep list" data-tip="Take off the list"><span>✕</span></button>` : ""}</span>`
        : "";
      const who = r.missing
        ? `<span class="prep-missing">nobody's bringing this ⚠️</span>`
        : esc(r.bringers.map((b) => (b.amount ? `${b.by}, ${b.amount}` : b.by)).join(" · "));
      return `<li data-prep-row="${r.key}" data-key="pr-${r.key}"><label class="${got ? "got" : ""}">${tick(r.key)}
        <span class="prep-what"><b>${esc(r.name)}</b>${badges(r.key)} ${r.pizzas.length ? `<span class="prep-n">${r.pizzas.length} pizza${r.pizzas.length === 1 ? "" : "s"}: ${esc(r.pizzas.join(", "))}</span>` : ""}
        <small class="prep-who">${who}</small></span></label>${tools}${tagPicker(r.key)}${ingNoteHTML}</li>`;
    };
    const taskHTML = ([id, t]) => {
      const key = `task_${id}`;
      const tools = host
        ? `<span class="prep-tools"><select data-task-day="${id}" aria-label="When to do ${esc(t.text)}">${dayOptions(t.days, true)}</select>${tagBtn(key, t.text)}<button type="button" class="ghost icon-btn" data-del-task="${id}" aria-label="Remove ${esc(t.text)}" data-tip="Remove"><span>✕</span></button></span>`
        : "";
      return `<li data-prep-row="${key}" data-key="pt-${id}"><label class="${state.night.prep[key] ? "got" : ""}">${tick(key)}<span class="prep-what"><b>${esc(t.text)}</b>${badges(key)}</span></label>${tools}${tagPicker(key)}</li>`;
    };
    // Filter chips: only tags in use, with how many items have each
    const allKeys = [...rows.map((r) => r.key), ...tasks.map(([id]) => `task_${id}`)];
    const counts = Object.fromEntries(Object.keys(TAGS).map((t) => [t, allKeys.filter((k) => tagsOf(k).includes(t)).length]));
    const used = Object.keys(TAGS).filter((t) => counts[t]);
    if (!used.includes(prepFilter)) prepFilter = "all";
    const filterHTML = used.length
      ? `<div class="prep-filter" data-key="pf" role="group" aria-label="Show"><button type="button" class="tag-chip" data-filter="all" aria-pressed="${prepFilter === "all"}">All</button>${used
          .map((t) => `<button type="button" class="tag-chip" data-filter="${t}" aria-pressed="${prepFilter === t}">${TAGS[t]} <span class="chip-n">${counts[t]}</span></button>`).join("")}</div>`
      : "";
    const shownRows = rows.filter((r) => shown(r.key));
    const shownTasks = tasks.filter(([id]) => shown(`task_${id}`));
    // Group by day, earliest first; inside each day, tasks then sauces, cheeses and toppings
    const days = [...new Set([...shownRows.map((r) => dayOf(r.key)), ...shownTasks.map(([, t]) => t.days)])].sort((a, b) => b - a);
    const prepHTML = days.length
      ? days.map((n) => {
          const dayTasks = shownTasks.filter(([, t]) => t.days === n);
          const taskCat = dayTasks.length ? `<div class="prep-cat" data-key="pc-tasks"><h4><span class="emo">📋</span>Tasks</h4><ul class="prep-list">${dayTasks.map(taskHTML).join("")}</ul></div>` : "";
          const catHTML = cats.map((cat) => {
            const list = shownRows.filter((r) => r.category === cat && dayOf(r.key) === n);
            if (!list.length) return "";
            return `<div class="prep-cat" data-key="pc-${cat}"><h4><span class="emo">${ctx.EMOJI[cat]}</span>${ctx.CATS[cat]}</h4><ul class="prep-list">${list.map(rowHTML).join("")}</ul></div>`;
          }).join("");
          return `<div class="prep-day" data-prep-days="${n}" data-key="pd-${n}"><h3 class="prep-day-head">${n ? "📅" : "🍕"} ${esc(dayLabel(n, true))}</h3>${taskCat}${catHTML}</div>`;
        }).join("")
      : `<p class="empty">Nothing to prep yet: no pizzas are being made.</p>`;
    const choices = host ? prepChoices(state.items, rows) : [];
    const extraForm = choices.length
      ? `<form class="task-form" data-extra-form data-key="xf"><select aria-label="Something people are bringing" required><option value="">Something people bring…</option>${choices
          .map((c) => `<option value="${c.key}">${esc(c.name)} · ${esc(c.by)}</option>`).join("")}</select><button>Add to prep</button></form>`
      : "";
    const taskForm = host
      ? `<form class="task-form" data-task-form data-key="tf"><input maxlength="80" placeholder="Add a prep task, like Make the dough" aria-label="Prep task" required><select aria-label="When">${dayOptions(1)}</select><button>Add</button></form>`
      : "";

    morph(el, `<h2 data-key="h"><span class="h-emoji" aria-hidden="true">🔪</span>Prep</h2>
      <div class="plan" data-key="plan"><div class="plan-head"><h3>Game plan</h3>${host && !editingPlan ? `<button type="button" class="ghost" data-edit-plan>✏️ Edit</button>` : ""}</div>${planHTML}</div>
      <div class="making-title" data-key="mh"><h3>Pizzas we're making</h3>${host ? `<span class="count-step">
        <button type="button" class="ghost icon-btn" data-count="-1" aria-label="Make one fewer pizza" data-tip="One fewer" ${made.length <= 1 ? "disabled" : ""}><span>−</span></button>
        <b aria-live="polite">${made.length}</b>
        <button type="button" class="ghost icon-btn" data-count="1" aria-label="Make one more pizza" data-tip="One more" ${made.length >= all.length || made.length >= 50 ? "disabled" : ""}><span>+</span></button></span>` : ""}</div>
      <ol class="making" data-key="ml">${made.map((id) => pizzaRow(id, all.indexOf(id))).join("") || `<li class="empty">No pizzas yet.</li>`}</ol>
      ${host ? `<p class="add-pizza" data-key="ap"><button type="button" class="secondary" data-add-pizza>+ Add a pizza</button> <small>Extra dough? It goes on the end of the list.</small></p>` : ""}
      <h3 data-key="ph">Prep list</h3>
      ${filterHTML}<div class="prep" data-key="pl">${prepHTML}</div>${extraForm}${taskForm}`);
    if (hadFocus === "plan") el.querySelector("[data-plan-form] textarea")?.focus();
    if (hadFocus === "note") el.querySelector("[data-note-form] input")?.focus();
    if (hadFocus === "ing") el.querySelector("[data-ing-form] input")?.focus();
    const tf = el.querySelector("[data-task-form]");
    if (tf && taskInput !== undefined) { tf.querySelector("input").value = taskInput; tf.querySelector("select").value = taskDays; }
    if (hadFocus === "task") tf?.querySelector("input").focus();
  }

  // A pizza the host adds after the start (extra dough) goes on the end of the making list,
  // and the count goes up so it makes the cut
  async function addToMaking(id, before) {
    const goal = pizzaGoal(state.meta);
    await store.set("night/order", [...before, id]);
    if (goal) await store.set("meta", { ...state.meta, pizzaGoal: Math.min(50, Math.max(goal, before.length + 1)) });
  }

  // ── 2. Oven: a timer per pizza, on the top or bottom rack ──
  const RACKS = { top: "Top rack", bottom: "Bottom rack" };
  const IN_OVEN = ["baking", "rotate", "check"]; // states that hold a rack (a pizza out for its turn keeps its spot)
  const lastState = new Map(); // pizza id -> state at the last draw, to notice "time's up" once
  const ovenRows = () => {
    const ids = making();
    for (const id of Object.keys(state.night.oven)) if (state.pizzas[id] && !ids.includes(id)) ids.push(id);
    return ids;
  };
  function renderOven() {
    const el = $("night-oven");
    const now = ctx.now();
    const open = ctx.night();
    const rows = ovenRows();
    const states = Object.fromEntries(rows.map((id) => [id, ovenState(state.night.oven[id], now)]));
    // Which rack each pizza is baking on (a ready pizza frees its rack)
    const busy = {};
    for (const id of rows) if (IN_OVEN.includes(states[id].state)) busy[state.night.oven[id].rack] = id;
    for (const id of rows) {
      const was = lastState.get(id);
      if (was === "baking" && states[id].state === "check") timesUp(id);
      if (was === "baking" && states[id].state === "rotate") turnIt(id);
      lastState.set(id, states[id].state);
    }
    const row = (id) => {
      const p = state.pizzas[id];
      const e = state.night.oven[id];
      const { state: st, secs, rotateIn } = states[id];
      const dis = open ? "" : "disabled";
      let body;
      if (st === "waiting") {
        body = `<span class="oven-status">Up next</span><span class="oven-btns">${Object.entries(RACKS)
          .map(([rack, label]) => {
            const taken = busy[rack];
            return `<button type="button" class="${taken ? "secondary" : ""}" data-rack="${id}:${rack}" ${taken || !open ? "disabled" : ""}>${label}${taken ? ` · ${esc(state.pizzas[taken].name)}` : ""}</button>`;
          })
          .join("")}<button type="button" class="ghost" data-made="${id}" ${dis}>Already made ✓</button></span>`;
      } else if (st === "baking") {
        body = `<span class="oven-status">🔥 ${RACKS[e.rack]} <span class="countdown">${clock(secs)}</span>${rotateIn ? ` <small class="rotate-in">🔄 in ${clock(rotateIn)}</small>` : ""}</span>
          <span class="oven-btns"><button type="button" class="secondary" data-plus="${id}" ${dis}>+2 min</button><button type="button" class="ghost" data-stop="${id}" ${dis}>Stop</button></span>`;
      } else if (st === "rotate") {
        body = `<span class="oven-status rotate">Rotate! 🔄 <span class="countdown">${clock(secs)}</span> <small>to go · ${RACKS[e.rack]}</small></span>
          <span class="oven-btns"><button type="button" data-back="${id}" ${dis}>Back in the oven</button><button type="button" class="ghost" data-stop="${id}" ${dis}>Stop</button></span>`;
      } else if (st === "check") {
        body = `<span class="oven-status check">Check it! 👀 <span class="over">+${clock(secs)}</span> <small>${RACKS[e.rack]}</small></span>
          <span class="oven-btns"><button type="button" data-ready="${id}" ${dis}>Ready 🍕</button><button type="button" class="secondary" data-plus="${id}" ${dis}>+2 min</button><button type="button" class="ghost" data-stop="${id}" ${dis}>Stop</button></span>`;
      } else {
        body = `<span class="oven-status ready">Ready 🍕 at ${esc(timeOf(e.readyAt))}</span>
          <span class="oven-btns"><button type="button" class="ghost" data-undo="${id}" ${dis}>Undo</button></span>`;
      }
      return `<li class="oven-row ${st}" data-oven="${id}" data-key="o-${id}"><b class="oven-name">${esc(p.name)}</b>${body}</li>`;
    };
    const sound = `<label class="toggle sound" data-key="sound"><input type="checkbox" data-sound ${soundOn() ? "checked" : ""}> <span>🔔 Sound on this phone</span></label>`;
    const wake = "wakeLock" in navigator
      ? `<label class="toggle wake" data-key="wake"><input type="checkbox" data-wake ${wakeLock ? "checked" : ""}> <span>Keep screen on</span></label>`
      : "";
    morph(el, `<h2 data-key="h"><span class="h-emoji" aria-hidden="true">🔥</span>Oven</h2>
      <p class="lede" data-key="l">Bake time: ${bakeMinutes(state.meta)} min${rotateMinutes(state.meta) ? ` · 🔄 Rotate at ${rotateMinutes(state.meta)} min` : ""}</p>${open ? "" : `<p class="oven-locked voting-lock" data-key="lock">🔒 Preview: the oven opens at ${esc(timeOf(state.meta.nightAt))}, when party mode starts.</p>`}
      <ul class="oven" data-key="list">${rows.map(row).join("") || `<li class="empty">No pizzas to bake yet.</li>`}</ul>${sound}${wake}`);
  }

  // Time's up: a chime (if this phone turned sound on), a buzz (where phones allow it) and a heads-up
  const soundOn = () => { try { return localStorage.ovenSound === "on"; } catch { return false; } };
  let audio;
  const unlockAudio = () => {
    const A = window.AudioContext || window.webkitAudioContext;
    if (!A) return;
    try { audio ??= new A(); audio.resume?.(); } catch { /* no sound, that's fine */ }
  };
  // A friendly ding-ding-ding (three rising bell notes), three times over: about 3 seconds,
  // long enough to hear across the kitchen without being scary
  function chime() {
    if (!soundOn() || !audio || audio.state !== "running") return;
    const NOTES = [784, 988, 1175]; // G, B, D: a bright, happy chord
    for (let round = 0; round < 3; round++) {
      NOTES.forEach((freq, i) => {
        const o = audio.createOscillator(), g = audio.createGain(), at = audio.currentTime + round * 1.1 + i * 0.16;
        o.type = "sine";
        o.frequency.value = freq;
        o.connect(g).connect(audio.destination);
        // A bell: a soft quick start, then a gentle ring-out
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(0.22, at + 0.015);
        g.gain.exponentialRampToValueAtTime(0.001, at + 0.6);
        o.start(at);
        o.stop(at + 0.62);
      });
    }
  }
  function timesUp(id) {
    const e = state.night.oven[id];
    chime();
    navigator.vibrate?.([200, 100, 200]);
    toast(`${state.pizzas[id].name}: check it! 👀 (${RACKS[e.rack].toLowerCase()})`);
  }
  function turnIt(id) {
    const e = state.night.oven[id];
    chime();
    navigator.vibrate?.([200, 100, 200]);
    toast(`${state.pizzas[id].name}: rotate it! 🔄 (${RACKS[e.rack].toLowerCase()}). The timer waits till it's back in`);
  }
  // Count down every second while anything's in the oven
  setInterval(() => {
    if (!isShowing()) return;
    const now = ctx.now();
    if (Object.values(state.night.oven).some((e) => IN_OVEN.includes(ovenState(e, now).state))) renderOven();
  }, 1000);

  // Keep the screen on while the oven's going (where the browser can)
  let wakeLock = null;
  async function setWake(on) {
    try {
      if (on) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { if (document.visibilityState === "visible") wakeLock = null; renderOven(); }); }
      else { await wakeLock?.release(); wakeLock = null; }
    } catch { wakeLock = null; toast("This phone won't keep the screen on, sorry"); }
    renderOven();
  }
  let wantWake = false;
  document.addEventListener("visibilitychange", () => { if (wantWake && document.visibilityState === "visible" && isShowing()) setWake(true); });

  async function oven(id, change) {
    if (!ctx.night()) return;
    const e = state.night.oven[id];
    if (change === "stop") return store.set(`night/oven/${id}`, null);
    if (change === "plus" && e) return store.set(`night/oven/${id}/minutes`, Math.min(60, e.minutes + 2));
    if (change === "ready" && e) return store.set(`night/oven/${id}/readyAt`, ctx.stamp());
    // Undo on one that skipped the timer puts it back to "Up next", not into the oven
    if (change === "undo" && e) return store.set(e.readyAt === e.startedAt ? `night/oven/${id}` : `night/oven/${id}/readyAt`, null);
    // Forgot the timer? Mark it made anyway (one time for both, so Undo can tell)
    if (change === "made" && !e) { const t = ctx.stamp(); return store.set(`night/oven/${id}`, { rack: "top", startedAt: t, minutes: bakeMinutes(state.meta), readyAt: t }); }
    if (change === "back" && e) { lastState.set(id, "back"); return store.set(`night/oven/${id}/backAt`, ctx.stamp()); }
    if (change === "top" || change === "bottom") {
      const now = ctx.now();
      const taken = Object.entries(state.night.oven).some(([other, o]) => other !== id && o.rack === change && IN_OVEN.includes(ovenState(o, now).state));
      if (taken) return toast(`The ${change} rack is busy`);
      lastState.set(id, "baking");
      const turn = rotateMinutes(state.meta);
      return store.set(`night/oven/${id}`, { rack: change, startedAt: ctx.stamp(), minutes: bakeMinutes(state.meta), ...(turn && { rotateAt: turn }) });
    }
  }

  // ── 3. Ratings & awards ──
  // Rate a pizza once it's out of the oven; open until the end of the day after the party.
  const ratingsOpen = () => typeof state.meta.endsAt !== "number" || ctx.now() < state.meta.endsAt + 86400000;
  const madeIds = () => Object.keys(state.night.oven)
    .filter((id) => state.pizzas[id] && typeof state.night.oven[id].readyAt === "number")
    .sort((a, b) => state.night.oven[a].readyAt - state.night.oven[b].readyAt);
  const result = () => awards(state.pizzas, state.night.oven, state.ratings, state.adventurous);

  function awardsHTML(r) {
    const line = (label, id, why) => `<li><b>${label}</b> ${esc(state.pizzas[id].name)} <small>${why}</small></li>`;
    const items = [
      r.crowd && line("🏆 Crowd favorite", r.crowd, `★ ${r.avg[r.crowd].avg.toFixed(1)} from ${r.avg[r.crowd].n}`),
      r.adventurous && line("🌶️ Most adventurous", r.adventurous, `${r.picks[r.adventurous]} picks`),
    ].filter(Boolean);
    return `<ul class="awards" data-key="awards">${items.join("") || `<li class="empty">Awards show up once a couple of people have rated.</li>`}</ul>`;
  }

  function rateRow(id, r, canRate) {
    const p = state.pizzas[id];
    const mine = state.ratings[id]?.[ctx.uid];
    const avg = r.avg[id];
    const spicy = state.adventurous[ctx.uid] === id;
    const stars = canRate
      ? `<span class="stars" role="group" aria-label="Rate ${esc(p.name)}">${[1, 2, 3, 4, 5]
          .map((n) => `<button type="button" class="star ${mine >= n ? "on" : ""}" data-rate="${id}:${n}" aria-pressed="${mine === n}" aria-label="${n} star${n === 1 ? "" : "s"}">★</button>`)
          .join("")}</span>
         <button type="button" class="spicy ${spicy ? "on" : ""}" data-spicy="${id}" aria-pressed="${spicy}" data-tip="Most adventurous">🌶️${r.picks[id] ? ` ${r.picks[id]}` : ""}</button>`
      : r.picks[id] ? `<span class="spicy-count">🌶️ ${r.picks[id]}</span>` : "";
    return `<li class="rate-row" data-made="${id}" data-key="r-${id}"><b>${esc(p.name)}</b>
      <span class="avg">${avg ? `★ ${Number(avg.avg.toFixed(1))} (${avg.n})` : "no ratings yet"}</span>${stars}</li>`;
  }

  function renderRatings() {
    const r = result();
    const made = madeIds();
    morph($("night-ratings"), `<h2 data-key="h"><span class="h-emoji" aria-hidden="true">⭐</span>Ratings &amp; awards</h2>${awardsHTML(r)}
      <p class="lede" data-key="l">Rate each pizza once it's out of the oven. Tap 🌶️ on the one you think was the most adventurous.</p>
      <ul class="rates" data-key="list">${made.map((id) => rateRow(id, r, ratingsOpen())).join("") || `<li class="empty">Nothing's out of the oven yet.</li>`}</ul>`);
  }

  // After the party: what got made, in the order it came out, with the awards
  function renderKeepsake() {
    const made = madeIds();
    const show = ctx.over() && made.length > 0;
    $("keepsake").hidden = !show;
    if (!show) return;
    const r = result();
    morph($("keepsake"), `<h2 data-key="h"><span class="h-emoji" aria-hidden="true">🏆</span>What we made</h2>${awardsHTML(r)}
      ${ratingsOpen() ? `<p class="lede" data-key="l">Ratings are open until the end of tomorrow.</p>` : ""}
      <ol class="rates" data-key="list">${made.map((id) => rateRow(id, r, ratingsOpen())).join("")}</ol>`);
  }

  async function rate(e) {
    const b = e.target.closest("[data-rate], [data-spicy]");
    if (!b || !ratingsOpen()) return false;
    if (b.dataset.rate) {
      const [id, n] = b.dataset.rate.split(":");
      await store.set(`ratings/${id}/${ctx.uid}`, Number(n));
    } else {
      const id = b.dataset.spicy;
      await store.set(`adventurous/${ctx.uid}`, state.adventurous[ctx.uid] === id ? null : id);
    }
    return true;
  }
  $("keepsake").addEventListener("click", rate);

  // ── Changes ──
  $("preview-night").addEventListener("click", () => { previewing = true; ctx.render(); $("night-section").scrollIntoView({ behavior: "smooth", block: "start" }); });

  $("night-section").addEventListener("click", async (e) => {
    unlockAudio(); // phones only play sound after a tap
    if (await rate(e)) return;
    const b = e.target.closest("button");
    if (!b) return;
    const d = b.dataset;
    if (d.rack) {
      const [id, rack] = d.rack.split(":");
      await oven(id, rack);
    } else if (d.plus || d.stop || d.ready || d.undo || d.back || d.made) {
      const change = ["plus", "stop", "ready", "undo", "back", "made"].find((k) => d[k]);
      await oven(d[change], change);
    } else if ("backToPlanning" in d) {
      previewing = false;
      ctx.render();
    } else if ("startNow" in d) {
      if (!ctx.canManage() || !confirm("Start party mode for everyone now? Voting closes.")) return;
      const now = new Date(ctx.now());
      const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const { nightTime, nightAt } = nightFields(state.meta.date, hhmm, "");
      if (!nightAt || nightAt > ctx.now()) return toast("Party mode can only start on the party's date");
      await store.set("meta", { ...state.meta, nightTime, nightAt });
      previewing = false;
      toast("Party mode is on 🔥");
    } else if ("editPlan" in d) {
      editingPlan = true;
      render();
      $("night-prep").querySelector("[data-plan-form] textarea")?.focus();
    } else if ("cancelPlan" in d) {
      editingPlan = false;
      render();
    } else if (d.editNote) {
      editingNote = d.editNote;
      render();
      $("night-prep").querySelector("[data-note-form] input")?.focus();
    } else if (d.editIng) {
      editingIng = d.editIng;
      render();
      $("night-prep").querySelector("[data-ing-form] input")?.focus();
    } else if ("cancelIng" in d) {
      editingIng = null;
      render();
    } else if (d.count) {
      // One more pulls in the next pizza by votes (or the host's order); one fewer drops the last
      const n = making().length + Number(d.count);
      if (n < 1 || n > Math.min(50, ordered().length)) return;
      await store.set("meta", { ...state.meta, pizzaGoal: n });
    } else if (d.editTags) {
      editingTags = d.editTags;
      render();
    } else if ("closeTags" in d) {
      editingTags = null;
      render();
    } else if (d.tag) {
      const [key, t] = d.tag.split(":");
      if (!ctx.canManage() || !(t in TAGS)) return;
      await store.set(`night/prepTags/${key}/${t}`, tagsOf(key).includes(t) ? null : true);
    } else if (d.filter) {
      prepFilter = d.filter;
      render();
    } else if (d.delExtra) {
      await store.set(`night/extra/${d.delExtra}`, null);
    } else if (d.delTask) {
      await store.set(`night/tasks/${d.delTask}`, null);
      await store.set(`night/prep/task_${d.delTask}`, null);
    } else if ("addPizza" in d) {
      ctx.openBuilder();
    } else if ("cancelNote" in d) {
      editingNote = null;
      render();
    } else if (d.move) {
      const [id, step] = d.move.split(":");
      const list = ordered();
      const i = list.indexOf(id);
      const j = i + Number(step);
      if (i < 0 || j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      await store.set("night/order", list);
    }
  });

  $("night-section").addEventListener("submit", async (e) => {
    const f = e.target;
    if (f.matches("[data-plan-form]")) {
      e.preventDefault();
      const text = f.querySelector("textarea").value.trim().slice(0, 1000);
      editingPlan = false;
      await store.set("night/plan", text || null);
      render();
    } else if (f.matches("[data-note-form]")) {
      e.preventDefault();
      const text = f.querySelector("input").value.trim().slice(0, 200);
      editingNote = null;
      await store.set(`night/notes/${f.dataset.noteForm}`, text || null);
      render();
    } else if (f.matches("[data-extra-form]")) {
      e.preventDefault();
      const key = f.querySelector("select").value;
      if (!/^[a-z0-9_]{1,60}$/.test(key)) return;
      await store.set(`night/extra/${key}`, true);
    } else if (f.matches("[data-task-form]")) {
      e.preventDefault();
      const text = f.querySelector("input").value.trim().slice(0, 80);
      if (!text) return;
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      await store.set(`night/tasks/${id}`, { text, days: prepDays(Number(f.querySelector("select").value)), createdAt: Date.now() });
      f.querySelector("input").value = "";
      render();
    } else if (f.matches("[data-ing-form]")) {
      e.preventDefault();
      const text = f.querySelector("input").value.trim().slice(0, 200);
      editingIng = null;
      await store.set(`night/ingNotes/${f.dataset.ingForm}`, text || null);
      render();
    }
  });

  $("night-section").addEventListener("change", async (e) => {
    if ("wake" in (e.target.dataset || {})) { wantWake = e.target.checked; return setWake(wantWake); }
    if ("sound" in (e.target.dataset || {})) {
      try { if (e.target.checked) localStorage.ovenSound = "on"; else delete localStorage.ovenSound; } catch { /* private browsing */ }
      unlockAudio();
      try { await audio?.resume?.(); } catch { /* no sound, that's fine */ }
      return chime(); // the full alarm now, so you know what it sounds like
    }
    const dd = e.target.dataset || {};
    if (dd.prepDay && ctx.canManage()) return store.set(`night/prepDay/${dd.prepDay}`, Number(e.target.value) || null);
    if (dd.taskDay && ctx.canManage()) return store.set(`night/tasks/${dd.taskDay}/days`, Number(e.target.value));
    const key = dd.prep;
    if (!key || !(ctx.night() || ctx.canManage())) return;
    await store.set(`night/prep/${key}`, e.target.checked || null);
  });

  return { render, isShowing, making, addToMaking };
}
