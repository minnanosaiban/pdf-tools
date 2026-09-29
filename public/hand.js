"use strict";

// 手書き風文字追加（新機能）。ページをクリックして文字を置く。
// 文字はGoogle Fontsの手書き系書体で1文字ずつ位置・角度・大きさを少しずらして描き、
// 保存時はページ全面の透明PNGにして元PDFの上へ重ねる（元のページ内容は壊さない）。
(() => {
  const { PDFDocument, degrees } = PDFLib;

  let pdf = null, pdfBytes = null, baseName = "pdf";
  let items = [];              // { id, page, x, y(0..1・左上), text, font, color, size(pt), jitter, angle, seed }
  let selectedId = null, seq = 0;

  const el = {
    text: $("hw-text"), font: $("hw-font"), color: $("hw-color"), size: $("hw-size"),
    jitter: $("hw-jitter"), angle: $("hw-angle"),
    count: $("hw-count"), del: $("hw-delete"), clear: $("hw-clear"), save: $("hw-save"),
    saveStatus: $("hw-saveStatus"), status: $("hw-status"),
  };
  const setStatus = (m, err) => { el.status.textContent = m || ""; el.status.classList.toggle("is-error", !!err); };
  const setSaveStatus = (m, err) => { el.saveStatus.textContent = m || ""; el.saveStatus.classList.toggle("is-error-text", !!err); };

  const viewer = new PageViewer($("hw-pages"), {
    scale: 1.5,
    onRendered: (p) => redraw(p),
    decorate: (p, d) => attach(p, d),
  });
  blockStrayDrop($("hw-pages"));

  // ---- 乱数（同じseedなら毎回同じゆらぎ＝再描画してもガタつかない） ----
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- 文字の描画（画面・書き出し共通）。s = 1ptあたりのpx数 ----
  function fontStr(it, s) { return `${it.size * s}px "${it.font}", "Yomogi", "Klee One", cursive`; }

  function measure(ctx, it, s) {
    ctx.font = fontStr(it, s);
    const lines = it.text.split("\n");
    let w = 0;
    for (const ln of lines) w = Math.max(w, ctx.measureText(ln).width);
    return { lines, w, lh: it.size * s * 1.35, h: it.size * s * 1.35 * lines.length };
  }

  function drawItem(ctx, it, W, H, s) {
    const m = measure(ctx, it, s);
    const j = it.jitter / 100, r = rng(it.seed);
    ctx.save();
    ctx.translate(it.x * W, it.y * H);
    ctx.rotate(it.angle * Math.PI / 180);
    ctx.font = fontStr(it, s);
    ctx.fillStyle = it.color;
    ctx.textBaseline = "top";
    m.lines.forEach((ln, li) => {
      let x = (r() - 0.5) * it.size * s * 0.3 * j;      // 行頭のずれ
      const y0 = li * m.lh + (r() - 0.5) * it.size * s * 0.12 * j;
      for (const ch of ln) {
        const dy = (r() - 0.5) * it.size * s * 0.2 * j;
        const rot = (r() - 0.5) * 0.2 * j;
        const sc = 1 + (r() - 0.5) * 0.14 * j;
        const adv = ctx.measureText(ch).width;
        ctx.save();
        ctx.translate(x + adv / 2, y0 + dy + it.size * s * 0.5);
        ctx.rotate(rot); ctx.scale(sc, sc);
        ctx.fillText(ch, -adv / 2, -it.size * s * 0.5);
        ctx.restore();
        x += adv * (1 + (r() - 0.5) * 0.08 * j);
      }
    });
    ctx.restore();
    return m;
  }

  function redraw(p) {
    const d = viewer.dom[p];
    if (!d || !d.rendered) return;
    const o = d.overlay, ctx = o.getContext("2d"), W = o.width, H = o.height;
    const s = W / (d.ptW || (W / viewer.scale));   // 画面のpx/pt（=表示倍率）
    ctx.clearRect(0, 0, W, H);
    for (const it of items) {
      if (it.page !== p) continue;
      const m = drawItem(ctx, it, W, H, s);
      if (it.id === selectedId) {
        ctx.save();
        ctx.translate(it.x * W, it.y * H); ctx.rotate(it.angle * Math.PI / 180);
        ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(30,33,38,.75)";
        ctx.strokeRect(-4, -4, m.w + 8, m.h + 8);
        ctx.restore();
      }
    }
  }
  const redrawAll = () => { for (const k of Object.keys(viewer.dom)) redraw(+k); };

  function ensureFont(it) {
    if (!document.fonts || !document.fonts.load) return;
    document.fonts.load(fontStr(it, 1).replace(/^[\d.]+px/, "24px"), it.text || "あ").then(redrawAll).catch(() => {});
  }

  // ---- 選択・コントロール同期 ----
  const byId = (id) => items.find((i) => i.id === id);
  function updateChrome() {
    el.count.textContent = `文字: ${items.length}`;
    el.del.disabled = selectedId == null;
    el.save.disabled = !pdf || items.length === 0;
  }
  function select(id) {
    selectedId = id;
    const it = byId(id);
    if (it) {
      el.text.value = it.text; el.font.value = it.font; el.color.value = it.color;
      el.size.value = it.size; el.jitter.value = it.jitter; el.angle.value = it.angle;
    }
    updateChrome(); redrawAll();
  }
  function applyControls() {
    const it = byId(selectedId);
    if (!it) return;
    it.text = el.text.value; it.font = el.font.value; it.color = el.color.value;
    it.size = +el.size.value; it.jitter = +el.jitter.value; it.angle = +el.angle.value;
    if (!it.text.trim()) { items = items.filter((i) => i !== it); selectedId = null; updateChrome(); }
    ensureFont(it); redrawAll();
  }
  for (const k of ["text", "font", "color", "size", "jitter", "angle"]) {
    el[k].addEventListener("input", applyControls);
  }
  el.del.onclick = () => { items = items.filter((i) => i.id !== selectedId); selectedId = null; updateChrome(); redrawAll(); };
  el.clear.onclick = () => { items = []; selectedId = null; updateChrome(); redrawAll(); };
  document.addEventListener("keydown", (e) => {
    if ($("panel-hand").hidden) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
    if (e.key === "Escape") { select(null); }
    else if ((e.key === "Delete" || e.key === "Backspace") && selectedId != null && !typing) { e.preventDefault(); el.del.click(); }
  });

  // ---- ページ上の操作：クリックで追加／ドラッグで移動 ----
  function attach(p, d) {
    const o = d.overlay;
    const norm = (e) => {
      const r = o.getBoundingClientRect();
      return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    };
    const hit = (q) => {
      const ctx = o.getContext("2d"), W = o.width, H = o.height, s = W / (d.ptW || (W / viewer.scale));
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it.page !== p) continue;
        const m = measure(ctx, it, s);
        const a = -it.angle * Math.PI / 180;
        const dx = q.x * W - it.x * W, dy = q.y * H - it.y * H;
        const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
        if (lx >= -6 && lx <= m.w + 6 && ly >= -6 && ly <= m.h + 6) return it;
      }
      return null;
    };
    let drag = null;
    o.addEventListener("pointerdown", (e) => {
      if (!d.rendered) return;
      const q = norm(e), it = hit(q);
      if (it) {
        o.setPointerCapture(e.pointerId);
        drag = { it, ox: q.x - it.x, oy: q.y - it.y, moved: false };
        if (selectedId !== it.id) select(it.id);
      } else if (el.text.value.trim()) {
        const size = +el.size.value;
        const n = { id: ++seq, page: p, x: clamp01(q.x), y: clamp01(q.y - (size * 0.6) / (o.height / viewer.scale)),
          text: el.text.value, font: el.font.value, color: el.color.value, size,
          jitter: +el.jitter.value, angle: +el.angle.value, seed: (Math.random() * 1e9) | 0 };
        items.push(n); ensureFont(n); select(n.id);
        setStatus(`p.${p} に文字を追加しました。ドラッグで移動、Deleteで削除できます。`);
      } else {
        select(null);
        setStatus("先に上の「追加する文字」を入力してから、ページをクリックしてください。");
      }
    });
    o.addEventListener("pointermove", (e) => {
      const q = norm(e);
      if (drag) {
        drag.moved = true;
        drag.it.x = clamp01(q.x - drag.ox); drag.it.y = clamp01(q.y - drag.oy);
        redraw(p);
      } else {
        o.style.cursor = hit(q) ? "move" : "text";
      }
    });
    const end = () => { drag = null; };
    o.addEventListener("pointerup", end);
    o.addEventListener("pointercancel", end);
  }

  // ---- 読み込み ----
  $("hw-file").onchange = (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ""; };
  wireDrop($("hw-drop"), (fs) => loadFile(fs[0]));

  async function loadFile(file) {
    setSaveStatus("");
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      pdfBytes = buf.slice();
      pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      items = []; selectedId = null;
      await viewer.load(pdf);
      // 画面のpx/ptを求めるため、各ページのpt幅を記録（scale 1 の幅）
      for (let p = 1; p <= pdf.numPages; p++) {
        viewer.dom[p].ptW = (await pdf.getPage(p)).getViewport({ scale: 1 }).width;
      }
      baseName = file.name.replace(/\.pdf$/i, "") || "pdf";
      setStatus(`${file.name}（${pdf.numPages}ページ）を読み込みました。上に文字を入力し、置きたい場所をクリックしてください。`);
    } catch (e) {
      pdf = null;
      setStatus(/password|encrypt/i.test(String(e && e.message || e)) ? "パスワード保護されたPDFには対応していません。" : "PDFを読み込めませんでした。", true);
    }
    updateChrome();
  }

  // ---- 保存 ----
  el.save.onclick = async () => {
    if (!pdf || !items.length) return;
    el.save.disabled = true; setSaveStatus("PDFに書き込み中…");
    try {
      await Promise.all(items.map((it) => document.fonts.load(fontStr(it, 1).replace(/^[\d.]+px/, "24px"), it.text)));
      const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
      const pages = doc.getPages();
      const pagesWith = [...new Set(items.map((i) => i.page))].sort((a, b) => a - b);
      for (const p of pagesWith) {
        const pg = pdf ? await pdf.getPage(p) : null;
        const vis = pg.getViewport({ scale: 1 });                 // 見た目（回転込み）の寸法pt
        const k = Math.min(3, 4096 / Math.max(vis.width, vis.height));
        const c = document.createElement("canvas");
        c.width = Math.round(vis.width * k); c.height = Math.round(vis.height * k);
        const ctx = c.getContext("2d");
        for (const it of items) if (it.page === p) drawItem(ctx, it, c.width, c.height, k);
        const blob = await new Promise((res) => c.toBlob(res, "image/png"));
        const img = await doc.embedPng(new Uint8Array(await blob.arrayBuffer()));
        const target = pages[p - 1];
        const { width: pw, height: ph } = target.getSize();
        const R = ((target.getRotation().angle % 360) + 360) % 360;
        const pos = { 0: [0, 0], 90: [pw, 0], 180: [pw, ph], 270: [0, ph] }[R] || [0, 0];
        target.drawImage(img, { x: pos[0], y: pos[1], width: vis.width, height: vis.height, rotate: degrees(R) });
        setSaveStatus(`書き込み中… ${p}ページ`);
      }
      triggerDownload(new Blob([await doc.save()], { type: "application/pdf" }), `${baseName}_hand.pdf`);
      setSaveStatus(`保存しました（${items.length}件の文字を追加、ダウンロードを開始しました）。文字は画像として重ねているため、PDF上では選択・検索できません。`);
    } catch (e) {
      setSaveStatus("保存に失敗しました: " + (e && e.message || e), true);
    } finally { updateChrome(); }
  };

  updateChrome();
})();
