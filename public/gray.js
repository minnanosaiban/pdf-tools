"use strict";

// 白黒化：PDFを画像にせず、グレースケール（白黒）の見た目にして書き出す。
// 各ページの一番上に、ページ全面を覆う灰色の四角を「彩度」ブレンドモードで重ねる。
// 彩度モードは「下の絵の色相・明るさ」はそのままに、「彩度」だけを灰色（=0）にするので、
// 文字・図・画像のすべてが白黒に見える。元のページ内容は書き換えないので、テキストレイヤも残る。
(() => {
  const { PDFDocument, pushGraphicsState, popGraphicsState, setGraphicsState, setFillingGrayscaleColor, rectangle, fill } = PDFLib;
  const BIG = 1e6;   // どんな座標系・原点のページでも覆えるよう、ページよりはるかに大きい四角にする（描画はページ枠で切り取られる）

  const el = {};
  for (const k of ["file", "filename", "reset", "status", "area", "preview", "info", "save", "saveStatus"]) el[k] = $("gr-" + k);
  const setStatus = (m, err) => { el.status.textContent = m || ""; el.status.classList.toggle("is-error", !!err); };
  const setSaveStatus = (m, err) => { el.saveStatus.textContent = m || ""; el.saveStatus.classList.toggle("is-error-text", !!err); };

  let outBytes = null, baseName = "pdf", gen = 0, previewDoc = null;

  async function makeGray(buf) {
    const doc = await PDFDocument.load(buf, { updateMetadata: false });
    // pdf-libのdrawRectangleは彩度ブレンドを選べないので、描画命令を直接足す
    const gs = doc.context.register(doc.context.obj({ Type: "ExtGState", BM: "Saturation", ca: 1, CA: 1 }));
    for (const pg of doc.getPages()) {
      const key = pg.node.newExtGState("GSgray", gs);
      pg.pushOperators(pushGraphicsState(), setGraphicsState(key), setFillingGrayscaleColor(0.5), rectangle(-BIG, -BIG, BIG * 2, BIG * 2), fill(), popGraphicsState());
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
      const bytes = await makeGray(buf);
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

  el.reset.addEventListener("click", () => {
    gen++; outBytes = null;
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
