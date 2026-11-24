import { firebaseConfig } from "./config.js";

const CATS = { sauce: "Sauces", cheese: "Cheeses", topping: "Toppings", other: "Dough / drinks / other" };
const PIZZA_CATS = ["sauce", "cheese", "topping"];
const $ = (id) => document.getElementById(id);

// ── Who am I (no accounts: a random id + name saved in this browser) ──
const uid = localStorage.uid || (localStorage.uid = crypto.randomUUID());

// ── Which party: the secret code lives after the # in the invite link ──
// It's never sent to GitHub's servers and never stored in the repo.
const CODE_RE = /^[a-z0-9-]{12,40}$/;
const parseCode = (s) => {
  s = String(s || "").trim().toLowerCase();
  if (s.includes("#")) s = s.split("#").pop();
  return CODE_RE.test(s) ? s : null;
};
function newCode() {
  const words = ["pepperoni", "basil", "mozz", "crust", "oregano", "calzone", "garlic", "olive", "funghi", "marinara"];
  const rand = [...crypto.getRandomValues(new Uint8Array(10))].map((b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
  return `${words[Math.floor(Math.random() * words.length)]}-${rand}`;
}
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
  const store = {
    add: (p, obj) => db.add(`${ROOT}/${p}`, obj),
    set: (p, val) => db.set(`${ROOT}/${p}`, val),
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

  let state = { meta: {}, items: {}, pizzas: {} };

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const itemsIn = (cat) =>
    Object.entries(state.items)
      .filter(([, it]) => it.category === cat)
      .sort((a, b) => a[1].name.localeCompare(b[1].name));

  function render() {
    const title = state.meta.title || "Pizza Party 🍕";
    $("title").textContent = title;
    document.title = title;
    $("details").textContent = state.meta.details || "";
    $("edit-meta").hidden = state.meta.uid !== uid;
    renderItems();
    renderBuilder();
    renderPizzas();
  }

  function renderItems() {
    const html = Object.entries(CATS)
      .map(([cat, label]) => {
        const list = itemsIn(cat);
        if (!list.length) return "";
        return `<div class="cat"><h3>${label}</h3><ul class="list">${list
          .map(([id, it]) => `<li><span><span class="item-name">${esc(it.name)}</span>${it.amount ? `<span class="amt">${esc(it.amount)}</span>` : ""}<span class="who">from ${esc(it.by)}</span></span>${
            it.uid === uid ? `<button class="ghost" data-del-item="${id}" title="Remove">✕</button>` : ""
          }</li>`)
          .join("")}</ul></div>`;
      })
      .join("");
    $("items").innerHTML = html || `<p class="empty">Nobody has signed up to bring anything yet. Be the first!</p>`;
  }

  function renderBuilder() {
    const el = $("builder");
    const checked = new Set([...el.querySelectorAll("input:checked")].map((i) => i.value));
    el.innerHTML = PIZZA_CATS.map((cat) => {
      const list = itemsIn(cat);
      return `<div class="cat"><h3>${CATS[cat]}</h3>${
        list.length
          ? `<div class="chips">${list
              .map(([id, it]) => `<label class="chip"><input type="checkbox" value="${id}" ${checked.has(id) ? "checked" : ""}><span>${esc(it.name)}</span></label>`)
              .join("")}</div>`
          : `<p class="empty">No ${CATS[cat].toLowerCase()} committed yet.</p>`
      }</div>`;
    }).join("");
  }

  function renderPizzas() {
    const voteCount = (p) => Object.keys(p.votes || {}).length;
    const list = Object.entries(state.pizzas).sort((a, b) => voteCount(b[1]) - voteCount(a[1]) || a[1].createdAt - b[1].createdAt);
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
                return it
                  ? `<span class="ing" title="brought by ${esc(it.by)}">${esc(it.name)}</span>`
                  : `<span class="ing gone" title="no longer on the list">removed</span>`;
              })
              .join("");
            return `<div class="pizza ${lead ? "leader" : ""}">
              <button class="vote ${mine ? "on" : ""}" data-vote="${id}" aria-pressed="${mine}"><b>${count}</b><small>${mine ? "voted" : "vote"}</small></button>
              <div class="body">
                <h3>${lead ? "👑 " : ""}${esc(p.name)}
                  <button class="ghost" data-rename="${id}" title="Rename">✏️</button>
                  ${p.uid === uid ? `<button class="ghost" data-del-pizza="${id}" title="Delete">✕</button>` : ""}
                </h3>
                <div class="by">proposed by ${esc(p.by)}</div>
                <div class="ings">${ings || `<span class="ing">just dough, apparently</span>`}</div>
                ${count ? `<div class="voters">❤️ ${Object.values(votes).map(esc).join(", ")}</div>` : ""}
              </div>
            </div>`;
          })
          .join("")
      : `<p class="empty">No pizzas proposed yet.</p>`;
  }

  // ── Actions ──
  $("item-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const by = myName();
    const name = $("item-name").value.trim();
    if (!by || !name) return;
    const amount = $("item-amount").value.trim();
    await store.add("items", { name, category: $("item-cat").value, by, uid, createdAt: Date.now(), ...(amount && { amount }) });
    $("item-name").value = "";
    $("item-amount").value = "";
    toast(`Thanks ${by}! ${name} added.`);
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
    toast(`${name} is on the menu 🍕`);
  });

  $("edit-meta").addEventListener("click", async () => {
    const title = prompt("Party name:", state.meta.title)?.trim();
    if (!title) return;
    const details = prompt("When / where:", state.meta.details || "");
    await store.set("meta", { ...state.meta, title: title.slice(0, 60), details: (details ?? state.meta.details ?? "").trim().slice(0, 200) });
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
      const id = b.dataset.rename;
      const name = prompt("New name for this pizza:", state.pizzas[id]?.name)?.trim();
      if (name) await store.set(`pizzas/${id}/name`, name.slice(0, 60));
    } else if (b.dataset.delItem) {
      if (confirm("Remove this from the list?")) await store.set(`items/${b.dataset.delItem}`, null);
    } else if (b.dataset.delPizza) {
      if (confirm("Delete this pizza (and its votes)?")) await store.set(`pizzas/${b.dataset.delPizza}`, null);
    }
  });

  db.watch(ROOT, (data) => {
    state = { meta: data.meta || {}, items: data.items || {}, pizzas: data.pizzas || {} };
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
