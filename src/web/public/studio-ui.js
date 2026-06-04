// VuGen Script Studio — UI Layer
// Split from VuGen-Script-Studio-app.js — Phase 4B
// Contains: phase/format helpers, drop zone, HAR filters,
//            code preview tabs, theme, toast, copy button.
// Dependencies: VuGen-Script-Studio-constants.js (S state)
﻿// VuGen Script Studio — Application Logic, Code Generators, and UI
// Extracted from VuGen-Script-Studio.html — Phase 3c
// Dependencies: VuGen-Script-Studio-constants.js + VuGen-Script-Studio-correlation.js

// ═══════════════════════════════════════════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════════════════════════════════════════
function showPhase(id) {
  document
    .querySelectorAll(".phase")
    .forEach((p) => p.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}
function setMsg(step, msg) {
  document.getElementById("proc-step").textContent = step;
  document.getElementById("proc-msg").textContent = msg;
}
function goBack() {
  showPhase("ph-upload");
}
function toggleCorrPanel() {
  const list = document.getElementById("corr-list");
  const icon = document.getElementById("corr-toggle-icon");
  const hidden = list.style.display === "none";
  list.style.display = hidden ? "" : "none";
  icon.textContent = hidden ? "▼" : "▶";
}
function toggleParamPanel() {
  const list = document.getElementById("param-list");
  const icon = document.getElementById("param-toggle-icon");
  const hidden = list.style.display === "none";
  list.style.display = hidden ? "" : "none";
  icon.textContent = hidden ? "▼" : "▶";
}

function setFmt(f) {
  S.format = f;
  document
    .querySelectorAll(".fmt-btn")
    .forEach((b) => b.classList.remove("active"));
  document
    .getElementById(
      "fmt-" + { webhttp: "web", devweb: "dev", both: "both" }[f],
    )
    .classList.add("active");
}

// ═══════════════════════════════════════════════════════════════════════════
// FILE LOADING
// ═══════════════════════════════════════════════════════════════════════════
function onFilePick(e, slot) {
  const f = e.target.files[0];
  if (f) loadFile(f, slot);
}
function onDrop(e, slot) {
  e.preventDefault();
  document.getElementById("dz" + slot).classList.remove("over");
  const f = e.dataTransfer.files[0];
  const nm = (f && f.name.toLowerCase()) || "";
  if (f && (nm.endsWith(".har") || nm.endsWith(".json")))
    loadFile(f, slot);
  else
    showToast(
      "Please drop a .har file or a chrome://net-export/ NetLog .json file",
      "warning",
    );
}
function onDragOver(e, slot) {
  e.preventDefault();
  document.getElementById("dz" + slot).classList.add("over");
}
function onDragLeave(slot) {
  document.getElementById("dz" + slot).classList.remove("over");
}

function loadFile(file, slot) {
  const r = new FileReader();
  r.onload = (ev) => {
    try {
      const parsed = JSON.parse(ev.target.result);
      const netlog = isNetLog(parsed);
      if (slot === 1) {
        S.har1 = parsed;
        S.isNetLog1 = netlog;
        markLoaded(1, file.name, netlog);
        studioBuildDomains(parsed);
        studioInitFilters();
        studioRenderDomains();
        const fes = document.getElementById("filter-empty-state");
        if (fes) fes.style.display = "none";
        const fs = document.getElementById("filter-section");
        if (fs) fs.style.display = "";
      } else {
        S.har2 = parsed;
        S.isNetLog2 = netlog;
        markLoaded(2, file.name, netlog);
      }
      updateUploadState();
    } catch (err) {
      showToast("Could not parse file: " + err.message, "error");
    }
  };
  r.readAsText(file);
}

function markLoaded(slot, filename, netlog) {
  const dz = document.getElementById("dz" + slot);
  dz.classList.add("loaded");
  const tag = netlog ? " [NetLog]" : "";
  document.getElementById("dz" + slot + "-name").textContent =
    "\u2713 " + filename + tag;
  document.getElementById("dz" + slot + "-name").style.display = "block";
  document.getElementById("dz" + slot + "-sub").style.display = "none";
  document.getElementById("dz" + slot + "-clear").style.display = "block";
  document.getElementById("btn-clear-hdr").style.display = "";
}

function clearSlot(slot) {
  if (slot === 1) {
    S.har1 = null;
    S.isNetLog1 = false;
    S.filterResourceTypes = null;
    S.filterDomains = {};
    S.domainStats = {};
    const fs = document.getElementById("filter-section");
    if (fs) fs.style.display = "none";
    const fes = document.getElementById("filter-empty-state");
    if (fes) fes.style.display = "";
    const dr = document.getElementById("domain-filter-row");
    if (dr) dr.style.display = "none";
  } else {
    S.har2 = null;
    S.isNetLog2 = false;
  }
  const dz = document.getElementById("dz" + slot);
  dz.classList.remove("loaded");
  document.getElementById("dz" + slot + "-name").style.display = "none";
  document.getElementById("dz" + slot + "-name").textContent = "";
  document.getElementById("dz" + slot + "-sub").style.display = "";
  document.getElementById("dz" + slot + "-clear").style.display = "none";
  // reset file input so same file can be re-selected
  const inp = dz.querySelector("input[type=file]");
  if (inp) inp.value = "";
  if (!S.har1 && !S.har2)
    document.getElementById("btn-clear-hdr").style.display = "none";
  updateUploadState();
}

function clearAll() {
  S.har1 = null;
  S.har2 = null;
  S.isNetLog1 = false;
  S.isNetLog2 = false;
  S.entries1 = [];
  S.entries2 = [];
  S.txns = [];
  S.correlations = [];
  S.candidates = [];
  S.params = [];
  S.scripts = {};
  S.auth = null;
  S.serverHost = null;
  S.filterResourceTypes = null;
  S.filterDomains = {};
  S.domainStats = {};
  const fs = document.getElementById("filter-section");
  if (fs) fs.style.display = "none";
  const fes = document.getElementById("filter-empty-state");
  if (fes) fes.style.display = "";
  const dr = document.getElementById("domain-filter-row");
  if (dr) dr.style.display = "none";
  [1, 2].forEach((slot) => {
    const dz = document.getElementById("dz" + slot);
    dz.classList.remove("loaded");
    document.getElementById("dz" + slot + "-name").style.display = "none";
    document.getElementById("dz" + slot + "-name").textContent = "";
    document.getElementById("dz" + slot + "-sub").style.display = "";
    document.getElementById("dz" + slot + "-clear").style.display =
      "none";
    const inp = dz.querySelector("input[type=file]");
    if (inp) inp.value = "";
  });
  const btn = document.getElementById("btn-analyze");
  btn.disabled = true;
  btn.textContent = "Load a HAR file to begin";
  document.getElementById("mode-badge").innerHTML =
    'Mode: <b style="color:var(--warning)">Pattern</b> (1 HAR)';
  document.getElementById("btn-clear-hdr").style.display = "none";
  showPhase("ph-upload");
}

function updateUploadState() {
  const btn = document.getElementById("btn-analyze");
  const badge = document.getElementById("mode-badge");
  if (S.har1) {
    btn.disabled = false;
    if (S.har2) {
      btn.textContent = "Analyze & Generate (Diff Mode — 2 HARs)";
      badge.innerHTML =
        'Mode: <b style="color:var(--success)">Diff</b> (2 HARs — deterministic)';
      S.mode = "two";
    } else {
      btn.textContent = "Analyze & Generate (Pattern Mode — 1 HAR)";
      badge.innerHTML =
        'Mode: <b style="color:var(--warn)">Pattern</b> (1 HAR — heuristic)';
      S.mode = "single";
    }
  } else {
    btn.disabled = true;
    btn.textContent = "Load a HAR file to begin";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HAR REQUEST FILTERS (Chrome DevTools-style resource type + domain)
// ═══════════════════════════════════════════════════════════════════════════
const STUDIO_RT_TYPES = [
  { key: "fetch",      label: "Fetch/XHR", color: "#4f8ef7" },
  { key: "document",   label: "Doc",       color: "#e8a838" },
  { key: "stylesheet", label: "CSS",       color: "#9b59b6" },
  { key: "script",     label: "JS",        color: "#f39c12" },
  { key: "font",       label: "Font",      color: "#16a085" },
  { key: "image",      label: "Img",       color: "#27ae60" },
  { key: "media",      label: "Media",     color: "#e74c3c" },
  { key: "manifest",   label: "Manifest",  color: "#8e44ad" },
  { key: "websocket",  label: "WS",        color: "#2980b9" },
  { key: "other",      label: "Other",     color: "#7f8c8d" },
];

function studioInitFilters() {
  const list = document.getElementById("rt-filter-list");
  if (!list) return;
  list.innerHTML = STUDIO_RT_TYPES.map(t =>
    `<div class="rt-filter-row rt-row-on" data-key="${t.key}" onclick="studioToggleRt('${t.key}')">
      <span class="rt-filter-dot" style="background:${t.color}"></span>
      <span class="rt-filter-label">${t.label}</span>
      <span class="rt-filter-check">&#x2713;</span>
    </div>`
  ).join("");
}

function studioToggleRt(key) {
  const list = document.getElementById("rt-filter-list");
  if (!list) return;
  if (key === "__all__") {
    S.filterResourceTypes = null;
    list.querySelectorAll(".rt-filter-row").forEach(r => r.classList.add("rt-row-on"));
    return;
  }
  const row = list.querySelector(`[data-key="${key}"]`);
  if (!row) return;
  if (!S.filterResourceTypes) {
    S.filterResourceTypes = new Set(STUDIO_RT_TYPES.map(t => t.key));
    list.querySelectorAll(".rt-filter-row").forEach(r => r.classList.add("rt-row-on"));
  }
  if (S.filterResourceTypes.has(key)) {
    S.filterResourceTypes.delete(key);
    row.classList.remove("rt-row-on");
  } else {
    S.filterResourceTypes.add(key);
    row.classList.add("rt-row-on");
  }
  if (S.filterResourceTypes.size === 0) {
    S.filterResourceTypes.add(key);
    row.classList.add("rt-row-on");
  }
  if (S.filterResourceTypes.size === STUDIO_RT_TYPES.length) {
    S.filterResourceTypes = null;
  }
}

function studioToggleRtNone() {
  const list = document.getElementById("rt-filter-list");
  if (!list) return;
  const firstKey = STUDIO_RT_TYPES[0].key;
  S.filterResourceTypes = new Set([firstKey]);
  list.querySelectorAll(".rt-filter-row").forEach(r => {
    r.classList.toggle("rt-row-on", r.dataset.key === firstKey);
  });
}

function studioBuildDomains(har) {
  const entries = (har && har.log && har.log.entries) || [];
  S.filterDomains = {};
  S.domainStats = {};
  entries.forEach(e => {
    try {
      const host = new URL(e.request.url).hostname;
      if (!host || host.endsWith(".invalid")) return; // skip transaction marker URLs
      if (!S.domainStats[host]) S.domainStats[host] = { count: 0 };
      S.domainStats[host].count++;
      if (S.filterDomains[host] === undefined) S.filterDomains[host] = true;
    } catch {}
  });
}

function studioRenderDomains(search) {
  const list = document.getElementById("domain-chip-bar");
  const row = document.getElementById("domain-filter-row");
  if (!list || !row) return;
  const hosts = Object.keys(S.domainStats);
  if (hosts.length === 0) { row.style.display = "none"; return; }
  row.style.display = "";
  const q = (search || "").trim().toLowerCase();
  const filtered = hosts
    .filter(h => !q || h.includes(q))
    .sort((a, b) => S.domainStats[b].count - S.domainStats[a].count);
  if (!filtered.length) {
    list.innerHTML = `<div class="studio-dp-empty">No match</div>`;
    return;
  }
  const total = hosts.length;
  const active = Object.values(S.filterDomains).filter(Boolean).length;
  const searchEl = document.getElementById("studio-dp-search");
  if (searchEl) searchEl.placeholder = `Search domains… (${active}/${total})`;
  list.innerHTML = filtered.map(h => {
    const on = S.filterDomains[h] !== false;
    const hEsc = h.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    return `<div class="studio-dp-row${on ? "" : " sdp-off"}" onclick="studioToggleDomain('${hEsc}')">
      <input type="checkbox" ${on ? "checked" : ""} onclick="event.stopPropagation();studioToggleDomain('${hEsc}',this.checked)">
      <span class="studio-dp-name">${h}</span>
      <span class="studio-dp-cnt">${S.domainStats[h].count}req</span>
    </div>`;
  }).join("");
}

function studioToggleDomain(host, state) {
  S.filterDomains[host] = state !== undefined ? state : (S.filterDomains[host] === false ? true : false);
  studioRenderDomains(document.getElementById("studio-dp-search")?.value || "");
}

function studioToggleAllDomains(show) {
  Object.keys(S.filterDomains).forEach(h => { S.filterDomains[h] = show; });
  studioRenderDomains(document.getElementById("studio-dp-search")?.value || "");
}


// ═══════════════════════════════════════════════════════════════════════════
// CODE PREVIEW
// ═══════════════════════════════════════════════════════════════════════════
function switchTab(el, tab) {
  document
    .querySelectorAll(".code-tab")
    .forEach((t) => t.classList.remove("act"));
  el.classList.add("act");
  S.tab = tab;
  document.getElementById("code-body").textContent =
    S.scripts[tab] || "// Not generated";
}

// ═══════════════════════════════════════════════════════════════════════════
// RENDER RESULTS
// ═══════════════════════════════════════════════════════════════════════════
function renderCorrelations() {
  const list = document.getElementById("corr-list");
  let html = "";

  // HAR quality warning
  if (S.harWarning) {
    html += `<div style="background:var(--warn-bg);border:1px solid var(--warn);border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:12px;color:var(--warn)">
<b>&#x26A0; Recording Warning:</b> ${esc(S.harWarning)}
    </div>`;
  }

  // Resolved correlations
  if (S.correlations.length > 0) {
    html += S.correlations
      .map((c) => {
        const typeClass =
          c.extractorType === "jsonpath"
            ? "jsonpath"
            : c.extractorType === "cookie"
              ? "cookie"
              : c.extractorType === "html"
                ? "html"
                : "boundary";
        const typeLabel =
          c.extractorType === "jsonpath"
            ? "JSON"
            : c.extractorType === "cookie"
              ? "Cookie"
              : c.extractorType === "html"
                ? "HTML"
                : c.extractorType === "boundary_header"
                  ? "Header"
                  : "Boundary";
        const srcEntry = S.entries1[c.sourceIdx];
        const srcUrl = srcEntry
          ? srcEntry.url.split("?")[0].substring(0, 60)
          : "?";
        const usageCount = c.usages.length;
        return `<div class="corr-item">
  <span class="corr-badge ${typeClass}">${typeLabel}</span>
  <div class="corr-detail">
    <div class="corr-name">${esc(c.name)}</div>
    <div class="corr-src">Extracted from: …${esc(srcUrl.slice(-50))}</div>
    <div class="corr-usage">Used in ${usageCount} request${usageCount !== 1 ? "s" : ""}</div>
  </div>
</div>`;
      })
      .join("");
  }

  // Unresolved candidates (changed but source not found)
  if (S.candidates.length > 0) {
    if (S.correlations.length > 0)
      html += `<div style="border-top:1px solid var(--border);margin:8px 0"></div>`;
    html += `<div style="font-size:11px;color:var(--warn);font-weight:600;margin-bottom:4px">Unresolved — source not found:</div>
    <div style="font-size:10px;color:var(--muted);margin-bottom:6px">Response body was empty (browser cache). Re-record with <b>Disable Cache</b> checked in DevTools Network tab to resolve automatically.</div>`;
    html += S.candidates
      .map((c) => {
        const usageUrl =
          c.usages.length > 0
            ? c.usages[0].key +
              "  in  " +
              c.usages[0].reqUrl.split("?")[0].slice(-50)
            : "";
        return `<div class="corr-item" style="opacity:.75">
  <span class="corr-badge html">TODO</span>
  <div class="corr-detail">
    <div class="corr-name" style="color:var(--warn)">${esc(c.hint)}</div>
    <div class="corr-src" title="${esc(c.value)}" style="font-family:var(--mono);font-size:10px">Value: ${esc(c.value.substring(0, 60))}${c.value.length > 60 ? "…" : ""}</div>
    <div class="corr-usage">Used as: ${esc(usageUrl)}</div>
  </div>
</div>`;
      })
      .join("");
  }

  if (!html) {
    html =
      '<div style="color:var(--muted);font-size:12px;padding:8px 0">No dynamic values detected.</div>';
  }

  list.innerHTML = html;
}

function renderParams() {
  const panel = document.getElementById("param-panel");
  const list = document.getElementById("param-list");
  if (!S.params || S.params.length === 0) {
    panel.style.display = "none";
    return;
  }
  panel.style.display = "";
  // Always show list expanded when (re-)rendering after analysis
  list.style.display = "";
  const icon = document.getElementById("param-toggle-icon");
  if (icon) icon.textContent = "▼";
  let html = "";
  html += `<div style="font-size:11px;color:var(--muted);padding:4px 0 8px">
    These values were detected as user-entered test data. They will be parameterized using <b>load.params.*</b> (DevWeb)
    and <b>{ParamName}</b> (Web HTTP/HTML) with a CSV data file for data-driven testing.</div>`;
  html += S.params
    .map((p) => {
      const usageCount = p.usages.length;
      const usageLocations = [
        ...new Set(p.usages.map((u) => u.location)),
      ].join(", ");
      return `<div class="corr-item">
<span class="corr-badge jsonpath">CSV</span>
<div class="corr-detail">
  <div class="corr-name">${esc(p.csvKey)}</div>
  <div class="corr-src">Sample value: <span style="font-family:var(--mono);font-size:11px">${esc(p.name === "Password" ? "••••••" : p.value.substring(0, 60))}</span></div>
  <div class="corr-usage">Used in ${usageCount} request${usageCount !== 1 ? "s" : ""} &nbsp;|&nbsp; ${esc(usageLocations)}</div>
</div>
    </div>`;
    })
    .join("");
  list.innerHTML = html;
}

function renderTabs() {
  const tabs = document.getElementById("code-tabs");
  const isWeb = S.format === "webhttp" || S.format === "both";
  const isDev = S.format === "devweb" || S.format === "both";
  const hasParams = S.params && S.params.length > 0;
  let html = "";
  if (isWeb) {
    html += `<div class="code-tab${S.tab === "ac" ? " act" : ""}" onclick="switchTab(this,'ac')">Action.c</div>`;
    html += `<div class="code-tab${S.tab === "vi" ? " act" : ""}" onclick="switchTab(this,'vi')">vuser_init.c</div>`;
    if (hasParams) {
      html += `<div class="code-tab${S.tab === "prm" ? " act" : ""}" onclick="switchTab(this,'prm')">ParameterFile.prm</div>`;
      html += `<div class="code-tab${S.tab === "dat" ? " act" : ""}" onclick="switchTab(this,'dat')">collection_data.dat</div>`;
    }
  }
  if (isDev) {
    html += `<div class="code-tab${S.tab === "mj" ? " act" : ""}" onclick="switchTab(this,'mj')">main.js</div>`;
    if (S.scripts && S.scripts.corrjs)
      html += `<div class="code-tab${S.tab === "corrjs" ? " act" : ""}" onclick="switchTab(this,'corrjs')">correlations.js</div>`;
    if (hasParams) {
      html += `<div class="code-tab${S.tab === "pyml" ? " act" : ""}" onclick="switchTab(this,'pyml')">parameters.yml</div>`;
      html += `<div class="code-tab${S.tab === "csv" ? " act" : ""}" onclick="switchTab(this,'csv')">collection_data.csv</div>`;
    }
  }
  tabs.innerHTML = html;
}

function renderDlBar() {
  const bar = document.getElementById("dl-bar");
  const isWeb = S.format === "webhttp" || S.format === "both";
  const isDev = S.format === "devweb" || S.format === "both";
  let html = "<label>Download:</label>";
  if (isWeb)
    html += `<button class="btn btn-success" onclick="dlZip('webhttp')">⬇ Web HTTP/HTML ZIP</button>`;
  if (isDev)
    html += `<button class="btn btn-primary" onclick="dlZip('devweb')">⬇ DevWeb ZIP</button>`;
  if (isWeb && isDev)
    html += `<button class="btn btn-both" onclick="dlZip('both')">⬇ Download Both</button>`;
  bar.innerHTML = html;
}



// ═══════════════════════════════════════════════════════════════════════════
// THEME TOGGLE + PORTAL INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════

// Called by parent portal to sync theme
window.lrePortalInit = function (theme) {
  document.documentElement.setAttribute("data-theme", theme || "dark");
  localStorage.setItem("ss-theme", theme || "dark");
  var icon = document.getElementById("theme-icon");
  if (icon) {
    var p = icon.closest ? icon.closest("button") : null;
    if (p) p.style.display = "none";
  }
};
window.lreSetTheme = function (theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("ss-theme", theme);
};

function toggleTheme() {
  var html = document.documentElement;
  var light = html.getAttribute("data-theme") === "light";
  html.setAttribute("data-theme", light ? "dark" : "light");
  localStorage.setItem("ss-theme", light ? "dark" : "light");
  var icon = document.getElementById("theme-icon");
  if (icon) icon.textContent = light ? "\u2600" : "\u263D";
}
(function () {
  var t = localStorage.getItem("ss-theme") || "dark";
  document.documentElement.setAttribute("data-theme", t);
  // Set icon after DOM loads
  window.addEventListener("DOMContentLoaded", function () {
    var icon = document.getElementById("theme-icon");
    if (icon) icon.textContent = t === "light" ? "\u263D" : "\u2600";
  });
})();

// ═══════════════════════════════════════════════════════════════════════════
// TOAST NOTIFICATION SYSTEM
// ═══════════════════════════════════════════════════════════════════════════
function showToast(msg, type, duration) {
  type = type || "info";
  duration = duration || 4000;
  var icons = {
    success: "\u2714",
    error: "\u2716",
    warning: "\u26A0",
    info: "\u2139",
  };
  var container = document.getElementById("toast-container");
  if (!container) return;
  var t = document.createElement("div");
  t.className = "toast toast-" + type;
  t.innerHTML =
    '<span class="toast-icon">' +
    icons[type] +
    '</span><span class="toast-msg">' +
    msg +
    "</span>";
  container.appendChild(t);
  setTimeout(function () {
    t.style.animation = "toastOut .3s ease forwards";
    setTimeout(function () {
      if (t.parentNode) t.parentNode.removeChild(t);
    }, 300);
  }, duration);
}

// ═══════════════════════════════════════════════════════════════════════════
// COPY CODE BUTTON
// ═══════════════════════════════════════════════════════════════════════════
function copyCode() {
  var pre = document.getElementById("code-body");
  var btn = document.getElementById("btn-copy");
  if (!pre || !btn) return;
  navigator.clipboard
    .writeText(pre.textContent || "")
    .then(function () {
      btn.textContent = "\u2714 Copied!";
      btn.classList.add("copied");
      setTimeout(function () {
        btn.textContent = "\uD83D\uDCCB Copy";
        btn.classList.remove("copied");
      }, 2000);
    })
    .catch(function () {
      showToast(
        "Copy failed — please select and copy manually.",
        "error",
      );
    });
}