/* Script Studio — Test data: the parameters for values the user typed (user name, search term …), as a table the user
 * can change. The engine finds them (detectParams); the user's choices are kept as edits by the parameter's first
 * name and applied again after every reading of the recording (studioAfterParams, called by analyze()):
 *   by[origName] = { name, removed, take, update, file, rows }      added = [{ name, value, take, update, file, rows }]
 *   take "sequential" | "random" | "unique"   update "iteration" | "once"   file "" (the shared file) | own file name
 *   rows: the values, one per user (Excel: download, fill many rows, upload); the first row is the recorded value
 * The generators (studio-codegen.js) write .prm / parameters.yml and the data files from those fields.
 *
 * UMD: window.TestData (pure functions: apply, usagesOf, nameError) — tests/unit/studioTestData.test.js. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TestData = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
  var SHARED = "collection_data";

  function nameError(name, taken, from) {
    if (!name) return "Enter a parameter name.";
    if (!NAME_RE.test(name)) return "A parameter name starts with a letter and has letters, numbers and _ only.";
    var lc = name.toLowerCase();
    if (name !== from && taken.some(function (t) { return String(t).toLowerCase() === lc; })) return "“" + name + "” is already used — choose another name.";
    return "";
  }

  function decode(s) { try { return decodeURIComponent(String(s).replace(/\+/g, " ")); } catch (e) { return s; } }
  /** Where the script sends a value: form fields, JSON body fields and query parameters of the requests in the script
   *  (the places the generators replace a parameter). → [{ reqIdx, key, location }] */
  function usagesOf(entries, value) {
    var out = [], v = String(value == null ? "" : value);
    if (!v) return out;
    var add = function (i, key, loc) { if (!out.some(function (u) { return u.reqIdx === i && u.key === key && u.location === loc; })) out.push({ reqIdx: i, key: key, location: loc }); };
    (entries || []).forEach(function (e, i) {
      if (!e || e.isMarker || e.filtered) return;
      var q = String(e.url || "").split("#")[0].split("?")[1];
      if (q) q.split("&").forEach(function (p) { var k = p.indexOf("="); if (k > 0 && decode(p.slice(k + 1)) === v) add(i, decode(p.slice(0, k)), "query"); });
      var b = e.body;
      if (!b) return;
      (b.params || []).forEach(function (p) { if (String(p.value) === v) add(i, p.name, "body_form"); });
      var t = b.text || "", mime = String(b.mimeType || "").toLowerCase();
      if (!t) return;
      if (mime.indexOf("json") !== -1 || /^\s*[{[]/.test(t)) {
        try { (function walk(o, key) {
          if (typeof o === "string") { if (o === v) add(i, key, "body_json"); }
          else if (typeof o === "number" || typeof o === "boolean") { if (String(o) === v) add(i, key, "body_json"); }
          else if (o && typeof o === "object") Object.keys(o).forEach(function (k) { walk(o[k], Array.isArray(o) ? key : k); });
        })(JSON.parse(t), ""); } catch (x) { /* not JSON */ }
      } else if (/^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(t.trim())) {
        t.trim().split("&").forEach(function (p) { var k = p.indexOf("="); if (k > 0 && decode(p.slice(k + 1)) === v) add(i, decode(p.slice(0, k)), "body_form"); });
      }
    });
    return out;
  }

  function settle(p, e) {
    if (!e) return p;
    if (e.take) p.take = e.take;
    if (e.update) p.update = e.update;
    if (e.file) p.file = e.file;
    if (e.rows && e.rows.length) p.rows = e.rows.slice();
    return p;
  }
  /** The parameters the script uses: the detected ones with the user's choices, then the ones the user added. */
  function apply(params, ed, entries) {
    ed = ed || {};
    var by = ed.by || {}, out = [];
    (params || []).forEach(function (p0) {
      var e = by[p0.csvKey];
      if (e && e.removed) return;
      var p = Object.assign({}, p0, { _orig: p0.csvKey });
      if (e && e.name && e.name !== p0.csvKey) { p.csvKey = e.name; p.name = e.name; }
      out.push(settle(p, e));
    });
    (ed.added || []).forEach(function (a) {
      if (out.some(function (p) { return p.csvKey === a.name; })) return;
      out.push(settle({ name: a.name, csvKey: a.name, value: a.value, usages: usagesOf(entries, a.value), _added: true, _orig: a.name }, a));
    });
    return out;
  }

  return { NAME_RE: NAME_RE, SHARED: SHARED, nameError: nameError, usagesOf: usagesOf, apply: apply };
});

// ── the Test data tab (Script Studio page only) ──
(function () {
  "use strict";
  if (typeof document === "undefined" || !window.SS || !document.getElementById("ss-t-data")) return;
  var SS = window.SS, $ = SS.$, esc = SS.esc, plural = SS.plural;
  var T = { orig: [], ed: { by: {}, added: [] } };
  var tab = $("#ss-t-data");

  // after every reading: the detected parameters, then the user's choices
  window.studioAfterParams = function () {
    T.orig = (S.params || []).map(function (p) { return Object.assign({}, p); });
    S.params = TestData.apply(T.orig, T.ed, S.entries1);
  };
  // Undo / Redo (portal/studio-history.js): the user's choices, and the same put back
  SS.testData = function (ed) { if (ed) { T.ed = ed; S.params = TestData.apply(T.orig, T.ed, S.entries1); } return T.ed; };
  SS.testDataNewFile = function () { T.orig = []; T.ed = { by: {}, added: [] }; };

  // a change: the parameters again from the detected ones, and the script again (no new reading)
  function change(fn, msg, undo) {
    var before = JSON.stringify(T.ed);
    fn();
    S.params = TestData.apply(T.orig, T.ed, S.entries1);
    if (typeof regenerateFromAdvisor === "function" && S.entries1 && S.entries1.length) regenerateFromAdvisor({ quiet: true });
    render();
    if (msg) {
      if (undo && window.SSW && SSW.undoToast) SSW.undoToast(msg, function () { change(function () { T.ed = JSON.parse(before); }); });
      else showToast(msg, "success", 3000);
    }
  }
  function edOf(p) {
    if (p._added) return T.ed.added.filter(function (a) { return a.name === p.csvKey; })[0];
    return T.ed.by[p._orig] || (T.ed.by[p._orig] = {});
  }
  function taken(except) {
    return (S.params || []).map(function (p) { return p.csvKey; }).filter(function (n) { return n !== except; })
      .concat((S.correlations || []).map(function (c) { return c.name; }));
  }

  var LOC = { body_form: "form field", body_json: "JSON body", query: "query string", body_xml: "XML body" };
  function where(p) {
    var u = p.usages || [];
    if (!u.length) return '<span class="ss-muted">' + (/^<enter_/.test(String(p.value)) ? "used for sign-in (web_set_user)" : "not replaced in any request") + "</span>";
    var e = (S.entries1 || [])[u[0].reqIdx];
    // every place it is sent is filled by a correlation (a list read from the page): that one wins, this is not used
    var by = null;
    var covered = u.every(function (x) {
      return (S.correlations || []).some(function (c) {
        var hit = (c.usages || []).some(function (cu) { return cu.reqIdx === x.reqIdx && String(cu.tokenValue) === String(p.value); });
        if (hit && !by) by = c.name;
        return hit;
      });
    });
    return '<button type="button" class="adv-req-link" data-open="' + (e ? e.id : "") + '">#' + (e ? e.id : "?") + " " + esc(e ? e.method : "") + "</button> " +
      '<span class="adv-where">' + esc(LOC[u[0].location] || u[0].location) + " " + esc(u[0].key || "") + "</span>" + (u.length > 1 ? ' <span class="ss-muted">+' + (u.length - 1) + " more</span>" : "") +
      (covered && by ? '<small class="ss-td-corr"><svg class="i"><use href="#i-info"/></svg>The script reads it from the page instead (correlation <code>' + esc(by) + "</code>): this parameter is not used. Remove it, or take the correlation out.</small>" : "");
  }
  function sel(field, val, opts, label) {
    return '<select class="ss-field ss-sel" data-set="' + field + '" aria-label="' + label + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === val ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select>";
  }
  function render() {
    var ps = S.params || [];
    var body = $("#ss-td-body");
    if (!body) return;
    body.innerHTML = ps.map(function (p, i) {
      var rows = p.rows && p.rows.length ? p.rows.length : 1;
      return '<tr data-i="' + i + '">' +
        '<td><input class="ss-field ss-td-name" value="' + esc(p.csvKey) + '" aria-label="Parameter name" spellcheck="false" autocomplete="off" maxlength="60">' +
          (p._added ? '<small class="ss-muted">added by you</small>' : "") + "</td>" +
        '<td><code class="ss-td-val" title="' + esc(p.value) + '">' + esc(String(p.value).length > 40 ? String(p.value).slice(0, 39) + "…" : p.value) + "</code><small>" + where(p) + "</small></td>" +
        "<td>" + sel("take", p.take || "sequential", [["sequential", "Next row"], ["random", "Random"], ["unique", "Unique"]], "Take value") + "</td>" +
        "<td>" + sel("update", p.update || "iteration", [["iteration", "Each run"], ["once", "Once"]], "Update") + "</td>" +
        "<td>" + sel("file", p.file ? "own" : "shared", [["shared", "Shared"], ["own", "Own file"]], "File") + "</td>" +
        '<td class="ss-num">' + rows + "</td>" +
        '<td><button type="button" class="ds-btn ds-btn-xs ds-btn-ghost ss-icon" data-del aria-label="Remove the parameter ' + esc(p.csvKey) + '" title="Remove: the recorded value stays in the script"><svg class="i"><use href="#i-x"/></svg></button></td></tr>';
    }).join("");
    $("#ss-td-table").hidden = !ps.length;
    $("#ss-data-empty").hidden = !!ps.length;
    var files = typeof genParamDataFiles === "function" && ps.length ? Object.keys(genParamDataFiles()) : [];
    var ext = S.format === "devweb" ? ".csv" : ".dat";
    $("#ss-td-files").innerHTML = files.length
      ? "Files in the ZIP: " + files.map(function (f) { return "<code>" + esc(f + ext) + "</code>"; }).join(", ") + (S.format === "devweb" ? " and <code>parameters.yml</code>" : " and <code>ParameterFile.prm</code>")
      : "";
  }
  SS.renderTestData = render;

  tab.addEventListener("change", function (e) {
    var tr = e.target.closest("tr[data-i]"); if (!tr) return;
    var p = (S.params || [])[+tr.getAttribute("data-i")]; if (!p) return;
    var s = e.target.getAttribute("data-set");
    if (s) {
      change(function () {
        var ed = edOf(p);
        if (s === "file") ed.file = e.target.value === "own" ? String(p.csvKey).toLowerCase() + "_data" : "";
        else ed[s] = e.target.value;
        if (!ed.file) delete ed.file;
      }, null);
      return;
    }
    if (e.target.classList.contains("ss-td-name")) rename(p, e.target);
  });
  tab.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.classList.contains("ss-td-name")) e.target.blur(); });
  function rename(p, inp) {
    var name = inp.value.trim();
    if (name === p.csvKey) return;
    var why = TestData.nameError(name, taken(p.csvKey), p.csvKey);
    if (why) { showToast(why, "warning"); inp.value = p.csvKey; return; }
    var from = p.csvKey;
    change(function () {
      var ed = edOf(p);
      if (p._added) { ed.name = name; if (ed.file) ed.file = name.toLowerCase() + "_data"; }
      else { ed.name = name; if (ed.file) ed.file = name.toLowerCase() + "_data"; }
    }, "Renamed " + from + " to " + name + " — the script uses the new name.", true);
  }
  tab.addEventListener("click", function (e) {
    var op = e.target.closest("[data-open]"); if (op && op.getAttribute("data-open") && window.SSW) { SSW.openDetails(+op.getAttribute("data-open")); return; }
    var del = e.target.closest("[data-del]");
    if (del) {
      var p = (S.params || [])[+del.closest("tr").getAttribute("data-i")]; if (!p) return;
      change(function () {
        if (p._added) T.ed.added = T.ed.added.filter(function (a) { return a.name !== p.csvKey; });
        else edOf(p).removed = true;
      }, "Parameter " + p.csvKey + " removed — the recorded value stays in the script.", true);
      return;
    }
    if (e.target.closest("#ss-td-add")) openAdd();
    if (e.target.closest("#ss-td-xl-down")) excelDown();
    if (e.target.closest("#ss-td-xl-up")) $("#ss-td-xl-file").click();
  });

  // a value the script correlates, or the Correlation Advisor suggests — not test data (the engine's detectParams
  // leaves those out the same way)
  function dynamicValue(v) {
    var seen = false;
    (S.correlations || []).forEach(function (c) {
      if (c.value === v || c.value1 === v) seen = true;
      (c.usages || []).forEach(function (u) { if (u.originalValue === v || u.tokenValue === v) seen = true; });
    });
    return seen || (S.advisorCandidates || []).some(function (c) { return c.value === v && c.status !== "skipped"; });
  }

  // ── add a parameter: a name and the value as it was typed in the journey ──
  var dlg = $("#ss-tdp-dlg");
  function openAdd() {
    $("#ss-tdp-name").value = ""; $("#ss-tdp-val").value = ""; $("#ss-tdp-err").hidden = true;
    try { dlg.showModal(); } catch (e) { dlg.setAttribute("open", ""); }
    $("#ss-tdp-name").focus();
  }
  dlg.addEventListener("click", function (e) { if (e.target.closest("[data-close]")) dlg.close(); });
  $("#ss-tdp-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var name = $("#ss-tdp-name").value.trim(), val = $("#ss-tdp-val").value;
    var err = $("#ss-tdp-err");
    var why = TestData.nameError(name, taken());
    if (!why && !val) why = "Enter the value as it was typed in the journey.";
    if (!why && dynamicValue(val)) why = "This value comes from the server (a session id, a token …): it is a correlation, not test data. See the Correlation Advisor or Find a value.";
    if (!why && !TestData.usagesOf(S.entries1, val).length) why = "No form field, JSON body field or query parameter of the script sends exactly this value. Check the value (as it was typed), or add it with Find a value.";
    if (why) { err.textContent = why; err.hidden = false; return; }
    dlg.close();
    change(function () { T.ed.added.push({ name: name, value: val }); }, "Parameter " + name + " added — the script uses it in " + plural(TestData.usagesOf(S.entries1, val).length, "place") + ".", true);
  });

  // ── Excel: one column per parameter, one row per user; read back into the data files ──
  var lib = null;
  function loadExcel() {
    if (window.ExcelJS) return Promise.resolve();
    return lib || (lib = new Promise(function (ok, fail) {
      var s = document.createElement("script"); s.src = "ra/vendor/exceljs.min.js";
      s.onload = function () { if (window.ExcelJS) ok(); else fail(new Error("the Excel library did not start")); };
      s.onerror = function () { lib = null; s.remove(); fail(new Error("the Excel library could not be loaded")); };
      document.head.appendChild(s);
    }));
  }
  function excelDown() {
    var ps = S.params || [];
    if (!ps.length) return;
    loadExcel().then(function () {
      var wb = new ExcelJS.Workbook(), ws = wb.addWorksheet("Test data");
      ws.addRow(ps.map(function (p) { return p.csvKey; }));
      var n = Math.max.apply(null, ps.map(function (p) { return p.rows && p.rows.length ? p.rows.length : 1; }));
      for (var r = 0; r < n; r++) ws.addRow(ps.map(function (p) { var rs = p.rows && p.rows.length ? p.rows : [p.value]; return String(rs[Math.min(r, rs.length - 1)]); }));
      ws.getRow(1).font = { bold: true };
      ws.columns.forEach(function (c) { c.width = 24; });
      ws.views = [{ state: "frozen", ySplit: 1 }];
      return wb.xlsx.writeBuffer();
    }).then(function (buf) {
      if (!buf) return;
      var a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      a.download = String(S.har1Name || "recording").replace(/\.[^.]+$/, "") + "_test_data.xlsx";
      a.click();
    }).catch(function (e) { showToast("Excel file not made: " + e.message + ".", "warning", 6000); });
  }
  $("#ss-td-xl-file").addEventListener("change", function (e) {
    var f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    loadExcel().then(function () { return f.arrayBuffer(); }).then(function (buf) {
      var wb = new ExcelJS.Workbook();
      return wb.xlsx.load(buf).then(function () {
        var ws = wb.worksheets[0];
        if (!ws) throw new Error("the file has no sheet");
        var head = [];
        ws.getRow(1).eachCell(function (c, col) { head[col] = String(c.text || "").trim(); });
        var cols = {}, rows = [];
        (S.params || []).forEach(function (p) { var col = head.findIndex(function (h) { return h && h.toLowerCase() === String(p.csvKey).toLowerCase(); }); if (col > 0) cols[p.csvKey] = col; });
        if (!Object.keys(cols).length) throw new Error("no column has the name of a parameter (" + (S.params || []).map(function (p) { return p.csvKey; }).join(", ") + ")");
        ws.eachRow(function (row, r) { if (r > 1) rows.push(row); });
        var got = {};
        Object.keys(cols).forEach(function (k) {
          got[k] = rows.map(function (row) { return String(row.getCell(cols[k]).text || "").trim(); }).filter(function (v, i, all) { return v !== "" || all.slice(i).some(function (x) { return x !== ""; }); });
        });
        change(function () {
          (S.params || []).forEach(function (p) { if (got[p.csvKey] && got[p.csvKey].length) edOf(p).rows = got[p.csvKey]; });
        }, null);
        var n = Math.max.apply(null, Object.keys(got).map(function (k) { return got[k].length; }));
        showToast("Read " + plural(n, "row") + " for " + plural(Object.keys(got).length, "parameter") + " — the data files in the ZIP have them.", "success", 5000);
      });
    }).catch(function (err) { showToast("Excel file not read: " + err.message + ".", "warning", 7000); });
  });

  // the table follows every drawing of the workspace (after a reading, a regeneration, a format change)
  if (window.SSW) { var drawWs = SSW.render; SSW.render = function () { drawWs.apply(this, arguments); render(); }; }
  render();
})();
