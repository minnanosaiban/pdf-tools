"use strict";

// 結合・分割・回転（旧 pdf-merge に、ページ回転・選択抽出・分割を追加）。
(() => {
  const { PDFDocument, degrees } = PDFLib;
  const THUMB = 140;   // サムネイル最大サイズ(CSS px)

  const drop = $("pg-drop"), fileInput = $("pg-file"), pagesEl = $("pg-pages");
  const opsCard = $("pg-ops"), outCard = $("pg-out"), countEl = $("pg-count");
  const statusEl = $("pg-status"), status2 = $("pg-status2");
  const mergeBtn = $("pg-merge"), extractBtn = $("pg-extract"), splitBtn = $("pg-split");

  const sources = new Map();    // sourceId -> { name, bytes }
  const pagesById = new Map();  // pageId -> { sourceId, pageIndex, rot(0/90/180/270), jsPage(pdf.js), card }
  let sourceSeq = 0, pageSeq = 0, loading = false;

  const setStatus = (t, err) => { statusEl.textContent = t || ""; statusEl.classList.toggle("is-error", !!err); };
  const setStatus2 = (t, err) => { status2.textContent = t || ""; status2.classList.toggle("is-error-text", !!err); };
  const cards = () => Array.from(pagesEl.querySelectorAll(".page-card"));
  const selectedCards = () => cards().filter((c) => c.classList.contains("selected"));

  function updateChrome() {
    const n = pagesById.size, sel = selectedCards().length;
    opsCard.hidden = outCard.hidden = n === 0;
    countEl.textContent = `${n}ページ / ${sources.size}ファイル` + (sel ? `（${sel}ページ選択中）` : "");
    mergeBtn.disabled = splitBtn.disabled = n === 0;
    extractBtn.disabled = sel === 0;
    if (!loading) {
      setStatus(n
        ? `${n}ページ（${sources.size}ファイル）読み込み済み。ドラッグで並べ替え、×で削除、↺↻で回転できます。`
        : "PDFを追加すると、全ページのサムネイルがここに並びます。");
    }
  }

  // ---- 追加 ----
  async function addFiles(fileList) {
    const files = Array.from(fileList).filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
    if (!files.length) return;
    loading = true;
    const failed = [];
    for (const file of files) {
      setStatus(`「${file.name}」を読み込み中…`);
      try { await addOne(file); }
      catch (e) { failed.push(file.name + (/password|encrypt/i.test(String(e && e.message || e)) ? "（パスワード保護）" : "")); }
    }
    loading = false;
    updateChrome();
    if (failed.length) setStatus(`読み込めなかったファイル: ${failed.join("、")}`, true);
  }

  async function addOne(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;   // pdf.jsはバッファをtransferし得るためコピーを渡す
    const sourceId = `s${++sourceSeq}`;
    sources.set(sourceId, { name: file.name, bytes });
    for (let i = 1; i <= doc.numPages; i++) {
      const pageId = `p${++pageSeq}`;
      const jsPage = await doc.getPage(i);
      const info = { sourceId, pageIndex: i - 1, rot: 0, jsPage };
      pagesById.set(pageId, info);
      const card = buildCard(pageId, info, file.name, i, doc.numPages);
      info.card = card;
      pagesEl.appendChild(card);
      renderThumb(card.querySelector("canvas"), info);
    }
  }

  async function renderThumb(canvas, info) {
    const dpr = window.devicePixelRatio || 1;
    const rotation = (info.jsPage.rotate + info.rot) % 360;
    const vp1 = info.jsPage.getViewport({ scale: 1, rotation });
    const scale = (THUMB * dpr) / Math.max(vp1.width, vp1.height);
    const vp = info.jsPage.getViewport({ scale, rotation });
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    await info.jsPage.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
  }

  function mkBtn(cls, text, label, onClick) {
    const b = document.createElement("button");
    b.type = "button"; b.className = cls; b.textContent = text;
    b.title = label; b.setAttribute("aria-label", label);
    b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
    return b;
  }

  function buildCard(pageId, info, fileName, pageNum, pageCount) {
    const card = document.createElement("div");
    card.className = "page-card"; card.draggable = true; card.dataset.pageId = pageId;

    const wrap = document.createElement("div"); wrap.className = "page-thumb-wrap";
    const canvas = document.createElement("canvas"); canvas.className = "page-thumb";
    wrap.appendChild(canvas);
    wrap.appendChild(mkBtn("page-check", "✓", "このページを選択", () => { card.classList.toggle("selected"); updateChrome(); }));
    const rm = mkBtn("page-remove", "", "このページを削除", () => { pagesById.delete(pageId); card.remove(); updateChrome(); });
    rm.innerHTML = '<svg class="icon" xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.293 1.293a1 1 0 0 1 1.414 0L8 6.586l5.293-5.293a1 1 0 1 1 1.414 1.414L9.414 8l5.293 5.293a1 1 0 0 1-1.414 1.414L8 9.414l-5.293 5.293a1 1 0 0 1-1.414-1.414L6.586 8 1.293 2.707a1 1 0 0 1 0-1.414"/></svg>';
    wrap.appendChild(rm);

    const label = document.createElement("div"); label.className = "page-label";
    const num = document.createElement("span"); num.className = "page-num"; num.textContent = `${pageNum}/${pageCount}`;
    const nm = document.createElement("span"); nm.className = "page-source"; nm.textContent = fileName; nm.title = fileName;
    label.append(num, nm);

    const acts = document.createElement("div"); acts.className = "page-actions";
    acts.append(
      mkBtn("act-btn", "‹", "1つ前に移動", () => moveCard(card, -1)),
      mkBtn("act-btn", "↺", "左に回転", () => rotate(pageId, -90)),
      mkBtn("act-btn", "↻", "右に回転", () => rotate(pageId, 90)),
      mkBtn("act-btn", "›", "1つ後ろに移動", () => moveCard(card, 1)),
    );
    card.append(wrap, label, acts);

    card.addEventListener("dragstart", (e) => {
      card.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", pageId);
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
    return card;
  }

  function rotate(pageId, delta) {
    const info = pagesById.get(pageId);
    if (!info) return;
    info.rot = (((info.rot + delta) % 360) + 360) % 360;
    renderThumb(info.card.querySelector("canvas"), info);
  }
  // 選択ページがあればそれだけ、なければ全ページを回転
  function rotateTargets(delta) {
    const sel = selectedCards();
    const ids = (sel.length ? sel : cards()).map((c) => c.dataset.pageId);
    ids.forEach((id) => rotate(id, delta));
  }
  $("pg-rotL").onclick = () => rotateTargets(-90);
  $("pg-rotR").onclick = () => rotateTargets(90);
  $("pg-selAll").onclick = () => { cards().forEach((c) => c.classList.add("selected")); updateChrome(); };
  $("pg-selNone").onclick = () => { cards().forEach((c) => c.classList.remove("selected")); updateChrome(); };

  function moveCard(card, dir) {
    if (dir < 0) { const prev = card.previousElementSibling; if (prev) pagesEl.insertBefore(card, prev); }
    else { const next = card.nextElementSibling; if (next) pagesEl.insertBefore(next, card); }
  }

  // ---- ドラッグ並べ替え（一番近いカードの前後へ挿入） ----
  pagesEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    const dragging = pagesEl.querySelector(".page-card.dragging");
    if (!dragging) return;
    let closest = null, best = Infinity;
    for (const el of cards()) {
      if (el === dragging) continue;
      const b = el.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
      if (dist < best) { best = dist; closest = { el, before: e.clientX < cx }; }
    }
    if (!closest) pagesEl.appendChild(dragging);
    else if (closest.before) pagesEl.insertBefore(dragging, closest.el);
    else pagesEl.insertBefore(dragging, closest.el.nextSibling);
  });
  pagesEl.addEventListener("drop", (e) => e.preventDefault());

  fileInput.addEventListener("change", () => { if (fileInput.files.length) addFiles(fileInput.files); fileInput.value = ""; });
  wireDrop(drop, addFiles, true);

  $("pg-clear").onclick = () => {
    pagesById.clear(); sources.clear(); pagesEl.innerHTML = "";
    setStatus2(""); updateChrome();
  };

  // ---- 出力 ----
  const normName = (v, dflt) => {
    let n = (v || "").trim() || dflt;
    return /\.pdf$/i.test(n) ? n : n + ".pdf";
  };

  // pageIds の順に1つのPDFを組み立てる（回転は元ページの/Rotateに加算）
  async function build(pageIds) {
    const cache = new Map(), out = await PDFDocument.create();
    for (const id of pageIds) {
      const info = pagesById.get(id);
      if (!info) continue;
      let src = cache.get(info.sourceId);
      if (!src) { src = await PDFDocument.load(sources.get(info.sourceId).bytes); cache.set(info.sourceId, src); }
      const [pg] = await out.copyPages(src, [info.pageIndex]);
      if (info.rot) pg.setRotation(degrees((pg.getRotation().angle + info.rot) % 360));
      out.addPage(pg);
    }
    return new Blob([await out.save()], { type: "application/pdf" });
  }

  const errText = (e) => /password|encrypt/i.test(String(e && e.message || e)) ? "パスワード保護されたPDFが含まれています。" : String(e && e.message || e);
  const busy = (on) => { mergeBtn.disabled = splitBtn.disabled = on || !pagesById.size; extractBtn.disabled = on || !selectedCards().length; };

  mergeBtn.onclick = async () => {
    const ids = cards().map((c) => c.dataset.pageId);
    if (!ids.length) return;
    busy(true); setStatus2("結合中…");
    try {
      triggerDownload(await build(ids), normName($("pg-name").value, "merged.pdf"));
      setStatus2(`結合しました（${ids.length}ページ、ダウンロードを開始しました）`);
    } catch (e) { setStatus2("結合に失敗しました: " + errText(e), true); }
    finally { busy(false); }
  };

  extractBtn.onclick = async () => {
    const ids = selectedCards().map((c) => c.dataset.pageId);
    if (!ids.length) return;
    busy(true); setStatus2("抽出中…");
    try {
      triggerDownload(await build(ids), normName($("pg-name").value.replace(/\.pdf$/i, "") + "_extract", "extract.pdf"));
      setStatus2(`選択した${ids.length}ページを保存しました`);
    } catch (e) { setStatus2("抽出に失敗しました: " + errText(e), true); }
    finally { busy(false); }
  };

  splitBtn.onclick = async () => {
    const ids = cards().map((c) => c.dataset.pageId);
    const n = Math.max(1, parseInt($("pg-splitN").value, 10) || 1);
    if (!ids.length) return;
    const base = normName($("pg-name").value, "split.pdf").replace(/\.pdf$/i, "");
    const parts = [];
    for (let i = 0; i < ids.length; i += n) parts.push(ids.slice(i, i + n));
    busy(true);
    try {
      for (let i = 0; i < parts.length; i++) {
        setStatus2(`分割して保存中…（${i + 1}/${parts.length}）`);
        triggerDownload(await build(parts[i]), `${base}_${String(i + 1).padStart(String(parts.length).length, "0")}.pdf`);
        await new Promise((r) => setTimeout(r, 350));   // 連続ダウンロードがブロックされにくいよう間隔を空ける
      }
      setStatus2(`${ids.length}ページを${n}ページごとに${parts.length}ファイルへ分割して保存しました`);
    } catch (e) { setStatus2("分割に失敗しました: " + errText(e), true); }
    finally { busy(false); }
  };

  updateChrome();
})();
