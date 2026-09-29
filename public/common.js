"use strict";

// 各機能（redact.js / hand.js / pages.js / meta.js）が共有する小道具。
// pdf.js のワーカー（同梱ライブラリ、THIRD_PARTY_NOTICES.md参照）
pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdfjs/pdf.worker.min.js";

const $ = (id) => document.getElementById(id);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// ダウンロードは a要素のclickをユーザー操作に対して同期的に呼ぶ必要がある
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// クリック選択に加え、ドラッグ＆ドロップでもファイルを受け取る。
function wireDrop(el, onFiles, multiple) {
  el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("dragover"); });
  el.addEventListener("dragleave", () => el.classList.remove("dragover"));
  el.addEventListener("drop", (e) => {
    e.preventDefault(); el.classList.remove("dragover");
    const fs = Array.from(e.dataTransfer.files || []);
    if (fs.length) onFiles(multiple ? fs : [fs[0]]);
  });
}

// ドロップゾーン外にファイルを落とした時にブラウザがファイルを開いてしまうのを防ぐ
function blockStrayDrop(el) {
  el.addEventListener("dragover", (e) => e.preventDefault());
  el.addEventListener("drop", (e) => e.preventDefault());
}

// 「ページを縦に並べて遅延描画する」ビューア（墨消し・手書き風文字追加で共用）。
// 画面外のページはcanvasを解放してメモリを節約する。
class PageViewer {
  constructor(container, { scale = 1.5, onRendered = null, decorate = null } = {}) {
    this.container = container;
    this.scale = scale;
    this.onRendered = onRendered;   // (p, dom) 描画完了時
    this.decorate = decorate;       // (p, dom) ページ枠を作った直後（ヘッダーボタン追加・イベント付与用）
    this.pdf = null; this.dom = {}; this.io = null; this.paused = false;
  }
  reset() {
    if (this.io) { this.io.disconnect(); this.io = null; }
    this.container.innerHTML = "";
    this.dom = {}; this.pdf = null;
  }
  async load(pdf) {
    this.reset();
    this.pdf = pdf;
    const p1 = await pdf.getPage(1);
    const vp1 = p1.getViewport({ scale: this.scale });
    for (let p = 1; p <= pdf.numPages; p++) {
      const wrap = document.createElement("div"); wrap.className = "page"; wrap.dataset.page = p;
      const head = document.createElement("div"); head.className = "phead";
      const lbl = document.createElement("span"); lbl.textContent = `p.${p}`;
      head.appendChild(lbl);
      const stage = document.createElement("div"); stage.className = "stage";
      stage.style.width = vp1.width + "px";
      stage.style.aspectRatio = `${vp1.width} / ${vp1.height}`;
      const view = document.createElement("canvas"); view.className = "view";
      const overlay = document.createElement("canvas"); overlay.className = "overlay";
      stage.append(view, overlay);
      wrap.append(head, stage);
      this.container.appendChild(wrap);
      this.dom[p] = { wrap, head, stage, view, overlay, rendered: false, rendering: false };
      if (this.decorate) this.decorate(p, this.dom[p]);
    }
    this.io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        const p = +en.target.dataset.page;
        if (en.isIntersecting) this.render(p); else this.free(p);
      }
    }, { root: null, rootMargin: "800px 0px", threshold: 0 });
    for (const k of Object.keys(this.dom)) this.io.observe(this.dom[k].wrap);
  }
  async render(p) {
    if (this.paused) return;
    const d = this.dom[p];
    if (!d || d.rendered || d.rendering) return;
    d.rendering = true;
    try {
      const page = await this.pdf.getPage(p);
      const vp = page.getViewport({ scale: this.scale });
      d.stage.style.width = vp.width + "px";
      d.stage.style.aspectRatio = `${vp.width} / ${vp.height}`;
      d.view.width = d.overlay.width = Math.floor(vp.width);
      d.view.height = d.overlay.height = Math.floor(vp.height);
      await page.render({ canvasContext: d.view.getContext("2d"), viewport: vp }).promise;
      d.rendered = true;
      if (this.onRendered) this.onRendered(p, d);
    } finally { d.rendering = false; }
  }
  free(p) {
    const d = this.dom[p];
    if (!d || !d.rendered) return;
    d.view.width = d.view.height = 0;
    d.overlay.width = d.overlay.height = 0;
    d.rendered = false;
  }
  pause() { this.paused = true; if (this.io) this.io.disconnect(); }
  resume() {
    this.paused = false;
    if (this.io) for (const k of Object.keys(this.dom)) this.io.observe(this.dom[k].wrap);
  }
}
