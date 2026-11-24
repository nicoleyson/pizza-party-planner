// 🎉 Party background: confetti that drifts down, sways and tumbles as you
// scroll, plus two party poppers bursting next to the top card.
// Purely decorative: hidden from screen readers, never catches clicks, and it
// holds still for people who ask their device to reduce motion.

const COLORS = ["#ef5b45", "#ffc94a", "#4fc29a", "#ff7aa2", "#5bb6f0", "#a98bf5"];
const still = matchMedia("(prefers-reduced-motion: reduce)");

// Same "random" layout on every visit, so the page doesn't reshuffle itself.
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const layer = document.createElement("div");
layer.className = "confetti-layer";
layer.setAttribute("aria-hidden", "true");
document.body.prepend(layer);

let pieces = [];
let height = innerHeight;

function build() {
  const rand = seeded(2024);
  layer.textContent = "";
  height = innerHeight + 80;
  const count = Math.round(Math.min(110, Math.max(36, (innerWidth * innerHeight) / 12000)));
  pieces = Array.from({ length: count }, () => {
    const depth = 0.35 + rand() * 0.65; // 1 = closest: bigger, brighter, faster
    const el = document.createElement("i");
    const kind = rand();
    const color = COLORS[Math.floor(rand() * COLORS.length)];
    if (kind < 0.62) {
      el.className = "cf cf-paper";
      el.style.width = `${(8 + rand() * 4) * depth + 3}px`;
      el.style.height = `${(15 + rand() * 7) * depth + 5}px`;
      el.style.background = color;
    } else if (kind < 0.84) {
      el.className = "cf cf-dot";
      el.style.width = el.style.height = `${10 * depth + 4}px`;
      el.style.background = color;
    } else {
      el.className = "cf cf-curl";
      el.style.width = el.style.height = `${18 * depth + 8}px`;
      el.style.color = color;
    }
    el.style.opacity = (0.45 + depth * 0.5).toFixed(2);
    layer.append(el);
    return {
      el,
      x: rand() * innerWidth,
      y: rand() * height,
      fall: 0.12 + depth * 0.45, // how far it falls per pixel scrolled
      sway: 6 + rand() * 18,
      phase: rand() * Math.PI * 2,
      spin: (rand() - 0.5) * 0.9,
      flip: 0.4 + rand() * 1.2,
      turn: rand() * 360,
    };
  });
  draw();
}

function draw() {
  const s = still.matches ? 0 : scrollY;
  for (const p of pieces) {
    const y = (((p.y + s * p.fall) % height) + height) % height - 40;
    const x = p.x + Math.sin((s * p.fall + p.y) / 110 + p.phase) * p.sway;
    p.el.style.transform =
      `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${(p.turn + s * p.spin).toFixed(1)}deg) rotateX(${(s * p.flip).toFixed(1)}deg)`;
  }
}

let queued = false;
addEventListener("scroll", () => {
  if (queued || still.matches) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; draw(); });
}, { passive: true });

let resizeTimer;
addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(build, 150); });
still.addEventListener?.("change", draw);

// ── Party poppers next to the top card (wide screens only, see style.css) ──
const POPPER = `<svg viewBox="0 0 200 200" aria-hidden="true">
  <g fill="none" stroke-linecap="round" stroke-width="4.5">
    <path d="M86 104 q8 -34 34 -44 t30 -46" stroke="#ff7aa2"/>
    <path d="M96 114 q28 -14 46 -6 t42 -22" stroke="#5bb6f0"/>
    <path d="M80 96 q-8 -28 8 -48 t6 -42" stroke="#4fc29a"/>
  </g>
  <g>
    <rect x="128" y="74" width="8" height="15" rx="1.5" fill="#ef5b45" transform="rotate(30 132 81)"/>
    <rect x="158" y="96" width="8" height="15" rx="1.5" fill="#ffc94a" transform="rotate(-40 162 103)"/>
    <rect x="112" y="34" width="7" height="14" rx="1.5" fill="#a98bf5" transform="rotate(65 115 41)"/>
    <rect x="170" y="58" width="7" height="14" rx="1.5" fill="#4fc29a" transform="rotate(15 173 65)"/>
    <rect x="146" y="128" width="7" height="14" rx="1.5" fill="#ff7aa2" transform="rotate(-70 149 135)"/>
    <circle cx="146" cy="50" r="5" fill="#5bb6f0"/>
    <circle cx="132" cy="112" r="4.5" fill="#ffc94a"/>
    <circle cx="100" cy="22" r="4" fill="#ef5b45"/>
    <circle cx="184" cy="90" r="4" fill="#a98bf5"/>
  </g>
  <g stroke="#4a2c22" stroke-width="4" stroke-linejoin="round">
    <path d="M26 182 L60 96 L110 140 Z" fill="#ffc94a"/>
    <path d="M38 152 L72 118 M48 126 L64 112" stroke="#ef5b45" stroke-width="7" stroke-linecap="round"/>
    <path d="M26 182 L60 96 L110 140 Z" fill="none"/>
    <ellipse cx="85" cy="118" rx="34" ry="9" transform="rotate(42 85 118)" fill="#ef5b45"/>
  </g>
</svg>`;
const poppers = document.createElement("div");
poppers.className = "poppers";
poppers.setAttribute("aria-hidden", "true");
poppers.innerHTML = `<div class="popper left">${POPPER}</div><div class="popper right">${POPPER}</div>`;
document.body.prepend(poppers);

build();
