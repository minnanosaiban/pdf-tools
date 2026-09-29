"use strict";

// 機能切り替え（ヒーローの「機能」ボタン）。選択は#ハッシュとlocalStorageに保存する。
(() => {
  const TOOLS = ["redact", "hand", "pages", "meta"];
  const KEY = "pdf-tools-active-v1";
  const buttons = Array.from(document.querySelectorAll("#toolGrid .theme-swatch"));
  const panels = Array.from(document.querySelectorAll("[data-panel]"));
  const mocks = Array.from(document.querySelectorAll("[data-mock]"));

  function show(tool, persist) {
    if (!TOOLS.includes(tool)) tool = TOOLS[0];
    buttons.forEach((b) => {
      const on = b.dataset.tool === tool;
      b.classList.toggle("selected", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    panels.forEach((p) => { p.hidden = p.dataset.panel !== tool; });
    mocks.forEach((m) => { m.hidden = m.dataset.mock !== tool; });
    if (persist) {
      try { localStorage.setItem(KEY, tool); } catch { /* noop */ }
      history.replaceState(null, "", "#" + tool);
    }
  }
  buttons.forEach((b) => b.addEventListener("click", () => show(b.dataset.tool, true)));
  window.addEventListener("hashchange", () => show(location.hash.slice(1), false));

  let first = location.hash.slice(1);
  if (!TOOLS.includes(first)) { try { first = localStorage.getItem(KEY); } catch { first = null; } }
  show(first, false);
})();
