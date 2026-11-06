/* portal/record-live.js — "Start recording", shared by the Recorder page and Script Studio.
 *
 * Drives the CDP Recorder on this computer (cdp-recorder.exe, control server on localhost:8787):
 *  - not running → opens the perfx-recorder: link, which starts it (the browser asks the user once), then waits for
 *    it to answer;
 *  - running without this page on its list (started by hand — some computers do not let the browser start
 *    programs) → POST /api/ask: the recorder's toolbar asks Allow / Don't allow, an allowed page is remembered.
 *    A recorder older than 0.2.1 cannot be asked: the link hands it this page's origin instead;
 *  - POST /api/session → the recorder opens Edge / Chrome (private window if ticked) and the floating toolbar, and
 *    opens the address once capture is confirmed;
 *  - while recording: /api/status + /api/live every second → the live view (requests grouped by transaction, static
 *    files and background calls folded, find, follow newest), transactions started / ended here too;
 *  - Stop (here or on the toolbar) → the recorder saves the .har to Downloads → this page fetches it and hands it to
 *    the page (onSaved) — the same path as a dropped file.
 * The module draws its own window and live view (classes rl-*, portal/record-live.css); each page mounts it with its
 * hooks — portal/recorder-live.js (Recorder), portal/studio-page.js (Script Studio).
 * The recorder's side: cdp-recorder/recorder/src/server.ts, app.ts (portal mode).
 */
(function () {
  'use strict';

  var REC = 'http://localhost:8787';
  var LATEST = '0.2.1';            // the CDP Recorder version these pages are made for (cdp-recorder/recorder/src/version.ts)
  var PREF = 'perfx-rec-live';     // remembered choices: recent addresses, browser, private window, name, last transaction
  var STATIC_TYPES = { Image: 1, Stylesheet: 1, Script: 1, Font: 1, Media: 1 };
  var ROWS_PER_GROUP = 400;        // rows drawn per open transaction (the newest)
  var CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  var DOT = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><circle cx="12" cy="12" r="6.5"/></svg>';

  var $ = function (id) { return document.getElementById(id); };
  var P = null;                    // the page's hooks (mount)
  var prefs = loadPrefs();
  var st = null;                   // last /api/status answer (null = no recorder answering)
  var L = null;                    // the live recording on screen
  var launch = null;               // the start sequence in progress { cancelled }
  var idleTimer = null;

  function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREF) || '{}') || {}; } catch (e) { return {}; } }
  function savePrefs() { try { localStorage.setItem(PREF, JSON.stringify(prefs)); } catch (e) { /* private window */ } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function toast(msg, type, ms) { if (typeof window.showToast === 'function') window.showToast(msg, type, ms); }
  function newer(a, b) {   // is version b newer than a?
    var x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
    for (var i = 0; i < 3; i++) { if ((y[i] || 0) !== (x[i] || 0)) return (y[i] || 0) > (x[i] || 0); }
    return false;
  }

  // ── the recorder's control API ────────────────────────────────────────────
  function api(method, path, body, timeoutMs) {
    var opt = { method: method, headers: {} };
    if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    if (window.AbortSignal && AbortSignal.timeout) opt.signal = AbortSignal.timeout(timeoutMs || 5000);
    return fetch(REC + path, opt).then(function (r) {
      return r.text().then(function (t) {
        var j = {}; try { j = t ? JSON.parse(t) : {}; } catch (e) { j = { text: t }; }
        if (!r.ok) { var err = new Error(j.error || ('The CDP Recorder answered ' + r.status)); err.status = r.status; throw err; }
        return j;
      });
    });
  }
  function refresh() {
    return api('GET', '/api/status', null, 1500).then(function (s) { st = s; return s; }, function () { st = null; return null; });
  }
  // perfx-recorder: link — starts the recorder (registered by its first double-click) or hands it this page.
  // Must run inside the click: browsers open such links only from a user action.
  function openLink() {
    var a = document.createElement('a');
    a.href = 'perfx-recorder://start?portal=' + encodeURIComponent(location.origin);
    a.style.display = 'none';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  // ── markup (drawn once, by mount) ────────────────────────────────────────
  function dialogHtml() {
    return '<form method="dialog" onsubmit="return false">' +
      '<div class="rl-dlg-head"><span class="rl-dot-ico">' + DOT + '</span><div><h3 id="lv-h">Start recording</h3><p id="lv-sub">Choose what to open and how.</p></div></div>' +
      '<div class="rl-dlg-body" id="lv-form">' +
        '<label class="rl-field">Application address' +
          '<input class="ds-field" id="lv-url-inp" type="url" autocomplete="off" spellcheck="false" placeholder="https://your-application/login" list="lv-recent">' +
          '<datalist id="lv-recent"></datalist>' +
          '<span class="rl-ferr" id="lv-url-err" role="alert" hidden>Enter an address starting with http:// or https://</span></label>' +
        '<div class="rl-recent" id="lv-recent-chips"></div>' +
        '<div class="rl-field"><span id="lv-br-lb">Browser</span><div class="rl-cards" role="radiogroup" aria-labelledby="lv-br-lb">' +
          '<label class="rl-card"><input type="radio" name="lvb" value="edge" checked><span class="t"><i><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20.5 13A8.5 8.5 0 1 1 12 3.5c4.7 0 8.5 3 8.5 6.5 0 2-1.6 3.2-3.6 3.2-2.4 0-3.4-1.6-3.4-3.2"/></svg></i>Microsoft Edge</span><small data-br="edge">Recommended</small><span class="radio" aria-hidden="true"></span></label>' +
          '<label class="rl-card"><input type="radio" name="lvb" value="chrome"><span class="t"><i><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M12 8.5h8.5M9 14 4.8 6.7M15 14l-4.2 7.4"/></svg></i>Google Chrome</span><small data-br="chrome">If Edge is blocked</small><span class="radio" aria-hidden="true"></span></label>' +
        '</div></div>' +
        '<label class="rl-toggle"><input type="checkbox" id="lv-priv" checked><span><b id="lv-priv-t">Open a private window</b><small>Optional — untick it if your application does not work in a private window. Either way the recording window starts signed out, in a fresh browser profile, so the login is recorded too.</small></span></label>' +
        '<details class="rl-more"><summary>More options</summary><div class="rl-row">' +
          '<label class="rl-field">Recording name<input class="ds-field" id="lv-name" type="text" autocomplete="off" spellcheck="false" maxlength="60" placeholder="e.g. SC01_Booking"><small>Used for the file name.</small></label>' +
          '<label class="rl-field">First transaction<input class="ds-field" id="lv-first" type="text" autocomplete="off" spellcheck="false" maxlength="60" placeholder="e.g. T01_Launch"><small>Starts when the page opens.</small></label>' +
        '</div></details>' +
        '<div class="rl-save ds-note ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14"/></svg><span>Saved automatically to your <b>Downloads</b> folder as <code id="lv-file">Recording_….har</code></span></div>' +
      '</div>' +
      '<div class="rl-dlg-body" id="lv-launch" hidden>' +
        '<ol class="rl-steps" id="lv-steps">' +
          '<li data-s="rec"><i></i><span id="lv-step-rec"></span></li>' +
          '<li data-s="br"><i></i><span id="lv-step-br">Opening Edge</span></li>' +
          '<li data-s="url"><i></i><span>Opening <code id="lv-step-url"></code></span></li>' +
        '</ol>' +
        '<div class="rl-msg ds-note bad" id="lv-fail" hidden role="alert"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg><div><b id="lv-fail-t"></b><p id="lv-fail-m"></p></div></div>' +
        '<div class="rl-msg ds-note" id="lv-setup" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg><div><b>Not set up on this computer yet?</b>' +
          '<ol><li><a href="downloads/cdp-recorder" id="lv-dl">Download cdp-recorder.zip</a> and extract it to a folder that stays and where your computer lets you run programs, for example <code>C:\\PerfX\\cdp-recorder</code> — not inside your user profile folder (such as Downloads, Desktop or Documents).</li>' +
          '<li>Double-click <code>cdp-recorder.exe</code> — no administrator rights needed. A small toolbar and a browser window open; you don\'t need to record anything in them.</li>' +
          '<li>Come back and click <b>Try again</b>, then <b>Allow</b> on the toolbar (asked once — it remembers this page).</li></ol>' +
          '<p><b>Next time:</b> if Start recording says the CDP Recorder did not start, start <code>cdp-recorder.exe</code> yourself first, then click Start recording.</p></div></div>' +
      '</div>' +
      '<div class="rl-dlg-foot"><span class="rl-hint" id="lv-hint">A separate window opens — your browser windows stay as they are.</span><span class="rl-grow"></span>' +
        '<button class="ds-btn" type="button" id="lv-cancel">Cancel</button>' +
        '<button class="ds-btn ds-btn-primary" type="button" id="lv-go">' + DOT + 'Start recording</button></div>' +
    '</form>';
  }
  function liveHtml() {
    var tog = function (id, label, title, checked) {
      return '<label class="rl-tog" title="' + title + '"><input type="checkbox" id="' + id + '" class="rl-vh"' + (checked ? ' checked' : '') + '><span class="box">' + CHECK + '</span>' + label + '</label>';
    };
    return '<div class="ds-card rl-bar">' +
        '<span class="rl-recdot"><i aria-hidden="true"></i><span>Recording</span></span>' +
        '<span class="rl-timer" id="lv-timer" aria-label="Recording time">00:00</span>' +
        '<span class="rl-kpi"><b id="lv-n">0</b><small>requests</small></span>' +
        '<span class="rl-kpi"><b id="lv-bg">0</b><small>background</small></span>' +
        '<span class="rl-kpi"><b id="lv-tabs">1</b><small>windows and tabs</small></span>' +
        '<span class="rl-kpi"><b id="lv-br">Edge</b><small id="lv-mode">normal window</small></span>' +
        '<span class="rl-grow"></span>' +
        '<button class="ds-btn ds-btn-lg rl-stop" type="button" id="lv-stop"><svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>Stop and save</button>' +
      '</div>' +
      '<div class="rl-warn ds-note warn" id="lv-warn" hidden role="alert"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg><span id="lv-warn-t"></span></div>' +
      '<div class="rl-grid">' +
        '<section class="ds-card rl-req" aria-labelledby="lv-req-h">' +
          '<h2 id="lv-req-h">Requests as they happen</h2><p class="rl-sub">In <code id="lv-url"></code> — keep using your application in the recording window.</p>' +
          '<div class="rl-tools">' +
            '<span class="rl-find"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input class="ds-field" id="lv-filter" type="search" placeholder="Find in addresses…" aria-label="Find in the recorded addresses"></span>' +
            tog('lv-static', 'Static files', 'Show images, style sheets, scripts and fonts one by one instead of one line per transaction') +
            tog('lv-bgshow', 'Background calls', 'Show background calls (polling, keep-alive) one by one instead of one line per transaction') +
            tog('lv-follow', 'Follow newest', 'Keep the newest request in view — scrolling up pauses it', true) +
            '<span class="rl-grow"></span><button class="rl-mini" type="button" id="lv-fold-all">Fold all</button>' +
          '</div>' +
          '<div class="rl-feed" id="lv-feed" tabindex="0" aria-label="Recorded requests, grouped by transaction"></div>' +
          '<button class="rl-mini rl-newest" type="button" id="lv-newest" hidden>Newest<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M6 13l6 6 6-6"/></svg></button>' +
        '</section>' +
        '<section class="ds-card rl-tx" aria-labelledby="lv-tx-h">' +
          '<h2 id="lv-tx-h">Transactions</h2><p class="rl-sub">Type the name, click Start, then do the steps in the recording window.</p>' +
          '<label class="rl-field">Transaction name<input class="ds-field" id="lv-tx-name" type="text" autocomplete="off" spellcheck="false" placeholder="e.g. T01_Login"><span class="rl-ferr" id="lv-tx-err" role="alert" hidden></span></label>' +
          '<div class="rl-txbtns"><button class="ds-btn ds-btn-primary" type="button" id="lv-tx-start">Start transaction</button><button class="ds-btn" type="button" id="lv-tx-end" disabled>End transaction</button></div>' +
          '<ol class="rl-txlist" id="lv-txlist"></ol>' +
          '<div class="rl-call ds-note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg><span>The same buttons are on the small toolbar next to the recording window — use whichever is closer.</span></div>' +
        '</section>' +
      '</div>';
  }

  // ── the start card's status chips (where the page has them) ──────────────
  function chip(kind, text) { return '<span class="ds-chip' + (kind ? ' ' + kind : '') + '">' + (kind === 'ok' || kind === 'rec' ? '<i class="dot" aria-hidden="true"></i>' : '') + esc(text) + '</span>'; }
  function renderChips() {
    var box = P && P.chips; if (!box) return;
    var h;
    if (!st) h = chip('', 'CDP Recorder not running yet — the button starts it') + (P.onHow ? '<button class="rl-lnk" type="button" data-lv="how">Not set up yet?</button>' : '');
    else if (st.recording && st.allowed && st.session) h = chip('rec', 'Recording ' + (st.session.name || st.session.url)) + '<button class="rl-lnk" type="button" data-lv="resume">Show the recording</button>';
    else if (st.recording) h = chip('warn', 'A recording is running from the CDP Recorder toolbar');
    else h = chip('ok', 'CDP Recorder ready on this computer' + (st.version ? ' · version ' + st.version : ''));
    if (st && st.version && newer(st.version, LATEST)) h += chip('warn', 'A newer CDP Recorder is available') + '<a class="rl-lnk" href="downloads/cdp-recorder">Download it</a>';
    box.innerHTML = h;
  }
  function onStartPage() { return !L && !($('lv-dlg') && $('lv-dlg').open) && (!P.isIdle || P.isIdle()); }
  // Keep the chips current while a recorder answers. When none does, stop asking — every unanswered call is a
  // "connection refused" line in the browser console; coming back to the tab or clicking Start recording asks again.
  function idlePoll() {
    clearTimeout(idleTimer);
    if (!st) return;
    idleTimer = setTimeout(function () {
      if (document.hidden || !onStartPage()) return idlePoll();
      refresh().then(function () { renderChips(); idlePoll(); });
    }, 4000);
  }

  // ── the Start recording dialog ───────────────────────────────────────────
  function stamp() {
    var d = new Date(), p = function (x) { return (x < 10 ? '0' : '') + x; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }
  function safeName(s) { return String(s || '').trim().replace(/[^\w.-]+/g, '_').replace(/^[._]+|[._]+$/g, '').slice(0, 80) || 'Recording'; }
  function showFileName() { $('lv-file').textContent = safeName($('lv-name').value) + '_' + stamp().replace(/\d{6}$/, '…') + '.har'; }
  function browser() { var c = document.querySelector('input[name="lvb"]:checked'); return c ? c.value : 'edge'; }
  function privLabel() { $('lv-priv-t').textContent = browser() === 'chrome' ? 'Open an Incognito window' : 'Open an InPrivate window'; }
  function markBrowsers() {
    var have = st && st.browsers && st.browsers.length ? st.browsers : null;
    ['edge', 'chrome'].forEach(function (b) {
      var inp = document.querySelector('input[name="lvb"][value="' + b + '"]'), small = document.querySelector('[data-br="' + b + '"]');
      var missing = have && have.indexOf(b) < 0;
      inp.disabled = !!missing;
      inp.closest('.rl-card').classList.toggle('off', !!missing);
      small.textContent = missing ? 'Not installed on this computer' : b === 'edge' ? 'Recommended' : 'If Edge is blocked';
      if (missing && inp.checked) document.querySelector('input[name="lvb"][value="' + (b === 'edge' ? 'chrome' : 'edge') + '"]').checked = true;
    });
    privLabel();
  }
  function setView(form) {
    $('lv-form').hidden = !form; $('lv-launch').hidden = form;
    $('lv-hint').hidden = !form;
    $('lv-h').textContent = form ? 'Start recording' : 'Opening the browser';
    $('lv-sub').textContent = form ? (P.subtitle || 'Choose what to open and how.') : 'This takes a few seconds.';
  }
  function goLabel(t) { $('lv-go').lastChild.textContent = t; }
  function open() {
    if (!P) return;
    if (L) return;   // a recording is already on screen
    var urls = prefs.urls || [];
    $('lv-url-inp').value = urls[0] || '';
    $('lv-url-err').hidden = true; $('lv-url-inp').classList.remove('bad');
    $('lv-recent').innerHTML = urls.map(function (u) { return '<option value="' + esc(u) + '">'; }).join('');
    $('lv-recent-chips').innerHTML = urls.slice(0, 4).map(function (u) { return '<button type="button" class="rl-rc" data-u="' + esc(u) + '" title="' + esc(u) + '">' + esc(u.replace(/^https?:\/\//, '')) + '</button>'; }).join('');
    var b = document.querySelector('input[name="lvb"][value="' + (prefs.browser === 'chrome' ? 'chrome' : 'edge') + '"]'); if (b) b.checked = true;
    $('lv-priv').checked = prefs.private !== false;
    $('lv-name').value = prefs.name || '';
    $('lv-first').value = '';
    $('lv-go').disabled = false; goLabel('Start recording');
    setView(true); markBrowsers(); showFileName();
    $('lv-dlg').showModal();
    $('lv-url-inp').focus(); $('lv-url-inp').select();
    refresh().then(function () { markBrowsers(); renderChips(); });
  }
  function closeDlg() {
    if (launch) launch.cancelled = true;
    launch = null;
    if ($('lv-dlg').open) $('lv-dlg').close();
  }
  var REC_STEP = {
    start: 'Starting the CDP Recorder on this computer<small>Your browser may ask <i>"Open cdp-recorder?"</i> — click <b>Open</b>.</small>',
    ask: 'Click <b>Allow</b> on the CDP Recorder toolbar<small>It is running, but has not used this page before. The small toolbar window asks whether this page may start recordings — once; it remembers.</small>'
  };
  function recStep(kind) { $('lv-step-rec').innerHTML = REC_STEP[kind]; }
  // a recorder started by hand: ask it to allow this page (its toolbar shows Allow / Don't allow) → its answer
  function askAllow() {
    return api('POST', '/api/ask', null, 3000).then(function (r) { return r.state || null; }, function () { return null; });
  }
  function stepState(key, state) { var li = document.querySelector('#lv-steps [data-s="' + key + '"]'); if (li) li.className = state; }
  function fail(title, msg, setup) {
    $('lv-fail-t').textContent = title; $('lv-fail-m').textContent = msg || '';
    $('lv-fail').hidden = false; $('lv-setup').hidden = !setup;
    ['rec', 'br', 'url'].forEach(function (k) { var li = document.querySelector('#lv-steps [data-s="' + k + '"]'); if (li.className === 'now') li.className = 'bad'; });
    $('lv-go').disabled = false; goLabel('Try again');
  }

  function go() {
    var url = $('lv-url-inp').value.trim();
    if (url && !/^[a-z]+:\/\//i.test(url)) url = 'https://' + url;
    if (!/^https?:\/\/[^\s\/?#]+/i.test(url)) {
      setView(true);
      $('lv-url-err').hidden = false; $('lv-url-inp').classList.add('bad'); $('lv-url-inp').focus();
      return;
    }
    var req = { url: url, browser: browser(), private: $('lv-priv').checked, name: $('lv-name').value.trim(), firstTx: $('lv-first').value.trim() };
    prefs.urls = [url].concat((prefs.urls || []).filter(function (u) { return u !== url; })).slice(0, 6);
    prefs.browser = req.browser; prefs.private = req.private; prefs.name = req.name;
    savePrefs();

    // nothing answers → the link starts the recorder; running without this page → ask on its toolbar (a recorder
    // older than 0.2.1 cannot be asked — the link hands it this page instead)
    var askFirst = !!(st && !st.allowed && st.canAsk);
    var needLink = !st || (!st.allowed && !st.canAsk);
    if (needLink) openLink();        // inside the click — see openLink()

    setView(false);
    $('lv-fail').hidden = true; $('lv-setup').hidden = true;
    $('lv-go').disabled = true;
    $('lv-step-br').textContent = 'Opening ' + (req.browser === 'chrome' ? 'Chrome' : 'Edge') + (req.private ? (req.browser === 'chrome' ? ' (Incognito)' : ' (InPrivate)') : '');
    $('lv-step-url').textContent = url;
    recStep(askFirst ? 'ask' : 'start');
    stepState('rec', st && st.allowed ? 'done' : 'now'); stepState('br', ''); stepState('url', '');
    var my = launch = { cancelled: false };

    var ready = st && st.allowed ? Promise.resolve(st) : waitForRecorder(my);
    ready.then(function (s) {
      if (my.cancelled) return;
      if (!s) return fail('The CDP Recorder did not start', 'Nothing answered on this computer. If your browser asked "Open cdp-recorder?", click Open and then Try again. If programs cannot be started from the browser on this computer, start cdp-recorder.exe yourself and click Try again. Not set up yet:', true);
      if (s.denied) return fail('This page was not allowed', 'Don’t allow was clicked on the CDP Recorder toolbar. Wait a minute, then click Try again to ask once more.');
      if (s.busy) return fail('The CDP Recorder is asking about another page', 'Answer the question on its toolbar first, then click Try again.');
      if (s.notAllowed) return fail('The CDP Recorder has not allowed this page', s.canAsk
        ? 'It is running, but Allow was not clicked on its toolbar. Click Try again, then Allow on the small CDP Recorder toolbar window.'
        : 'It is running, but this page is not on its list and this version cannot ask. Download the newest CDP Recorder, start it, then click Try again.', !s.canAsk);
      if (s.recording) return fail('A recording is already running', 'Stop it on the CDP Recorder toolbar first, then try again.');
      stepState('rec', 'done'); stepState('br', 'now');
      var t = setTimeout(function () { if (!my.cancelled) { stepState('br', 'done'); stepState('url', 'now'); } }, 3500);
      return api('POST', '/api/session', req, 90000).then(function () {
        clearTimeout(t);
        if (my.cancelled) return;
        stepState('br', 'done'); stepState('url', 'done');
        launch = null;
        setTimeout(function () { if ($('lv-dlg').open) $('lv-dlg').close(); startLive(req, false); }, 350);
      }, function (err) {
        clearTimeout(t);
        if (my.cancelled) return;
        var msg = err.message || String(err);
        fail('The browser could not be opened', msg + (req.browser === 'edge' && /debug|port|polic/i.test(msg) ? ' — try Google Chrome instead.' : ''));
      });
    });
  }
  // Wait until the recorder answers and lists this page (≤ 45 s; after 12 s with nothing answering, show the set-up
  // steps). A recorder that answers without this page is asked on its toolbar (≤ 2 more minutes for the click).
  // → the status, null (nothing answered), or { denied | busy | notAllowed, canAsk }.
  function waitForRecorder(my) {
    var t0 = Date.now(), limit = 45000, asked = false;
    function again() {
      if (my.cancelled) return Promise.resolve(null);
      return refresh().then(function (s) {
        if (s && s.allowed) return s;
        if (s && s.canAsk) {
          if (s.ask === 'denied') return { denied: true };
          if (!asked) {
            asked = true; limit = Date.now() - t0 + 120000;
            recStep('ask'); $('lv-setup').hidden = true;
            return askAllow().then(function (r) {
              if (my.cancelled) return null;
              if (r === 'allowed') return refresh().then(function (s2) { return s2 && s2.allowed ? s2 : wait(700).then(again); });
              if (r === 'busy') return { busy: true };
              if (r === 'denied') return { denied: true };
              return wait(700).then(again);
            });
          }
        } else if (!s && Date.now() - t0 > 12000) $('lv-setup').hidden = false;
        if (Date.now() - t0 > limit) return s ? { notAllowed: true, canAsk: !!s.canAsk } : null;
        return wait(700).then(again);
      });
    }
    return again();
  }

  // ── the live recording ───────────────────────────────────────────────────
  function startLive(sess, resumed) {
    L = { sess: sess, rows: [], at: {}, last: 0, t0: Date.now(), tabs: {}, tabCount: 0, fold: {}, exp: {}, misses: 0, stopping: false, txActive: null, txDone: [], timer: null, poll: null, auto: false };
    if (P.before) P.before();
    $('rl-live').hidden = false;
    $('lv-url').textContent = sess.url || '';
    $('lv-br').textContent = sess.browser === 'chrome' ? 'Chrome' : 'Edge';
    $('lv-mode').textContent = sess.private ? (sess.browser === 'chrome' ? 'Incognito window' : 'InPrivate window') : 'normal window';
    $('lv-feed').innerHTML = '<div class="rl-empty">Waiting for the first request…</div>';
    $('lv-stop').disabled = false; $('lv-stop').lastChild.textContent = 'Stop and save';
    $('lv-warn').hidden = true;
    $('lv-follow').checked = true; $('lv-newest').hidden = true;
    $('lv-tx-name').value = sess.firstTx ? nextName(sess.firstTx) : (prefs.lastTx || 'T01_Login');
    L.timer = setInterval(tick, 500); tick();
    pollLive();
    if (resumed) toast('The recording is still running — here it is.', 'info');
  }
  function tick() {
    if (!L) return;
    var s = Math.floor((Date.now() - L.t0) / 1000), p = function (x) { return (x < 10 ? '0' : '') + x; };
    $('lv-timer').textContent = (s >= 3600 ? Math.floor(s / 3600) + ':' : '') + p(Math.floor(s / 60) % 60) + ':' + p(s % 60);
  }
  function endLive() {
    if (!L) return;
    clearInterval(L.timer); clearTimeout(L.poll);
    L = null;
    $('rl-live').hidden = true;
    if (P.after) P.after();
  }
  function pollLive() {
    if (!L) return;
    var me = L;
    refresh().then(function (s) {
      if (L !== me) return;
      if (!s || !s.allowed) {
        if (++me.misses >= 4) warn('Lost contact with the CDP Recorder. If its window was closed, nothing more is recorded — what was saved is in your Downloads folder.');
        return next();
      }
      me.misses = 0;
      if (!s.recording) {
        // stopped on the toolbar (or saved): open what it saved
        if (!me.stopping && s.lastHarPath) return openSaved(s.lastHarPath);
        if (!me.stopping) warn('The recording is not running any more.');
        return next();
      }
      if (s.warning) warn(s.warning); else $('lv-warn').hidden = true;
      me.txActive = s.activeTransaction || null;
      me.txDone = s.transactions || [];
      return api('GET', '/api/live?since=' + me.last, null, 5000).then(function (r) {
        if (L !== me) return;
        (r.rows || []).forEach(function (row) {
          if (me.at[row.n] === undefined) { me.at[row.n] = me.rows.length; me.rows.push(row); } else me.rows[me.at[row.n]] = row;
          if (row.tab && me.tabs[row.tab] === undefined) me.tabs[row.tab] = ++me.tabCount;
        });
        me.last = Math.max(me.last, r.last || 0);
        render();
        next();
      }, next);
    });
    function next() { if (L === me) me.poll = setTimeout(pollLive, 1000); }
  }
  function warn(t) { $('lv-warn-t').textContent = t; $('lv-warn').hidden = false; }

  function isStatic(r) { return !!STATIC_TYPES[r.type] || /^(image|font)\//.test(r.mime) || r.mime === 'text/css'; }
  function groups() {   // consecutive runs of the same transaction, in order
    var out = [], cur = null, seenTx = false;
    L.rows.forEach(function (r) {
      var name = r.tx || '';
      if (!cur || cur.name !== name) {
        cur = { key: out.length + ':' + name, name: name, label: name || (seenTx ? 'Between transactions' : 'Before the first transaction'), rows: [] };
        out.push(cur);
      }
      if (name) seenTx = true;
      cur.rows.push(r);
    });
    // a transaction just started shows at once, before its first request
    if (L.txActive && (!out.length || out[out.length - 1].name !== L.txActive)) out.push({ key: out.length + ':' + L.txActive, name: L.txActive, label: L.txActive, rows: [] });
    return out;
  }
  function rowHtml(r) {
    var m = /^(https?:\/\/[^\/?#]+)(.*)$/i.exec(r.url) || ['', '', r.url];
    var tab = L.tabs[r.tab] > 1 ? '<span class="tab" title="Opened in another window or tab">window ' + L.tabs[r.tab] + '</span>' : '<span class="tab"></span>';
    var sc = !r.done ? 'pend' : r.status >= 400 || r.status === 0 ? 'bad' : r.status >= 300 ? 'redir' : 'ok';
    return '<div class="rl-r' + (r.background ? ' bg' : '') + '"><span class="n">' + r.n + '</span><span class="m m-' + esc(r.method.toLowerCase()) + '">' + esc(r.method) +
      '</span><span class="u" title="' + esc(r.url) + '"><span class="h">' + esc(m[1]) + '</span>' + esc(m[2] || '/') + '</span>' + tab +
      '<span class="s ' + sc + '">' + (r.done ? (r.status || 'failed') : '…') + '</span><span class="ty">' + esc(r.type) + '</span></div>';
  }
  function render() {
    var feed = $('lv-feed'), keepTop = feed.scrollTop;
    var q = $('lv-filter').value.trim().toLowerCase();
    var showStatic = $('lv-static').checked, showBg = $('lv-bgshow').checked;
    var gs = groups(), h = [], bg = 0;
    L.rows.forEach(function (r) { if (r.background) bg++; });
    $('lv-n').textContent = L.rows.length; $('lv-bg').textContent = bg; $('lv-tabs').textContent = Math.max(1, L.tabCount);
    gs.forEach(function (g, i) {
      var last = i === gs.length - 1;
      var rows = q ? g.rows.filter(function (r) { return r.url.toLowerCase().indexOf(q) >= 0; }) : g.rows;
      if (q && !rows.length) return;
      var open = q ? true : L.fold[g.key] === undefined ? last : !L.fold[g.key];
      var live = last && g.name && g.name === L.txActive;
      h.push('<div class="rl-g' + (open ? ' open' : '') + '"><button type="button" class="rl-gh" data-g="' + esc(g.key) + '" aria-expanded="' + open + '"><svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg><b>' + esc(g.label) + '</b>' +
        (live ? '<span class="ds-chip rec"><i class="dot" aria-hidden="true"></i>recording</span>' : '') + '<span class="c">' + plural(g.rows.length, 'request') + '</span></button>');
      if (open) {
        var plain = [], st0 = [], bg0 = [];
        rows.forEach(function (r) { if (!q && r.background && !showBg) bg0.push(r); else if (!q && isStatic(r) && !showStatic) st0.push(r); else plain.push(r); });
        var cut = plain.length > ROWS_PER_GROUP && !L.exp[g.key + ':all'] ? plain.length - ROWS_PER_GROUP : 0;
        if (cut) h.push('<button type="button" class="rl-fold" data-x="' + esc(g.key) + ':all">Show ' + plural(cut, 'earlier request') + '</button>');
        plain.slice(cut).forEach(function (r) { h.push(rowHtml(r)); });
        if (st0.length) h.push(foldLine(g.key + ':s', st0, plural(st0.length, 'static file') + ' — images, style sheets, scripts, fonts'));
        if (bg0.length) h.push(foldLine(g.key + ':b', bg0, plural(bg0.length, 'background call') + ' — polling, keep-alive'));
        if (!rows.length) h.push('<div class="rl-empty sm">No requests yet — use the application in the recording window.</div>');
      }
      h.push('</div>');
    });
    feed.innerHTML = h.length ? h.join('') : '<div class="rl-empty">' + (q ? 'No address contains “' + esc(q) + '”.' : 'Waiting for the first request…') + '</div>';
    if ($('lv-follow').checked) { L.auto = true; feed.scrollTop = feed.scrollHeight; } else feed.scrollTop = keepTop;
    renderTx();
  }
  function foldLine(key, rows, label) {
    var isOpen = !!L.exp[key];
    return '<button type="button" class="rl-fold" data-x="' + esc(key) + '" aria-expanded="' + isOpen + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m' + (isOpen ? '6 9 6 6 6-6' : '9 6 6 6-6 6') + '"/></svg>' + esc(label) + '</button>' +
      (isOpen ? rows.map(rowHtml).join('') : '');
  }
  function renderTx() {
    var counts = {};
    L.rows.forEach(function (r) { if (r.tx) counts[r.tx] = (counts[r.tx] || 0) + 1; });
    var items = L.txDone.map(function (t) { return { name: t, live: false }; });
    if (L.txActive) items.push({ name: L.txActive, live: true });
    $('lv-txlist').innerHTML = items.length ? items.map(function (t, i) {
      return '<li class="' + (t.live ? 'live' : '') + '"><span class="i">' + (i + 1) + '</span><b>' + esc(t.name) + '</b><span class="c">' +
        (t.live ? 'recording… ' : '') + plural(counts[t.name] || 0, 'request') + '</span></li>';
    }).join('') : '<li class="none">No transactions yet — requests are recorded anyway; you can group them later in the Recorder.</li>';
    $('lv-tx-end').disabled = !L.txActive;
  }
  function nextName(name) {
    var m = /^([A-Za-z]*)(\d+)(.*)$/.exec(name || '');
    if (!m) return '';
    var num = String(+m[2] + 1); while (num.length < m[2].length) num = '0' + num;
    return m[1] + num + '_';
  }
  function txStart() {
    var raw = $('lv-tx-name').value.trim().replace(/[\s-]+/g, '_');
    var err = $('lv-tx-err');
    if (!/^[A-Za-z]([A-Za-z0-9_]*[A-Za-z0-9])?$/.test(raw)) {
      err.textContent = 'Use a letter first, then letters, numbers or underscores — for example T01_Login.'; err.hidden = false; $('lv-tx-name').focus(); return;
    }
    err.hidden = true;
    var me = L;
    var first = me.txActive ? api('POST', '/api/tx/end') : Promise.resolve();
    first.then(function () { return api('POST', '/api/tx/start', { name: raw }); }).then(function () {
      if (L !== me) return;
      me.txActive = raw; prefs.lastTx = raw; savePrefs();
      // fold the transactions before this one
      var gs = groups();
      gs.forEach(function (g, i) { if (i < gs.length - 1 && L.fold[g.key] === undefined) L.fold[g.key] = true; });
      $('lv-tx-name').value = nextName(raw);
      render();
    }, function (e) { toast('Could not start the transaction: ' + e.message, 'error'); });
  }
  function txEnd() {
    var me = L;
    api('POST', '/api/tx/end').then(function () { if (L === me) { me.txActive = null; render(); } },
      function (e) { toast('Could not end the transaction: ' + e.message, 'error'); });
  }
  function stop() {
    if (!L || L.stopping) return;
    var me = L;
    me.stopping = true;
    $('lv-stop').disabled = true; $('lv-stop').lastChild.textContent = 'Saving…';
    api('POST', '/api/stop', {}, 60000).then(function (r) { if (L === me) openSaved(r.file); }, function (e) {
      me.stopping = false;
      $('lv-stop').disabled = false; $('lv-stop').lastChild.textContent = 'Stop and save';
      warn('Could not stop the recording: ' + e.message);
    });
  }
  // the recorder has saved the .har to Downloads: fetch it and hand it to the page like a dropped file
  function openSaved(path) {
    var name = String(path || 'recording.har').split(/[\\/]/).pop();
    if (L) { clearTimeout(L.poll); L.stopping = true; }
    return api('GET', '/api/download', null, 60000).then(function (har) {
      endLive();
      P.onSaved(new File([JSON.stringify(har)], name, { type: 'application/json' }), path);
      toast('Saved to your Downloads folder: ' + name, 'success', 6000);
    }, function () {
      endLive();
      toast('The recording was saved as ' + path + ' but could not be opened here — load it from your Downloads folder.', 'error', 9000);
    });
  }

  // ── mount: draw, wire, look for a running recording ──────────────────────
  /**
   * opts: host (element the live view is drawn into), chips (status chips, optional), isIdle() (the page shows its
   * start view — the chips refresh and a running recording is shown again only then), before() / after() (hide /
   * show the page's own views around the live view), onSaved(file, path), onHow() (optional "Not set up yet?"),
   * subtitle (optional dialog line).
   */
  function mount(opts) {
    if (P) return;
    P = opts;
    var d = document.createElement('dialog');
    d.className = 'rl-dlg'; d.id = 'lv-dlg'; d.setAttribute('aria-labelledby', 'lv-h');
    d.innerHTML = dialogHtml();
    document.body.appendChild(d);
    var live = document.createElement('div');
    live.className = 'rl-live'; live.id = 'rl-live'; live.hidden = true;
    live.innerHTML = liveHtml();
    opts.host.appendChild(live);

    $('lv-go').addEventListener('click', go);
    $('lv-cancel').addEventListener('click', closeDlg);
    d.addEventListener('cancel', function () { if (launch) launch.cancelled = true; launch = null; });
    d.addEventListener('close', function () { idlePoll(); });
    $('lv-url-inp').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    $('lv-url-inp').addEventListener('input', function () { $('lv-url-err').hidden = true; this.classList.remove('bad'); });
    $('lv-recent-chips').addEventListener('click', function (e) { var b = e.target.closest('[data-u]'); if (b) { $('lv-url-inp').value = b.getAttribute('data-u'); $('lv-url-err').hidden = true; $('lv-url-inp').classList.remove('bad'); } });
    document.querySelectorAll('input[name="lvb"]').forEach(function (r) { r.addEventListener('change', privLabel); });
    $('lv-name').addEventListener('input', showFileName);
    if (opts.chips) opts.chips.addEventListener('click', function (e) {
      var b = e.target.closest('[data-lv]'); if (!b) return;
      if (b.getAttribute('data-lv') === 'how' && P.onHow) P.onHow();
      if (b.getAttribute('data-lv') === 'resume' && st && st.session) startLive(st.session, true);
    });

    $('lv-stop').addEventListener('click', stop);
    $('lv-tx-start').addEventListener('click', txStart);
    $('lv-tx-end').addEventListener('click', txEnd);
    $('lv-tx-name').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); txStart(); } });
    $('lv-filter').addEventListener('input', function () { if (L) render(); });
    ['lv-static', 'lv-bgshow'].forEach(function (id) { $(id).addEventListener('change', function () { if (L) render(); }); });
    $('lv-follow').addEventListener('change', function () { $('lv-newest').hidden = this.checked; if (L) render(); });
    $('lv-newest').addEventListener('click', function () { $('lv-follow').checked = true; this.hidden = true; if (L) render(); });
    $('lv-fold-all').addEventListener('click', function () {
      if (!L) return;
      var gs = groups(), allFolded = gs.every(function (g, i) { return L.fold[g.key] === undefined ? i !== gs.length - 1 : L.fold[g.key]; });
      gs.forEach(function (g) { L.fold[g.key] = !allFolded; });
      this.textContent = allFolded ? 'Fold all' : 'Unfold all';
      render();
    });
    $('lv-feed').addEventListener('click', function (e) {
      if (!L) return;
      var g = e.target.closest('[data-g]'), x = e.target.closest('[data-x]');
      if (g) {
        var key = g.getAttribute('data-g'), gs = groups(), isLast = gs.length && gs[gs.length - 1].key === key;
        L.fold[key] = L.fold[key] === undefined ? isLast : !L.fold[key];
      } else if (x) {
        L.exp[x.getAttribute('data-x')] = !L.exp[x.getAttribute('data-x')];
      } else return;
      $('lv-follow').checked = false; $('lv-newest').hidden = false;
      render();
    });
    // scrolling up pauses "follow newest"
    $('lv-feed').addEventListener('scroll', function () {
      if (!L) return;
      if (L.auto) { L.auto = false; return; }
      var atEnd = this.scrollHeight - this.scrollTop - this.clientHeight < 40;
      if (!atEnd && $('lv-follow').checked) { $('lv-follow').checked = false; $('lv-newest').hidden = false; }
      if (atEnd && !$('lv-follow').checked) { $('lv-follow').checked = true; $('lv-newest').hidden = true; }
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden && onStartPage()) refresh().then(function () { renderChips(); idlePoll(); }); });

    renderChips();
    refresh().then(function (s) {
      renderChips();
      // a recording started from a page is still running (page reloaded): show it again
      if (s && s.allowed && s.recording && s.session && (!P.isIdle || P.isIdle())) startLive(s.session, true);
      idlePoll();
    });
  }

  window.PerfxRecordLive = {
    mount: mount,
    open: open,
    state: function () { return { status: st, live: L ? { rows: L.rows.length, tx: L.txActive } : null }; },
  };
})();
