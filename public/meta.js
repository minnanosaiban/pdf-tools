"use strict";

// メタデータ編集削除（旧 pdf-metadata）。
(() => {
  const { PDFDocument } = PDFLib;

  const fileInput = $("md-file"), folderInput = $("md-folderInput");
  const filenameEl = $("md-filename"), statusEl = $("md-status");
  const editArea = $("md-editArea"), folderArea = $("md-folderArea");
  const fSubject = $("md-fSubject"), fKeywords = $("md-fKeywords"), resetCreation = $("md-resetCreation");
  const fTitle = $("md-fTitle"), fAuthor = $("md-fAuthor"), fCreator = $("md-fCreator"), fProducer = $("md-fProducer");
  const saveBtn = $("md-save"), saveStatus = $("md-saveStatus");
  const folderBody = $("md-folderBody"), folderSaveAll = $("md-folderSaveAll"), folderSaveAllStatus = $("md-folderSaveAllStatus");

  let pdfDoc = null, baseName = "pdf", folderRows = [], orig = {};   // orig: 読み込み時のサブジェクト・キーワード（変更時のみ書き戻す）

  function setMode(mode) { editArea.hidden = mode !== "single"; folderArea.hidden = mode !== "folder"; }
  function setStatus(t, err) { statusEl.textContent = t || ""; statusEl.classList.toggle("is-error", !!err); }
  function setSaveStatus(t, err) { saveStatus.textContent = t || ""; saveStatus.classList.toggle("is-error-text", !!err); }
  function formatDate(d) { try { return d ? d.toLocaleString("ja-JP") : "—"; } catch { return "—"; } }

  async function loadFile(file) {
    setMode("empty"); setStatus("読み込み中…");
    try {
      // updateMetadata:false が必須。既定だと読み込んだ瞬間にProducer・更新日を上書きしてしまう。
      pdfDoc = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()), { updateMetadata: false });
    } catch (e) {
      pdfDoc = null;
      setStatus(/encrypt/i.test(String(e && e.message || e))
        ? "パスワード保護されたPDFには対応していません。"
        : "PDFを読み込めませんでした。ファイルが壊れているか、対応していない形式の可能性があります。", true);
      return;
    }
    baseName = file.name.replace(/\.pdf$/i, "") || "pdf";
    filenameEl.hidden = false; filenameEl.textContent = file.name;
    fTitle.value = pdfDoc.getTitle() || ""; fAuthor.value = pdfDoc.getAuthor() || "";
    fCreator.value = pdfDoc.getCreator() || ""; fProducer.value = pdfDoc.getProducer() || "";
    orig = { subject: pdfDoc.getSubject() || "", keywords: pdfDoc.getKeywords() || "" };
    fSubject.value = orig.subject; fKeywords.value = orig.keywords; resetCreation.checked = false;
    $("md-iCreationDate").textContent = formatDate(pdfDoc.getCreationDate());
    $("md-iModDate").textContent = formatDate(pdfDoc.getModificationDate());
    setSaveStatus(""); setStatus(`「${file.name}」を編集しています。`); setMode("single");
  }

  fileInput.addEventListener("change", () => { if (fileInput.files[0]) loadFile(fileInput.files[0]); fileInput.value = ""; });
  wireDrop($("md-drop"), (fs) => loadFile(fs[0]));

  $("md-clearAll").addEventListener("click", () => { fTitle.value = fAuthor.value = fCreator.value = fProducer.value = fSubject.value = fKeywords.value = ""; });

  saveBtn.addEventListener("click", async () => {
    if (!pdfDoc) return;
    saveBtn.disabled = true; setSaveStatus("保存中…");
    try {
      pdfDoc.setTitle(fTitle.value.trim()); pdfDoc.setAuthor(fAuthor.value.trim());
      pdfDoc.setCreator(fCreator.value.trim()); pdfDoc.setProducer(fProducer.value.trim());
      // サブジェクト・キーワードは、変更した時だけ書き戻す（キーワードは再区切りで表記が変わりうるため）
      if (fSubject.value.trim() !== orig.subject.trim()) pdfDoc.setSubject(fSubject.value.trim());
      if (fKeywords.value.trim() !== orig.keywords.trim()) pdfDoc.setKeywords(fKeywords.value.split(/[\s,、]+/).filter(Boolean));
      if (resetCreation.checked) pdfDoc.setCreationDate(new Date());
      pdfDoc.setModificationDate(new Date());
      triggerDownload(new Blob([await pdfDoc.save()], { type: "application/pdf" }), `${baseName}_meta.pdf`);
      setSaveStatus("保存しました（ダウンロードを開始しました）");
    } catch (e) { setSaveStatus("保存に失敗しました: " + (e && e.message || e), true); }
    finally { saveBtn.disabled = false; }
  });

  // ---- フォルダ一覧 ----
  $("md-pickFolder").addEventListener("click", () => folderInput.click());
  folderInput.addEventListener("change", async () => {
    const files = Array.from(folderInput.files)
      .filter((f) => /\.pdf$/i.test(f.name))
      .filter((f) => (f.webkitRelativePath || f.name).split("/").length === 2)   // フォルダ直下のみ
      .sort((a, b) => a.name.localeCompare(b.name, "ja"));
    folderInput.value = "";
    if (!files.length) { setMode("empty"); setStatus("選んだフォルダの直下にPDFが見つかりませんでした（サブフォルダの中は対象外です）。", true); return; }
    renderTable(files); setMode("folder"); folderSaveAllStatus.textContent = "";
    setStatus(`${files.length}件のPDFが見つかりました。読み込み中…`);
    for (let i = 0; i < files.length; i++) {
      await loadRow(files[i], i);
      setStatus(i + 1 < files.length
        ? `${files.length}件のPDFが見つかりました。読み込み中…（${i + 1}/${files.length}）`
        : `${files.length}件のPDFが見つかりました。タイトル・作成者を直接書き換えて「保存」で1件ずつ、または「まとめて保存してダウンロード」で一括保存できます。`);
    }
  });

  function mkInput() {
    const i = document.createElement("input");
    i.type = "text"; i.className = "text-input"; i.placeholder = "読み込み中…"; i.disabled = true;
    return i;
  }
  function renderTable(files) {
    folderBody.innerHTML = "";
    folderRows = files.map((file) => ({ file, doc: null }));
    files.forEach((file, i) => {
      const tr = document.createElement("tr");
      const tdName = document.createElement("td"); tdName.className = "col-name";
      const nm = document.createElement("div"); nm.className = "row-name"; nm.textContent = file.name; tdName.appendChild(nm);
      const tdT = document.createElement("td"); tdT.className = "col-field"; const ti = mkInput(); tdT.appendChild(ti);
      const tdA = document.createElement("td"); tdA.className = "col-field"; const ai = mkInput(); tdA.appendChild(ai);
      const tdS = document.createElement("td"); tdS.className = "col-action";
      const sb = document.createElement("button"); sb.type = "button"; sb.className = "row-save-btn"; sb.textContent = "保存"; sb.disabled = true;
      const st = document.createElement("span"); st.className = "row-status";
      tdS.append(sb, st);
      tr.append(tdName, tdT, tdA, tdS); folderBody.appendChild(tr);
      const row = folderRows[i];
      Object.assign(row, { rowEl: tr, titleInput: ti, authorInput: ai, saveBtn: sb, statusEl: st });
      sb.addEventListener("click", () => saveRow(row));
    });
  }
  async function loadRow(file, i) {
    const row = folderRows[i];
    try {
      const doc = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()), { updateMetadata: false });
      row.doc = doc;
      row.titleInput.value = doc.getTitle() || ""; row.authorInput.value = doc.getAuthor() || "";
      row.titleInput.placeholder = row.authorInput.placeholder = "（未設定）";
      row.titleInput.disabled = row.authorInput.disabled = row.saveBtn.disabled = false;
    } catch (e) {
      row.rowEl.classList.add("is-error");
      const err = document.createElement("span"); err.className = "row-error-text";
      err.textContent = /encrypt/i.test(String(e && e.message || e)) ? "パスワード保護されています" : "読み込めませんでした";
      row.titleInput.replaceWith(err); row.authorInput.remove(); row.saveBtn.remove();
    }
  }
  async function saveRow(row) {
    if (!row.doc) return;
    row.saveBtn.disabled = true; row.statusEl.textContent = "保存中…"; row.statusEl.classList.remove("is-error-text");
    try {
      row.doc.setTitle(row.titleInput.value.trim()); row.doc.setAuthor(row.authorInput.value.trim());
      row.doc.setModificationDate(new Date());
      triggerDownload(new Blob([await row.doc.save()], { type: "application/pdf" }), `${row.file.name.replace(/\.pdf$/i, "") || "pdf"}_meta.pdf`);
      row.statusEl.textContent = "保存しました";
    } catch { row.statusEl.textContent = "保存に失敗しました"; row.statusEl.classList.add("is-error-text"); }
    finally { row.saveBtn.disabled = false; }
  }
  $("md-folderClearAll").addEventListener("click", () => {
    for (const r of folderRows) if (r.doc) { r.titleInput.value = ""; r.authorInput.value = ""; }
  });
  folderSaveAll.addEventListener("click", async () => {
    const targets = folderRows.filter((r) => r.doc);
    if (!targets.length) return;
    folderSaveAll.disabled = true;
    for (let i = 0; i < targets.length; i++) {
      folderSaveAllStatus.textContent = `まとめて保存中…（${i + 1}/${targets.length}）`;
      await saveRow(targets[i]);
      await new Promise((r) => setTimeout(r, 250));
    }
    folderSaveAllStatus.textContent = `${targets.length}件を保存しました`;
    folderSaveAll.disabled = false;
  });
})();
