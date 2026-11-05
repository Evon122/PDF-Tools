/* PDFNova editor: everything runs in the browser. Objects are kept in PDF points (y down); rot = degrees clockwise around the top-left corner. */
(function () {
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const D2R = Math.PI / 180;
  let bytes = null, name = "edited.pdf", pdf = null, pages = [], Z = 1.3, objs = [], els = new Map(), sel = null, tool = "select";
  let undo = [], redo = [], editing = null, pending = null, drag = null, nid = 1, lastKey = 0;
  const st = { fam: "helv", size: 16, bold: false, ital: false, col: "#000000", fill: "#ffffff", nofill: true, sw: 2, op: 100 };

  function toast(m, err) { const t = $("#toast"); t.textContent = m; t.className = "show" + (err ? " err" : ""); clearTimeout(toast.t); toast.t = setTimeout(() => t.className = "", err ? 5000 : 2600); }
  const rnd = v => Math.round(v * 10) / 10;
  const cssFont = o => { const d = C.FONTS[o.fam] || C.FONTS.helv; return d.css + (C.needsShaping(o.text || "") ? ", 'PN Hind'" : ""); };

  /* ---------- open ---------- */
  $("#pick").onclick = () => $("#file").click();
  $("#file").onchange = e => { if (e.target.files[0]) open(e.target.files[0]); e.target.value = ""; };
  const drop = $("#drop");
  ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", e => { const f = [...e.dataTransfer.files].find(x => /pdf$/i.test(x.type) || /\.pdf$/i.test(x.name)); if (f) open(f); });

  async function open(file) {
    $("#smsg").textContent = "Opening...";
    try {
      bytes = new Uint8Array(await file.arrayBuffer()); name = C.base(file.name) + "-edited.pdf";
      pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    } catch (e) { $("#smsg").className = "msg err"; $("#smsg").textContent = /password/i.test(e.message) ? "This PDF is password protected. Use the Unlock tool first." : "Could not read this file."; return; }
    $("#start").classList.add("hide"); $("#app").classList.remove("hide");
    const host = $("#pages"); host.innerHTML = ""; pages = []; objs = []; els.clear(); sel = null; undo = []; redo = [];
    const first = await pdf.getPage(1), w1 = first.getViewport({ scale: 1 }).width;
    Z = Math.max(0.5, Math.min(1.6, (Math.min(window.innerWidth, 1100) - 24) / w1));
    let rotated = false;
    for (let i = 1; i <= pdf.numPages; i++) {
      const pg = await pdf.getPage(i), vp = pg.getViewport({ scale: 1 }); if (pg.rotate) rotated = true;
      const box = document.createElement("div"); box.className = "pg"; const cv = document.createElement("canvas"), ov = document.createElement("div"); ov.className = "ov"; ov.dataset.p = i - 1;
      box.append(cv, ov); host.appendChild(box);
      pages.push({ pg, w: vp.width, h: vp.height, box, cv, ov, done: false, items: null, task: null });
    }
    sizePages(); observe(); setTool(location.hash === "#sign" ? "sign" : "select");
    if (rotated) toast("This PDF has rotated pages. For exact placement, rotate it first with the Rotate PDF tool.", true);
    if (location.hash === "#sign") openSig();
    syncProps(); updUndo();
  }

  /* ---------- page rendering ---------- */
  let io = null;
  function sizePages() {
    pages.forEach(p => { p.box.style.width = p.w * Z + "px"; p.box.style.height = p.h * Z + "px"; p.done = false; });
    $("#zv").textContent = Math.round(Z / 1.3 * 100) + "%";
  }
  function observe() {
    if (io) io.disconnect();
    io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) render(pages[[...$("#pages").children].indexOf(e.target)]); }), { rootMargin: "700px 0px" });
    [...$("#pages").children].forEach(c => io.observe(c));
  }
  async function render(p) {
    if (!p || p.done) return; p.done = true;
    if (p.task) { try { p.task.cancel(); } catch (e) { } }
    const dpr = Math.min(2, window.devicePixelRatio || 1), vp = p.pg.getViewport({ scale: Z * dpr });
    const cv = document.createElement("canvas"); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    p.task = p.pg.render({ canvasContext: cv.getContext("2d"), viewport: vp });
    try { await p.task.promise; } catch (e) { p.done = false; return; }
    cv.style.width = p.w * Z + "px"; cv.style.height = p.h * Z + "px"; cv.className = ""; p.box.replaceChild(cv, p.cv); p.cv = cv; p.dpr = dpr;
  }
  function setZoom(z) {
    Z = Math.max(0.4, Math.min(3, z)); sizePages(); objs.forEach(draw);
    [...$("#pages").children].forEach((c, i) => { const r = c.getBoundingClientRect(); if (r.bottom > -700 && r.top < innerHeight + 700) render(pages[i]); });
  }
  $("#zIn").onclick = () => setZoom(Z * 1.2); $("#zOut").onclick = () => setZoom(Z / 1.2);

  /* ---------- objects ---------- */
  function add(o, p, noSnap) { if (!noSnap) pushUndo(); o.id = nid++; o.p = p; o.rot = o.rot || 0; objs.push(o); draw(o); return o; }
  function remove(o) { pushUndo(); objs = objs.filter(x => x !== o); const e = els.get(o.id); if (e) e.remove(); els.delete(o.id); if (sel === o) sel = null; syncProps(); }
  function draw(o) {
    let e = els.get(o.id);
    if (!e) { e = document.createElement("div"); e.dataset.id = o.id; e.innerHTML = '<div class="in"></div>'; pages[o.p].ov.appendChild(e); els.set(o.id, e); }
    e.className = "ob " + o.t + (sel === o ? " sel" : "");
    e.style.left = o.x * Z + "px"; e.style.top = o.y * Z + "px"; e.style.transform = `rotate(${o.rot || 0}deg)`; e.style.opacity = (o.op == null ? 100 : o.op) / 100;
    const inn = e.firstChild;
    if (o.t === "text") {
      if (editing !== o) inn.textContent = o.text;
      inn.style.fontFamily = cssFont(o); inn.style.fontSize = o.size * Z + "px"; inn.style.color = o.col; inn.style.fontWeight = o.bold ? 700 : 400; inn.style.fontStyle = o.ital ? "italic" : "normal";
      if (C.FONTS[o.fam] && C.FONTS[o.fam].files && !e._ld) { e._ld = 1; C.loadWeb(o.fam).then(() => { measure(o); }); }
      measure(o);
    } else {
      e.style.width = o.w * Z + "px"; e.style.height = o.h * Z + "px";
      if (o.t === "img") { if (!inn.firstChild) { const im = new Image(); im.src = o.src; inn.appendChild(im); } inn.style.cssText = "width:100%;height:100%"; }
      else if (o.t === "rect" || o.t === "ellipse") {
        inn.style.cssText = `width:100%;height:100%;box-sizing:border-box;background:${o.fill || "transparent"};border:${(o.sw || 0) * Z}px solid ${o.sw ? o.col : "transparent"};border-radius:${o.t === "ellipse" ? "50%" : 0}`;
      } else if (o.t === "path") {
        const pts = o.pts.map(q => [q[0] * Z, q[1] * Z].join(",")).join(" ");
        inn.style.cssText = "width:100%;height:100%";
        inn.innerHTML = `<svg width="${o.w * Z}" height="${o.h * Z}"><polyline points="${pts}" fill="none" stroke="${o.col}" stroke-width="${o.sw * Z}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      }
    }
    e.querySelectorAll(".hd").forEach(h => h.remove());
    if (sel === o && editing !== o) { for (const k of ["br", "rt"]) { const h = document.createElement("i"); h.className = "hd " + k; h.dataset.h = k; e.appendChild(h); } }
  }
  function measure(o) { const e = els.get(o.id); if (e && o.t === "text") { o.w = e.offsetWidth / Z; o.h = e.offsetHeight / Z; } }
  function redrawAll() { objs.forEach(draw); }
  function select(o) { const old = sel; sel = o; if (old && old !== o) draw(old); if (o) draw(o); syncProps(); }
  const dims = o => { if (o.t === "text") measure(o); return [o.w || 0, o.h || 0]; };

  /* ---------- undo ---------- */
  const snap = () => objs.map(o => Object.assign({}, o, o.pts ? { pts: o.pts.map(q => q.slice()) } : {}));
  function pushUndo() { undo.push(snap()); if (undo.length > 80) undo.shift(); redo = []; updUndo(); }
  function restore(s) {
    els.forEach(e => e.remove()); els.clear(); objs = s; sel = null; editing = null; objs.forEach(draw); syncProps(); updUndo();
  }
  function doUndo() { if (!undo.length) return; redo.push(snap()); restore(undo.pop()); }
  function doRedo() { if (!redo.length) return; undo.push(snap()); restore(redo.pop()); }
  function updUndo() { $("#bUndo").disabled = !undo.length; $("#bRedo").disabled = !redo.length; }
  $("#bUndo").onclick = doUndo; $("#bRedo").onclick = doRedo;

  /* ---------- tools ---------- */
  function setTool(t) {
    tool = t; $$("#tools [data-t]").forEach(b => b.classList.toggle("on", b.dataset.t === t));
    const host = $("#pages"); host.className = (["select"].includes(t) ? "" : "act ") + "tool-" + (pending ? "place" : t);
    $$(".hov").forEach(h => h.remove());
    const msg = { edit: "Click any existing text to change it.", text: "Click on the page where the text should go.", draw: "Draw with finger or mouse.", line: "Drag to draw a line.", rect: "Drag to draw a box.", ellipse: "Drag to draw an oval.", hl: "Drag over the text to highlight.", white: "Drag over what you want to cover.", image: "", sign: "" }[t];
    if (msg) toast(msg);
  }
  $("#tools").addEventListener("click", e => {
    const b = e.target.closest("[data-t]"); if (!b) return; const t = b.dataset.t; endEdit();
    if (t === "image") { $("#imgf").click(); return; }
    if (t === "sign") { openSig(); return; }
    pending = null; setTool(t);
  });
  $("#imgf").onchange = async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try { const buf = await C.imageToPng(f); const src = await blobUrl(new Blob([buf], { type: "image/png" })); await setPending(src); } catch (er) { toast("Could not read this image.", true); }
  };
  const blobUrl = b => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
  function setPending(src, width) {
    return new Promise(res => { const im = new Image(); im.onload = () => { pending = { src, ar: im.naturalHeight / im.naturalWidth, width: width || 200 }; setTool("select"); setTool("select"); $("#pages").className = "act tool-place"; toast("Tap on the page where it should go."); res(); }; im.src = src; });
  }

  /* ---------- pointer handling ---------- */
  const host = $("#pages");
  function ptOf(ov, e) { const r = ov.getBoundingClientRect(); return [(e.clientX - r.left) / Z, (e.clientY - r.top) / Z]; }
  host.addEventListener("pointerdown", e => {
    const ov = e.target.closest(".ov"); if (!ov) return; const p = +ov.dataset.p, [px, py] = ptOf(ov, e);
    const hd = e.target.closest(".hd"), obEl = e.target.closest(".ob"), o = obEl && objs.find(x => x.id == obEl.dataset.id);
    if (editing && o === editing) return;
    if (editing) endEdit();
    if (hd && o) { e.preventDefault(); startHandle(o, hd.dataset.h, e, ov); return; }
    if (pending) { placePending(p, px, py); e.preventDefault(); return; }
    if (o && (tool === "select" || tool === "edit" || tool === "text")) { e.preventDefault(); select(o); drag = { mode: "move", o, ov, sx: px, sy: py, ox: o.x, oy: o.y, moved: false }; return; }
    if (tool === "select") { select(null); return; }
    e.preventDefault(); select(null);
    if (tool === "text") { const t = add({ t: "text", x: px, y: py, text: "", fam: st.fam, size: st.size, bold: st.bold, ital: st.ital, col: st.col, op: st.op }, p); select(t); startEdit(t); }
    else if (tool === "edit") editAt(p, px, py);
    else if (["rect", "ellipse", "hl", "white", "line", "draw"].includes(tool)) startShape(p, px, py, ov);
  });
  function placePending(p, x, y) {
    const w = Math.min(pending.width, pages[p].w * 0.8), h = w * pending.ar;
    const o = add({ t: "img", x: Math.max(0, x - w / 2), y: Math.max(0, y - h / 2), w, h, src: pending.src, op: 100 }, p); pending = null; setTool("select"); select(o);
  }
  function startShape(p, x, y, ov) {
    pushUndo(); let o;
    if (tool === "draw") o = { t: "path", x, y, w: 1, h: 1, pts: [[0, 0]], col: st.col, sw: st.sw || 2, op: 100, abs: [[x, y]] };
    else if (tool === "line") o = { t: "path", x, y, w: 1, h: 1, pts: [[0, 0], [0, 0]], col: st.col, sw: st.sw || 2, op: 100, line: true, sx: x, sy: y };
    else if (tool === "hl") o = { t: "rect", x, y, w: 1, h: 1, fill: "#ffe600", sw: 0, col: "#ffe600", op: 40 };
    else if (tool === "white") o = { t: "rect", x, y, w: 1, h: 1, fill: "#ffffff", sw: 0, col: "#ffffff", op: 100 };
    else o = { t: tool, x, y, w: 1, h: 1, fill: st.nofill ? "" : st.fill, sw: st.sw, col: st.col, op: st.op };
    add(o, +ov.dataset.p, true); drag = { mode: "shape", o, ov, sx: x, sy: y };
  }
  function startHandle(o, kind, e, ov) {
    const [w, h] = dims(o);
    drag = { mode: kind, o, ov, w, h, size: o.size, pts: o.pts && o.pts.map(q => q.slice()), moved: false };
  }
  document.addEventListener("pointermove", e => {
    if (!drag) {
      if (tool === "edit") hover(e); return;
    }
    const o = drag.o, [px, py] = ptOf(drag.ov, e);
    if (!drag.moved && drag.mode !== "shape") { if (Math.hypot(px - (drag.sx ?? px), py - (drag.sy ?? py)) < 1 && drag.mode === "move") return; pushUndo(); drag.moved = true; }
    if (drag.mode === "move") { o.x = drag.ox + px - drag.sx; o.y = drag.oy + py - drag.sy; }
    else if (drag.mode === "shape") shapeMove(o, px, py);
    else if (drag.mode === "br") {
      const r = o.rot * D2R, dx = px - o.x, dy = py - o.y, lx = dx * Math.cos(r) + dy * Math.sin(r), ly = -dx * Math.sin(r) + dy * Math.cos(r);
      if (o.t === "text") { o.size = Math.max(4, Math.round(drag.size * lx / drag.w * 2) / 2); }
      else if (o.t === "img") { const nw = Math.max(8, lx); o.w = nw; o.h = nw * drag.h / drag.w; }
      else if (o.t === "path") { const nw = Math.max(1, lx), nh = Math.max(1, ly); o.pts = drag.pts.map(q => [q[0] * nw / drag.w, q[1] * nh / drag.h]); o.w = nw; o.h = nh; }
      else { o.w = Math.max(4, lx); o.h = Math.max(4, ly); }
    } else if (drag.mode === "rt") {
      const r = o.rot * D2R, cx = o.x + (drag.w / 2) * Math.cos(r) - (drag.h / 2) * Math.sin(r), cy = o.y + (drag.w / 2) * Math.sin(r) + (drag.h / 2) * Math.cos(r);
      let a = Math.atan2(py - cy, px - cx) / D2R + 90; if (e.shiftKey) a = Math.round(a / 15) * 15; else if (Math.abs(a / 15 - Math.round(a / 15)) * 15 < 2.5) a = Math.round(a / 15) * 15;
      setRot(o, a, drag.w, drag.h);
    }
    draw(o); if (sel === o) syncProps();
  });
  function shapeMove(o, px, py) {
    if (o.t === "path" && !o.line) { // freehand: keep origin at min corner
      o.abs.push([px, py]); const xs = o.abs.map(q => q[0]), ys = o.abs.map(q => q[1]), x0 = Math.min(...xs), y0 = Math.min(...ys);
      o.x = x0; o.y = y0; o.w = Math.max(1, Math.max(...xs) - x0); o.h = Math.max(1, Math.max(...ys) - y0); o.pts = o.abs.map(q => [q[0] - x0, q[1] - y0]);
    } else if (o.line) {
      const x0 = Math.min(o.sx, px), y0 = Math.min(o.sy, py); o.x = x0; o.y = y0; o.w = Math.max(1, Math.abs(px - o.sx)); o.h = Math.max(1, Math.abs(py - o.sy));
      o.pts = [[o.sx - x0, o.sy - y0], [px - x0, py - y0]];
    } else { o.x = Math.min(drag.sx, px); o.y = Math.min(drag.sy, py); o.w = Math.max(1, Math.abs(px - drag.sx)); o.h = Math.max(1, Math.abs(py - drag.sy)); }
  }
  document.addEventListener("pointerup", () => {
    if (!drag) return; const d = drag; drag = null;
    if (d.mode === "shape") {
      const o = d.o; if (o.t !== "path" && (o.w < 3 || o.h < 3)) { objs = objs.filter(x => x !== o); els.get(o.id).remove(); els.delete(o.id); undo.pop(); updUndo(); return; }
      delete o.abs; if (!o.line && o.t === "path" && o.pts.length < 2) { objs = objs.filter(x => x !== o); els.get(o.id).remove(); els.delete(o.id); undo.pop(); updUndo(); return; }
      if (o.t === "rect" && o.op === 40 || o.fill === "#ffffff" && o.col === "#ffffff") { /* keep tool for repeated use */ } else { setTool("select"); }
      select(o);
    }
  });
  host.addEventListener("dblclick", e => { const ob = e.target.closest(".ob"); if (!ob) return; const o = objs.find(x => x.id == ob.dataset.id); if (o && o.t === "text") { select(o); startEdit(o); } });
  function setRot(o, a, w, h) { // rotate around the centre, keep the centre fixed
    if (w == null) [w, h] = dims(o);
    const r0 = o.rot * D2R, r1 = a * D2R;
    const cx = o.x + (w / 2) * Math.cos(r0) - (h / 2) * Math.sin(r0), cy = o.y + (w / 2) * Math.sin(r0) + (h / 2) * Math.cos(r0);
    o.x = cx - ((w / 2) * Math.cos(r1) - (h / 2) * Math.sin(r1)); o.y = cy - ((w / 2) * Math.sin(r1) + (h / 2) * Math.cos(r1));
    a = ((a + 180) % 360 + 360) % 360 - 180; o.rot = rnd(a);
  }

  /* ---------- text editing ---------- */
  function startEdit(o) {
    editing = o; draw(o); const inn = els.get(o.id).firstChild;
    try { inn.contentEditable = "plaintext-only"; } catch (e) { } if (inn.contentEditable !== "plaintext-only") inn.contentEditable = "true";
    inn.focus(); const r = document.createRange(); r.selectNodeContents(inn); const s = getSelection(); s.removeAllRanges(); s.addRange(r); if (!o.text) s.collapseToEnd();
    inn.onblur = () => endEdit(); inn.onkeydown = ev => { if (ev.key === "Escape") { ev.preventDefault(); inn.blur(); } ev.stopPropagation(); };
    inn.oninput = () => { o.text = inn.innerText.replace(/\n$/, ""); measure(o); };
  }
  function endEdit() {
    if (!editing) return; const o = editing, e = els.get(o.id); editing = null;
    if (e) { const inn = e.firstChild; inn.onblur = null; inn.removeAttribute("contenteditable"); o.text = inn.innerText.replace(/\n$/, ""); }
    if (!o.text.trim()) { objs = objs.filter(x => x !== o); if (e) e.remove(); els.delete(o.id); if (sel === o) sel = null; syncProps(); return; }
    if (o._before !== undefined && o._before !== o.text) { /* snapshot taken on create */ }
    draw(o);
  }

  /* ---------- editing existing text ---------- */
  async function items(p) {
    const P = pages[p]; if (P.items) return P.items;
    const tc = await P.pg.getTextContent(), vp = P.pg.getViewport({ scale: 1 }); const out = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim() || Math.abs(it.transform[1]) > 0.01 || Math.abs(it.transform[2]) > 0.01) continue;
      const [x, by] = vp.convertToViewportPoint(it.transform[4], it.transform[5]), size = Math.hypot(it.transform[2], it.transform[3]) || it.height;
      const fam = (tc.styles[it.fontName] || {}).fontFamily || "sans-serif";
      out.push({ str: it.str, x, by, size, w: it.width, fam: /mono/i.test(fam) ? "cour" : /serif/i.test(fam) && !/sans/i.test(fam) ? "times" : "helv" });
    }
    return P.items = out;
  }
  const box = it => ({ x: it.x - 1, y: it.by - it.size * 0.95, w: it.w + 2, h: it.size * 1.25 });
  const inside = (b, x, y) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
  let hovBusy = false;
  async function hover(e) {
    const ov = e.target.closest && e.target.closest(".ov"); $$(".hov").forEach(h => h.remove()); if (!ov || hovBusy) return;
    hovBusy = true; try {
      const p = +ov.dataset.p, [x, y] = ptOf(ov, e), it = (await items(p)).find(i => inside(box(i), x, y));
      if (it && !e.target.closest(".ob")) { const b = box(it), d = document.createElement("div"); d.className = "hov"; d.style.cssText = `left:${b.x * Z}px;top:${b.y * Z}px;width:${b.w * Z}px;height:${b.h * Z}px`; ov.appendChild(d); }
    } finally { hovBusy = false; }
  }
  async function editAt(p, x, y) {
    const it = (await items(p)).find(i => inside(box(i), x, y)); if (!it) { toast("No text here. Use the Text tool to add new text."); return; }
    const b = box(it), P = pages[p]; let bg = "#ffffff";
    try { const k = (P.dpr || 1) * Z, g = P.cv.getContext("2d"), d = g.getImageData(Math.max(0, Math.floor((b.x - 1) * k)), Math.max(0, Math.floor((b.y + 1) * k)), 1, 1).data; bg = "#" + [...d].slice(0, 3).map(v => v.toString(16).padStart(2, "0")).join(""); } catch (e) { }
    pushUndo();
    add({ t: "rect", x: b.x, y: b.y, w: b.w, h: b.h, fill: bg, sw: 0, col: bg, op: 100 }, p, true);
    const t = add({ t: "text", x: it.x, y: it.by - it.size * 0.94, text: it.str, fam: it.fam, size: Math.round(it.size * 2) / 2, bold: false, ital: false, col: "#000000", op: 100 }, p, true);
    select(t); startEdit(t);
  }

  /* ---------- properties ---------- */
  const typeOf = () => sel ? sel.t : (tool === "text" ? "text" : ["rect", "ellipse"].includes(tool) ? "rect" : tool === "draw" || tool === "line" ? "path" : "none");
  function syncProps() {
    const t = typeOf(), s = sel || st, o = sel;
    const show = (id, on) => { const e = $(id).closest("label") || $(id); e.classList.toggle("off", !on); };
    show("#fam", t === "text"); show("#size", t === "text"); $("#bold").classList.toggle("off", t !== "text"); $("#ital").classList.toggle("off", t !== "text");
    show("#col", ["text", "rect", "ellipse", "path"].includes(t)); show("#fill", ["rect", "ellipse"].includes(t)); show("#nofill", ["rect", "ellipse"].includes(t)); show("#sw", ["rect", "ellipse", "path"].includes(t));
    show("#op", t !== "none"); show("#rot", !!o); ["#rl", "#rr", "#dup", "#del"].forEach(i => $(i).classList.toggle("off", !o));
    $("#fam").value = s.fam || st.fam; $("#size").value = s.size || st.size; $("#bold").classList.toggle("on", !!(s.bold)); $("#ital").classList.toggle("on", !!(s.ital));
    $("#col").value = s.col || st.col; if (o && o.t !== "text") { $("#fill").value = o.fill || "#ffffff"; $("#nofill").checked = !o.fill; } else { $("#fill").value = st.fill; $("#nofill").checked = st.nofill; }
    $("#sw").value = s.sw == null ? st.sw : s.sw; $("#op").value = s.op == null ? 100 : s.op; $("#rot").value = o ? rnd(o.rot || 0) : "";
  }
  $("#fam").innerHTML = Object.keys(C.FONTS).map(k => `<option value="${k}">${C.esc(C.FONTS[k].label)}</option>`).join("");
  let propSnap = 0;
  function prop(k, v, defOnly) {
    st[k] = v === undefined ? st[k] : v;
    if (sel && !defOnly) { if (Date.now() - propSnap > 700) pushUndo(); propSnap = Date.now(); sel[k] = v; draw(sel); }
  }
  $("#fam").onchange = e => { st.fam = e.target.value; if (sel && sel.t === "text") { pushUndo(); sel.fam = e.target.value; draw(sel); } };
  $("#size").oninput = e => { const v = Math.max(4, +e.target.value || 4); st.size = v; if (sel && sel.t === "text") prop("size", v); };
  $("#bold").onclick = () => { st.bold = !st.bold; if (sel && sel.t === "text") { pushUndo(); sel.bold = !sel.bold; st.bold = sel.bold; draw(sel); } syncProps(); };
  $("#ital").onclick = () => { st.ital = !st.ital; if (sel && sel.t === "text") { pushUndo(); sel.ital = !sel.ital; st.ital = sel.ital; draw(sel); } syncProps(); };
  $("#col").oninput = e => { st.col = e.target.value; if (sel) prop("col", e.target.value); };
  $("#fill").oninput = e => { st.fill = e.target.value; st.nofill = false; if (sel && sel.t !== "text" && sel.t !== "path" && sel.t !== "img") { prop("fill", e.target.value); $("#nofill").checked = false; } };
  $("#nofill").onchange = e => { st.nofill = e.target.checked; if (sel && (sel.t === "rect" || sel.t === "ellipse")) { pushUndo(); sel.fill = e.target.checked ? "" : $("#fill").value; draw(sel); } };
  $("#sw").oninput = e => { const v = Math.max(0, +e.target.value || 0); st.sw = v; if (sel) prop("sw", v); };
  $("#op").oninput = e => { const v = +e.target.value; st.op = v; if (sel) prop("op", v); };
  $("#rot").oninput = e => { if (!sel || e.target.value === "") return; if (Date.now() - propSnap > 700) pushUndo(); propSnap = Date.now(); setRot(sel, +e.target.value); draw(sel); };
  $("#rl").onclick = () => { if (sel) { pushUndo(); setRot(sel, sel.rot - 15); draw(sel); syncProps(); } };
  $("#rr").onclick = () => { if (sel) { pushUndo(); setRot(sel, sel.rot + 15); draw(sel); syncProps(); } };
  $("#del").onclick = () => { if (sel) remove(sel); };
  function dup() { if (!sel) return; const c = Object.assign({}, sel, sel.pts ? { pts: sel.pts.map(q => q.slice()) } : {}); delete c.id; c.x += 10; c.y += 10; const n = add(c, sel.p); select(n); }
  $("#dup").onclick = dup;

  /* ---------- keyboard ---------- */
  document.addEventListener("keydown", e => {
    if ($("#app").classList.contains("hide") || $("#sigd").open) return;
    const tg = e.target; if (tg.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(tg.tagName)) { if (!(tg.type === "range" || tg.type === "checkbox")) return; }
    const k = e.key, mod = e.ctrlKey || e.metaKey;
    if (mod && k.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
    if (mod && k.toLowerCase() === "y") { e.preventDefault(); doRedo(); return; }
    if (!sel) return;
    const step = e.shiftKey ? 10 : 1, once = () => { if (Date.now() - lastKey > 700) pushUndo(); lastKey = Date.now(); };
    if (k === "ArrowLeft") { e.preventDefault(); once(); sel.x -= step; }
    else if (k === "ArrowRight") { e.preventDefault(); once(); sel.x += step; }
    else if (k === "ArrowUp") { e.preventDefault(); once(); sel.y -= step; }
    else if (k === "ArrowDown") { e.preventDefault(); once(); sel.y += step; }
    else if (k === "[" || k === "{") { e.preventDefault(); once(); setRot(sel, sel.rot - (e.shiftKey ? 15 : 1)); }
    else if (k === "]" || k === "}") { e.preventDefault(); once(); setRot(sel, sel.rot + (e.shiftKey ? 15 : 1)); }
    else if (k === "Delete" || k === "Backspace") { e.preventDefault(); remove(sel); return; }
    else if (k === "Enter" && sel.t === "text") { e.preventDefault(); startEdit(sel); return; }
    else if (mod && k.toLowerCase() === "d") { e.preventDefault(); dup(); return; }
    else if (k === "Escape") { select(null); return; }
    else return;
    draw(sel); syncProps();
  });

  /* ---------- signature ---------- */
  let sigTab = "draw", sdraw = false, sInk = false;
  const sc = $("#sc"), sg = sc.getContext("2d");
  function openSig() { $("#sigd").showModal(); sclear(); stype(); }
  function sclear() { sg.clearRect(0, 0, sc.width, sc.height); sInk = false; }
  $("#sclear").onclick = sclear;
  const sp = e => { const r = sc.getBoundingClientRect(); return [(e.clientX - r.left) * sc.width / r.width, (e.clientY - r.top) * sc.height / r.height]; };
  sc.onpointerdown = e => { sdraw = true; sc.setPointerCapture(e.pointerId); const [x, y] = sp(e); sg.strokeStyle = $("#scol").value; sg.lineWidth = 4; sg.lineCap = sg.lineJoin = "round"; sg.beginPath(); sg.moveTo(x, y); sg.lineTo(x + .1, y + .1); sg.stroke(); sInk = true; };
  sc.onpointermove = e => { if (!sdraw) return; const [x, y] = sp(e); sg.lineTo(x, y); sg.stroke(); };
  sc.onpointerup = sc.onpointercancel = () => { sdraw = false; };
  $("#stabs").onclick = e => { const b = e.target.closest("[data-s]"); if (!b) return; sigTab = b.dataset.s; $$("#stabs button").forEach(x => x.classList.toggle("on", x === b)); ["draw", "type", "up"].forEach(t => $("#s-" + t).classList.toggle("hide", t !== sigTab)); if (sigTab === "type") stype(); };
  async function stype() {
    const f = $("#sfont").value; await C.loadWeb(f); const cv = $("#sp"), g = cv.getContext("2d"); g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = $("#scol").value; g.font = `80px ${C.FONTS[f].css}`; g.textBaseline = "middle"; g.fillText($("#stext").value || "Your name", 20, cv.height / 2);
  }
  $("#stext").oninput = stype; $("#sfont").onchange = stype; $("#scol").oninput = () => { if (sigTab === "type") stype(); };
  $("#scancel").onclick = () => $("#sigd").close();
  function trim(cv) {
    const g = cv.getContext("2d"), d = g.getImageData(0, 0, cv.width, cv.height).data; let x0 = cv.width, y0 = cv.height, x1 = 0, y1 = 0;
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) if (d[(y * cv.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 <= x0) return null; const pad = 6, o = document.createElement("canvas"); o.width = x1 - x0 + 1 + pad * 2; o.height = y1 - y0 + 1 + pad * 2;
    o.getContext("2d").drawImage(cv, x0, y0, x1 - x0 + 1, y1 - y0 + 1, pad, pad, x1 - x0 + 1, y1 - y0 + 1); return o;
  }
  $("#suse").onclick = async () => {
    let cv = null;
    if (sigTab === "draw") cv = sInk ? trim(sc) : null;
    else if (sigTab === "type") { if (!$("#stext").value.trim()) { toast("Type your name first.", true); return; } cv = trim($("#sp")); }
    else { const f = $("#sfile").files[0]; if (!f) { toast("Choose an image first.", true); return; } const bmp = await createImageBitmap(f); cv = document.createElement("canvas"); cv.width = bmp.width; cv.height = bmp.height; cv.getContext("2d").drawImage(bmp, 0, 0); }
    if (!cv) { toast("Draw your signature first.", true); return; }
    $("#sigd").close(); await setPending(cv.toDataURL("image/png"), 150);
  };

  /* ---------- save ---------- */
  $("#bSave").onclick = async () => {
    endEdit(); const b = $("#bSave"); b.disabled = true; b.textContent = "Saving...";
    try {
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }), cache = {};
      const list = doc.getPages();
      for (const o of objs) {
        const page = list[o.p], H = page.getHeight(), r = (o.rot || 0) * D2R, cs = Math.cos(r), sn = Math.sin(r), op = (o.op == null ? 100 : o.op) / 100;
        const at = (dx, dy) => [o.x + dx * cs - dy * sn, H - (o.y + dx * sn + dy * cs)];
        if (o.t === "text") await C.drawText(doc, page, { text: o.text, x: o.x, y: o.y, size: o.size, color: o.col, fam: o.fam, bold: o.bold, italic: o.ital, rot: o.rot || 0, opacity: op });
        else if (o.t === "img") {
          const img = cache[o.src] || (cache[o.src] = await doc.embedPng(await (await fetch(o.src)).arrayBuffer())), [x, y] = at(0, o.h);
          page.drawImage(img, { x, y, width: o.w, height: o.h, rotate: degrees(-(o.rot || 0)), opacity: op });
        } else if (o.t === "rect") {
          const [x, y] = at(0, o.h); page.drawRectangle({ x, y, width: o.w, height: o.h, rotate: degrees(-(o.rot || 0)), color: o.fill ? C.hex(o.fill) : undefined, opacity: o.fill ? op : 0, borderColor: o.sw ? C.hex(o.col) : undefined, borderWidth: o.sw || 0, borderOpacity: op });
        } else if (o.t === "ellipse") {
          const [x, y] = at(o.w / 2, o.h / 2); page.drawEllipse({ x, y, xScale: o.w / 2, yScale: o.h / 2, rotate: degrees(-(o.rot || 0)), color: o.fill ? C.hex(o.fill) : undefined, opacity: o.fill ? op : 0, borderColor: o.sw ? C.hex(o.col) : undefined, borderWidth: o.sw || 0, borderOpacity: op });
        } else if (o.t === "path") {
          for (let i = 1; i < o.pts.length; i++) { const [x0, y0] = at(o.pts[i - 1][0], o.pts[i - 1][1]), [x1, y1] = at(o.pts[i][0], o.pts[i][1]); page.drawLine({ start: { x: x0, y: y0 }, end: { x: x1, y: y1 }, thickness: o.sw, color: C.hex(o.col), opacity: op, lineCap: PDFLib.LineCapStyle.Round }); }
        }
      }
      C.save(await C.pdfBlob(doc), name); toast("Saved. Check your Downloads folder.");
    } catch (e) { console.error(e); toast("Could not save: " + e.message, true); }
    b.disabled = false; b.textContent = "Download PDF";
  };

  window.addEventListener("beforeunload", e => { if (undo.length && objs.length) { e.preventDefault(); e.returnValue = ""; } });
  window.__ed = { get objs() { return objs; }, get pages() { return pages; }, select, draw, setRot, get Z() { return Z; } };
})();
