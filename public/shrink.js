"use strict";

// 縮小・配置：各ページを指定の倍率に縮め、同じ用紙サイズのページ内の指定位置へ置く。
// 元ページをそのまま埋め込む（画像化しない）ので、文字や図は縮小後も劣化しない。
(() => {
  const { PDFDocument, degrees } = PDFLib;

  const POS = [   // [ラベル, 横(0左/.5中/1右), 縦(0上/.5中/1下)]
    ["左上", 0, 0], ["上中央", .5, 0], ["右上", 1, 0],
    ["左中央", 0, .5], ["中心", .5, .5], ["右中央", 1, .5],
    ["左下", 0, 1], ["下中央", .5, 1], ["右下", 1, 1],
  ];
  let pdfBytes = null, baseName = "pdf", aspect = 210 / 297, pos = POS[0];

  const el = {
    file: $("sh-file"), name: $("sh-filename"), status: $("sh-status"), area: $("sh-area"),
    range: $("sh-scaleRange"), num: $("sh-scale"), posBox: $("sh-pos"),
    prev: $("sh-preview"), inner: $("sh-previewInner"), save: $("sh-save"), saveStatus: $("sh-saveStatus"),
  };
  const setStatus = (m, err) => { el.status.textContent = m || ""; el.status.classList.toggle("is-error", !!err); };
  const setSaveStatus = (m, err) => { el.saveStatus.textContent = m || ""; el.saveStatus.classList.toggle("is-error-text", !!err); };
  const getScale = () => Math.min(100, Math.max(20, Math.round(+el.num.value) || 85));

  POS.forEach((p, i) => {
    const l = document.createElement("label");
    l.innerHTML = `<input type="radio" name="sh-pos"${i === 4 ? " checked" : ""}><span></span>`;
    l.querySelector("span").textContent = p[0];
    l.querySelector("input").addEventListener("change", () => { pos = p; drawPreview(); });
    el.posBox.appendChild(l);
  });
  pos = POS[4];   // 初期値は中心

  function drawPreview() {
    const s = getScale() / 100;
    el.prev.style.aspectRatio = String(aspect);
    el.inner.style.width = s * 100 + "%"; el.inner.style.height = s * 100 + "%";
    el.inner.style.left = pos[1] * (1 - s) * 100 + "%"; el.inner.style.top = pos[2] * (1 - s) * 100 + "%";
  }
  el.range.addEventListener("input", () => { el.num.value = el.range.value; drawPreview(); });
  el.num.addEventListener("input", () => { el.range.value = getScale(); drawPreview(); });
  el.num.addEventListener("change", () => { el.num.value = getScale(); el.range.value = el.num.value; drawPreview(); });

  async function loadFile(file) {
    setSaveStatus(""); el.area.hidden = true; setStatus("読み込み中…");
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const doc = await PDFDocument.load(buf, { updateMetadata: false });
      const p0 = doc.getPage(0), cb = p0.getCropBox(), R = ((p0.getRotation().angle % 360) + 360) % 360;
      aspect = (R % 180 ? cb.height / cb.width : cb.width / cb.height) || 1;
      pdfBytes = buf; baseName = file.name.replace(/\.pdf$/i, "") || "pdf";
      el.name.hidden = false; el.name.textContent = `${file.name}（${doc.getPageCount()}ページ）`;
      el.area.hidden = false; drawPreview();
      setStatus("倍率と位置を選んで「縮小して保存」を押してください。全ページに同じ設定が適用されます。");
    } catch (e) {
      pdfBytes = null;
      setStatus(/encrypt|password/i.test(String(e && e.message || e)) ? "パスワード保護されたPDFには対応していません。" : "PDFを読み込めませんでした。", true);
    }
  }
  el.file.addEventListener("change", () => { if (el.file.files[0]) loadFile(el.file.files[0]); el.file.value = ""; });
  wireDrop($("sh-drop"), (fs) => loadFile(fs[0]));

  el.save.addEventListener("click", async () => {
    if (!pdfBytes) return;
    const target = await pickSaveTarget(`${baseName}_${getScale()}pct.pdf`);
    if (target === false) { setSaveStatus("保存をキャンセルしました。"); return; }
    el.save.disabled = true; setSaveStatus("変換中…");
    try {
      const src = await PDFDocument.load(pdfBytes, { updateMetadata: false });
      const out = await PDFDocument.create();
      const pages = src.getPages();
      // 表示領域(CropBox)をそのまま埋め込む。原点が(0,0)でないPDFでもずれない
      // 中身（Contents）が無い白紙ページは埋め込めないので、そのページは白紙のまま出力する
      const embedded = [];
      for (const pg of pages) {
        const b = pg.getCropBox();
        if (!pg.node.Contents()) { embedded.push(null); continue; }   // 埋め込みは保存時に失敗するので、先に見分ける
        embedded.push(await out.embedPage(pg, { left: b.x, bottom: b.y, right: b.x + b.width, top: b.y + b.height }));
      }
      const k = getScale() / 100;
      pages.forEach((pg, i) => {
        const { width: cw, height: ch } = pg.getCropBox();
        const R = ((pg.getRotation().angle % 360) + 360) % 360;
        const vw = R % 180 ? ch : cw, vh = R % 180 ? cw : ch;   // 見た目（回転込み）の寸法
        const np = out.addPage([vw, vh]);
        if (!embedded[i]) return;
        const sw = vw * k, sh = vh * k;
        const ox = (vw - sw) * pos[1], oy = (vh - sh) * (1 - pos[2]);   // PDFは左下原点なので縦は反転
        // 回転ページ(/Rotate)は時計回りに表示される。埋め込んだ内容も時計回りにR度回し、回した後の左下が(ox,oy)になる基準点に置く
        const [ax, ay] = { 0: [ox, oy], 90: [ox, oy + sh], 180: [ox + sw, oy + sh], 270: [ox + sw, oy] }[R] || [ox, oy];
        np.drawPage(embedded[i], { x: ax, y: ay, xScale: k, yScale: k, rotate: degrees(-R) });
        setSaveStatus(`変換中… ${i + 1}/${pages.length}ページ`);
      });
      const t = src.getTitle(); if (t) out.setTitle(t);
      await saveBlob(new Blob([await out.save()], { type: "application/pdf" }), `${baseName}_${getScale()}pct.pdf`, target);
      setSaveStatus(`保存しました（${pages.length}ページ、${getScale()}％、${pos[0]}）。${target ? "" : "ダウンロードを開始しました。"}`);
    } catch (e) {
      setSaveStatus("保存に失敗しました: " + (e && e.message || e), true);
    } finally { el.save.disabled = false; }
  });
})();
