// Applies the saved theme before the first paint to avoid a light flash.
(function () {
  try {
    var theme = localStorage.getItem("orla-theme");
    var dark = theme === "dark" || ((!theme || theme === "system") && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) document.documentElement.classList.add("dark");
  } catch (error) {
    // Storage blocked: keep the light theme until the app loads.
  }
})();
