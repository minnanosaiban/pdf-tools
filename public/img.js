"use strict";

// 画像に変換：PDFの各ページをPNG／JPEGの画像にして保存する。
// pdf.jsでページをcanvasに描き、そのcanvasを画像ファイルにする（すべてブラウザ内で処理）。
(() => {
  const el = {};
  for (const k of ["file", "filename", "reset", "status", "area", "info", "format", "scale", "quality", "qualityRow", "save", "saveStatus"]) el[k] = $("im-" + k);
  const setStatus = (m, err) => { el.status.textContent = m || ""; el.status.classList.toggle("is-error", !!err); };
  const setSaveStatus = (m, err) => { el.saveStatus.textContent = m || ""; el.saveStatus.classList.toggle("is-error-text", !!err); };

  const MAX_SIDE = 12000;   // canvasの一辺の上限の目安（大きすぎるとブラウザが描けない）
  let doc = null, baseName = "pdf", gen = 0, busy = false;

  const closeDoc = () => { const old = doc; doc = null; if (old) Promise.resolve(old.destroy()).catch(() => {}); };
  const toBlob = (c, type, q) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("画像を作れませんでした"))), type, q));
  const isJpeg = () => el.format.value === "jpeg";

  el.format.addEventListener("change", () => { el.qualityRow.hidden = !isJpeg(); });

  async function loadFile(file) {
    const g = ++gen;
    setSaveStatus(""); el.area.hidden = true; el.save.disabled = true; closeDoc(); setStatus("読み込み中…");
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const d = await pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise;
      if (g !== gen) { Promise.resolve(d.destroy()).catch(() => {}); return; }
      doc = d; baseName = file.name.replace(/\.pdf$/i, "") || "pdf";
      el.filename.hidden = false; el.filename.textContent = `${file.name}（${d.numPages}ページ）`;
      el.info.textContent = `${d.numPages}ページ分を、1ページ1枚の画像にします。`;
      el.area.hidden = false; el.reset.hidden = false; el.save.disabled = false;
      setStatus("形式と解像度を選んで「画像にして保存」を押してください。");
    } catch (e) {
      if (g !== gen) return;
      closeDoc(); el.reset.hidden = true; el.filename.hidden = true;
      setStatus(/password/i.test(String(e && (e.name + e.message))) ? "パスワード保護されたPDFには対応していません。" : "PDFを読み込めませんでした。", true);
    }
  }
  el.file.addEventListener("change", () => { if (el.file.files[0]) loadFile(el.file.files[0]); el.file.value = ""; });
  wireDrop($("im-drop"), (fs) => loadFile(fs[0]));

  el.reset.addEventListener("click", () => {
    if (busy) return;
    gen++; closeDoc();
    el.area.hidden = true; el.filename.hidden = true; el.reset.hidden = true; el.save.disabled = true;
    setSaveStatus(""); setStatus("PDFを選ぶと、画像に変換できます。");
  });

  el.save.addEventListener("click", async () => {
    if (!doc || busy) return;
    const d = doc, g = gen, jpeg = isJpeg(), scale = +el.scale.value, q = (+el.quality.value || 90) / 100;
    const ext = jpeg ? "jpg" : "png", type = jpeg ? "image/jpeg" : "image/png", n = d.numPages;
    const dir = await pickSaveFolder();   // 保存先フォルダを1回だけ選ぶ（未対応ならnull＝通常のダウンロード）
    if (dir === false) { setSaveStatus("保存をキャンセルしました。"); return; }
    busy = true; el.save.disabled = true; el.reset.disabled = true; setSaveStatus("");
    try {
      const pad = String(n).length;
      for (let i = 1; i <= n; i++) {
        if (g !== gen) return;
        setSaveStatus(`変換して保存中…（${i}/${n}）`);
        const page = await d.getPage(i);
        const v1 = page.getViewport({ scale: 1 });
        const s = Math.min(scale * 96 / 72, MAX_SIDE / Math.max(v1.width, v1.height));   // scale=1 → 96dpi相当
        const vp = page.getViewport({ scale: s });
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.floor(vp.width)); c.height = Math.max(1, Math.floor(vp.height));
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);   // JPEGは透明を持てないので、白い下地を敷く
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        page.cleanup();
        const blob = await toBlob(c, type, jpeg ? q : undefined);
        c.width = c.height = 0;
        await saveBlob(blob, `${baseName}_${String(i).padStart(pad, "0")}.${ext}`, dir);
        if (!dir && i < n) await new Promise((r) => setTimeout(r, 350));   // 連続ダウンロードがブロックされにくいよう間隔を空ける
      }
      setSaveStatus(`${n}ページを画像にして保存しました。${dir ? "" : "（ダウンロードが複数回始まります）"}`);
    } catch (e) {
      setSaveStatus("変換に失敗しました: " + (e && e.message || e), true);
    } finally { busy = false; el.reset.disabled = false; el.save.disabled = !doc; }
  });
})();
