/**
 * page-bar.js — the floating bar the CDP Recorder draws inside every page it records (0.3.0).
 *
 * The bar runs in an ISOLATED script world (its own globals; the application cannot see or call it) and talks to the
 * recorder through a CDP binding — never through the network, so nothing of it is in the recording. Built with DOM
 * calls only (no innerHTML, no inline style attributes) and a constructed style sheet inside a closed shadow root,
 * so a strict Content-Security-Policy or Trusted Types on the application's page does not block it. Shown as a
 * popover (the browser's top layer): above everything the application draws, its own pop-ups included.
 *
 * Exports (plain helpers are unit-tested by tests/unit/cdpPageBar.test.js):
 *   BAR_WORLD                      — the isolated world's name
 *   barScript(binding, opts)       — the source injected into each page
 *   planChips(plan, started)       — the planned steps with done / next
 *   barPrefsOf(value)              — the remembered place of the bar ({ dock, pos }), checked
 *   saveAsText(session)            — "Saved to Downloads as SC01_Booking_<date>.har" line
 */

export const BAR_WORLD = "perfx-recorder-bar";

/** The planned steps, each with done (a transaction of that name was started) and next (the first not done). */
export function planChips(plan, started) {
  const key = (t) => String(t).replace(/^T\d+_/, "").replace(/[\s-]+/g, "_").replace(/[^A-Za-z0-9_]/g, "").toLowerCase();
  const used = (started || []).map(key);
  let nextGiven = false;
  return (plan || []).map((step) => {
    const done = used.includes(key(step));
    const next = !done && !nextGiven;
    if (next) nextGiven = true;
    return { step: String(step), done, next };
  });
}

/** The place of the bar: dock top / bottom, pos left / center / right — anything else falls back to top, center. */
export function barPrefsOf(value) {
  const v = value && typeof value === "object" ? value : {};
  return { dock: v.dock === "bottom" ? "bottom" : "top", pos: v.pos === "left" || v.pos === "right" ? v.pos : "center" };
}

/** Where Stop saves — shown in the bar's details. */
export function saveAsText(session) {
  if (!session) return "Saved next to cdp-recorder.exe — Stop and save";
  const base = (session.scriptId ? session.scriptId + "_" : "") + (String(session.name || "").trim() || "Recording");
  return "Saved to Downloads as " + base.replace(/[^A-Za-z0-9_-]+/g, "_") + "_<date>.har — opens in Script Studio";
}

/** The source injected into each page (runs in the isolated world BAR_WORLD). */
export function barScript(binding, opts) {
  // opts.open: an open shadow root — only for the manual test (Playwright reaches the buttons); closed otherwise
  return "(" + barClient.toString() + ")(" + JSON.stringify({ binding, open: !!(opts && opts.open) }) + ");";
}

// ── the bar itself (runs in the page; self-contained: no references outside this function) ──
function barClient(cfg) {
  "use strict";
  if (window.top !== window) return;                       // the top page only, not embedded frames
  if (globalThis.__perfxBarUp) return;                      // once per document
  globalThis.__perfxBarUp = true;
  const send = (msg) => { try { globalThis[cfg.binding](JSON.stringify(msg)); } catch (e) { /* recorder gone */ } };

  // state from the recorder (poll answer) and the bar's own view state
  let S = null, wasRec = false, lastSeen = Date.now(), msg = "", msgUntil = 0, renaming = null, typed = "";
  const V = { open: false, min: false, hidden: false, scrollLive: false, gone: false, front: true };

  // ── DOM helpers (no innerHTML: Trusted Types) ──
  const NS = "http://www.w3.org/2000/svg";
  function h(tag, attrs, kids) {
    const el = document.createElement(tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (v === false || v == null) continue;
      if (k === "class") el.className = v; else if (k.startsWith("on")) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of [].concat(kids || [])) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
    return el;
  }
  function icon(name) {
    const P = {
      chev: [["path", { d: "m6 9 6 6 6-6" }]], up: [["path", { d: "m18 15-6-6-6 6" }]], min: [["path", { d: "M5 12h14" }]],
      pen: [["path", { d: "M12 20h9" }], ["path", { d: "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" }]],
      stop: [["rect", { x: 6, y: 6, width: 12, height: 12, rx: 2, fill: "currentColor", stroke: "none" }]],
      dockBottom: [["rect", { x: 3, y: 4, width: 18, height: 16, rx: 2 }], ["rect", { x: 6, y: 14, width: 12, height: 3, rx: 1, fill: "currentColor", stroke: "none" }]],
      dockTop: [["rect", { x: 3, y: 4, width: 18, height: 16, rx: 2 }], ["rect", { x: 6, y: 7, width: 12, height: 3, rx: 1, fill: "currentColor", stroke: "none" }]],
      warn: [["path", { d: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" }], ["path", { d: "M12 9v4M12 17h.01" }]],
    }[name] || [];
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", "2"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round");
    s.setAttribute("class", "i"); s.setAttribute("aria-hidden", "true");
    for (const [t, a] of P) { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); s.append(e); }
    return s;
  }

  // ── the host: a popover in the top layer, a closed shadow root, a constructed style sheet ──
  const host = document.createElement("perfx-recorder-bar");
  const hs = host.style;
  hs.setProperty("all", "initial", "important");
  for (const [k, v] of [["position", "fixed"], ["inset", "0"], ["width", "100vw"], ["height", "100vh"], ["max-width", "none"], ["max-height", "none"],
    ["margin", "0"], ["padding", "0"], ["border", "0"], ["background", "transparent"], ["overflow", "visible"], ["pointer-events", "none"],
    ["z-index", "2147483647"], ["display", "block"], ["color-scheme", "dark"]]) hs.setProperty(k, v, "important");
  const canPop = typeof host.showPopover === "function";
  if (canPop) host.setAttribute("popover", "manual");
  const root = host.attachShadow({ mode: cfg.open ? "open" : "closed" });
  const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.wrap { position: fixed; inset: 0; pointer-events: none; container-type: inline-size; font-family: "Segoe UI", system-ui, sans-serif; font-size: 13px; color: #f4f2ff; line-height: 1.3; }
.mono, .pre, .time, .txn b, .tl b, .box input { font-family: "Cascadia Code", Consolas, monospace; }
.fb { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); width: max-content; max-width: calc(100% - 24px); pointer-events: auto; }
.fb.left { left: 12px; transform: none; } .fb.right { left: auto; right: 12px; transform: none; }
.fb.bottom { top: auto; bottom: 12px; }
.pill { display: flex; align-items: center; gap: 10px; background: #17142a; border: 1px solid #3a3460; border-radius: 99px; padding: 6px 8px 6px 12px; box-shadow: 0 10px 30px rgba(10,6,40,.35); }
.grip { width: 10px; height: 18px; flex: none; background-image: radial-gradient(#b8b2d9 1.2px, transparent 1.3px); background-size: 5px 5px; opacity: .7; cursor: grab; touch-action: none; }
.rec { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; color: #fca5a5; letter-spacing: .03em; flex: none; }
.rec i { width: 9px; height: 9px; border-radius: 50%; background: #ef4444; animation: pulse 1.4s infinite; }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(239,68,68,.6); } 70% { box-shadow: 0 0 0 7px rgba(239,68,68,0); } 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); } }
.time { font-weight: 700; flex: none; }
.sep { width: 1px; height: 20px; background: #3a3460; flex: none; }
.txn { display: inline-flex; flex-direction: column; line-height: 1.15; flex: none; }
.txn small { color: #b8b2d9; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; }
.txn b { font-size: 12px; white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
.box { flex: 0 1 300px; min-width: 150px; display: flex; align-items: center; background: #231f3b; border: 1px solid #3a3460; border-radius: 99px; height: 32px; padding-left: 10px; }
.box:focus-within { border-color: #a78bfa; box-shadow: 0 0 0 3px rgba(167,139,250,.25); }
.pre { font-weight: 700; color: #c4b5fd; font-size: 12px; flex: none; }
.box input { all: unset; color: #f4f2ff; font-size: 12px; flex: 1; min-width: 0; padding: 0 8px 0 2px; }
.box input::placeholder { color: #8f88b8; }
.src { flex: none; margin-right: 8px; padding: 1px 7px; border-radius: 99px; background: #2f2a52; color: #c4b5fd; font-size: 10px; font-weight: 600; white-space: nowrap; }
.b { all: unset; box-sizing: border-box; border: 1px solid #3a3460; background: #231f3b; color: #f4f2ff; border-radius: 99px; height: 32px; padding: 0 12px; font-weight: 600; cursor: pointer; white-space: nowrap; display: inline-flex; align-items: center; justify-content: center; gap: 6px; flex: none; font-family: inherit; font-size: 13px; }
.b:hover { border-color: #a78bfa; } .b:focus-visible { outline: 2px solid #a78bfa; outline-offset: 2px; }
.b.primary { background: #7c3aed; border-color: #7c3aed; }
.b.stop { background: #b91c1c; border-color: #b91c1c; }
.b.icon { width: 32px; padding: 0; }
.b[disabled] { opacity: .45; cursor: default; }
.b.warn { border-color: #d97706; color: #fde68a; }
.stats { display: inline-flex; align-items: center; gap: 6px; color: #b8b2d9; font-size: 12px; white-space: nowrap; flex: none; }
.stats b { color: #f4f2ff; }
.settle { display: inline-flex; align-items: center; gap: 5px; }
.settle i { width: 8px; height: 8px; border-radius: 50%; background: #16a34a; }
.settle.busy i { background: #d97706; }
svg.i { width: 16px; height: 16px; flex: none; }
.drop { margin: 8px auto 0; width: 560px; max-width: 100%; background: #17142a; border: 1px solid #3a3460; border-radius: 16px; box-shadow: 0 14px 40px rgba(10,6,40,.35); padding: 12px; display: grid; gap: 10px; }
.fb.left .drop { margin-left: 0; } .fb.right .drop { margin-right: 0; }
.fb.bottom .drop { position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%); margin: 0; }
.fb.bottom.left .drop { left: 0; transform: none; } .fb.bottom.right .drop { left: auto; right: 0; transform: none; }
h4 { margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #b8b2d9; }
.tl { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; max-height: 190px; overflow: auto; }
.tl li { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 10px; background: #231f3b; min-width: 0; }
.tl li.live { outline: 1px solid #a78bfa; }
.tl .n { color: #b8b2d9; width: 18px; text-align: right; font-size: 12px; flex: none; }
.tl b { font-size: 12px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tl .c { margin-left: auto; color: #b8b2d9; font-size: 12px; white-space: nowrap; flex: none; }
.tl .lt { color: #fca5a5; font-weight: 700; font-size: 11px; }
.tl input { all: unset; background: #0f0d1e; border: 1px solid #a78bfa; color: #f4f2ff; border-radius: 6px; font-family: "Cascadia Code", Consolas, monospace; font-size: 12px; padding: 3px 6px; width: 200px; }
.ren { all: unset; color: #b8b2d9; cursor: pointer; padding: 2px; border-radius: 6px; display: inline-grid; flex: none; }
.ren:hover { color: #fff; background: #3a3460; }
.ren svg.i { width: 14px; height: 14px; }
.plan { display: flex; flex-wrap: wrap; gap: 6px; }
.plan span { padding: 3px 10px; border-radius: 99px; background: #231f3b; border: 1px solid #3a3460; font-size: 12px; color: #b8b2d9; }
.plan span.done { color: #86efac; text-decoration: line-through; }
.plan span.next { color: #fff; border-color: #a78bfa; }
.warnline { display: flex; gap: 8px; align-items: flex-start; padding: 8px 10px; border-radius: 10px; background: rgba(217,119,6,.15); border: 1px solid rgba(217,119,6,.45); color: #fde68a; font-size: 12px; line-height: 1.4; }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.note { color: #b8b2d9; font-size: 12px; }
.dmsg { padding: 6px 10px; border-radius: 10px; background: #052e1b; border: 1px solid #16a34a; color: #bbf7d0; font-size: 12px; }
.dmsg.bad, .toast.bad { background: #3b0d0d; border-color: #dc2626; color: #fecaca; }
.toast { position: absolute; top: 62px; left: 50%; transform: translateX(-50%); background: #052e1b; border: 1px solid #16a34a; color: #bbf7d0; padding: 6px 12px; border-radius: 99px; font-size: 12px; pointer-events: none; white-space: nowrap; max-width: calc(100% - 24px); overflow: hidden; text-overflow: ellipsis; }
.fb.bottom ~ .toast { top: auto; bottom: 66px; }
.dot { display: inline-flex; align-items: center; gap: 8px; background: #17142a; border: 1px solid #3a3460; border-radius: 99px; padding: 6px 12px; cursor: pointer; box-shadow: 0 10px 30px rgba(10,6,40,.35); }
.narrow { display: none; gap: 10px; align-items: center; flex-wrap: wrap; color: #b8b2d9; font-size: 12px; }
.narrow b { color: #f4f2ff; }
.small-only, .tiny-only { display: none; }
@container (max-width: 1180px) { .txn small { display: none; } .stop .lbl { display: none; } .b.stop { width: 32px; padding: 0; } .box { flex-basis: 240px; } }
@container (max-width: 1000px) { .pill .txn, .pill .stats, .pill .sep { display: none; } .box { flex-basis: 220px; } .narrow { display: flex; } }
@container (max-width: 640px) { .box .src, .pill .dockb, .pill .minb { display: none; } .box { flex-basis: 170px; min-width: 110px; } .narrow .small-only { display: inline-flex; gap: 6px; margin-left: auto; } }
@container (max-width: 480px) { .pill { gap: 6px; padding-left: 10px; } .pill .time { display: none; } .box { min-width: 96px; } .narrow .tiny-only { display: inline; } }
.hide { visibility: hidden !important; }
`;
  try { const sheet = new CSSStyleSheet(); sheet.replaceSync(CSS); root.adoptedStyleSheets = [sheet]; }
  catch (e) { const st = document.createElement("style"); st.textContent = CSS; root.append(st); }
  const wrap = h("div", { class: "wrap" });
  root.append(wrap);
  // keys typed in the bar never reach the application's own shortcuts; its clicks never close the application's menus
  for (const t of ["keydown", "keyup", "keypress", "input", "pointerdown", "mousedown", "mouseup", "click", "dblclick", "contextmenu", "wheel"]) {
    root.addEventListener(t, (e) => e.stopPropagation());
  }

  function mount() {
    if (!document.documentElement) return false;
    raise();
    return true;
  }
  // stay above the application's own pop-ups: shown again when another top-layer element opened after it. While the
  // application shows a MODAL dialog, everything outside it is inert (cannot be clicked) — the bar then lives inside
  // that dialog (still drawn in the top layer, on top) and goes back when the dialog closes.
  let topSig = "";
  function raise() {
    let modal = null;
    try { const m = document.querySelectorAll("dialog:modal"); modal = m.length ? m[m.length - 1] : null; } catch (e) { /* :modal not supported */ }
    const parent = modal || document.documentElement;
    if (parent && host.parentNode !== parent) { parent.append(host); topSig = ""; }
    if (!canPop || !host.isConnected) return;
    try {
      const others = document.querySelectorAll(":modal, :popover-open, :fullscreen").length - (host.matches(":popover-open") ? 1 : 0);
      const sig = String(others);
      if (!host.matches(":popover-open")) host.showPopover();
      else if (sig !== topSig && others > 0) { host.hidePopover(); host.showPopover(); }
      topSig = sig;
    } catch (e) { /* not supported here: z-index only */ }
  }

  // ── names (the same rules as the recorder: portal-mode.js txName) ──
  const clean = (s) => String(s || "").trim().replace(/[\s-]+/g, "_").replace(/[^A-Za-z0-9_]/g, "").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  const key = (n) => String(n).replace(/^T\d+_/, "").toLowerCase();
  const started = () => (S ? S.done.map((t) => t.name).concat(S.active ? [S.active.name] : []) : []);
  function titleName() {
    const s = clean(String(document.title || "").split(/\s+[|–—-]\s+/)[0]).slice(0, 40);
    if (!s || s === clean(location.href) || s === clean(location.host)) return "";
    return started().some((t) => key(t) === s.toLowerCase()) ? "" : s;
  }
  const hintSrc = () => (S && S.next.planned ? "planned" : titleName() ? "page title" : "");
  const hint = () => (S && S.next.planned) || titleName() || "Type a name, Enter";
  const pad = (n) => (n < 10 ? "0" : "") + n;
  function clock() {
    if (!S || !S.startedAt) return "00:00:00";
    const s = Math.max(0, Math.floor((Date.now() - S.startedAt) / 1000));
    return pad(Math.floor(s / 3600)) + ":" + pad(Math.floor(s / 60) % 60) + ":" + pad(s % 60);
  }
  function say(text, bad) {
    msg = text; msgUntil = Date.now() + 2800; msgBad = !!bad; draw();
    setTimeout(draw, 2900);
  }
  let msgBad = false;

  // ── drawing ──
  function pill() {
    const live = S.active;
    const src = hintSrc();
    const input = h("input", { "aria-label": "Next transaction — type a name, Enter", placeholder: hint(), spellcheck: "false", autocomplete: "off",
      onkeydown: (e) => {
        if (e.key === "Enter") { e.preventDefault(); mark(); }
        else if (e.key === "Tab" && !input.value && !(S && S.next.planned) && titleName()) { e.preventDefault(); input.value = titleName(); typed = input.value; }
        else if (e.key === "Escape") { input.value = ""; typed = ""; input.blur(); }
      },
      oninput: () => { typed = input.value; } });
    input.value = typed;
    input.dataset.box = "1";
    return h("div", { class: "pill", role: "toolbar", "aria-label": "CDP Recorder" }, [
      h("span", { class: "grip", title: "Drag to move the bar — top or bottom, left, middle or right" }),
      h("span", { class: "rec" }, [h("i"), "REC"]), h("span", { class: "time" }, clock()), h("span", { class: "sep" }),
      h("span", { class: "txn" }, [h("small", null, "Running"), h("b", { title: live ? live.name : "no transaction" }, live ? live.name : "—")]),
      h("label", { class: "box", title: "Type a name and press Enter: the running transaction ends, this one starts." + (src === "planned" ? " Enter on an empty box starts the next planned step." : src ? " Tab takes the name from the page title." : "") },
        [h("span", { class: "pre" }, S.next.number), input, src ? h("span", { class: "src" }, src === "planned" ? "planned · Enter" : "page title · Tab") : null]),
      h("button", { class: "b primary", title: "End the running transaction and start this one (Enter)", onclick: mark }, "Mark ↵"),
      h("span", { class: "sep" }),
      h("span", { class: "stats", title: S.activeCount + " requests still loading · " + S.background + " repeating background calls" }, [
        h("b", null, String(S.activeCount)), " · ", h("b", null, String(S.background)), " bg ",
        h("span", { class: "settle" + (S.settled ? "" : " busy"), title: S.settled ? "Settled — safe to start the next transaction" : "Still loading — wait a moment before the next mark" }, [h("i"), S.settled ? "Settled" : "Loading"])]),
      h("button", { class: "b stop", title: "Stop and save the recording", onclick: stop }, [icon("stop"), h("span", { class: "lbl" }, "Stop and save")]),
      h("button", { class: "b icon" + (S.warning ? " warn" : ""), "aria-expanded": String(V.open), title: V.open ? "Hide the details" : "Transactions, rename, Undo, planned steps", onclick: () => { V.open = !V.open; V.scrollLive = V.open; draw(); } }, icon(V.open ? "up" : (S.warning ? "warn" : "chev"))),
      h("button", { class: "b icon dockb", title: S.prefs.dock === "bottom" ? "Move the bar to the top" : "Move the bar to the bottom", onclick: () => prefs({ dock: S.prefs.dock === "bottom" ? "top" : "bottom" }) }, icon(S.prefs.dock === "bottom" ? "dockTop" : "dockBottom")),
      h("button", { class: "b icon minb", title: "Minimise to a small REC dot (Alt+Shift+H hides the bar completely)", onclick: () => { V.min = true; V.open = false; draw(); } }, icon("min")),
    ]);
  }
  function details() {
    const all = S.done.concat(S.active ? [S.active] : []);
    const list = h("ul", { class: "tl" }, all.map((t, i) => {
      const live = S.active && t === S.active;
      const name = renaming === t.name
        ? h("input", { value: t.name, "aria-label": "New name for " + t.name, onkeydown: (e) => {
            if (e.key === "Enter") { e.preventDefault(); send({ act: "rename", from: t.name, to: e.target.value }); renaming = null; }
            else if (e.key === "Escape") { e.preventDefault(); renaming = null; draw(); }
          } })
        : h("b", { title: t.name }, t.name);
      return h("li", { class: live ? "live" : "" }, [h("span", { class: "n" }, String(i + 1)), name,
        renaming === t.name ? null : h("button", { class: "ren", title: "Rename", onclick: () => { renaming = t.name; draw(); } }, icon("pen")),
        h("span", { class: "c" }, [live ? h("span", { class: "lt" }, "recording · ") : null, t.count + " request" + (t.count === 1 ? "" : "s")])]);
    }));
    const kids = [];
    if (msg && Date.now() < msgUntil) kids.push(h("div", { class: "dmsg" + (msgBad ? " bad" : "") }, msg));
    if (S.warning) kids.push(h("div", { class: "warnline" }, [icon("warn"), h("span", null, S.warning)]));
    kids.push(h("div", { class: "narrow" }, [
      h("span", { class: "tiny-only" }, [h("b", null, clock()), " · "]),
      "Running ", h("b", null, S.active ? S.active.name : "—"), " · ", h("b", null, String(S.activeCount)), " active · ", h("b", null, String(S.background)), " background",
      h("span", { class: "small-only" }, [
        h("button", { class: "b", onclick: () => prefs({ dock: S.prefs.dock === "bottom" ? "top" : "bottom" }) }, S.prefs.dock === "bottom" ? "Move to the top" : "Move to the bottom"),
        h("button", { class: "b", onclick: () => { V.min = true; V.open = false; draw(); } }, "Minimise")])]));
    kids.push(h("h4", null, "Transactions"));
    kids.push(all.length ? list : h("div", { class: "note" }, "None yet — type a name in the box and press Enter."));
    kids.push(h("div", { class: "row" }, [
      h("button", { class: "b", disabled: !S.canUndo, title: "Take back the last mark: the transaction it started goes, the one before runs again", onclick: () => send({ act: "undo" }) }, "Undo last mark"),
      h("span", { class: "note" }, S.saveAs)]));
    if (S.plan.length) {
      kids.push(h("h4", null, "Planned steps"));
      kids.push(h("div", { class: "plan" }, S.plan.map((p) => h("span", { class: p.done ? "done" : p.next ? "next" : "" }, p.step + (p.next ? " · next" : "")))));
    }
    return h("div", { class: "drop" }, kids);
  }
  function draw() {
    if (V.gone || !S) return;
    const old = wrap.querySelector(".tl"), keep = old ? old.scrollTop : 0;
    const focused = root.activeElement, wasBox = focused && focused.dataset && focused.dataset.box, caret = wasBox ? focused.selectionStart : 0;
    const renFocus = focused && focused.closest && focused.closest(".tl") && focused.tagName === "INPUT" ? focused.value : null;
    wrap.replaceChildren();
    const fb = h("div", { class: "fb" + (S.prefs.dock === "bottom" ? " bottom" : "") + (S.prefs.pos !== "center" ? " " + S.prefs.pos : "") + (V.hidden ? " hide" : "") });
    if (!S.recording) {
      fb.append(h("div", { class: "pill" }, [h("span", { class: "rec" }, [h("i"), "REC"]), h("span", null, S.savedText || "Saving the recording…")]));
    } else if (V.min) {
      fb.append(h("span", { class: "dot", role: "button", tabindex: "0", title: "Open the bar", onclick: () => { V.min = false; draw(); } }, [h("span", { class: "rec" }, [h("i"), "REC"]), h("span", { class: "time" }, clock())]));
    } else {
      fb.append(pill());
      if (V.open) fb.append(details());
    }
    wrap.append(fb);
    if (msg && Date.now() < msgUntil && !(V.open && S.recording && !V.min) && !V.hidden) wrap.append(h("div", { class: "toast" + (msgBad ? " bad" : "") }, msg));
    else if (msg && Date.now() < msgUntil && V.hidden) wrap.append(h("div", { class: "toast" }, msg));
    const tl = wrap.querySelector(".tl"), lv = tl && tl.querySelector("li.live");
    if (tl) tl.scrollTop = V.scrollLive && lv ? lv.offsetTop - tl.offsetTop - tl.clientHeight / 2 + lv.offsetHeight / 2 : keep;
    if (V.open) V.scrollLive = false;
    if (wasBox) { const b = wrap.querySelector("[data-box]"); if (b) { b.focus(); try { b.setSelectionRange(caret, caret); } catch (e) { /* */ } } }
    const ri = wrap.querySelector(".tl input");
    if (ri) { ri.focus(); if (renFocus !== null) ri.value = renFocus; else ri.select(); }
  }
  // only the parts that change between two answers are redrawn when the user is not typing: the clock ticks on its own
  setInterval(() => { for (const t of root.querySelectorAll(".time, .tiny-only b")) t.textContent = clock(); }, 1000);

  // ── actions ──
  function mark() {
    const t = (typed || "").trim();
    if (!t && !(S && S.next.planned)) { say("Type a name for the transaction", true); return; }
    send({ act: "mark", name: t });
    typed = ""; const b = wrap.querySelector("[data-box]"); if (b) b.value = "";
  }
  function stop() { send({ act: "stop" }); }
  function prefs(p) { send({ act: "prefs", prefs: Object.assign({}, S.prefs, p) }); S.prefs = Object.assign({}, S.prefs, p); draw(); }

  // the recorder's answer: state, and a message for this window
  globalThis.__perfxBarUpdate = (state, note, front) => {
    lastSeen = Date.now();
    // one bar on screen: only the recorded window the user works in shows it (the recorder decides)
    const wasFront = V.front;
    V.front = front !== false;
    host.style.setProperty("display", V.front ? "block" : "none", "important");
    if (!V.front && wasFront) { V.open = false; renaming = null; }
    // not recording yet (the page attached a moment before the recording began): wait for the next answer
    if (!state || (!state.recording && !wasRec)) return;
    if (state.recording) wasRec = true;
    const first = !S;
    S = state;
    if (note && note.text) { msg = note.text; msgUntil = Date.now() + 2800; msgBad = !!note.bad; if (note.scroll) V.scrollLive = true; setTimeout(draw, 2900); }
    if (first) mount();
    if (!S.recording && !V.gone) { setTimeout(() => { V.gone = true; host.remove(); }, 4000); }
    // never redraw under the user's typing in a rename box (the answer comes back after Enter)
    const f = root.activeElement;
    if (f && f.closest && f.closest(".tl") && f.tagName === "INPUT" && !(note && note.text)) return;
    draw();
    raise();
  };
  // hidden for the transaction screenshots (they show the application, not the bar)
  globalThis.__perfxBarHide = (on) => { host.style.setProperty("visibility", on ? "hidden" : "visible", "important"); };

  // Alt+Shift+H hides the bar completely and brings it back (a combination applications rarely use)
  // when the user last clicked or typed in this window (or came into it): the bar shows in the window used last.
  // Not document.hasFocus(): automation and some security tools make every window report the focus.
  let lastUsed = 0;
  const used = () => { lastUsed = Date.now(); if (!V.gone && !V.front) send({ act: "poll", title: String(document.title || "").slice(0, 200), used: lastUsed }); };
  for (const t of ["pointerdown", "keydown", "focus"]) window.addEventListener(t, used, true);
  window.addEventListener("keydown", (e) => {
    if (e.altKey && e.shiftKey && (e.key === "H" || e.key === "h" || e.code === "KeyH") && S && S.recording) {
      e.preventDefault(); e.stopPropagation();
      V.hidden = !V.hidden;
      if (V.hidden) say("Bar hidden — still recording. Alt+Shift+H brings it back"); else { msg = ""; draw(); }
    }
  }, true);

  // drag by the grip: follows the pointer; let go, it snaps to the nearer edge and to the left, middle or right third
  root.addEventListener("pointerdown", (e) => {
    const g = e.target.closest && e.target.closest(".grip"); if (!g) return;
    const fb = g.closest(".fb"), r = fb.getBoundingClientRect(), dx = e.clientX - r.left;
    e.preventDefault(); g.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const x = Math.max(8, Math.min(innerWidth - r.width - 8, ev.clientX - dx)), y = Math.max(8, Math.min(innerHeight - 50, ev.clientY - 20));
      fb.style.setProperty("left", x + "px"); fb.style.setProperty("top", y + "px"); fb.style.setProperty("bottom", "auto"); fb.style.setProperty("right", "auto"); fb.style.setProperty("transform", "none");
    };
    const up = (ev) => {
      g.removeEventListener("pointermove", move); g.removeEventListener("pointerup", up); g.removeEventListener("pointercancel", up);
      const cx = ev.clientX;
      prefs({ dock: ev.clientY > innerHeight / 2 ? "bottom" : "top", pos: cx < innerWidth / 3 ? "left" : cx > innerWidth * 2 / 3 ? "right" : "center" });
    };
    g.addEventListener("pointermove", move); g.addEventListener("pointerup", up); g.addEventListener("pointercancel", up);
  });

  // ask the recorder for its state: at once, then every 700 ms; without an answer for 8 s the bar goes (recorder closed)
  const poll = () => {
    if (V.gone) return;
    if (S && Date.now() - lastSeen > 8000) { V.gone = true; host.remove(); return; }
    send({ act: "poll", title: String(document.title || "").slice(0, 200), used: lastUsed });
    setTimeout(poll, 700);
  };
  if (document.documentElement) poll(); else document.addEventListener("DOMContentLoaded", poll, { once: true });
  // some applications rebuild <html> children, open or close dialogs: put the bar back, on top
  setInterval(() => { if (!V.gone && S) raise(); }, 500);
}
