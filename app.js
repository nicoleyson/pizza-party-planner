import { firebaseConfig } from "./config.js";
import { pieHTML, ICONS, safeIcon, SAUCE_LOOKS, CHEESE_LOOKS } from "./pie.js";
import { parseCode, newCode, esc, cleanIds, voteCount, rankPizzas } from "./lib.js";

const CATS = { sauce: "Sauces", cheese: "Cheeses", topping: "Toppings", other: "Dough / drinks / other" };
const EMOJI = { sauce: "🍅", cheese: "🧀", topping: "✨", other: "🥖" };
const PIZZA_CATS = ["sauce", "cheese", "topping"];
const CAT_ONE = { sauce: "Sauce", cheese: "Cheese", topping: "Topping", other: "Other" };

const $ = (id) => document.getElementById(id);

// ── Who am I ──
// Everyone signs in with Google, so the database knows who's who and nobody
// can pretend to be someone else. In demo mode (no Firebase) we use a random
// id kept in this browser instead.
let uid = localStorage.uid || (localStorage.uid = crypto.randomUUID());
let account = null; // { auth, au, user } once signed in with Google

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
// Only real Google profile photos are ever shown (never arbitrary links from the database).
const PHOTO_RE = /^https:\/\/lh3\.googleusercontent\.com\/[-\w./=~%]+$/;
const safePhoto = (url) => (typeof url === "string" && url.length <= 300 && PHOTO_RE.test(url) ? url : "");

async function firebaseDb() {
  const base = "https://www.gstatic.com/firebasejs/10.12.2";
  const { initializeApp } = await import(`${base}/firebase-app.js`);
  const fb = await import(`${base}/firebase-database.js`);
  const app = initializeApp(firebaseConfig);
  const d = fb.getDatabase(app);
  const api = {
    watch: (p, cb, onError) =>
      fb.onValue(fb.ref(d, p), (s) => cb(s.val() || {}), (err) => (onError ? onError(err) : toast("Couldn't load: " + err.message))),
    add: (p, obj) => fb.push(fb.ref(d, p), obj),
    set: (p, val) => fb.set(fb.ref(d, p), val),
  };
  if (!firebaseConfig.apiKey) return api; // sign-in not set up yet (see config.js)
  const au = await import(`${base}/firebase-auth.js`);
  const auth = au.getAuth(app);
  const user = await new Promise((resolve) => {
    const stop = au.onAuthStateChanged(auth, (u) => { stop(); resolve(u); });
  });
  if (!user || user.isAnonymous) {
    showSignIn(auth, au);
    return null;
  }
  account = { auth, au, user };
  uid = user.uid;
  return api;
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

// ── Sign in with Google (shown before anything else) ──
function showSignIn(auth, au) {
  $("signin").hidden = false;
  $("google-signin").addEventListener("click", async () => {
    try {
      await au.signInWithPopup(auth, new au.GoogleAuthProvider());
      location.reload();
    } catch (err) {
      if (!["auth/popup-closed-by-user", "auth/cancelled-popup-request"].includes(err.code)) {
        console.error(err);
        toast(err.code === "auth/unauthorized-domain" ? "This website isn't approved for sign-in yet (host: add it in Firebase)." : "Sign-in didn't work. Try again?");
      }
    }
  });
}

// ── Start ──
const code = parseCode(location.hash) || parseCode(localStorage.lastParty);
if (!db) {
  // waiting for Google sign-in
} else if (code) {
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
  // Who's signed in (Google), with a way to sign out
  if (account) {
    const u = account.user;
    $("account").hidden = false;
    $("account").innerHTML = `Signed in as ${esc(u.displayName || u.email || "you")} · <button type="button" class="link" id="sign-out">sign out</button>`;
    $("sign-out").addEventListener("click", async () => {
      await account.au.signOut(account.auth);
      location.reload();
    });
    if (!nameInput.value && u.displayName) nameInput.value = localStorage.myName = u.displayName.split(" ")[0];
  }

  // ── Guest list (host only) ──
  const EMAIL_RE = /^[^\s@,#$[\]\/]+@[^\s@,#$[\]\/]+\.[^\s@,#$[\]\/]+$/;
  const emailKey = (e) => e.toLowerCase().replaceAll(".", ",");
  function renderGuestPanel() {
    if ($("guest-panel").hidden || document.activeElement === $("guest-emails")) return;
    $("guest-only").checked = state.meta.guestOnly === true;
    $("guest-emails").value = Object.values(state.guests || {}).filter((e) => typeof e === "string").sort().join("\n");
  }
  $("guest-btn").addEventListener("click", () => {
    $("guest-panel").hidden = !$("guest-panel").hidden;
    renderGuestPanel();
  });
  $("guest-close").addEventListener("click", () => ($("guest-panel").hidden = true));
  $("guest-save").addEventListener("click", async () => {
    if (state.meta.uid !== uid) return;
    const emails = [...new Set($("guest-emails").value.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
    const bad = emails.find((e) => !EMAIL_RE.test(e) || e.length > 100);
    if (bad) return toast(`That doesn't look like an email: ${bad}`);
    if (emails.length > 200) return toast("That's a lot of guests! Max 200.");
    const on = $("guest-only").checked;
    if (on && !emails.length) return toast("Add at least one guest email first");
    await store.set("guests", emails.length ? Object.fromEntries(emails.map((e) => [emailKey(e), e])) : null);
    await store.set("meta/guestOnly", on || null);
    $("guest-panel").hidden = true;
    toast(on ? `Invite-only is on: ${emails.length} guest${emails.length === 1 ? "" : "s"} 🔒` : "Guest list saved. Anyone with the link can join.");
  });
  $("switch-account").addEventListener("click", async () => {
    await account?.au.signOut(account.auth);
    location.reload();
  });

  // Put yourself on the "who's coming" list (name + Google photo; never your email)
  const joinParty = () => {
    const name = nameInput.value.trim().slice(0, 40);
    if (!name || !account) return;
    const photo = safePhoto(account.user.photoURL);
    const mine = state.people[uid];
    if (mine && mine.name === name && (mine.photo || "") === photo) return;
    store.set(`people/${uid}`, { name, joinedAt: mine?.joinedAt || Date.now(), ...(photo && { photo }) }).catch(() => {});
  };
  nameInput.addEventListener("change", joinParty);

  $("leave").addEventListener("click", (e) => {
    e.preventDefault();
    localStorage.removeItem("lastParty");
    location.hash = "";
    location.reload();
  });

  let state = { meta: {}, items: {}, pizzas: {}, diets: {}, people: {}, guests: {} };
  let watchingGuests = false;
  let renaming = null; // pizza id being renamed inline
  let armed = null; // "item:<id>", "pizza:<id>" or "diet:<id>" waiting for a second tap to delete
  let armTimer;
  let editingItem = null; // ingredient id being edited inline
  let styling = null; // pizza id whose look (sauce color / cheese) is being changed

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
    $("guest-btn").hidden = !isHost || !account;
    if (!isHost) $("guest-panel").hidden = true;
    $("invite-only").hidden = state.meta.guestOnly !== true;
    renderPeople();
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

  // "Who's coming": everyone who has joined, with their Google photo
  function renderPeople() {
    const list = Object.entries(state.people).sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
    $("people").hidden = !list.length;
    $("people").innerHTML = list.length
      ? `<span class="people-label">Who's coming</span>` +
        list
          .map(([id, p]) => {
            const photo = safePhoto(p.photo);
            const face = photo
              ? `<img src="${esc(photo)}" alt="" referrerpolicy="no-referrer" loading="lazy">`
              : `<i class="initial">${esc((p.name || "?").trim().charAt(0).toUpperCase())}</i>`;
            const host = id === state.meta.uid ? `<b class="host-tag">host</b>` : "";
            return `<span class="person">${face}${esc(p.name)}${host}</span>`;
          })
          .join("")
      : "";
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

  // Pick a sauce color and how cheesy the drawing is. Saves as you tap.
  function lookEditor(id, look) {
    const group = (kind, options, current) =>
      options
        .map(([key, label, color]) => {
          const on = (current || "auto") === key;
          const dot = kind === "sauce" ? (color ? `<i class="dot" style="background:${color}"></i>` : `<i class="dot auto">✨</i>`) : "";
          return `<label class="swatch"><input type="radio" name="${kind}-${id}" value="${key}" data-look="${kind}" data-pizza="${id}" ${on ? "checked" : ""}><span>${dot}${label}</span></label>`;
        })
        .join("");
    return `<div class="look-editor">
      <div class="look-row"><b>Sauce</b><div class="swatches">${group("sauce", SAUCE_LOOKS, look.sauce)}</div></div>
      <div class="look-row"><b>Cheese</b><div class="swatches">${group("cheese", CHEESE_LOOKS, look.cheese)}</div></div>
      <button type="button" class="secondary" data-style-done>Done</button>
    </div>`;
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
                     <button class="ghost" data-style="${id}" title="Change sauce color and cheese">🎨</button>
                     ${p.uid === uid ? delBtn("pizza", id) : ""}
                   </h3>`;
            return `<div class="pizza ${lead ? "leader" : ""}">
              ${pieHTML(pieItems, p.look)}
              <div class="body">
                ${heading}
                <div class="by">proposed by ${esc(p.by)}</div>
                <div class="ings">${ings || `<span class="ing">just dough, apparently</span>`}</div>
                ${count ? `<div class="voters">loved by ${Object.values(votes).map(esc).join(", ")}</div>` : ""}
                ${styling === id ? lookEditor(id, p.look || {}) : ""}
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

  // Pizza look: save the tapped sauce color / cheese right away ("auto" clears it)
  document.addEventListener("change", async (e) => {
    const { look, pizza } = e.target.dataset || {};
    if (!look || !state.pizzas[pizza]) return;
    await store.set(`pizzas/${pizza}/look/${look}`, e.target.value === "auto" ? null : e.target.value);
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
    } else if (b.dataset.style) {
      styling = styling === b.dataset.style ? null : b.dataset.style;
      renderPizzas();
    } else if ("styleDone" in b.dataset) {
      styling = null;
      renderPizzas();
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
  // Each part loads separately, so the guest list (emails) only ever goes to the host.
  let joined = false;
  const blocked = (err) => {
    if (!/permission/i.test(err.message)) return toast("Couldn't load: " + err.message);
    $("party").querySelector("main").hidden = true;
    $("party").querySelector(".header-row").hidden = true;
    $("not-invited").hidden = false;
    $("not-invited-email").textContent = account?.user.email || "your account";
  };
  db.watch(`${ROOT}/meta`, (meta) => {
    state.meta = meta;
    if (meta.uid === uid && !watchingGuests) {
      watchingGuests = true;
      db.watch(`${ROOT}/guests`, (g) => { state.guests = g; renderGuestPanel(); });
    }
    render();
  }, blocked);
  for (const part of ["items", "pizzas", "diets"]) {
    db.watch(`${ROOT}/${part}`, (data) => { state[part] = cleanIds(data); render(); }, blocked);
  }
  db.watch(`${ROOT}/people`, (data) => {
    state.people = cleanIds(data);
    renderPeople();
    if (!joined) { joined = true; joinParty(); }
  }, blocked);
}

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
}
