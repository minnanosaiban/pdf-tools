"use strict";

// 機能切り替え（ヒーローの「機能」ボタン）。選択は#ハッシュとlocalStorageに保存する。
(() => {
  const TOOLS = ["redact", "hand", "pages", "meta", "shrink", "pageno", "gray"];
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

  // 機能ボタン（トップメニュー）が画面の上へ外れた時だけ「↑」ボタンを出し、押すとその位置へ戻る。
  // 見えている間に出すと、押しても動かないボタンになるため。
  const backBtn = $("backToTopBtn"), menuEl = document.querySelector(".hero-theme-section");
  const BACK_MARGIN = 12;   // 戻った時に、メニューの上へ残す余白（px）
  const updateBackBtn = () => { backBtn.hidden = menuEl.getBoundingClientRect().bottom > 0; };
  document.addEventListener("scroll", updateBackBtn);
  window.addEventListener("resize", updateBackBtn);
  backBtn.addEventListener("click", () => {
    window.scrollTo({ top: Math.max(0, menuEl.getBoundingClientRect().top + window.scrollY - BACK_MARGIN), behavior: "smooth" });
  });
  updateBackBtn();
})();
