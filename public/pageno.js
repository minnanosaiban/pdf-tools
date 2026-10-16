"use strict";

// ページ番号：各ページに番号（1／1頁／1ページ 等）を、指定の位置へ重ねる。
// 「頁」「ページ」はPDF標準フォントに無いため、文字は画像にして重ねる（手書き風書体もこの方式）。
(() => {
  const { PDFDocument, degrees } = PDFLib;

  const POS = [   // [ラベル, 横(0左/.5中/1右), 縦(0上/1下)]
    ["左上", 0, 0], ["上中央", .5, 0], ["右上", 1, 0],
    ["左下", 0, 1], ["下中央", .5, 1], ["右下", 1, 1],
  ];
  const FORMATS = {
    n: (n) => `${n}`, kan: (n) => `${n}頁`, page: (n) => `${n}ページ`, p: (n) => `p.${n}`,
    dash: (n) => `- ${n} -`, slash: (n, t) => `${n} / ${t}`,
  };
  const MM = 72 / 25.4;
  let pdfBytes = null, baseName = "pdf", pageCount = 1, pageW = 595, pageH = 842, pos = POS[5];

  const el = {};
  for (const k of ["file", "filename", "status", "area", "format", "font", "size", "color", "jitter", "margin", "from", "first", "mode", "chapters", "modeBox", "fromBox", "skipNote", "previewBox", "firstBox", "firstLabel", "chaptersBox", "pager", "prev", "next", "pageInfo", "filled", "pageText", "pageCanvas", "pos", "preview", "save", "saveStatus"]) el[k] = $("pn-" + k);
  const setStatus = (m, err) => { el.status.textContent = m || ""; el.status.classList.toggle("is-error", !!err); };
  const setSaveStatus = (m, err) => { el.saveStatus.textContent = m || ""; el.saveStatus.classList.toggle("is-error-text", !!err); };
  const num = (e, lo, hi, def) => Math.min(hi, Math.max(lo, Math.round(+e.value) || def));
  const opts = () => ({
    format: el.format.value, font: el.font.value, size: num(el.size, 6, 72, 12), color: el.color.value, jitter: +el.jitter.value,
    margin: Math.min(100, Math.max(0, +el.margin.value || 0)) * MM, from: el.format.value === "custom" ? 1 : num(el.from, 1, pageCount, 1), first: Math.max(0, Math.round(+el.first.value) || 0),
    texts: pageTexts.slice(),
    mode: el.mode.value, chapters: parseList(el.chapters.value).map(Number).filter((n) => Number.isInteger(n) && n >= 1),
  });
  let pageTexts = [], cur = 1, pnPdf = null;   // 手入力：ページごとの文字、いま見ているページ、表示用のpdf.js文書
  const parseList = (s) => s.split(/[\n,、，]+/).map((x) => x.trim()).filter(Boolean);

  POS.forEach((p, i) => {
    const l = document.createElement("label");
    l.innerHTML = `<input type="radio" name="pn-pos"${i === 5 ? " checked" : ""}><span></span>`;
    l.querySelector("span").textContent = p[0];
    l.querySelector("input").addEventListener("change", () => { pos = p; drawPreview(); });
    el.pos.appendChild(l);
  });

  function rng(seed) {   // 同じseedなら同じゆらぎ
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0; let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const fontStr = (o, px) => `${px}px ${o.font === "std" ? '"Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif' : `"${o.font}", "Yomogi", cursive`}`;
  const ensureFont = (o, text) => (document.fonts && document.fonts.load && o.font !== "std" ? document.fonts.load(fontStr(o, 24), text).catch(() => {}) : Promise.resolve());

  // 文字を k px/pt でcanvasに描く。pad(pt)は、ゆらぎではみ出す分の余白
  function renderLabel(text, o, k, seed) {
    const px = o.size * k, pad = o.size * 0.3, c = document.createElement("canvas"), ctx = c.getContext("2d");
    ctx.font = fontStr(o, px);
    const chars = Array.from(text), adv = chars.map((ch) => ctx.measureText(ch).width);
    const tw = adv.reduce((a, b) => a + b, 0) / k, th = o.size * 1.2;
    c.width = Math.ceil((tw + pad * 2) * k * 1.04); c.height = Math.ceil((th + pad * 2) * k);
    ctx.font = fontStr(o, px); ctx.fillStyle = o.color; ctx.textBaseline = "middle";
    const hand = o.font !== "std", j = hand ? o.jitter / 100 : 0, r = rng(seed);
    let x = pad * k;
    chars.forEach((ch, i) => {
      const dy = (r() - 0.5) * px * 0.2 * j, rot = (r() - 0.5) * 0.2 * j, sc = 1 + (r() - 0.5) * 0.14 * j;
      ctx.save();
      ctx.translate(x + adv[i] / 2, c.height / 2 + dy); ctx.rotate(rot); ctx.scale(sc, sc);
      ctx.fillText(ch, -adv[i] / 2, 0);
      ctx.restore();
      x += adv[i] * (1 + (r() - 0.5) * 0.08 * j);
    });
    return { canvas: c, pad, tw, th, w: c.width / k, h: c.height / k };
  }

  // 見た目の左下を原点とした、ラベル画像の左下位置(pt)
  function place(vw, vh, lab, o) {
    const x = pos[1] === 0 ? o.margin : pos[1] === 1 ? vw - o.margin - lab.tw : (vw - lab.tw) / 2;
    const yTop = pos[2] === 0 ? o.margin : vh - o.margin - lab.th;   // 文字の上端（上から測る）
    return { ox: x - lab.pad, oy: vh - (yTop + lab.th) - lab.pad };
  }
  // ページ i に付ける番号の文字列（付けないページは空文字）。書式（1頁など）をかける前の中身
  function baseLabel(o, i) {
    if (o.mode === "chapter") {
      const starts = [o.from, ...new Set(o.chapters.filter((p) => p > o.from))].sort((a, b) => a - b);
      let c = 0; while (c + 1 < starts.length && starts[c + 1] <= i) c++;
      return `${o.first + c}-${i - starts[c] + 1}`;
    }
    return String(o.first + (i - o.from));
  }
  const labelText = (o, i, total) => {
    if (o.format === "custom") return (o.texts[i - 1] || "").trim();   // 手入力：自動の番号は使わない
    const n = baseLabel(o, i), t = baseLabel(o, total) || n;
    return n ? FORMATS[o.format](n, t) : "";
  };

  let previewGen = 0;
  async function drawPreview() {
    if (!pdfBytes) return;
    const gen = ++previewGen, o = opts(), W = 220, k = W / pageW, c = el.preview;
    const text = labelText(o, o.from, pageCount) || "（番号なし）";
    await ensureFont(o, text);
    if (gen !== previewGen) return;
    c.width = W; c.height = Math.round(pageH * k);
    const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#eceef1";   // 本文のつもりの線
    for (let y = 0.12; y < 0.85; y += 0.05) ctx.fillRect(c.width * 0.14, c.height * y, c.width * 0.72, 3);
    const lab = renderLabel(text, o, k * 3, 1), { ox, oy } = place(pageW, pageH, lab, o);
    ctx.drawImage(lab.canvas, ox * k, c.height - (oy + lab.h) * k, lab.w * k, lab.h * k);
  }
  for (const k of ["format", "font", "size", "color", "jitter", "margin", "from", "first", "mode", "chapters"]) {
    el[k].addEventListener("input", refresh);
    el[k].addEventListener("change", refresh);
  }
  el.font.addEventListener("change", () => { el.jitter.disabled = el.font.value === "std"; });
  el.jitter.disabled = true;
  function syncMode() {
    const m = el.mode.value, custom = el.format.value === "custom";
    el.modeBox.hidden = el.fromBox.hidden = el.firstBox.hidden = el.skipNote.hidden = custom;
    el.chaptersBox.hidden = custom || m !== "chapter"; el.previewBox.hidden = custom; el.pager.hidden = !custom;
    el.firstLabel.textContent = m === "chapter" ? "最初の章の番号" : "最初の番号";
  }
  el.mode.addEventListener("change", syncMode);
  el.format.addEventListener("change", syncMode);
  function refresh() { drawPreview(); if (el.format.value === "custom") { if (baseCanvas) drawPager(); else showPage(cur); } }

  // ---- 手入力：ページを見ながら1ページずつ入力 ----
  let pagerGen = 0, baseCanvas = null, baseVp = null;
  async function showPage(p) {
    cur = Math.min(pageCount, Math.max(1, p));
    const gen = ++pagerGen;
    el.pageInfo.textContent = `p.${cur} / ${pageCount}`;
    el.pageText.value = pageTexts[cur - 1] || "";
    el.prev.disabled = cur <= 1; el.next.disabled = cur >= pageCount;
    if (!pnPdf) return;
    const page = await pnPdf.getPage(cur), vp1 = page.getViewport({ scale: 1 }), s = 520 / vp1.width, vp = page.getViewport({ scale: s });
    const c = document.createElement("canvas"); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    if (gen !== pagerGen) return;   // めくっている間に別のページへ移った
    baseCanvas = c; baseVp = { vw: vp1.width, vh: vp1.height, s };
    drawPager();
  }
  async function drawPager() {
    if (!baseCanvas) return;
    const o = opts(), text = labelText(o, cur, pageCount), gen = pagerGen, c = el.pageCanvas;
    if (text) await ensureFont(o, text);
    if (gen !== pagerGen) return;
    c.width = baseCanvas.width; c.height = baseCanvas.height;
    const ctx = c.getContext("2d"); ctx.drawImage(baseCanvas, 0, 0);
    if (text) {
      const lab = renderLabel(text, o, baseVp.s * 3, cur), { ox, oy } = place(baseVp.vw, baseVp.vh, lab, o);
      ctx.drawImage(lab.canvas, ox * baseVp.s, c.height - (oy + lab.h) * baseVp.s, lab.w * baseVp.s, lab.h * baseVp.s);
    }
    el.filled.textContent = `入力済み ${pageTexts.filter((t) => t && t.trim()).length} / ${pageCount} ページ`;
  }
  el.pageText.addEventListener("input", () => { pageTexts[cur - 1] = el.pageText.value; drawPager(); });
  el.pageText.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); showPage(cur + 1); } });   // 日本語変換の確定のEnterでは進まない
  el.prev.addEventListener("click", () => showPage(cur - 1));
  el.next.addEventListener("click", () => showPage(cur + 1));

  async function loadFile(file) {
    setSaveStatus(""); el.area.hidden = true; setStatus("読み込み中…");
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const doc = await PDFDocument.load(buf, { updateMetadata: false });
      const p0 = doc.getPage(0), cb = p0.getCropBox(), R = ((p0.getRotation().angle % 360) + 360) % 360;
      pageW = R % 180 ? cb.height : cb.width; pageH = R % 180 ? cb.width : cb.height;
      pageCount = doc.getPageCount(); pdfBytes = buf; baseName = file.name.replace(/\.pdf$/i, "") || "pdf";
      el.from.max = pageCount; if (+el.from.value > pageCount) el.from.value = 1;
      if (pnPdf) { const old = pnPdf; pnPdf = null; Promise.resolve(old.destroy()).catch(() => {}); }
      pnPdf = await pdfjsLib.getDocument({ data: buf.slice(), isEvalSupported: false }).promise;
      pageTexts = []; baseCanvas = null;
      el.filename.hidden = false; el.filename.textContent = `${file.name}（${pageCount}ページ）`;
      el.area.hidden = false; syncMode(); drawPreview(); if (el.format.value === "custom") showPage(1);
      setStatus("書式・位置などを選んで「ページ番号を入れて保存」を押してください。");
    } catch (e) {
      pdfBytes = null;
      setStatus(/encrypt|password/i.test(String(e && e.message || e)) ? "パスワード保護されたPDFには対応していません。" : "PDFを読み込めませんでした。", true);
    }
  }
  el.file.addEventListener("change", () => { if (el.file.files[0]) loadFile(el.file.files[0]); el.file.value = ""; });
  wireDrop($("pn-drop"), (fs) => loadFile(fs[0]));

  el.save.addEventListener("click", async () => {
    if (!pdfBytes) return;
    if (el.format.value === "custom" && !pageTexts.some((t) => t && t.trim())) { setSaveStatus("どのページにも文字が入力されていません。", true); return; }
    const target = await pickSaveTarget(`${baseName}_pageno.pdf`);
    if (target === false) { setSaveStatus("保存をキャンセルしました。"); return; }
    el.save.disabled = true; setSaveStatus("書き込み中…");
    try {
      const o = opts(), doc = await PDFDocument.load(pdfBytes, { updateMetadata: false }), pages = doc.getPages();
      await ensureFont(o, "0123456789頁ページp./- ");
      const seedBase = (Math.random() * 1e9) | 0;
      let numbered = 0;
      for (let i = o.from; i <= pages.length; i++) {
        const text = labelText(o, i, pages.length);
        if (!text) continue;   // 手入力で空欄のページには付けない
        numbered++;
        const pg = pages[i - 1], { x: cx0, y: cy0, width: pw, height: ph } = pg.getCropBox();
        const R = ((pg.getRotation().angle % 360) + 360) % 360;
        const vw = R % 180 ? ph : pw, vh = R % 180 ? pw : ph;
        const lab = renderLabel(text, o, 4, seedBase + i), { ox, oy } = place(vw, vh, lab, o);
        const blob = await new Promise((res) => lab.canvas.toBlob(res, "image/png"));
        const img = await doc.embedPng(new Uint8Array(await blob.arrayBuffer()));
        // 見た目の左下を原点とする(ox,oy)を、ページ(/Rotate)の座標へ戻す。画像はページと逆向きに回して正立させる
        const base = { 0: [cx0, cy0], 90: [cx0 + pw, cy0], 180: [cx0 + pw, cy0 + ph], 270: [cx0, cy0 + ph] }[R] || [cx0, cy0];
        const off = { 0: [ox, oy], 90: [-oy, ox], 180: [-ox, -oy], 270: [oy, -ox] }[R] || [ox, oy];
        pg.drawImage(img, { x: base[0] + off[0], y: base[1] + off[1], width: lab.w, height: lab.h, rotate: degrees(R) });
        setSaveStatus(`書き込み中… ${i}/${pages.length}ページ`);
      }
      await saveBlob(new Blob([await doc.save()], { type: "application/pdf" }), `${baseName}_pageno.pdf`, target);
      setSaveStatus(`保存しました（${numbered}ページに番号を入れました、${pos[0]}）。${target ? "" : "ダウンロードを開始しました。"}`);
    } catch (e) {
      setSaveStatus("保存に失敗しました: " + (e && e.message || e), true);
    } finally { el.save.disabled = false; }
  });
})();
