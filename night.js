// 🔥 Party mode: what the page shows from the host's start time until the party's over.
// Prep (game plan, the pizzas being made, the prep list), the oven, and ratings & awards.
// app.js owns the data and hands it over in `ctx`; this file only draws it and saves changes.
import { nightFields, makingList, prepList, pizzaGoal, ovenState, clock, bakeMinutes, awards } from "./lib.js";

export function initNight(ctx) {
  const { $, esc, state, store, morph, toast } = ctx;
  let previewing = false; // a host looking ahead (never saved)
  let editingPlan = false;
  let editingNote = null; // pizza id
  let editingIng = null; // prep list key

  const isShowing = () => ctx.night() || (previewing && ctx.canManage() && !ctx.over() && typeof state.meta.nightAt === "number");
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
      ? `<h2 data-key="h"><span class="h-emoji" aria-hidden="true">🔥</span>Party mode</h2><p data-key="p" class="lede">Voting's closed. Here's the plan for tonight.</p>`
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
    const hadFocus = !focusForm ? null : focusForm.matches("[data-plan-form]") ? "plan" : focusForm.matches("[data-ing-form]") ? "ing" : "note";
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
      return `<li data-making="${id}" data-key="m-${id}"><div class="making-head"><b>${esc(p.name)}</b>${tools}</div>
        <small class="making-picks">${esc(picks.join(", "))}</small>${noteHTML}</li>`;
    };

    const rows = prepList(made, state.pizzas, state.items);
    const cats = Object.keys(ctx.CATS);
    const prepHTML = rows.length
      ? cats.map((cat) => {
          const list = rows.filter((r) => r.category === cat);
          if (!list.length) return "";
          return `<div class="prep-cat" data-key="pc-${cat}"><h4><span class="emo">${ctx.EMOJI[cat]}</span>${ctx.CATS[cat]}</h4><ul class="prep-list">${list
            .map((r) => {
              const got = !!state.night.prep[r.key];
              const ingNote = state.night.ingNotes[r.key];
              const ingNoteHTML = editingIng === r.key && host
                ? `<form class="note-form" data-ing-form="${r.key}"><input maxlength="200" value="${esc(ingDraft ?? ingNote ?? "")}" aria-label="Prep note for ${esc(r.name)}" placeholder="Shred it, slice it thin, warm it up…"><button>Save</button><button type="button" class="secondary" data-cancel-ing>Cancel</button></form>`
                : ingNote ? `<p class="prep-note">📝 ${esc(ingNote)}</p>` : "";
              const ingTool = host && editingIng !== r.key
                ? `<button type="button" class="ghost icon-btn prep-note-btn" data-edit-ing="${r.key}" aria-label="Prep note for ${esc(r.name)}" data-tip="Prep note"><span>📝</span></button>`
                : "";
              const who = r.missing
                ? `<span class="prep-missing">nobody's bringing this ⚠️</span>`
                : esc(r.bringers.map((b) => (b.amount ? `${b.by}, ${b.amount}` : b.by)).join(" · "));
              return `<li data-prep-row="${r.key}" data-key="pr-${r.key}"><label class="${got ? "got" : ""}">
                <input type="checkbox" data-prep="${r.key}" ${got ? "checked" : ""} ${ctx.night() ? "" : "disabled title=\"Ticks start when party mode does\""}>
                <span class="prep-what"><b>${esc(r.name)}</b> <span class="prep-n">${r.pizzas.length} pizza${r.pizzas.length === 1 ? "" : "s"}: ${esc(r.pizzas.join(", "))}</span>
                <small class="prep-who">${who}</small></span></label>${ingTool}${ingNoteHTML}</li>`;
            })
            .join("")}</ul></div>`;
        }).join("")
      : `<p class="empty">Nothing to prep yet: no pizzas are being made.</p>`;

    morph(el, `<h2 data-key="h"><span class="h-emoji" aria-hidden="true">🔪</span>Prep</h2>
      <div class="plan" data-key="plan"><div class="plan-head"><h3>Game plan</h3>${host && !editingPlan ? `<button type="button" class="ghost" data-edit-plan>✏️ Edit</button>` : ""}</div>${planHTML}</div>
      <div class="making-title" data-key="mh"><h3>Pizzas we're making</h3>${host ? `<span class="count-step">
        <button type="button" class="ghost icon-btn" data-count="-1" aria-label="Make one fewer pizza" data-tip="One fewer" ${made.length <= 1 ? "disabled" : ""}><span>−</span></button>
        <b aria-live="polite">${made.length}</b>
        <button type="button" class="ghost icon-btn" data-count="1" aria-label="Make one more pizza" data-tip="One more" ${made.length >= all.length || made.length >= 50 ? "disabled" : ""}><span>+</span></button></span>` : ""}</div>
      <ol class="making" data-key="ml">${made.map((id) => pizzaRow(id, all.indexOf(id))).join("") || `<li class="empty">No pizzas yet.</li>`}</ol>
      ${host ? `<p class="add-pizza" data-key="ap"><button type="button" class="secondary" data-add-pizza>+ Add a pizza</button> <small>Extra dough? It goes on the end of the list.</small></p>` : ""}
      <h3 data-key="ph">Prep list</h3>
      <div class="prep" data-key="pl">${prepHTML}</div>`);
    if (hadFocus === "plan") el.querySelector("[data-plan-form] textarea")?.focus();
    if (hadFocus === "note") el.querySelector("[data-note-form] input")?.focus();
    if (hadFocus === "ing") el.querySelector("[data-ing-form] input")?.focus();
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
    for (const id of rows) if (["baking", "check"].includes(states[id].state)) busy[state.night.oven[id].rack] = id;
    for (const id of rows) {
      const was = lastState.get(id);
      if (was === "baking" && states[id].state === "check") timesUp(id);
      lastState.set(id, states[id].state);
    }
    const row = (id) => {
      const p = state.pizzas[id];
      const e = state.night.oven[id];
      const { state: st, secs } = states[id];
      const dis = open ? "" : "disabled";
      let body;
      if (st === "waiting") {
        body = `<span class="oven-status">Up next</span><span class="oven-btns">${Object.entries(RACKS)
          .map(([rack, label]) => {
            const taken = busy[rack];
            return `<button type="button" class="${taken ? "secondary" : ""}" data-rack="${id}:${rack}" ${taken || !open ? "disabled" : ""}>${label}${taken ? ` · ${esc(state.pizzas[taken].name)}` : ""}</button>`;
          })
          .join("")}</span>`;
      } else if (st === "baking") {
        body = `<span class="oven-status">🔥 ${RACKS[e.rack]} <span class="countdown">${clock(secs)}</span></span>
          <span class="oven-btns"><button type="button" class="secondary" data-plus="${id}" ${dis}>+2 min</button><button type="button" class="ghost" data-stop="${id}" ${dis}>Stop</button></span>`;
      } else if (st === "check") {
        body = `<span class="oven-status check">Check it! 👀 <span class="over">+${clock(secs)}</span> <small>${RACKS[e.rack]}</small></span>
          <span class="oven-btns"><button type="button" data-ready="${id}" ${dis}>Ready 🍕</button><button type="button" class="secondary" data-plus="${id}" ${dis}>+2 min</button><button type="button" class="ghost" data-stop="${id}" ${dis}>Stop</button></span>`;
      } else {
        body = `<span class="oven-status ready">Ready 🍕 at ${esc(timeOf(e.readyAt))}</span>
          <span class="oven-btns"><button type="button" class="ghost" data-undo="${id}" ${dis}>Undo</button></span>`;
      }
      return `<li class="oven-row ${st}" data-oven="${id}" data-key="o-${id}"><b class="oven-name">${esc(p.name)}</b>${body}</li>`;
    };
    const wake = "wakeLock" in navigator
      ? `<label class="toggle wake" data-key="wake"><input type="checkbox" data-wake ${wakeLock ? "checked" : ""}> <span>Keep screen on</span></label>`
      : "";
    morph(el, `<h2 data-key="h"><span class="h-emoji" aria-hidden="true">🔥</span>Oven</h2>
      <p class="lede" data-key="l">Bake time: ${bakeMinutes(state.meta)} min${open ? "" : ". The oven opens when party mode starts."}</p>
      <ul class="oven" data-key="list">${rows.map(row).join("") || `<li class="empty">No pizzas to bake yet.</li>`}</ul>${wake}`);
  }

  // Time's up: a chime, a buzz (where phones allow it) and a heads-up
  let audio;
  const unlockAudio = () => {
    const A = window.AudioContext || window.webkitAudioContext;
    if (!A) return;
    try { audio ??= new A(); audio.resume?.(); } catch { /* no sound, that's fine */ }
  };
  function chime() {
    if (!audio || audio.state !== "running") return;
    for (const t of [0, 0.28]) {
      const o = audio.createOscillator(), g = audio.createGain(), at = audio.currentTime + t;
      o.frequency.value = 880;
      o.connect(g).connect(audio.destination);
      g.gain.setValueAtTime(0.25, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.22);
      o.start(at);
      o.stop(at + 0.24);
    }
  }
  function timesUp(id) {
    const e = state.night.oven[id];
    chime();
    navigator.vibrate?.([200, 100, 200]);
    toast(`${state.pizzas[id].name}: check it! 👀 (${RACKS[e.rack].toLowerCase()})`);
  }
  // Count down every second while anything's in the oven
  setInterval(() => {
    if (!isShowing()) return;
    const now = ctx.now();
    if (Object.values(state.night.oven).some((e) => ["baking", "check"].includes(ovenState(e, now).state))) renderOven();
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
    if (change === "undo" && e) return store.set(`night/oven/${id}/readyAt`, null);
    if (change === "top" || change === "bottom") {
      const now = ctx.now();
      const taken = Object.entries(state.night.oven).some(([other, o]) => other !== id && o.rack === change && ["baking", "check"].includes(ovenState(o, now).state));
      if (taken) return toast(`The ${change} rack is busy`);
      lastState.set(id, "baking");
      return store.set(`night/oven/${id}`, { rack: change, startedAt: ctx.stamp(), minutes: bakeMinutes(state.meta) });
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
    } else if (d.plus || d.stop || d.ready || d.undo) {
      const change = ["plus", "stop", "ready", "undo"].find((k) => d[k]);
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
    const key = e.target.dataset?.prep;
    if (!key || !ctx.night()) return;
    await store.set(`night/prep/${key}`, e.target.checked || null);
  });

  return { render, isShowing, making, addToMaking };
}
