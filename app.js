import { firebaseConfig } from "./config.js";
import { pieHTML, ICONS, safeIcon } from "./pie.js";
import { parseCode, newCode, esc, cleanIds, voteCount, rankPizzas } from "./lib.js";

const CATS = { sauce: "Sauces", cheese: "Cheeses", topping: "Toppings", other: "Dough / drinks / other" };
const EMOJI = { sauce: "🍅", cheese: "🧀", topping: "🍄", other: "🥖" };
const PIZZA_CATS = ["sauce", "cheese", "topping"];
const CAT_ONE = { sauce: "Sauce", cheese: "Cheese", topping: "Topping", other: "Other" };

const $ = (id) => document.getElementById(id);

// ── Who am I (no accounts: a random id + name saved in this browser) ──
const uid = localStorage.uid || (localStorage.uid = crypto.randomUUID());

// ── Which party: the secret code lives after the # in the invite link ──
// It's never sent to GitHub's servers and never stored in the repo.
addEventListener("hashchange", () => location.reload());

// ── Storage: Firebase if configured, otherwise this-browser-only demo ──
const configured = firebaseConfig?.databaseURL && !firebaseConfig.databaseURL.includes("YOUR_");
if (!configured) {
  $("mode").hidden = false;
  $("mode").textContent = "Demo mode: data is only saved in this browser. Add your Firebase config in config.js to share with friends.";
}
const db = configured ? await firebaseDb() : localDb();

async function firebaseDb() {
  const v = "10.12.2";
  const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${v}/firebase-app.js`);
  const fb = await import(`https://www.gstatic.com/firebasejs/${v}/firebase-database.js`);
  const d = fb.getDatabase(initializeApp(firebaseConfig));
  return {
    watch: (p, cb) => fb.onValue(fb.ref(d, p), (s) => cb(s.val() || {}), (err) => toast("Couldn't load: " + err.message)),
    add: (p, obj) => fb.push(fb.ref(d, p), obj),
    set: (p, val) => fb.set(fb.ref(d, p), val),
  };
}

function localDb() {
  const KEY = "pizza-demo";
  const load = () => JSON.parse(localStorage[KEY] || "{}");
  const get = (p) => p.split("/").reduce((o, k) => o?.[k], load());
  const watchers = [];
  const notify = () => watchers.forEach(([p, cb]) => cb(get(p) || {}));
  const set = (path, val) => {
    const data = load();
    const keys = path.split("/");
    let o = data;
    for (const k of keys.slice(0, -1)) o = o[k] ??= {};
    if (val === null) delete o[keys.at(-1)];
    else o[keys.at(-1)] = val;
    localStorage[KEY] = JSON.stringify(data);
    notify();
  };
  addEventListener("storage", (e) => e.key === KEY && notify());
  return {
    watch: (p, cb) => { watchers.push([p, cb]); cb(get(p) || {}); },
    add: (p, obj) => set(`${p}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, obj),
    set,
  };
}

// ── Start ──
const code = parseCode(location.hash) || parseCode(localStorage.lastParty);
if (code) {
  if (location.hash.slice(1) !== code) history.replaceState(null, "", "#" + code);
  startParty(code);
} else {
  showGate();
}

// ── Gate: join or host ──
function showGate() {
  $("gate").hidden = false;
  $("join-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const c = parseCode($("join-code").value);
    if (!c) return toast("That doesn't look like a party code");
    location.hash = c;
  });
  $("new-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const c = newCode();
    await db.set(`parties/${c}/meta`, {
      title: $("new-title").value.trim().slice(0, 60),
      details: $("new-details").value.trim().slice(0, 200),
      uid,
      createdAt: Date.now(),
    });
    location.hash = c;
  });
}

// ── The party ──
function startParty(code) {
  localStorage.lastParty = code;
  const ROOT = `parties/${code}`;
  // Saves that fail (offline, or blocked by the database rules) show a message instead of vanishing.
  const saved = (promise) =>
    Promise.resolve(promise).catch((err) => {
      console.error(err);
      toast("Hmm, that didn't save 😕 Check your connection and try again.");
      throw err;
    });
  const store = {
    add: (p, obj) => saved(db.add(`${ROOT}/${p}`, obj)),
    set: (p, val) => saved(db.set(`${ROOT}/${p}`, val)),
  };
  $("party").hidden = false;

  const nameInput = $("my-name");
  nameInput.value = localStorage.myName || "";
  nameInput.addEventListener("input", () => (localStorage.myName = nameInput.value.trim()));
  const myName = () => {
    const n = nameInput.value.trim();
    if (!n) {
      toast("Type your name at the top first 👆");
      nameInput.focus();
      nameInput.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return n;
  };

  $("copy-link").addEventListener("click", async () => {
    const link = location.href.split("#")[0] + "#" + code;
    try { await navigator.clipboard.writeText(link); toast("Invite link copied. Only share it with friends!"); }
    catch { prompt("Copy this invite link:", link); }
  });
  $("leave").addEventListener("click", (e) => {
    e.preventDefault();
    localStorage.removeItem("lastParty");
    location.hash = "";
    location.reload();
  });

  let state = { meta: {}, items: {}, pizzas: {}, diets: {} };
  let renaming = null; // pizza id being renamed inline
  let armed = null; // "item:<id>", "pizza:<id>" or "diet:<id>" waiting for a second tap to delete
  let armTimer;
  let editingItem = null; // ingredient id being edited inline

  const itemsIn = (cat) =>
    Object.entries(state.items)
      .filter(([, it]) => it.category === cat)
      .sort((a, b) => a[1].name.localeCompare(b[1].name));
  const iconOf = (it) => (it.category === "topping" ? safeIcon(it.icon) : "");
  const delBtn = (kind, id) =>
    armed === `${kind}:${id}`
      ? `<button class="ghost danger" data-del="${kind}:${id}">tap again to delete</button>`
      : `<button class="ghost" data-del="${kind}:${id}" title="Delete">✕</button>`;

  // Icon picker (toppings only, since that's what gets drawn as dots)
  $("item-icon").insertAdjacentHTML("beforeend", ICONS.map(([e, label]) => `<option value="${e}">${e} ${label}</option>`).join(""));
  const syncIconField = () => ($("item-form").querySelector(".f-icon").style.visibility = $("item-cat").value === "topping" ? "" : "hidden");
  $("item-cat").addEventListener("change", syncIconField);
  syncIconField();

  function render() {
    const title = state.meta.title || "Pizza Party 🍕";
    $("title").textContent = title;
    document.title = title;
    $("details").textContent = state.meta.details || "";
    // Only the browser that created the party can edit its name/details
    const isHost = state.meta.uid === uid;
    $("edit-meta").hidden = !isHost;
    if (!isHost) showMetaForm(false);
    renderItems();
    renderDiets();
    renderBuilder();
    renderPizzas();
  }

  // Inline editor for your own ingredient. Keeps what you've typed if the list re-renders.
  function itemEditor(id, it, drafts) {
    const v = drafts || it;
    const opt = (val, label, cur) => `<option value="${val}" ${val === cur ? "selected" : ""}>${label}</option>`;
    return `<li class="editing"><form class="item-edit" data-edit-form="${id}">
      <select data-f="category" aria-label="Type">${Object.keys(CATS).map((c) => opt(c, `${EMOJI[c]} ${CAT_ONE[c]}`, v.category)).join("")}</select>
      <input data-f="name" maxlength="60" required value="${esc(v.name)}" aria-label="Ingredient">
      <input data-f="amount" maxlength="30" value="${esc(v.amount || "")}" placeholder="how much (optional)" aria-label="How much">
      <select data-f="icon" aria-label="Pizza icon" ${v.category === "topping" ? "" : "hidden"}>${opt("", "✨ Auto", safeIcon(v.icon))}${ICONS.map(([e, l]) => opt(e, `${e} ${l}`, safeIcon(v.icon))).join("")}</select>
      <div class="row edit-actions"><button>Save</button><button type="button" class="secondary" data-cancel-edit>Cancel</button></div>
    </form></li>`;
  }

  function renderItems() {
    // Hold on to an open editor's unsaved values and focus across live updates
    const form = document.querySelector("#items [data-edit-form]");
    const field = (f) => form?.querySelector(`[data-f="${f}"]`)?.value;
    const drafts = form ? { category: field("category"), name: field("name"), amount: field("amount"), icon: field("icon") } : null;
    const focused = form?.contains(document.activeElement) ? document.activeElement.dataset.f : null;
    const html = Object.entries(CATS)
      .map(([cat, label]) => {
        const list = itemsIn(cat);
        if (!list.length) return "";
        return `<div class="cat cat-${cat}"><h3><span class="emo">${EMOJI[cat]}</span>${label}</h3><ul class="list">${list
          .map(([id, it]) => {
            if (id === editingItem && it.uid === uid) return itemEditor(id, it, drafts);
            const icon = iconOf(it);
            return `<li><span>${icon ? `<span class="item-icon">${icon}</span>` : ""}<span class="item-name">${esc(it.name)}</span>${
              it.amount ? `<span class="amt">${esc(it.amount)}</span>` : ""
            }<span class="who">from ${esc(it.by)}</span></span>${
              it.uid === uid ? `<span class="mine"><button class="ghost" data-edit-item="${id}" title="Edit">✏️</button>${delBtn("item", id)}</span>` : ""
            }</li>`;
          })
          .join("")}</ul></div>`;
      })
      .join("");
    $("items").innerHTML = html || `<p class="empty">The table is empty… be the first to bring something! 🥺</p>`;
    if (focused) document.querySelector(`#items [data-edit-form] [data-f="${focused}"]`)?.focus();
  }

  function renderDiets() {
    const list = Object.entries(state.diets).sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));
    $("diets").innerHTML = list.length
      ? list
          .map(([id, d]) => `<li><span><span class="item-name">${esc(d.by)}</span><span class="diet-note">${esc(d.note)}</span></span>${
            d.uid === uid ? delBtn("diet", id) : ""
          }</li>`)
          .join("")
      : `<li class="empty">Nothing here, and that's totally fine! Only add something if you have an allergy or restriction 💚</li>`;
  }

  function renderBuilder() {
    const el = $("builder");
    const checked = new Set([...el.querySelectorAll("input:checked")].map((i) => i.value));
    el.innerHTML = PIZZA_CATS.map((cat) => {
      const list = itemsIn(cat);
      return `<div class="cat cat-${cat}"><h3><span class="emo">${EMOJI[cat]}</span>${CATS[cat]}</h3>${
        list.length
          ? `<div class="chips">${list
              .map(([id, it]) => {
                const icon = iconOf(it);
                return `<label class="chip"><input type="checkbox" value="${id}" ${checked.has(id) ? "checked" : ""}><span>${icon ? `<span class="emo">${icon}</span>` : ""}${esc(it.name)}</span></label>`;
              })
              .join("")}</div>`
          : `<p class="empty">No ${CATS[cat].toLowerCase()} committed yet.</p>`
      }</div>`;
    }).join("");
  }

  function renderPizzas() {
    // Keep whatever someone is typing in a rename box across live updates
    const draftEl = document.querySelector("#pizzas .rename input");
    const draft = draftEl?.value;
    const hadFocus = draftEl && document.activeElement === draftEl;

    const list = rankPizzas(state.pizzas);
    const top = list.length ? voteCount(list[0][1]) : 0;
    $("pizzas").innerHTML = list.length
      ? list
          .map(([id, p]) => {
            const votes = p.votes || {};
            const count = voteCount(p);
            const mine = !!votes[uid];
            const lead = count && count === top;
            const ings = (p.ingredients || [])
              .map((iid) => {
                const it = state.items[iid];
                if (!it) return `<span class="ing gone" title="no longer on the list">removed</span>`;
                const icon = iconOf(it);
                return `<span class="ing" title="from ${esc(it.by)}">${icon ? `<span class="emo">${icon}</span>` : ""}${esc(it.name)}</span>`;
              })
              .join("");
            const pieItems = (p.ingredients || []).map((iid) => state.items[iid]).filter(Boolean);
            const heading =
              renaming === id
                ? `<form class="rename" data-rename-form="${id}">
                     <input maxlength="60" required value="${esc(draft ?? p.name)}" aria-label="Pizza name">
                     <button>Save</button><button type="button" class="ghost" data-cancel-rename>Cancel</button>
                   </form>`
                : `<h3>${lead ? '<span class="crown" title="Most votes">👑</span>' : ""}${esc(p.name)}
                     <button class="ghost" data-rename="${id}" title="Rename">✏️</button>
                     ${p.uid === uid ? delBtn("pizza", id) : ""}
                   </h3>`;
            return `<div class="pizza ${lead ? "leader" : ""}">
              ${pieHTML(pieItems)}
              <div class="body">
                ${heading}
                <div class="by">proposed by ${esc(p.by)}</div>
                <div class="ings">${ings || `<span class="ing">just dough, apparently</span>`}</div>
                ${count ? `<div class="voters">loved by ${Object.values(votes).map(esc).join(", ")}</div>` : ""}
              </div>
              <button class="vote ${mine ? "on" : ""}" data-vote="${id}" aria-pressed="${mine}" title="${mine ? "Remove your vote" : "Vote for this one"}"><span class="heart">${mine ? "♥" : "♡"}</span><b>${count}</b></button>
            </div>`;
          })
          .join("")
      : `<p class="empty">No pizzas yet. Dream one up above! 💭</p>`;
    if (hadFocus) document.querySelector("#pizzas .rename input")?.focus();
  }

  // ── Actions ──
  $("item-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const by = myName();
    const name = $("item-name").value.trim();
    if (!by || !name) return;
    const category = $("item-cat").value;
    const amount = $("item-amount").value.trim();
    const icon = category === "topping" ? safeIcon($("item-icon").value) : "";
    await store.add("items", { name, category, by, uid, createdAt: Date.now(), ...(amount && { amount }), ...(icon && { icon }) });
    $("item-name").value = "";
    $("item-amount").value = "";
    $("item-icon").value = "";
    toast(`Yay, thanks ${by}! ${name} added 💛`);
  });

  $("diet-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const by = myName();
    const note = $("diet-note").value.trim().slice(0, 80);
    if (!by || !note) return;
    await store.add("diets", { note, by, uid, createdAt: Date.now() });
    $("diet-note").value = "";
    toast("Noted! We'll keep it in mind 💚");
  });

  $("pizza-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const by = myName();
    const name = $("pizza-name").value.trim();
    if (!by || !name) return;
    const ingredients = [...document.querySelectorAll("#builder input:checked")].map((i) => i.value);
    if (!ingredients.length) return toast("Pick at least one ingredient");
    await store.add("pizzas", { name, by, uid, ingredients, createdAt: Date.now(), votes: { [uid]: by } });
    $("pizza-name").value = "";
    document.querySelectorAll("#builder input:checked").forEach((i) => (i.checked = false));
    toast(`${name} is in the oven 🍕🔥`);
  });

  // Party name + details: the creator edits them right in the header
  function showMetaForm(on) {
    $("meta-form").hidden = !on;
    $("meta-view").hidden = on;
    if (on) {
      $("meta-title").value = state.meta.title || "";
      $("meta-details").value = state.meta.details || "";
      $("meta-title").focus();
    }
  }
  $("edit-meta").addEventListener("click", () => showMetaForm(true));
  $("meta-cancel").addEventListener("click", () => showMetaForm(false));
  $("meta-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = $("meta-title").value.trim().slice(0, 60);
    if (!title || state.meta.uid !== uid) return;
    await store.set("meta", { ...state.meta, title, details: $("meta-details").value.trim().slice(0, 200) });
    showMetaForm(false);
    toast("Party updated ✨");
  });

  document.addEventListener("submit", async (e) => {
    const ef = e.target.closest("[data-edit-form]");
    if (!ef) return;
    e.preventDefault();
    const id = ef.dataset.editForm;
    const it = state.items[id];
    const get = (f) => ef.querySelector(`[data-f="${f}"]`).value.trim();
    const name = get("name").slice(0, 60);
    const category = get("category");
    if (!it || it.uid !== uid || !name || !CATS[category]) return;
    const amount = get("amount").slice(0, 30);
    const icon = category === "topping" ? safeIcon(get("icon")) : "";
    editingItem = null;
    await store.set(`items/${id}`, { name, category, by: it.by, uid: it.uid, createdAt: it.createdAt || Date.now(), ...(amount && { amount }), ...(icon && { icon }) });
    toast(`${name} updated ✨`);
  });

  // Show the icon picker only while "Topping" is chosen in an open editor
  document.addEventListener("change", (e) => {
    if (e.target.dataset?.f !== "category") return;
    const icon = e.target.form?.querySelector('[data-f="icon"]');
    if (icon) icon.hidden = e.target.value !== "topping";
  });

  document.addEventListener("submit", async (e) => {
    const f = e.target.closest("[data-rename-form]");
    if (!f) return;
    e.preventDefault();
    const name = f.querySelector("input").value.trim().slice(0, 60);
    const id = f.dataset.renameForm;
    renaming = null;
    if (name && state.pizzas[id]) await store.set(`pizzas/${id}/name`, name);
    renderPizzas();
  });

  document.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.vote) {
      const by = myName();
      if (!by) return;
      const id = b.dataset.vote;
      await store.set(`pizzas/${id}/votes/${uid}`, state.pizzas[id]?.votes?.[uid] ? null : by);
    } else if (b.dataset.rename) {
      renaming = b.dataset.rename;
      renderPizzas();
      const input = document.querySelector("#pizzas .rename input");
      input?.focus();
      input?.select();
    } else if (b.dataset.editItem) {
      editingItem = b.dataset.editItem;
      renderItems();
      document.querySelector('#items [data-f="category"]')?.focus();
    } else if ("cancelEdit" in b.dataset) {
      editingItem = null;
      renderItems();
    } else if ("cancelRename" in b.dataset) {
      renaming = null;
      renderPizzas();
    } else if (b.dataset.del) {
      // Two taps to delete, no pop-up needed
      const [kind, id] = b.dataset.del.split(":");
      clearTimeout(armTimer);
      if (armed === b.dataset.del) {
        armed = null;
        const path = { item: "items", pizza: "pizzas", diet: "diets" }[kind];
        if (path) await store.set(`${path}/${id}`, null);
      } else {
        armed = b.dataset.del;
        armTimer = setTimeout(() => { armed = null; render(); }, 3000);
        render();
      }
    }
  });

  // IDs end up inside HTML attributes, so ignore anything that isn't a plain ID
  // (the database rules reject them too; this is a second lock on the door).
  db.watch(ROOT, (data) => {
    state = { meta: data.meta || {}, items: cleanIds(data.items), pizzas: cleanIds(data.pizzas), diets: cleanIds(data.diets) };
    render();
  });
}

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
}
