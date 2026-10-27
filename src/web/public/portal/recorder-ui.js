/* ══════════════════════════════════════════════════════════════════════════
 * Recorder page UI (portal v3 design) — loaded LAST, after the unchanged engine
 * files and VuGen-Recorder-ui.js.
 *
 * This file only replaces the display functions of the classic page. It keeps
 * their global names and their effect on the shared state `S`, so the engine
 * (parsers, generators, usr-gen, buildDomainStats, dlZip …) runs exactly as on
 * the classic page. Everything the engine reports goes through showToast().
 *
 * Additions on this page (no engine change):
 *  - every left-out request says why; redirects and page-step resources are marked
 *  - Rename / Ungroup a transaction (with Undo)
 *  - manual transaction edits survive a format change (replayed after re-processing)
 *  - Cancel in the format dialog really keeps the current format
 *  - panels can be hidden (domains, preview, filters, instructions) — remembered
 *  - "Correlate in Script Studio" hands the loaded file to Script Studio
 * ══════════════════════════════════════════════════════════════════════════ */

// ── small helpers ───────────────────────────────────────────────────────────
var RC = (function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var KEY = 'perfx-recorder-ui';
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
  var prefs = load();
  function save(k, v) { prefs[k] = v; try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) { /* private window */ } }
  return { $: $, $$: $$, prefs: prefs, save: save };
})();

var RT_TYPES = {
  fetch: ['Fetch/XHR', '#4f8ef7'], document: ['Doc', '#e8a838'], stylesheet: ['CSS', '#9b59b6'], script: ['JS', '#f39c12'],
  font: ['Font', '#16a085'], image: ['Img', '#27ae60'], media: ['Media', '#e74c3c'], other: ['Other', '#7f8c8d']
};
var RT_KEYS = ['fetch', 'document', 'stylesheet', 'script', 'font', 'image', 'media', 'other'];

var _file = null;        // { name, size, file } of the loaded recording
var _nextFile = null;    // file chosen in the format dialog, not confirmed yet
var _stash = null;       // pending HAR / NetLog before that file was chosen (restored on cancel)
var _showAllRows = false;// large recordings: render every row only on request
var ROW_LIMIT = 1500, ROW_LIMIT_FROM = 2500;
var _txnLog = [];        // manual transaction edits, replayed after a format change
var _fmtDlg = { fromToolbar: false, prev: 'webhttp' };

function _plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

// ===========================================================================
// THEME (same storage key as the classic page: vr-theme)
// ===========================================================================
function _setTheme(t) {
  document.documentElement.setAttribute('data-theme', t || 'dark');
  try { localStorage.setItem('vr-theme', t || 'dark'); } catch (e) { /* ignore */ }
  // the sun / moon icon follows data-theme (CSS) — no text glyph
}
// Called by the portal: sync the theme and drop this page's own header
window.lrePortalInit = function (theme) {
  document.documentElement.classList.add('embedded');
  _setTheme(theme || 'dark');
};
window.lreSetTheme = function (theme) { _setTheme(theme); };
function toggleTheme() {
  _setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
}

// ===========================================================================
// TOASTS — showToast() is the engine's channel (same messages as the classic
// page). On the start page an error is shown as a card under the drop zone.
// ===========================================================================
function _toast(msg, type, duration, action) {
  type = type || 'info';
  duration = duration == null ? (action ? 6500 : 3500) : duration;
  var P = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">';
  var icons = { success: P + '<path d="M20 6 9 17l-5-5"/></svg>', error: P + '<path d="M18 6 6 18M6 6l12 12"/></svg>',
    info: P + '<path d="M12 16v-5M12 7.5h.01"/></svg>', warning: P + '<path d="M12 7v6M12 17h.01"/></svg>' };
  var c = document.getElementById('toast-container');
  if (!c) return;
  var t = document.createElement('div');
  t.className = 'rc-toast toast-' + type;
  t.setAttribute('role', type === 'error' ? 'alert' : 'status');
  var i = document.createElement('span'); i.className = 'i'; i.setAttribute('aria-hidden', 'true'); i.innerHTML = icons[type] || icons.info;
  var m = document.createElement('span'); m.textContent = msg;
  t.appendChild(i); t.appendChild(m);
  var gone = function () { t.classList.add('removing'); setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 280); };
  if (action) {
    // only the latest change can be undone — an older Undo would also revert later edits
    RC.$$('.rc-toast.has-undo', c).forEach(function (o) { if (o.parentNode) o.parentNode.removeChild(o); });
    t.classList.add('has-undo');
    var b = document.createElement('button'); b.type = 'button'; b.textContent = action.label;
    b.onclick = function () { gone(); action.run(); };
    t.appendChild(b);
  }
  c.appendChild(t);
  setTimeout(gone, duration);
}

var _START_ERRORS = [
  [/^Please drop a \.har file/, "That file isn't a recording", 'Save the recording as .har (DevTools → Network → Export HAR, or the CDP Recorder) and drop it again.'],
  [/^Could not parse file:/, 'Could not read the file', "The file is damaged or isn't JSON. Export the HAR again."],
  [/^Could not parse NetLog file/, 'Could not read the NetLog file', 'Export it again from chrome://net-export/, or record a HAR instead.'],
  [/^No HTTP requests found in this NetLog/, 'No requests found in this NetLog file', '']
];
function _showStartError(title, msg, hint) {
  var box = document.getElementById('start-err');
  if (!box) return;
  document.getElementById('start-err-t').textContent = title;
  document.getElementById('start-err-m').textContent = msg;
  var h = document.getElementById('start-err-h'); h.textContent = hint || ''; h.hidden = !hint;
  box.hidden = false;
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function _hideStartError() { var b = document.getElementById('start-err'); if (b) b.hidden = true; }

function showToast(msg, type, duration) {
  var onStart = !document.getElementById('welcome').hidden;
  if (onStart && type === 'error') {
    var hit = _START_ERRORS.filter(function (r) { return r[0].test(msg); })[0];
    _showStartError(hit ? hit[1] : 'Something went wrong', msg, hit ? hit[2] : '');
    return;
  }
  _toast(msg, type, duration);
}

// ===========================================================================
// COPY THE PREVIEWED FILE
// ===========================================================================
function copyCode() {
  var body = document.getElementById('code-body');
  if (!body) return;
  var text = body.textContent;
  if (!text || text.startsWith('// Load a HAR') || text.startsWith('// No content')) {
    showToast('Load a HAR file first.', 'warning');
    return;
  }
  var ok = function () { showToast('Copied to clipboard!', 'success', 2000); };
  var fail = function () { showToast('Copy failed — try selecting the text manually.', 'error'); };
  // navigator.clipboard only exists on https / localhost — fall back for plain http servers
  if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).then(ok).catch(fail); return; }
  try {
    var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
    var done = document.execCommand('copy'); document.body.removeChild(ta);
    if (done) ok(); else fail();
  } catch (e) { fail(); }
}

// ===========================================================================
// FILE LOADING
// ===========================================================================
function onFilePick(e) { var f = e.target.files[0]; if (f) readFile(f); e.target.value = ''; }
function onDrop(e) {
  e.preventDefault();
  document.getElementById('dz').classList.remove('over');
  var f = e.dataTransfer.files[0];
  var nm = (f && f.name.toLowerCase()) || '';
  if (f && (nm.endsWith('.har') || nm.endsWith('.json'))) readFile(f);
  else showToast('Please drop a .har file or a chrome://net-export/ NetLog .json file', 'error');
}
function onDragOver(e) { e.preventDefault(); document.getElementById('dz').classList.add('over'); }
function onDragLeave() { document.getElementById('dz').classList.remove('over'); }

function _progress(on, title) {
  var p = document.getElementById('rc-progress');
  if (!p) return;
  if (title) document.getElementById('rc-progress-t').textContent = title;
  p.hidden = !on;
}

function readFile(file) {
  _hideStartError();
  if (file.size > 5 * 1048576) _progress(true, 'Reading ' + file.name + ' (' + fmtSize(file.size) + ')…');
  var r = new FileReader();
  r.onload = function (ev) {
    _progress(false);
    try {
      var parsed = JSON.parse(ev.target.result);
      // the open recording stays untouched until Continue (Cancel restores this)
      _stash = { har: S.pendingHar, netlog: S.pendingNetLog };
      if (isNetLog(parsed)) {
        S.pendingNetLog = parsed;
        S.pendingHar = null;
      } else {
        S.pendingHar = parsed;
        S.pendingNetLog = null;
      }
      _nextFile = { name: file.name || 'recording.har', size: file.size || 0, file: file };
      openFmtModal(false);
    } catch (err) { showToast('Could not parse file: ' + err.message, 'error'); }
  };
  r.onerror = function () { _progress(false); showToast('Could not parse file: the file could not be read', 'error'); };
  r.readAsText(file);
}

// ===========================================================================
// RESOURCE-TYPE CHIPS ("Types in the script") — same S.resourceTypeFilter
// semantics as the classic page: null = every type; a Set = only those types.
// ===========================================================================
function setRecorderRt(key) {
  if (key === '__all__') {
    S.resourceTypeFilter = null;
    _syncRtChips(); refresh(); return;
  }
  if (RT_KEYS.indexOf(key) < 0) return;
  if (!S.resourceTypeFilter) S.resourceTypeFilter = new Set(RT_KEYS);
  if (S.resourceTypeFilter.has(key)) S.resourceTypeFilter.delete(key);
  else S.resourceTypeFilter.add(key);
  if (S.resourceTypeFilter.size === 0) S.resourceTypeFilter = new Set([key]);
  _syncRtChips(); refresh();
}
function _syncRtChips() {
  var f = S.resourceTypeFilter;
  RC.$$('#rec-rt-bar [data-key]').forEach(function (c) {
    var k = c.dataset.key;
    var on = k === '__all__' ? (!f || f.size === RT_KEYS.length) : (!f || f.has(k));
    c.setAttribute('aria-pressed', String(on));
  });
  _syncFilterSummary();
}
function _syncFilterSummary() {
  var el = document.getElementById('f-sum');
  if (!el) return;
  var out = [];
  if (document.getElementById('f-static').checked) out.push('static assets');
  if (document.getElementById('f-noise').checked) out.push('analytics / ads');
  if (document.getElementById('f-opts').checked) out.push('OPTIONS');
  var f = S.resourceTypeFilter;
  var types = !f || f.size === RT_KEYS.length ? 'all types' : RT_KEYS.filter(function (k) { return f.has(k); }).map(function (k) { return RT_TYPES[k][0]; }).join(', ');
  el.textContent = 'Leaving out: ' + (out.length ? out.join(', ') : 'nothing') + ' · Types: ' + types;
}

// ===========================================================================
// REQUEST LIST
// ===========================================================================
// Why a request is left out of the script — mirrors applyFilters() (same order).
function _whyLeftOut(e) {
  var reqCt = ((e.hdrsMap || {})['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (reqCt === 'application/csp-report' || reqCt === 'application/reports+json') return 'browser security report';
  if (e.body && e.body.text && e.body.text.includes('"blocked-uri"')) return 'browser security report';
  if (/^wss?:\/\//i.test(e.url)) return 'WebSocket — cannot be replayed';
  if (!/^https?:\/\//i.test(e.url)) return 'not a network request';
  try { if (S.domainFilter[new URL(e.url).hostname] === false) return 'domain switched off'; } catch (x) { /* ignore */ }
  if (document.getElementById('f-opts').checked && e.method === 'OPTIONS') return 'OPTIONS left out';
  if (document.getElementById('f-static').checked && (STATIC_CT.has(e.ct) || STATIC_EXT.test(e.url.split('?')[0]))) return 'static asset left out';
  if (document.getElementById('f-noise').checked) { try { if (NOISY.test(new URL(e.url).hostname)) return 'analytics / ads left out'; } catch (x) { /* ignore */ } }
  if (S.resourceTypeFilter && S.resourceTypeFilter.size > 0 && !S.resourceTypeFilter.has(classifyHarEntry(e))) return 'type ' + (RT_TYPES[classifyHarEntry(e)] || [classifyHarEntry(e)])[0] + ' switched off';
  return 'left out';
}

function _splitUrl(url) {
  var m = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)(.*)$/i.exec(url || '');
  if (!m) return { host: '', path: url || '' };
  return { host: m[2], path: m[3] || '/' };
}

function _statusClass(s) { return s >= 500 ? 's5' : s >= 400 ? 's4' : s >= 300 ? 's3' : s >= 200 ? 's2' : 's0'; }

var _CHEV = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

function renderTable() {
  var ents = S.entries;
  var tbody = document.getElementById('tbody');
  var hasMarkers = ents.some(function (e) { return e.isMarker; });
  // Tags for requests that ARE in the script: what the generators do with them
  var auto = new Set(), absorbed = new Set();
  try {
    auto = buildAutoFollowMap(ents);
    absorbed = PageResources.groupPageResources(ents, auto).absorbed;
  } catch (x) { /* tags are informational only */ }

  // Pass 1: request counts per START marker (nesting-aware)
  var counts = {}, stack = [];
  ents.forEach(function (e, i) {
    if (e.isMarker) {
      if (e.markerType === 'start') { stack.push(i); counts[i] = { n: 0, inc: 0 }; }
      else { for (var k = stack.length - 1; k >= 0; k--) { if (ents[stack[k]].txnName === e.txnName) { stack.splice(k); break; } } }
      return;
    }
    stack.forEach(function (si) { counts[si].n++; if (!e.filtered) counts[si].inc++; });
  });

  // Pass 2: rows
  var html = [], open = [], noneShown = false, shownReq = 0;
  var totalReq = ents.filter(function (x) { return !x.isMarker; }).length;
  var limit = !_showAllRows && totalReq >= ROW_LIMIT_FROM ? ROW_LIMIT : Infinity;
  for (var i = 0; i < ents.length; i++) {
    var e = ents[i];
    if (!e.isMarker && ++shownReq > limit) {
      html.push('<tr class="more"><td colspan="6"><div class="rc-empty sm">Showing the first ' + limit.toLocaleString('en-GB') + ' of ' + totalReq.toLocaleString('en-GB') +
        ' requests — the script includes all of them. <button class="ds-btn ds-btn-sm" type="button" id="btn-show-all">Show all ' + totalReq.toLocaleString('en-GB') + '</button></div></td></tr>');
      break;
    }
    if (e.isMarker) {
      var c = S.colorMap[e.txnName] || COLORS[0];
      if (e.markerType === 'start') {
        var cnt = counts[i], d = open.length, collapsed = !!S.collapsed[e.txnName];
        html.push('<tr class="grp start" data-grp="' + esc(e.txnName) + '"><td colspan="6"><div class="rc-grp-row" style="--g:' + c.bd + ';--d:' + d + '">' +
          '<button class="rc-grp" type="button" data-act="toggle" aria-expanded="' + !collapsed + '">' + _CHEV +
          '<span class="nm">' + esc(e.txnName) + '</span> <small>' + cnt.inc + ' of ' + _plural(cnt.n, 'request') + ' in the script</small></button>' +
          '<span class="tag">Transaction</span>' +
          '<button class="rc-mini" type="button" data-act="rename" title="Rename this transaction">Rename</button>' +
          '<button class="rc-mini" type="button" data-act="ungroup" title="Remove this transaction — its requests stay in the script">Ungroup</button>' +
          '</div></td></tr>');
        open.push(e.txnName); noneShown = false;
      } else {
        for (var k = open.length - 1; k >= 0; k--) { if (open[k] === e.txnName) { open.splice(k); break; } }
        html.push('<tr class="end" data-grp="' + esc(e.txnName) + '"><td colspan="6"><div class="rc-end" style="--g:' + c.bd + ';--d:' + open.length + '"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/></svg>End ' + esc(e.txnName) + '</div></td></tr>');
      }
      continue;
    }
    if (hasMarkers && open.length === 0 && !noneShown) {
      html.push('<tr class="grp none"><td colspan="6"><div class="rc-grp-row none"><span class="rc-grp">Not in a transaction <small>requests recorded outside your transactions</small></span></div></td></tr>');
      noneShown = true;
    }
    var u = _splitUrl(e.url), rt = classifyHarEntry(e), tinfo = RT_TYPES[rt] || [rt, '#7f8c8d'];
    var note = '';
    if (e.filtered) note = '<span class="rc-why">' + esc(_whyLeftOut(e)) + '</span>';
    else if (auto.has(i)) note = e.status === 401
      ? '<span class="rc-tag" title="VuGen and DevWeb answer this authentication challenge automatically — it is not a separate step in the script">handled automatically</span>'
      : '<span class="rc-tag" title="VuGen and DevWeb follow this redirect automatically — it is not a separate step in the script">redirect — followed automatically</span>';
    else if (absorbed.has(i)) note = '<span class="rc-tag" title="Downloaded as part of the page step that loaded it (EXTRARES / resources[]), not a separate request">added to its page step</span>';
    var path = u.path.length > 300 ? u.path.substring(0, 300) + '…' : u.path;
    var mc = /^(GET|POST|PUT|DELETE|PATCH)$/.test(e.method) ? 'm-' + e.method : '';
    var size = fmtSize(e.size), time = e.dur > 0 ? e.dur + ' ms' : '-';
    var cls = 'req' + (e.filtered ? ' dim' : '') + (S.selIds.has(e.id) ? ' sel' : '');
    html.push('<tr id="r' + e.id + '" class="' + cls + '" data-id="' + e.id + '"' + (S.selMode && !e.filtered ? ' tabindex="0" aria-selected="' + S.selIds.has(e.id) + '"' : '') + ' data-grp="' + esc(e.txn || '') + '" title="' + esc(e.url) + (e.filtered ? ' — ' + esc(_whyLeftOut(e)) : '') + '">' +
      '<td class="num w-n">' + e.id + '</td>' +
      '<td class="req-cell" style="--d:' + open.length + '"><span class="rc-rq"><span class="rc-m ' + mc + '">' + esc(e.method || '-') + '</span><span class="p">' + esc(path) + '</span>' + note + '</span>' +
      '<span class="rc-host">' + esc(u.host) + '<span class="rc-meta"> · ' + esc(tinfo[0]) + ' · ' + size + ' · ' + time + '</span>' + (e.ct ? ' · ' + esc(e.ct) : '') + '</span></td>' +
      '<td><span class="rc-s ' + _statusClass(e.status) + '">' + (e.status || '-') + '</span></td>' +
      '<td class="w-ty"><span class="rc-type" style="--k:' + tinfo[1] + '"><i></i>' + esc(tinfo[0]) + '</span></td>' +
      '<td class="num w-sz">' + size + '</td><td class="num w-tm">' + time + '</td></tr>');
  }
  tbody.innerHTML = html.length ? html.join('')
    : '<tr><td colspan="6"><div class="rc-empty"><b>No requests in this file</b>The recording is empty. Record the journey again, then load the new file.</div></td></tr>';
  applyCollapse();
  updateCollapseAllBtn();
  var nm = document.getElementById('no-markers');
  if (nm) nm.hidden = S.txns.length > 0 || !ents.some(function (x) { return !x.isMarker; });
}

function toggleTxn(el) {
  var name = el.closest('[data-grp]').dataset.grp;
  S.collapsed[name] = !S.collapsed[name];
  applyCollapse();
  updateCollapseAllBtn();
}

// Show / hide rows of collapsed transactions (nested transactions too)
function applyCollapse() {
  var tbody = document.getElementById('tbody');
  if (!tbody) return;
  var stack = [];
  var anyCollapsed = function () { return stack.some(function (s) { return s.c; }); };
  for (var r = 0; r < tbody.rows.length; r++) {
    var row = tbody.rows[r];
    if (row.classList.contains('start')) {
      row.hidden = anyCollapsed();
      var name = row.dataset.grp, c = !!S.collapsed[name];
      var b = row.querySelector('.rc-grp'); if (b) b.setAttribute('aria-expanded', String(!c));
      stack.push({ name: name, c: c });
    } else if (row.classList.contains('end')) {
      row.hidden = anyCollapsed();
      for (var k = stack.length - 1; k >= 0; k--) { if (stack[k].name === row.dataset.grp) { stack.splice(k); break; } }
    } else if (row.classList.contains('none')) {
      row.hidden = false;
    } else {
      row.hidden = anyCollapsed();
    }
  }
}

function collapseAll() { S.txns.forEach(function (t) { S.collapsed[t.name] = true; }); applyCollapse(); updateCollapseAllBtn(); }
function expandAll() { S.collapsed = {}; applyCollapse(); updateCollapseAllBtn(); }
function toggleCollapseAll() {
  var anyExpanded = S.txns.some(function (t) { return !S.collapsed[t.name]; });
  if (anyExpanded) collapseAll(); else expandAll();
}
function updateCollapseAllBtn() {
  var btn = document.getElementById('btn-collapse-all');
  if (!btn) return;
  btn.hidden = !S.txns.length;
  btn.textContent = S.txns.some(function (t) { return !S.collapsed[t.name]; }) ? 'Collapse all' : 'Expand all';
}

// Kept for scripts that call the classic row builders
function markerRow() { return ''; }
function entryRow() { return ''; }

var AUTH_LABELS = { kerberos: 'Kerberos', ntlm: 'NTLM', negotiate: 'Negotiate', basic: 'Basic Auth', digest: 'Digest Auth', bearer: 'Bearer Token', saml: 'SAML' };

function renderStats() {
  var total = S.entries.filter(function (e) { return !e.isMarker; }).length;
  var shown = S.entries.filter(function (e) { return !e.isMarker && !e.filtered; }).length;
  var tc = S.txns.length;
  document.getElementById('stats').textContent = shown + '/' + total + ' requests  |  ' + tc + ' transaction' + (tc !== 1 ? 's' : '');
  document.getElementById('kpi-req').innerHTML = '<b>' + shown + '</b>of ' + _plural(total, 'request') + ' in the script';
  document.getElementById('kpi-txn').innerHTML = '<b>' + tc + '</b>' + (tc === 1 ? 'transaction' : 'transactions');
  document.getElementById('netlog-banner').hidden = !S.isNetLogSource;
  var authBadge = document.getElementById('auth-badge');
  if (S.auth) {
    document.getElementById('auth-label').textContent = AUTH_LABELS[S.auth.type] || 'Auth';
    authBadge.hidden = false;
  } else authBadge.hidden = true;
  var empty = total === 0;
  ['dl-webhttp', 'dl-devweb', 'btn-copy', 'btn-studio'].forEach(function (id) { var b = document.getElementById(id); if (b) b.disabled = empty; });
  _syncFilterSummary();
}

// ===========================================================================
// SCRIPT PREVIEW
// ===========================================================================
function switchTab(el, tab) {
  RC.$$('.rc-ctab').forEach(function (t) { t.classList.remove('act'); t.setAttribute('aria-selected', 'false'); });
  el.classList.add('act'); el.setAttribute('aria-selected', 'true');
  var titleEl = document.getElementById('code-panel-title');
  if (titleEl) titleEl.textContent = el.dataset.file || el.textContent || tab;
  S.tab = tab; showScript();
}

// Light syntax colouring — wraps tokens only, so textContent stays the exact script. Built from text nodes, not
// HTML: HTML parsing would turn \r\n into \n, and Copy reads textContent.
var _HL =/(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\[\s\S])*`)|(#\w+)|\b(return|const|let|var|async|await|new|function|if|else|for|while|try|catch|throw|typeof|null|true|false|int|char|void|LAST|ENDITEM|ITEMDATA|EXTRARES)\b|\b([A-Za-z_$][\w$]*)(?=\s*\()/g;
function _highlight(text) {
  var frag = document.createDocumentFragment(), last = 0, m;
  _HL.lastIndex = 0;
  while ((m = _HL.exec(text))) {
    if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
    var span = document.createElement('span');
    span.className = m[1] ? 'c' : m[2] ? 's' : (m[3] || m[4]) ? 'k' : 'f';
    span.textContent = m[0];
    frag.appendChild(span);
    last = _HL.lastIndex;
  }
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
  return frag;
}
function showScript() {
  var body = document.getElementById('code-body');
  var text = S.scripts[S.tab] || '// No content  -  load a HAR file first';
  body.textContent = '';
  if (text.length < 400000) body.appendChild(_highlight(text));
  else body.textContent = text;
}

// ===========================================================================
// SELECT MODE — manual transactions
// ===========================================================================
function _setSelUi() {
  var btn = document.getElementById('btn-sel');
  btn.setAttribute('aria-pressed', String(S.selMode));
  document.getElementById('sel-bar').classList.toggle('show', S.selMode);
  document.getElementById('main').classList.toggle('selmode', S.selMode);
  _updateSelCount();
}
function _updateSelCount() {
  document.getElementById('sel-cnt').textContent = S.selIds.size + ' selected';
  var b = document.getElementById('btn-create-txn'); if (b) b.disabled = S.selIds.size === 0;
}
function toggleSelMode() {
  S.selMode = !S.selMode;
  if (!S.selMode) clearSel();
  _setSelUi();
  renderTable();
}
function rowClick(id) {
  if (!S.selMode) return;
  var e = S.entries.find(function (x) { return x.id === id; });
  if (!e || e.filtered || e.isMarker) return;
  if (S.selIds.has(id)) S.selIds.delete(id);
  else S.selIds.add(id);
  var row = document.getElementById('r' + id);
  if (row) { row.classList.toggle('sel', S.selIds.has(id)); if (row.hasAttribute('aria-selected')) row.setAttribute('aria-selected', String(S.selIds.has(id))); }
  _updateSelCount();
}
function clearSel() {
  S.selIds.clear();
  RC.$$('#tbody tr.sel').forEach(function (r) { r.classList.remove('sel'); });
  _updateSelCount();
}

var _txnDlgMode = { mode: 'create', name: null };
function _openTxnDialog(mode, name) {
  _txnDlgMode = { mode: mode, name: name || null };
  var dlg = document.getElementById('txn-dlg'), inp = document.getElementById('txn-inp');
  document.getElementById('txn-err').hidden = true; inp.removeAttribute('aria-invalid');
  document.getElementById('txn-h').textContent = mode === 'rename' ? 'Rename transaction' : 'Create transaction';
  document.getElementById('txn-ok').textContent = mode === 'rename' ? 'Rename' : 'Create';
  if (mode === 'rename') {
    inp.value = name;
    document.getElementById('txn-sub').textContent = 'The new name is used in the script and in the request list.';
  } else {
    var ids = Array.from(S.selIds).sort(function (a, b) { return a - b; });
    inp.value = 'T' + String(S.txns.length + 1).padStart(2, '0') + '_';
    document.getElementById('txn-sub').textContent = ids.length === 1
      ? 'Request #' + ids[0] + ' is grouped into a new transaction.'
      : 'START is placed before request #' + ids[0] + ' and END after request #' + ids[ids.length - 1] + '. The ' + ids.length + ' requests you selected are grouped into the new transaction.';
  }
  if (!dlg.open) dlg.showModal();
  setTimeout(function () { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }, 30);
}
function openTxnModal() {
  if (S.selIds.size === 0) { showToast('Click rows to select them first.', 'warning'); return; }
  _openTxnDialog('create');
}
function closeModal() { var d = document.getElementById('txn-dlg'); if (d.open) d.close(); }

function _txnError(msg) {
  var err = document.getElementById('txn-err'), inp = document.getElementById('txn-inp');
  err.textContent = msg; err.hidden = false; inp.setAttribute('aria-invalid', 'true'); inp.focus();
}

// Same insertion as the classic page: START before the first selected request,
// END after the last; only the selected requests are tagged with the name.
function _createTxn(name, ids) {
  var firstIdx = S.entries.findIndex(function (e) { return e.id === ids[0]; });
  var lastIdx = S.entries.findIndex(function (e) { return e.id === ids[ids.length - 1]; });
  if (firstIdx < 0 || lastIdx < 0) return false;
  var c = COLORS[S.txns.length % COLORS.length];
  S.txns.push({ name: name, color: c });
  S.colorMap[name] = c;
  var mk = function (type) {
    return { id: -Date.now() - Math.random(), url: '', method: '', status: 0, ct: '',
      size: 0, dur: 0, reqHdrs: [], hdrsMap: {}, body: null, referer: '',
      isMarker: true, markerType: type, txnName: name, filtered: false, txn: null };
  };
  S.entries.splice(lastIdx + 1, 0, mk('end'));
  S.entries.splice(firstIdx, 0, mk('start'));
  for (var i = 0; i < S.entries.length; i++) { var e = S.entries[i]; if (ids.includes(e.id)) e.txn = name; }
  return true;
}
function _renameTxn(from, to) {
  S.entries.forEach(function (e) {
    if (e.isMarker && e.txnName === from) e.txnName = to;
    else if (e.txn === from) e.txn = to;
  });
  S.txns.forEach(function (t) { if (t.name === from) t.name = to; });
  if (S.colorMap[from]) { S.colorMap[to] = S.colorMap[from]; delete S.colorMap[from]; }
  if (S.collapsed[from] !== undefined) { S.collapsed[to] = S.collapsed[from]; delete S.collapsed[from]; }
}
function _ungroupTxn(name) {
  S.entries = S.entries.filter(function (e) { return !(e.isMarker && e.txnName === name); });
  // requests of that transaction now belong to the transaction around it (if any)
  var open = [];
  S.entries.forEach(function (e) {
    if (e.isMarker) {
      if (e.markerType === 'start') open.push(e.txnName);
      else { var k = open.lastIndexOf(e.txnName); if (k >= 0) open.splice(k); }
    } else if (e.txn === name) e.txn = open.length ? open[open.length - 1] : null;
  });
  S.txns = S.txns.filter(function (t) { return t.name !== name; });
  delete S.colorMap[name]; delete S.collapsed[name];
}
function _txnSnapshot() {
  return { entries: S.entries.slice(), fields: S.entries.map(function (e) { return [e.txn, e.txnName]; }),
    txns: S.txns.map(function (t) { return { name: t.name, color: t.color }; }),
    colorMap: Object.assign({}, S.colorMap), collapsed: Object.assign({}, S.collapsed), log: _txnLog.length };
}
function _txnRestore(s) {
  S.entries = s.entries;
  S.entries.forEach(function (e, i) { e.txn = s.fields[i][0]; e.txnName = s.fields[i][1]; });
  S.txns = s.txns; S.colorMap = s.colorMap; S.collapsed = s.collapsed; _txnLog.length = s.log;
  _regen();
}
function _regen() { buildScripts(); renderTable(); renderStats(); showScript(); }
function _dropUndo() { RC.$$('#toast-container .has-undo').forEach(function (t) { if (t.parentNode) t.parentNode.removeChild(t); }); }
function _focusReqs(name) {
  var b = name && document.querySelector('#tbody tr.start[data-grp="' + (window.CSS && CSS.escape ? CSS.escape(name) : name) + '"] .rc-grp');
  (b || document.querySelector('.rc-reqs')).focus();
}

function confirmTxn() {
  var inp = document.getElementById('txn-inp');
  var name = inp.value.trim();
  if (!name) { _txnError('Enter a transaction name.'); return; }
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) { _txnError('Name must start with a letter and contain only letters, numbers, underscores.'); return; }
  var taken = S.txns.some(function (t) { return t.name === name; });
  if (_txnDlgMode.mode === 'rename') {
    var from = _txnDlgMode.name;
    if (name !== from && taken) { _txnError('A transaction called ' + name + ' already exists — choose another name.'); return; }
    closeModal();
    if (name === from) { _focusReqs(from); return; }
    var snap = _txnSnapshot();
    _renameTxn(from, name); _txnLog.push({ op: 'rename', from: from, to: name }); _regen(); _focusReqs(name);
    _toast('Renamed ' + from + ' to ' + name, 'success', null, { label: 'Undo', run: function () { _txnRestore(snap); } });
    return;
  }
  if (taken) { _txnError('A transaction called ' + name + ' already exists — choose another name.'); return; }
  closeModal();
  var ids = Array.from(S.selIds).sort(function (a, b) { return a - b; });
  var snap2 = _txnSnapshot();
  if (!_createTxn(name, ids)) return;
  _txnLog.push({ op: 'create', name: name, ids: ids });
  S.selMode = false;
  clearSel();
  _setSelUi();
  _regen();
  _focusReqs(name);
  _toast('Transaction ' + name + ' created', 'success', null, { label: 'Undo', run: function () { _txnRestore(snap2); } });
}

function _ungroupWithUndo(name) {
  var snap = _txnSnapshot();
  _ungroupTxn(name); _txnLog.push({ op: 'ungroup', name: name }); _regen(); _focusReqs();
  _toast('Transaction ' + name + ' removed — its requests stay in the script', 'success', null, { label: 'Undo', run: function () { _txnRestore(snap); } });
}

// Replay manual edits after the recording was processed again (format change)
function _replayTxnLog(log) {
  var kept = 0;
  log.forEach(function (op) {
    if (op.op === 'create') { if (_createTxn(op.name, op.ids)) { kept++; _txnLog.push(op); } }
    else if (op.op === 'rename') { if (S.txns.some(function (t) { return t.name === op.from; })) { _renameTxn(op.from, op.to); _txnLog.push(op); } }
    else if (op.op === 'ungroup') { if (S.txns.some(function (t) { return t.name === op.name; })) { _ungroupTxn(op.name); _txnLog.push(op); } }
  });
  return kept;
}

// ===========================================================================
// DOMAINS
// ===========================================================================
function renderDomainPanel(search) {
  var q = (search || '').trim().toLowerCase();
  var all = Object.keys(S.domainStats);
  var domains = all.filter(function (d) { return !q || d.includes(q); })
    .sort(function (a, b) { return S.domainStats[b].count - S.domainStats[a].count; });
  var active = Object.values(S.domainFilter).filter(Boolean).length;
  document.getElementById('dp-title').textContent = 'Domains';
  document.getElementById('dp-count').textContent = all.length ? active + '/' + all.length : '';
  var list = document.getElementById('dp-list');
  if (!domains.length) {
    list.innerHTML = '<div class="rc-empty sm">' + (q ? 'No domain matches “' + esc(q) + '”' : all.length ? 'No domains' : 'Load a HAR file') + '</div>';
    return;
  }
  var max = Math.max.apply(null, [1].concat(all.map(function (d) { return S.domainStats[d].size || 0; })));
  list.innerHTML = domains.map(function (d) {
    var st = S.domainStats[d], on = S.domainFilter[d] !== false;
    return '<div class="rc-dom' + (on ? ' on' : '') + '" role="switch" aria-checked="' + on + '" tabindex="0" data-host="' + esc(d) + '" title="' + esc(d) + (on ? ' — in the script' : ' — left out of the script') + '">' +
      '<span class="sw"></span><b>' + (d ? esc(d) : '<i>no host (data:, blob: …)</i>') + '</b><span>' + _plural(st.count, 'request') + ' · ' + fmtSize(st.size) +
      '<div class="bar" style="width:' + Math.max(4, (st.size || 0) / max * 100) + '%"></div></span></div>';
  }).join('');
}
function _domSearch() { var s = document.querySelector('.dp-search'); return s ? s.value : ''; }
function onDpClick(event, domain) { toggleDomain(domain, S.domainFilter[domain] === false); }
function toggleDomain(domain, state) {
  S.domainFilter[domain] = state;
  renderDomainPanel(_domSearch());
  applyFilters(); buildScripts(); renderTable(); renderStats(); showScript();
}
function toggleAllDomains(state) {
  Object.keys(S.domainFilter).forEach(function (d) { S.domainFilter[d] = state; });
  renderDomainPanel(_domSearch());
  applyFilters(); buildScripts(); renderTable(); renderStats(); showScript();
}

// ===========================================================================
// FORMAT DIALOG
// ===========================================================================
function openFmtModal(fromToolbar) {
  _fmtDlg = { fromToolbar: !!fromToolbar, prev: S.format };
  ['webhttp', 'devweb', 'both'].forEach(function (f) { var r = document.getElementById('fc-' + f); if (r) r.checked = f === S.format; });
  document.getElementById('fmt-cancel-btn').textContent = fromToolbar ? 'Cancel' : 'Choose another file';
  document.getElementById('fmt-sub').textContent = fromToolbar
    ? 'Select the protocol your LRE project uses. Your filters and transactions are kept.'
    : 'Select the protocol your LRE project uses. You can change this later.';
  var d = document.getElementById('fmt-dlg');
  if (!d.open) d.showModal();
}
function selectFmt(fmt) {
  S.format = fmt;
  ['webhttp', 'devweb', 'both'].forEach(function (f) { var r = document.getElementById('fc-' + f); if (r) r.checked = f === fmt; });
}
// Cancel: keep the format that was in use (the classic page kept the clicked card by mistake)
function closeFmtModal() {
  S.format = _fmtDlg.prev;
  if (!_fmtDlg.fromToolbar) {
    // the chosen file is dropped; the open recording (if any) stays exactly as it was
    S.pendingHar = _stash ? _stash.har : null; S.pendingNetLog = _stash ? _stash.netlog : null;
    _stash = null; _nextFile = null;
  }
  var d = document.getElementById('fmt-dlg'); if (d.open) d.close();
  _focusAfterFmt();
}
function _focusAfterFmt() {
  var t = !document.getElementById('main').hidden ? document.getElementById('btn-change-fmt') : document.getElementById('dz');
  if (t) t.focus();
}
function confirmFmt() {
  var fromToolbar = _fmtDlg.fromToolbar;
  var d = document.getElementById('fmt-dlg'); if (d.open) d.close();
  var replay = fromToolbar ? _txnLog.slice() : [];
  _txnLog = [];
  _dropUndo();
  if (!fromToolbar) {
    S.domainFilter = {};                           // a new file: domain choices start fresh (classic readFile did this)
    if (_nextFile) _file = _nextFile;
    _nextFile = null; _stash = null; _showAllRows = false;
  }
  if (S.pendingNetLog) {
    processNetLog(S.pendingNetLog);
  } else {
    processHAR(S.pendingHar);
  }
  // NetLog without requests: processNetLog has reported it — stay on the start page
  if (S.isNetLogSource && S.entries.length === 0) { showWelcome(); return; }
  if (!S.isNetLogSource && S.entries.length === 0 && !fromToolbar) {
    var har = S.pendingHar || {};
    _showStartError(har.log && har.log.entries ? 'This recording has no requests' : 'This file has no HAR entries',
      har.log && har.log.entries ? 'The HAR file is valid but contains no requests.' : "The file is valid JSON but doesn't contain a recording (log.entries).",
      har.log && har.log.entries ? 'Record the journey again with the Network tab open, then export the HAR.' : 'Check that you picked the .har file, not another JSON file.');
    return;
  }
  var kept = 0;
  if (replay.length) { kept = _replayTxnLog(replay); _regen(); }
  document.getElementById('welcome').hidden = true;
  document.getElementById('main').hidden = false;
  applyFmtUI();
  _renderFileInfo();
  _focusAfterFmt();
  if (fromToolbar) _toast('Format: ' + (S.format === 'devweb' ? 'DevWeb' : S.format === 'both' ? 'both formats' : 'Web HTTP/HTML') + (kept ? ' — your ' + _plural(kept, 'transaction') + ' kept' : ''), 'success');
}
// Continue button: report a recording the engine could not read instead of failing silently
function _onFmtContinue() {
  var n = S.pendingNetLog ? ((S.pendingNetLog.events || []).length / 20) : ((S.pendingHar && S.pendingHar.log && S.pendingHar.log.entries) || []).length;
  var d = document.getElementById('fmt-dlg'); if (n >= ROW_LIMIT_FROM && d.open) d.close();
  _busy('Building the script…', n >= ROW_LIMIT_FROM, function () {
    try { confirmFmt(); }
    catch (err) {
      showWelcome();
      _showStartError('This recording could not be read', 'Some entries in the file are damaged (' + err.message + ').', 'Export the HAR again, or record the journey again.');
    }
  });
}
// Run fn now, or — for large recordings — after the progress overlay has been painted
function _busy(label, big, fn) {
  if (!big) { fn(); return; }
  _progress(true, label);
  setTimeout(function () { try { fn(); } finally { _progress(false); } }, 40);
}
function _isBig() { return S.entries.length >= ROW_LIMIT_FROM; }

function applyFmtUI() {
  var isWeb = S.format === 'webhttp' || S.format === 'both';
  var isDev = S.format === 'devweb' || S.format === 'both';
  ['ac', 'vi', 've', 'gh'].forEach(function (t) { document.querySelector('[data-tab="' + t + '"]').hidden = !isWeb; });
  document.querySelector('[data-tab="mj"]').hidden = !isDev;
  document.getElementById('dl-webhttp').hidden = !isWeb;
  document.getElementById('dl-devweb').hidden = !isDev;
  var labels = { webhttp: 'Web HTTP/HTML', devweb: 'DevWeb', both: 'Both formats' };
  document.getElementById('fmt-label').textContent = labels[S.format] || '';
  document.getElementById('fmt-badge').classList.toggle('dev', isDev && !isWeb);
  document.getElementById('dl-hint').innerHTML = isDev && !isWeb
    ? '<b>DevWebScript.zip</b> — DevWeb project: main.js plus the project files, ready for LRE or VuGen.'
    : isWeb && !isDev ? '<b>WebHttpScript.zip</b> — VuGen project: the files in the preview plus the project files (.usr, .prm …), ready for VuGen or LRE.'
    : '<b>WebHttpScript.zip</b> and <b>DevWebScript.zip</b> — one project per format.';
  if (isDev && !isWeb) switchTab(document.querySelector('[data-tab="mj"]'), 'mj');
  else switchTab(document.querySelector('[data-tab="ac"]'), 'ac');
}

function _renderFileInfo() {
  var src = S.isNetLogSource ? 'Chrome NetLog (chrome://net-export/)'
    : S.harPages && S.harPages.size ? 'recorded with the CDP Recorder (pages = transactions)' : 'HAR file';
  document.getElementById('file-name').textContent = _file ? _file.name : 'Recording';
  document.getElementById('file-meta').textContent = (_file && _file.size ? fmtSize(_file.size) + ' · ' : '') + src;
}

// ===========================================================================
// NAVIGATION
// ===========================================================================
function showWelcome() {
  document.getElementById('welcome').hidden = false;
  document.getElementById('main').hidden = true;
  var bar = document.getElementById('resume');
  if (bar) { bar.hidden = !S.entries.length; document.getElementById('resume-name').textContent = _file ? _file.name : 'a recording'; }
}
function _backToWorkspace() {
  if (!S.entries.length) return;
  document.getElementById('welcome').hidden = true;
  document.getElementById('main').hidden = false;
}

function _ask(title, text, okLabel, then) {
  var d = document.getElementById('confirm-dlg');
  document.getElementById('confirm-h').textContent = title;
  document.getElementById('confirm-t').textContent = text;
  document.getElementById('confirm-ok').textContent = okLabel;
  d.returnValue = '';
  d.onclose = function () { if (d.returnValue === 'ok') then(); };
  d.showModal();
}
function clearAll() {
  if (S.entries.length > 0) {
    _ask('Clear all data?', 'The loaded recording, its filters and the transactions you created are removed, and you return to the start page.', 'Clear', _doClear);
    return;
  }
  _doClear();
}
function _doClear() {
  S.entries = []; S.txns = []; S.colorMap = {}; S.selIds.clear(); S.scripts = {}; S.pendingHar = null; S.pendingNetLog = null; S.isNetLogSource = false; S.domainFilter = {}; S.domainStats = {}; S.auth = null; S.serverHost = null;
  S.selMode = false; _txnLog = []; _file = null; _nextFile = null; _stash = null; _showAllRows = false;
  _dropUndo();
  document.getElementById('tbody').innerHTML = '';
  document.getElementById('stats').textContent = '';
  document.getElementById('auth-badge').hidden = true;
  document.getElementById('code-body').textContent = '// Load a HAR file to generate scripts';
  document.getElementById('hf').value = '';
  document.getElementById('dp-list').innerHTML = '<div class="rc-empty sm">Load a HAR file</div>';
  document.getElementById('dp-title').textContent = 'Domains';
  document.getElementById('dp-count').textContent = '';
  _setSelUi();
  _hideStartError();
  showWelcome();
}

// ── hand the loaded file to Script Studio (portal: same window; standalone: new tab) ──
function _openInStudio() {
  if (!_file || !_file.file) { _toast('Load a recording first.', 'warning'); return; }
  var shell = null;
  try { shell = window.parent !== window && window.parent.PerfxShell ? window.parent : null; } catch (e) { shell = null; }
  if (!shell) {
    window.open((location.pathname.indexOf('/converter') === 0 ? '/converter' : '') + '/studio', '_blank');
    _toast('Script Studio opened in a new tab — load ' + _file.name + ' there (Load HAR).', 'info', 7000);
    return;
  }
  shell.PerfxShell.go('studio');
  var file = _file.file, tries = 0;
  (function wait() {
    var f = shell.document.getElementById('iframe-studio');
    var w = f && f.contentWindow;
    var ready = w && w.document && w.document.readyState === 'complete' && typeof w.loadFile === 'function' && w.document.getElementById('dz1');
    if (ready) { try { w.loadFile(file, 1); } catch (e) { /* Studio shows its own message */ } return; }
    if (++tries < 150) setTimeout(wait, 100);
  })();
}

// ===========================================================================
// LAYOUT: hide / show panels, resize panes — remembered per browser
// ===========================================================================
function _setPane(cls, hide) {
  var sp = document.getElementById('rc-split');
  // the request list and the script preview are never hidden together
  var other = cls === 'no-req' ? 'no-code' : cls === 'no-code' ? 'no-req' : null;
  if (hide && other && sp.classList.contains(other)) { sp.classList.remove(other); RC.save(other, false); }
  sp.classList.toggle(cls, hide);
  sp.scrollLeft = 0;
  RC.save(cls, hide);
}
function setupResizer() { /* the panes are resized by _initResizers() */ }
function _initResizers() {
  var sp = document.getElementById('rc-split');
  if (RC.prefs.dw) sp.style.setProperty('--dw', RC.prefs.dw + 'px');
  if (RC.prefs.cw) sp.style.setProperty('--cw', RC.prefs.cw + 'px');
  RC.$$('.rc-rs', sp).forEach(function (rs) {
    rs.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      var left = rs.dataset.rs === 'left', start = e.clientX;
      var pane = left ? sp.querySelector('.dom-pane') : sp.querySelector('.code-pane');
      var w0 = pane.getBoundingClientRect().width, w = w0;
      rs.setPointerCapture(e.pointerId); rs.classList.add('on');
      var move = function (m) {
        var dx = m.clientX - start;
        w = left ? Math.max(180, Math.min(440, w0 + dx)) : Math.max(260, Math.min(900, w0 - dx));
        sp.style.setProperty(left ? '--dw' : '--cw', w + 'px');
      };
      var up = function () {
        rs.classList.remove('on'); rs.removeEventListener('pointermove', move); rs.removeEventListener('pointerup', up);
        RC.save(left ? 'dw' : 'cw', Math.round(w));
      };
      rs.addEventListener('pointermove', move);
      rs.addEventListener('pointerup', up);
    });
  });
}

// ===========================================================================
// WIRING
// ===========================================================================
(function init() {
  var $ = RC.$, $$ = RC.$$;
  if (window.parent !== window) document.documentElement.classList.add('embedded');
  _setTheme(document.documentElement.getAttribute('data-theme') || 'dark');

  // CDP Recorder download: works at /recorder and under the IIS /converter virtual directory
  var dl = document.getElementById('cdp-dl');
  if (dl) dl.href = (location.pathname.indexOf('/converter') === 0 ? '/converter' : '') + '/downloads/cdp-recorder';

  // start page
  var dz = document.getElementById('dz');
  dz.addEventListener('click', function () { document.getElementById('hf').click(); });
  dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); document.getElementById('hf').click(); } });
  $$('.rc-tab').forEach(function (t) {
    t.addEventListener('click', function () {
      $$('.rc-tab').forEach(function (x) { x.setAttribute('aria-selected', String(x === t)); });
      $$('.rc-panel').forEach(function (p) { p.hidden = p.id !== t.getAttribute('aria-controls'); });
      RC.save('method', t.id);
    });
  });
  if (RC.prefs.method && document.getElementById(RC.prefs.method)) document.getElementById(RC.prefs.method).click();
  var how = document.getElementById('how');
  if (RC.prefs.howClosed) how.open = false;
  how.addEventListener('toggle', function () { RC.save('howClosed', !how.open); });
  $$('.rc-bm a').forEach(function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); _toast('Drag this button to your Bookmarks Bar — do not click it here.', 'warning'); });
  });

  // format dialog
  var fmt = document.getElementById('fmt-dlg');
  $$('input[name="fmt"]', fmt).forEach(function (r) { r.addEventListener('change', function () { selectFmt(r.value); }); });
  document.getElementById('fmt-go').addEventListener('click', _onFmtContinue);
  document.getElementById('fmt-cancel-btn').addEventListener('click', closeFmtModal);
  fmt.addEventListener('cancel', function (e) { e.preventDefault(); closeFmtModal(); });
  fmt.addEventListener('click', function (e) { if (e.target === fmt) closeFmtModal(); });

  // transaction dialog
  var txn = document.getElementById('txn-dlg');
  txn.addEventListener('close', function () { if (!S.selMode && !document.getElementById('main').hidden && document.activeElement === document.body) _focusReqs(); });
  document.getElementById('txn-ok').addEventListener('click', confirmTxn);
  document.getElementById('txn-inp').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); confirmTxn(); } });
  document.getElementById('txn-cancel').addEventListener('click', closeModal);
  txn.addEventListener('click', function (e) { if (e.target === txn) closeModal(); });
  var conf = document.getElementById('confirm-dlg');
  conf.addEventListener('click', function (e) { if (e.target === conf) conf.close('cancel'); });

  // workspace
  var main = document.getElementById('main');
  main.addEventListener('click', function (e) {
    var t = e.target;
    var act = t.closest('[data-act]');
    if (act) {
      var name = act.closest('[data-grp]').dataset.grp;
      if (act.dataset.act === 'toggle') toggleTxn(act);
      else if (act.dataset.act === 'rename') _openTxnDialog('rename', name);
      else if (act.dataset.act === 'ungroup') _ungroupWithUndo(name);
      return;
    }
    if (t.closest('#btn-show-all')) { _busy('Showing every request…', true, function () { _showAllRows = true; renderTable(); }); return; }
    var row = t.closest('tr.req');
    if (row) { rowClick(+row.dataset.id); return; }
    var dom = t.closest('.rc-dom');
    if (dom) { var host = dom.dataset.host, on = dom.classList.contains('on'); _busy('Applying filters…', _isBig(), function () { toggleDomain(host, !on); }); return; }
    var chip = t.closest('#rec-rt-bar [data-key]');
    if (chip) { var key = chip.dataset.key; _busy('Applying filters…', _isBig(), function () { setRecorderRt(key); }); return; }
    var hide = t.closest('[data-hide]');
    if (hide) { var sp = document.getElementById('rc-split'); _setPane(hide.dataset.hide, !sp.classList.contains(hide.dataset.hide)); return; }
    var tab = t.closest('.rc-ctab');
    if (tab) { switchTab(tab, tab.dataset.tab); }
  });
  main.addEventListener('keydown', function (e) {
    var dom = e.target.closest && e.target.closest('.rc-dom');
    if (dom && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      var h = dom.dataset.host;
      _busy('Applying filters…', _isBig(), function () {
        toggleDomain(h, !dom.classList.contains('on'));
        var again = document.querySelector('.rc-dom[data-host="' + (window.CSS && CSS.escape ? CSS.escape(h) : h) + '"]');
        if (again) again.focus();
      });
      return;
    }
    var row = e.target.closest && e.target.closest('tr.req[tabindex]');
    if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); rowClick(+row.dataset.id); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && S.selMode && !document.querySelector('dialog[open]')) toggleSelMode();
  });
  ['f-static', 'f-noise', 'f-opts'].forEach(function (id) { document.getElementById(id).addEventListener('change', function () { _busy('Applying filters…', _isBig(), function () { refresh(); _syncFilterSummary(); }); }); });
  document.querySelector('.dp-search').addEventListener('input', function (e) { renderDomainPanel(e.target.value); });
  document.getElementById('btn-dom-all').addEventListener('click', function () { _busy('Applying filters…', _isBig(), function () { toggleAllDomains(true); }); });
  document.getElementById('btn-dom-none').addEventListener('click', function () { _busy('Applying filters…', _isBig(), function () { toggleAllDomains(false); }); });
  var rh = document.getElementById('btn-res-help');
  var setHelp = function (show) { document.getElementById('res-help').hidden = !show; rh.setAttribute('aria-expanded', String(show)); };
  rh.addEventListener('click', function () { setHelp(document.getElementById('res-help').hidden); });
  document.getElementById('res-help-close').addEventListener('click', function () { setHelp(false); });
  var filters = document.getElementById('rc-filters');
  var fold = function (on) { filters.classList.toggle('folded', on); document.getElementById('btn-fold').setAttribute('aria-expanded', String(!on)); RC.save('filtersFolded', on); };
  document.getElementById('btn-fold').addEventListener('click', function () { fold(!filters.classList.contains('folded')); });
  if (RC.prefs.filtersFolded) fold(true);
  document.getElementById('btn-collapse-all').addEventListener('click', toggleCollapseAll);
  document.getElementById('btn-sel').addEventListener('click', toggleSelMode);
  $$('[data-selmode]').forEach(function (b) { b.addEventListener('click', function () { if (!S.selMode) toggleSelMode(); }); });
  document.getElementById('btn-create-txn').addEventListener('click', openTxnModal);
  document.getElementById('btn-sel-cancel').addEventListener('click', function () { if (S.selMode) toggleSelMode(); });
  document.getElementById('btn-change-fmt').addEventListener('click', function () { openFmtModal(true); });
  document.getElementById('btn-load-other').addEventListener('click', showWelcome);
  document.getElementById('btn-back-ws').addEventListener('click', _backToWorkspace);
  document.getElementById('btn-copy').addEventListener('click', copyCode);
  document.getElementById('btn-studio').addEventListener('click', _openInStudio);
  document.getElementById('dl-webhttp').addEventListener('click', function () { dlZip('webhttp'); });
  document.getElementById('dl-devweb').addEventListener('click', function () { dlZip('devweb'); });
  document.getElementById('start-err-x').addEventListener('click', _hideStartError);
  if (RC.prefs['no-dom']) _setPane('no-dom', true);
  if (RC.prefs['no-code']) _setPane('no-code', true);
  if (RC.prefs['no-req']) _setPane('no-req', true);
  _initResizers();
  _syncRtChips();
})();

/* ── keyboard and screen-reader extras (layout only; nothing here changes what the Recorder does) ──
 *  - Tab stays inside an open dialog (inside the portal's iframe a modal <dialog> does not keep it)
 *  - tab lists answer the arrow keys / Home / End
 *  - long file and transaction names can be read in full (title)
 *  - after a button hides itself (help ✕, a pane's hide button) the focus goes to the control that brings it back */
(function () {
  'use strict';
  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  function visible(el) { return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return;
    var dlg = document.querySelector('dialog[open]');
    if (!dlg) return;
    var items = Array.prototype.filter.call(dlg.querySelectorAll(FOCUSABLE), visible);
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1], at = document.activeElement;
    if (!dlg.contains(at)) { e.preventDefault(); first.focus(); return; }
    if (e.shiftKey && at === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  }, true);

  document.addEventListener('keydown', function (e) {
    var tab = e.target.closest && e.target.closest('[role="tab"]');
    if (!tab || !/^(ArrowLeft|ArrowRight|Home|End)$/.test(e.key)) return;
    var tabs = Array.prototype.filter.call(tab.parentElement.querySelectorAll('[role="tab"]'), visible);
    var i = tabs.indexOf(tab);
    var next = e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs[tabs.length - 1] : tabs[(i + (e.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length];
    if (!next || next === tab) return;
    e.preventDefault(); next.click(); next.focus(); if (next.scrollIntoView) next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });

  function titles() {
    ['file-name', 'file-meta'].forEach(function (id) { var el = document.getElementById(id); if (el && el.title !== el.textContent) el.title = el.textContent; });
    Array.prototype.forEach.call(document.querySelectorAll('.rc-grp .nm'), function (el) { if (el.title !== el.textContent) el.title = el.textContent; });
  }
  new MutationObserver(titles).observe(document.body, { subtree: true, childList: true, characterData: true });
  titles();

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('#res-help-close, .hide-btn, .rc-show');
    if (!b) return;
    setTimeout(function () {
      if (document.activeElement && document.activeElement !== document.body && visible(document.activeElement)) return;
      var sel = b.classList.contains('rc-show') ? '.hide-btn' : '.rc-show';   // shown again → its hide button; hidden → the show button
      var to = b.id === 'res-help-close' ? document.getElementById('btn-res-help')
        : Array.prototype.filter.call(document.querySelectorAll(sel + '[data-hide="' + b.getAttribute('data-hide') + '"]'), visible)[0];
      if (to) to.focus();
    }, 0);
  });
})();

// Drop a .har / NetLog .json anywhere on the page — it goes to the same file input as "Browse file"
(function () {
  if (!window.PerfxDrop) return;
  window.PerfxDrop.attach({
    label: function () { return ['Drop to load the recording', '.har or NetLog .json']; },
    route: function (files, ext) {
      var rec = files.filter(function (f) { return ext(f) === '.har' || ext(f) === '.json'; });
      return [{ input: document.getElementById('hf'), files: rec.slice(0, 1) }];
    },
  });
})();

// Remember the script format per browser (localStorage "perfx-rec-format"): the format dialog opens on the
// format used last time. Saved when the dialog closes — by then Cancel has already put back the previous one.
(function () {
  var KEY = 'perfx-rec-format', OK = ['webhttp', 'devweb', 'both'];
  try { var f = localStorage.getItem(KEY); if (OK.indexOf(f) !== -1 && typeof S !== 'undefined') S.format = f; } catch (e) { /* storage blocked */ }
  var d = document.getElementById('fmt-dlg');
  if (d) d.addEventListener('close', function () { try { if (OK.indexOf(S.format) !== -1) localStorage.setItem(KEY, S.format); } catch (e) { /* storage blocked */ } });
})();
