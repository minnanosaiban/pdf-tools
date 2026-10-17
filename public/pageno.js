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
  for (const k of ["file", "filename", "status", "area", "format", "font", "size", "color", "jitter", "angle", "jitterNote", "margin", "from", "first", "mode", "chapters", "modeBox", "fromBox", "skipNote", "previewBox", "firstBox", "firstLabel", "chaptersBox", "pager", "prev", "next", "pageInfo", "docName", "filled", "pageText", "pageCanvas", "open", "saveWork", "pos", "preview", "save", "saveStatus"]) el[k] = $("pn-" + k);
  const setStatus = (m, err) => { el.status.textContent = m || ""; el.status.classList.toggle("is-error", !!err); };
  const setSaveStatus = (m, err) => { el.saveStatus.textContent = m || ""; el.saveStatus.classList.toggle("is-error-text", !!err); };
  const num = (e, lo, hi, def) => Math.min(hi, Math.max(lo, Math.round(+e.value) || def));
  const opts = () => ({
    format: el.format.value, font: el.font.value, size: num(el.size, 6, 72, 12), color: el.color.value, jitter: +el.jitter.value, angle: +el.angle.value || 0,
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
    const lines = text.split("\n").map((ln) => { const chars = Array.from(ln); return { chars, adv: chars.map((ch) => ctx.measureText(ch).width) }; });
    const lw = lines.map((l) => l.adv.reduce((a, b) => a + b, 0) / k), lh = o.size * 1.2;
    const tw0 = Math.max(...lw, 0), th0 = lh * lines.length;
    // 傾けたあとの外接サイズ。余白（置く位置の計算）はこの大きさで測る
    const ang = o.angle * Math.PI / 180, cs = Math.abs(Math.cos(ang)), sn = Math.abs(Math.sin(ang));
    const tw = tw0 * cs + th0 * sn, th = tw0 * sn + th0 * cs;
    c.width = Math.ceil((tw + pad * 2) * k * 1.04); c.height = Math.ceil((th + pad * 2) * k);
    ctx.font = fontStr(o, px); ctx.fillStyle = o.color; ctx.textBaseline = "middle";
    const hand = o.font !== "std", j = hand ? o.jitter / 100 : 0, r = rng(seed);
    ctx.translate(c.width / 2, c.height / 2); ctx.rotate(ang);
    lines.forEach((l, li) => {
      // 行頭と行の高さを少しずらす（「手書き風文字追加」と同じ）。複数行は置く位置に合わせて左／中央／右にそろえる
      let x = (-tw0 / 2 + (tw0 - lw[li]) * pos[1] + (r() - 0.5) * o.size * 0.3 * j) * k;
      const cy = (-th0 / 2 + lh * (li + 0.5) + (r() - 0.5) * o.size * 0.12 * j) * k;
      l.chars.forEach((ch, i) => {
        const dy = (r() - 0.5) * px * 0.2 * j, rot = (r() - 0.5) * 0.2 * j, sc = 1 + (r() - 0.5) * 0.14 * j;
        ctx.save();
        ctx.translate(x + l.adv[i] / 2, cy + dy); ctx.rotate(rot); ctx.scale(sc, sc);
        ctx.fillText(ch, -l.adv[i] / 2, 0);
        ctx.restore();
        x += l.adv[i] * (1 + (r() - 0.5) * 0.08 * j);
      });
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
    if (o.format === "custom") return (o.texts[i - 1] || "").replace(/^\s+|\s+$/g, "");   // 手入力：自動の番号は使わない
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
  for (const k of ["format", "font", "size", "color", "jitter", "angle", "margin", "from", "first", "mode", "chapters"]) {
    el[k].addEventListener("input", refresh);
    el[k].addEventListener("change", refresh);
  }
  el.font.addEventListener("change", () => { el.jitter.disabled = el.font.value === "std"; el.jitterNote.hidden = el.font.value !== "std"; });
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
    el.docName.textContent = `📄 ${baseName}.pdf`;
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
  el.pageText.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.isComposing) { e.preventDefault(); showPage(cur + 1); } });   // Enterは改行。Ctrl+Enterで次のページ
  el.prev.addEventListener("click", () => showPage(cur - 1));
  el.next.addEventListener("click", () => showPage(cur + 1));

  // 作業ファイルの設定を画面へ戻す（受け取った.jsonは信用せず、選択肢・範囲を確かめてから使う）
  function applyState(st) {
    const sel = (e, v) => { if (typeof v === "string" && [...e.options].some((o) => o.value === v)) e.value = v; };
    const num2 = (e, v, lo, hi) => { v = +v; if (Number.isFinite(v)) e.value = Math.min(hi, Math.max(lo, v)); };
    sel(el.format, st.format); sel(el.font, st.font); sel(el.mode, st.mode);
    num2(el.size, st.size, 6, 72); num2(el.jitter, st.jitter, 0, 100); num2(el.angle, st.angle, -15, 15);
    num2(el.margin, st.margin, 0, 100); num2(el.from, st.from, 1, pageCount); num2(el.first, st.first, 0, 9999);
    if (typeof st.color === "string" && /^#[0-9a-f]{6}$/i.test(st.color)) el.color.value = st.color;
    el.chapters.value = typeof st.chapters === "string" ? st.chapters.slice(0, 200) : "";
    const pi = Number.isInteger(st.pos) && POS[st.pos] ? st.pos : 5;
    pos = POS[pi]; el.pos.querySelectorAll("input")[pi].checked = true;
    pageTexts = Array.isArray(st.texts) ? st.texts.slice(0, pageCount).map((t) => (typeof t === "string" ? t.slice(0, 500) : "")) : [];
    el.jitter.disabled = el.font.value === "std"; el.jitterNote.hidden = el.font.value !== "std";
  }
  const gatherState = () => ({ format: el.format.value, font: el.font.value, size: +el.size.value, color: el.color.value, jitter: +el.jitter.value,
    angle: +el.angle.value, margin: +el.margin.value, from: +el.from.value, first: +el.first.value, mode: el.mode.value,
    chapters: el.chapters.value, pos: POS.indexOf(pos), texts: pageTexts });

  // restore があれば、それ（作業ファイルの中のPDFと設定）から読み込む
  async function loadFile(file, restore) {
    setSaveStatus(""); el.area.hidden = true; setStatus("読み込み中…");
    try {
      const buf = restore ? restore.bytes : new Uint8Array(await file.arrayBuffer());
      const fileName = restore ? restore.name : file.name;
      const doc = await PDFDocument.load(buf, { updateMetadata: false });
      const p0 = doc.getPage(0), cb = p0.getCropBox(), R = ((p0.getRotation().angle % 360) + 360) % 360;
      pageW = R % 180 ? cb.height : cb.width; pageH = R % 180 ? cb.width : cb.height;
      pageCount = doc.getPageCount(); pdfBytes = buf; baseName = fileName.replace(/\.pdf$/i, "") || "pdf";
      el.from.max = pageCount; if (+el.from.value > pageCount) el.from.value = 1;
      if (pnPdf) { const old = pnPdf; pnPdf = null; Promise.resolve(old.destroy()).catch(() => {}); }
      pnPdf = await pdfjsLib.getDocument({ data: buf.slice(), isEvalSupported: false }).promise;
      pageTexts = []; baseCanvas = null;
      if (restore) applyState(restore.state);
      el.filename.hidden = false; el.filename.textContent = `${fileName}（${pageCount}ページ）`;
      el.area.hidden = false; syncMode(); drawPreview(); if (el.format.value === "custom") showPage(1);
      el.save.disabled = el.saveWork.disabled = false;
      setStatus(restore ? `作業ファイルから「${fileName}」を開きました。続きから編集できます。` : "書式・位置などを選んで「PDFを保存」を押してください。");
    } catch (e) {
      pdfBytes = null; el.save.disabled = el.saveWork.disabled = true;
      setStatus(/encrypt|password/i.test(String(e && e.message || e)) ? "パスワード保護されたPDFには対応していません。" : "PDFを読み込めませんでした。", true);
    }
  }
  el.file.addEventListener("change", () => { if (el.file.files[0]) loadFile(el.file.files[0]); el.file.value = ""; });
  el.open.addEventListener("change", async () => {
    const f = el.open.files[0]; el.open.value = "";
    if (!f) return;
    if (/\.pdf$/i.test(f.name) || f.type === "application/pdf") { loadFile(f); return; }
    try { await loadFile(null, await readWorkFile(f, "pageno")); }
    catch (e) { setStatus(String(e && e.message || e), true); }
  });
  el.saveWork.addEventListener("click", async () => {
    if (!pdfBytes) return;
    const fname = `${baseName}_pageno.json`, target = await pickSaveTarget(fname, "json");
    if (target === false) { setSaveStatus("保存をキャンセルしました。"); return; }
    try {
      await saveBlob(makeWorkBlob("pageno", pdfBytes, baseName + ".pdf", gatherState()), fname, target);
      setSaveStatus(`作業を保存しました。${target ? "" : "ダウンロードを開始しました。"}「ファイルを開く」から続きを編集できます。`);
    } catch (e) { setSaveStatus("作業ファイルの保存に失敗しました: " + (e && e.message || e), true); }
  });
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
