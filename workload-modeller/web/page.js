/* Workload Modeller — page behaviour: Simple / Detailed, theme, columns, folding, many scripts (find, filter, Overwrite
   all scripts, Paste from Excel), Defaults for every script, Fill from scripts, clear + Undo, and the first draw. */
"use strict";
/* ---------- page ---------- */
document.querySelectorAll("[role=tab]").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("[role=tab]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
  document.querySelectorAll(".wm-pane").forEach((p) => p.classList.toggle("on", p.id === "tab-" + b.dataset.tab));
  if (typeof setupWidth === "function") setupWidth();
}));
function view(simple) {
  document.body.classList.toggle("simple", simple);
  $("#v-simple").setAttribute("aria-pressed", String(simple)); $("#v-detail").setAttribute("aria-pressed", String(!simple));
  try { localStorage.setItem("wm-view", simple ? "simple" : "detail"); } catch (e) { /* private window */ }
}
$("#v-simple").addEventListener("click", () => view(true)); $("#v-detail").addEventListener("click", () => view(false));
// theme: own key "wm-theme" (read before the first paint in index.html); inside the portal the portal's theme
function setTheme(t) {
  document.documentElement.dataset.theme = t === "light" ? "light" : "dark";
  try { localStorage.setItem("wm-theme", document.documentElement.dataset.theme); } catch (e) { /* storage blocked */ }
}
window.lrePortalInit = (theme) => { document.documentElement.classList.add("embedded"); setTheme(theme); };
window.lreSetTheme = setTheme;
$("#btn-theme").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
$("#btn-example").addEventListener("click", () => {
  seq = 0;
  state.groups = [
    newScript({ name: "Login", method: "tps", targetTps: 2, txPerIter: 1, thinkPerIter: 5, rtAvg: 1, requestsPerIter: 6 }),
    newScript({ name: "Search", method: "volume", volumePerHour: 21600, txPerIter: 2, thinkPerIter: 10, rtAvg: 0.5, requestsPerIter: 8, pacing: { mode: "random", min: 12, max: 16 } }),
    newScript({ name: "Payment", method: "vusers", vusers: 12, txPerIter: 4, thinkPerIter: 15, pacing: { mode: "fixed", fixed: 24 }, protocol: "devweb", requestsPerIter: 14 }),
  ];
  renderScripts(); renderTest(); renderPools(); calc();
});
/* ---------- columns: hide the inputs or the results to a strip (one at a time), remembered ---------- */
function setLayout(mode, focusEl) {
  $(".wm-page").classList.toggle("res-hidden", mode === "res-hidden");
  $(".wm-page").classList.toggle("in-hidden", mode === "in-hidden");
  try { localStorage.setItem("wm-layout", mode); } catch (e) { /* private window */ }
  if (focusEl) $(focusEl).focus({ preventScroll: true });
  if (typeof tvWidth === "function") tvWidth();
  if (typeof setupWidth === "function") setupWidth();
}
$("#btn-hide-res").addEventListener("click", () => setLayout("res-hidden", "#rail"));
$("#rail").addEventListener("click", () => setLayout("", "#btn-hide-res"));
$("#btn-hide-in").addEventListener("click", () => setLayout("in-hidden", "#rail-in"));
$("#rail-in").addEventListener("click", () => setLayout("", "#btn-hide-in"));
try {
  const m = localStorage.getItem("wm-layout") ?? (localStorage.getItem("wm-results") === "hidden" ? "res-hidden" : "");
  if (m === "res-hidden" || m === "in-hidden") setLayout(m);
} catch (e) { /* private window */ }

/* ---------- folding ---------- */
const CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
let folds = {};
try { folds = JSON.parse(localStorage.getItem("wm-folds") || "{}"); } catch (e) { folds = {}; }
function foldSection(sec, folded) {
  sec.classList.toggle("is-folded", folded);
  sec.querySelector(".wm-chev").setAttribute("aria-expanded", String(!folded));
  folds[sec.dataset.fold] = folded;
  try { localStorage.setItem("wm-folds", JSON.stringify(folds)); } catch (e) { /* private window */ }
}
document.querySelectorAll("[data-fold]").forEach((sec) => {
  const head = sec.querySelector(".ds-card-head"), h2 = head.querySelector("h2");
  const b = document.createElement("button");
  b.className = "wm-chev"; b.innerHTML = CHEV; b.setAttribute("aria-label", "Show or hide " + h2.firstChild.textContent.trim());
  head.prepend(b);
  b.addEventListener("click", () => foldSection(sec, !sec.classList.contains("is-folded")));
  h2.addEventListener("click", () => foldSection(sec, !sec.classList.contains("is-folded")));
  foldSection(sec, !!folds[sec.dataset.fold]);
});
function foldCard(g, folded, o) {
  o = o || {};
  const el = document.querySelector(`.wm-script[data-id="${g.id}"]`);
  const top = el && el.getBoundingClientRect().top;
  if (!folded && o.only) state.groups.forEach((x) => { if (x !== g && !x.folded) foldCard(x, true); });   // one open at a time
  g.folded = folded;
  if (!el) return;
  el.classList.toggle("is-folded", folded);
  el.querySelector("[data-fold-card].wm-chev").setAttribute("aria-expanded", String(!folded));
  if (o.only) { const moved = el.getBoundingClientRect().top - top; if (Math.abs(moved) > 1) window.scrollBy(0, moved); }
  if (!folded && o.only) { const first = el.querySelector(".wm-script-body .ds-field"); if (first) first.focus({ preventScroll: true }); }
  listChrome();
}
$("#btn-fold-all").addEventListener("click", () => state.groups.forEach((g) => foldCard(g, true)));
document.querySelectorAll("[data-all]").forEach((b) => b.addEventListener("click", () =>
  document.getElementById(b.dataset.all).querySelectorAll("[data-fold]").forEach((sec) => foldSection(sec, b.dataset.open === "0"))));
$("#btn-unfold-all").addEventListener("click", () => state.groups.forEach((g) => { if (!$(`.wm-script[data-id="${g.id}"]`).hidden) foldCard(g, false); }));

/* response time: needed, optional or given — said under the field, and the field outlined when needed */
function rtHelp(r) {
  const g = state.groups.find((x) => x.id === r.id), el = $("#rth-" + r.id); if (!g || !el) return;
  const input = el.closest(".wm-f").querySelector("input"), pm = (g.pacing && g.pacing.mode) || "auto";
  const needed = r.needs === "rt";
  input.classList.toggle("wm-need", needed);
  el.textContent = needed ? "needed to choose the pacing — your SLA will do (e.g. 2 s); or set a fixed pacing below"
    : g.rtAvg != null ? "average per transaction"
    : state.common.rtAvg > 0 ? "empty — the common response time is used"
    : pm === "fixed" || pm === "random" || g.method === "vusers_tps" ? "optional — when empty, Checks give the slowest response time the plan allows"
    : "average per transaction";
}
function goto(c) { return c.gid && c.field ? ` <button class="wm-goto" data-goto="${c.gid}" data-field="${c.field}">Go there</button>` : ""; }
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-goto]"); if (!b) return;
  const g = state.groups.find((x) => x.id === b.dataset.goto); if (!g) return;
  if ($(".wm-page").classList.contains("in-hidden")) setLayout("");
  foldSection($("#scripts-card"), false);
  if (tableView()) {
    const tr = $(`#tv tr[data-id="${g.id}"]`);
    if (tr && tr.hidden) { $("#find").value = ""; $('#sfilter [data-f="all"]').click(); }
    const f = $(`#tv tr[data-id="${g.id}"] [data-k="${b.dataset.field}"]`) || $(`#tv tr[data-id="${g.id}"] [data-k="pacing.mode"]`);
    if (f) { f.scrollIntoView({ block: "center", behavior: "smooth" }); f.focus({ preventScroll: true }); }
    return;
  }
  const card = $(`.wm-script[data-id="${g.id}"]`);
  if (card && card.hidden) { $("#find").value = ""; $('#sfilter [data-f="all"]').click(); }
  foldCard(g, false, { only: true });
  const f = document.querySelector(`.wm-script[data-id="${g.id}"] [data-k="${b.dataset.field}"]`)
    || document.querySelector(`.wm-script[data-id="${g.id}"] [data-k="pacing.mode"]`);
  if (f) { f.scrollIntoView({ block: "center", behavior: "smooth" }); f.focus({ preventScroll: true }); }
});

/* ---------- many scripts: find, filter, column heads, change several, paste targets ---------- */
const NEED_MANY = {
  "needs-target": "have no target yet — enter one on each script, set one for all in “Defaults for every script”, or use Paste from Excel.",
  "needs-rt": "need a response time (your SLA will do) or a fixed pacing — “Defaults for every script” sets one response time for all.",
  "needs-vusers": "need their number of Vusers.", "needs-pacing": "need their pacing in seconds.",
};
// more than 3 scripts missing the same input: one line instead of one per script
function groupNeeds(list) {
  Object.keys(NEED_MANY).forEach((code) => {
    const same = list.filter((c) => c.code === code && c.gid);
    if (same.length <= 3) return;
    const at = list.indexOf(same[0]);
    for (let i = list.length - 1; i >= 0; i--) if (same.includes(list[i])) list.splice(i, 1);
    list.splice(at, 0, { level: same[0].level, code, many: true, text: `${same.length} scripts ${NEED_MANY[code]}` });
  });
  return list;
}
const showNeed = () => ` <button class="wm-goto" data-show-need>Show them</button>`;
document.addEventListener("click", (e) => {
  if (!e.target.closest("[data-show-need]")) return;
  if ($(".wm-page").classList.contains("in-hidden")) setLayout("");
  foldSection($("#scripts-card"), false);
  $("#find").value = ""; $('#sfilter [data-f="need"]').click();
  $("#scripts-bar").scrollIntoView({ block: "start", behavior: "smooth" });
});
const WARN_MANY = { "no-tx": "had no transaction — each request was counted as one", "init-tx": "have start-up transactions (vuser_init / load.initialize) — run once per Vuser, not counted",
  "end-tx": "have closing transactions (vuser_end / load.finalize) — run once per Vuser, not counted",
  "nested-tx": "have transactions inside other transactions — all are counted, so the iteration time is on the high side",
  "think-ignored": "ignore their think time at replay — set “Think time” with “Overwrite all scripts” if LRE should use it", har: "came from HAR recordings — response times are one user's, a first estimate" };
function warnSummary(scripts) {
  const n = {}; scripts.forEach((s) => (s.warnCodes || []).forEach((c) => { n[c] = (n[c] || 0) + 1; }));
  const items = Object.keys(n).map((c) => `<li>${n[c]} script${n[c] === 1 ? "" : "s"} ${WARN_MANY[c] || c}</li>`);
  return items.length ? `<ul style="color:var(--ds-warn)">${items.join("")}</ul>` : "";
}
let calcT = 0;
function calcSoon() { clearTimeout(calcT); if (state.groups.length > 20) calcT = setTimeout(calc, 150); else calc(); }
let sFilter = "all";
const statusOf = (id) => { const g = last && last.groups.find((x) => x.id === id); return !g ? "need" : g.status === "needs-input" ? "need" : g.status === "infeasible" ? "bad" : "ok"; };
function listChrome() {
  // the find / filter bar shows from 4 scripts — and always while a filter is on, so nothing is hidden without a sign
  const many = state.groups.length >= 4 || sFilter !== "all" || !!$("#find").value;
  document.querySelectorAll(".wm-many").forEach((el) => { el.hidden = !many; });
  $("#btn-bulk").hidden = $("#btn-paste").hidden = state.groups.length < 2;
  $("#list-head").hidden = tableView() || state.groups.length < 2 || !state.groups.some((g) => g.folded);
  $("#btn-unfold-all").hidden = $("#btn-fold-all").hidden = tableView() || state.groups.length < 2;
}
const rowEl = (id) => (tableView() ? $(`#tv tr[data-id="${id}"]`) : $(`.wm-script[data-id="${id}"]`));
// full: the user changed Find or the filter — show exactly the matches. Otherwise (a recalculation) a script that was
// shown stays shown even when its status changes (it just got its target), and an open script is never hidden.
let shownIds = null;
function applyFilter(full) {
  const q = ($("#find").value || "").trim().toLowerCase();
  const n = { all: 0, need: 0, bad: 0, ok: 0 }; let shown = 0;
  const now = new Set();
  state.groups.forEach((g) => {
    const s = statusOf(g.id); n.all++; n[s]++;
    const el = rowEl(g.id); if (!el) return;
    const match = (!q || g.name.toLowerCase().includes(q)) && (sFilter === "all" || sFilter === s);
    const show = match || (tableView() ? tvOpen === g.id : !g.folded) || (!full && shownIds && shownIds.has(g.id));
    el.hidden = !show; if (show) { shown++; now.add(g.id); }
    const card = tableView() && $(`#tv tr[data-card-of="${g.id}"]`); if (card) card.hidden = !show;
  });
  shownIds = now;
  $("#no-match").hidden = !(state.groups.length && !shown);
  listChrome();
  ["all", "need", "bad", "ok"].forEach((k) => { $("#fc-" + k).textContent = n[k]; });
  $("#shown").textContent = shown < n.all ? `${shown} of ${n.all} shown` : "";
  const all = shown === n.all;
  $("#bulk-title").textContent = all ? `Overwrite all ${shown} scripts` : `Overwrite the ${shown} script${shown === 1 ? "" : "s"} shown`;
  $("#bulk-label").textContent = all ? "Overwrite all scripts" : `Overwrite the ${shown} shown`;
  return state.groups.filter((g) => { const el = rowEl(g.id); return el && !el.hidden; });
}
$("#find").addEventListener("input", () => applyFilter(true));
$("#show-all").addEventListener("click", () => { $("#find").value = ""; $('#sfilter [data-f="all"]').click(); });
$("#sfilter").addEventListener("click", (e) => {
  const b = e.target.closest("[data-f]"); if (!b) return;
  sFilter = b.dataset.f;
  $("#sfilter").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  applyFilter(true);
});
// change several
$("#b-pm").innerHTML += opt(PACING, ""); $("#b-think").innerHTML += opt(THINK, "");
$("#b-pm").addEventListener("change", (e) => {
  $("#b-fixed-f").hidden = e.target.value !== "fixed"; $("#b-min-f").hidden = $("#b-max-f").hidden = e.target.value !== "random";
});
const PANELS = { "#bulk": "#btn-bulk", "#paste": "#btn-paste" };
function panelState() { Object.keys(PANELS).forEach((x) => $(PANELS[x]).setAttribute("aria-expanded", String(!$(x).hidden))); }
function openPanel(id) {
  Object.keys(PANELS).forEach((x) => { $(x).hidden = x !== id || !$(x).hidden; });
  panelState(); $("#b-msg").textContent = "";
  if (!$(id).hidden) { applyFilter(); const f = $(id).querySelector("input, select, textarea"); if (f) f.focus({ preventScroll: true }); $(id).scrollIntoView({ block: "nearest" }); }
}
function closePanel(id) { if ($(id).hidden) return; $(id).hidden = true; panelState(); $(PANELS[id]).focus({ preventScroll: true }); }
$("#btn-bulk").addEventListener("click", () => openPanel("#bulk"));
$("#b-cancel").addEventListener("click", () => closePanel("#bulk"));
$("#b-x").addEventListener("click", () => closePanel("#bulk"));
$("#p-x").addEventListener("click", () => closePanel("#paste"));
Object.keys(PANELS).forEach((id) => $(id).addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); closePanel(id); } }));
$("#b-apply").addEventListener("click", () => {
  const val = (s) => { const v = parseFloat($(s).value); return Number.isFinite(v) ? v : null; };
  const rt = val("#b-rt"), pm = $("#b-pm").value, think = $("#b-think").value, tps = val("#b-tps");
  const list = applyFilter(), msg = (m, sel) => { $("#b-msg").textContent = m; if (sel) $(sel).focus(); };
  if (rt == null && !pm && !think && tps == null) return msg("Nothing to set yet — fill in at least one field (or press Close).", "#b-rt");
  if (pm === "fixed" && val("#b-fixed") == null) return msg("Fixed pacing needs its seconds — fill in “Every”.", "#b-fixed");
  if (pm === "random" && (val("#b-min") == null || val("#b-max") == null)) return msg("Random pacing needs the shortest and the longest wait.", val("#b-min") == null ? "#b-min" : "#b-max");
  if (pm === "random" && val("#b-min") > val("#b-max")) return msg("The shortest wait is longer than the longest.", "#b-min");
  const what = [rt != null && `response time ${rt} s`, pm && `pacing “${PACE_SHORT[pm] || pm}”${pm === "fixed" ? ` ${val("#b-fixed")} s` : pm === "random" ? ` ${val("#b-min")}–${val("#b-max")} s` : ""}`,
    think && `think time “${THINK_SHORT[think] || think}”`, tps != null && `target ${tps} TPS`].filter(Boolean).join(", ");
  clearWith(`Set ${what} on ${list.length} script${list.length === 1 ? "" : "s"}.`, () => list.forEach((g) => {
    if (rt != null) { g.rtAvg = rt; g.rtSource = g.rtSource || "sla"; }
    if (pm) {
      g.pacing = Object.assign({}, g.pacing, { mode: pm });
      if (pm === "fixed" && val("#b-fixed") != null) g.pacing.fixed = val("#b-fixed");
      if (pm === "random") { if (val("#b-min") != null) g.pacing.min = val("#b-min"); if (val("#b-max") != null) g.pacing.max = val("#b-max"); }
    }
    if (think) g.thinkMode = think;
    if (tps != null) { g.method = "tps"; g.targetTps = tps; }
    g.sample = false;
  }));
  ["#b-rt", "#b-tps", "#b-fixed", "#b-min", "#b-max"].forEach((s) => { $(s).value = ""; }); $("#b-pm").value = ""; $("#b-think").value = "";
  $("#b-fixed-f").hidden = $("#b-min-f").hidden = $("#b-max-f").hidden = true;
  closePanel("#bulk");
});
// paste targets from Excel: name + number per line
$("#btn-paste").addEventListener("click", () => {
  const eg = state.groups.slice(0, 3).map((g, i) => g.name + "\t" + [5, 2, 10][i]).join("\n");
  $("#p-text").placeholder = eg || "Login\t2\nSearch\t6";
  openPanel("#paste"); $("#p-out").textContent = ""; if (!$("#paste").hidden) $("#p-text").focus(); });
$("#p-cancel").addEventListener("click", () => closePanel("#paste"));
const normName = (s) => s.toLowerCase().replace(/\s*\(\d+\)\s*$/, "").replace(/\.(zip|har|json)$/, "").replace(/[^a-z0-9]+/g, "");
const looseName = (s) => s.toLowerCase().replace(/\.(zip|har|json)$/, "").replace(/[^a-z0-9]+/g, "");
// → { g } one script · { many: [g…] } more than one fits (nothing is changed) · {} none
function matchScript(name) {
  const s = String(name).trim(), low = s.toLowerCase();
  for (const same of [(g) => g.name.trim().toLowerCase() === low, (g) => looseName(g.name) === looseName(s), (g) => normName(g.name) === normName(s)]) {
    const hits = state.groups.filter(same);
    if (hits.length === 1) return { g: hits[0] };
    if (hits.length > 1) return { many: hits };
  }
  return {};
}
function parsePaste(text) {
  const rows = [];
  text.split(/\r?\n/).forEach((line) => {
    if (!line.trim()) return;
    let name, num;
    if (line.includes("\t")) { const c = line.split("\t").map((x) => x.trim()).filter(Boolean); num = c.pop(); name = c.join(" "); num = (num || "").replace(/[\s,]/g, ""); }
    else { const m = line.match(/^(.*?)[\s;,]+([\d.,]+)\s*$/); if (!m) return; name = m[1].trim(); num = m[2].replace(/,(?=\d{3}\b)/g, "").replace(",", "."); }
    const v = parseFloat(num);
    if (name && Number.isFinite(v)) rows.push({ name, v });       // a header row has no number and is skipped
  });
  return rows;
}
$("#p-apply").addEventListener("click", () => {
  const rows = parsePaste($("#p-text").value), kind = $("#p-kind").value;
  if (!rows.length) { $("#p-out").textContent = "Nothing to apply — paste lines with a script name and a number."; return; }
  const key = { tps: "targetTps", volume: "volumePerHour", vusers: "vusers", share: "sharePct", iterations: "iterations" }[kind];
  const found = [], missing = [], unclear = [];
  rows.forEach((row) => {
    const m = matchScript(row.name);
    if (m.g) found.push([m.g, row.v]); else if (m.many) unclear.push(`“${row.name}” (${m.many.map((g) => g.name).join(", ")})`); else missing.push(row.name);
  });
  if (found.length) clearWith(`Set ${found.length} target${found.length === 1 ? "" : "s"}.`, () => found.forEach(([g, v]) => { g.method = kind; g[key] = v; g.sample = false; }));
  $("#p-out").innerHTML = `${found.length} of ${rows.length} line${rows.length === 1 ? "" : "s"} matched a script${found.length ? " — their targets are set" : ""}.` + (missing.length ? ` <span style="color:var(--ds-warn)">No script named: ${esc(missing.slice(0, 12).join(", "))}${missing.length > 12 ? ` and ${missing.length - 12} more` : ""}.</span>` : "")
    + (unclear.length ? ` <span style="color:var(--ds-warn)">Fits more than one script, so not used — write the full name: ${esc(unclear.slice(0, 6).join("; "))}${unclear.length > 6 ? ` and ${unclear.length - 6} more` : ""}.</span>` : "");
});

/* ---------- the same response time / TPS for every script ----------
   A script's own value always wins. The common TPS applies to scripts sized by TPS with no target:
   "each" — every one gets it; "total" — the scenario's total minus what the scripts with their own target already
   reach, shared evenly. Volume-per-hour and share scripts count towards the total too. */
let lastResolved = null;
function commonTps(g) {
  if (!(g.method === "tps" && g.targetTps == null)) return null;
  const r = resolved(); const x = r.groups.find((y) => y.id === g.id); return x && x._cTps ? x.targetTps : null;
}
function resolved() {
  const c = state.common, sc = state.scenario;
  const free = state.groups.filter((g) => g.method === "tps" && g.targetTps == null);
  let each = null, check = null, own = 0;
  if (c.tps > 0 && free.length) {
    if (c.tpsMode === "total") {
      own = state.groups.reduce((a, g) => a + (g.method === "tps" || g.method === "vusers_tps" ? g.targetTps || 0
        : g.method === "volume" ? (g.volumePerHour || 0) / 3600 : g.method === "share" ? (sc.totalTps || 0) * (g.sharePct || 0) / 100 : 0), 0);
      const left = c.tps - own;
      if (left > 1e-9) each = left / free.length;
      else check = { level: "bad", code: "common-total", text: `The scripts with their own target already reach ${fmt(own, 2)} TPS — nothing is left of the ${fmt(c.tps, 2)} TPS total for the ${free.length} script${free.length === 1 ? "" : "s"} without a target.` };
    } else each = c.tps;
  }
  const groups = state.groups.map((g) => {
    const o = Object.assign({}, g);
    if (each != null && g.method === "tps" && g.targetTps == null) { o.targetTps = each; o._cTps = true; }
    if (c.rtAvg > 0 && g.rtAvg == null) { o.rtAvg = c.rtAvg; o._cRt = true; if (!g.rtSource) o.rtSource = "sla"; }
    return o;
  });
  return { groups, each, own, free: free.length, check };
}
function commonUi(res) {
  const c = state.common;
  $("#common").hidden = state.groups.length < 2;
  $("#c-tps-l").textContent = c.tpsMode === "total" ? "Target TPS in total" : "Target TPS for each script";
  const h = $("#c-tps-h"); h.className = "";
  if (!(c.tps > 0)) h.textContent = c.tpsMode === "total" ? "shared by the scripts with no target yet" : "for scripts with no target yet";
  else if (!res.free) h.textContent = "every script has its own target — nothing uses this";
  else if (c.tpsMode === "total") {
    if (res.each != null) h.textContent = `${res.free} script${res.free === 1 ? "" : "s"} without a target get ${fmt(res.each, 2)} TPS each${res.own ? ` (${fmt(res.own, 2)} TPS already taken by own targets)` : ""}`;
    else { h.textContent = `own targets already reach ${fmt(res.own, 2)} TPS — nothing left`; h.className = "bad"; }
  } else h.textContent = `${res.free} script${res.free === 1 ? "" : "s"} without a target use it`;
  // the open cards' placeholders follow the common values
  res.groups.forEach((g) => document.querySelectorAll(`#scripts-list [data-id="${g.id}"]`).forEach((card) => {
    const tin = card.querySelector('[data-k="targetTps"]'), rin = card.querySelector('[data-k="rtAvg"]');
    if (tin && g.method === "tps") tin.placeholder = g._cTps ? `${fmt(g.targetTps, 2)} — common` : "";
    if (rin) rin.placeholder = g._cRt ? `${fmt(g.rtAvg, 2)} — common` : card.tagName === "TR" ? "" : "unknown";
  }));
}
$("#c-rt").addEventListener("input", (e) => { const v = parseFloat(e.target.value); state.common.rtAvg = v > 0 ? v : null; calcSoon(); });
$("#c-tps").addEventListener("input", (e) => { const v = parseFloat(e.target.value); state.common.tps = v > 0 ? v : null; calcSoon(); });
$("#common").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tm]"); if (!b) return;
  state.common.tpsMode = b.dataset.tm;
  $("#common").querySelectorAll("[data-tm]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  calc();
});
function renderCommon() {
  const c = state.common;
  $("#c-rt").value = c.rtAvg ?? ""; $("#c-tps").value = c.tps ?? "";
  $("#common").querySelectorAll("[data-tm]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.tm === c.tpsMode)));
}

/* the important values of a folded script card */
const METHOD_SHORT = { tps: "TPS", volume: "Per hour", share: "Share of total %", vusers: "Vusers", vusers_tps: "Vusers + TPS", iterations: "Iterations" };
function facts(g, r) {
  const need = (t) => `<b class="need">${t}</b>`;
  const tgt = { tps: g.targetTps != null ? (g._cTps ? `<i class="wm-dflt">${fmt(g.targetTps, 2)} TPS</i>` : fmt(g.targetTps, 2) + " TPS") : need("enter"), volume: g.volumePerHour != null ? fmt(g.volumePerHour) + " / hour" : need("enter"),
    share: g.sharePct != null ? fmt(g.sharePct, 1) + "% of total" : need("enter"), vusers: g.vusers != null ? fmt(g.vusers) + " Vusers" : need("enter"),
    vusers_tps: g.vusers != null && g.targetTps != null ? `${fmt(g.vusers)} Vusers, ${fmt(g.targetTps, 2)} TPS` : need("enter"),
    iterations: g.iterations != null ? fmt(g.iterations) : need("enter") }[g.method];
  const rt = g.rtAvg != null ? (g._cRt ? `<i class="wm-dflt">${fmtS(g.rtAvg)}</i>` : fmtS(g.rtAvg)) : r && r.needs === "rt" ? '<b class="need">needed</b>' : "—";
  const p = g.pacing || {}, pm = p.mode || "auto";
  const pace = r && r.pacing && r.pacing.mean ? (r.pacing.kind === "random" ? `${fmtS(r.pacing.min)} – ${fmtS(r.pacing.max)}` : fmtS(r.pacing.mean))
    : ({ auto: "auto", asap: "none", after: "after + delay" })[pm] || "—";
  const planFull = !r || r.status === "needs-input" ? "" : r.status === "estimate" ? `${fmt(r.vusers)} Vusers · TPS depends on response time`
    : `${fmt(r.vusers)} Vusers · ${fmt(r.tps, 2)} TPS${r.status === "infeasible" ? " · not possible" : ""}`;
  const plan = !planFull ? "—" : r.status === "estimate" ? "TPS varies"
    : g.method === "vusers" ? `${fmt(r.tps, r.tps < 10 ? 2 : 1)} TPS` : `${fmt(r.vusers)} Vusers`;
  const cell = (label, v, full) => `<div title="${esc(label + ": " + (full || v.replace(/<[^>]+>/g, "")))}"><span>${label}</span>${v}</div>`;
  return cell(METHOD_SHORT[g.method], tgt)
    + cell("One iteration", `${fmt(g.txPerIter)} tx · ${fmtS(g.thinkPerIter || 0)} think${g.thinkMode === "ignore" && g.thinkPerIter ? " (ignored)" : ""}`)
    + cell("Response time", rt) + cell("Pacing", pace, pm === "auto" && r && r.pacing && r.pacing.mean ? pace + " (chosen by the tool)" : "") + cell("Plan", plan, planFull);
}
function poolFacts(p) {
  return `<div><span>Machine</span>${esc(lgType(p).label.replace(" (enter its size)", ""))}</div>
    <div><span>Each machine</span>${p.cores ? fmt(p.cores) + " cores" : '<b class="need">cores?</b>'} · ${p.ramGb ? fmt(p.ramGb) + " GB" : '<b class="need">memory?</b>'}</div>
    <div><span>Available</span>${p.available != null ? fmt(p.available) : "no limit"}</div><div><span>Vusers per machine</span>${p.webPerLg || p.apiPerLg ? `${p.webPerLg ? fmt(p.webPerLg) + " web" : ""}${p.webPerLg && p.apiPerLg ? " · " : ""}${p.apiPerLg ? fmt(p.apiPerLg) + " API" : ""}` : "machine size only"}</div><div><span>Extra</span>${fmt(p.extra || 0)}</div>`;
}
function sectionSums(r) {
  const sc = state.scenario;
  $("#sum-test").textContent = `— ${E.TEST_TYPES[sc.testType].label.replace(/ \(.*/, "")} · ${fmt(sc.steadyMin)} min · ${E.WORKLOADS[sc.workload]}`;
  const needs = r.groups.filter((g) => g.status === "needs-input").length;
  $("#sum-scripts").textContent = `— ${state.groups.length} script${state.groups.length === 1 ? "" : "s"}${needs ? ` · ${needs} need input` : ""}`;
  $("#sum-lg").textContent = "— " + (r.lgTotal != null ? `${r.lgTotal} machine${r.lgTotal === 1 ? "" : "s"} · ` : "") + state.pools.map((p) => p.name).join(", ");
  $("#sum-tune").textContent = `— headroom ${fmt(sc.headroomPct)}% · start rate ${fmt(sc.maxStartRate, 1)} per s`;
}

/* ---------- fill from scripts (all at once) ---------- */
async function fill(files) {
  files = [...files]; if (!files.length) return;
  const all = files.length, xl = files.filter((f) => /\.xlsx$/i.test(f.name));
  files = files.filter((f) => !/\.xlsx$/i.test(f.name));
  const note = $("#import-note");
  note.hidden = false; note.className = "ds-note wm-import"; note.textContent = `Reading ${all} file${all === 1 ? "" : "s"}…`;
  if (xl.length) undoSnap = snapshot();                     // an Excel sheet overwrites values: it can be undone
  const { scripts, skipped } = files.length ? await window.ScriptReader.readFiles(files) : { scripts: [], skipped: [] };
  const xlRes = [];
  for (const f of xl) { try { xlRes.push(Object.assign({ file: f.name }, await readSheet(f))); } catch (e) { skipped.push(`${f.name} — could not be read (${e.message})`); } }
  if ((scripts.length || xlRes.some((x) => x.rows.length)) && state.groups.length === 1 && state.groups[0].sample) state.groups = [];   // the untouched starting example goes
  const lines = [], seen = new Map();
  scripts.forEach((s) => {
    const key = s.name.toLowerCase();
    if (seen.has(key)) lines[seen.get(key)] = null;          // the same script in two files: the last one wins
    let g = state.groups.find((x) => x.name.toLowerCase() === key);
    const existed = !!g && !seen.has(key);
    const fields = { protocol: s.protocol, txPerIter: s.txPerIter || 1, thinkPerIter: s.thinkPerIter, requestsPerIter: s.requestsPerIter || null,
      pages: s.pages, pageShare: s.pageShare, txNames: s.txNames, source: s.file };
    if (s.thinkMode) fields.thinkMode = s.thinkMode;
    if (s.thinkFactor) fields.thinkFactor = s.thinkFactor;
    if (s.rtAvg != null) { fields.rtAvg = s.rtAvg; fields.rtSource = "recording"; }
    if (g) Object.assign(g, fields, { folded: true });
    else { g = newScript(Object.assign({ name: s.name, targetTps: null, pool: state.pools[0].id, folded: true }, fields)); state.groups.push(g); }
    seen.set(key, lines.length);
    lines.push(`<li title="${esc(s.notes.join("\n"))}"><b>${esc(s.name)}</b> <span class="wm-muted">${esc(PROTOS[s.protocol].label)} · ${esc(s.file)}${existed ? " · updated the card" : ""}</span><br>${esc(s.brief)}${
      s.warnings.length ? `<br><span style="color:var(--ds-warn)">${s.warnings.map(esc).join("<br>")}</span>` : ""}</li>`);
  });
  const xlLines = xlRes.map((x) => applySheet(x));
  const dupes = scripts.length - seen.size;
  const shown = lines.filter(Boolean);
  const notRead = skipped.length ? `<div class="wm-skip"><b>${skipped.length} file${skipped.length === 1 ? " was" : "s were"} not read:</b><ul>${skipped.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : "";
  note.className = "ds-note wm-import " + (scripts.length || xlRes.length ? "ok" : "warn");
  note.innerHTML = `<div style="flex:1">${xlLines.join("")}${seen.size || !xlRes.length ? `<b>${seen.size ? `${seen.size} script${seen.size === 1 ? "" : "s"} filled in` : "No script found"} from ${all} file${all === 1 ? "" : "s"}.</b>` : ""}
    ${seen.size ? (tableView() ? " Next: enter each script's target in the Target column — or paste a column of numbers from Excel into it." : " Next: give each script its target — open its card and enter the TPS, transactions per hour or Vusers it must reach.") : ""}${dupes ? ` (${dupes} script${dupes === 1 ? " was" : "s were"} in more than one file — the last one was used.)` : ""}
    ${!shown.length ? "" : shown.length > 8 ? `${warnSummary(scripts)}<details class="wm-more"><summary>All ${shown.length} scripts read</summary><ul>${shown.join("")}</ul></details>` : `<ul>${shown.join("")}</ul>`}${notRead}${seen.size ? `<span class="wm-muted">Loops are counted once: if a script repeats steps, correct its transaction count.</span>` : ""}</div>
    <button class="wm-x" id="import-close" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
  foldSection($("#scripts-card"), false);
  $("#dropzone").classList.toggle("compact", state.groups.length > 0);
  renderScripts(); renderTest(); renderPools(); calc();
  if (xlRes.some((x) => x.rows.length)) toast(`Read ${xlRes.reduce((a, x) => a + x.rows.length, 0)} rows from Excel.`, true);
  if (scripts.length || xlRes.length) used("fill", scripts.length + xlRes.reduce((a, x) => a + x.rows.length, 0));
}
$("#in-fill").addEventListener("change", (e) => { fill(e.target.files); e.target.value = ""; });
const pick = () => $("#in-fill").click();
$("#dropzone").addEventListener("click", pick);
[$("#dropzone"), $("#btn-fill")].forEach((el) => el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } }));
const card = $("#scripts-card");
card.addEventListener("dragover", (e) => { e.preventDefault(); card.classList.add("drop-over"); });
card.addEventListener("dragleave", (e) => { if (!card.contains(e.relatedTarget)) card.classList.remove("drop-over"); });
card.addEventListener("drop", (e) => { e.preventDefault(); card.classList.remove("drop-over"); fill(e.dataTransfer.files); });

$("#import-note").addEventListener("click", (e) => { if (e.target.closest("#import-close")) $("#import-note").hidden = true; });

/* ---------- clear: per section and the whole page; one Undo ---------- */
let undoSnap = null, toastTimer = 0;
function snapshot() {
  const n = $("#import-note");
  return JSON.stringify({ state, protos: PROTOS, seq, poolSeq, note: { html: n.innerHTML, cls: n.className, hidden: n.hidden },
    compact: $("#dropzone").classList.contains("compact"), cal: ["#cal-v", "#cal-cpu", "#cal-mem"].map((s) => $(s).value) });
}
function restore(json) {
  const s = JSON.parse(json), n = $("#import-note");
  state.scenario = s.state.scenario; state.groups = s.state.groups; state.pools = s.state.pools;
  state.common = s.state.common || { rtAvg: null, tps: null, tpsMode: "each" };
  Object.keys(s.protos).forEach((k) => { PROTOS[k] = s.protos[k]; });
  seq = s.seq; poolSeq = s.poolSeq;
  n.innerHTML = s.note.html; n.className = s.note.cls; n.hidden = s.note.hidden;
  $("#dropzone").classList.toggle("compact", s.compact);
  ["#cal-v", "#cal-cpu", "#cal-mem"].forEach((sel, i) => { $(sel).value = s.cal[i]; });
}
function renderAll() { renderCommon(); renderTest(); renderScripts(); renderPools(); renderProtoTable(); cal(); calc(); }
function toast(msg, canUndo) {
  $("#toast-t").textContent = msg; $("#toast").hidden = false; $("#toast-undo").hidden = !(canUndo && undoSnap);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $("#toast").hidden = true; }, 8000);
}
function clearWith(msg, fn) { undoSnap = snapshot(); fn(); renderAll(); toast(msg, true); }
$("#toast-undo").addEventListener("click", () => { if (undoSnap) { restore(undoSnap); undoSnap = null; renderAll(); } $("#toast").hidden = true; });
$("#toast-x").addEventListener("click", () => { $("#toast").hidden = true; });
const TEST_KEYS = ["testType", "steadyMin", "workload", "totalTps", "growth", "levels", "stepHoldMin", "licenceVusers"];
const TUNE_KEYS = ["headroomPct", "pacingStyle", "randomPct", "maxStartRate"];
const CLEAR = {
  test: () => TEST_KEYS.forEach((k) => { state.scenario[k] = DEFAULT_SCENARIO[k]; }),
  tune: () => TUNE_KEYS.forEach((k) => { state.scenario[k] = DEFAULT_SCENARIO[k]; }),
  scripts: () => {
    state.groups = []; seq = 0;
    $("#import-note").hidden = true; $("#dropzone").classList.remove("compact");
    foldSection($("#scripts-card"), false);
  },
  lg: () => {
    state.pools = [defaultPool()]; poolSeq = 1;
    state.groups.forEach((g) => { g.pool = "p1"; });
    Object.keys(DEFAULT_PROTOS).forEach((k) => { PROTOS[k] = JSON.parse(JSON.stringify(DEFAULT_PROTOS[k])); });
    $("#cal-v").value = 200; $("#cal-cpu").value = 45; $("#cal-mem").value = 60;
    state.scenario.lgFill = "fill";
  },
};
const CLEAR_MSG = { test: "Test settings put back to the defaults.", tune: "Fine tuning put back to the defaults.",
  scripts: "All scripts removed.", lg: "Load generators put back to the defaults." };
document.querySelectorAll("[data-clear]").forEach((b) => b.addEventListener("click", () => clearWith(CLEAR_MSG[b.dataset.clear], CLEAR[b.dataset.clear])));
$("#btn-reset-all").addEventListener("click", () => clearWith("Everything cleared — add your scripts to start again.", () => {
  CLEAR.test(); CLEAR.tune(); CLEAR.lg(); CLEAR.scripts();
  state.common = { rtAvg: null, tps: null, tpsMode: "each" };
  if ($(".wm-page").classList.contains("in-hidden")) setLayout("");
}));

try { view(localStorage.getItem("wm-view") !== "detail"); } catch (e) { view(true); }
renderTest(); renderScripts(); renderPools(); renderProtoTable(); cal(); calc();

/* ---------- team settings (config/workload-settings.json on the server) ----------
   Read once when the page opens; never cached by the browser, so an edit reaches everyone on the next page load.
   Applied to the starting values only: the machine types, the default pool, the schedule defaults and the protocol
   assumptions; the plan on the page (if the user already started) keeps what it has. */
function applyTeam(s) {
  TEAM.extra = s.loadGenerators.extraMachines; TEAM.limitPct = s.loadGenerators.busyLimitPct; TEAM.updated = s.updated;
  LG_TYPES.splice(0, LG_TYPES.length - 1, ...s.machineTypes.map(toLgType));
  const sc = { headroomPct: s.schedule.headroomPct, maxStartRate: s.schedule.maxStartRatePerSecond, minGroup: s.loadGenerators.smallestGroup, fastLoopRps: s.loadGenerators.fastLoopRequestsPerSecond };
  const untouched = (k) => state.scenario[k] === DEFAULT_SCENARIO[k] || state.scenario[k] == null;
  Object.entries(sc).forEach(([k, v]) => { if (untouched(k)) state.scenario[k] = v; DEFAULT_SCENARIO[k] = v; });
  Object.entries(s.protocols).forEach(([k, v]) => {
    const was = DEFAULT_PROTOS[k]; if (!was) return;
    const now = { memMb: v.memoryMbPerVuser, perCore: v.vusersPerCore };
    if (PROTOS[k].memMb === was.memMb && PROTOS[k].perCore === was.perCore) Object.assign(PROTOS[k], now);
    Object.assign(DEFAULT_PROTOS[k], now);
  });
  // the starting pool, when the user has not changed it yet
  const p = state.pools[0], d = WorkloadSettings.DEFAULTS.machineTypes[0];
  if (state.pools.length === 1 && p.kind === d.id && p.cores === d.cores && p.ramGb === d.memoryGb && p.webPerLg === d.webVusersPerLg && p.apiPerLg === d.apiVusersPerLg && p.extra === 1 && !p.available) state.pools = [defaultPool()];
  else state.pools.forEach((x) => { x.limitPct = TEAM.limitPct; });
}
function teamNote() {
  const el = $("#settings-note"); if (!el) return;
  const bad = TEAM.problems;
  el.innerHTML = (TEAM.read ? `Machine types and starting figures: the team settings${TEAM.updated ? ` (updated ${esc(TEAM.updated)})` : ""}.` : "Machine types and starting figures: the built-in values (the team settings could not be read).")
    + (bad.length ? ` <span style="color:var(--ds-warn)">${bad.length} value${bad.length === 1 ? "" : "s"} in the settings file ${bad.length === 1 ? "was" : "were"} not used: ${bad.map(esc).join("; ")}.</span>` : "");
  document.querySelectorAll(".wm-limit").forEach((x) => { x.textContent = TEAM.limitPct; });
}
fetch("wm/config/workload-settings.json", { cache: "no-store" })
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
  .then((json) => { const { settings, problems } = WorkloadSettings.read(json); TEAM.problems = problems; TEAM.read = true; applyTeam(settings); })
  .catch(() => { TEAM.read = false; })
  .then(() => { teamNote(); renderAll(); });
