import { pieHTML, ICONS, ICON_GROUPS, safeIcon, guessIcon, SAUCE_LOOKS, CHEESE_LOOKS } from "./pie.js";
import { SAFE_ID, parseCode, newCode, esc, cleanIds, cohostIds, voteCount, rankPizzas, groupItems, ingredientKey, ingredientIndex, nextAka, totalAmount, partyEndsAt, pizzaGoal, isOver, formatPartyDate, nightFields, isNight, todayISO, localDemo } from "./lib.js";
import { morph } from "./morph.js";
import { initNight } from "./night.js";

const CATS = { sauce: "Sauces", cheese: "Cheeses", topping: "Toppings", other: "Dough, drinks and more" };
const EMOJI = { sauce: "🍅", cheese: "🧀", topping: "✨", other: "🥖" };
const PIZZA_CATS = ["sauce", "cheese", "topping"];
const CAT_ONE = { sauce: "Sauce", cheese: "Cheese", topping: "Topping", other: "Other" };

const $ = (id) => document.getElementById(id);
let toastTimer; // declared up here: toast() can run while the page is still starting

// config.js holds the real keys and isn't in git (the deploy writes it from
// GitHub secrets). A fresh clone without it falls back to the example.
const { firebaseConfig } = await import("./config.js").catch(() => import("./config.example.js"));

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
// ?demo on localhost forces demo mode even when config.js is set up (see localDemo in lib.js)
const demo = localDemo(location);
const configured = !demo && firebaseConfig?.databaseURL && !firebaseConfig.databaseURL.includes("YOUR_");
if (!configured) {
  $("mode").hidden = false;
  $("mode").textContent = demo
    ? "Demo mode: no sign-in, and nothing here touches the real party data. Remove ?demo from the address to use the real site."
    : "Demo mode: data is only saved in this browser. Add your Firebase config in config.js to share with friends.";
}
// Demo parties and real parties remember "the last party you opened" separately
const LAST = demo ? "demoLastParty" : "lastParty";
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
    // The server's clock, so every phone's oven timers agree
    now: () => Date.now() + offset,
    stamp: () => fb.serverTimestamp(),
  };
  let offset = 0;
  fb.onValue(fb.ref(d, ".info/serverTimeOffset"), (s) => (offset = Number(s.val()) || 0));
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
    // localStorage.clockSkew lets the browser tests move time forward
    now: () => Date.now() + Number(localStorage.clockSkew || 0),
    stamp: () => Date.now() + Number(localStorage.clockSkew || 0),
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
const code = parseCode(location.hash) || parseCode(localStorage[LAST]);
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
  if (sessionStorage.notice) { toast(sessionStorage.notice); delete sessionStorage.notice; }
  // Only people the site owner added to hosts/ in Firebase can start parties.
  // The database rules enforce this; here we just explain it up front.
  const notHost = () => {
    $("not-host-email").textContent = account?.user.email || "this account";
    $("not-host").hidden = false;
    $("new-form").hidden = true;
  };
  if (account) {
    const key = (account.user.email || "").toLowerCase().replaceAll(".", ",");
    db.watch(`hosts/${key}`, (v) => (v === true ? ($("not-host").hidden = true, $("new-form").hidden = false) : notHost()), notHost);
  }
  $("join-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const c = parseCode($("join-code").value);
    if (!c) return toast("That doesn't look like a party code");
    location.hash = c;
  });
  $("new-date").min = todayISO();
  nightToggle("new");
  $("new-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const c = newCode();
    try {
      await db.set(`parties/${c}/meta`, {
        title: $("new-title").value.trim().slice(0, 60),
        details: $("new-details").value.trim().slice(0, 200),
        uid,
        createdAt: Date.now(),
        ...dateFields($("new-date").value),
        ...nightFields($("new-date").value, $("new-night-time").value, $("new-bake").value),
      });
    } catch (err) {
      console.error(err);
      if (/permission/i.test(err.code || err.message)) {
        notHost();
        return toast("🔒 You're not authorized to host parties.");
      }
      return toast("Hmm, that didn't save 😕 Check your connection and try again.");
    }
    location.hash = c;
  });
}

// ── The party ──
function startParty(code) {
  localStorage[LAST] = code;
  const ROOT = `parties/${code}`;
  // Saves that fail (offline, or blocked by the database rules) show a message instead of vanishing.
  const saved = (promise) =>
    Promise.resolve(promise).catch((err) => {
      console.error(err);
      toast("Hmm, that didn't save 😕 Check your connection and try again.");
      throw err;
    });
  // Once the party's over it's a keepsake: only the host's settings (name, date, guest list, cohosts) can change.
  // The database rules enforce this too.
  const over = () => isOver(state.meta, db.now());
  const locked = (p) => {
    if (!over() || p.startsWith("meta") || p.startsWith("guests") || p.startsWith("cohosts")) return false;
    // Ratings and 🌶️ picks stay open until the end of the next day (the rules check that too)
    if ((p.startsWith("ratings/") || p.startsWith("adventurous/")) && db.now() < state.meta.endsAt + 86400000) return false;
    toast("This party's over, so it can't change anymore 🍕");
    return true;
  };
  // A refused write rejects, so the code after it (like a "thanks, added!" message) doesn't run.
  const refused = () => Promise.reject(Object.assign(new Error("This party is over"), { locked: true }));
  addEventListener("unhandledrejection", (e) => e.reason?.locked && e.preventDefault());
  const store = {
    add: (p, obj) => (locked(p) ? refused() : saved(db.add(`${ROOT}/${p}`, obj))),
    set: (p, val) => (locked(p) ? refused() : saved(db.set(`${ROOT}/${p}`, val))),
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

  let copiedTimer;
  $("copy-link").addEventListener("click", async () => {
    const btn = $("copy-link");
    const link = location.href.split("#")[0] + "#" + code;
    try {
      await navigator.clipboard.writeText(link);
      btn.innerHTML = `<span class="emo">✅</span>Copied!`;
      btn.classList.add("copied");
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => { btn.innerHTML = `<span class="emo">🔗</span>Copy invite link`; btn.classList.remove("copied"); }, 2000);
      toast("Only share it with friends 🤫");
    } catch { prompt("Copy this invite link:", link); }
  });
  // Who's signed in (Google), with a way to sign out
  if (account) {
    const u = account.user;
    $("account").hidden = false;
    $("account").innerHTML = `Signed in as ${esc(u.displayName || u.email || "you")}. <button type="button" class="link" id="sign-out">Sign out</button>`;
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
  // Turning on invite-only can lock out people who already joined, so ask once first.
  let guestConfirm = false;
  const resetGuestConfirm = () => {
    guestConfirm = false;
    $("guest-warn").hidden = true;
    $("guest-save").textContent = "Save";
  };
  $("guest-btn").addEventListener("click", () => {
    $("guest-panel").hidden = !$("guest-panel").hidden;
    resetGuestConfirm();
    renderGuestPanel();
  });
  $("guest-close").addEventListener("click", () => { $("guest-panel").hidden = true; resetGuestConfirm(); });
  $("guest-only").addEventListener("change", resetGuestConfirm);
  $("guest-emails").addEventListener("input", resetGuestConfirm);
  $("guest-save").addEventListener("click", async () => {
    if (!canManage()) return;
    const emails = [...new Set($("guest-emails").value.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
    const bad = emails.find((e) => !EMAIL_RE.test(e) || e.length > 100);
    if (bad) return toast(`That doesn't look like an email: ${bad}`);
    if (emails.length > 200) return toast("That's a lot of guests! Max 200.");
    const on = $("guest-only").checked;
    if (on && !emails.length) return toast("Add at least one guest email first");
    const joinedNames = Object.entries(state.people).filter(([id]) => id !== uid).map(([, p]) => p.name).filter(Boolean);
    if (on && state.meta.guestOnly !== true && joinedNames.length && !guestConfirm) {
      guestConfirm = true;
      const n = joinedNames.length;
      $("guest-warn").textContent = `Heads up: ${n} ${n === 1 ? "person has" : "people have"} already joined (${joinedNames.join(", ")}). ` +
        `Anyone whose Google email isn't on this list will lose access. Double-check, then tap again.`;
      $("guest-warn").hidden = false;
      $("guest-save").textContent = "Yes, make it invite-only";
      return;
    }
    resetGuestConfirm();
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
    if (!name || !account || over()) return;
    const photo = safePhoto(account.user.photoURL);
    const mine = state.people[uid];
    if (mine && mine.name === name && (mine.photo || "") === photo) return;
    store.set(`people/${uid}`, { name, joinedAt: mine?.joinedAt || Date.now(), ...(photo && { photo }) }).catch(() => {});
  };
  nameInput.addEventListener("change", joinParty);

  $("leave").addEventListener("click", (e) => {
    e.preventDefault();
    localStorage.removeItem(LAST);
    location.hash = "";
    location.reload();
  });

  let state = { meta: {}, items: {}, pizzas: {}, diets: {}, people: {}, guests: {}, cohosts: [], night: cleanNight(), ratings: {}, adventurous: {} };
  // Party mode: from the host's start time until the party's over. Voting closes then.
  const night = () => isNight(state.meta, db.now());
  const voting = () => !over() && !night();
  const nightUI = initNight({
    $, esc, state, store, morph, toast, CATS, EMOJI,
    now: () => db.now(), stamp: () => db.stamp(), uid,
    night, over: () => over(), canManage: () => canManage(), render: () => render(),
    myName: () => myName(), iconOf: (it) => iconOf(it),
    openBuilder: () => {
      planningOpen = true;
      render();
      $("propose-section").scrollIntoView({ behavior: "smooth", block: "start" });
      $("pizza-name").focus({ preventScroll: true });
    },
  });
  // While party mode shows, the planning sections fold away under one button
  let planningOpen = true, wasShowing = false;
  $("planning-toggle").addEventListener("click", () => { planningOpen = !planningOpen; render(); });
  // The host made the party. Cohosts (picked by the host) can change its settings and guest list too.
  const isOwner = () => state.meta.uid === uid;
  const canManage = () => isOwner() || state.cohosts.includes(uid);
  let watchingGuests = false;
  let editingPizza = null; // pizza id whose name, toppings and look are being edited
  let armed = null; // "item:<id>", "pizza:<id>" or "diet:<id>" waiting for a second tap to delete
  let armTimer;
  let editingItem = null; // ingredient id being edited inline
  // Whoever proposed a pizza can change its toppings until someone else votes for it.
  // After that only the host and cohosts can, so nobody's vote gets swapped out from under them.
  const othersVoted = (p) => Object.keys(p.votes || {}).some((v) => v !== p.uid);
  const canEditToppings = (p) => !over() && (canManage() || (p.uid === uid && !othersVoted(p) && !night()));
  // Your grocery run: what you've ticked off is only remembered in this browser
  const GOT_KEY = `got:${code}`;
  let got = new Set(JSON.parse(localStorage[GOT_KEY] || "[]"));
  const saveGot = () => (localStorage[GOT_KEY] = JSON.stringify([...got]));

  const itemsIn = (cat) =>
    Object.entries(state.items)
      .filter(([, it]) => it.category === cat)
      .sort((a, b) => a[1].name.localeCompare(b[1].name));
  // The icon next to an ingredient's name: the one picked, else a guess (🧄 for garlic sauce), else its type's emoji
  const iconOf = (it) => safeIcon(it.icon) || guessIcon(it.name, it.category) || EMOJI[it.category] || "";
  const what = { item: "ingredient", pizza: "pizza", diet: "note" };
  const delBtn = (kind, id) =>
    armed === `${kind}:${id}`
      ? `<button class="ghost danger" data-del="${kind}:${id}">tap again to delete</button>`
      : `<button class="ghost icon-btn" data-del="${kind}:${id}" aria-label="Delete this ${what[kind]}" data-tip="Delete"><span>✕</span></button>`;

  // ── Icon picker: a searchable grid instead of a long dropdown ──
  // Any ingredient can pick one (toppings also use it on the pizza drawings).
  // The choice lives in a hidden input next to the button that opens the picker.
  const shortLabel = (label) => { const w = label.split(" / ")[0]; return w[0].toUpperCase() + w.slice(1); };
  const pickLabel = (v) => (safeIcon(v) ? `${v} ${shortLabel(ICONS.find(([e]) => e === v)[1])}` : "✨ Auto");
  const iconPickHTML = (inputAttrs, v) =>
    `<span class="icon-pick"><input type="hidden" ${inputAttrs} value="${safeIcon(v)}"><button type="button" class="icon-pick-btn" data-icon-pick aria-haspopup="dialog">${esc(pickLabel(v))}</button></span>`;
  const setPick = (input, v) => {
    input.value = safeIcon(v);
    input.nextElementSibling.textContent = pickLabel(v);
  };
  let pickFor = null;
  const dlg = $("icon-dialog");
  const iconOpt = ([e, label], cur) =>
    `<button type="button" class="icon-opt" data-icon="${e}" aria-label="${esc(label)}" aria-pressed="${e === cur}"><span>${e}</span><small>${esc(shortLabel(label))}</small></button>`;
  function renderIconGrid() {
    const q = $("icon-search").value.trim().toLowerCase();
    const cur = pickFor?.value || "";
    const auto = `<button type="button" class="icon-opt" data-icon="" aria-label="Auto: pick one for me" aria-pressed="${!cur}"><span>✨</span><small>Auto</small></button>`;
    if (!q) {
      $("icon-grid").innerHTML = `<div class="icon-opts">${auto}</div>` + ICON_GROUPS
        .map(([group, list]) => `<h3>${esc(group)}</h3><div class="icon-opts">${list.map((x) => iconOpt(x, cur)).join("")}</div>`)
        .join("");
      return;
    }
    const hits = ICONS.filter(([, label]) => label.toLowerCase().includes(q));
    $("icon-grid").innerHTML = hits.length
      ? `<div class="icon-opts">${hits.map((x) => iconOpt(x, cur)).join("")}</div>`
      : `<p class="icon-none">Nothing matches “${esc(q)}”. Try another word, or pick ✨ Auto.</p><div class="icon-opts">${auto}</div>`;
  }
  const choose = (v) => {
    if (pickFor) setPick(pickFor, v);
    dlg.close();
  };
  dlg.addEventListener("close", () => { pickFor?.nextElementSibling?.focus(); pickFor = null; });
  document.addEventListener("click", (e) => {
    const opener = e.target.closest("[data-icon-pick]");
    if (opener) {
      e.preventDefault();
      pickFor = opener.previousElementSibling;
      $("icon-search").value = "";
      renderIconGrid();
      dlg.showModal();
      $("icon-grid").scrollTop = 0;
      $("icon-search").focus();
      return;
    }
    if (!dlg.open) return;
    const opt = e.target.closest("[data-icon]");
    if (opt) return choose(opt.dataset.icon);
    if (e.target === dlg || e.target.closest("#icon-close")) dlg.close(); // tap outside, or ✕
  });
  $("icon-search").addEventListener("input", renderIconGrid);
  $("icon-search").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    // Enter takes the first match
    const first = $("icon-search").value.trim() && $("icon-grid").querySelector("[data-icon]");
    if (first) choose(first.dataset.icon);
  });

  function render() {
    const title = state.meta.title || "Pizza Party 🍕";
    $("title").textContent = title;
    document.title = title;
    $("details").textContent = state.meta.details || "";
    // The host and any cohosts can edit the party's settings
    const isHost = canManage();
    const done = over();
    const when = formatPartyDate(state.meta.date);
    $("party-date").hidden = !when;
    const starts = typeof state.meta.nightAt === "number" && !done && !night()
      ? ` · 🔥 Party mode starts at ${new Date(state.meta.nightAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Voting closes then.`
      : "";
    $("party-date").textContent = when + starts;
    // Once party mode starts only the host and cohosts add pizzas (extra dough)
    $("pizza-form").hidden = night() && !canManage();
    $("voting-closed").hidden = !night();
    $("voting-closed").textContent = canManage()
      ? "Voting's closed 🔥 Extra dough? Add a pizza here and it goes on the end of the making list."
      : "Voting closed: it's party time 🔥";
    $("party").classList.toggle("is-night", night());
    $("party").classList.toggle("is-over", done);
    $("party-over").hidden = !done;
    $("over-host").hidden = !done || !isHost;
    scheduleWrapUp();
    $("edit-meta").hidden = !isHost || !$("meta-form").hidden;
    if (!isHost) showMetaForm(false);
    $("guest-btn").hidden = !isHost || !account;
    if (!isHost) $("guest-panel").hidden = true;
    $("invite-only").hidden = state.meta.guestOnly !== true;
    renderPeople();
    renderItems();
    renderDiets();
    renderBuilder();
    renderPizzas();
    nightUI.render();
    const showing = nightUI.isShowing();
    if (showing !== wasShowing) { planningOpen = !showing; wasShowing = showing; }
    $("planning-toggle").hidden = !showing;
    $("planning-toggle").setAttribute("aria-expanded", String(planningOpen));
    $("planning-body").hidden = !planningOpen;
  }

  // Re-draw the moment the party wraps up, even if nobody touches anything.
  let wrapTimer;
  function scheduleWrapUp() {
    clearTimeout(wrapTimer);
    // ...and the moment party mode starts
    const next = [state.meta.nightAt, state.meta.endsAt].map((t) => (t || 0) - db.now()).filter((t) => t > 0 && t < 2 ** 31 - 1);
    if (next.length) wrapTimer = setTimeout(render, Math.min(...next) + 500);
  }
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && state.meta.title && render());

  // Inline editor for your own ingredient. Keeps what you've typed if the list re-renders.
  function itemEditor(id, it, drafts) {
    const v = drafts || it;
    const opt = (val, label, cur) => `<option value="${val}" ${val === cur ? "selected" : ""}>${label}</option>`;
    return `<li class="editing" data-key="edit-${id}"><form class="item-edit" data-edit-form="${id}">
      <select data-f="category" aria-label="Type">${Object.keys(CATS).map((c) => opt(c, `${EMOJI[c]} ${CAT_ONE[c]}`, v.category)).join("")}</select>
      <input data-f="name" maxlength="60" required value="${esc(v.name)}" aria-label="Ingredient">
      <input data-f="amount" maxlength="30" value="${esc(v.amount || "")}" placeholder="how much (optional)" aria-label="How much">
      ${iconPickHTML('data-f="icon"', v.icon)}
      <div class="row edit-actions"><button>Save</button><button type="button" class="secondary" data-cancel-edit>Cancel</button></div>
    </form></li>`;
  }

  function renderItems() {
    renderGrocery();
    // Hold on to an open editor's unsaved values and focus across live updates
    const form = document.querySelector("#items [data-edit-form]");
    const field = (f) => form?.querySelector(`[data-f="${f}"]`)?.value;
    const drafts = form ? { category: field("category"), name: field("name"), amount: field("amount"), icon: field("icon") } : null;
    const focused = form?.contains(document.activeElement) ? document.activeElement.dataset.f : null;
    // Every pizza needs sauce and cheese, so an empty one shows up as a gap anyone can fill
    const anything = Object.keys(state.items).length > 0;
    const gaps = anything && !over() ? ["sauce", "cheese"].filter((cat) => !itemsIn(cat).length) : [];
    $("items-lede").hidden = !gaps.length;
    $("items-lede").textContent = gaps.length ? `Still missing: ${gaps.map((c) => CAT_ONE[c].toLowerCase()).join(" and ")}.` : "";
    const html = Object.entries(CATS)
      .map(([cat, label]) => {
        const list = itemsIn(cat);
        if (gaps.includes(cat)) {
          const thing = CAT_ONE[cat].toLowerCase();
          return `<div class="cat gap" data-key="gap-${cat}"><h3 class="slip-head"><span><span class="emo">${EMOJI[cat]}</span>${label}</span><span class="n">nobody yet</span></h3>
            <p>Every pizza needs ${thing === "sauce" ? "a sauce" : "cheese"}.</p>
            <button type="button" data-bring="${cat}">I'll bring ${thing}</button></div>`;
        }
        if (!list.length) return "";
        // Same-named ingredients from different people share one row
        const groups = groupItems(list);
        return `<div class="cat cat-${cat}" data-key="cat-${cat}"><h3 class="slip-head"><span><span class="emo">${EMOJI[cat]}</span>${label}</span><span class="n">${groups.length}</span></h3><ul class="list">${groups
          .map((g) => {
            const icon = safeIcon(g.icon);
            const meToo = over() || g.entries.some(([, it]) => it.uid === uid)
              ? ""
              : `<button class="ghost me-too" data-me-too="${g.entries[0][0]}" title="Bring some of this too">+ me too</button>`;
            const name = `${icon ? `<span class="item-icon">${icon}</span>` : ""}<span class="item-name">${esc(g.name)}</span>`;
            const bringer = ([id, it]) =>
              `${it.amount ? `<span class="amt">${esc(it.amount)}</span>` : ""}${it.uid === uid ? `<span class="who you">you</span>` : `<span class="who">${esc(it.by)}</span>`}`;
            const controls = ([id, it]) =>
              it.uid === uid && !over()
                ? `<span class="mine"><button class="ghost icon-btn" data-edit-item="${id}" aria-label="Edit ${esc(it.name)}" data-tip="Edit"><span>✏️</span></button>${delBtn("item", id)}</span>`
                : "";
            const editing = ([id, it]) => id === editingItem && it.uid === uid;
            if (g.entries.length === 1) {
              const e = g.entries[0];
              if (editing(e)) return itemEditor(e[0], e[1], drafts);
              return `<li data-key="g-${esc(g.key)}"><span>${name}${bringer(e)}</span>${controls(e) || meToo}</li>`;
            }
            const total = totalAmount(g.entries);
            return `<li class="group" data-key="g-${esc(g.key)}"><div class="g-head"><span>${name}<span class="count">×${g.entries.length}</span></span>${meToo}</div>${total ? `<div class="total">= ${esc(total)}</div>` : ""}<ul class="bringers">${g.entries
              .map((e) => (editing(e) ? itemEditor(e[0], e[1], drafts) : `<li data-key="${e[0]}"><span>${bringer(e)}</span>${controls(e)}</li>`))
              .join("")}</ul></li>`;
          })
          .join("")}</ul></div>`;
      })
      .join("");
    morph($("items"), html || `<p class="empty">${over() ? "Nobody signed up to bring anything." : "Nothing yet. Add the first thing below."}</p>`);
    if (focused) document.querySelector(`#items [data-edit-form] [data-f="${focused}"]`)?.focus();
  }

  // "Who's coming": everyone who has joined, with their Google photo

  // 🛒 A short checklist of just the things you said you'd bring
  function myItems() {
    const order = Object.keys(CATS);
    return Object.entries(state.items)
      .filter(([, it]) => it.uid === uid)
      .sort((a, b) => order.indexOf(a[1].category) - order.indexOf(b[1].category) || a[1].name.localeCompare(b[1].name));
  }
  function renderGrocery() {
    const mine = myItems();
    const btn = $("list-btn");
    const panel = $("grocery");
    const left = mine.filter(([id]) => !got.has(id)).length;
    btn.hidden = !mine.length;
    if (!mine.length) { panel.hidden = true; btn.setAttribute("aria-expanded", "false"); return; }
    morph(btn, left ? `<span class="emo">🛒</span>My list <b>${left}</b>` : `<span class="emo">🛒</span>All set ✓`);
    if (panel.hidden) return;
    morph(panel, `<div class="grocery-head"><b>Your grocery run</b><button type="button" class="ghost" id="grocery-copy"><span class="emo">📋</span>Copy</button></div>
      <ul>${mine
        .map(([id, it]) => {
          const icon = iconOf(it);
          return `<li data-key="${id}"><label class="${got.has(id) ? "got" : ""}"><input type="checkbox" data-got="${id}" ${got.has(id) ? "checked" : ""}><span class="emo">${icon}</span><span class="g-name">${esc(it.name)}</span>${it.amount ? `<span class="amt">${esc(it.amount)}</span>` : ""}</label></li>`;
        })
        .join("")}</ul>`);
  }
  $("list-btn").addEventListener("click", () => {
    const panel = $("grocery");
    panel.hidden = !panel.hidden;
    $("list-btn").setAttribute("aria-expanded", String(!panel.hidden));
    renderGrocery();
  });
  $("grocery").addEventListener("change", (e) => {
    const id = e.target.dataset?.got;
    if (!id) return;
    e.target.checked ? got.add(id) : got.delete(id);
    got = new Set([...got].filter((g) => state.items[g])); // forget things you're no longer bringing
    saveGot();
    renderGrocery();
  });
  $("grocery").addEventListener("click", async (e) => {
    if (e.target.id !== "grocery-copy") return;
    const lines = myItems().map(([id, it]) => `${got.has(id) ? "✓" : "☐"} ${it.name.trim()}${it.amount ? ` (${it.amount.trim()})` : ""}`);
    const text = `🛒 ${state.meta.title || "Pizza party"}\n${lines.join("\n")}`;
    try { await navigator.clipboard.writeText(text); toast("List copied! 📋"); }
    catch { toast("Couldn't copy, sorry 😕"); }
  });
  function renderPeople() {
    const list = Object.entries(state.people).sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
    $("people").hidden = !list.length;
    morph($("people"), list.length
      ? list
          .map(([id, p]) => {
            const photo = safePhoto(p.photo);
            const face = photo
              ? `<img src="${esc(photo)}" alt="" referrerpolicy="no-referrer" loading="lazy">`
              : `<i class="initial">${esc((p.name || "?").trim().charAt(0).toUpperCase())}</i>`;
            const host = id === state.meta.uid ? `<b class="host-tag">host</b>` : state.cohosts.includes(id) ? `<b class="host-tag">cohost</b>` : "";
            return `<span class="person" data-key="${id}">${face}${esc(p.name)}${host}</span>`;
          })
          .join("")
      : "");
  }

  function renderDiets() {
    const list = Object.entries(state.diets).sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));
    morph($("diets"), list.length
      ? list
          .map(([id, d]) => `<li data-key="${id}"><span><span class="item-name">${esc(d.by)}</span><span class="diet-note">${esc(d.note)}</span></span>${
            d.uid === uid && !over() ? delBtn("diet", id) : ""
          }</li>`)
          .join("")
      : `<li class="empty">${over() ? "No dietary needs were noted." : "Nothing specified yet.<br>Please add something if you have an allergy or restriction."}</li>`);
  }

  function renderBuilder() {
    const el = $("builder");
    const checked = new Set([...el.querySelectorAll("input:checked")].map((i) => i.value));
    morph(el, PIZZA_CATS.map((cat) => {
      const list = itemsIn(cat);
      return `<div class="cat cat-${cat}" data-key="${cat}"><h3><span class="emo">${EMOJI[cat]}</span>${CATS[cat]}</h3>${
        list.length
          ? `<div class="chips">${groupItems(list)
              .map((g) => {
                const icon = iconOf(g);
                return `<label class="chip" data-key="${esc(g.key)}"><input type="checkbox" value="${esc(g.key)}" ${checked.has(g.key) ? "checked" : ""}><span>${icon ? `<span class="emo">${icon}</span>` : ""}${esc(g.name)}</span></label>`;
              })
              .join("")}</div>`
          : `<p class="empty">Nobody's bringing ${cat === "sauce" ? "a sauce" : CATS[cat].toLowerCase()} yet. ${over() ? "" : `<button type="button" class="link" data-bring="${cat}">I'll bring ${cat === "sauce" ? "one" : "some"}</button>`}</p>`
      }</div>`;
    }).join(""));
    updatePreview();
  }

  // The little pie next to "Build a pizza" shows what you've picked so far
  let baking = false;
  const pickedItems = () => {
    const groups = new Map(groupItems(Object.entries(state.items)).map((g) => [g.key, g]));
    return [...document.querySelectorAll("#builder input:checked")]
      .map((i) => groups.get(i.value))
      .filter(Boolean)
      .map((g) => ({ ...g.entries[0][1], icon: g.icon }));
  };
  function updatePreview() {
    if (!baking) $("preview-pie").innerHTML = pieHTML(pickedItems());
  }
  $("builder").addEventListener("change", updatePreview);

  // ✏️ on a pizza: change its name, toppings, sauce color and cheese in one go.
  // Anyone can rename it or change its look; toppings follow canEditToppings.
  // `d` is what's on screen right now: { name, picks: Set of names, sauce, cheese }.
  function pizzaEditor(id, p, current, d) {
    const swatches = (kind, options) =>
      options
        .map(([key, label, color]) => {
          const dot = kind === "sauce" ? (color ? `<i class="dot" style="background:${color}"></i>` : `<i class="dot auto">✨</i>`) : "";
          return `<label class="swatch"><input type="radio" name="${kind}-${id}" value="${key}" data-f="${kind}" ${d[kind] === key ? "checked" : ""}><span>${dot}${label}</span></label>`;
        })
        .join("");
    let toppings;
    if (canEditToppings(p)) {
      const chip = (name, label, cls = "") =>
        `<label class="chip ${cls}" data-key="${esc(name)}"><input type="checkbox" data-f="pick" value="${esc(name)}" ${d.picks.has(name) ? "checked" : ""}><span>${label}</span></label>`;
      const cats = PIZZA_CATS.map((cat) => {
        const groups = groupItems(itemsIn(cat));
        if (!groups.length) return "";
        return `<div class="cat cat-${cat}"><h5><span class="emo">${EMOJI[cat]}</span>${CATS[cat]}</h5><div class="chips">${groups
          .map((g) => { const icon = iconOf(g); return chip(g.name, `${icon ? `<span class="emo">${icon}</span>` : ""}${esc(g.name)}`); })
          .join("")}</div></div>`;
      }).join("");
      // Toppings nobody's bringing any more show crossed out, so you can keep or drop them
      const gone = current.filter((w) => !w.g && w.name !== "removed");
      const goneHTML = gone.length
        ? `<div class="cat"><h5>Nobody's bringing these now</h5><div class="chips">${gone.map((w) => chip(w.name, esc(w.name), "gone")).join("")}</div></div>`
        : "";
      const note = othersVoted(p) ? `<p class="edit-note">People already voted for this one, so let them know what changed.</p>` : "";
      toppings = `${note}${cats}${goneHTML}`;
    } else {
      const who = p.uid === uid ? "" : `${esc(p.by)} (until someone else votes) or `;
      toppings = `<p class="edit-note">🔒 ${othersVoted(p) && p.uid === uid ? "People have voted on this one, so only the host can change its toppings." : `Only ${who}the host can change its toppings.`}</p>`;
    }
    return `<form class="pizza-editor" data-pizza-form="${id}">
      <label class="edit-row"><b>Name</b><input data-f="name" maxlength="60" required value="${esc(d.name)}" aria-label="Pizza name"></label>
      <div class="edit-row"><b>Toppings</b>${toppings}</div>
      <div class="edit-row"><b>Sauce</b><div class="swatches">${swatches("sauce", SAUCE_LOOKS)}</div></div>
      <div class="edit-row"><b>Cheese</b><div class="swatches">${swatches("cheese", CHEESE_LOOKS)}</div></div>
      <div class="row edit-actions"><button>Save</button><button type="button" class="secondary" data-cancel-pizza>Cancel</button></div>
    </form>`;
  }
  // What's on screen in the open pizza editor, so live updates don't wipe it
  const pizzaDraft = (f) => f && {
    name: f.querySelector('[data-f="name"]').value,
    picks: new Set([...f.querySelectorAll('[data-f="pick"]:checked')].map((i) => i.value)),
    sauce: f.querySelector('[data-f="sauce"]:checked')?.value || "auto",
    cheese: f.querySelector('[data-f="cheese"]:checked')?.value || "auto",
  };

  function renderPizzas() {
    // Keep what's in an open pizza editor (and where the cursor was) across live updates
    const openForm = document.querySelector("#pizzas [data-pizza-form]");
    const draft = openForm?.dataset.pizzaForm === editingPizza ? pizzaDraft(openForm) : null;
    const focused = openForm?.contains(document.activeElement) && document.activeElement.dataset.f === "name";

    const list = rankPizzas(state.pizzas);
    const byKey = ingredientIndex(groupItems(Object.entries(state.items)));
    const top = list.length ? voteCount(list[0][1]) : 0;
    const done = over();
    // The host's goal: say how many get made, and draw a line under that many in the ranking
    const goal = pizzaGoal(state.meta);
    $("pizza-goal").hidden = !goal;
    $("pizza-goal").textContent = goal
      ? `${done ? "We were making" : "We're making"} ${goal} pizza${goal === 1 ? "" : "s"}: ${goal === 1 ? "the one" : `the ${goal}`} with the most votes${list.length < goal ? `. ${list.length} idea${list.length === 1 ? "" : "s"} so far` : ""}`
      : "";
    const cutLine = `<div class="cut-line" data-key="cut-line"><span>Above the line: the ${goal === 1 ? "pizza" : `${goal} pizzas`} we're making</span></div>`;
    morph($("pizzas"), list.length
      ? list
          .map(([id, p], i) => {
            const cut = goal && i === goal - 1 && list.length > goal ? cutLine : "";
            const votes = p.votes || {};
            const count = voteCount(p);
            const mine = !!votes[uid];
            const lead = count && count === top;
            // New pizzas list ingredient names; older ones list item ids
            const wanted = Array.isArray(p.picks)
              ? p.picks.filter((n) => typeof n === "string").map((n) => ({ name: n, g: byKey.get(ingredientKey(n)) }))
              : (p.ingredients || []).map((iid) => {
                  const it = state.items[iid];
                  return it ? { name: it.name, g: byKey.get(ingredientKey(it.name)) } : { name: "removed", g: null };
                });
            const seen = new Set();
            const unique = wanted.filter((w) => { const k = w.g?.key ?? `gone:${w.name}`; return seen.has(k) ? false : seen.add(k); });
            const order = (w) => { const i = Object.keys(CATS).indexOf(w.g?.category); return i < 0 ? 99 : i; };
            const ings = [...unique].sort((a, b) => order(a) - order(b))
              .map(({ name, g }) => {
                if (!g) return `<span class="ing gone" title="Nobody's bringing this right now">${esc(name)}</span>`;
                const icon = iconOf(g);
                const who = g.entries.map(([, it]) => it.by).join(", ");
                return `<span class="ing" title="from ${esc(who)}">${icon ? `<span class="emo">${icon}</span>` : ""}${esc(g.name)}</span>`;
              })
              .join("");
            const editing = editingPizza === id && !done;
            // While editing, the drawing shows what's ticked so far
            const d = editing && (draft || {
              name: p.name,
              picks: new Set(unique.map((w) => (w.g ? w.g.name : w.name))),
              sauce: p.look?.sauce || "auto",
              cheese: p.look?.cheese || "auto",
            });
            const pieFrom = editing && canEditToppings(p) ? [...d.picks].map((n) => byKey.get(ingredientKey(n))).filter(Boolean) : unique.filter((w) => w.g).map((w) => w.g);
            const pieItems = [...new Set(pieFrom)].map((g) => ({ ...g.entries[0][1], icon: g.icon }));
            const pieLook = editing ? { ...(d.sauce !== "auto" && { sauce: d.sauce }), ...(d.cheese !== "auto" && { cheese: d.cheese }) } : p.look;
            const heading = `<h3>${esc(p.name)}</h3>${done ? "" : `<div class="pizza-tools">
                     <button class="ghost icon-btn" data-edit-pizza="${id}" aria-label="Edit ${esc(p.name)}" aria-expanded="${editing}" data-tip="Edit"><span>✏️</span></button>
                     ${p.uid === uid && !night() ? delBtn("pizza", id) : ""}</div>`}`;
            const voteBtn = `<button class="vote ${mine ? "on" : ""}" data-vote="${id}" aria-pressed="${mine}" ${done || night() ? "disabled" : ""} aria-label="${done ? `${count} vote${count === 1 ? "" : "s"}` : mine ? "Remove your vote" : "Vote for this one"}">${done ? "" : `<span class="box" aria-hidden="true">${mine ? "✓" : ""}</span>${mine ? "Voted" : "Vote"}`}<b>${count}</b></button>`;
            return `<div class="pizza ${lead ? "leader" : ""}" data-key="${id}">
              <div class="plate">${lead ? '<span class="crown" role="img" aria-label="Most votes">👑</span>' : ""}${pieHTML(pieItems, pieLook)}</div>
              <div class="body">
                <div class="tag-top"><div>${heading}</div>${voteBtn}</div>
                <div class="by">${byLine(p.by, Object.values(votes))}</div>
                <div class="ings">${ings || `<span class="ing">just dough, apparently</span>`}</div>
                ${editing ? pizzaEditor(id, p, unique, d) : ""}
              </div>
            </div>${cut}`;
          })
          .join("")
      : `<p class="empty">${done ? "No pizzas were proposed." : "No pizzas yet. Build one above."}</p>`);
    if (focused) document.querySelector('#pizzas [data-pizza-form] [data-f="name"]')?.focus();
    renderTally(list, goal, done);
  }

  // The tally at the bottom: every pizza's votes as a bar, who voted, and where the host's goal cuts the list
  function renderTally(list, goal, done) {
    $("tally-section").hidden = !list.length;
    if (!list.length) return morph($("tally"), "");
    const max = Math.max(1, ...list.map(([, p]) => voteCount(p)));
    const making = goal ? Math.min(goal, list.length) : list.length;
    const tie = goal && list.length > goal && voteCount(list[goal - 1][1]) === voteCount(list[goal][1]) && voteCount(list[goal][1]) > 0;
    $("tally-lede").textContent = !goal
      ? `${done ? "Final votes" : "Votes so far"}. The host hasn't set how many pizzas to make.`
      : list.length <= goal
        ? `${done ? "All" : "So far, all"} ${list.length} pizza${list.length === 1 ? "" : "s"} make the cut (the goal is ${goal}).`
        : `${done ? "The" : "Right now, the"} top ${goal} get made and ${list.length - goal} ${list.length - goal === 1 ? "is" : "are"} cut.${tie ? " There's a tie for the last spot." : ""}`;
    morph($("tally"), list
      .map(([id, p], i) => {
        const count = voteCount(p);
        const cut = goal && i >= goal;
        const voters = Object.values(p.votes || {});
        const row = `<li class="tally-row ${cut ? "cut" : "made"}" data-key="${id}">
          <div class="tally-top"><span class="tally-name">${esc(p.name)}</span><span class="tally-n">${count} vote${count === 1 ? "" : "s"}</span></div>
          <div class="tally-bar" aria-hidden="true"><span style="width:${(count / max) * 100}%"></span></div>
          <div class="tally-who">${voters.length ? esc(voters.join(", ")) : "No votes yet"}</div>
        </li>`;
        const line = goal && i === making - 1 && list.length > goal
          ? `<li class="tally-cut" data-key="tally-cut" aria-hidden="true"><span>✂ cut</span></li>`
          : "";
        return row + line;
      })
      .join(""));
  }

  // ── Actions ──
  $("item-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const by = myName();
    const name = $("item-name").value.trim();
    if (!by || !name) return;
    const category = $("item-cat").value;
    const amount = $("item-amount").value.trim();
    const icon = safeIcon($("item-icon").value);
    await store.add("items", { name, category, by, uid, createdAt: Date.now(), ...(amount && { amount }), ...(icon && { icon }) });
    $("item-name").value = "";
    $("item-amount").value = "";
    setPick($("item-icon"), "");
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
    const groups = new Map(groupItems(Object.entries(state.items)).map((g) => [g.key, g]));
    const picks = [...document.querySelectorAll("#builder input:checked")]
      .map((i) => groups.get(i.value)?.name.slice(0, 60))
      .filter(Boolean);
    if (!picks.length) return toast("Pick at least one ingredient");
    const baked = pickedItems();
    if (night()) {
      // Extra dough: no vote (voting's closed), and it joins the making list
      if (!canManage()) return;
      const before = nightUI.making();
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      await store.set(`pizzas/${id}`, { name, by, uid, picks, createdAt: Date.now() });
      await nightUI.addToMaking(id, before);
    } else {
      await store.add("pizzas", { name, by, uid, picks, createdAt: Date.now(), votes: { [uid]: by } });
    }
    $("pizza-name").value = "";
    document.querySelectorAll("#builder input:checked").forEach((i) => (i.checked = false));
    toast(`${name} is in the oven 🍕🔥`);
    // Bake it: the sauce spreads, the cheese melts, the toppings drop on. Then the preview resets.
    const preview = $("preview-pie");
    baking = true;
    preview.innerHTML = pieHTML(baked);
    preview.classList.remove("baking");
    void preview.offsetWidth; // restart the animation
    preview.classList.add("baking");
    setTimeout(() => { baking = false; preview.classList.remove("baking"); updatePreview(); }, 2200);
  });

  // Party name + details: the creator edits them right in the header
  function showMetaForm(on) {
    $("meta-form").hidden = !on;
    $("meta-view").hidden = on;
    $("edit-meta").hidden = on || !canManage();
    if (on) {
      $("meta-title").value = state.meta.title || "";
      $("meta-details").value = state.meta.details || "";
      $("meta-date").value = state.meta.date || "";
      $("meta-night-time").value = state.meta.nightTime || "";
      $("meta-bake").value = state.meta.bakeMinutes || "";
      $("meta-night").hidden = !$("meta-date").value;
      $("meta-goal").value = pizzaGoal(state.meta) || "";
      renderCohostPicker();
      $("meta-title").focus();
    }
  }
  // Only the host picks cohosts, from the people who've joined
  function renderCohostPicker() {
    $("cohost-field").hidden = !isOwner();
    if (!isOwner()) return;
    const others = Object.entries(state.people).filter(([id]) => id !== uid).sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
    $("cohost-empty").hidden = others.length > 0;
    $("cohost-chips").innerHTML = others
      .map(([id, p]) => `<label class="chip"><input type="checkbox" data-cohost="${id}" ${state.cohosts.includes(id) ? "checked" : ""}><span>${esc(p.name)}</span></label>`)
      .join("");
  }
  $("edit-meta").addEventListener("click", () => showMetaForm(true));
  nightToggle("meta");
  $("reopen").addEventListener("click", () => { showMetaForm(true); $("meta-date").focus(); });
  $("meta-cancel").addEventListener("click", () => showMetaForm(false));
  $("meta-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = $("meta-title").value.trim().slice(0, 60);
    if (!title || !canManage()) return;
    const date = $("meta-date").value;
    if (date && !partyEndsAt(date)) return toast("That date doesn't look right");
    const goalText = $("meta-goal").value.trim();
    const goal = pizzaGoal({ pizzaGoal: Number(goalText) });
    if (goalText && !goal) return toast("Pick a number of pizzas from 1 to 50");
    const wasOver = over();
    const { date: _d, endsAt: _e, pizzaGoal: _g, nightTime: _t, nightAt: _n, bakeMinutes: _b, ...rest } = state.meta;
    await store.set("meta", { ...rest, title, details: $("meta-details").value.trim().slice(0, 200), ...dateFields(date), ...nightFields(date, $("meta-night-time").value, $("meta-bake").value), ...(goal && { pizzaGoal: goal }) });
    if (isOwner()) {
      for (const box of document.querySelectorAll("#cohost-chips [data-cohost]")) {
        const id = box.dataset.cohost;
        if (box.checked !== state.cohosts.includes(id)) await store.set(`cohosts/${id}`, box.checked || null);
      }
    }
    showMetaForm(false);
    toast(wasOver && !isOver({ endsAt: partyEndsAt(date) }) ? "The party's back on! 🎉" : "Party updated ✨");
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
    const icon = safeIcon(get("icon"));
    // Remember the old name so pizzas that picked it still find this ingredient
    const aka = nextAka(it, name);
    editingItem = null;
    await store.set(`items/${id}`, { name, category, by: it.by, uid: it.uid, createdAt: it.createdAt || Date.now(), ...(amount && { amount }), ...(icon && { icon }), ...(aka.length && { aka }) });
    toast(`${name} updated ✨`);
  });

  // Redraw the pie as you tick toppings or tap a sauce color in the pizza editor
  $("pizzas").addEventListener("change", (e) => e.target.closest("[data-pizza-form]") && renderPizzas());

  // Save the pizza editor: only what changed, and toppings only if you're allowed
  document.addEventListener("submit", async (e) => {
    const f = e.target.closest("[data-pizza-form]");
    if (!f) return;
    e.preventDefault();
    const id = f.dataset.pizzaForm;
    const p = state.pizzas[id];
    if (!p || over()) return;
    const d = pizzaDraft(f);
    const name = d.name.trim().slice(0, 60);
    if (!name) return;
    const picks = [...new Set([...d.picks].map((n) => n.trim().slice(0, 60)))].filter(Boolean);
    const toppings = canEditToppings(p);
    if (toppings && !picks.length) return toast("Pick at least one ingredient");
    const old = Array.isArray(p.picks) ? p.picks : null;
    const writes = [];
    if (name !== p.name) writes.push([`pizzas/${id}/name`, name]);
    if (toppings && (!old || old.length !== picks.length || old.some((n, i) => n !== picks[i]))) writes.push([`pizzas/${id}/picks`, picks]);
    for (const kind of ["sauce", "cheese"]) {
      const v = d[kind] === "auto" ? null : d[kind];
      if (v !== (p.look?.[kind] ?? null)) writes.push([`pizzas/${id}/look/${kind}`, v]);
    }
    editingPizza = null;
    try {
      for (const [path, val] of writes) await store.set(path, val);
      if (writes.length) toast(`${name} updated 🍕`);
    } catch {
      toast("Couldn't save all of that, sorry 😕");
    }
    renderPizzas();
  });

  document.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.vote) {
      const by = myName();
      if (!by || !voting()) return;
      const id = b.dataset.vote;
      await store.set(`pizzas/${id}/votes/${uid}`, state.pizzas[id]?.votes?.[uid] ? null : by);
    } else if (b.dataset.editPizza) {
      editingPizza = editingPizza === b.dataset.editPizza ? null : b.dataset.editPizza;
      renderPizzas();
      document.querySelector('#pizzas [data-pizza-form] [data-f="name"]')?.focus();
    } else if ("cancelPizza" in b.dataset) {
      editingPizza = null;
      renderPizzas();
    } else if (b.dataset.meToo) {
      // Bring some of what someone else is bringing: same name/type/icon, your own amount
      const src = state.items[b.dataset.meToo];
      const by = myName();
      if (!src || !by) return;
      const icon = safeIcon(src.icon);
      const ref = await store.add("items", { name: src.name.trim().slice(0, 60), category: src.category, by, uid, createdAt: Date.now(), ...(icon && { icon }) });
      toast(`You're bringing ${src.name.trim()} too! Add how much if you like ✨`);
      if (ref?.key) {
        editingItem = ref.key;
        renderItems();
        document.querySelector('#items [data-edit-form] [data-f="amount"]')?.focus();
      }
    } else if (b.dataset.bring) {
      $("item-cat").value = b.dataset.bring;
      $("item-name").focus();
      $("item-name").scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (b.dataset.editItem) {
      editingItem = b.dataset.editItem;
      renderItems();
      document.querySelector('#items [data-f="category"]')?.focus();
    } else if ("cancelEdit" in b.dataset) {
      editingItem = null;
      renderItems();
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
  // Party-mode data that can't be read (rules not updated yet) just leaves party mode off
  const partyModeUnreadable = () => {};
  const blocked = (err) => {
    if (!/permission/i.test(err.message)) return toast("Couldn't load: " + err.message);
    $("party").querySelector("main").hidden = true;
    $("party").querySelector(".header-row").hidden = true;
    $("not-invited").hidden = false;
    $("not-invited-email").textContent = account?.user.email || "your account";
  };
  // Load the party's title first: if the party doesn't exist (wrong or old link,
  // or the host deleted it), go back to the join/host screen. The rules refuse
  // everything else under a party that doesn't exist.
  // The guest list (emails) loads only for the host and cohosts
  function watchGuests() {
    if (!canManage() || watchingGuests) return;
    watchingGuests = true;
    db.watch(`${ROOT}/guests`, (g) => { state.guests = g; renderGuestPanel(); }, () => { watchingGuests = false; state.guests = {}; });
  }
  let loading = false;
  db.watch(`${ROOT}/meta`, (meta) => {
    if (!meta.title) {
      localStorage.removeItem(LAST);
      sessionStorage.notice = "That party doesn't exist anymore 🤷 Check the link, or host a new one.";
      location.hash = "";
      return;
    }
    state.meta = meta;
    watchGuests();
    render();
    if (loading) return;
    loading = true;
    db.watch(`${ROOT}/cohosts`, (data) => { state.cohosts = cohostIds(data); watchGuests(); render(); }, () => {});
    for (const part of ["items", "pizzas", "diets"]) {
      db.watch(`${ROOT}/${part}`, (data) => { state[part] = cleanIds(data); render(); }, blocked);
    }
    db.watch(`${ROOT}/ratings`, (data) => { state.ratings = cleanIds(data); render(); }, partyModeUnreadable);
    db.watch(`${ROOT}/night`, (data) => { state.night = cleanNight(data); render(); }, partyModeUnreadable);
    db.watch(`${ROOT}/adventurous`, (data) => {
      state.adventurous = Object.fromEntries(Object.entries(data || {}).filter(([k, v]) => SAFE_ID.test(k) && typeof v === "string" && SAFE_ID.test(v)));
      render();
    }, partyModeUnreadable);
    db.watch(`${ROOT}/people`, (data) => {
      state.people = cleanIds(data);
      renderPeople();
      if (!joined) { joined = true; joinParty(); }
    }, blocked);
  }, blocked);
}

// { date, endsAt } for a picked date, or nothing (an open-ended party).
// "Proposed by Matt", "Proposed and voted by Matt", "Proposed by Matt, voted by Alex and Jo"
function byLine(by, lovers) {
  const and = (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
  if (!lovers.length) return `Proposed by ${esc(by)}`;
  if (lovers.length === 1 && lovers[0] === by) return `Proposed and voted by ${esc(by)}`;
  return `Proposed by ${esc(by)}, voted by ${esc(and(lovers))}`;
}

// Party mode's start time and bake time only make sense with a date: show them once one's picked
function nightToggle(pre) {
  const show = () => ($(`${pre}-night`).hidden = !$(`${pre}-date`).value);
  $(`${pre}-date`).addEventListener("input", show);
  $(`${pre}-date`).addEventListener("change", show);
}

// Party mode data, with anything odd dropped
function cleanNight(n) {
  n = n && typeof n === "object" ? n : {};
  const obj = (o) => (o && typeof o === "object" ? o : {});
  return {
    plan: typeof n.plan === "string" ? n.plan : "",
    order: Object.values(obj(n.order)).filter((id) => typeof id === "string" && SAFE_ID.test(id)),
    notes: Object.fromEntries(Object.entries(obj(n.notes)).filter(([k, v]) => SAFE_ID.test(k) && typeof v === "string")),
    prep: Object.fromEntries(Object.entries(obj(n.prep)).filter(([k, v]) => /^[a-z0-9_]{1,60}$/.test(k) && v === true)),
    prepDay: Object.fromEntries(Object.entries(obj(n.prepDay)).filter(([k, v]) => /^[a-z0-9_]{1,60}$/.test(k) && Number.isInteger(v) && v >= 0 && v <= 7)),
    tasks: Object.fromEntries(Object.entries(obj(n.tasks)).filter(([k, t]) => /^[a-z0-9]{1,30}$/.test(k) && t && typeof t.text === "string" && Number.isInteger(t.days) && t.days >= 0 && t.days <= 7)
      .map(([k, t]) => [k, { text: t.text, days: t.days, createdAt: Number(t.createdAt) || 0 }])),
    ingNotes: Object.fromEntries(Object.entries(obj(n.ingNotes)).filter(([k, v]) => /^[a-z0-9_]{1,60}$/.test(k) && typeof v === "string")),
    oven: cleanIds(n.oven),
  };
}

function dateFields(date) {
  const endsAt = partyEndsAt(date);
  return endsAt ? { date, endsAt } : {};
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
}
