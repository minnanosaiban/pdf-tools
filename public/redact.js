"use strict";

// 墨消し・検索（旧 pdf-redactor）。各ページを画像化して黒塗りを焼き込み、新規PDFを生成する。
(() => {
  const { PDFDocument } = PDFLib;

  let pdf = null, numPages = 0, searchable = false;
  const rectsByPage = {};      // { ページ番号: [{x,y,w,h} すべて 0..1 の正規化座標] }
  const history = [];          // 枠を追加した順のページ番号（「元に戻す」用）
  let applying = false;
  let outputBlob = null;

  const statusEl = $("rd-status"), applyStatusEl = $("rd-applyStatus"), countEl = $("rd-count");
  const dlBtn = $("rd-download"), dpiSel = $("rd-dpi"), qInput = $("rd-q"), ptype = $("rd-ptype");
  const setStatus = (m) => { statusEl.textContent = m || ""; };
  const setApplyStatus = (m) => { applyStatusEl.textContent = m || ""; };
  const rectsOf = (p) => rectsByPage[p] || (rectsByPage[p] = []);
  const totalBoxes = () => Object.values(rectsByPage).reduce((n, a) => n + a.length, 0);
  const updateCount = () => { countEl.textContent = `枠: ${totalBoxes()}`; };
  // 枠を変えたら、すでに生成済みの出力は古くなる（新しい枠が入っていない）ので破棄する。
  // editVersion は「適用中に枠が編集された」ことを検出するための世代番号。
  let editVersion = 0;
  function invalidateOutput() {
    editVersion++;
    if (outputBlob) setApplyStatus("枠を変更したため、先ほどの出力は無効です。もう一度「墨消し適用」を押してください。");
    outputBlob = null; dlBtn.disabled = true;
  }

  const viewer = new PageViewer($("rd-pages"), {
    scale: 1.5,
    onRendered: (p) => drawOverlay(p),
    decorate: (p, d) => {
      d.preview = null; d.redacted = false; d.hoverIndex = -1;
      const clr = document.createElement("button");
      clr.type = "button"; clr.className = "mini"; clr.textContent = "このページの枠を消去";
      clr.onclick = () => {
        rectsByPage[p] = [];
        for (let i = history.length - 1; i >= 0; i--) if (history[i] === p) history.splice(i, 1);
        d.redacted = false; drawOverlay(p); updateCount(); invalidateOutput();
      };
      d.head.appendChild(clr);
      attachDraw(p, d);
    },
  });
  const dom = viewer.dom;
  blockStrayDrop($("rd-pages"));

  $("rd-file").onchange = (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ""; };
  wireDrop($("rd-drop"), (fs) => loadFile(fs[0]));

  $("rd-undo").onclick = () => {
    const p = history.pop();
    if (p == null) return;
    rectsOf(p).pop();
    if (dom[p]) dom[p].redacted = false;
    drawOverlay(p); updateCount(); invalidateOutput();
  };
  $("rd-clear").onclick = () => {
    for (const k of Object.keys(rectsByPage)) rectsByPage[k] = [];
    history.length = 0;
    for (const k of Object.keys(dom)) { dom[k].redacted = false; drawOverlay(+k); }
    updateCount(); invalidateOutput();
  };
  $("rd-search").onclick = () => searchAndAdd(qInput.value);
  qInput.addEventListener("keydown", (e) => { if (e.key === "Enter") searchAndAdd(qInput.value); });

  async function loadFile(file) {
    outputBlob = null; dlBtn.disabled = true; setApplyStatus("");
    for (const k of Object.keys(rectsByPage)) delete rectsByPage[k];
    history.length = 0; updateCount();
    setSearchUI(false, "判定中…");
    try {
      const buf = await file.arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
      pdf = doc; numPages = doc.numPages;
      await viewer.load(doc);
      if (pdf !== doc) return;   // 読み込み中に別のファイルが選ばれた
      searchable = await detectSearchable();
      setSearchUI(searchable);
      const mode = searchable
        ? "文字入りPDFです。上の検索で文字を指定して墨消し、または各ページをドラッグで墨消しできます。"
        : "スキャンPDF（文字なし）です。文字検索は使えません。各ページをドラッグで墨消ししてください。";
      setStatus(`${file.name}（${numPages}ページ）を読み込みました。${mode} 枠はクリックで削除。`);
    } catch (e) {
      pdf = null; viewer.reset();   // 古いページ表示を残さない
      setSearchUI(false, "—");
      setStatus(/password|encrypt/i.test(String(e && e.message || e)) ? "パスワード保護されたPDFには対応していません。" : "PDFを読み込めませんでした。");
    }
  }

  async function detectSearchable() {
    let chars = 0;
    const lim = Math.min(numPages, 5);
    for (let p = 1; p <= lim; p++) {
      const tc = await (await pdf.getPage(p)).getTextContent();
      for (const it of tc.items) chars += (it.str || "").trim().length;
      if (chars >= 30) break;
    }
    return chars >= 30;
  }

  function setSearchUI(on, label) {
    qInput.disabled = !on;
    $("rd-search").disabled = !on;
    ptype.textContent = label || (on ? "文字あり（検索可）" : "スキャン（文字なし）");
    ptype.className = "badge " + (label ? "" : (on ? "ok" : "warn"));
  }

  function drawOverlay(p) {
    const d = dom[p];
    if (!d || !d.rendered) return;
    const o = d.overlay, ctx = o.getContext("2d"), W = o.width, H = o.height;
    ctx.clearRect(0, 0, W, H);
    const draw = (r, fill, stroke) => {
      ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = 2;
      ctx.fillRect(r.x * W, r.y * H, r.w * W, r.h * H);
      ctx.strokeRect(r.x * W, r.y * H, r.w * W, r.h * H);
    };
    const [fill, stroke] = d.redacted ? ["rgba(0,0,0,0.95)", "rgba(0,0,0,1)"] : ["rgba(220,0,0,0.35)", "rgba(220,0,0,0.9)"];
    rectsOf(p).forEach((r, i) => {
      draw(r, fill, stroke);
      if (i === d.hoverIndex) drawDeleteHint(ctx, r, W, H);
    });
    if (d.preview) draw(d.preview, "rgba(0,0,0,0.25)", "rgba(0,0,0,0.7)");
  }

  function drawDeleteHint(ctx, r, W, H) {
    const rad = 9;
    const cx = Math.min(Math.max((r.x + r.w) * W, rad), W - rad);
    const cy = Math.min(Math.max(r.y * H, rad), H - rad);
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fillStyle = "#fff"; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(0,0,0,.25)"; ctx.stroke();
    const k = rad * 0.45;
    ctx.beginPath();
    ctx.moveTo(cx - k, cy - k); ctx.lineTo(cx + k, cy + k);
    ctx.moveTo(cx + k, cy - k); ctx.lineTo(cx - k, cy + k);
    ctx.strokeStyle = "#31333f"; ctx.lineWidth = 2; ctx.stroke();
  }

  // 赤枠→黒塗りへ短いアニメーションで遷移（「墨消し適用」の視覚フィードバック）
  function markRedacted(p) {
    const d = dom[p];
    if (!d) return;
    d.redacted = true;
    if (!d.rendered || !rectsOf(p).length) return;
    const rects = rectsOf(p), DURATION = 260, t0 = performance.now();
    const step = (now) => {
      if (!d.rendered) return;
      const t = Math.min(1, (now - t0) / DURATION);
      const c = Math.round(220 * (1 - t)), alpha = 0.35 + 0.6 * t;
      const o = d.overlay, ctx = o.getContext("2d"), W = o.width, H = o.height;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = `rgba(${c},0,0,${alpha})`; ctx.strokeStyle = `rgba(${c},0,0,1)`; ctx.lineWidth = 2;
      for (const r of rects) { ctx.fillRect(r.x * W, r.y * H, r.w * W, r.h * H); ctx.strokeRect(r.x * W, r.y * H, r.w * W, r.h * H); }
      if (t < 1) requestAnimationFrame(step); else drawOverlay(p);
    };
    requestAnimationFrame(step);
  }

  // ---- 文字検索して墨消し枠を自動追加（サーチャブルPDFのみ） ----
  // pdf.jsは1行を複数のテキスト断片に分けることがある。断片ごとに探すと断片をまたぐ語を見落とすので、
  // ページ内の全断片を1本の文字列に連結して探し、ヒット範囲を断片ごとの枠に分けて返す。
  // 照合は全角/半角・大文字/小文字・空白の違いを無視する（NFKC正規化＋空白除去）。
  const fold = (ch) => ch.normalize("NFKC").toLowerCase().replace(/\s+/g, "");

  async function searchAndAdd(term) {
    term = (term || "").trim();
    if (!term) return;
    if (!searchable) { setStatus("このPDFは文字が埋め込まれていないため検索できません。ドラッグで囲ってください。"); return; }
    const needle = Array.from(term).map(fold).join("");
    if (!needle) return;
    let added = 0;
    for (let p = 1; p <= numPages; p++) {
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const items = (await page.getTextContent()).items.filter((it) => typeof it.str === "string" && it.str);
      let hay = "";
      const owner = [], pos = [];   // hay の各文字が、どの断片(owner)の何文字目(pos)に由来するか
      items.forEach((it, ii) => {
        for (let ci = 0; ci < it.str.length; ci++) {
          for (const f of fold(it.str[ci])) { hay += f; owner.push(ii); pos.push(ci); }
        }
      });
      let idx = hay.indexOf(needle);
      while (idx !== -1) {
        const spans = new Map();   // 断片 → ヒット範囲 [start, end)
        for (let k = idx; k < idx + needle.length; k++) {
          const sp = spans.get(owner[k]);
          if (sp) { sp[0] = Math.min(sp[0], pos[k]); sp[1] = Math.max(sp[1], pos[k] + 1); }
          else spans.set(owner[k], [pos[k], pos[k] + 1]);
        }
        for (const [ii, [a, b]] of spans) {
          const box = itemRect(items[ii], a, b, vp);
          if (box) { rectsOf(p).push(box); history.push(p); added++; }
        }
        idx = hay.indexOf(needle, idx + 1);
      }
      if (dom[p]) dom[p].redacted = false;
      drawOverlay(p);
    }
    updateCount();
    if (added) invalidateOutput();
    setStatus(added
      ? `「${term}」に ${added} 箇所の墨消し枠を追加しました。自動検索は取りこぼし・位置ずれがありえます。全ページを目視で確認し、不足は手動で囲み、不要な枠はクリックで削除してください。`
      : `「${term}」は見つかりませんでした。文字が画像化されている箇所などは検索できないため、目視で確認してください。`);
  }

  // 断片内の文字位置は等幅では決められないので、全角(CJK等)=1・それ以外=0.55 の重みで按分する
  const charW = (ch) => (ch.charCodeAt(0) >= 0x2E80 ? 1 : 0.55);

  function itemRect(it, start, end, vp) {
    const tx = pdfjsLib.Util.transform(vp.transform, it.transform);
    const fh = Math.hypot(tx[2], tx[3]);
    const width = it.width;
    if (!width || !fh) return null;
    let before = 0, inside = 0, total = 0;
    for (let i = 0; i < it.str.length; i++) {
      const w = charW(it.str[i]);
      total += w;
      if (i < start) before += w; else if (i < end) inside += w;
    }
    if (!total) return null;
    const left = tx[4] + width * (before / total), right = left + width * (inside / total);
    const top = tx[5] - fh;
    const padX = fh * 0.12, padY = fh * 0.18;
    const x = clamp01((Math.min(left, right) - padX) / vp.width);
    const y = clamp01((top - padY) / vp.height);
    const w = Math.min(1 - x, (Math.abs(right - left) + 2 * padX) / vp.width);
    const h = Math.min(1 - y, (fh + 2 * padY) / vp.height);
    return { x, y, w, h };
  }

  function hitIndex(arr, q) {
    for (let i = arr.length - 1; i >= 0; i--) {
      const r = arr[i];
      if (q.x >= r.x && q.x <= r.x + r.w && q.y >= r.y && q.y <= r.y + r.h) return i;
    }
    return -1;
  }

  // ---- 各ページの描画操作（ドラッグ追加 / クリック削除） ----
  function attachDraw(p, d) {
    const o = d.overlay;
    const norm = (e) => {
      const r = o.getBoundingClientRect();
      return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
    };
    const rf = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
    let start = null, moved = false;

    o.addEventListener("pointerdown", (e) => {
      if (!d.rendered) return;
      o.setPointerCapture(e.pointerId);
      start = norm(e); moved = false;
    });
    o.addEventListener("pointermove", (e) => {
      const q = norm(e);
      if (start) {
        if (Math.abs(q.x - start.x) > 0.004 || Math.abs(q.y - start.y) > 0.004) moved = true;
        d.preview = rf(start, q); drawOverlay(p);
        return;
      }
      const hit = hitIndex(rectsOf(p), q);
      o.style.cursor = hit === -1 ? "crosshair" : "pointer";
      if (hit !== d.hoverIndex) { d.hoverIndex = hit; drawOverlay(p); }
    });
    o.addEventListener("pointerleave", () => {
      o.style.cursor = "crosshair";
      if (d.hoverIndex !== -1) { d.hoverIndex = -1; drawOverlay(p); }
    });
    o.addEventListener("pointerup", (e) => {
      if (!start) return;
      const q = norm(e);
      let changed = false;
      if (moved) {
        const r = rf(start, q);
        if (r.w > 0.005 && r.h > 0.005) { rectsOf(p).push(r); history.push(p); changed = true; }
      } else {
        const arr = rectsOf(p), idx = hitIndex(arr, q);
        if (idx !== -1) {
          arr.splice(idx, 1); changed = true;
          for (let j = history.length - 1; j >= 0; j--) if (history[j] === p) { history.splice(j, 1); break; }
        }
      }
      start = null; moved = false; d.preview = null; d.redacted = false; d.hoverIndex = -1; drawOverlay(p); updateCount();
      if (changed) invalidateOutput();
    });
  }

  // ---- 墨消し適用（各ページをラスタライズ＋黒塗りして新規PDFを生成） ----
  $("rd-apply").onclick = async () => {
    if (!pdf) { setApplyStatus("先にPDFを選んでください。"); return; }
    if (applying) return;
    const total = totalBoxes();
    const dpi = parseInt(dpiSel.value, 10), scale = dpi / 72;
    dlBtn.disabled = true; outputBlob = null; applying = true;
    const versionAtStart = editVersion;
    viewer.pause();
    setApplyStatus(`墨消しを適用中…（${total}枠 / ${dpi}dpi）`);
    try {
      const out = await PDFDocument.create();
      for (let p = 1; p <= numPages; p++) {
        const page = await pdf.getPage(p);
        const vp = page.getViewport({ scale });
        const c = document.createElement("canvas");
        c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
        const cx = c.getContext("2d");
        await page.render({ canvasContext: cx, viewport: vp }).promise;
        cx.fillStyle = "#000";   // 黒塗りをピクセルに焼き込む（下地は出力に残らない）
        for (const r of (rectsByPage[p] || [])) cx.fillRect(r.x * c.width, r.y * c.height, r.w * c.width, r.h * c.height);
        const blob = await new Promise((res) => c.toBlob(res, "image/png"));
        const img = await out.embedPng(new Uint8Array(await blob.arrayBuffer()));
        const vp1 = page.getViewport({ scale: 1 });
        out.addPage([vp1.width, vp1.height]).drawImage(img, { x: 0, y: 0, width: vp1.width, height: vp1.height });
        markRedacted(p);
        setApplyStatus(`墨消し中… ${p}/${numPages}`);
      }
      out.setTitle(""); out.setAuthor(""); out.setSubject(""); out.setKeywords([]);
      out.setProducer("pdf-tools"); out.setCreator("pdf-tools");
      if (editVersion !== versionAtStart) {   // 適用中に枠が編集された＝出力に反映されていない
        setApplyStatus("適用中に枠が変更されたため、出力を破棄しました。もう一度「墨消し適用」を押してください。");
        return;
      }
      outputBlob = new Blob([await out.save()], { type: "application/pdf" });
      dlBtn.disabled = false;
      setApplyStatus(`完了：${numPages}ページをラスタライズし ${total}箇所を黒塗りしました。下地の画素・文字は出力に含まれません（出力は画像PDF＝文字検索不可）。DL後、PDFを開いて墨消し漏れがないか目視確認してください。`);
    } catch (e) {
      setApplyStatus("墨消しに失敗しました: " + (e && e.message || e));
    } finally {
      applying = false;
      viewer.resume();
    }
  };

  // ダウンロードはユーザー操作に同期して即開始する（書き出しは適用時に済ませてある）
  dlBtn.onclick = () => { if (outputBlob) triggerDownload(outputBlob, "redacted.pdf"); };
})();
