(() => {
  "use strict";

  /* ============================================================ helpers */
  const DEFAULTS = {
    dark: true,
    bgAttendance: false, // background page loads are opt-in, per page (they may log FLEX out)
    bgMarks: false,
    bgTranscript: false,
    voiceLang: "en-US",
    voiceMute: false,
    fillComments: true,
    comments: [
      "Great course overall, the instructor explained concepts clearly.",
      "Lectures were well organized and the pace was good.",
      "Helpful and approachable instructor. Enjoyed the course.",
      "Good course content and fair assessments.",
      "The instructor was supportive and the material was relevant.",
      "Overall a positive learning experience."
    ]
  };
  let settings = { ...DEFAULTS };

  const GP = {
    "A+": 4.0, "A": 4.0, "A-": 3.67, "B+": 3.33, "B": 3.0, "B-": 2.67,
    "C+": 2.33, "C": 2.0, "C-": 1.67, "D+": 1.33, "D": 1.0, "F": 0.0
  };
  const GRADES = Object.keys(GP);
  const CR_RE = /cr[a-z]*\.?\s*hrs?|credit/;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
  const num = (t) => {
    const m = String(t ?? "").replace(/,/g, "").match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : NaN;
  };
  const rand = (a) => a[Math.floor(Math.random() * a.length)];
  const fmt = (n) => (Math.round(n * 100) / 100).toString();
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const path = location.pathname.toLowerCase();

  const store = {
    get: (area, keys) => new Promise((r) => chrome.storage[area].get(keys, r)),
    set: (area, obj) => new Promise((r) => chrome.storage[area].set(obj, r))
  };

  /* ========================================================== DARK MODE */
  function parseRGBA(c) {
    const m = c && c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(parseFloat);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  const lum = ({ r, g, b }) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

  // Catches anything the stylesheet missed (inline white backgrounds, unknown class names).
  function darkenPass(root = document.body) {
    if (!root) return;
    const els = root.querySelectorAll("*");
    for (const el of els) {
      if (el.closest("#flexh-bar, #flexh-panel, .flexh-box, #flexh-notify, .flexh-banner, #flexh-toast")) continue;
      const tag = el.tagName;
      if (tag === "IMG" || tag === "SVG" || tag === "VIDEO" || tag === "CANVAS" || tag === "SCRIPT" || tag === "STYLE") continue;
      const cs = getComputedStyle(el);
      const bg = parseRGBA(cs.backgroundColor);
      if (bg && bg.a > 0.5 && lum(bg) > 0.72 && !el.dataset.flexhBg) {
        el.dataset.flexhBg = el.style.getPropertyValue("background-color") || "-";
        el.style.setProperty("background-color", lum(bg) > 0.95 ? "#121620" : "#1a2030", "important");
      }
      const col = parseRGBA(cs.color);
      const ownBg = parseRGBA(cs.backgroundColor);
      const coloredBg = ownBg && ownBg.a > 0.5 && lum(ownBg) > 0.12 && lum(ownBg) < 0.65 && !el.dataset.flexhBg;
      if (col && lum(col) < 0.42 && !coloredBg && !el.dataset.flexhFg) {
        el.dataset.flexhFg = el.style.getPropertyValue("color") || "-";
        el.style.setProperty("color", "#e8ebf3", "important");
      }
    }
  }
  function undarkenPass() {
    $$("[data-flexh-bg]").forEach((el) => {
      const o = el.dataset.flexhBg;
      o === "-" ? el.style.removeProperty("background-color") : el.style.setProperty("background-color", o);
      delete el.dataset.flexhBg;
    });
    $$("[data-flexh-fg]").forEach((el) => {
      const o = el.dataset.flexhFg;
      o === "-" ? el.style.removeProperty("color") : el.style.setProperty("color", o);
      delete el.dataset.flexhFg;
    });
  }
  let darkTimer;
  function applyDark() {
    document.documentElement.classList.toggle("flexh-dark", !!settings.dark);
    if (!document.body) return;
    clearTimeout(darkTimer);
    if (settings.dark) darkTimer = setTimeout(() => darkenPass(), 60);
    else undarkenPass();
  }
  async function loadSettings() {
    const saved = await store.get("sync", Object.keys(DEFAULTS));
    settings = { ...DEFAULTS, ...saved };
    applyDark();
  }
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "sync") return;
    for (const k in ch) settings[k] = ch[k].newValue;
    applyDark();
  });
  loadSettings(); // runs at document_start so there's no white flash

  /* ================================================================ UI */
  function toast(msg, ms = 3500) {
    $("#flexh-toast")?.remove();
    const t = document.createElement("div");
    t.id = "flexh-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }
  function openPanel(html) {
    closePanel();
    const p = document.createElement("div");
    p.id = "flexh-panel";
    p.innerHTML = `${html}<div style="margin-top:10px"><button type="button" class="flexh-sec" id="flexh-close">Close</button></div>`;
    document.body.appendChild(p);
    $("#flexh-close", p).onclick = closePanel;
    return p;
  }
  const closePanel = () => $("#flexh-panel")?.remove();

  /* Where to put big in-page widgets: just above the first table's card */
  function anchorFor(el) {
    return el.closest(".card, .m-portlet, .portlet, .box, .panel, .widget") || el;
  }

  /* ============================================== table/context helpers */
  function contextLabel(table) {
    const cap = $("caption", table);
    if (cap && txt(cap)) return txt(cap).slice(0, 60);
    let el = table;
    for (let d = 0; el && d < 6; d++, el = el.parentElement) {
      const head = el.querySelector && el.querySelector(":scope > .card-header, :scope > .m-portlet__head, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > .panel-heading");
      if (head && txt(head)) return txt(head).slice(0, 60);
      let s = el.previousElementSibling;
      for (let i = 0; s && i < 3; i++, s = s.previousElementSibling) {
        if (/^H[1-6]$/.test(s.tagName) || s.matches(".card-header, .m-portlet__head, .panel-heading")) return txt(s).slice(0, 60);
      }
    }
    return "";
  }
  function paneLabel(el) {
    const pane = el.closest(".tab-pane, [role=tabpanel]");
    if (pane && pane.id) {
      const doc = el.ownerDocument;
      const link = doc.querySelector(`a[href="#${CSS.escape(pane.id)}"], [data-target="#${CSS.escape(pane.id)}"], [aria-controls="${CSS.escape(pane.id)}"]`);
      if (link && txt(link)) return txt(link).slice(0, 70);
    }
    return "";
  }

  /* ================================================== MARKS (course total) */
  function headerMap(table) {
    const headRow = $("thead tr", table) || $("tr", table);
    if (!headRow) return null;
    const cells = $$("th, td", headRow).map((c) => txt(c).toLowerCase());
    const find = (re) => cells.findIndex((c) => re.test(c));
    const obtWeight = find(/obtained\s*weight|weighted\s*obt/);
    let weight = cells.findIndex((c) => /weight/.test(c) && !/obtain|average|avg|std|min|max/.test(c));
    const total = find(/total\s*marks|^total$|max/);
    const obtained = find(/obtained\s*marks|^obtained$|marks\s*obtained/);
    if (weight < 0 || (obtWeight < 0 && obtained < 0)) return null;
    return { headRow, map: { name: 0, weight, obtWeight, total, obtained } };
  }

  // Returns {w, got, items} counting only rows that already have marks.
  function analyseCategory(table) {
    const h = headerMap(table);
    if (!h) return null;
    const { map, headRow } = h;
    const rows = $$("tr", table).filter((r) => r !== headRow && $$("td", r).length > 1);
    let w = 0, got = 0, items = 0, totalRow = null;

    for (const r of rows) {
      const c = $$("td", r);
      const label = txt(c[map.name]).toLowerCase();
      if (r.classList.contains("flexh-summary")) continue;
      if (/grand\s*total|^total\b|^sum\b|^overall/.test(label) || /total/i.test(r.className)) { totalRow = c; continue; }

      const wt = num(txt(c[map.weight]));
      if (isNaN(wt)) continue;
      let g = NaN;
      if (map.obtWeight >= 0) g = num(txt(c[map.obtWeight]));
      if (isNaN(g) && map.obtained >= 0 && map.total >= 0) {
        const ob = num(txt(c[map.obtained])), tot = num(txt(c[map.total]));
        if (!isNaN(ob) && !isNaN(tot) && tot > 0) g = (ob / tot) * wt;
      }
      if (isNaN(g)) continue; // not graded yet
      w += wt; got += g; items++;
    }
    // Fallback: no graded item rows parsed, but the category has a total row with numbers
    if (!items && totalRow) {
      const tw = num(txt(totalRow[map.weight]));
      const tg = map.obtWeight >= 0 ? num(txt(totalRow[map.obtWeight])) : NaN;
      if (!isNaN(tw) && !isNaN(tg)) { w = tw; got = tg; items = 1; }
    }
    return items ? { w, got, items, table } : null;
  }

  function groupTables(tables) {
    if (!tables.length) return [];
    let a = tables[0].parentElement;
    while (a && !tables.every((t) => a.contains(t))) a = a.parentElement;
    const kidsOf = (el) => Array.from(el.children).filter((k) => tables.some((t) => k.contains(t)));
    while (a) {
      const kids = kidsOf(a);
      if (kids.length === 1 && !tables.includes(kids[0])) a = kids[0]; else break;
    }
    const kids = kidsOf(a);
    const groups = kids.map((k) => ({ el: k, tables: tables.filter((t) => k.contains(t)) }));
    // every child holds exactly one table => those are categories of one course, not separate courses
    const inPanes = groups.every((g) => g.tables[0].closest(".tab-pane, [role=tabpanel]"));
    if (groups.length > 1 && !inPanes && groups.every((g) => g.tables.length === 1)) return [{ el: a, tables, merged: true }];
    return groups;
  }

  function runMarks() {
    $$(".flexh-banner").forEach((b) => b.remove());
    const cats = $$("table").map(analyseCategory).filter(Boolean);
    if (!cats.length) return false;

    const groups = groupTables(cats.map((c) => c.table));
    groups.forEach((g, i) => {
      const mine = cats.filter((c) => g.tables.includes(c.table));
      const w = mine.reduce((s, c) => s + c.w, 0);
      const got = mine.reduce((s, c) => s + c.got, 0);
      if (!mine.length) return;
      const title = paneLabel(g.tables[0]) || (groups.length > 1 ? `Course ${i + 1}` : "All graded work");
      const pct = w ? (got / w) * 100 : 0;
      const b = document.createElement("div");
      b.className = "flexh-banner";
      b.innerHTML = `
        <div><div class="flexh-muted">${esc(title)} &mdash; marks so far</div>
             <span class="flexh-num">${fmt(got)} / ${fmt(w)}</span>
             <span class="flexh-muted"> &nbsp;${fmt(pct)}% &middot; ${mine.length} graded categor${mine.length === 1 ? "y" : "ies"}</span></div>
        <div class="flexh-bar"><i style="width:${Math.min(100, pct)}%"></i></div>`;
      if (g.merged) anchorFor(g.tables[0]).before(b);
      else g.el.insertBefore(b, g.el.firstChild);
    });
    return true;
  }

  /* ============================================ TRANSCRIPT GPA PLANNER */
  function readTranscriptTables(doc = document) {
    const sems = [];
    $$("table", doc).forEach((t) => {
      const headRow = $("thead tr", t) || $("tr", t);
      if (!headRow) return;
      const cells = $$("th, td", headRow).map((c) => txt(c).toLowerCase());
      const iCr = cells.findIndex((c) => CR_RE.test(c));
      const iGr = cells.findIndex((c) => /^grade$|^grd$|letter\s*grade/.test(c));
      if (iCr < 0 || iGr < 0) return;
      const iCode = cells.findIndex((c) => /code/.test(c));
      const iName = cells.findIndex((c) => /course\s*(title|name)|^course$|^title$|^name$/.test(c));
      const courses = [];
      $$("tr", t).forEach((r) => {
        if (r === headRow) return;
        const c = $$("td", r);
        if (c.length <= Math.max(iCr, iGr)) return;
        const cr = num(txt(c[iCr]));
        if (isNaN(cr) || cr <= 0) return;
        const grade = txt(c[iGr]).toUpperCase().replace(/\s/g, "");
        if (!(grade in GP) && grade !== "" && grade !== "I" && grade !== "-") return; // W, S, P etc: ignore
        courses.push({
          code: iCode >= 0 ? txt(c[iCode]) : "",
          name: txt(c[iName >= 0 ? iName : iCode >= 0 ? iCode : 0]).slice(0, 90),
          credits: cr,
          grade: grade in GP ? grade : "",
          done: grade in GP
        });
      });
      if (courses.length) sems.push({ label: `Semester ${sems.length + 1}`, courses });
    });
    return sems;
  }

  async function currentCoursesFromOtherPages(links) {
    // Try Attendance page, which usually lists current courses (and sometimes credits)
    const url = links.attendance;
    if (!url || !settings.bgAttendance) return []; // no background requests unless opted in
    try {
      const html = await (await fetch(url, { credentials: "include" })).text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const out = [];
      $$("table", doc).forEach((t) => {
        const headRow = $("thead tr", t) || $("tr", t);
        if (!headRow) return;
        const cells = $$("th, td", headRow).map((c) => txt(c).toLowerCase());
        const iCode = cells.findIndex((c) => /code/.test(c));
        const iName = cells.findIndex((c) => /course\s*(title|name)|^course$|^title$|^name$/.test(c));
        const iCr = cells.findIndex((c) => CR_RE.test(c));
        if (iName < 0 && iCode < 0) return;
        $$("tr", t).forEach((r) => {
          if (r === headRow) return;
          const c = $$("td", r);
          if (c.length < 2) return;
          const name = txt(c[iName >= 0 ? iName : iCode]);
          if (!name) return;
          out.push({ code: iCode >= 0 ? txt(c[iCode]) : "", name: name.slice(0, 48), credits: iCr >= 0 ? num(txt(c[iCr])) || 3 : 3, grade: "A", done: false, guess: iCr < 0 });
        });
      });
      return out;
    } catch { return []; }
  }

  async function buildGpaPlanner() {
    if ($("#flexh-gpa")) return;
    const sems = readTranscriptTables();
    if (!sems.length) return;
    const nm = {};
    sems.forEach((sm) => sm.courses.forEach((c) => { if (c.code && c.name) nm[c.code.toUpperCase()] = c.name; }));
    COURSE_NAMES = { ...COURSE_NAMES, ...nm };
    store.set("local", { courseNames: COURSE_NAMES });

    // split into finished vs in-progress
    const finished = new Map(); // dedupe retakes by code (latest wins)
    const prevSems = [];
    let current = [];
    sems.forEach((s) => {
      const done = s.courses.filter((c) => c.done);
      const open = s.courses.filter((c) => !c.done);
      if (done.length) {
        let pts = 0, cr = 0;
        done.forEach((c) => { pts += c.credits * GP[c.grade]; cr += c.credits; });
        prevSems.push({ label: s.label, sgpa: cr ? pts / cr : 0, cr });
        done.forEach((c, i) => finished.set(c.code || `${s.label}#${i}`, c));
      }
      current.push(...open);
    });

    const links = DEFAULT_LINKS;
    if (!current.length) current = await currentCoursesFromOtherPages(links);
    if (!current.length) current = [{ code: "", name: "", credits: 3, grade: "A", done: false }];

    let prevPts = 0, prevCr = 0;
    finished.forEach((c) => { prevPts += c.credits * GP[c.grade]; prevCr += c.credits; });
    const shownCg = (document.body.innerText.match(/CGPA\s*[:=\-]?\s*(\d\.\d{1,2})/gi) || []).pop();

    const box = document.createElement("div");
    box.id = "flexh-gpa";
    box.className = "flexh-box";
    const gOpts = (sel) => GRADES.map((g) => `<option ${g === sel ? "selected" : ""}>${g}</option>`).join("");
    const rowHtml = (c) => `
      <tr data-code="${esc(c.code)}">
        <td><input class="fh-name" style="width:100%" placeholder="Course" value="${esc(c.name)}"></td>
        <td><input class="fh-cr" type="number" min="0" step="0.5" style="width:60px" value="${c.credits}"></td>
        <td><select class="fh-gr">${gOpts(c.grade || "A")}</select></td>
        <td><button type="button" class="flexh-sec fh-del" title="Remove">✕</button></td>
      </tr>`;

    box.innerHTML = `
      <h3>🎯 GPA Planner</h3>
      <div class="flexh-muted">Your finished semesters (from this transcript):</div>
      <div>${prevSems.map((s) => `<span class="flexh-chip">${esc(s.label)}: <b>${s.sgpa.toFixed(2)}</b></span>`).join("") || "<i>none found</i>"}</div>
      <div class="flexh-muted" style="margin-top:6px">Completed credits: <b>${fmt(prevCr)}</b> &middot; CGPA computed from grades: <b>${prevCr ? (prevPts / prevCr).toFixed(2) : "-"}</b>${shownCg ? ` &middot; transcript shows: <b>${esc(shownCg.replace(/\s+/g, " "))}</b>` : ""}</div>
      <hr style="border:0;border-top:1px solid var(--u-border);margin:12px 0">
      <div><b>This semester</b> — pick the grade you expect in each course</div>
      <table id="fh-table"><tr><th>Course</th><th>Cr.</th><th>Expected grade</th><th></th></tr>${current.map(rowHtml).join("")}</table>
      <button type="button" id="fh-add">+ Add course</button>
      <button type="button" class="flexh-sec" id="fh-all">Set all to…</button>
      <select id="fh-allsel">${gOpts("A")}</select>
      <div class="flexh-results" id="fh-out"></div>
      ${current.some((c) => c.guess) ? '<div class="flexh-muted" style="margin-top:6px">Credit hours weren\'t found on the page, so 3 is assumed — adjust if needed.</div>' : ""}`;

    const first = $$("table").find((t) => headerMapTranscript(t));
    const anchor = first ? anchorFor(first) : null;
    if (anchor) anchor.before(box); else (document.querySelector(".content, main, .container, body") || document.body).prepend(box);

    const table = $("#fh-table", box);
    const calc = () => {
      let pts = 0, cr = 0, oldPts = 0, oldCr = 0;
      $$("tr", table).slice(1).forEach((tr) => {
        const c = parseFloat($(".fh-cr", tr).value);
        const g = $(".fh-gr", tr).value;
        if (!(c > 0)) return;
        pts += c * GP[g]; cr += c;
        const code = tr.dataset.code; // retake: drop the old grade from the cumulative
        if (code && finished.has(code)) { const o = finished.get(code); oldPts += o.credits * GP[o.grade]; oldCr += o.credits; }
      });
      const sgpa = cr ? pts / cr : 0;
      const totCr = prevCr - oldCr + cr;
      const cgpa = totCr ? (prevPts - oldPts + pts) / totCr : 0;
      $("#fh-out", box).innerHTML = `
        <div><div class="flexh-muted">Expected SGPA</div><div class="flexh-big">${sgpa.toFixed(2)}</div></div>
        <div><div class="flexh-muted">Expected CGPA</div><div class="flexh-big">${cgpa.toFixed(2)}</div></div>
        <div><div class="flexh-muted">Total credits</div><div class="flexh-big">${fmt(totCr)}</div></div>`;
    };
    box.addEventListener("input", calc);
    box.addEventListener("change", calc);
    box.addEventListener("click", (e) => {
      if (e.target.id === "fh-add") { table.insertAdjacentHTML("beforeend", rowHtml({ code: "", name: "", credits: 3, grade: "A" })); calc(); }
      else if (e.target.classList.contains("fh-del")) { e.target.closest("tr").remove(); calc(); }
      else if (e.target.id === "fh-all") { const v = $("#fh-allsel", box).value; $$(".fh-gr", table).forEach((s) => (s.value = v)); calc(); }
    });
    calc();
  }
  const headerMapTranscript = (t) => {
    const r = $("thead tr", t) || $("tr", t);
    if (!r) return false;
    const c = $$("th, td", r).map((x) => txt(x).toLowerCase());
    return c.some((x) => CR_RE.test(x)) && c.some((x) => /^grade$|^grd$|letter/.test(x));
  };

  /* ====================================================== FEEDBACK BOT */
  function labelFor(input) {
    if (input.id) { const l = $(`label[for="${CSS.escape(input.id)}"]`); if (l) return txt(l); }
    const wrap = input.closest("label");
    if (wrap) return txt(wrap);
    const s = input.nextSibling;
    if (s && s.textContent && s.textContent.trim()) return s.textContent.trim();
    return input.title || input.value || "";
  }
  function radioGroups() {
    const g = new Map();
    $$('input[type="radio"]').forEach((r) => {
      if (!r.name || r.disabled || r.closest("#flexh-panel, .flexh-box")) return;
      if (!g.has(r.name)) g.set(r.name, []);
      g.get(r.name).push(r);
    });
    return Array.from(g.values());
  }
  const hasFeedbackForm = () => radioGroups().length >= 3;

  function setNative(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function choose(radio) {
    radio.checked = true;
    radio.click();
    radio.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // mode: "random" | "label:<text>" | "index:<n>"
  function fillFeedback(mode, withComments) {
    const groups = radioGroups();
    let n = 0;
    groups.forEach((inputs) => {
      let pick;
      if (mode === "random") pick = rand(inputs);
      else {
        const [lab, idx, max] = mode.slice(6).split("|");
        pick = inputs.find((i) => labelFor(i).toLowerCase() === lab.toLowerCase())
            || inputs[Math.min(inputs.length - 1, Math.round((Number(idx) / Math.max(1, Number(max))) * (inputs.length - 1)))];
      }
      if (pick) { choose(pick); n++; }
    });
    // dropdowns: same idea
    $$("select").forEach((sel) => {
      if (sel.disabled || sel.closest("#flexh-panel, .flexh-box")) return;
      const opts = Array.from(sel.options).filter((o) => o.value !== "" && !/^\s*(select|choose|--)/i.test(o.text));
      if (opts.length < 2 || opts.length > 12) return;
      let o;
      if (mode === "random") o = rand(opts);
      else o = opts.find((x) => x.text.trim().toLowerCase() === mode.slice(6).split("|")[0].toLowerCase()) || opts[0];
      sel.value = o.value; sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    let cm = 0;
    if (withComments) {
      $$("textarea").forEach((ta) => {
        if (ta.disabled || ta.readOnly || ta.value.trim() || ta.closest("#flexh-panel, .flexh-box")) return;
        setNative(ta, rand(settings.comments)); cm++;
      });
    }
    toast(`🤖 Filled ${n} questions${cm ? ` and ${cm} comment box(es)` : ""}. Review, then submit yourself.`);
  }

  function buildFeedbackBot() {
    if ($("#flexh-bot") || !hasFeedbackForm()) return;
    const groups = radioGroups();
    const sample = groups.reduce((a, b) => (b.length > a.length ? b : a), groups[0]);
    const labels = sample.map(labelFor).filter(Boolean);
    const box = document.createElement("div");
    box.id = "flexh-bot";
    box.className = "flexh-box";
    box.innerHTML = `
      <h3>🤖 Feedback Bot</h3>
      <div class="flexh-muted">Choose how to answer every question, then click Fill. It never submits for you.</div>
      <div style="margin:10px 0">
        <select id="fb-mode" style="min-width:230px">
          <option value="random">🎲 Random answer for each question</option>
          ${labels.map((l, i) => `<option value="label:${esc(l)}|${i}|${labels.length - 1}">Everything: ${esc(l)}</option>`).join("")}
        </select>
        <label style="margin-left:8px"><input type="checkbox" id="fb-comments" ${settings.fillComments ? "checked" : ""}> fill comment boxes</label>
      </div>
      <button type="button" id="fb-go">Fill all questions</button>
      <button type="button" class="flexh-sec" id="fb-again">🎲 Re-roll random</button>`;
    const first = anchorFor(groups[0][0].closest("table, .card, form") || groups[0][0]);
    first.before(box);
    $("#fb-go", box).onclick = () => fillFeedback($("#fb-mode", box).value, $("#fb-comments", box).checked);
    $("#fb-again", box).onclick = () => { $("#fb-mode", box).value = "random"; fillFeedback("random", $("#fb-comments", box).checked); };
  }

  /* ========================================================= NOTIFICATIONS */
  const PAGES = { marks: /marks/i, attendance: /attendance/i, transcript: /transcript/i };

  function discoverLinks() {
    const out = {};
    $$("a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript")) return;
      let u; try { u = new URL(href, location.href); } catch { return; }
      if (u.origin !== location.origin) return;
      const t = txt(a);
      for (const k in PAGES) if (!out[k] && PAGES[k].test(t) && t.length < 40) out[k] = u.href;
    });
    return out;
  }

  const DEFAULT_LINKS = {
    marks: location.origin + "/Student/StudentMarks",
    attendance: location.origin + "/Student/StudentAttendance",
    transcript: location.origin + "/Student/Transcript"
  };
  const STAT_COL = /average|avg|standard|deviation|std|minimum|maximum|^min$|^max$|class/i;

  function snapshotDoc(doc) {
    const snap = {};
    $$("table", doc).forEach((t) => {
      const ctx = [paneLabel(t), contextLabel(t)].filter(Boolean).join(" / ");
      if (/grand\s*total/i.test(ctx) || t.closest("#flexh-panel, .flexh-box, #flexh-notify")) return;
      const headRow = $("thead tr", t) || $("tr", t);
      if (!headRow) return;
      const heads = $$("th, td", headRow).map((c) => txt(c));
      const keep = heads.map((h, i) => (STAT_COL.test(h) ? -1 : i)).filter((i) => i >= 0);
      const seen = {};
      $$("tr", t).forEach((r) => {
        if (r === headRow) return;
        const all = $$("td", r).map((x) => txt(x));
        if (all.length < 2 || all.every((x) => !x) || /^total$/i.test(all[0])) return;
        const c = keep.map((i) => all[i] ?? "");
        let key = `${ctx}›${c[0]}`;
        seen[key] = (seen[key] || 0) + 1;
        if (seen[key] > 1) key += `#${seen[key]}`;
        snap[key] = { ctx, h: keep.map((i) => heads[i]), r: c };
      });
    });
    return snap;
  }

  const same = (a, b) => JSON.stringify(a.r) === JSON.stringify(b.r);
  function describe(page, it, old) {
    const parts = it.ctx.split(" / ");
    const course = parts[0] || "";
    const cat = parts[1] || "";
    const col = (re) => it.h.findIndex((h) => re.test(h));
    const g = (re, o = it) => { const i = col(re); return i >= 0 ? o.r[i] : ""; };
    if (page === "marks") {
      const m = (o) => `${g(/obtained/i, o)}/${g(/total/i, o)}`;
      const base = `${course} · ${cat} #${it.r[0]}`;
      return old ? `${base}: ${m(old)} → ${m(it)} (weightage ${g(/weight/i)})` : `${base}: ${m(it)} (weightage ${g(/weight/i)})`;
    }
    if (page === "attendance") {
      const pr = (v) => (v === "P" ? "Present" : v === "A" ? "Absent" : v);
      const p = (o) => pr(g(/presence/i, o));
      const base = `${course}: lecture ${it.r[0]} (${g(/date/i)})`;
      return old ? `${base}: ${p(old)} → ${p(it)}` : `${base} marked ${p(it)}`;
    }
    return `${it.ctx}: ${it.r.join(" | ")}`;
  }

  function diffSnap(oldS, newS, page) {
    const items = [];
    for (const k in newS) {
      if (!(k in oldS)) items.push({ page, kind: "New", text: describe(page, newS[k]) });
      else if (!same(oldS[k], newS[k])) items.push({ page, kind: "Changed", text: describe(page, newS[k], oldS[k]) });
    }
    return items;
  }

  let checking = false;
  async function checkUpdates(force, silent) {
    if (checking) return;
    const order = ["attendance", "marks", "transcript"].filter((p) => settings["bg" + p[0].toUpperCase() + p.slice(1)]);
    if (!order.length) { if (force && !silent) toast("Background checking is off. Turn pages on in the extension popup."); return; }
    const data = await store.get("local", ["snaps2", "notifs", "lastBg", "tracked"]);
    if (!force && Date.now() - (data.lastBg || 0) < 5 * 60 * 1000) return;
    const links = { ...discoverLinks(), ...DEFAULT_LINKS };
    checking = true;
    const snaps = data.snaps2 || {};
    let notifs = data.notifs || [];
    const tracked = {};
    let baselineOnly = false;
    try {
      for (const page of order) {
        await new Promise((r) => setTimeout(r, 1500));
        let res;
        try { res = await fetch(links[page], { credentials: "include", redirect: "manual", cache: "no-store" }); } catch { continue; }
        const bounced = res.type === "opaqueredirect" || res.status === 0 || (res.status >= 300 && res.status < 400) || /login/i.test(res.url);
        const html = bounced ? "" : await res.text();
        if (bounced || /type=["']password["']/i.test(html)) {
          await store.set("sync", { bgAttendance: false, bgMarks: false, bgTranscript: false });
          toast("FLEX asked to log in, so FLEX Helper switched background checking off.", 6000);
          break;
        }
        if (!res.ok) continue;
        const doc = new DOMParser().parseFromString(html, "text/html");
        const snap = snapshotDoc(doc);
        const count = Object.keys(snap).length;
        if (!count) continue;
        tracked[page] = count;
        if (snaps[page]) {
          diffSnap(snaps[page], snap, page).forEach((i) => notifs.unshift({ ...i, t: Date.now(), id: Math.random().toString(36).slice(2) }));
        } else baselineOnly = true;
        snaps[page] = snap;
      }
      notifs = notifs.slice(0, 80);
      await store.set("local", { snaps2: snaps, notifs, lastCheck: Date.now(), lastBg: Date.now(), tracked: { ...(data.tracked || {}), ...tracked, baseline: baselineOnly } });
      if (force && !silent) toast(baselineOnly ? "Tracking started. You'll see changes from now on." : "Checked for updates.");
    } finally { checking = false; }
    renderNotify();
    updateBadge();
  }

  // Passive mode: record what the user's own page view already shows. No extra requests.
  async function passiveRecord() {
    const page = Object.keys(DEFAULT_LINKS).find((k) => new URL(DEFAULT_LINKS[k]).pathname.toLowerCase() === location.pathname.toLowerCase().replace(/\/$/, ""));
    if (!page) return;
    const data = await store.get("local", ["snaps2", "notifs", "tracked"]);
    const snap = snapshotDoc(document);
    const count = Object.keys(snap).length;
    if (!count) return;
    const snaps = data.snaps2 || {};
    const notifs = data.notifs || [];
    let baseline = false;
    if (snaps[page]) diffSnap(snaps[page], snap, page).forEach((i) => notifs.unshift({ ...i, t: Date.now(), id: Math.random().toString(36).slice(2) }));
    else baseline = true;
    snaps[page] = snap;
    await store.set("local", { snaps2: snaps, notifs: notifs.slice(0, 80), lastCheck: Date.now(), tracked: { ...(data.tracked || {}), [page]: count, baseline: baseline && !(data.tracked || {}).baseline ? true : (data.tracked || {}).baseline } });
    updateBadge();
  }

  async function getNotifs() { return (await store.get("local", ["notifs"])).notifs || []; }
  const isHome = () => /^\/?(student\/?)?(home|dashboard|index)?\/?$/i.test(location.pathname) || /\/home\b|dashboard/.test(path);

  async function renderNotify() {
    $("#flexh-notify")?.remove();
    if (!isHome()) return;
    const items = (await getNotifs()).filter((n) => !n.read);
    const div = document.createElement("div");
    div.id = "flexh-notify";
    const st = await store.get("local", ["tracked", "lastCheck"]);
    const tr = st.tracked || {};
    const status = tr.marks || tr.attendance || tr.transcript
      ? `Watching marks (${tr.marks || 0} rows), attendance (${tr.attendance || 0}), transcript (${tr.transcript || 0}) · checked ${new Date(st.lastCheck).toLocaleTimeString()}`
      : "Open your Marks and Attendance pages once so I can start tracking.";
    if (!items.length) {
      div.innerHTML = `<b>🔔 FLEX Helper</b> <span class="flexh-muted">&nbsp;${tr.baseline ? "Tracking started. Anything new on Marks, Attendance or Transcript will show here after you next visit those pages." : "Nothing new since your last visit."}</span>
        <div class="flexh-muted" style="margin-top:4px">${esc(status)}</div> <button type="button" class="flexh-sec" id="fn-check">Check now</button>`;
    } else {
      const tag = { marks: "Marks", attendance: "Attendance", transcript: "Transcript" };
      div.innerHTML = `<b>🔔 ${items.length} new update${items.length > 1 ? "s" : ""}</b>
        <ul>${items.slice(0, 12).map((n) => `<li><span class="flexh-tag">${tag[n.page] || n.page}</span>${esc(n.text).slice(0, 240)}</li>`).join("")}</ul>
        ${items.length > 12 ? `<div class="flexh-muted">…and ${items.length - 12} more</div>` : ""}
        <div class="flexh-muted">${esc(status)}</div>
        <button type="button" id="fn-read">Mark all read</button> <button type="button" class="flexh-sec" id="fn-check">Check now</button>`;
    }
    const ft = $$("table").find((t) => !t.closest("#flexh-notify, .flexh-box"));
    const host = document.querySelector(".content-wrapper, .page-content, .content, main, .container-fluid, .container") || document.body;
    if (ft) anchorFor(ft).before(div); else host.insertBefore(div, host.firstChild);
    $("#fn-read", div)?.addEventListener("click", async () => {
      const all = await getNotifs();
      await store.set("local", { notifs: all.map((n) => ({ ...n, read: true })) });
      renderNotify(); updateBadge();
    });
    $("#fn-check", div)?.addEventListener("click", () => checkUpdates(true));
  }

  async function updateBadge() {
    const n = (await getNotifs()).filter((x) => !x.read).length;
    const b = $("#fh-bell");
    if (!b) return;
    $(".flexh-count", b)?.remove();
    if (n) { const s = document.createElement("span"); s.className = "flexh-count"; s.textContent = n; b.appendChild(s); }
  }

  /* ============================================================= TOOLBAR */
  function buildBar() {
    if ($("#flexh-bar") || !document.body) return;
    const bar = document.createElement("div");
    bar.id = "flexh-bar";
    const mk = (label, fn, title, id) => {
      const b = document.createElement("button"); b.type = "button";
      b.textContent = label; b.title = title; if (id) b.id = id; b.onclick = fn;
      bar.appendChild(b);
    };
    mk("🌙", () => { settings.dark = !settings.dark; applyDark(); store.set("sync", { dark: settings.dark }); }, "Toggle dark mode");
    mk("🔔", async () => {
      const items = await getNotifs();
      const tag = { marks: "Marks", attendance: "Attendance", transcript: "Transcript" };
      const p = openPanel(`<h3>🔔 Recent updates</h3>${items.length ? `<ul style="padding-left:18px">${items.slice(0, 25).map((n) =>
        `<li style="margin:4px 0"><b>${tag[n.page] || n.page}</b> &middot; ${esc(n.text).slice(0, 200)}<div class="flexh-muted">${new Date(n.t).toLocaleString()}</div></li>`).join("")}</ul>` : '<p class="flexh-muted">Nothing yet. Updates appear when something changes between checks.</p>'}
        <button type="button" id="fh-chk">Check now</button> <button type="button" class="flexh-sec" id="fh-mark">Mark all read</button>`);
      $("#fh-chk", p).onclick = () => { closePanel(); checkUpdates(true); };
      $("#fh-mark", p).onclick = async () => { await store.set("local", { notifs: items.map((n) => ({ ...n, read: true })) }); closePanel(); renderNotify(); updateBadge(); };
    }, "Updates", "fh-bell");
    mk("🎤", toggleVoice, "Voice assistant (Alt+V)", "fh-mic");
    mk("🧩", () => {
      const sk = $$("table").slice(0, 12).map((t, i) => `#${i} ctx=[${paneLabel(t)} / ${contextLabel(t)}]\n` +
        $$("tr", t).slice(0, 6).map((r) => $$("th,td", r).map(txt).join(" | ")).join("\n")).join("\n\n");
      navigator.clipboard?.writeText(`URL: ${location.pathname}\n\n${sk}`).then(() => toast("Page structure copied. Paste it to Claude if something looks wrong."), () => toast("Couldn't copy."));
    }, "Copy page structure (for debugging)");
    document.body.appendChild(bar);
    updateBadge();
  }

  /* ================================================================ VOICE */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const V = { rec: null, on: false, speaking: false, confirm: null };
  const LANGS = ["en-US", "en-IN", "ur-PK"];
  const LANG_NAMES = { "en-US": "English (US)", "en-IN": "English (India/Pakistan accent)", "ur-PK": "اردو" };
  // Urdu (script) and Roman-Urdu words, mapped onto the English command words.
  // Matched on word boundaries by spaces, because \b doesn't work with Urdu letters.
  const URDU_WORDS = [
    ["ٹرانس ?کرپٹ", "transcript"],
    ["مارکس|نمبرز|نمبر|نتائج|نتیجہ|نتیجے|nambar|numbers?", "marks"],
    ["حاضری|حاضریاں|اٹینڈنس|اٹینڈینس|غیر ?حاضر(?:ی|یاں)?|hazr[ie]e?|hazriyan", "attendance"],
    ["ہوم ?پیج|ہوم|مرکزی صفحہ", "home"],
    ["کھولو|کھولیں|کھولیے|کھولئے|کھول ?دو|کھول ?دیں|کھولنا|kholo|kholiye|kholein|khol do", "open"],
    ["دکھاؤ|دکھاو|دکھائیں|دکھایئے|دکھائیے|دکھا ?دو|dikhao|dikhaiye|dikha do", "show"],
    ["بند ?کرو|بند ?کریں|بند ?کر ?دو|بند|روکو|رکو|رکیں|بس|خاموش|band karo|band kar do|ruko|rukiye|chup|bas", "stop"],
    ["مدد|ہیلپ|madad", "help"],
    ["ڈارک ?موڈ|ڈارک|اندھیرا|رات کا موڈ", "dark mode"],
    ["لائٹ ?موڈ|روشنی|اجالا", "light mode"],
    ["سی ?جی ?پی ?اے|جی ?پی ?اے", "gpa"],
    ["فیڈ ?بیک", "feedback"],
    ["نیا|نئی|نئے|اپ ?ڈیٹ|اطلاع|اطلاعات|naya|nayi|naye", "new"],
    ["نیچے|neeche|niche", "scroll down"],
    ["اوپر|upar", "scroll up"],
    ["واپس|wapas|wapis", "go back"],
    ["اگلا|اگلی|اگلے|agla|agli", "next"],
    ["پچھلا|پچھلی|پچھلے|pichla|pichli", "previous"],
    ["کورس|مضمون|subject", "course"],
    ["کنفرم|تصدیق|ہاں|جی ہاں|haan|han ji", "confirm"],
    ["منسوخ|نہیں|نہ|nahi|nahin", "cancel"],
    ["بے ?ترتیب|رینڈم", "random"],
    ["بھرو|بھر ?دو|بھریں|بھر ?دیں|bharo|bhar do", "fill"],
    ["جمع ?کرو|جمع ?کریں|جمع ?کر ?دو|بھیج ?دو|jama karo", "submit"],
    ["سیٹ ?کرو|سیٹ ?کریں|سیٹ ?کر ?دو|سیٹ", "set"],
    ["سب ?کو|تمام|سب|sab", "all"],
    ["کو|ko", "to"]
  ].map(([alt, en]) => [new RegExp(`(^|\\s)(?:${alt})(?=\\s|$)`, "g"), en]);

  const norm = (t) => {
    let s = " " + String(t || "").toLowerCase().replace(/[^\p{L}\p{N}+\- ]/gu, " ").replace(/\s+/g, " ").trim() + " ";
    // two passes so back-to-back words such as "سب کو بی سیٹ کرو" all convert
    for (let i = 0; i < 2; i++) URDU_WORDS.forEach(([re, en]) => (s = s.replace(re, (m, pre) => `${pre}${en} `)));
    return s.replace(/\s+/g, " ").trim();
  };
  const spell = (s) => String(s).replace(/([A-Za-z])(?=[A-Za-z0-9])/g, "$1 ").replace(/(\d)(?=\d)/g, "$1 ");

  function hud() {
    let h = $("#flexh-voice");
    if (h) return h;
    h = document.createElement("div");
    h.id = "flexh-voice";
    h.className = "flexh-box";
    h.innerHTML = `
      <div class="fv-head">
        <b>🎤 Voice</b><span id="fv-status" class="flexh-muted">idle</span>
        <span class="fv-btns">
          <button type="button" class="flexh-sec" id="fv-lang" title="Speech language"></button>
          <button type="button" class="flexh-sec" id="fv-mute" title="Spoken replies on/off">🔊</button>
          <button type="button" class="flexh-sec" id="fv-x" title="Close">✕</button>
        </span>
      </div>
      <div id="fv-heard" class="fv-heard">Say a command…</div>
      <div id="fv-reply" class="fv-reply"></div>
      <form id="fv-form"><input id="fv-in" placeholder="…or type a command and press Enter" autocomplete="off"></form>
      <div class="flexh-muted fv-help">Try: <i>open marks</i> · <i>my marks</i> · <i>attendance</i> · <i>algorithms</i> (a course name) · <i>next course</i> · <i>dark mode off</i> · <i>fill feedback random</i> · <i>fill feedback strongly agree</i> · <i>submit feedback</i> · <i>gpa</i> · <i>set all to A</i> · <i>what's new</i> · <i>scroll down</i> · <i>stop</i></div>`;
    document.body.appendChild(h);
    $("#fv-x", h).onclick = stopVoice;
    $("#fv-lang", h).onclick = () => {
      const next = LANGS[(LANGS.indexOf(settings.voiceLang) + 1) % LANGS.length];
      settings.voiceLang = next; store.set("sync", { voiceLang: next }); paintHud();
      if (V.on) { try { V.rec.stop(); } catch {} } // onend restarts with the new language
    };
    $("#fv-mute", h).onclick = () => { settings.voiceMute = !settings.voiceMute; store.set("sync", { voiceMute: settings.voiceMute }); if (settings.voiceMute) speechSynthesis.cancel(); paintHud(); };
    $("#fv-form", h).onsubmit = (e) => { e.preventDefault(); const i = $("#fv-in", h); const v = i.value.trim(); i.value = ""; if (v) { setHeard(v); handle(v); } };
    paintHud();
    return h;
  }
  function paintHud() {
    const h = $("#flexh-voice"); if (!h) return;
    $("#fv-lang", h).textContent = (settings.voiceLang || "en-US").toUpperCase();
    $("#fv-lang", h).title = LANG_NAMES[settings.voiceLang || "en-US"] + " (click to change)";
    $("#fv-mute", h).textContent = settings.voiceMute ? "🔇" : "🔊";
    $("#fv-status", h).textContent = V.on ? "listening…" : "not listening";
    h.classList.toggle("fv-live", V.on);
    $("#fh-mic")?.classList.toggle("flexh-live", V.on);
  }
  function setHeard(t, interim) { const e = $("#fv-heard"); if (e) { e.textContent = t || "…"; e.style.opacity = interim ? 0.6 : 1; } }

  function say(msg) {
    hud();
    const r = $("#fv-reply"); if (r) r.textContent = msg;
    V.lastSpokeAt = Date.now();
    if (settings.voiceMute || !window.speechSynthesis) return;
    try {
      speechSynthesis.cancel();
      const parts = msg.split(/(?<=[.!?])\s+/).filter(Boolean);
      V.speaking = true;
      parts.forEach((p, i) => {
        const u = new SpeechSynthesisUtterance(p);
        u.lang = "en-US"; u.rate = 1.02;
        const done = () => { V.lastSpokeAt = Date.now(); if (i === parts.length - 1) setTimeout(() => (V.speaking = false), 800); };
        u.onend = done; u.onerror = done;
        speechSynthesis.speak(u);
      });
    } catch { V.speaking = false; }
  }

  function startVoice(auto) {
    hud(); V.on = true; paintHud();
    try { sessionStorage.setItem("flexh_voice_on", "1"); } catch {}
    if (!SR) { V.on = false; paintHud(); $("#fv-status").textContent = "mic not supported"; say("Voice recognition isn't available in this browser. You can type commands instead."); return; }
    const rec = new SR();
    V.rec = rec;
    rec.lang = settings.voiceLang || "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i], t = r[0].transcript;
        if (V.speaking) {
          // while it talks, ignore everything except a stop word (so it can't hear itself)
          if (STOP_TALK.test(norm(t))) { try { speechSynthesis.cancel(); } catch {} V.speaking = false; V.lastSpokeAt = Date.now(); const rp = $("#fv-reply"); if (rp) rp.textContent = "(stopped talking)"; }
          continue;
        }
        if (r.isFinal) { setHeard(t); handle(t); } else setHeard(t, true);
      }
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        V.on = false; try { sessionStorage.removeItem("flexh_voice_on"); } catch {}
        paintHud(); $("#fv-status").textContent = "mic blocked";
        say("The microphone is blocked. Click the lock icon in the address bar, allow the microphone, then press the mic button again.");
      } else if (e.error === "language-not-supported") {
        settings.voiceLang = "en-US"; store.set("sync", { voiceLang: "en-US" }); paintHud();
      }
    };
    rec.onend = () => { if (V.on) setTimeout(() => { try { rec.lang = settings.voiceLang || "en-US"; rec.start(); } catch {} }, 250); else paintHud(); };
    try { rec.start(); if (!auto) say("Listening. Say help to hear what I can do."); } catch {}
  }
  function stopVoice() {
    V.on = false;
    try { V.rec && V.rec.stop(); } catch {}
    try { sessionStorage.removeItem("flexh_voice_on"); speechSynthesis.cancel(); } catch {}
    $("#flexh-voice")?.remove();
    $("#fh-mic")?.classList.remove("flexh-live");
  }
  const toggleVoice = () => (V.on ? stopVoice() : startVoice(false));

  /* ---- course names & fuzzy matching (English, Roman-Urdu, Urdu script) ---- */
  let COURSE_NAMES = {};
  async function loadNames() { COURSE_NAMES = (await store.get("local", ["courseNames"])).courseNames || {}; }
  const cleanName = (n) => String(n || "").replace(/\s*[-–]\s*/g, " ").replace(/\s+/g, " ").trim();
  const spokenCourse = (code) => cleanName(COURSE_NAMES[code]) || spell(code);
  const codeOf = (t) => ((String(t).match(/[A-Za-z]{2}\d{4}/) || [String(t)])[0]).toUpperCase();

  const U2L = { "ا": "a", "آ": "a", "أ": "a", "ب": "b", "پ": "p", "ت": "t", "ٹ": "t", "ث": "s", "ج": "j", "چ": "ch", "ح": "h", "خ": "kh",
    "د": "d", "ڈ": "d", "ذ": "z", "ر": "r", "ڑ": "r", "ز": "z", "ژ": "zh", "س": "s", "ش": "sh", "ص": "s", "ض": "z", "ط": "t", "ظ": "z",
    "ع": "a", "غ": "gh", "ف": "f", "ق": "k", "ک": "k", "گ": "g", "ل": "l", "م": "m", "ن": "n", "ں": "n", "و": "w", "ہ": "h", "ھ": "h",
    "ۃ": "h", "ی": "y", "ے": "y", "ئ": "y", "ء": "" };
  const urduToLatin = (s) => s.replace(/[ً-ٰٟ]/g, "").replace(/[؀-ۿ]/g, (c) => (c in U2L ? U2L[c] : ""));
  // consonant skeleton: "database" and "ڈیٹا بیس" both become "dtbs"
  const skel = (w) => w.toLowerCase().replace(/ph/g, "f").replace(/ck/g, "k").replace(/[cq]/g, "k").replace(/x/g, "ks").replace(/[aeiouyw]/g, "").replace(/(.)\1+/g, "$1");
  const utterTokens = (said) => {
    const raw = said.split(" ").map((w) => (/[؀-ۿ]/.test(w) ? urduToLatin(w) : w)).filter(Boolean);
    const out = []; let run = "";
    raw.forEach((w) => { if (/^[a-z]$/.test(w)) run += w; else { if (run) { out.push(run); run = ""; } out.push(w); } });
    if (run) out.push(run);
    return out;
  };
  const NAME_STOP = ["and", "of", "the", "in", "for", "to", "with"];

  function matchCourse(said, cands) {
    if (!cands.length) return null;
    const flat = said.replace(/[\s-]/g, "");
    const byCode = cands.find((c) => flat.includes(c.code.toLowerCase()));
    if (byCode) return byCode;
    const toks = utterTokens(said).filter((w) => !/^\d+$/.test(w));
    const usk = toks.map(skel);
    toks.forEach((t, i) => { if (i < toks.length - 1) usk.push(skel(t + toks[i + 1])); }); // Urdu splits "networks" into نیٹ ورکس
    const uskf = usk.filter((k) => k.length >= 2);
    const wantsLab = /\blab\b|لیب/.test(said);
    const scored = [];
    for (const c of cands) {
      const sig = cleanName(c.name).toLowerCase().split(" ").filter((w) => w.length >= 3 && w !== "lab" && !NAME_STOP.includes(w));
      if (!sig.length) continue;
      let hit = 0;
      sig.forEach((w) => { const k = skel(w); if (k.length >= 2 && uskf.some((u) => u === k || (u.length >= 3 && k.length >= 3 && (k.startsWith(u) || u.startsWith(k))))) hit++; });
      let score = hit / sig.length;
      const inits = (a) => a.map((w) => w[0]).join("");
      if ([inits(sig), inits(sig.slice(1))].filter((a) => a.length >= 2).some((a) => toks.includes(a))) score = Math.max(score, 1);
      if (!score) continue;
      if (/\blab\b/i.test(c.name) !== wantsLab) score -= 0.15;
      scored.push({ c, score });
    }
    scored.sort((x, y) => y.score - x.score);
    if (!scored.length || scored[0].score < 0.3) return null;
    if (scored[1] && scored[1].score >= scored[0].score - 0.01) return null; // two courses fit equally: don't guess
    return scored[0].c;
  }

  /* ---- data readers ---- */
  function getMarksSummary() {
    const cats = $$("table").map(analyseCategory).filter(Boolean);
    if (!cats.length) return [];
    const groups = groupTables(cats.map((c) => c.table));
    return groups.map((g, i) => {
      const mine = cats.filter((c) => g.tables.includes(c.table));
      const raw = paneLabel(g.tables[0]);
      return {
        title: raw ? codeOf(raw) : groups.length > 1 ? `Course ${i + 1}` : "All graded work",
        got: mine.reduce((s, c) => s + c.got, 0),
        w: mine.reduce((s, c) => s + c.w, 0)
      };
    });
  }
  function getAttendance() {
    const out = [];
    $$("table").forEach((t, n) => {
      if (t.closest("#flexh-panel, .flexh-box, #flexh-notify")) return;
      const h = $("thead tr", t) || $("tr", t); if (!h) return;
      const heads = $$("th, td", h).map((c) => txt(c).toLowerCase());
      const iP = heads.findIndex((x) => /presence|status/.test(x)); if (iP < 0) return;
      const iD = heads.findIndex((x) => /duration|hours/.test(x));
      let p = 0, tot = 0, abs = 0, lec = 0;
      $$("tr", t).forEach((r) => {
        if (r === h) return;
        const c = $$("td", r); if (c.length <= iP) return;
        const v = txt(c[iP]).toUpperCase(); if (v !== "P" && v !== "A") return;
        const d = iD >= 0 ? num(txt(c[iD])) || 1 : 1;
        tot += d; lec++; if (v === "P") p += d; else abs++;
      });
      const raw = paneLabel(t);
      if (tot) out.push({ course: raw ? codeOf(raw) : `Course ${n + 1}`, pct: (p / tot) * 100, abs, lec });
    });
    return out;
  }
  const marksLine = (x) => `${spokenCourse(x.title)}: ${fmt(x.got)} out of ${fmt(x.w)}`;
  const attLine = (x) => `${spokenCourse(x.course)}: ${Math.round(x.pct)} percent, ${x.abs} absence${x.abs === 1 ? "" : "s"}`;
  function readCourse(code, kind) {
    kind = kind || (/attendance/.test(path) ? "att" : "marks");
    if (kind === "att") { const a = getAttendance().find((x) => x.course === code); return a ? attLine(a) + "." : ""; }
    const m = getMarksSummary().find((x) => x.title === code); return m ? marksLine(m) + "." : "";
  }

  /* ---- course tabs on the page ---- */
  const tabLinks = () => $$('[data-toggle="tab"], [data-bs-toggle="tab"], [role="tab"], .nav-tabs a, .nav-pills a, .nav a[href^="#"]').filter((a) => {
    if (!txt(a) || txt(a).length > 80 || a.closest("#flexh-voice, #flexh-bar, #flexh-panel, #flexh-notify")) return false;
    if (a.getAttribute("role") === "tab" || /tab/.test(a.dataset.toggle || a.dataset.bsToggle || "")) return true;
    const tgt = a.hash && document.getElementById(a.hash.slice(1));
    return !!(tgt && tgt.matches(".tab-pane, [role=tabpanel]"));
  });
  function pageCourses() {
    const codes = new Set();
    getMarksSummary().forEach((x) => /^[A-Z]{2}\d{4}$/.test(x.title) && codes.add(x.title));
    getAttendance().forEach((x) => /^[A-Z]{2}\d{4}$/.test(x.course) && codes.add(x.course));
    tabLinks().forEach((a) => { const m = txt(a).match(/[A-Za-z]{2}\d{4}/); if (m) codes.add(m[0].toUpperCase()); });
    return [...codes].map((code) => ({ code, name: COURSE_NAMES[code] || "" }));
  }
  function switchCourse(c) {
    const code = c.code.toLowerCase();
    const sq = (x) => txt(x).toLowerCase().replace(/[\s-]/g, "");
    const tab = tabLinks().find((a) => sq(a).includes(code) || (c.name && txt(a).toLowerCase().includes(cleanName(c.name).toLowerCase())));
    if (tab) { tab.click(); tab.scrollIntoView({ block: "center", behavior: "smooth" }); return true; }
    const head = $$("h1,h2,h3,h4,h5,h6,.card-header,.m-portlet__head,summary,button,a").find((e) => !e.closest("#flexh-voice, #flexh-bar, #flexh-panel") && txt(e).length < 120 && sq(e).includes(code));
    if (head) { head.scrollIntoView({ block: "start", behavior: "smooth" }); if (head.matches("a,button,summary")) head.click(); return true; }
    return false;
  }
  function stepCourse(dir) {
    const tabs = tabLinks(); if (!tabs.length) return null;
    let i = tabs.findIndex((a) => a.classList.contains("active") || a.parentElement?.classList.contains("active") || a.getAttribute("aria-selected") === "true");
    i = i < 0 ? 0 : (i + dir + tabs.length) % tabs.length;
    tabs[i].click(); tabs[i].scrollIntoView({ block: "center", behavior: "smooth" });
    return codeOf(txt(tabs[i]));
  }

  /* ---- page navigation ---- */
  const NAV = {
    home: /^(home|dashboard)/i, marks: /marks/i, attendance: /attendance/i, transcript: /transcript/i,
    feedback: /feedback|evaluation/i, registration: /registration/i, timetable: /time\s*table/i, fee: /fee|challan/i
  };
  function links() {
    return $$("a[href]").filter((a) => {
      const h = a.getAttribute("href");
      return h && !h.startsWith("#") && !/^javascript/i.test(h) && txt(a).length > 1 && txt(a).length < 45 && !a.closest("#flexh-voice, #flexh-bar, #flexh-panel");
    });
  }
  function findPage(said) {
    const L = links();
    for (const k in NAV) if (new RegExp("\\b" + k + "\\b", "i").test(said)) { const a = L.find((x) => NAV[k].test(txt(x)) || (k !== "home" && NAV[k].test(x.getAttribute("href")))); if (a) return a; }
    const words = said.split(" ").filter((w) => w.length > 2 && !/^(the|page|open|show|take|please|section)$/.test(w));
    let best = null, score = 0;
    L.forEach((a) => {
      const t = norm(txt(a)).split(" ");
      const s = words.filter((w) => t.some((x) => x.startsWith(w) || w.startsWith(x))).length;
      if (s > score) { score = s; best = a; }
    });
    return score ? best : null;
  }
  function goPage(a, then) {
    if (then) try { sessionStorage.setItem("flexh_pending", then); } catch {}
    say(`Opening ${txt(a)}.`);
    setTimeout(() => (location.href = a.href), 600);
  }
  function needPage(key, said) {
    const a = links().find((x) => NAV[key].test(txt(x)) || NAV[key].test(x.getAttribute("href")));
    if (!a) { say(`I can't find the ${key} page link on this screen.`); return; }
    goPage(a, said);
  }

  /* ---- grades: "be" = B, "see" = C, etc. ---- */
  const LETTER = { a: "A", eh: "A", ay: "A", hey: "A", "اے": "A", b: "B", be: "B", bee: "B", bi: "B", "بی": "B",
    c: "C", see: "C", sea: "C", si: "C", cee: "C", "سی": "C", d: "D", dee: "D", "ڈی": "D", f: "F", eff: "F", ef: "F", "ایف": "F" };
  function parseGrade(s) {
    const toks = s.split(" ");
    const to = toks.lastIndexOf("to");
    const scan = to >= 0 ? toks.slice(to + 1) : toks;
    for (let i = 0; i < scan.length; i++) {
      const w = scan[i];
      let g = null;
      const m = w.match(/^([a-f])([+-])$/);
      if (m) g = m[1].toUpperCase() + m[2];
      else if (w in LETTER) {
        g = LETTER[w];
        const nx = scan[i + 1];
        if (nx === "plus" || nx === "+" || nx === "positive" || nx === "پلس") g += "+";
        else if (nx === "minus" || nx === "-" || nx === "negative" || nx === "مائنس") g += "-";
      }
      if (g && g in GP) return g;
    }
    return null;
  }

  /* ---- the brain ---- */
  const STOP_TALK = /\b(stop|quiet|enough|silence|pause|hush|shut up)\b/;
  const READ_WORDS = /\b(marks|score|scores|total|result|results)\b/;
  const ATT_WORDS = /\b(attendance|absent|absents|present|absences)\b/;

  async function handle(raw) {
    const s = norm(raw);
    if (!s) return;
    const has = (re) => re.test(s);

    if (has(/\b(stop listening|close|exit|quit|goodbye|bye|turn off)\b/)) { say("Okay, stopped listening."); setTimeout(stopVoice, 900); return; }
    if (has(STOP_TALK)) {
      const wasTalking = V.speaking || (window.speechSynthesis && speechSynthesis.speaking) || Date.now() - (V.lastSpokeAt || 0) < 6000;
      try { speechSynthesis.cancel(); } catch {}
      V.speaking = false;
      if (wasTalking) { const r = $("#fv-reply"); if (r) r.textContent = "(stopped talking)"; return; }
      say("Okay, stopped listening."); setTimeout(stopVoice, 900); return;
    }
    if (has(/\b(help|what can you do|commands)\b/)) { say("You can say: open marks, my marks, attendance, a course name like algorithms, next course, GPA, set all to B plus, dark mode on or off, fill feedback random, fill feedback strongly agree, submit feedback, what's new, scroll down, go back, or stop."); return; }

    // confirmation flow
    if (V.confirm && Date.now() < V.confirm.exp) {
      if (has(/\b(confirm|yes|do it|go ahead|submit it)\b/)) { const f = V.confirm.fn; V.confirm = null; f(); return; }
      if (has(/\b(cancel|no|don t|never mind|abort)\b/)) { V.confirm = null; say("Cancelled."); return; }
    }

    // dark mode
    if (has(/\b(dark|night)\b/) || has(/\blight (mode|theme)\b/)) {
      const off = has(/\b(off|disable|light|bright|normal)\b/);
      const on = has(/\b(on|enable|dark|night)\b/) && !off;
      settings.dark = off ? false : on ? true : !settings.dark;
      applyDark(); store.set("sync", { dark: settings.dark });
      say(settings.dark ? "Dark mode on." : "Dark mode off."); return;
    }

    // scrolling / back
    if (has(/\b(scroll|go) (down|up|top|bottom)\b|\bpage (down|up)\b|\b(top|bottom) of (the )?page\b/)) {
      const dir = has(/\b(top|up)\b/) ? -1 : 1;
      if (has(/\b(top|bottom)\b/)) window.scrollTo({ top: dir < 0 ? 0 : document.body.scrollHeight, behavior: "smooth" });
      else window.scrollBy({ top: dir * innerHeight * 0.8, behavior: "smooth" });
      say(dir < 0 ? "Up." : "Down."); return;
    }
    if (has(/\b(go back|back)\b/)) { say("Going back."); setTimeout(() => history.back(), 500); return; }

    // next / previous course tab
    if (has(/\b(next|previous|prev)\b/) && (has(/\b(course|subject|tab)\b/) || s.split(" ").length <= 2)) {
      const code = stepCourse(has(/\b(previous|prev)\b/) ? -1 : 1);
      if (!code) { say("There are no course tabs on this page."); return; }
      say(`${spokenCourse(code)}. ${readCourse(code)}`); return;
    }

    // a course was named: switch to it and read it
    const wantsSet = has(/\bset\b/) && parseGrade(s);
    if (!wantsSet && !has(/\b(gpa|cgpa|sgpa|feedback)\b/)) {
      const cands = pageCourses();
      const course = cands.length ? matchCourse(s, cands) : null;
      if (course) {
        const switched = switchCourse(course);
        const kind = has(ATT_WORDS) ? "att" : has(READ_WORDS) ? "marks" : undefined;
        const line = readCourse(course.code, kind);
        if (switched || line) { say(`${switched ? "Showing " : ""}${line || spokenCourse(course.code) + "."}`); return; }
      }
    }

    // open a page
    const OPEN = /\b(open|go to|take me to|navigate to|visit|switch to)\b/;
    if (has(OPEN)) {
      const target = s.replace(new RegExp(OPEN.source, "g"), " ").replace(/\b(the|page|section|please|show)\b/g, " ").replace(/\s+/g, " ").trim();
      if (!target) { say("Open what? For example, open marks."); return; }
      const a = findPage(target);
      if (a) goPage(a); else say(`I couldn't find a page called ${target}.`);
      return;
    }

    // feedback
    if (has(/\bfeedback\b|\bfill (it|the form|everything|all)\b/)) {
      if (has(/\b(submit|send)\b/)) {
        if (!hasFeedbackForm()) { say("There's no feedback form on this page."); return; }
        const btn = (() => { const f = radioGroups()[0][0].closest("form"); return f && $$('button[type=submit], input[type=submit], button:not([type])', f).find((b) => !b.closest(".flexh-box")); })();
        if (!btn) { say("I can't find the submit button. Please press it yourself."); return; }
        V.confirm = { exp: Date.now() + 20000, fn: () => { say("Submitting."); btn.click(); } };
        say("Ready to submit your feedback. Say confirm to submit, or cancel."); return;
      }
      if (!hasFeedbackForm()) {
        const a = links().find((x) => NAV.feedback.test(txt(x)));
        if (a) goPage(a, raw); else say("There's no feedback form on this page.");
        return;
      }
      const groups = radioGroups();
      const sample = groups.reduce((a, b) => (b.length > a.length ? b : a), groups[0]);
      const labels = sample.map(labelFor).filter(Boolean);
      let mode = "random", picked = "random answers";
      if (!has(/\brandom/)) {
        const order = ["strongly disagree", "strongly agree", "disagree", "agree", "neutral", "excellent", "very good", "good", "average", "fair", "poor"];
        const want = order.find((w) => s.includes(w));
        const lab = want && labels.find((l) => l.toLowerCase() === want);
        if (lab) { mode = `label:${lab}|${labels.indexOf(lab)}|${labels.length - 1}`; picked = lab; }
        else if (want || has(/\b(everything|all)\b/)) { say(`I couldn't match that option. This form offers: ${labels.join(", ")}.`); return; }
      }
      fillFeedback(mode, settings.fillComments);
      say(`Filled every question with ${picked}. Say submit feedback when you're ready.`); return;
    }

    // GPA
    if (has(/\b(gpa|cgpa|sgpa)\b/) || wantsSet) {
      if (!$("#fh-out")) { needPage("transcript", raw); return; }
      if (has(/\bset\b/)) {
        const g = parseGrade(s);
        if (!g) { say("Which grade? For example: set all to B plus."); return; }
        const rows = $$("#fh-table tr[data-code]");
        let target = [];
        if (has(/\b(all|every|everything)\b/)) target = rows;
        else {
          const cands = rows.map((r) => ({ code: (r.dataset.code || "").toUpperCase(), name: COURSE_NAMES[(r.dataset.code || "").toUpperCase()] || $(".fh-name", r).value, row: r })).filter((c) => c.code);
          const c = matchCourse(s, cands);
          if (c) target = [c.row];
        }
        if (!target.length) { say("Say set all to A, or name a course, like set algorithms to B plus."); return; }
        target.forEach((r) => { $(".fh-gr", r).value = g; });
        $("#fh-table").dispatchEvent(new Event("change", { bubbles: true }));
        const out = $$("#fh-out .flexh-big").map((e) => e.textContent);
        say(`Set ${target.length === rows.length ? "all courses" : spokenCourse((target[0].dataset.code || "").toUpperCase())} to ${g.replace("+", " plus").replace("-", " minus")}. Expected S G P A ${out[0]}, C G P A ${out[1]}.`); return;
      }
      const out = $$("#fh-out .flexh-big").map((e) => e.textContent);
      say(`Expected S G P A ${out[0]}, expected C G P A ${out[1]}, over ${out[2]} credits.`); return;
    }

    const hint = () => (Object.keys(COURSE_NAMES).length ? "" : " Open your transcript once and I'll learn your course names.");
    // marks
    if (has(READ_WORDS)) {
      const sum = getMarksSummary();
      if (!sum.length) { needPage("marks", raw); return; }
      say(sum.map(marksLine).join(". ") + "." + hint()); return;
    }
    // attendance
    if (has(ATT_WORDS)) {
      const at = getAttendance();
      if (!at.length) { needPage("attendance", raw); return; }
      say(at.map(attLine).join(". ") + "." + hint()); return;
    }

    // notifications
    if (has(/\b(new|news|notification|notifications|updates|alerts|anything new)\b/)) {
      if (has(/\b(mark|clear|dismiss)\b/)) {
        const all = await getNotifs(); await store.set("local", { notifs: all.map((n) => ({ ...n, read: true })) }); renderNotify(); updateBadge(); say("Marked all as read."); return;
      }
      const items = (await getNotifs()).filter((n) => !n.read);
      say(items.length ? `${items.length} new. ` + items.slice(0, 4).map((n) => n.text).join(". ") : "Nothing new since your last visit."); return;
    }

    say(`Sorry, I didn't get "${raw.trim()}". Say help to hear what I can do.`);
  }

  // resume after navigation
  function voiceResume() {
    let pending = null, wasOn = false;
    try { pending = sessionStorage.getItem("flexh_pending"); wasOn = sessionStorage.getItem("flexh_voice_on") === "1"; sessionStorage.removeItem("flexh_pending"); } catch {}
    if (wasOn) startVoice(true);
    if (pending) setTimeout(() => { hud(); setHeard(pending); handle(pending); }, 1400);
  }
  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.code === "KeyV") { e.preventDefault(); toggleVoice(); }
  });

  /* ================================================================ INIT */
  function run() {
    buildBar();
    if (settings.dark) darkenPass();

    if (/transcript/.test(path) || $$("table").some(headerMapTranscript)) buildGpaPlanner();
    if (!$("#flexh-gpa")) runMarks();
    buildFeedbackBot();
    renderNotify();
    setTimeout(passiveRecord, 900);
    loadNames().then(voiceResume);
    if (isHome()) setTimeout(() => checkUpdates(false, true), 2500);
  }

  function ready() {
    run();
    let t;
    new MutationObserver((muts) => {
      if (muts.every((m) => [...m.addedNodes].every((n) => n.nodeType === 1 && n.closest?.("#flexh-bar, #flexh-panel, .flexh-box, .flexh-banner, #flexh-notify, #flexh-toast")))) return;
      clearTimeout(t);
      t = setTimeout(() => {
        if (settings.dark) darkenPass();
        if (!$("#flexh-bar")) buildBar();
        if (!$("#flexh-gpa") && !$$(".flexh-banner").length) runMarks();
        buildFeedbackBot();
      }, 400);
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
})();
