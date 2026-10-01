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
    jitter: $("hw-jitter"), angle: $("hw-angle"), kind: $("hw-kind"), lw: $("hw-lw"),
    er: $("hw-er"), erUndo: $("hw-erUndo"),
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

  // ---- 四角・マル（手書き風の揺れた線） ----
  // 滑らかなゆらぎ：位相の違うsinを重ねる（隣り合う点が連続して動くので、ペンの手ぶれっぽくなる）
  function wobbler(r, amp) {
    const f1 = 1.5 + r() * 2, f2 = 4 + r() * 3, p1 = r() * 6.28, p2 = r() * 6.28;
    return (t) => amp * (0.7 * Math.sin(f1 * t + p1) + 0.3 * Math.sin(f2 * t + p2));
  }

  function shapePath(it, W, H, s) {
    const j = it.jitter / 100, r = rng(it.seed);
    const x = it.x * W, y = it.y * H, w = it.w * W, h = it.h * H;
    const amp = Math.max(0.3, Math.min(w, h) * 0.02 * j + it.lw * s * 0.5 * j);
    const pts = [];
    if (it.type === "ellipse") {
      const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2;
      const a0 = r() * 6.28, turns = 1.06 + r() * 0.06;      // 始点と終点をずらし、閉じきらず少し重ねる
      const wob = wobbler(r, amp), drift = (r() - 0.5) * amp * 3;
      const n = Math.max(40, Math.round((rx + ry) / 2));
      for (let i = 0; i <= n; i++) {
        const t = i / n, a = a0 + t * turns * 6.28318;
        const k = 1 + (wob(a) + drift * t) / Math.max(rx, ry, 1);
        pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
      }
    } else {
      const jc = () => (r() - 0.5) * Math.min(w, h) * 0.06 * j;   // 角のずれ
      const c = [[x + jc(), y + jc()], [x + w + jc(), y + jc()], [x + w + jc(), y + h + jc()], [x + jc(), y + h + jc()]];
      const ov = 0.05 + r() * 0.05;                               // 最後の辺は少しはみ出して重ねる
      const loop = [c[0], c[1], c[2], c[3], c[0]];
      const tail = [c[0][0] + (c[1][0] - c[0][0]) * ov, c[0][1] + (c[1][1] - c[0][1]) * ov];
      loop.push(tail);
      for (let e = 0; e < loop.length - 1; e++) {
        const [ax, ay] = loop[e], [bx, by] = loop[e + 1];
        const len = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / len, ny = (bx - ax) / len;
        const wob = wobbler(r, amp), n = Math.max(6, Math.round(len / 6));
        for (let i = (e === 0 ? 0 : 1); i <= n; i++) {
          const t = i / n, o = wob(t * 3);
          pts.push([ax + (bx - ax) * t + nx * o, ay + (by - ay) * t + ny * o]);
        }
      }
    }
    return pts;
  }

  function drawShape(ctx, it, W, H, s) {
    const pts = shapePath(it, W, H, s);
    ctx.save();
    ctx.strokeStyle = it.color; ctx.lineCap = "round"; ctx.lineJoin = "round";
    // ペンを2度なぞったような、わずかに太さの違う線を重ねる
    for (const [wm, al] of [[1, 0.95], [0.55, 0.5]]) {
      ctx.lineWidth = it.lw * s * wm; ctx.globalAlpha = al;
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(px + (wm < 1 ? 0.6 * s : 0), py) : ctx.moveTo(px + (wm < 1 ? 0.6 * s : 0), py)));
      ctx.stroke();
    }
    ctx.restore();
    return { w: it.w * W, h: it.h * H };
  }

  // 消しゴムで消した軌跡（it.erase）がある要素は、いったん別canvasに描いて軌跡ぶんを抜いてから重ねる。
  // 軌跡は要素の左上を原点とするpt座標（文字は傾きも含めた要素内の座標）で持つので、要素を動かしても付いてくる。
  let scratch = null;
  function drawItem(ctx, it, W, H, s) {
    if (!it.erase || !it.erase.length) return drawRaw(ctx, it, W, H, s);
    if (!scratch) scratch = document.createElement("canvas");
    if (scratch.width !== W || scratch.height !== H) { scratch.width = W; scratch.height = H; }
    const t = scratch.getContext("2d");
    t.clearRect(0, 0, W, H);
    const m = drawRaw(t, it, W, H, s);
    t.save();
    t.translate(it.x * W, it.y * H);
    if (!isShape(it)) t.rotate(it.angle * Math.PI / 180);
    t.scale(s, s);
    t.globalCompositeOperation = "destination-out";
    t.lineCap = "round"; t.lineJoin = "round"; t.strokeStyle = t.fillStyle = "#000";
    for (const st of it.erase) {
      t.lineWidth = st.r * 2;
      t.beginPath();
      st.pts.forEach(([px, py], i) => (i ? t.lineTo(px, py) : t.moveTo(px, py)));
      if (st.pts.length === 1) t.lineTo(st.pts[0][0] + 0.01, st.pts[0][1]);   // 1点だけでも丸く消える
      t.stroke();
    }
    t.restore();
    ctx.drawImage(scratch, 0, 0);
    return m;
  }

  function drawRaw(ctx, it, W, H, s) {
    if (it.type === "rect" || it.type === "ellipse") return drawShape(ctx, it, W, H, s);
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
        ctx.translate(it.x * W, it.y * H);
        if (!isShape(it)) ctx.rotate(it.angle * Math.PI / 180);
        ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(30,33,38,.75)";
        ctx.strokeRect(-4, -4, m.w + 8, m.h + 8);
        ctx.restore();
      }
    }
    if (d.eraserPos && el.kind.value === "eraser") {   // 消しゴムの範囲を示す丸
      ctx.save();
      ctx.beginPath(); ctx.arc(d.eraserPos.x * W, d.eraserPos.y * H, +el.er.value * s, 0, Math.PI * 2);
      ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(30,33,38,.8)"; ctx.fillStyle = "rgba(255,255,255,.35)";
      ctx.fill(); ctx.stroke(); ctx.restore();
    }
  }
  const redrawAll = () => { for (const k of Object.keys(viewer.dom)) redraw(+k); };

  function ensureFont(it) {
    if (!document.fonts || !document.fonts.load) return;
    document.fonts.load(fontStr(it, 1).replace(/^[\d.]+px/, "24px"), it.text || "あ").then(redrawAll).catch(() => {});
  }

  // ---- 選択・コントロール同期 ----
  const byId = (id) => items.find((i) => i.id === id);
  const isShape = (it) => it.type === "rect" || it.type === "ellipse";
  let batchSeq = 0;
  const eraseHistory = [];   // { it, stroke }（消しゴムを1回なぞるごとに要素ごとの軌跡を積む）
  el.erUndo.onclick = () => {
    // 同じ1回のドラッグで複数要素に付いた軌跡は、まとめて戻す（末尾から、同じ操作の分だけ）
    const last = eraseHistory.pop();
    if (!last) return;
    const rm = (h) => { if (h.it.erase) h.it.erase = h.it.erase.filter((s) => s !== h.stroke); };
    rm(last);
    while (eraseHistory.length && eraseHistory[eraseHistory.length - 1].batch === last.batch && last.batch != null) rm(eraseHistory.pop());
    updateChrome(); redrawAll();
  };
  function updateChrome() {
    el.erUndo.disabled = eraseHistory.length === 0;
    el.count.textContent = `要素: ${items.length}`;
    el.del.disabled = selectedId == null;
    el.save.disabled = !pdf || items.length === 0;
  }
  function select(id) {
    selectedId = id;
    const it = byId(id);
    if (it) {
      el.kind.value = it.type; syncKind(); el.color.value = it.color; el.jitter.value = it.jitter;
      if (isShape(it)) el.lw.value = it.lw;
      else { el.text.value = it.text; el.font.value = it.font; el.size.value = it.size; el.angle.value = it.angle; }
    }
    updateChrome(); redrawAll();
  }
  function applyControls() {
    const it = byId(selectedId);
    if (!it) return;
    it.color = el.color.value; it.jitter = +el.jitter.value;
    if (isShape(it)) { it.lw = +el.lw.value; redrawAll(); return; }
    it.text = el.text.value; it.font = el.font.value;
    it.size = +el.size.value; it.angle = +el.angle.value;
    if (!it.text.trim()) { items = items.filter((i) => i !== it); selectedId = null; updateChrome(); }
    ensureFont(it); redrawAll();
  }
  for (const k of ["text", "font", "color", "size", "jitter", "angle", "lw"]) {
    el[k].addEventListener("input", applyControls);
  }
  // 「配置するもの」に応じて、関係する設定だけを表示する
  function syncKind() {
    const k = el.kind.value;
    const on = { text: k === "text", shape: k === "rect" || k === "ellipse", eraser: k === "eraser", draw: k !== "eraser" };
    for (const g of Object.keys(on)) {
      document.querySelectorAll(`#panel-hand [data-for-${g}]`).forEach((n) => { n.hidden = !on[g]; });
    }
    Object.values(viewer.dom).forEach((d) => { d.eraserPos = null; });
    redrawAll();
  }
  el.kind.addEventListener("change", () => {
    syncKind();
    const it = byId(selectedId);
    if (it && (el.kind.value === "eraser" || it.type !== el.kind.value && (isShape(it) !== (el.kind.value !== "text")))) select(null);   // 種類を変えたら選択は外す
  });
  syncKind();
  el.del.onclick = () => { items = items.filter((i) => i.id !== selectedId); selectedId = null; updateChrome(); redrawAll(); };
  el.clear.onclick = () => { items = []; eraseHistory.length = 0; selectedId = null; updateChrome(); redrawAll(); };
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
        if (isShape(it)) {   // 四角・マルは内側ではなく「線の近く」だけを当たり判定にする（中に文字を置けるように）
          const dx = q.x * W - it.x * W, dy = q.y * H - it.y * H, w = it.w * W, h = it.h * H, tol = 10;
          if (it.type === "rect") {
            const inOuter = dx >= -tol && dx <= w + tol && dy >= -tol && dy <= h + tol;
            const inInner = dx > tol && dx < w - tol && dy > tol && dy < h - tol;
            if (inOuter && !inInner) return it;
          } else {
            const nx = (dx - w / 2) / (w / 2 || 1), ny = (dy - h / 2) / (h / 2 || 1), rr = Math.hypot(nx, ny);
            if (Math.abs(rr - 1) * Math.min(w, h) / 2 < tol) return it;
          }
          continue;
        }
        const m = measure(ctx, it, s);
        const a = -it.angle * Math.PI / 180;
        const dx = q.x * W - it.x * W, dy = q.y * H - it.y * H;
        const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
        if (lx >= -6 && lx <= m.w + 6 && ly >= -6 && ly <= m.h + 6) return it;
      }
      return null;
    };
    // 消しゴム：ポインタの下にある要素それぞれに、要素内座標(pt)で軌跡を足す
    const eraseAt = (q, drag) => {
      const ctx = o.getContext("2d"), W = o.width, H = o.height, s = W / (d.ptW || (W / viewer.scale));
      const r = +el.er.value;
      for (const it of items) {
        if (it.page !== p) continue;
        let lx = q.x * W - it.x * W, ly = q.y * H - it.y * H;
        if (!isShape(it)) {
          const a = -it.angle * Math.PI / 180;
          [lx, ly] = [lx * Math.cos(a) - ly * Math.sin(a), lx * Math.sin(a) + ly * Math.cos(a)];
        }
        const m = isShape(it) ? { w: it.w * W, h: it.h * H } : measure(ctx, it, s);
        const pad = r * s;
        if (lx < -pad || lx > m.w + pad || ly < -pad || ly > m.h + pad) continue;
        let st = drag.strokes.get(it.id);
        if (!st) { st = { it, stroke: { r, pts: [] } }; drag.strokes.set(it.id, st); (it.erase || (it.erase = [])).push(st.stroke); }
        st.stroke.pts.push([lx / s, ly / s]);
      }
    };
    let drag = null;
    o.addEventListener("pointerdown", (e) => {
      if (!d.rendered) return;
      const q = norm(e);
      if (el.kind.value === "eraser") {
        o.setPointerCapture(e.pointerId);
        drag = { erase: true, strokes: new Map() };
        eraseAt(q, drag); d.eraserPos = q; redraw(p);
        return;
      }
      const it = hit(q);
      if (it) {
        o.setPointerCapture(e.pointerId);
        drag = { it, ox: q.x - it.x, oy: q.y - it.y, moved: false };
        if (selectedId !== it.id) select(it.id);
      } else if (el.kind.value !== "text") {
        // 四角・マル：ドラッグで大きさを決める
        o.setPointerCapture(e.pointerId);
        const n = { id: ++seq, page: p, type: el.kind.value, x: q.x, y: q.y, w: 0, h: 0, color: el.color.value,
          lw: +el.lw.value, jitter: +el.jitter.value, seed: (Math.random() * 1e9) | 0 };
        items.push(n);
        drag = { it: n, create: true, sx: q.x, sy: q.y };
        select(n.id);
      } else if (el.text.value.trim()) {
        const size = +el.size.value;
        const n = { id: ++seq, page: p, type: "text", x: clamp01(q.x), y: clamp01(q.y - (size * 0.6) / (o.height / viewer.scale)),
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
      if (el.kind.value === "eraser") {
        if (drag && drag.erase) eraseAt(q, drag);
        d.eraserPos = q; o.style.cursor = "none"; redraw(p);
        return;
      }
      if (drag && drag.create) {
        const it = drag.it;
        it.x = clamp01(Math.min(q.x, drag.sx)); it.y = clamp01(Math.min(q.y, drag.sy));
        it.w = Math.abs(clamp01(q.x) - drag.sx); it.h = Math.abs(clamp01(q.y) - drag.sy);
        redraw(p);
      } else if (drag) {
        drag.moved = true;
        drag.it.x = clamp01(q.x - drag.ox); drag.it.y = clamp01(q.y - drag.oy);
        redraw(p);
      } else {
        o.style.cursor = hit(q) ? "move" : "text";
      }
    });
    o.addEventListener("pointerleave", () => { if (d.eraserPos) { d.eraserPos = null; redraw(p); } });
    const end = () => {
      if (drag && drag.erase) {
        const batch = ++batchSeq;
        for (const { it, stroke } of drag.strokes.values()) eraseHistory.push({ it, stroke, batch });
        if (drag.strokes.size) setStatus("消しゴムで消しました。「消しゴムを元に戻す」で1回分ずつ戻せます。");
        else setStatus("消しゴムの範囲に手書きの文字・線がありません。");
        updateChrome();
      }
      if (drag && drag.create) {
        const it = drag.it;   // 小さすぎる（ほぼクリックだけ）なら追加しない
        if (it.w * o.width < 12 || it.h * o.height < 12) {
          items = items.filter((i) => i !== it); selectedId = null;
          setStatus("四角・マルは、ページ上をドラッグして大きさを決めてください。");
        } else {
          setStatus(`p.${p} に${it.type === "rect" ? "四角" : "マル"}を追加しました。線をドラッグで移動、Deleteで削除できます。`);
        }
        updateChrome(); redrawAll();
      }
      drag = null;
    };
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
      pdf = await pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise;
      items = []; eraseHistory.length = 0; selectedId = null;
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
      await Promise.all(items.filter((it) => !isShape(it)).map((it) => document.fonts.load(fontStr(it, 1).replace(/^[\d.]+px/, "24px"), it.text)));
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
      setSaveStatus(`保存しました（${items.length}件を追加、ダウンロードを開始しました）。書き込みは画像として重ねているため、PDF上では選択・検索できません。`);
    } catch (e) {
      setSaveStatus("保存に失敗しました: " + (e && e.message || e), true);
    } finally { updateChrome(); }
  };

  updateChrome();
})();
