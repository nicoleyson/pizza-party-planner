// Mini pizza drawings: pure CSS, colors guessed from ingredient names.
// Order matters: the first rule that matches wins, so specific phrases
// ("olive oil", "pepper flakes", "eggplant") come before the general ones.
// Every pattern matches at word starts, so "ham" won't fire on "graham".

const TOPPINGS = [
  // Drizzles and sprinkles before the solid things they mention
  [/\b(olive |chil[il]i |garlic |truffle )?oil\b|\bdrizzle\b/, "#d8b740"],
  [/\b(red )?pepper flakes?\b|\bchil[il]i flakes?\b|\bcrushed red\b|\bflakes?\b/, "#d35400"],
  [/\bhot honey\b|\bhoney\b/, "#f0a830"],
  [/\begg ?plants?\b|\baubergines?\b/, "#5b2a5e"],
  // Meats
  [/\bpepperoni|\bsalami|\bchorizo|\bsoppressata|\bnduja\b/, "#c0392b"],
  [/\bsausages?\b|\bmeatballs?\b|\bbeef\b|\bbacon\b|\bpancetta\b|\bguanciale\b/, "#8a4b2e"],
  [/\bham\b|\bprosciutto\b|\bturkey\b|\bchicken\b|\bpork\b/, "#f0a99a"],
  [/\banchov|\btuna\b|\bshrimps?\b|\bprawns?\b/, "#b0a090"],
  // Veg
  [/\bmushrooms?\b|\bfunghi\b|\bporcini\b|\bshiitake\b/, "#c9a77c"],
  [/\bolives?\b|\bkalamata\b/, "#3a2f2b"],
  [/\bred peppers?\b|\broasted peppers?\b|\bpiquillo\b/, "#e74c3c"],
  [/\bjalape|\bpepperoncini\b|\bchil[il]i(e?s)?\b|\b(bell |green )?peppers?\b/, "#5cb85c"],
  [/\bbasil\b|\bspinach\b|\barugula\b|\brocket\b|\bkale\b|\bherbs?\b|\boregano\b|\bparsley\b|\bpesto\b/, "#3f8a3a"],
  [/\bonions?\b|\bshallots?\b/, "#c77dab"],
  [/\bpineapples?\b|\bcorn\b|\bsweetcorn\b/, "#f5c542"],
  [/\btomato(es)?\b|\bcherry tom/, "#e74c3c"],
  [/\bgarlic\b/, "#f4ead2"],
  [/\beggs?\b/, "#fff8dc"],
  [/\bfigs?\b/, "#6d3b5e"],
  [/\bpotato(es)?\b/, "#e8cf8f"],
  [/\bartichokes?\b|\bzucchini\b|\bcourgettes?\b|\bbroccoli\b/, "#7fa65a"],
  [/\bblueberr|\bblackberr|\bberr(y|ies)\b/, "#4b3f8f"],
  [/\bstrawberr|\braspberr/, "#d63a4f"],
  [/\bgrapes?\b/, "#7d3c98"],
  [/\bpickles?\b|\bcucumbers?\b|\bpeas\b/, "#8fae3a"],
  [/\bbananas?\b|\bmango(es)?\b/, "#f2c94c"],
  [/\bsteak\b|\bbrisket\b/, "#7a3b2e"],
];

const SAUCES = [
  [/\bpesto\b|\bbasil\b|\bgreen\b/, "#7da443"],
  [/\bbbq\b|\bbarbecue\b|\bbarbeque\b/, "#7b3420"],
  [/\bbuffalo\b|\bsriracha\b|\bhot sauce\b|\bvodka\b|\brosa\b/, "#e8735a"],
  [/\bcranberr|\blingonberr|\bcherry\b|\bjam\b/, "#9b1b30"],
  [/\bchocolate\b|\bnutella\b/, "#5a3a29"],
  [/\boil\b/, "#e9cf7a"],
  [/\bwhite\b|\balfredo\b|\bgarlic\b|\bcream\b|\bricotta\b|\bb[eé]chamel\b|\branch\b|\bbianca\b/, "#f6ecd6"],
];
const TOMATO = "#d9472b";
const NO_SAUCE = "#f3d9a4";

// Unknown toppings get a stable color derived from the name,
// so "gummy bears" looks the same on everyone's screen.
const FALLBACK = ["#e67e22", "#9b59b6", "#16a085", "#d35400", "#2c3e50", "#1abc9c", "#e84393"];
function hashColor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return FALLBACK[h % FALLBACK.length];
}

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function toppingColor(name) {
  const n = norm(name);
  return TOPPINGS.find(([re]) => re.test(n))?.[1] ?? hashColor(n);
}

export function sauceColor(name) {
  const n = norm(name);
  return SAUCES.find(([re]) => re.test(n))?.[1] ?? TOMATO;
}

// Icons people can pick when the auto-guess looks wrong.
export const ICONS = [
  // veggies
  ["🍅", "tomato"], ["🫒", "olive"], ["🍄", "mushroom"], ["🧅", "onion"], ["🧄", "garlic"],
  ["🫑", "bell pepper"], ["🌶️", "chili"], ["🌿", "herbs"], ["🌱", "sprouts / microgreens"], ["🥬", "leafy greens"],
  ["🥦", "broccoli"], ["🍆", "eggplant"], ["🥒", "pickles / cucumber"], ["🫛", "peas"], ["🫘", "beans"],
  ["🌽", "corn"], ["🥔", "potato"], ["🍠", "sweet potato"], ["🥕", "carrot"], ["🥑", "avocado"],
  ["🫚", "ginger"],
  // fruit
  ["🍓", "strawberry"], ["🫐", "blueberries / berries"], ["🍒", "cherry"], ["🍇", "grapes"], ["🍍", "pineapple"],
  ["🍑", "peach"], ["🍐", "pear"], ["🍎", "apple"], ["🍌", "banana"], ["🥭", "mango"],
  ["🥝", "kiwi"], ["🍉", "watermelon"], ["🍊", "orange"], ["🍋", "lemon"], ["🥥", "coconut"],
  // meat & seafood
  ["🥓", "bacon"], ["🍗", "chicken / turkey"], ["🍖", "meat"], ["🥩", "steak"], ["🌭", "sausage"],
  ["🦐", "shrimp"], ["🦀", "crab"], ["🦞", "lobster"], ["🦑", "squid / calamari"], ["🐙", "octopus"],
  ["🐟", "fish"], ["🥚", "egg"],
  // everything else
  ["🧀", "extra cheese"], ["🍞", "bread / stuffing"], ["🍟", "fries"], ["🥨", "pretzel"], ["🧆", "falafel"],
  ["🥜", "nuts"], ["🌰", "chestnut"], ["🍯", "honey"], ["🧈", "butter"], ["🧂", "salt / spice"],
  ["🍫", "chocolate"], ["🍪", "cookie"], ["🍬", "candy"], ["🍭", "lollipop"], ["🦄", "something magical"],
];
const ICON_SET = new Set(ICONS.map(([e]) => e));
// Only draw icons from our list, so nothing odd from the database ends up on the page.
export const safeIcon = (s) => (ICON_SET.has(s) ? s : "");

// Dots on a sunflower spiral so they spread evenly for any count.
function spots(n) {
  return Array.from({ length: n }, (_, k) => {
    const r = 27 * Math.sqrt((k + 0.6) / n);
    const a = k * 2.39996; // golden angle
    return [50 + r * Math.cos(a), 50 + r * Math.sin(a)];
  });
}

export function pieHTML(items) {
  const sauces = items.filter((i) => i.category === "sauce");
  const cheese = items.some((i) => i.category === "cheese");
  const tops = items.filter((i) => i.category === "topping");
  // At least 10 dots so it looks loaded; up to 16 so every topping shows.
  const n = tops.length ? Math.min(Math.max(10, tops.length), 16) : 0;
  const dots = spots(n)
    .map(([x, y], k) => {
      const t = tops[k % tops.length];
      const pos = `left:${x.toFixed(1)}%;top:${y.toFixed(1)}%`;
      const icon = safeIcon(t.icon);
      return icon
        ? `<i class="top icon" style="${pos}">${icon}</i>`
        : `<i class="top" style="${pos};background:${toppingColor(t.name)}"></i>`;
    })
    .join("");
  // Two sauces? Split the pie half and half.
  const [s1, s2] = sauces.map((s) => sauceColor(s.name));
  const base = s1 ? `--sauce:${s1};--sauce2:${s2 || s1}` : `--sauce:${NO_SAUCE};--sauce2:${NO_SAUCE}`;
  return `<div class="pie" aria-hidden="true" style="${base}">${cheese ? '<i class="cheese"></i>' : ""}${dots}</div>`;
}
