(() => {
  "use strict";

  /* ============================================================ helpers */
  const DEFAULTS = {
    dark: true,
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
    if (groups.length > 1 && groups.every((g) => g.tables.length === 1)) return [{ el: a, tables, merged: true }];
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
          name: txt(c[iName >= 0 ? iName : iCode >= 0 ? iCode : 0]).slice(0, 48),
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
    if (!url) return [];
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
      if (/grand\s*total/i.test(ctx)) return;
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
    const data = await store.get("local", ["snaps2", "notifs", "lastCheck", "tracked"]);
    if (!force && Date.now() - (data.lastCheck || 0) < 10 * 60 * 1000) return;
    const links = { ...discoverLinks(), ...DEFAULT_LINKS };
    checking = true;
    const snaps = data.snaps2 || {};
    let notifs = data.notifs || [];
    const tracked = {};
    let baselineOnly = false;
    try {
      for (const page in links) {
        let res;
        try { res = await fetch(links[page], { credentials: "include" }); } catch { continue; }
        if (!res.ok || /login/i.test(res.url)) continue;
        const doc = new DOMParser().parseFromString(await res.text(), "text/html");
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
      await store.set("local", { snaps2: snaps, notifs, lastCheck: Date.now(), tracked: { ...tracked, baseline: baselineOnly } });
      if (force && !silent) toast(baselineOnly ? "Tracking started. You'll see changes from now on." : "Checked for updates.");
    } finally { checking = false; }
    renderNotify();
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
      : "Checking your pages…";
    if (!items.length) {
      div.innerHTML = `<b>🔔 FLEX Helper</b> <span class="flexh-muted">&nbsp;${tr.baseline ? "Tracking started: I've saved your current marks and attendance. Anything new will show here next time you open FLEX." : "Nothing new since your last visit."}</span>
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
    mk("🧩", () => {
      const sk = $$("table").slice(0, 12).map((t, i) => `#${i} ctx=[${paneLabel(t)} / ${contextLabel(t)}]\n` +
        $$("tr", t).slice(0, 6).map((r) => $$("th,td", r).map(txt).join(" | ")).join("\n")).join("\n\n");
      navigator.clipboard?.writeText(`URL: ${location.pathname}\n\n${sk}`).then(() => toast("Page structure copied. Paste it to Claude if something looks wrong."), () => toast("Couldn't copy."));
    }, "Copy page structure (for debugging)");
    document.body.appendChild(bar);
    updateBadge();
  }

  /* ================================================================ INIT */
  function run() {
    buildBar();
    if (settings.dark) darkenPass();

    if (/transcript/.test(path) || $$("table").some(headerMapTranscript)) buildGpaPlanner();
    if (!$("#flexh-gpa")) runMarks();
    buildFeedbackBot();
    renderNotify();
    checkUpdates(isHome(), true);
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
