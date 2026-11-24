# Regenerate the background confetti: python3 tools/make-confetti.py
# Change the colors, counts or seeds below, then reload the site.
# Modern falling confetti: paper rectangles and dots, some turned edge-on.
# Writes two seamless tiles: a dense "shower" that repeats across the top,
# and a sparse tile for the rest of the page.
import math, random, sys
out_dir = sys.argv[1] if len(sys.argv) > 1 else "."
colors = ["#ef5b45", "#ffc94a", "#4fc29a", "#ff7aa2", "#5bb6f0", "#a98bf5"]

def scatter(w, h, n, min_d, density=lambda y: 1.0, seed=1):
    random.seed(seed)
    pts, tries = [], 0
    while len(pts) < n and tries < 20000:
        tries += 1
        x, y = random.uniform(0, w), random.uniform(0, h)
        if random.random() > density(y):
            continue
        ok = all(min(abs(x - px), w - abs(x - px)) ** 2 + (y - py) ** 2 >= min_d ** 2 for px, py in pts)
        if ok:
            pts.append((x, y))
    return pts

def piece(x, y, size, rng):
    c = rng.choice(colors)
    k = rng.random()
    rot = rng.randint(0, 179)
    if k < 0.62:  # paper rectangle; narrow ones look like they're flipping
        L = 13 * size
        W = rng.choice([7, 7, 5.5, 3]) * size
        return f'<rect x="{x - W/2:.1f}" y="{y - L/2:.1f}" width="{W:.1f}" height="{L:.1f}" rx="1.4" fill="{c}" transform="rotate({rot} {x:.1f} {y:.1f})"/>'
    if k < 0.9:   # dot, or an edge-on dot (ellipse)
        r = 4.2 * size
        ry = r if rng.random() < .6 else r * .45
        return f'<ellipse cx="{x:.1f}" cy="{y:.1f}" rx="{r:.1f}" ry="{ry:.1f}" fill="{c}" transform="rotate({rot} {x:.1f} {y:.1f})"/>'
    # a single soft curl of paper ribbon
    s = size
    return (f'<path d="M{x-9*s:.1f} {y:.1f} c{4*s:.1f} {-8*s:.1f} {10*s:.1f} {-8*s:.1f} {9*s:.1f} 0 s{5*s:.1f} {8*s:.1f} {9*s:.1f} 0" '
            f'fill="none" stroke="{c}" stroke-width="{3*s:.1f}" stroke-linecap="round" transform="rotate({rot} {x:.1f} {y:.1f})"/>')

def tile(w, h, pts, seed, opacity, wrap_y=True):
    rng = random.Random(seed)
    items = []
    for x, y in pts:
        size = rng.choice([0.8, 1, 1, 1.15, 1.3])
        p = piece(x, y, size, rng)
        items.append(p)
        # repeat pieces that cross an edge on the other side, so tiles join seamlessly
        for dx in (-w, w):
            if (dx < 0 and x > w - 14) or (dx > 0 and x < 14):
                items.append(f'<g transform="translate({dx} 0)">{p}</g>')
        if wrap_y:
            for dy in (-h, h):
                if (dy < 0 and y > h - 14) or (dy > 0 and y < 14):
                    items.append(f'<g transform="translate(0 {dy})">{p}</g>')
    body = "\n    ".join(items)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">\n'
            f'  <g opacity="{opacity}">\n    {body}\n  </g>\n</svg>\n')

# Top shower: 640 wide, 520 tall, dense at the top and thinning out
W, H = 640, 520
shower = scatter(W, H, 70, 24, density=lambda y: max(0.04, (1 - y / H) ** 1.6), seed=11)
open(f"{out_dir}/confetti-top.svg", "w").write(tile(W, H, shower, 5, .9, wrap_y=False))
# Everywhere else: a light sprinkling so long pages still feel festive
S = 460
sparse = scatter(S, S, 13, 90, seed=23)
open(f"{out_dir}/confetti.svg", "w").write(tile(S, S, sparse, 9, .75))
