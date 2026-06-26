// VuGen Script Studio — UI Layer
// Split from VuGen-Script-Studio-app.js — Phase 4B
// Contains: phase/format helpers, drop zone, HAR filters,
//            code preview tabs, theme, toast, copy button.
// Dependencies: VuGen-Script-Studio-constants.js (S state)
// VuGen Script Studio — Application Logic, Code Generators, and UI
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
    .getElementById("fmt-" + { webhttp: "web", devweb: "dev", both: "both" }[f])
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
  if (f && (nm.endsWith(".har") || nm.endsWith(".json"))) loadFile(f, slot);
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
  S.advisorCandidates = [];
  const advPanel = document.getElementById("adv-panel");
  if (advPanel) advPanel.style.display = "none";
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
    document.getElementById("dz" + slot + "-clear").style.display = "none";
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
  { key: "fetch", label: "Fetch/XHR", color: "#4f8ef7" },
  { key: "document", label: "Doc", color: "#e8a838" },
  { key: "stylesheet", label: "CSS", color: "#9b59b6" },
  { key: "script", label: "JS", color: "#f39c12" },
  { key: "font", label: "Font", color: "#16a085" },
  { key: "image", label: "Img", color: "#27ae60" },
  { key: "media", label: "Media", color: "#e74c3c" },
  { key: "manifest", label: "Manifest", color: "#8e44ad" },
  { key: "websocket", label: "WS", color: "#2980b9" },
  { key: "other", label: "Other", color: "#7f8c8d" },
];
// Default: only Fetch/XHR and Document enabled — static resources (CSS/JS/images/fonts) are
// excluded by default as they are not relevant to performance test scripting.
const STUDIO_RT_DEFAULT = new Set(["fetch", "document"]);

function studioInitFilters() {
  const list = document.getElementById("rt-filter-list");
  if (!list) return;
  list.innerHTML = STUDIO_RT_TYPES.map((t) => {
    const on = STUDIO_RT_DEFAULT.has(t.key);
    return `<div class="rt-filter-row ${on ? "rt-row-on" : ""}" data-key="${t.key}" onclick="studioToggleRt('${t.key}')">
      <span class="rt-filter-dot" style="background:${t.color}"></span>
      <span class="rt-filter-label">${t.label}</span>
      <span class="rt-filter-check">&#x2713;</span>
    </div>`;
  }).join("");
  // Initialise S.filterResourceTypes to the default subset (not null="show all")
  S.filterResourceTypes = new Set(STUDIO_RT_DEFAULT);
}

function studioToggleRt(key) {
  const list = document.getElementById("rt-filter-list");
  if (!list) return;
  if (key === "__all__") {
    S.filterResourceTypes = null;
    list
      .querySelectorAll(".rt-filter-row")
      .forEach((r) => r.classList.add("rt-row-on"));
    return;
  }
  const row = list.querySelector(`[data-key="${key}"]`);
  if (!row) return;
  if (!S.filterResourceTypes) {
    S.filterResourceTypes = new Set(STUDIO_RT_TYPES.map((t) => t.key));
    list
      .querySelectorAll(".rt-filter-row")
      .forEach((r) => r.classList.add("rt-row-on"));
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
  list.querySelectorAll(".rt-filter-row").forEach((r) => {
    r.classList.toggle("rt-row-on", r.dataset.key === firstKey);
  });
}

function studioBuildDomains(har) {
  const entries = (har && har.log && har.log.entries) || [];
  S.filterDomains = {};
  S.domainStats = {};
  entries.forEach((e) => {
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
  if (hosts.length === 0) {
    row.style.display = "none";
    return;
  }
  row.style.display = "";
  const q = (search || "").trim().toLowerCase();
  const filtered = hosts
    .filter((h) => !q || h.includes(q))
    .sort((a, b) => S.domainStats[b].count - S.domainStats[a].count);
  if (!filtered.length) {
    list.innerHTML = `<div class="studio-dp-empty">No match</div>`;
    return;
  }
  const total = hosts.length;
  const active = Object.values(S.filterDomains).filter(Boolean).length;
  const searchEl = document.getElementById("studio-dp-search");
  if (searchEl) searchEl.placeholder = `Search domains… (${active}/${total})`;
  list.innerHTML = filtered
    .map((h) => {
      const on = S.filterDomains[h] !== false;
      const hEsc = h.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      return `<div class="studio-dp-row${on ? "" : " sdp-off"}" onclick="studioToggleDomain('${hEsc}')">
      <input type="checkbox" ${on ? "checked" : ""} onclick="event.stopPropagation();studioToggleDomain('${hEsc}',this.checked)">
      <span class="studio-dp-name">${h}</span>
      <span class="studio-dp-cnt">${S.domainStats[h].count}req</span>
    </div>`;
    })
    .join("");
}

function studioToggleDomain(host, state) {
  S.filterDomains[host] =
    state !== undefined
      ? state
      : S.filterDomains[host] === false
        ? true
        : false;
  studioRenderDomains(document.getElementById("studio-dp-search")?.value || "");
}

function studioToggleAllDomains(show) {
  Object.keys(S.filterDomains).forEach((h) => {
    S.filterDomains[h] = show;
  });
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
          c.extractorType === "jsonpath" || c.extractorType === "random_select"
            ? "jsonpath"
            : c.extractorType === "cookie"
              ? "cookie"
              : c.extractorType === "html"
                ? "html"
                : "boundary";
        const typeLabel =
          c.extractorType === "jsonpath"
            ? "JSON"
            : c.extractorType === "random_select"
              ? "RandSel"
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
        const advisorBadge = c._fromAdvisor
          ? `<span class="corr-advisor-badge">Advisor</span>`
          : "";
        const _siIsSelectAll = (c.extractorType === "jsonpath" && c.extractorConfig && c.extractorConfig.selectAll) || c.extractorType === "random_select";
        const _siIdx = S.correlations.indexOf(c);
        const randBtn = _siIsSelectAll
          ? `<button class="corr-rnd-btn${c.extractorType === "random_select" ? " active" : ""}" onclick="toggleCorrRandSelect(${_siIdx})" title="${c.extractorType === "random_select" ? "Switch back to SelectAll" : "Switch to Random Select (pick one per iteration)"}">&#x1F3B2; Rnd</button>`
          : "";
        return `<div class="corr-item">
  <span class="corr-badge ${typeClass}">${typeLabel}</span>
  <div class="corr-detail">
    <div class="corr-name">${esc(c.name)}${advisorBadge}${randBtn}</div>
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
      const usageLocations = [...new Set(p.usages.map((u) => u.location))].join(
        ", ",
      );
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
      showToast("Copy failed — please select and copy manually.", "error");
    });
}

// =============================================================================
// CORRELATION ADVISOR UI
// All functions prefixed adv* / advisor* to avoid name collisions.
// Reads/writes S.advisorCandidates. Calls advisorToCorrelation() from
// studio-advisor.js and regenerateFromAdvisor() from studio-app.js.
// =============================================================================

// ---------------------------------------------------------------------------
// Render the full advisor panel from S.advisorCandidates
// ---------------------------------------------------------------------------
function renderAdvisorPanel() {
  var panel = document.getElementById("adv-panel");
  if (!panel) return;

  var candidates = S.advisorCandidates || [];
  if (candidates.length === 0) {
    panel.style.display = "none";
    return;
  }
  panel.style.display = "";

  // Re-render cards
  var cardsEl = document.getElementById("adv-cards");
  if (cardsEl) cardsEl.innerHTML = candidates.map(_advCardHtml).join("");

  // Re-populate inspector dropdown (entries may have changed)
  _advBuildInspectorDropdown();

  _advUpdateBadge();
  _advUpdateFooter();
}

// ---------------------------------------------------------------------------
// Build HTML for one candidate card
// ---------------------------------------------------------------------------
function _advCardHtml(c) {
  var typeCls = "adv-type-" + (c.valueType || "unknown");
  var typeLabel = (c.valueType || "token").toUpperCase();
  var confCls = "adv-conf-" + c.confidence;
  var confLabel = c.confidence === "high" ? "High confidence" : "Pattern match";
  var cardCls = "adv-card adv-card-" + c.confidence;
  if (c.status === "accepted") cardCls += " adv-card-accepted";
  if (c.status === "skipped") cardCls += " adv-card-skipped";

  var srcHtml = c.source
    ? '<span class="adv-flow-src">&#x2190; From</span> <b>' +
      _esc(c.source.url) +
      "</b>" +
      (c.source.jsonPath
        ? " &rarr; <b>" + _esc(c.source.jsonPath) + "</b>"
        : "")
    : '<span style="color:var(--text-3)">Source not found in HAR</span>';

  var usageCount = (c.usages || []).length;
  var firstUsage = c.usages && c.usages[0];
  var useHtml = firstUsage
    ? '<span class="adv-flow-use">&#x2192; Used in</span> <b>' +
      _esc(firstUsage.location) +
      "</b>" +
      (firstUsage.url ? " &mdash; " + _esc(firstUsage.url) : "") +
      (usageCount > 1
        ? ' <span style="color:var(--text-3)">+' +
          (usageCount - 1) +
          " more</span>"
        : "")
    : '<span style="color:var(--text-3)">No request body usage found</span>';

  var manualTag = c._manual
    ? '<span class="adv-manual-tag">Manual</span>'
    : c._arrayReconstruct
      ? '<span class="adv-manual-tag adv-tag-array-reconstr">&#x2735; Array Reconstruct</span>'
      : c._selectAll
        ? '<span class="adv-manual-tag" style="background:rgba(16,185,129,0.15);color:#10b981">Array</span>'
        : "";

  var acceptActive = c.status === "accepted" ? " adv-btn-active" : "";
  var skipActive = c.status === "skipped" ? " adv-btn-active" : "";

  // Extra detail block for array reconstruct candidates
  var extraDetail = "";
  if (c._arrayReconstruct && c._arrayConfig) {
    var cols = c._arrayConfig.columns || [];
    var statics = c._arrayConfig.staticFields || [];
    var arrCfg = c._arrayConfig;
    var hasPlaceholders = cols.some(function(col) { return col._placeholder; });
    var hasRealCols    = cols.some(function(col) { return !col._placeholder && col.sourceJsonPath; });

    // Find current anchor's targetKey by matching varName → countVar
    var currentPrimaryKey = '';
    for (var _pi = 0; _pi < cols.length; _pi++) {
      if (cols[_pi].varName === arrCfg.countVar) { currentPrimaryKey = cols[_pi].targetKey; break; }
    }

    // Build primary-key dropdown (all non-static columns, including placeholders)
    var pkSelectId = 'pk-' + c.id;
    var pkOptions = cols.map(function(col) {
      var sel = col.targetKey === currentPrimaryKey ? ' selected' : '';
      var warn = col._placeholder ? ' (needs correlation)' : '';
      return '<option value="' + _esc(col.targetKey) + '"' + sel + '>' + _esc(col.targetKey) + warn + '</option>';
    }).join('');

    var pkRow = '<div style="display:flex;align-items:center;gap:8px;padding:6px 0 6px;flex-wrap:wrap;">' +
      '<span style="font-size:11px;color:var(--text-2);white-space:nowrap;">Primary key (loop anchor):</span>' +
      '<select id="' + pkSelectId + '" style="font-size:11px;padding:2px 6px;border:1px solid var(--border-1);border-radius:4px;background:var(--bg-2);color:var(--text-1);">' +
      pkOptions + '</select>';

    if (hasPlaceholders && hasRealCols) {
      // Show "Fill & apply" — infers missing source paths and sets anchor in one click
      pkRow +=
        '<button onclick="advisorFillArrayPaths(\'' + c.id + '\',document.getElementById(\'' + pkSelectId + '\').value);renderAdvisorPanel();" ' +
        'style="font-size:11px;padding:2px 10px;border-radius:4px;border:none;background:var(--accent-1,#6366f1);color:#fff;cursor:pointer;white-space:nowrap;">' +
        'Fill &amp; apply</button>' +
        '<span style="font-size:10px;color:var(--text-3);">auto-infers missing source paths</span>';
    } else if (!hasPlaceholders) {
      // All paths already filled — only anchor change is possible
      pkRow +=
        '<button onclick="advisorSetArrayAnchor(\'' + c.id + '\',document.getElementById(\'' + pkSelectId + '\').value);renderAdvisorPanel();" ' +
        'style="font-size:11px;padding:2px 10px;border-radius:4px;border:1px solid var(--border-1);background:var(--bg-3,#1a1a2e);color:var(--text-1);cursor:pointer;">' +
        'Set anchor</button>';
    }
    pkRow += '</div>';

    extraDetail =
      pkRow +
      '<div class="adv-arr-detail">' +
      '<table class="adv-arr-table">' +
      "<thead><tr><th>Source path</th><th>Variable</th><th>Target key</th></tr></thead>" +
      "<tbody>" +
      cols.map(function (col) {
          var isAnchor = col.varName === arrCfg.countVar;
          var sourceCel = col._placeholder
            ? '<span style="color:var(--text-3);font-style:italic">needs correlation</span>'
            : '<code>' + _esc(col.sourceJsonPath) + '</code>';
          var anchorBadge = isAnchor
            ? ' <span style="font-size:9px;background:var(--accent-1,#6366f1);color:#fff;border-radius:3px;padding:0 4px;vertical-align:middle;margin-left:3px;">anchor</span>'
            : '';
          return (
            "<tr" + (col._placeholder ? ' style="opacity:0.65"' : '') + ">" +
            "<td>" + sourceCel + "</td>" +
            "<td><code>" + _esc(col.varName) + "</code>" + anchorBadge + "</td>" +
            "<td><code>" + _esc(col.targetKey) + "</code></td>" +
            "</tr>"
          );
        }).join("") +
      (statics.length > 0
        ? statics.map(function (sf) {
            return (
              '<tr class="adv-arr-static">' +
              "<td><em>static</em></td>" +
              "<td><em>" + _esc(sf.value) + "</em></td>" +
              "<td><code>" + _esc(sf.targetKey) + "</code></td>" +
              "</tr>"
            );
          }).join("")
        : "") +
      "</tbody></table></div>";
  }

  return (
    '<div class="' +
    cardCls +
    '" id="advc-' +
    c.id +
    '">' +
    '<div class="adv-card-left">' +
    '<div class="adv-card-meta">' +
    '<span class="adv-type-badge ' +
    typeCls +
    '">' +
    typeLabel +
    "</span>" +
    '<span class="adv-conf-dot ' +
    confCls +
    '"></span>' +
    '<span class="adv-conf-label">' +
    confLabel +
    "</span>" +
    manualTag +
    "</div>" +
    '<div class="adv-card-value">' +
    _esc(c.preview) +
    "</div>" +
    '<div class="adv-card-flow">' +
    srcHtml +
    "</div>" +
    '<div class="adv-card-flow">' +
    useHtml +
    "</div>" +
    extraDetail +
    '<div class="adv-card-name-row">' +
    '<span class="adv-card-name-label">Variable name</span>' +
    '<input class="adv-card-name-input" value="' +
    _esc(c.varName) +
    '" ' +
    "oninput=\"advisorSetName('" +
    c.id +
    "',this.value)\" " +
    'placeholder="variableName" />' +
    "</div>" +
    "</div>" +
    '<div class="adv-card-right">' +
    '<div class="adv-card-actions">' +
    '<button class="adv-btn-accept' +
    acceptActive +
    '" onclick="advisorAccept(\'' +
    c.id +
    '\')" title="Add this correlation to the script">&#x2713; Accept</button>' +
    '<button class="adv-btn-skip' +
    skipActive +
    '" onclick="advisorSkip(\'' +
    c.id +
    '\')" title="Dismiss this suggestion">&#x2715; Skip</button>' +
    "</div>" +
    "</div>" +
    "</div>"
  );
}

// ---------------------------------------------------------------------------
// User actions on individual cards
// ---------------------------------------------------------------------------
function advisorAccept(id) {
  var c = _advFindById(id);
  if (!c) return;
  c.status = c.status === "accepted" ? "pending" : "accepted"; // toggle
  _advRefreshCard(c);
  _advUpdateBadge();
  _advUpdateFooter();
}

function advisorSkip(id) {
  var c = _advFindById(id);
  if (!c) return;
  c.status = c.status === "skipped" ? "pending" : "skipped"; // toggle
  _advRefreshCard(c);
  _advUpdateBadge();
  _advUpdateFooter();
}

function advisorSetName(id, val) {
  var c = _advFindById(id);
  if (c) c.varName = val.trim() || c.varName;
}

// ---------------------------------------------------------------------------
// Panel collapse toggle
// ---------------------------------------------------------------------------
function toggleAdvisorPanel() {
  var panel = document.getElementById("adv-panel");
  if (panel) panel.classList.toggle("adv-collapsed");
}

// ---------------------------------------------------------------------------
// Manual add modal — field browser redesign
// State for the field browser (module-level globals)
// ---------------------------------------------------------------------------
var _advFieldList = []; // [{path, value, extType}]
var _advSelectedField = null; // the field the user clicked
var _advSrcEntries = []; // [{idx, label}] — non-filtered requests for source dropdown

function _advBuildSrcDropdown(filterText) {
  var sel = document.getElementById("adv-src-select");
  if (!sel) return;
  var q = (filterText || "").toLowerCase();
  var items = q
    ? _advSrcEntries.filter(function (e) {
        return e.label.toLowerCase().indexOf(q) !== -1;
      })
    : _advSrcEntries;
  sel.innerHTML =
    '<option value="">— select a request —</option>' +
    items
      .map(function (e) {
        return '<option value="' + e.idx + '">' + _esc(e.label) + "</option>";
      })
      .join("");
}

function filterAdvisorSrcDropdown(text) {
  _advBuildSrcDropdown(text);
}

function openAdvisorModal() {
  _advFieldList = [];
  _advSelectedField = null;

  // Build source dropdown entries (skip markers AND filtered-out requests)
  _advSrcEntries = (S.entries1 || []).reduce(function (acc, e, i) {
    if (e.isMarker || e.filtered) return acc;
    var method = (e.method || "GET").toUpperCase();
    var url =
      (e.url || "").replace(/^https?:\/\/[^/]+/, "").split("?")[0] || "/";
    acc.push({ idx: i, label: method + " " + url });
    return acc;
  }, []);
  _advBuildSrcDropdown("");

  // Reset UI state
  var srcFilter = document.getElementById("adv-src-filter");
  if (srcFilter) srcFilter.value = "";
  var fbSection = document.getElementById("adv-fb-section");
  if (fbSection) fbSection.style.display = "none";
  var infoEl = document.getElementById("adv-selected-info");
  if (infoEl) infoEl.style.display = "none";
  var submitBtn = document.getElementById("adv-modal-submit-btn");
  if (submitBtn) submitBtn.disabled = true;
  var nameInput = document.getElementById("adv-varname-input");
  if (nameInput) nameInput.value = "";
  var searchInput = document.getElementById("adv-fb-search");
  if (searchInput) searchInput.value = "";

  var overlay = document.getElementById("adv-modal-overlay");
  if (overlay) overlay.style.display = "flex";
}

function closeAdvisorModal() {
  var overlay = document.getElementById("adv-modal-overlay");
  if (overlay) overlay.style.display = "none";
}

// Called when source dropdown changes — parse selected response and populate field browser
function onAdvisorSrcChange(idxStr) {
  _advFieldList = [];
  _advSelectedField = null;

  var infoEl = document.getElementById("adv-selected-info");
  if (infoEl) infoEl.style.display = "none";
  var submitBtn = document.getElementById("adv-modal-submit-btn");
  if (submitBtn) submitBtn.disabled = true;
  var nameInput = document.getElementById("adv-varname-input");
  if (nameInput) nameInput.value = "";

  var idx = parseInt(idxStr, 10);
  if (isNaN(idx) || idx < 0) {
    var fbSec = document.getElementById("adv-fb-section");
    if (fbSec) fbSec.style.display = "none";
    return;
  }
  var entry = (S.entries1 || [])[idx];
  if (!entry) {
    var fbSec2 = document.getElementById("adv-fb-section");
    if (fbSec2) fbSec2.style.display = "none";
    return;
  }

  // --- Parse JSON response body ---
  var body = entry.respBody || "";
  var bodyObj = _advParseJson(body); // defined in studio-advisor.js (shared global)
  if (bodyObj) {
    _advWalkLeaves(
      bodyObj,
      "$",
      function (val, path) {
        if (!val || val.length < 4) return;
        _advFieldList.push({ path: path, value: val, extType: "jsonpath" });
      },
      0,
    );
  }

  // --- Parse response headers (skip infrastructure headers) ---
  var SKIP_RESP_HDRS = new Set([
    "content-type",
    "content-length",
    "content-encoding",
    "transfer-encoding",
    "connection",
    "date",
    "server",
    "x-powered-by",
    "x-frame-options",
    "strict-transport-security",
    "x-content-type-options",
    "x-xss-protection",
    "access-control-allow-origin",
    "access-control-allow-methods",
    "access-control-allow-headers",
    "access-control-max-age",
    "vary",
    "cache-control",
    "pragma",
    "expires",
    "etag",
    "last-modified",
    "p3p",
    "x-ua-compatible",
    "content-security-policy",
  ]);
  var hdrs = entry.respHdrsMap || {};
  Object.keys(hdrs)
    .sort()
    .forEach(function (k) {
      if (SKIP_RESP_HDRS.has(k)) return;
      var val = hdrs[k] || "";
      if (val.length < 4) return;
      _advFieldList.push({ path: k, value: val, extType: "header" });
    });

  // Reset search and render
  var searchInput = document.getElementById("adv-fb-search");
  if (searchInput) searchInput.value = "";
  _advRenderFieldList(_advFieldList);

  var fbSection = document.getElementById("adv-fb-section");
  if (fbSection) fbSection.style.display = "";
}

// Filter field list by search query
function filterAdvisorFields(query) {
  var q = (query || "").toLowerCase();
  var filtered = q
    ? _advFieldList.filter(function (f) {
        return (
          f.path.toLowerCase().indexOf(q) !== -1 ||
          f.value.toLowerCase().indexOf(q) !== -1
        );
      })
    : _advFieldList;
  _advRenderFieldList(filtered, true);
}

// Render field browser list HTML
function _advRenderFieldList(fields, preserveSelection) {
  var listEl = document.getElementById("adv-fb-list");
  if (!listEl) return;
  if (!fields || !fields.length) {
    listEl.innerHTML =
      '<div class="adv-fb-empty">No fields found in this response.</div>';
    return;
  }
  listEl.innerHTML = fields
    .map(function (f) {
      var origIdx = _advFieldList.indexOf(f);
      var isSelected =
        preserveSelection && _advSelectedField && _advSelectedField === f;
      var extTypeCls =
        f.extType === "header"
          ? "adv-fb-hdr"
          : f.extType === "boundary"
            ? "adv-fb-arr"
            : "adv-fb-json";
      var extTypeLabel =
        f.extType === "header"
          ? "HDR"
          : f.extType === "boundary"
            ? "BODY"
            : "JSON";
      var valPreview =
        f.value.length > 40 ? f.value.slice(0, 40) + "…" : f.value;
      return (
        '<div class="adv-fb-item' +
        (isSelected ? " adv-fb-selected" : "") +
        '" onclick="selectAdvisorField(' +
        origIdx +
        ')">' +
        '<span class="adv-fb-type ' +
        extTypeCls +
        '">' +
        extTypeLabel +
        "</span>" +
        '<span class="adv-fb-path">' +
        _esc(f.path) +
        "</span>" +
        '<span class="adv-fb-value">' +
        _esc(valPreview) +
        "</span>" +
        "</div>"
      );
    })
    .join("");
}

// Called when user clicks a field in the browser
function selectAdvisorField(origIdx) {
  var field = _advFieldList[origIdx];
  if (!field) return;
  _advSelectedField = field;

  // Update selected-info display
  var typeEl = document.getElementById("adv-sel-type");
  var pathEl = document.getElementById("adv-sel-path");
  var valEl = document.getElementById("adv-sel-value");
  if (typeEl) {
    typeEl.textContent = field.extType === "header" ? "HDR" : "JSON";
    typeEl.className =
      "adv-fb-type " +
      (field.extType === "header" ? "adv-fb-hdr" : "adv-fb-json");
  }
  if (pathEl) pathEl.textContent = field.path;
  if (valEl)
    valEl.textContent =
      field.value.length > 50 ? field.value.slice(0, 50) + "…" : field.value;

  var infoEl = document.getElementById("adv-selected-info");
  if (infoEl) infoEl.style.display = "flex";

  // Auto-suggest variable name (only if still empty)
  var nameInput = document.getElementById("adv-varname-input");
  if (nameInput && !nameInput.value.trim()) {
    // _advSuggestName is a global from studio-advisor.js
    nameInput.value = _advSuggestName(
      field.extType === "jsonpath" ? field.path : null,
      field.extType === "header" ? field.path : null,
      field.value,
    );
  }

  // Enable submit
  var submitBtn = document.getElementById("adv-modal-submit-btn");
  if (submitBtn) submitBtn.disabled = false;

  // Re-render the field list to update the selected highlight
  var searchEl = document.getElementById("adv-fb-search");
  var q = searchEl ? searchEl.value.toLowerCase() : "";
  _advRenderFieldList(
    q
      ? _advFieldList.filter(function (f) {
          return (
            f.path.toLowerCase().indexOf(q) !== -1 ||
            f.value.toLowerCase().indexOf(q) !== -1
          );
        })
      : _advFieldList,
    true,
  );
}

function submitAdvisorManual() {
  var srcIdx = parseInt(
    (document.getElementById("adv-src-select") || {}).value,
    10,
  );
  var varName = (
    (document.getElementById("adv-varname-input") || {}).value || ""
  ).trim();

  if (!_advSelectedField) {
    showToast("Please select a field from the browser first.", "warning");
    return;
  }
  if (!varName) {
    showToast("Please enter a variable name.", "warning");
    return;
  }

  advisorAddManual(
    srcIdx,
    _advSelectedField.extType,
    _advSelectedField.path,
    varName,
    _advSelectedField.value,
  );
  _advSelectedField = null;
  closeAdvisorModal();
  renderAdvisorPanel();
  showToast(
    "Correlation added — click Apply & Regenerate to update the script.",
    "success",
  );
}

// Keep for backward compatibility (old radio buttons called this; no longer in the new modal)
function advisorModalTypeChange(type) {
  /* no-op — field browser auto-detects type */
}

// ---------------------------------------------------------------------------
// Apply accepted candidates and regenerate (called from footer button)
// Delegates heavy lifting to regenerateFromAdvisor() in studio-app.js
// ---------------------------------------------------------------------------
function advisorApplyAndRegen() {
  var accepted = (S.advisorCandidates || []).filter(function (c) {
    return c.status === "accepted";
  });
  if (!accepted.length) {
    showToast("Accept at least one correlation first.", "warning");
    return;
  }
  // Convert and merge into S.correlations, skipping exact duplicates (same name + config)
  var newCorr = accepted.map(advisorToCorrelation).filter(function (nc) {
    return !(S.correlations || []).some(function (ex) {
      return (
        ex.name === nc.name &&
        ex.extractorType === nc.extractorType &&
        JSON.stringify(ex.extractorConfig) ===
          JSON.stringify(nc.extractorConfig)
      );
    });
  });
  S.correlations = (S.correlations || []).concat(newCorr);

  // Mark accepted as applied (dim them)
  accepted.forEach(function (c) {
    c._applied = true;
  });

  regenerateFromAdvisor();
}

// ---------------------------------------------------------------------------
// INTERNAL HELPERS
// ---------------------------------------------------------------------------
function _advFindById(id) {
  return (
    (S.advisorCandidates || []).find(function (c) {
      return c.id === id;
    }) || null
  );
}

function _advRefreshCard(c) {
  // Re-render just the one card element if it exists
  var el = document.getElementById("advc-" + c.id);
  if (!el) return;
  var tmp = document.createElement("div");
  tmp.innerHTML = _advCardHtml(c);
  var newEl = tmp.firstChild;
  el.replaceWith(newEl);
}

function _advUpdateBadge() {
  var badge = document.getElementById("adv-badge");
  if (!badge) return;
  var pending = (S.advisorCandidates || []).filter(function (c) {
    return c.status === "pending";
  }).length;
  var accepted = (S.advisorCandidates || []).filter(function (c) {
    return c.status === "accepted";
  }).length;
  var total = (S.advisorCandidates || []).length;

  if (total === 0) {
    badge.className = "adv-badge adv-badge-zero";
    badge.textContent = "0";
    return;
  }
  if (pending === 0) {
    badge.className = "adv-badge adv-badge-all-done";
    badge.textContent = accepted ? accepted + " accepted" : "all skipped";
    return;
  }
  badge.className = "adv-badge";
  badge.textContent = pending + " pending";
}

function _advUpdateFooter() {
  var footer = document.getElementById("adv-footer");
  var summary = document.getElementById("adv-footer-summary");
  var regen = document.getElementById("adv-btn-regen");
  if (!footer || !summary || !regen) return;

  var candidates = S.advisorCandidates || [];
  var accepted = candidates.filter(function (c) {
    return c.status === "accepted";
  }).length;
  var skipped = candidates.filter(function (c) {
    return c.status === "skipped";
  }).length;
  var pending = candidates.filter(function (c) {
    return c.status === "pending";
  }).length;

  if (accepted === 0 && skipped === 0) {
    footer.style.display = "none";
    return;
  }

  footer.style.display = "flex";
  summary.innerHTML =
    "<b>" +
    accepted +
    "</b> accepted &nbsp;&middot;&nbsp; <b>" +
    skipped +
    "</b> skipped &nbsp;&middot;&nbsp; <b>" +
    pending +
    "</b> pending";
  regen.disabled = accepted === 0;
}

function _esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// =============================================================================
// REQUEST INSPECTOR — Feature A + C
// =============================================================================

var _riFields = [];
var _riEntryIdx = -1;

function _advBuildInspectorDropdown() {
  var sel = document.getElementById("adv-insp-req-sel");
  if (!sel) return;
  var options = '<option value="">— select a request to inspect —</option>';
  (S.entries1 || []).forEach(function (e, i) {
    if (e.isMarker || e.filtered) return;
    var method = (e.method || "GET").toUpperCase();
    var path =
      (e.url || "").replace(/^https?:\/\/[^/]+/, "").split("?")[0] || "/";
    options += '<option value="' + i + '">' + method + " " + path + "</option>";
  });
  sel.innerHTML = options;
}

function onInspectorReqChange(idxStr) {
  _riFields = [];
  _riEntryIdx = -1;
  var traceEl = document.getElementById("ri-trace-panel");
  if (traceEl) traceEl.style.display = "none";

  var idx = parseInt(idxStr, 10);
  if (isNaN(idx) || idx < 0) {
    var listEl = document.getElementById("ri-field-list");
    if (listEl) listEl.innerHTML = "";
    return;
  }
  _riEntryIdx = idx;
  _riFields = advGetRequestFields(idx); // from studio-advisor.js
  _riRenderFields(_riFields);
}

function _riRenderFields(fields) {
  var listEl = document.getElementById("ri-field-list");
  if (!listEl) return;
  if (!fields || fields.length === 0) {
    listEl.innerHTML =
      '<div class="ri-empty">No dynamic or suspicious values found in this request.</div>';
    return;
  }

  var green = fields.filter(function (f) {
    return f.status === "green";
  });
  var yellow = fields.filter(function (f) {
    return f.status === "yellow";
  });

  var html = "";

  if (green.length) {
    html +=
      '<div class="ri-group-label">&#x2705; Traced to prior response</div>';
    green.forEach(function (f, i) {
      var origIdx = fields.indexOf(f);
      var valPreview =
        f.value.length > 44 ? f.value.slice(0, 40) + "&hellip;" : _esc(f.value);
      var locBadge =
        f.location === "header"
          ? "HDR"
          : f.location === "query"
            ? "QS"
            : "BODY";
      var srcLabel = f.traceSource ? _esc(f.traceSource.url || "?") : "";
      html +=
        '<div class="ri-field ri-field-green" onclick="riTraceField(' +
        origIdx +
        ')">' +
        '<span class="ri-field-dot ri-dot-green"></span>' +
        '<span class="ri-field-loc">' +
        locBadge +
        "</span>" +
        '<span class="ri-field-key">' +
        _esc(f.key) +
        "</span>" +
        '<span class="ri-field-val">' +
        valPreview +
        "</span>" +
        '<span class="ri-field-src">&#x2190; ' +
        srcLabel +
        "</span>" +
        '<button class="ri-field-btn" onclick="event.stopPropagation();riAddCorrFromTrace(' +
        origIdx +
        ')" title="Add correlation">+ Add</button>' +
        "</div>";
    });
  }

  if (yellow.length) {
    html +=
      '<div class="ri-group-label">&#x26A0;&#xFE0F; Dynamic pattern, source unknown</div>';
    yellow.forEach(function (f) {
      var origIdx = fields.indexOf(f);
      var valPreview =
        f.value.length > 44 ? f.value.slice(0, 40) + "&hellip;" : _esc(f.value);
      var locBadge =
        f.location === "header"
          ? "HDR"
          : f.location === "query"
            ? "QS"
            : "BODY";
      html +=
        '<div class="ri-field ri-field-yellow" onclick="riTraceField(' +
        origIdx +
        ')">' +
        '<span class="ri-field-dot ri-dot-yellow"></span>' +
        '<span class="ri-field-loc">' +
        locBadge +
        "</span>" +
        '<span class="ri-field-key">' +
        _esc(f.key) +
        "</span>" +
        '<span class="ri-field-val">' +
        valPreview +
        "</span>" +
        '<span class="ri-field-src" style="color:var(--text-3)">source not found in HAR</span>' +
        '<button class="ri-field-btn ri-paste-btn" onclick="event.stopPropagation();riOpenPasteForField(' +
        origIdx +
        ')" title="Paste the source response to detect path">Paste</button>' +
        "</div>";
    });
  }

  listEl.innerHTML = html;
}

function riTraceField(fieldIdx) {
  var field = _riFields[fieldIdx];
  if (!field) return;
  var traceEl = document.getElementById("ri-trace-panel");
  if (!traceEl) return;

  if (field.status === "green" && field.traceSource) {
    var src = field.traceSource;
    var pathText = src.jsonPath
      ? " &rarr; <code>" + _esc(src.jsonPath) + "</code>"
      : "";
    traceEl.innerHTML =
      '<div class="ri-trace-result">' +
      '<span class="ri-trace-label">&#x1F50E; Source found:</span>' +
      " <b>" +
      _esc(src.url || "?") +
      "</b>" +
      pathText +
      '<button class="ri-field-btn" style="margin-left:auto" onclick="riAddCorrFromTrace(' +
      fieldIdx +
      ')">+ Add Correlation</button>' +
      "</div>";
    traceEl.style.display = "";
  } else {
    traceEl.innerHTML =
      '<div class="ri-trace-result ri-trace-unknown">' +
      '<span class="ri-trace-label">&#x26A0;&#xFE0F; Source not found in HAR.</span>' +
      " Paste the server response to detect the path." +
      '<button class="ri-field-btn ri-paste-btn" style="margin-left:auto" onclick="riOpenPasteForField(' +
      fieldIdx +
      ')">&#x1F4CB; Paste & Detect</button>' +
      "</div>";
    traceEl.style.display = "";
  }
}

function riAddCorrFromTrace(fieldIdx) {
  var field = _riFields[fieldIdx];
  if (!field || !field.traceSource) {
    showToast("No source found for this value.", "warning");
    return;
  }
  var src = field.traceSource;
  var varName =
    typeof _advSuggestName !== "undefined"
      ? _advSuggestName(
          src.jsonPath || null,
          field.location === "header" ? field.key : null,
          field.value,
        )
      : field.key.split(".").pop().replace(/\W/g, "") || "dynamicValue";

  var extType = src.jsonPath
    ? "jsonpath"
    : field.location === "header"
      ? "header"
      : "boundary";
  var extValue = src.jsonPath || src.url || "";
  advisorAddManual(src.entryIdx, extType, extValue, varName, field.value);
  renderAdvisorPanel();
  _advUpdateBadge();
  showToast("Correlation added — click Apply & Regenerate.", "success");
}

function riOpenPasteForField(fieldIdx) {
  var field = _riFields[fieldIdx];
  openPasteCorrelate(field ? field.value : "");
}

function toggleInspector() {
  var body = document.getElementById("adv-insp-body");
  var icon = document.getElementById("adv-insp-toggle");
  if (!body) return;
  var collapsed = body.style.display === "none";
  body.style.display = collapsed ? "" : "none";
  if (icon) icon.textContent = collapsed ? "▾" : "▸";
}

// =============================================================================
// PASTE & CORRELATE — Feature B
// =============================================================================

var _riPasteResult = null;
var _riPastePathIdx = 0; // selected JSONPath index when multiple paths found
var _riPasteOccIdx = 0; // selected occurrence index when value found N times

function openPasteCorrelate(prefillValue) {
  var overlay = document.getElementById("pc-modal-overlay");
  if (!overlay) return;
  var valEl = document.getElementById("pc-target-value");
  if (valEl) valEl.value = prefillValue || "";
  var resultEl = document.getElementById("pc-result-section");
  if (resultEl) resultEl.style.display = "none";
  var submitBtn = document.getElementById("pc-submit-btn");
  if (submitBtn) submitBtn.disabled = true;
  _riPasteResult = null;

  // Populate source request dropdown
  var srcSel = document.getElementById("pc-src-select");
  if (srcSel) {
    var opts =
      '<option value="">— select the request that receives this value —</option>';
    (S.entries1 || []).forEach(function (e, i) {
      if (e.isMarker || e.filtered) return;
      var method = (e.method || "GET").toUpperCase();
      var path =
        (e.url || "").replace(/^https?:\/\/[^/]+/, "").split("?")[0] || "/";
      opts += '<option value="' + i + '">' + method + " " + path + "</option>";
    });
    srcSel.innerHTML = opts;
  }

  overlay.style.display = "flex";
}

function closePasteCorrelate() {
  var overlay = document.getElementById("pc-modal-overlay");
  if (overlay) overlay.style.display = "none";
}

// Build a shape-based fallback extractor when the value isn't found in the response.
// Analyses the value's pattern (JWT, UUID, hex, opaque token) to generate a
// regex or boundary that will capture it at script runtime.
function _pcBuildFallbackExtractor(value) {
  var v = String(value).trim();
  var varName =
    typeof _advSuggestName !== "undefined"
      ? _advSuggestName(null, null, v)
      : "dynamicValue";

  if (
    /^eyJ[A-Za-z0-9+\/=_-]{10,}\.[A-Za-z0-9+\/=_-]+\.[A-Za-z0-9+\/=_-]+$/.test(
      v,
    )
  ) {
    return {
      extType: "regexp",
      pattern: "eyJ[A-Za-z0-9+/=_-]+\\.[A-Za-z0-9+/=_-]+\\.[A-Za-z0-9+/=_-]+",
      group: 0,
      varName: varName,
      value: v,
      _autoPattern: true,
      _patternLabel: "JWT shape",
    };
  }
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  ) {
    return {
      extType: "regexp",
      pattern:
        "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
      group: 0,
      varName: varName,
      value: v,
      _autoPattern: true,
      _patternLabel: "UUID shape",
    };
  }
  if (/^[0-9a-f]{16,64}$/i.test(v)) {
    return {
      extType: "regexp",
      pattern: "[0-9a-fA-F]{" + v.length + "}",
      group: 0,
      varName: varName,
      value: v,
      _autoPattern: true,
      _patternLabel: "Hex token (" + v.length + " chars)",
    };
  }
  if (/^[A-Za-z0-9+\/=_.\-]{24,}$/.test(v)) {
    // Opaque base64-ish token — boundary: left=first 8 chars, right=last 4 chars
    return {
      extType: "boundary",
      lb: v.slice(0, 8),
      rb: v.slice(-4),
      path: null,
      varName: varName,
      value: v,
      _autoPattern: true,
      _patternLabel: "Opaque token (boundary on first/last chars)",
    };
  }
  // Generic: escape and use as a literal regex
  var escaped = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    extType: "regexp",
    pattern: escaped,
    group: 0,
    varName: varName,
    value: v,
    _autoPattern: true,
    _patternLabel: "Literal value pattern",
  };
}

// Called when user selects a different JSONPath from the list
function pcSelectPath(idx) {
  _riPastePathIdx = parseInt(idx, 10) || 0;
  var res = _riPasteResult;
  if (!res || !res.allPaths) return;
  var chosen = res.allPaths[_riPastePathIdx];
  if (!chosen) return;
  var descEl = document.getElementById("pc-ext-desc");
  if (descEl)
    descEl.innerHTML =
      "<b>JSONPath</b>: <code>" +
      _esc(chosen.path) +
      "</code>" +
      (chosen._partial
        ? ' <span class="pc-pattern-label">(partial match)</span>'
        : "");
}

// Called when user selects a different occurrence from the dropdown
function pcSelectOccurrence(idx) {
  _riPasteOccIdx = parseInt(idx, 10) || 0;
  var res = _riPasteResult;
  if (!res || !res.allOccurrences) return;
  var occ = res.allOccurrences[_riPasteOccIdx];
  if (!occ) return;
  var descEl = document.getElementById("pc-ext-desc");
  if (descEl) descEl.innerHTML = _pcExtDesc(occ);
}

function _pcExtDesc(r) {
  if (!r) return "";
  if (r.extType === "jsonpath")
    return "<b>JSONPath</b>: <code>" + _esc(r.path || "") + "</code>";
  if (r.extType === "regexp")
    return (
      "<b>RegExp</b>: <code>" +
      _esc(r.pattern || "") +
      "</code>" +
      (r.contextLabel
        ? ' <span class="pc-pattern-label">(' +
          _esc(r.contextLabel) +
          ")</span>"
        : "")
    );
  return (
    "<b>Boundary</b>: LB=<code>" +
    _esc(r.lb || "") +
    "</code>&nbsp; RB=<code>" +
    _esc(r.rb || "") +
    "</code>" +
    (r.contextLabel
      ? ' <span class="pc-pattern-label">(' + _esc(r.contextLabel) + ")</span>"
      : "")
  );
}

function runPasteDetect() {
  var respText = (
    (document.getElementById("pc-response-body") || {}).value || ""
  ).trim();
  var targetVal = (
    (document.getElementById("pc-target-value") || {}).value || ""
  ).trim();
  var resultEl = document.getElementById("pc-result-section");
  var submitBtn = document.getElementById("pc-submit-btn");
  _riPasteResult = null;
  _riPastePathIdx = 0;
  _riPasteOccIdx = 0;
  if (submitBtn) submitBtn.disabled = true;

  if (!targetVal) {
    showToast("Enter the value to extract (Step 2).", "warning");
    return;
  }

  // Try to detect in pasted response
  var res = respText ? advPasteDetect(respText, targetVal) : null;

  var autoFallback = false;
  if (!res) {
    res = _pcBuildFallbackExtractor(targetVal);
    autoFallback = true;
  }
  _riPasteResult = res;

  // ── Build result HTML ─────────────────────────────────────────────────────
  var html = "";
  var statusCls = autoFallback ? "pc-result-auto" : "pc-result-ok";

  // Status header
  if (autoFallback) {
    html +=
      '<div class="pc-result-row">&#x26A1; <b>Auto-generated</b> pattern &mdash; value not found in pasted response</div>' +
      '<div class="pc-result-hint">Pattern is based on the value\'s shape (JWT / UUID / hex / token). Captures similar values at script runtime. Refine if needed after adding.</div>';
  } else {
    var ctLabel =
      { json: "JSON", html: "HTML", xml: "XML", text: "Plain text" }[
        res.contentType
      ] || "";
    var confIcon = res.confidence === "high" ? "&#x2705;" : "&#x26A0;&#xFE0F;";
    html +=
      '<div class="pc-result-row">' +
      confIcon +
      " <b>Detected</b>" +
      (ctLabel ? " &middot; " + ctLabel + " response" : "") +
      (res.occurrences > 1
        ? " &middot; value found <b>" + res.occurrences + " times</b>"
        : "") +
      "</div>";
  }

  // Extractor description + path/occurrence selectors
  html +=
    '<div class="pc-result-row" id="pc-ext-desc">' + _pcExtDesc(res) + "</div>";

  // Multiple JSONPaths → radio list
  if (
    !autoFallback &&
    res.extType === "jsonpath" &&
    res.allPaths &&
    res.allPaths.length > 1
  ) {
    html +=
      '<div class="pc-multipath-label">Found at ' +
      res.allPaths.length +
      " paths &mdash; select the correct one:</div>" +
      '<div class="pc-paths">';
    res.allPaths.forEach(function (p, i) {
      var isDefault = i === 0;
      var badge = p._partial
        ? '<span class="pc-pattern-label">partial</span>'
        : p.exact
          ? ""
          : "";
      html +=
        '<label class="pc-path-opt">' +
        '<input type="radio" name="pc-path-radio" value="' +
        i +
        '"' +
        (isDefault ? " checked" : "") +
        ' onchange="pcSelectPath(' +
        i +
        ')">' +
        " <code>" +
        _esc(p.path) +
        "</code>" +
        badge +
        "</label>";
    });
    html += "</div>";
    // Hint for array paths
    var arrayPaths = res.allPaths.filter(function (p) {
      return /\[\d+\]/.test(p.path);
    });
    if (arrayPaths.length) {
      html +=
        '<div class="pc-result-hint">&#x1F4A1; Array path detected. To extract ALL elements, this will use SelectAll in the generated script.</div>';
    }
  }

  // Multiple occurrences for non-JSON → occurrence selector
  if (!autoFallback && res.allOccurrences && res.allOccurrences.length > 1) {
    html +=
      '<div class="pc-occ-row">' +
      '<label class="pc-occ-label">Occurrence:</label>' +
      '<select class="adv-modal-select pc-occ-sel" onchange="pcSelectOccurrence(this.value)">';
    res.allOccurrences.forEach(function (occ, i) {
      var ordinal = i + 1;
      var snip = occ.snippet
        ? " — " +
          occ.snippet.slice(0, 35) +
          (occ.snippet.length > 35 ? "…" : "")
        : "";
      var ctx = occ.contextLabel ? " [" + occ.contextLabel + "]" : "";
      html +=
        '<option value="' +
        i +
        '"' +
        (i === 0 ? " selected" : "") +
        ">" +
        ordinal +
        " of " +
        res.allOccurrences.length +
        ctx +
        _esc(snip) +
        "</option>";
    });
    html += "</select></div>";
  }

  // Variable name input
  html +=
    '<div class="pc-result-row"><label class="adv-modal-label" style="margin-bottom:3px">Variable name</label>' +
    '<input class="adv-modal-input pc-varname" id="pc-varname-input" value="' +
    _esc(res.varName) +
    '" placeholder="variableName" /></div>';

  if (resultEl) {
    resultEl.style.display = "";
    resultEl.innerHTML = '<div class="' + statusCls + '">' + html + "</div>";
  }

  if (submitBtn) submitBtn.disabled = false;
}

function submitPasteCorrelate() {
  if (!_riPasteResult) {
    showToast("Run Detect first.", "warning");
    return;
  }

  var varName =
    ((document.getElementById("pc-varname-input") || {}).value || "").trim() ||
    _riPasteResult.varName;
  var srcIdxStr = (document.getElementById("pc-src-select") || {}).value || "";
  var srcIdx = parseInt(srcIdxStr, 10);
  if (isNaN(srcIdx)) srcIdx = 0;

  var res = _riPasteResult;

  // Resolve selected path / occurrence to get final extractor config
  var effective = res; // default
  if (
    res.extType === "jsonpath" &&
    res.allPaths &&
    res.allPaths[_riPastePathIdx]
  ) {
    effective = {
      extType: "jsonpath",
      path: res.allPaths[_riPastePathIdx].path,
    };
  } else if (res.allOccurrences && res.allOccurrences[_riPasteOccIdx]) {
    effective = res.allOccurrences[_riPasteOccIdx];
  }

  // Use the nearest earlier entry as "source" so codegen has a valid sourceIdx
  var sourceEntryIdx = isNaN(srcIdx) ? 0 : Math.max(0, srcIdx - 1);

  // Build extractorType + extractorConfig for all result types
  var extractorType, extractorConfig;
  if (effective.extType === "jsonpath") {
    extractorType = "jsonpath";
    extractorConfig = { path: effective.path };
  } else if (effective.extType === "regexp") {
    extractorType = "regexp";
    extractorConfig = {
      pattern: effective.pattern || "",
      group: effective.group != null ? effective.group : 0,
    };
  } else {
    extractorType = "boundary";
    extractorConfig = { lb: effective.lb || "", rb: effective.rb || "" };
    // Add ordinal if multiple occurrences
    if (res.allOccurrences && res.allOccurrences.length > 1) {
      extractorConfig.ordinal = _riPasteOccIdx + 1;
    }
  }

  // Create correlation with the detected extractor
  var newCorr = {
    name: varName,
    sourceIdx: sourceEntryIdx,
    extractorType: extractorType,
    extractorConfig: extractorConfig,
    usages: [],
    _fromAdvisor: true,
    _pasteDetect: true,
  };

  // Auto-scan ALL requests for usages of this value
  var entries = S.entries1 || [];
  var value = res.value;
  entries.forEach(function (e, i) {
    if (e.isMarker || e.filtered) return;
    var bodyText = (e.body && e.body.text) || "";
    if (bodyText) {
      var obj;
      try {
        obj = JSON.parse(bodyText);
      } catch (err) {
        obj = null;
      }
      if (obj && typeof _advWalkLeaves !== "undefined") {
        _advWalkLeaves(
          obj,
          "$",
          function (val, jpath) {
            if (val === value) {
              newCorr.usages.push({
                reqIdx: i,
                location: "body_json",
                key: jpath.split(".").pop(),
                tokenValue: value,
                originalValue: value,
                prefix: "",
              });
            }
          },
          0,
        );
      } else if (bodyText.includes(value)) {
        newCorr.usages.push({
          reqIdx: i,
          location: "body_json",
          key: "value",
          tokenValue: value,
          originalValue: value,
          prefix: "",
        });
      }
    }
    for (var h of e.reqHdrs || []) {
      var hval = String(h.value || "");
      if (hval === value || hval === "Bearer " + value) {
        newCorr.usages.push({
          reqIdx: i,
          location: "header",
          key: h.name,
          tokenValue: value,
          originalValue: value,
          prefix: /^bearer\s+/i.test(hval) ? "Bearer " : "",
        });
      }
    }
  });

  S.correlations = (S.correlations || []).concat([newCorr]);
  closePasteCorrelate();
  renderAdvisorPanel();
  showToast(
    "Correlation added. Click Apply & Regenerate to update the script.",
    "success",
  );
  if (typeof regenerateFromAdvisor !== "undefined") regenerateFromAdvisor();
}
