/* The tools. run(files, options, progress) returns [{name, blob}] */
const PDF = ".pdf,application/pdf", IMG = "image/*";
const POS = [["bc", "Bottom centre"], ["br", "Bottom right"], ["bl", "Bottom left"], ["tc", "Top centre"], ["tr", "Top right"], ["tl", "Top left"]];
const MM = 72 / 25.4;

const TOOLS = [
  { id: "merge", cat: "Organize", icon: "🔗", name: "Merge PDF", desc: "Join several PDFs into one, in the order you choose.", accept: PDF, multi: true, order: true, min: 2,
    async run(files, o, prog) {
      const out = await PDFDocument.create();
      for (let i = 0; i < files.length; i++) {
        const src = await C.loadPdf(files[i]);
        (await out.copyPages(src, src.getPageIndices())).forEach(p => out.addPage(p));
        prog(i + 1, files.length);
      }
      return [{ name: "merged.pdf", blob: await C.pdfBlob(out) }];
    } },
  { id: "split", cat: "Organize", icon: "✂️", name: "Split PDF", desc: "Cut a PDF into several files by page ranges, or one file per page.", accept: PDF, multi: true,
    fields: [{ k: "mode", label: "How to split", type: "select", def: "ranges", options: [["ranges", "By ranges (one file per range)"], ["each", "Every page separately"], ["every", "Every N pages"]] },
      { k: "ranges", label: "Ranges", type: "text", def: "1-3,4-6", hint: "Example: 1-3,4-6,7", show: o => o.mode === "ranges" },
      { k: "n", label: "N pages per file", type: "number", def: 2, min: 1, show: o => o.mode === "every" }],
    async run(files, o, prog) {
      const res = [];
      for (let f = 0; f < files.length; f++) {
        const src = await C.loadPdf(files[f]), n = src.getPageCount(), b = C.base(files[f].name);
        let groups = [];
        if (o.mode === "each") groups = [...Array(n).keys()].map(i => [i]);
        else if (o.mode === "every") { const k = Math.max(1, +o.n || 1); for (let i = 0; i < n; i += k) groups.push([...Array(Math.min(k, n - i)).keys()].map(j => i + j)); }
        else groups = String(o.ranges).split(",").map(s => s.trim()).filter(Boolean).map(s => C.ranges(s, n));
        let i = 0;
        for (const g of groups) {
          const d = await PDFDocument.create(); (await d.copyPages(src, g)).forEach(p => d.addPage(p));
          i++; res.push({ name: `${b}-${groups.length > 1 ? i : "part"}.pdf`, blob: await C.pdfBlob(d) });
        }
        prog(f + 1, files.length);
      }
      return res;
    } },
  { id: "remove", cat: "Organize", icon: "🗑️", name: "Remove pages", desc: "Delete the pages you do not want.", accept: PDF, multi: true,
    fields: [{ k: "pages", label: "Pages to remove", type: "text", def: "", hint: "Example: 2,5-7" }],
    async run(files, o, prog) {
      const res = [];
      for (let f = 0; f < files.length; f++) {
        const d = await C.loadPdf(files[f]), n = d.getPageCount(), del = new Set(C.ranges(o.pages, n));
        if (!o.pages.trim()) throw new Error("Type the pages to remove");
        if (del.size >= n) throw new Error("You cannot remove every page");
        [...del].sort((a, b) => b - a).forEach(i => d.removePage(i));
        res.push({ name: `${C.base(files[f].name)}-edited.pdf`, blob: await C.pdfBlob(d) }); prog(f + 1, files.length);
      }
      return res;
    } },
  { id: "extract", cat: "Organize", icon: "📤", name: "Extract pages", desc: "Keep only the pages you pick, in the order you type them.", accept: PDF, multi: true,
    fields: [{ k: "pages", label: "Pages to keep", type: "text", def: "", hint: "Example: 1,3-5" }],
    async run(files, o, prog) {
      if (!o.pages.trim()) throw new Error("Type the pages to keep");
      const res = [];
      for (let f = 0; f < files.length; f++) {
        const src = await C.loadPdf(files[f]), d = await PDFDocument.create();
        (await d.copyPages(src, C.ranges(o.pages, src.getPageCount()))).forEach(p => d.addPage(p));
        res.push({ name: `${C.base(files[f].name)}-extract.pdf`, blob: await C.pdfBlob(d) }); prog(f + 1, files.length);
      }
      return res;
    } },
  { id: "organize", cat: "Organize", icon: "🗂️", name: "Organize pages", desc: "See every page, drag to reorder, turn or delete pages.", accept: PDF, multi: false, custom: "organize" },
  { id: "rotate", cat: "Organize", icon: "🔄", name: "Rotate PDF", desc: "Turn all pages or chosen pages.", accept: PDF, multi: true,
    fields: [{ k: "angle", label: "Turn", type: "select", def: "90", options: [["90", "90° clockwise"], ["180", "180°"], ["270", "90° anticlockwise"]] },
      { k: "pages", label: "Pages", type: "text", def: "all", hint: "all, or for example 1,3-5" }],
    async run(files, o, prog) {
      const res = [];
      for (let f = 0; f < files.length; f++) {
        const d = await C.loadPdf(files[f]), pg = d.getPages();
        C.ranges(o.pages, pg.length).forEach(i => pg[i].setRotation(degrees((pg[i].getRotation().angle + +o.angle) % 360)));
        res.push({ name: `${C.base(files[f].name)}-rotated.pdf`, blob: await C.pdfBlob(d) }); prog(f + 1, files.length);
      }
      return res;
    } },
  { id: "crop", cat: "Edit", icon: "📐", name: "Crop PDF", desc: "Trim the margins of every page.", accept: PDF, multi: true,
    fields: [["top", "Top"], ["right", "Right"], ["bottom", "Bottom"], ["left", "Left"]].map(([k, l]) => ({ k, label: l + " (mm)", type: "number", def: 10, min: 0 })),
    async run(files, o, prog) {
      const res = [];
      for (let f = 0; f < files.length; f++) {
        const d = await C.loadPdf(files[f]);
        for (const p of d.getPages()) {
          const b = p.getMediaBox(), t = o.top * MM, r = o.right * MM, bo = o.bottom * MM, l = o.left * MM;
          const w = b.width - l - r, h = b.height - t - bo;
          if (w < 20 || h < 20) throw new Error("The margins are bigger than the page");
          p.setCropBox(b.x + l, b.y + bo, w, h); p.setMediaBox(b.x + l, b.y + bo, w, h);
        }
        res.push({ name: `${C.base(files[f].name)}-cropped.pdf`, blob: await C.pdfBlob(d) }); prog(f + 1, files.length);
      }
      return res;
    } },
  { id: "pagenum", cat: "Edit", icon: "🔢", name: "Page numbers", desc: "Add page numbers to every page.", accept: PDF, multi: true,
    fields: [{ k: "pos", label: "Position", type: "select", def: "bc", options: POS },
      { k: "fmt", label: "Text", type: "text", def: "{n}", hint: "{n} = page, {t} = total. Example: Page {n} of {t}" },
      { k: "start", label: "First number", type: "number", def: 1 }, { k: "size", label: "Size", type: "number", def: 11, min: 6 },
      { k: "skip", label: "Skip the first page", type: "checkbox", def: false }, { k: "color", label: "Colour", type: "color", def: "#000000" }],
    async run(files, o, prog) {
      const res = [];
      for (let f = 0; f < files.length; f++) {
        const d = await C.loadPdf(files[f]), pg = d.getPages(), font = await d.embedFont(StandardFonts.Helvetica);
        for (let i = 0; i < pg.length; i++) {
          if (o.skip && i === 0) continue;
          const p = pg[i], { width: W, height: H } = p.getSize();
          const text = String(o.fmt).replace("{n}", +o.start + i - (o.skip ? 1 : 0)).replace("{t}", pg.length + (+o.start - 1) - (o.skip ? 1 : 0));
          const w = font.widthOfTextAtSize(text, +o.size), m = 28;
          const x = o.pos[1] === "l" ? m : o.pos[1] === "r" ? W - m - w : (W - w) / 2, y = o.pos[0] === "b" ? m : H - m - +o.size * 0.8;
          p.drawText(text, { x, y, size: +o.size, font, color: C.hex(o.color) });
        }
        res.push({ name: `${C.base(files[f].name)}-numbered.pdf`, blob: await C.pdfBlob(d) }); prog(f + 1, files.length);
      }
      return res;
    } },
  { id: "watermark", cat: "Edit", icon: "💧", name: "Watermark", desc: "Stamp text across every page. Bangla works too.", accept: PDF, multi: true,
    fields: [{ k: "text", label: "Text", type: "text", def: "CONFIDENTIAL" }, { k: "size", label: "Size", type: "number", def: 60, min: 8 },
      { k: "rot", label: "Angle (degrees)", type: "number", def: 45 }, { k: "opacity", label: "Opacity (10-100%)", type: "number", def: 25, min: 5, max: 100 },
      { k: "color", label: "Colour", type: "color", def: "#888888" }, { k: "fam", label: "Font", type: "fontselect", def: "helv" }],
    async run(files, o, prog) {
      if (!o.text.trim()) throw new Error("Type the watermark text");
      const res = [];
      for (let f = 0; f < files.length; f++) {
        const d = await C.loadPdf(files[f]);
        for (const p of d.getPages()) {
          const { width: W, height: H } = p.getSize(), size = +o.size, rot = +o.rot || 0;
          // place the centre of the text at the centre of the page: measure with a canvas
          const cv = document.createElement("canvas").getContext("2d"); await C.loadWeb(o.fam);
          cv.font = `700 ${size}px ${C.FONTS[o.fam].css}, 'PN Hind'`;
          const lines = o.text.split("\n"), w = Math.max(...lines.map(l => cv.measureText(l).width)), h = size * 1.2 * lines.length;
          const r = rot * Math.PI / 180, cx = W / 2, cy = H / 2;
          const x = cx - (w / 2) * Math.cos(r) + (h / 2) * Math.sin(r), y = cy - (w / 2) * Math.sin(r) - (h / 2) * Math.cos(r);
          await C.drawText(d, p, { text: o.text, x, y, size, color: o.color, fam: o.fam, bold: true, rot, opacity: Math.min(100, Math.max(5, +o.opacity)) / 100 });
        }
        res.push({ name: `${C.base(files[f].name)}-watermarked.pdf`, blob: await C.pdfBlob(d) }); prog(f + 1, files.length);
      }
      return res;
    } },
  { id: "jpg2pdf", cat: "Convert", icon: "🖼️", name: "Image to PDF", desc: "Turn JPG, PNG or other photos into a PDF.", accept: IMG, multi: true, order: true,
    fields: [{ k: "size", label: "Page size", type: "select", def: "fit", options: [["fit", "Same as the picture"], ["a4", "A4"], ["letter", "US Letter"]] },
      { k: "margin", label: "Margin (mm)", type: "number", def: 0, min: 0, show: o => o.size !== "fit" },
      { k: "one", label: "Put all pictures in one PDF", type: "checkbox", def: true }],
    async run(files, o, prog) {
      const mk = async (list) => {
        const d = await PDFDocument.create();
        for (const f of list) {
          let img; const buf = await C.read(f);
          if (/jpe?g$/i.test(f.type) || /\.jpe?g$/i.test(f.name)) img = await d.embedJpg(buf);
          else if (/png$/i.test(f.type) || /\.png$/i.test(f.name)) img = await d.embedPng(buf);
          else img = await d.embedPng(await C.imageToPng(f));
          let W = img.width, H = img.height, x = 0, y = 0, w = W, h = H;
          if (o.size !== "fit") {
            [W, H] = o.size === "a4" ? [595.28, 841.89] : [612, 792]; if (img.width > img.height) [W, H] = [H, W];
            const m = (+o.margin || 0) * MM, k = Math.min((W - 2 * m) / img.width, (H - 2 * m) / img.height);
            w = img.width * k; h = img.height * k; x = (W - w) / 2; y = (H - h) / 2;
          }
          d.addPage([W, H]).drawImage(img, { x, y, width: w, height: h });
        }
        return C.pdfBlob(d);
      };
      if (o.one) { const b = await mk(files); prog(1, 1); return [{ name: "images.pdf", blob: b }]; }
      const res = []; for (let i = 0; i < files.length; i++) { res.push({ name: C.base(files[i].name) + ".pdf", blob: await mk([files[i]]) }); prog(i + 1, files.length); }
      return res;
    } },
  { id: "pdf2jpg", cat: "Convert", icon: "📷", name: "PDF to JPG", desc: "Save every page as a picture.", accept: PDF, multi: true,
    fields: [{ k: "dpi", label: "Quality", type: "select", def: "150", options: [["96", "Screen (96 dpi)"], ["150", "Good (150 dpi)"], ["220", "High (220 dpi)"], ["300", "Print (300 dpi)"]] },
      { k: "fmt", label: "Format", type: "select", def: "jpg", options: [["jpg", "JPG"], ["png", "PNG"]] }, { k: "pages", label: "Pages", type: "text", def: "all" }],
    async run(files, o, prog) {
      const res = [];
      for (let f = 0; f < files.length; f++) {
        const doc = await C.openJs(files[f]), idx = C.ranges(o.pages, doc.numPages);
        for (let k = 0; k < idx.length; k++) {
          const cv = await C.canvasOf(await doc.getPage(idx[k] + 1), +o.dpi / 72);
          res.push({ name: `${C.base(files[f].name)}-page${idx[k] + 1}.${o.fmt}`, blob: await C.toBlob(cv, o.fmt === "png" ? "image/png" : "image/jpeg", 0.92) });
          cv.width = cv.height = 0; prog(f + k / idx.length, files.length);
        }
      }
      return res;
    } },
  { id: "pdf2text", cat: "Convert", icon: "📝", name: "PDF to text", desc: "Copy all the text of a PDF into a .txt file.", accept: PDF, multi: true,
    async run(files, o, prog) {
      const res = [];
      for (let f = 0; f < files.length; f++) {
        const doc = await C.openJs(files[f]); let out = "";
        for (let i = 1; i <= doc.numPages; i++) {
          const tc = await (await doc.getPage(i)).getTextContent(); let y = null;
          for (const it of tc.items) { if (y !== null && Math.abs(it.transform[5] - y) > 2) out += "\n"; out += it.str; y = it.transform[5]; }
          out += `\n\n--- page ${i} ---\n\n`;
        }
        res.push({ name: C.base(files[f].name) + ".txt", blob: new Blob([out], { type: "text/plain;charset=utf-8" }) }); prog(f + 1, files.length);
      }
      return res;
    } },
  { id: "compress", cat: "Optimize", icon: "🗜️", name: "Compress PDF", desc: "Make big PDFs smaller.", accept: PDF, multi: true,
    fields: [{ k: "mode", label: "Method", type: "select", def: "light", options: [["light", "Light: keeps text sharp, small saving"], ["strong", "Strong: pages become pictures, much smaller"]] },
      { k: "q", label: "Picture quality", type: "select", def: "0.6", options: [["0.8", "High"], ["0.6", "Medium"], ["0.4", "Low (smallest)"]], show: o => o.mode === "strong" }],
    async run(files, o, prog) {
      const res = [];
      for (let f = 0; f < files.length; f++) {
        let blob;
        if (o.mode === "light") { const d = await C.loadPdf(files[f]); blob = await C.pdfBlob(d); }
        else {
          const js = await C.openJs(files[f]), out = await PDFDocument.create();
          for (let i = 1; i <= js.numPages; i++) {
            const pg = await js.getPage(i), base = pg.getViewport({ scale: 1 }), cv = await C.canvasOf(pg, 1.4);
            const jpg = await out.embedJpg(await (await C.toBlob(cv, "image/jpeg", +o.q)).arrayBuffer());
            out.addPage([base.width, base.height]).drawImage(jpg, { x: 0, y: 0, width: base.width, height: base.height });
            cv.width = cv.height = 0; prog(f + i / js.numPages, files.length);
          }
          blob = await C.pdfBlob(out);
        }
        const before = files[f].size; if (blob.size >= before) blob = files[f];
        res.push({ name: `${C.base(files[f].name)}-compressed.pdf`, blob, note: `${C.mb(before)} → ${C.mb(blob.size)}` }); prog(f + 1, files.length);
      }
      return res;
    } },
  { id: "unlock", cat: "Optimize", icon: "🔓", name: "Unlock PDF", desc: "Remove editing and printing limits from a PDF (works when it opens without a password).", accept: PDF, multi: true,
    async run(files, o, prog) {
      const res = [];
      for (let f = 0; f < files.length; f++) {
        const d = await C.loadPdf(files[f], { ignoreEncryption: true });
        res.push({ name: `${C.base(files[f].name)}-unlocked.pdf`, blob: await C.pdfBlob(d) }); prog(f + 1, files.length);
      }
      return res;
    } },
  { id: "edit", cat: "Edit", icon: "✏️", name: "Edit PDF", desc: "Change text, add text, pictures, shapes and drawings.", href: "edit.html" },
  { id: "sign", cat: "Edit", icon: "✍️", name: "Sign PDF", desc: "Draw your signature and place it on the page.", href: "edit.html#sign" },
];
