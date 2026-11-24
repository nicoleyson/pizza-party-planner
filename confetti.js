// 🎉 Party background: confetti that drifts down, sways and tumbles as you
// scroll, with a few little 🎉 floating along with it.
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
  const count = Math.round(Math.min(80, Math.max(28, (innerWidth * innerHeight) / 15000)));
  pieces = Array.from({ length: count }, () => {
    const depth = 0.35 + rand() * 0.65; // 1 = closest: bigger, brighter, faster
    const el = document.createElement("i");
    const kind = rand();
    const color = COLORS[Math.floor(rand() * COLORS.length)];
    if (kind < 0.7) {
      el.className = "cf cf-paper";
      el.style.width = `${(8 + rand() * 4) * depth + 3}px`;
      el.style.height = `${(15 + rand() * 7) * depth + 5}px`;
    } else {
      el.className = "cf cf-dot";
      el.style.width = el.style.height = `${10 * depth + 4}px`;
    }
    el.style.background = color;
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
  // A few small 🎉 sprinkled in. They float and tilt but don't flip like paper.
  const party = seeded(77);
  const emojiCount = Math.round(Math.min(8, Math.max(3, (innerWidth * innerHeight) / 180000)));
  for (let i = 0; i < emojiCount; i++) {
    const depth = 0.5 + party() * 0.5;
    const el = document.createElement("i");
    el.className = "cf cf-emoji";
    el.textContent = "🎉";
    el.style.fontSize = `${Math.round(15 + depth * 11)}px`;
    layer.append(el);
    pieces.push({
      el,
      // spread them out: one per column band, so they never bunch up
      x: ((i + 0.2 + party() * 0.6) / emojiCount) * innerWidth,
      y: party() * height,
      fall: 0.1 + depth * 0.3,
      sway: 8 + party() * 10,
      phase: party() * Math.PI * 2,
      spin: (party() - 0.5) * 0.08,
      flip: 0,
      turn: (party() - 0.5) * 40,
    });
  }
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

build();
