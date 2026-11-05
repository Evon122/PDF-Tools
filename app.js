(function () {
  const $ = s => document.querySelector(s);
  const CATS = ["All", "Organize", "Edit", "Convert", "Optimize"];
  let cat = "All", tool = null, files = [], state = {};

  /* ---------- home ---------- */
  function drawHome() {
    const q = $("#q").value.trim().toLowerCase();
    $("#cats").innerHTML = CATS.map(c => `<button class="cat${c === cat ? " on" : ""}" data-c="${c}">${c}</button>`).join("");
    const list = TOOLS.filter(t => (cat === "All" || t.cat === cat) && (!q || (t.name + " " + t.desc).toLowerCase().includes(q)));
    $("#grid").innerHTML = list.map(t => `<a class="tile" href="${t.href || "#/" + t.id}"><div class="ico">${t.icon}</div><div><h3>${C.esc(t.name)}</h3><p>${C.esc(t.desc)}</p></div></a>`).join("") || "<p>No tool found.</p>";
  }
  $("#cats").onclick = e => { const b = e.target.closest("[data-c]"); if (b) { cat = b.dataset.c; drawHome(); } };
  $("#q").oninput = drawHome;

  /* ---------- routing ---------- */
  function route() {
    const id = (location.hash.match(/^#\/(.+)$/) || [])[1];
    tool = TOOLS.find(t => t.id === id && !t.href) || null;
    $("#home").classList.toggle("hide", !!tool); $("#work").classList.toggle("hide", !tool);
    if (!tool) { document.title = "PDFNova - Edit, Merge, Convert, Compress"; return; }
    document.title = tool.name + " - PDFNova"; files = []; state = {};
    $("#wt").textContent = tool.name; $("#wd").textContent = tool.desc;
    $("#dhint").textContent = (tool.multi ? "You can add many files at once. " : "One file. ") + (tool.accept === IMG ? "JPG, PNG and other pictures." : "PDF files.");
    $("#file").accept = tool.accept; $("#file").multiple = !!tool.multi;
    $("#extra").innerHTML = ""; $("#res").innerHTML = ""; $("#msg").textContent = ""; $("#bar").style.width = "0";
    drawFields(); drawFiles(); window.scrollTo(0, 0);
  }
  addEventListener("hashchange", route);

  /* ---------- options ---------- */
  function drawFields() {
    const host = $("#fields"), o = (state.o = state.o || {}); host.innerHTML = "";
    (tool.fields || []).forEach(f => { if (o[f.k] === undefined) o[f.k] = f.def; });
    (tool.fields || []).forEach(f => {
      if (f.show && !f.show(o)) return;
      const l = document.createElement("label"); l.className = "f" + (f.type === "checkbox" ? " chk" : "");
      let inp;
      if (f.type === "select" || f.type === "fontselect") {
        inp = document.createElement("select");
        const opts = f.type === "fontselect" ? Object.entries(C.FONTS).map(([k, v]) => [k, v.label]) : f.options;
        opts.forEach(([v, t]) => inp.add(new Option(t, v)));
      } else { inp = document.createElement("input"); inp.type = f.type; if (f.min != null) inp.min = f.min; if (f.max != null) inp.max = f.max; }
      if (f.type === "checkbox") inp.checked = !!o[f.k]; else inp.value = o[f.k];
      inp.onchange = inp.oninput = () => { o[f.k] = f.type === "checkbox" ? inp.checked : inp.value; if (f.type === "select" || f.type === "checkbox") drawFields(); };
      if (f.type === "checkbox") { l.append(inp, document.createTextNode(f.label)); }
      else { l.append(document.createTextNode(f.label), inp); }
      if (f.hint) { const h = document.createElement("span"); h.className = "hint"; h.textContent = f.hint; l.append(h); }
      host.append(l);
    });
  }

  /* ---------- files ---------- */
  function addFiles(list) {
    let add = [...list];
    if (tool.accept === IMG) add = add.filter(f => f.type.startsWith("image/") || /\.(jpe?g|png|gif|webp|bmp)$/i.test(f.name));
    else add = add.filter(f => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
    if (!add.length) { msg("Please choose " + (tool.accept === IMG ? "picture" : "PDF") + " files.", true); return; }
    if (!tool.multi) files = [];
    files.push(...add); msg(""); $("#res").innerHTML = ""; drawFiles();
    if (tool.custom === "organize") organizeLoad();
  }
  function drawFiles() {
    const ul = $("#files"); ul.innerHTML = "";
    files.forEach((f, i) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="nm">${C.esc(f.name)}</span><span class="sz">${C.mb(f.size)}</span>`;
      if (tool.order && files.length > 1) {
        const up = document.createElement("button"); up.textContent = "↑"; up.title = "Move up"; up.onclick = () => { if (i) { [files[i - 1], files[i]] = [files[i], files[i - 1]]; drawFiles(); } };
        const dn = document.createElement("button"); dn.textContent = "↓"; dn.title = "Move down"; dn.onclick = () => { if (i < files.length - 1) { [files[i + 1], files[i]] = [files[i], files[i + 1]]; drawFiles(); } };
        li.append(up, dn);
      }
      const x = document.createElement("button"); x.textContent = "✕"; x.title = "Remove"; x.onclick = () => { files.splice(i, 1); drawFiles(); if (tool.custom) { $("#extra").innerHTML = ""; state.pages = null; } };
      li.append(x); ul.append(li);
    });
    $("#opts").classList.toggle("hide", !files.length);
    $("#fields").classList.toggle("hide", !!tool.custom && !(tool.fields || []).length);
    $("#go").textContent = tool.custom === "organize" ? "Save organized PDF" : (tool.id === "merge" ? "Merge now" : "Start");
  }
  $("#pick").onclick = () => $("#file").click();
  $("#file").onchange = e => { addFiles(e.target.files); e.target.value = ""; };
  const drop = $("#drop");
  ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", e => addFiles(e.dataTransfer.files));
  addEventListener("dragover", e => e.preventDefault()); addEventListener("drop", e => { if (!e.target.closest || !e.target.closest("#drop")) e.preventDefault(); });

  function msg(t, err) { const m = $("#msg"); m.textContent = t; m.className = "msg" + (err ? " err" : t ? " ok" : ""); }

  /* ---------- organize ---------- */
  async function organizeLoad() {
    const host = $("#extra"); host.innerHTML = '<p class="hint">Loading pages...</p>';
    try {
      const doc = await C.openJs(files[0]); state.pages = [];
      host.innerHTML = '<p class="hint">Drag pages to reorder. Use ↻ to turn a page and ✕ to delete it.</p><div class="thumbs" id="th"></div>';
      for (let i = 1; i <= doc.numPages; i++) {
        const cv = await C.canvasOf(await doc.getPage(i), 0.28); state.pages.push({ i: i - 1, rot: 0, del: false, cv });
      }
      drawThumbs();
    } catch (e) { host.innerHTML = ""; msg("Could not read this PDF.", true); }
  }
  function drawThumbs() {
    const th = $("#th"); if (!th) return; th.innerHTML = "";
    state.pages.forEach((p, idx) => {
      const d = document.createElement("div"); d.className = "th" + (p.del ? " del" : ""); d.draggable = true;
      const c = document.createElement("canvas"); c.width = p.cv.width; c.height = p.cv.height; c.getContext("2d").drawImage(p.cv, 0, 0);
      c.style.transform = `rotate(${p.rot}deg)`; c.style.maxWidth = "100%";
      const box = document.createElement("div"); box.style.cssText = "height:150px;display:grid;place-items:center;overflow:hidden"; box.append(c); c.style.maxHeight = "140px"; c.style.width = "auto";
      const tb = document.createElement("div"); tb.className = "tb";
      const r = document.createElement("button"); r.textContent = "↻"; r.title = "Turn"; r.onclick = () => { p.rot = (p.rot + 90) % 360; drawThumbs(); };
      const x = document.createElement("button"); x.textContent = p.del ? "↶" : "✕"; x.title = p.del ? "Keep" : "Delete"; x.onclick = () => { p.del = !p.del; drawThumbs(); };
      const n = document.createElement("span"); n.className = "hint"; n.textContent = idx + 1;
      tb.append(r, x, n); d.append(box, tb);
      d.ondragstart = e => { e.dataTransfer.setData("text/plain", idx); d.style.opacity = .5; };
      d.ondragend = () => d.style.opacity = 1;
      d.ondragover = e => { e.preventDefault(); d.classList.add("over"); }; d.ondragleave = () => d.classList.remove("over");
      d.ondrop = e => { e.preventDefault(); const from = +e.dataTransfer.getData("text/plain"); if (isNaN(from) || from === idx) return; const [m] = state.pages.splice(from, 1); state.pages.splice(idx, 0, m); drawThumbs(); };
      th.append(d);
    });
  }
  async function organizeRun() {
    const keep = state.pages.filter(p => !p.del); if (!keep.length) throw new Error("You deleted every page");
    const src = await C.loadPdf(files[0]), out = await PDFDocument.create();
    const pgs = await out.copyPages(src, keep.map(p => p.i));
    pgs.forEach((p, k) => { if (keep[k].rot) p.setRotation(degrees((p.getRotation().angle + keep[k].rot) % 360)); out.addPage(p); });
    return [{ name: C.base(files[0].name) + "-organized.pdf", blob: await C.pdfBlob(out) }];
  }

  /* ---------- run ---------- */
  $("#go").onclick = async () => {
    if (!files.length) return;
    if (tool.min && files.length < tool.min) { msg(`Add at least ${tool.min} files.`, true); return; }
    const go = $("#go"); go.disabled = true; $("#res").innerHTML = ""; msg("Working...");
    const prog = (a, b) => $("#bar").style.width = Math.min(100, Math.round(a / b * 100)) + "%"; prog(0, 1);
    try {
      const res = tool.custom === "organize" ? await organizeRun() : await tool.run(files, state.o || {}, prog);
      prog(1, 1); showResults(res); msg(res.length > 1 ? `Done. ${res.length} files ready.` : "Done.");
    } catch (e) { console.error(e); msg(e.message || "Something went wrong.", true); $("#bar").style.width = "0"; }
    go.disabled = false;
  };
  function showResults(res) {
    const host = $("#res"); host.innerHTML = "";
    res.slice(0, 200).forEach(r => {
      const d = document.createElement("div"); d.className = "r";
      d.innerHTML = `<span>${C.esc(r.name)}${r.note ? " <em class='hint'>" + C.esc(r.note) + "</em>" : ""}</span>`;
      const b = document.createElement("button"); b.className = "btn sm"; b.textContent = "Download"; b.onclick = () => C.save(r.blob, r.name);
      d.append(b); host.append(d);
    });
    if (res.length > 1) {
      const b = document.createElement("button"); b.className = "btn red"; b.textContent = `Download all (${res.length}) as ZIP`;
      b.onclick = async () => C.save(await C.zip(res), "PDFNova-files.zip"); host.prepend(b);
    } else if (res.length === 1) C.save(res[0].blob, res[0].name);
  }

  drawHome(); route();
})();
