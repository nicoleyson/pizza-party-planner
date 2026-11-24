// Update a list in place instead of rebuilding it, so live updates from friends
// don't make the page jump, steal focus, or close what you're typing in.
//
// morph(el, html) makes el's children match html, reusing the elements that are
// already there. Children with a data-key are matched by key (so a pizza that moves
// up the ranking keeps its element); the rest are matched in order by tag.

export function morph(el, html) {
  const next = el.cloneNode(false);
  next.innerHTML = html;
  patchChildren(el, next);
}

const keyOf = (n) => (n.nodeType === 1 && n.dataset.key) || null;

function patchChildren(from, to) {
  const oldKids = [...from.childNodes];
  const newKids = [...to.childNodes];
  const byKey = new Map();
  for (const n of oldKids) if (keyOf(n)) byKey.set(keyOf(n), n);
  const used = new Set();
  let cursor = 0; // next unkeyed old child to try

  newKids.forEach((n, i) => {
    let match = null;
    const key = keyOf(n);
    if (key) {
      const old = byKey.get(key);
      if (old && old.nodeName === n.nodeName && !used.has(old)) match = old;
    } else {
      while (cursor < oldKids.length && (used.has(oldKids[cursor]) || keyOf(oldKids[cursor]))) cursor++;
      const old = oldKids[cursor];
      if (old && old.nodeName === n.nodeName) { match = old; cursor++; }
    }
    if (match) {
      used.add(match);
      patchNode(match, n);
    } else {
      match = n;
    }
    const here = from.childNodes[i];
    if (here !== match) from.insertBefore(match, here || null);
  });
  while (from.childNodes.length > newKids.length) from.lastChild.remove();
}

function patchNode(a, b) {
  if (a.nodeType !== 1) {
    if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue;
    return;
  }
  for (const { name } of [...a.attributes]) if (!b.hasAttribute(name)) a.removeAttribute(name);
  for (const { name, value } of b.attributes) if (a.getAttribute(name) !== value) a.setAttribute(name, value);
  patchChildren(a, b);
  // Form controls: the attribute says what it should be; never touch what someone is typing in.
  const typing = a === document.activeElement;
  if (a.nodeName === "INPUT") {
    if (a.type === "checkbox" || a.type === "radio") a.checked = b.hasAttribute("checked");
    else if (!typing) a.value = b.getAttribute("value") ?? "";
  } else if (a.nodeName === "SELECT" && !typing) {
    const picked = [...b.options].findIndex((o) => o.hasAttribute("selected"));
    a.selectedIndex = Math.max(picked, 0);
  }
}
