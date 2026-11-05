/* Helpers shared by the tools and the editor. Everything runs in the browser. */
const { PDFDocument, StandardFonts, rgb, degrees } = PDFLib;
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("vendor/pdf.worker.min.js", document.baseURI).href;

const C = {
  esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); },
  base(name) { return name.replace(/\.[^.]+$/, ""); },
  mb(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; },
  async read(f) { return await f.arrayBuffer(); },
  /* "1-3,5,8-" -> [0,1,2,4,7..n-1]; empty or "all" -> every page. Throws a readable error. */
  ranges(str, n) {
    str = (str || "").trim().toLowerCase();
    if (!str || str === "all") return [...Array(n).keys()];
    const out = [];
    for (const part of str.split(",")) {
      const p = part.trim(); if (!p) continue;
      const m = p.match(/^(\d*)\s*-\s*(\d*)$/);
      let a, b;
      if (m) { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : n; }
      else if (/^\d+$/.test(p)) a = b = +p;
      else throw new Error(`"${p}" is not a page number or range`);
      if (a < 1 || b < 1 || a > n || b > n) throw new Error(`Page ${a > n || b > n ? Math.max(a, b) : 0} does not exist (the file has ${n} pages)`);
      if (a <= b) for (let i = a; i <= b; i++) out.push(i - 1); else for (let i = a; i >= b; i--) out.push(i - 1);
    }
    if (!out.length) throw new Error("No pages selected");
    return out;
  },
  hex(h) { h = (h || "#000000").replace("#", ""); return rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255); },
  save(blob, name) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  },
  async zip(items) {
    const z = new JSZip(), used = new Set();
    for (const it of items) { let n = it.name, i = 1; while (used.has(n)) n = it.name.replace(/(\.[^.]+)?$/, `-${++i}$1`); used.add(n); z.file(n, it.blob); }
    return await z.generateAsync({ type: "blob", compression: "DEFLATE" });
  },
  async loadPdf(file, opts) {
    const buf = await C.read(file);
    try { return await PDFDocument.load(buf, Object.assign({ updateMetadata: false }, opts || {})); }
    catch (e) {
      if (/encrypted/i.test(e.message)) throw new Error(`"${file.name}" is password protected. Use the Unlock tool first.`);
      throw new Error(`"${file.name}" could not be read (it may be damaged or not a PDF).`);
    }
  },
  async pdfBlob(doc) { return new Blob([await doc.save({ useObjectStreams: true })], { type: "application/pdf" }); },
  async openJs(file) { // pdf.js document for drawing pages
    const data = new Uint8Array(await C.read(file));
    return await pdfjsLib.getDocument({ data }).promise;
  },
  async canvasOf(page, scale) {
    const vp = page.getViewport({ scale }), cv = document.createElement("canvas");
    cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
    return cv;
  },
  toBlob(cv, type, q) { return new Promise(r => cv.toBlob(r, type, q)); },

  /* ---------- fonts ---------- */
  FONTS: {
    helv: { label: "Arial / Helvetica", std: ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"], css: "Helvetica, Arial, sans-serif" },
    times: { label: "Times", std: ["Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"], css: "'Times New Roman', Times, serif" },
    cour: { label: "Courier", std: ["Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"], css: "'Courier New', monospace" },
    lato: { label: "Lato", files: ["Lato-Regular.ttf", "Lato-Bold.ttf"], css: "'PN Lato', sans-serif" },
    poppins: { label: "Poppins", files: ["Poppins-Regular.ttf", "Poppins-Bold.ttf"], css: "'PN Poppins', sans-serif" },
    ptserif: { label: "PT Serif", files: ["PTSerif-Regular.ttf", "PTSerif-Bold.ttf"], css: "'PN PTSerif', serif" },
    hind: { label: "Hind Siliguri (Bangla)", files: ["HindSiliguri-Regular.ttf", "HindSiliguri-Bold.ttf"], css: "'PN Hind', sans-serif", bangla: true },
    pacifico: { label: "Pacifico", files: ["Pacifico-Regular.ttf"], css: "'PN Pacifico', cursive" },
    greatvibes: { label: "Great Vibes (signature)", files: ["GreatVibes-Regular.ttf"], css: "'PN GreatVibes', cursive" },
    lobster: { label: "Lobster", files: ["Lobster-Regular.ttf"], css: "'PN Lobster', cursive" },
    anton: { label: "Anton (headline)", files: ["Anton-Regular.ttf"], css: "'PN Anton', sans-serif" },
  },
  _bytes: {},
  async fontBytes(file) {
    if (!C._bytes[file]) { const r = await fetch("fonts/" + file); if (!r.ok) throw new Error("font missing: " + file); C._bytes[file] = await r.arrayBuffer(); }
    return C._bytes[file];
  },
  /* make the browser load a bundled font so previews and canvas text can use it */
  async loadWeb(fam) {
    const f = C.FONTS[fam]; if (!f || !f.files) return;
    const name = f.css.split(",")[0].replace(/'/g, "");
    for (let i = 0; i < f.files.length; i++) {
      const key = name + i; if (C._web && C._web[key]) continue; (C._web = C._web || {})[key] = 1;
      const ff = new FontFace(name, `url(fonts/${f.files[i]})`, { weight: i === 1 ? "700" : "400" });
      document.fonts.add(ff); try { await ff.load(); } catch (e) { /* ignore */ }
    }
  },
  needsShaping(t) { return /[ऀ-෿]/.test(t); },
  /* Draw text. (X,Y) = top-left of the text box in y-down page units; rot = degrees clockwise around that corner. */
  async drawText(doc, page, o) {
    const H = page.getHeight(), size = o.size, fam = C.FONTS[o.fam] ? o.fam : "helv", def = C.FONTS[fam];
    const lines = String(o.text).split("\n"), lh = size * 1.2, op = o.opacity == null ? 1 : o.opacity;
    const rot = o.rot || 0, r = rot * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
    const at = (dx, dy) => [o.x + dx * cs - dy * sn, H - (o.y + dx * sn + dy * cs)]; // box offset -> pdf point
    let font = null;
    if (def.std) font = await doc.embedFont(def.std[(o.bold ? 1 : 0) + (o.italic ? 2 : 0)]);
    else if (def.files && !C.needsShaping(o.text) && !def.bangla) {
      doc.registerFontkit(fontkit);
      const f = def.files[o.bold && def.files[1] ? 1 : 0];
      try { font = await doc.embedFont(await C.fontBytes(f), { subset: true }); } catch (e) { font = null; }
    }
    const ok = font && (() => { try { for (const l of lines) font.encodeText(l); return true; } catch (e) { return false; } })();
    if (ok) {
      lines.forEach((l, i) => {
        const [px, py] = at(0, i * lh + size * 0.94);
        page.drawText(l, { x: px, y: py, size, font, color: C.hex(o.color), rotate: degrees(-rot), opacity: op });
      });
      return;
    }
    // picture of the text: correct joined Bangla letters and any font (not selectable in the PDF)
    await C.loadWeb(fam === "helv" || fam === "times" || fam === "cour" ? "hind" : fam);
    const css = (fam === "helv" || fam === "times" || fam === "cour") ? `${def.css}, 'PN Hind'` : def.css;
    const k = 4, cv = document.createElement("canvas"), g = cv.getContext("2d");
    const font1 = `${o.italic ? "italic " : ""}${o.bold ? "700 " : "400 "}${size * k}px ${css}`;
    g.font = font1; const w = Math.max(...lines.map(l => g.measureText(l).width)) + 4, h = lh * k * lines.length + 6;
    cv.width = Math.ceil(w); cv.height = Math.ceil(h); g.font = font1; g.fillStyle = o.color || "#000"; g.textBaseline = "alphabetic";
    lines.forEach((l, i) => g.fillText(l, 2, (i * lh + size * 0.94) * k));
    const png = await doc.embedPng(await (await C.toBlob(cv, "image/png")).arrayBuffer());
    const [px, py] = at(0, cv.height / k);
    page.drawImage(png, { x: px, y: py, width: cv.width / k, height: cv.height / k, rotate: degrees(-rot), opacity: op });
  },
  async imageToPng(file) { // any browser-readable image -> PNG bytes
    const bmp = await createImageBitmap(file), cv = document.createElement("canvas");
    cv.width = bmp.width; cv.height = bmp.height; cv.getContext("2d").drawImage(bmp, 0, 0);
    return await (await C.toBlob(cv, "image/png")).arrayBuffer();
  },
};
