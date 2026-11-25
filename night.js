// 🔥 Party mode: what the page shows from the host's start time until the party's over.
// Prep (game plan, the pizzas being made, the prep list), the oven, and ratings & awards.
// app.js owns the data and hands it over in `ctx`; this file only draws it and saves changes.
import { nightFields, makingList, prepList, pizzaGoal } from "./lib.js";

export function initNight(ctx) {
  const { $, esc, state, store, morph, toast } = ctx;
  let previewing = false; // a host looking ahead (never saved)
  let editingPlan = false;
  let editingNote = null; // pizza id

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
    if (!show) return;
    renderBanner();
    renderPrep(host);
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
    const noteDraft = el.querySelector("[data-note-form] input")?.value;
    const hadFocus = el.contains(document.activeElement) ? document.activeElement.closest("form")?.matches("[data-plan-form]") ? "plan" : "note" : null;
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
              const who = r.missing
                ? `<span class="prep-missing">nobody's bringing this ⚠️</span>`
                : esc(r.bringers.map((b) => (b.amount ? `${b.by}, ${b.amount}` : b.by)).join(" · "));
              return `<li data-prep-row="${r.key}" data-key="pr-${r.key}"><label class="${got ? "got" : ""}">
                <input type="checkbox" data-prep="${r.key}" ${got ? "checked" : ""} ${ctx.night() ? "" : "disabled title=\"Ticks start when party mode does\""}>
                <span class="prep-what"><b>${esc(r.name)}</b> <span class="prep-n">${r.pizzas.length} pizza${r.pizzas.length === 1 ? "" : "s"}: ${esc(r.pizzas.join(", "))}</span>
                <small class="prep-who">${who}</small></span></label></li>`;
            })
            .join("")}</ul></div>`;
        }).join("")
      : `<p class="empty">Nothing to prep yet: no pizzas are being made.</p>`;

    morph(el, `<h2 data-key="h"><span class="h-emoji" aria-hidden="true">🔪</span>Prep</h2>
      <div class="plan" data-key="plan"><div class="plan-head"><h3>Game plan</h3>${host && !editingPlan ? `<button type="button" class="ghost" data-edit-plan>✏️ Edit</button>` : ""}</div>${planHTML}</div>
      <h3 data-key="mh">Pizzas we're making</h3>
      <ol class="making" data-key="ml">${made.map((id) => pizzaRow(id, all.indexOf(id))).join("") || `<li class="empty">No pizzas yet.</li>`}</ol>
      <h3 data-key="ph">Prep list</h3>
      <div class="prep" data-key="pl">${prepHTML}</div>`);
    if (hadFocus === "plan") el.querySelector("[data-plan-form] textarea")?.focus();
    if (hadFocus === "note") el.querySelector("[data-note-form] input")?.focus();
  }

  // ── Changes ──
  $("preview-night").addEventListener("click", () => { previewing = true; ctx.render(); $("night-section").scrollIntoView({ behavior: "smooth", block: "start" }); });

  $("night-section").addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const d = b.dataset;
    if ("backToPlanning" in d) {
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
    }
  });

  $("night-section").addEventListener("change", async (e) => {
    const key = e.target.dataset?.prep;
    if (!key || !ctx.night()) return;
    await store.set(`night/prep/${key}`, e.target.checked || null);
  });

  return { render, isShowing };
}
