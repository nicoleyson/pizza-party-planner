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

// Hand-picked looks people can choose after a pizza is made ("auto" = guess from ingredients).
// Keep the keys in sync with database.rules.json.
export const SAUCE_LOOKS = [
  ["auto", "Match ingredients", null], ["tomato", "Tomato", TOMATO], ["vodka", "Vodka / pink", "#e8735a"],
  ["white", "White", "#f6ecd6"], ["pesto", "Pesto", "#7da443"], ["bbq", "BBQ", "#7b3420"],
  ["berry", "Berry", "#9b1b30"], ["none", "No sauce", NO_SAUCE],
];
export const CHEESE_LOOKS = [["auto", "Match ingredients"], ["none", "No cheese"], ["some", "Cheesy"], ["lots", "Extra cheesy"]];
const SAUCE_BY_KEY = Object.fromEntries(SAUCE_LOOKS.map(([k, , c]) => [k, c]));

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

// Icons people can pick when the automatic one looks off, in groups for the picker.
// Each label doubles as search words ("mexico mexican"), so keep them lowercase-friendly.
// Never remove one: saved ingredients may already use it.
export const ICON_GROUPS = [
  ["Veggies", [
    ["🍅", "tomato"], ["🫒", "olive"], ["🍄", "mushroom"], ["🧅", "onion / shallot"], ["🧄", "garlic"],
    ["🫑", "bell pepper"], ["🌶️", "chili / jalapeño / hot pepper"], ["🌿", "herbs / basil / oregano"], ["🌱", "sprouts / microgreens"], ["🥬", "leafy greens / spinach / kale / arugula"],
    ["🥗", "salad"], ["🥦", "broccoli"], ["🍆", "eggplant"], ["🥒", "pickles / cucumber / zucchini"], ["🫛", "peas"],
    ["🫘", "beans"], ["🌽", "corn"], ["🥔", "potato"], ["🍠", "sweet potato"], ["🥕", "carrot"],
    ["🥑", "avocado / guacamole"], ["🫚", "ginger"], ["🌻", "sunflower seeds"], ["🌸", "edible flowers"], ["🍁", "maple"],
  ]],
  ["Fruit", [
    ["🍓", "strawberry"], ["🫐", "blueberries / berries / cranberries"], ["🍒", "cherry"], ["🍇", "grapes / raisins"], ["🍍", "pineapple"],
    ["🍑", "peach"], ["🍐", "pear"], ["🍎", "apple"], ["🍏", "green apple"], ["🍌", "banana"],
    ["🥭", "mango"], ["🥝", "kiwi"], ["🍉", "watermelon"], ["🍈", "melon"], ["🍊", "orange"],
    ["🍋", "lemon / lime"], ["🥥", "coconut"],
  ]],
  ["Meat & seafood", [
    ["🥓", "bacon / pancetta"], ["🍗", "chicken"], ["🦃", "turkey"], ["🍖", "meat / bbq"], ["🥩", "steak / beef"],
    ["🌭", "sausage / hot dog"], ["🐖", "pork / ham / prosciutto"], ["🐑", "lamb"], ["🦆", "duck"], ["🍤", "fried shrimp / tempura"],
    ["🦐", "shrimp / prawns"], ["🦀", "crab"], ["🦞", "lobster"], ["🦑", "squid / calamari"], ["🐙", "octopus"],
    ["🐟", "fish / anchovies / tuna"], ["🍣", "salmon / sushi"], ["🦪", "oyster / clams"], ["🥚", "egg"], ["🍳", "fried egg"],
  ]],
  ["Cheese, sauce & extras", [
    ["🧀", "cheese"], ["🥛", "cream / milk / alfredo"], ["🧈", "butter"], ["🫙", "jar / pesto / spread"], ["🥫", "can / tomato sauce"],
    ["🍯", "honey"], ["🧂", "salt / spice / seasoning"], ["🔥", "spicy / hot"], ["🫕", "fondue"], ["🥜", "nuts / peanuts"],
    ["🌰", "chestnut / walnut"], ["🍞", "bread / stuffing / croutons"], ["🥖", "baguette / dough"], ["🫓", "flatbread / naan"], ["🥨", "pretzel"],
    ["🍟", "fries"], ["🧆", "falafel"], ["🥟", "dumpling"], ["🍝", "pasta"], ["🍚", "rice"],
  ]],
  ["Sweets", [
    ["🍫", "chocolate"], ["🍪", "cookie"], ["🍬", "candy"], ["🍭", "lollipop"], ["🍩", "donut"],
    ["🧁", "cupcake"], ["🍰", "cake"], ["🎂", "birthday cake"], ["🥧", "pie"], ["🍨", "ice cream / gelato"],
    ["🍮", "flan / pudding"], ["🍡", "mochi"], ["🍿", "popcorn"], ["🥞", "pancakes"], ["🧇", "waffle"],
  ]],
  ["Drinks", [
    ["🥤", "soda / pop"], ["🧃", "juice box"], ["🧋", "boba / bubble tea"], ["☕", "coffee"], ["🍵", "tea / matcha"],
    ["🍷", "wine / red wine"], ["🥂", "champagne / prosecco"], ["🍺", "beer"], ["🍸", "cocktail / martini"], ["🍹", "tropical drink"],
    ["🥃", "whiskey"], ["🍶", "sake"], ["💧", "water"], ["🧊", "ice"], ["🥛", "milk"],
  ]],
  ["Fun", [
    ["🦄", "something magical"], ["🎉", "party"], ["⭐", "star"], ["❤️", "love / heart"], ["💚", "green heart / vegan"],
    ["🌈", "rainbow"], ["✨", "sparkle"], ["🍕", "pizza"], ["👑", "crown"], ["🎁", "surprise"],
  ]],
  ["Colors", [
    ["🔴", "red"], ["🟠", "orange"], ["🟡", "yellow"], ["🟢", "green"], ["🔵", "blue"],
    ["🟣", "purple"], ["🟤", "brown"], ["⚫", "black"], ["⚪", "white"], ["🩷", "pink"],
    ["🟥", "red square"], ["🟧", "orange square"], ["🟨", "yellow square"], ["🟩", "green square"], ["🟦", "blue square"],
    ["🟪", "purple square"], ["🟫", "brown square"], ["🧡", "orange heart"], ["💛", "yellow heart"], ["💙", "blue heart"],
    ["💜", "purple heart"], ["🤎", "brown heart"], ["🖤", "black heart"], ["🤍", "white heart"], ["🩵", "light blue heart"],
  ]],
  ["Flags", [
    ["🇮🇹", "italy / italian"], ["🇲🇽", "mexico / mexican"], ["🇫🇷", "france / french"], ["🇬🇷", "greece / greek"], ["🇪🇸", "spain / spanish"],
    ["🇺🇸", "usa / american"], ["🇯🇵", "japan / japanese"], ["🇰🇷", "korea / korean"], ["🇨🇳", "china / chinese"], ["🇮🇳", "india / indian"],
    ["🇹🇭", "thailand / thai"], ["🇻🇳", "vietnam / vietnamese"], ["🇵🇭", "philippines / filipino"], ["🇬🇧", "uk / british"], ["🇮🇪", "ireland / irish"],
    ["🇩🇪", "germany / german"], ["🇳🇱", "netherlands / dutch"], ["🇨🇭", "switzerland / swiss"], ["🇵🇹", "portugal / portuguese"], ["🇹🇷", "turkey / turkish"],
    ["🇱🇧", "lebanon / lebanese"], ["🇮🇱", "israel / israeli"], ["🇲🇦", "morocco / moroccan"], ["🇪🇹", "ethiopia / ethiopian"], ["🇳🇬", "nigeria / nigerian"],
    ["🇯🇲", "jamaica / jamaican"], ["🇨🇺", "cuba / cuban"], ["🇵🇷", "puerto rico"], ["🇧🇷", "brazil / brazilian"], ["🇦🇷", "argentina / argentinian"],
    ["🇵🇪", "peru / peruvian"], ["🇨🇴", "colombia / colombian"], ["🇸🇻", "el salvador / salvadoran"], ["🇨🇦", "canada / canadian"], ["🇦🇺", "australia / australian"],
    ["🇳🇿", "new zealand"], ["🇮🇩", "indonesia / indonesian"], ["🇲🇾", "malaysia / malaysian"], ["🇸🇬", "singapore"], ["🇹🇼", "taiwan / taiwanese"],
  ]],
];
// Every icon once (milk sits in two groups), for the dropdown-free lookups below.
export const ICONS = [...new Map(ICON_GROUPS.flatMap(([, list]) => list).map((x) => [x[0], x])).values()];
const ICON_SET = new Set(ICONS.map(([e]) => e));
// Only draw icons from our list, so nothing odd from the database ends up on the page.
export const safeIcon = (s) => (ICON_SET.has(s) ? s : "");

// A label icon for sauces and cheeses nobody picked one for: "Garlic" gets 🧄, not 🍅.
// (Only used in lists and chips; the pie drawing colors sauce and cheese instead.)
const SAUCE_ICONS = [
  [/garlic|aioli/, "🧄"], [/pesto|basil|herb|chimichurri|green/, "🌿"], [/bbq|barbe/, "🍖"],
  [/buffalo|hot|chil|spic|sriracha|harissa|diavol|arrabb/, "🌶️"], [/cream|alfredo|white|bechamel|ranch/, "🥛"],
  [/honey/, "🍯"], [/olive oil|oil/, "🫒"], [/mushroom|truffle/, "🍄"],
];
export function guessIcon(name, category) {
  const n = norm(name);
  if (category === "sauce") return SAUCE_ICONS.find(([re]) => re.test(n))?.[1] ?? "🍅";
  if (category === "cheese") return "🧀";
  return "";
}

// Dots on a sunflower spiral so they spread evenly for any count.
function spots(n) {
  return Array.from({ length: n }, (_, k) => {
    const r = 27 * Math.sqrt((k + 0.6) / n);
    const a = k * 2.39996; // golden angle
    return [50 + r * Math.cos(a), 50 + r * Math.sin(a)];
  });
}

export function pieHTML(items, look = {}) {
  const sauces = items.filter((i) => i.category === "sauce");
  const cheeseLook = CHEESE_LOOKS.some(([k]) => k === look?.cheese) ? look.cheese : "auto";
  const cheese = cheeseLook === "auto" ? items.some((i) => i.category === "cheese") : cheeseLook !== "none";
  const tops = items.filter((i) => i.category === "topping");
  // At least 10 dots so it looks loaded; up to 16 so every topping shows.
  const n = tops.length ? Math.min(Math.max(10, tops.length), 16) : 0;
  const dots = spots(n)
    .map(([x, y], k) => {
      const t = tops[k % tops.length];
      const pos = `left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;--i:${k}`;
      const icon = safeIcon(t.icon);
      return icon
        ? `<i class="top icon" style="${pos}">${icon}</i>`
        : `<i class="top" style="${pos};background:${toppingColor(t.name)}"></i>`;
    })
    .join("");
  // Two sauces? Split the pie half and half.
  let [s1, s2] = sauces.map((s) => sauceColor(s.name));
  const picked = SAUCE_BY_KEY[look?.sauce];
  if (picked) s1 = s2 = picked; // a chosen sauce color covers the whole pie
  const base = s1 ? `--sauce:${s1};--sauce2:${s2 || s1}` : `--sauce:${NO_SAUCE};--sauce2:${NO_SAUCE}`;
  return `<div class="pie" aria-hidden="true" style="${base}">${cheese ? `<i class="cheese${cheeseLook === "lots" ? " lots" : ""}"></i>` : ""}${dots}</div>`;
}
