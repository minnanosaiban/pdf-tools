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

// 保存先を選べるブラウザ（Chrome・Edgeなど）では「名前を付けて保存」ダイアログを出す。
// ダイアログはクリック直後でないと開けないので、重い処理より前（最初のawaitとして）に呼ぶこと。
// 戻り値：ファイルのハンドル（保存先を選んだ）／ null（未対応のブラウザ。通常のダウンロードにする）／ false（キャンセル）
const SAVE_TYPES = { pdf: { description: "PDF", accept: { "application/pdf": [".pdf"] } }, json: { description: "作業ファイル", accept: { "application/json": [".json"] } } };
async function pickSaveTarget(filename, kind) {
  if (typeof window.showSaveFilePicker !== "function") return null;
  try {
    return await window.showSaveFilePicker({ suggestedName: filename, types: [SAVE_TYPES[kind || "pdf"]] });
  } catch (e) {
    return e && e.name === "AbortError" ? false : null;
  }
}
// 複数ファイルを同じフォルダへ書き出すとき用。戻り値は pickSaveTarget と同じ（フォルダのハンドル）
async function pickSaveFolder() {
  if (typeof window.showDirectoryPicker !== "function") return null;
  try {
    return await window.showDirectoryPicker({ mode: "readwrite" });
  } catch (e) {
    return e && e.name === "AbortError" ? false : null;
  }
}
// target が無ければ通常のダウンロード。ファイル／フォルダのハンドルなら、そこへ書き込む
async function saveBlob(blob, filename, target) {
  if (!target) { triggerDownload(blob, filename); return; }
  const fh = target.kind === "directory" ? await target.getFileHandle(filename, { create: true }) : target;
  const w = await fh.createWritable();
  try { await w.write(blob); } finally { await w.close(); }
}

// ---- 作業ファイル（.json）：作業の途中で保存し、続きから編集するためのファイル ----
// sidenoteと同様に、元のPDFもdata URLのまま中に入れる（このファイル1つで続きから再開できる）。
// 外部へは送信せず、ブラウザ内で書き出す・読み込むだけ。
const WORK_APP = "pdf-tools", WORK_VERSION = 1;
const WORK_LABEL = { hand: "手書き風文字追加", pageno: "ページ番号" };
const PDF_DATA_PREFIX = "data:application/pdf;base64,";
function bytesToDataUrl(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return PDF_DATA_PREFIX + btoa(bin);
}
function dataUrlToBytes(url) {
  if (typeof url !== "string" || !url.startsWith(PDF_DATA_PREFIX)) throw new Error("PDFのデータが入っていません");
  const bin = atob(url.slice(PDF_DATA_PREFIX.length));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function makeWorkBlob(tool, pdfBytes, pdfName, state) {
  return new Blob([JSON.stringify({ app: WORK_APP, tool, version: WORK_VERSION, pdfName, pdf: bytesToDataUrl(pdfBytes), state })], { type: "application/json" });
}
// 読み込みに失敗したら、画面に出せる日本語のメッセージ付きでthrowする。値の中身は呼び出し側で検証する（受け取った.jsonは信用しない）
async function readWorkFile(file, tool) {
  let o;
  try { o = JSON.parse(await file.text()); } catch { throw new Error("作業ファイル（.json）として読み込めませんでした。"); }
  if (!o || o.app !== WORK_APP || !WORK_LABEL[o.tool]) throw new Error("このPDFツールの作業ファイルではありません。");
  if (o.tool !== tool) throw new Error(`これは「${WORK_LABEL[o.tool]}」の作業ファイルです。その機能の画面で開いてください。`);
  if (o.version !== WORK_VERSION) throw new Error("対応していない形式の作業ファイルです。");
  let bytes;
  try { bytes = dataUrlToBytes(o.pdf); } catch { throw new Error("作業ファイルの中のPDFを読み込めませんでした。"); }
  return { bytes, name: typeof o.pdfName === "string" && o.pdfName ? o.pdfName.slice(0, 200) : "pdf.pdf", state: o.state && typeof o.state === "object" ? o.state : {} };
}

// クリック選択に加え、ドラッグ＆ドロップでもファイルを受け取る。
// 受け付けるのはボタン上だけでなく、その機能の画面全体（落とす場所を狙わなくてよい）。
function wireDrop(el, onFiles, multiple) {
  const zone = el.closest(".tool-panel") || el;
  const hasFiles = (e) => Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes("Files");
  let depth = 0;
  const off = () => { depth = 0; el.classList.remove("dragover"); };
  zone.addEventListener("dragenter", (e) => { if (hasFiles(e)) { depth++; el.classList.add("dragover"); } });
  zone.addEventListener("dragover", (e) => { if (hasFiles(e)) { e.preventDefault(); el.classList.add("dragover"); } });
  zone.addEventListener("dragleave", (e) => { if (hasFiles(e) && --depth <= 0) off(); });
  zone.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); off();
    const fs = Array.from(e.dataTransfer.files || []);
    if (fs.length) onFiles(multiple ? fs : [fs[0]]);
  });
}

// 画面のどこに落としても、ブラウザがPDFを開いて画面が切り替わらないようにする
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

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
    this.gen = 0;   // 読み込みの世代。古い読み込み・描画が新しいものを上書きしないための番号
  }
  reset() {
    this.gen++;
    if (this.io) { this.io.disconnect(); this.io = null; }
    this.container.innerHTML = "";
    // dom は呼び出し側が参照を保持するので、作り直さず中身だけ空にする
    for (const k of Object.keys(this.dom)) delete this.dom[k];
    if (this.pdf) { const old = this.pdf; this.pdf = null; Promise.resolve(old.destroy()).catch(() => {}); }   // ワーカー側のメモリを解放
  }
  async load(pdf) {
    this.reset();
    const gen = this.gen;
    this.pdf = pdf;
    const p1 = await pdf.getPage(1);
    if (gen !== this.gen) return;   // 待っている間に別のファイルが選ばれた
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
    const gen = this.gen, pdf = this.pdf;
    d.rendering = true;
    try {
      const page = await pdf.getPage(p);
      if (gen !== this.gen) return;
      const vp = page.getViewport({ scale: this.scale });
      d.stage.style.width = vp.width + "px";
      d.stage.style.aspectRatio = `${vp.width} / ${vp.height}`;
      d.view.width = d.overlay.width = Math.floor(vp.width);
      d.view.height = d.overlay.height = Math.floor(vp.height);
      await page.render({ canvasContext: d.view.getContext("2d"), viewport: vp }).promise;
      if (gen !== this.gen) return;
      d.rendered = true;
      if (this.onRendered) this.onRendered(p, d);
    } catch (e) {
      if (gen === this.gen) console.error(e);   // 読み込み直しによる中断は無視
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
