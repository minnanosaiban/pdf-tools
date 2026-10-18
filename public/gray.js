"use strict";

// 白黒化：PDFを画像にせず、グレースケール（白黒）の見た目にして書き出す。
// 各ページの一番上に、ページ全面を覆う灰色の四角を「彩度」ブレンドモードで重ねる。
// 彩度モードは「下の絵の色相・明るさ」はそのままに、「彩度」だけを灰色（=0）にするので、
// 文字・図・画像のすべてが白黒に見える。元のページ内容は書き換えないので、テキストレイヤも残る。
(() => {
  const { PDFDocument, pushGraphicsState, popGraphicsState, setGraphicsState, setFillingGrayscaleColor, rectangle, fill } = PDFLib;
  const BIG = 1e6;   // どんな座標系・原点のページでも覆えるよう、ページよりはるかに大きい四角にする（描画はページ枠で切り取られる）

  const el = {};
  for (const k of ["file", "filename", "reset", "status", "area", "preview", "info", "save", "saveStatus", "level"]) el[k] = $("gr-" + k);
  const setStatus = (m, err) => { el.status.textContent = m || ""; el.status.classList.toggle("is-error", !!err); };
  const setSaveStatus = (m, err) => { el.saveStatus.textContent = m || ""; el.saveStatus.classList.toggle("is-error-text", !!err); };

  let outBytes = null, srcBytes = null, baseName = "pdf", gen = 0, previewDoc = null;

  // level: 0=標準、以降は少しずつ濃く（暗い色をより暗くする。白は白のまま）
  const BURN = [null, 0.8, 0.6];
  async function makeGray(buf, level) {
    const doc = await PDFDocument.load(buf, { updateMetadata: false });
    // pdf-libのdrawRectangleは彩度ブレンドを選べないので、描画命令を直接足す
    const ext = (bm) => doc.context.register(doc.context.obj({ Type: "ExtGState", BM: bm, ca: 1, CA: 1 }));
    const gsSat = ext("Saturation"), gsBurn = ext("ColorBurn");
    const cover = () => rectangle(-BIG, -BIG, BIG * 2, BIG * 2);
    for (const pg of doc.getPages()) {
      // 1) 元の内容の「下」に白を敷く。下地が透明のままだと、彩度ブレンドの相手がなく、重ねた灰色がそのまま出てしまう（白がグレーになる）
      const white = doc.context.register(doc.context.contentStream([pushGraphicsState(), setFillingGrayscaleColor(1), cover(), fill(), popGraphicsState()]));
      // 2) 元の内容の「上」に、彩度を0にする重ね（色相・明るさは保つ）。必要なら濃くする重ねも足す
      const ops = [pushGraphicsState(), setGraphicsState(pg.node.newExtGState("GSsat", gsSat)), setFillingGrayscaleColor(0.5), cover(), fill(), popGraphicsState()];
      if (BURN[level]) ops.push(pushGraphicsState(), setGraphicsState(pg.node.newExtGState("GSburn", gsBurn)), setFillingGrayscaleColor(BURN[level]), cover(), fill(), popGraphicsState());
      const top = doc.context.register(doc.context.contentStream(ops));
      pg.node.wrapContentStreams(white, top);
    }
    return await doc.save();
  }

  // できあがりのPDFを、実際に描いて確かめる（1ページ目）
  async function drawPreview(bytes, g) {
    const old = previewDoc; previewDoc = null;
    if (old) Promise.resolve(old.destroy()).catch(() => {});
    const doc = await pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
    if (g !== gen) { Promise.resolve(doc.destroy()).catch(() => {}); return; }
    previewDoc = doc;
    const page = await doc.getPage(1), vp1 = page.getViewport({ scale: 1 }), s = 520 / vp1.width, vp = page.getViewport({ scale: s });
    const c = document.createElement("canvas"); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    if (g !== gen) return;
    el.preview.width = c.width; el.preview.height = c.height;
    el.preview.getContext("2d").drawImage(c, 0, 0);
  }

  async function loadFile(file) {
    const g = ++gen;
    setSaveStatus(""); el.area.hidden = true; el.save.disabled = true; outBytes = null; setStatus("読み込み中…");
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      srcBytes = buf;
      const bytes = await makeGray(buf, +el.level.value);
      if (g !== gen) return;
      outBytes = bytes; baseName = file.name.replace(/\.pdf$/i, "") || "pdf";
      const n = (await PDFDocument.load(buf, { updateMetadata: false })).getPageCount();
      el.filename.hidden = false; el.filename.textContent = `${file.name}（${n}ページ）`;
      el.info.textContent = `${n}ページ分を白黒にします。下は、できあがりの1ページ目です。`;
      el.area.hidden = false; el.reset.hidden = false;
      await drawPreview(bytes, g);
      if (g !== gen) return;
      el.save.disabled = false;
      setStatus("「白黒にして保存」を押してください。");
    } catch (e) {
      if (g !== gen) return;
      outBytes = null; el.reset.hidden = true;
      setStatus(/encrypt|password/i.test(String(e && e.message || e)) ? "パスワード保護されたPDFには対応していません。" : "PDFを読み込めませんでした。", true);
    }
  }
  el.file.addEventListener("change", () => { if (el.file.files[0]) loadFile(el.file.files[0]); el.file.value = ""; });
  wireDrop($("gr-drop"), (fs) => loadFile(fs[0]));

  // 濃さを変えたら、作り直してプレビューを更新する
  el.level.addEventListener("change", async () => {
    if (!srcBytes) return;
    const g = ++gen; el.save.disabled = true; outBytes = null; setSaveStatus("");
    try {
      const bytes = await makeGray(srcBytes, +el.level.value);
      if (g !== gen) return;
      outBytes = bytes; await drawPreview(bytes, g);
      if (g === gen) el.save.disabled = false;
    } catch (e) { if (g === gen) setStatus("白黒化に失敗しました。", true); }
  });

  el.reset.addEventListener("click", () => {
    gen++; outBytes = null; srcBytes = null;
    if (previewDoc) { const old = previewDoc; previewDoc = null; Promise.resolve(old.destroy()).catch(() => {}); }
    el.area.hidden = true; el.filename.hidden = true; el.reset.hidden = true; el.save.disabled = true;
    setSaveStatus(""); setStatus("PDFを選ぶと、白黒にしたイメージが表示されます。");
  });

  el.save.addEventListener("click", async () => {
    if (!outBytes) return;
    const fname = `${baseName}_gray.pdf`, target = await pickSaveTarget(fname);
    if (target === false) { setSaveStatus("保存をキャンセルしました。"); return; }
    el.save.disabled = true; setSaveStatus("保存中…");
    try {
      await saveBlob(new Blob([outBytes], { type: "application/pdf" }), fname, target);
      setSaveStatus(`保存しました。${target ? "" : "ダウンロードを開始しました。"}`);
    } catch (e) { setSaveStatus("保存に失敗しました: " + (e && e.message || e), true); }
    finally { el.save.disabled = false; }
  });
})();
