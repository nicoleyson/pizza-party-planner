// Light or dark: always light unless you pick Dark with the switch at the top.
// Loaded in <head> (not as a module) so the right theme is set before the page draws.
// Your pick is remembered only in this browser.
(() => {
  const root = document.documentElement;
  const CHOICES = ["light", "dark"];
  const read = () => {
    try { return localStorage.theme === "dark" ? "dark" : "light"; } catch { return "light"; }
  };
  const apply = () => {
    const pick = read();
    root.dataset.theme = pick;
    for (const b of document.querySelectorAll("[data-theme-choice]")) b.setAttribute("aria-pressed", String(b.dataset.themeChoice === pick));
  };
  apply();
  document.addEventListener("DOMContentLoaded", () => {
    apply();
    document.addEventListener("click", (e) => {
      const b = e.target.closest?.("[data-theme-choice]");
      if (!b || !CHOICES.includes(b.dataset.themeChoice)) return;
      try { localStorage.theme = b.dataset.themeChoice; } catch {}
      apply();
    });
  });
})();
