/* Workload Modeller — the model on screen: state, the inputs (test, scripts as cards or a table, load generators), the
   results (summary, tiles, chart, phases, checks, details). Loaded first; excel.js and page.js follow and share its
   globals (classic scripts, one page). The numbers all come from engine/workload-engine.js (window.WorkloadEngine). */
"use strict";
const E = window.WorkloadEngine;
const $ = (s, el) => (el || document).querySelector(s);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = (x, d) => (Number.isFinite(x) ? x.toLocaleString("en-GB", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }) : "—");
const fmtS = (x) => (Number.isFinite(x) ? (Math.abs(x - Math.round(x)) < 0.05 ? fmt(x) : fmt(x, 1)) + " s" : "—");
const PROTOS = JSON.parse(JSON.stringify(E.PROTOCOLS));

// The test types: a line on each card, a drawing of its load over time, and "About this test" — what it is, why teams
// run it, how much load and how long (common practice; the team's own figures come from the team settings, testTypes)
const TEST_HELP = {
  load: "The expected peak load, held steady.", soak: "Normal load for hours — finds leaks and slow drift.",
  stress: "Above the expected peak — how it copes.", capacity: "Steps up until the SLA breaks.",
  spike: "A sudden burst, then back to normal.",
};
function testInfo(k) {
  const st = TEAM.types.stress, lvl = st.levelPct, hrs = (m) => (m % 60 ? fmt(m) + " min" : fmt(m / 60) + (m === 60 ? " hour" : " hours"));
  const team = (s) => `<b>Your team:</b> ${s}`;
  const spk = spikeLevels();
  return ({
    load: { name: "Load test", why: "Proves the system meets its response-time targets at the busiest hour you expect: the baseline every other test is compared with.",
      load: "100% of the expected peak. For next year's peak, raise it with the Growth factor (1.2 = 20% more).", len: `1 – 2 hours at full load is common. ${team(hrs(TEAM.types.load.fullLoadMin) + " at full load")}`,
      look: "Response times within the SLA · errors under 1% · CPU and memory steady, not climbing", when: "Before every release, and after a change to the system or its data" },
    soak: { name: "Soak test (endurance)", why: "Finds what only time shows: memory leaks, connection pools that run dry, logs and disks that fill, response times that drift.",
      load: "70 – 100% of the expected peak, held steady", len: `8 hours is common; 4 – 24 hours (overnight or over a weekend). ${team(hrs(TEAM.types.soak.fullLoadMin) + " at full load")}`,
      look: "Response times and memory as flat in the last hour as in the first · no errors creeping in · no restarts", when: "Before a major release, after a memory or platform change" },
    stress: { name: "Stress test", why: "Shows how the system behaves above the expected peak: whether it still meets the SLA, where it slows down, how it fails, and whether it recovers.",
      load: `Above the expected peak: 125 – 200%. Today's peak plus growth and a margin, held — or in steps to see where it gives. Growth factor raises the target itself; the stress level goes above that target.`,
      len: `1 – 2 hours (steps: 10 – 15 min each). ${team(st.shape === "hold" ? `${fmt(lvl)}% of the peak for ${hrs(st.holdMin)}` : "in steps up to 150%")}`,
      look: "The SLA at the stress level · errors are clear, not hangs or time-outs · the system recovers when the load drops", when: "Before a busy season or a launch; after an architecture change" },
    capacity: { name: "Capacity test (breakpoint)", why: "Finds the most the system can take within its SLA: how much headroom you have, and which part gives first.",
      load: "Steps of 20% from 100% until the SLA breaks — often 200% or more", len: "10 – 15 min per step, until the limit is found",
      look: "The last step that still meets the SLA = the capacity · the first resource at its limit (CPU, memory, pools, database)", when: "Sizing hardware or cloud machines; planning for growth" },
    spike: { name: "Spike test", why: "Checks a sudden burst — a sale, a mail-out, a market opening: does the system cope, scale out in time, and come back to normal?",
      load: `Normal load (${fmt(spk.base)}%), a jump to ${fmt(spk.peak)}% within a minute, then back. Common practice: 50% → 200 – 300%.`, len: "The burst 5 – 15 min; 30 – 60 min in all",
      look: "Errors during the jump · how long it takes to recover · auto-scaling reacts in time", when: "Before campaigns and events; when auto-scaling is set up or changed" },
  })[k];
}
// the spike's levels: the ones on the page when the spike is chosen, else the team's
function spikeLevels() {
  const sc = state.scenario, t = TEAM.types.spike;
  return sc.testType === "spike" ? { base: sc.spikeBase || t.basePct, peak: sc.spikePeak || t.peakPct } : { base: t.basePct, peak: t.peakPct };
}
// the load over time as points (x 0 – 100, y = % of the target); stress follows the team's shape
function testShape(k) {
  const st = TEAM.types.stress;
  return ({
    load: [[0, 0], [12, 100], [88, 100], [100, 0]], soak: [[0, 0], [5, 90], [95, 90], [100, 0]],
    stress: st.shape === "hold" ? [[0, 0], [14, Math.min(200, st.levelPct)], [90, Math.min(200, st.levelPct)], [100, 0]]
      : [[0, 0], [8, 50], [22, 50], [26, 75], [40, 75], [44, 100], [58, 100], [62, 125], [76, 125], [80, 150], [94, 150], [100, 0]],
    capacity: [[0, 0], [6, 100], [18, 100], [22, 120], [34, 120], [38, 140], [50, 140], [54, 160], [66, 160], [70, 180], [82, 180], [86, 200], [96, 200], [100, 0]],
    spike: ((b, p) => [[0, 0], [10, b], [38, b], [40, p], [58, p], [60, b], [88, b], [100, 0]])(Math.min(200, spikeLevels().base), Math.min(200, spikeLevels().peak)),
  })[k];
}
const shapePath = (pts, W, H) => pts.map(([x, y], i) => (i ? "L" : "M") + (x * W / 100).toFixed(1) + " " + (H - 2 - y * (H - 4) / 200).toFixed(1)).join(" ");
function shapeSvg(k, cls) {
  return `<svg class="${cls}" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true"><line class="wm-tt-100" x1="0" x2="100" y1="${(30 - 100 * 28 / 200).toFixed(1)}" y2="${(30 - 100 * 28 / 200).toFixed(1)}" vector-effect="non-scaling-stroke"/><path d="${shapePath(testShape(k), 100, 32)}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
let aboutOpen = true; try { aboutOpen = localStorage.getItem("wm-about") !== "hidden"; } catch (e) { /* private window */ }
function renderAbout() {
  const k = state.scenario.testType, n = testInfo(k), el = $("#tt-about"); if (!el || !n) return;
  if (!aboutOpen) { el.innerHTML = `<button type="button" class="wm-about-show" data-about="1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>What is a ${esc(n.name.replace(/ \(.*/, "").toLowerCase())}, and why run it?</button>`; return; }
  const W = 300, H = 96, y100 = (H - 14 - 100 * (H - 18) / 200).toFixed(1), pts = shapePath(testShape(k), W, H - 12);
  el.innerHTML = `<div class="wm-about" role="region" aria-labelledby="tt-about-h">
    <div class="wm-about-h"><svg class="wm-about-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg><b id="tt-about-h">${esc(n.name)}</b><span>what it is, and why teams run it</span><button type="button" class="ds-btn ds-btn-sm ds-btn-ghost" data-about="0" title="Hide these notes (remembered)">Hide</button></div>
    <div class="wm-about-b">
      <figure class="wm-about-fig"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="The load over time"><line x1="0" x2="${W}" y1="${y100}" y2="${y100}" class="wm-about-100"/><path d="${pts} L${W} ${H - 12} L0 ${H - 12} Z" class="wm-about-fill"/><path d="${pts}" class="wm-about-line"/></svg>
        <figcaption><span>start</span><span>time →</span><span>end</span></figcaption><p class="wm-about-key"><i></i>100% = the expected peak</p></figure>
      <dl class="wm-about-facts"><div><dt>Why</dt><dd>${n.why}</dd></div><div><dt>Load</dt><dd>${n.load}</dd></div><div><dt>How long</dt><dd>${n.len}</dd></div><div><dt>What to look at</dt><dd>${n.look}</dd></div><div><dt>When</dt><dd>${n.when}</dd></div></dl>
    </div></div>`;
}
$("#tt-about").addEventListener("click", (e) => {
  const b = e.target.closest("[data-about]"); if (!b) return;
  aboutOpen = b.dataset.about === "1"; try { localStorage.setItem("wm-about", aboutOpen ? "open" : "hidden"); } catch (e2) { /* private window */ }
  renderAbout(); const f = $("#tt-about [data-about]"); if (f) f.focus();
});
const WL_HELP = {
  "basic-scenario": "One schedule for all scripts.", "basic-group": "Each script its own ramp; all reach full load together.",
  "real-world": "A list of steps — start, hold, start more, stop.", goal: "LRE adds Vusers until it reaches the TPS.",
};
const METHODS = [
  ["tps", "TPS — transactions per second"], ["volume", "Transactions per hour"], ["share", "Share of the total TPS (%)"],
  ["vusers", "Number of Vusers"], ["vusers_tps", "Vusers and TPS — check they fit"], ["iterations", "Number of iterations (data rows)"],
];
const METHODS_OLD = { tps: "It must reach a TPS", volume: "It must handle a volume per hour", share: "A share of the scenario's total TPS",
  vusers: "I know how many Vusers", vusers_tps: "I know Vusers and TPS — check them", iterations: "It must run N iterations (data rows)" };   // earlier names, still read from Excel
const PACING = [["auto", "Let the tool choose (recommended)"], ["fixed", "Fixed — every N seconds"], ["random", "Random — between two values"], ["asap", "As soon as the previous iteration ends"], ["after", "After the previous iteration + a delay"]];
const THINK = [["recorded", "As recorded"], ["ignore", "Ignore"], ["multiply", "Multiply recorded"], ["random", "Random % of recorded"]];
const RTSRC = [["sla", "SLA from the requirement"], ["baseline", "Measured in a baseline run"], ["recording", "From the recording"], ["estimate", "My estimate"]];

// webPerLg / apiPerLg: the team's rule of thumb — Vusers one machine carries for a script of web pages / of API calls
// (AWS c6a.4xlarge: twice the on-premise figures — twice the CPUs, the same memory, which the tool keeps checking).
// The list comes from the team settings (config/workload-settings.json, read by engine/settings.js when the page opens);
// until then, and for anything the file gets wrong, the built-in values. "Another machine" is always last.
const TEAM = { extra: 1, limitPct: 70, updated: null, problems: [], read: false, types: JSON.parse(JSON.stringify(WorkloadSettings.DEFAULTS.testTypes)) };
const toLgType = (t) => ({ id: t.id, label: t.label, where: t.location, cores: t.cores, ramGb: t.memoryGb, webPerLg: t.webVusersPerLg, apiPerLg: t.apiVusersPerLg, note: WorkloadSettings.note(t) });
const LG_TYPES = WorkloadSettings.DEFAULTS.machineTypes.map(toLgType).concat([{ id: "custom", label: "Another machine (enter its size)", where: "Own machines" }]);
const lgType = (p) => LG_TYPES.find((t) => t.id === p.kind) || LG_TYPES[LG_TYPES.length - 1];
let seq = 0;
const newScript = (o) => Object.assign({ id: "g" + (++seq), name: "Script " + seq, protocol: "web", pool: "p1", method: "tps", targetTps: 5, txPerIter: 3, thinkPerIter: 10, rtAvg: null, rtSource: "sla", thinkMode: "recorded", pacing: { mode: "auto" } }, o || {});
const state = {
  scenario: { testType: "load", steadyMin: 60, workload: "basic-group", totalTps: 10, growth: 1, headroomPct: 25, pacingStyle: "fixed", randomPct: 15, maxStartRate: 2, levels: null, stepHoldMin: null, licenceVusers: null, lgFill: "fill",
    rampMode: "auto", startPer: null, startEvery: null, stopPer: null, stopEvery: null },
  groups: [newScript({ name: "Payments", targetTps: 10, txPerIter: 4, thinkPerIter: 15, rtAvg: 1, sample: true })],
  pools: [defaultPool()],
  common: { rtAvg: null, tps: null, tpsMode: "each" },     // used by every script that has no value of its own
};
const DEFAULT_SCENARIO = JSON.parse(JSON.stringify(state.scenario));
const DEFAULT_PROTOS = JSON.parse(JSON.stringify(E.PROTOCOLS));
/* The load-generator machines the team uses. Choosing one fills its size; changing a size makes it "Another machine"
   (for a project with its own load generators). Edit this list when the machines change. cores = the CPUs the system
   shows (on AWS the vCPUs), memory in GB; disk is not used in the sizing. */
function defaultPool() {
  const t = LG_TYPES[0];
  return { id: "p1", name: t.where, kind: t.id, cores: t.cores, ramGb: t.ramGb, webPerLg: t.webPerLg, apiPerLg: t.apiPerLg, available: null, extra: TEAM.extra, limitPct: TEAM.limitPct, capacity: {} };
}
// the kind of script, for the Vusers-per-machine rule: read from the script, or set on the card
const KINDS = [["auto", "From the script"], ["web", "Web pages"], ["api", "API calls"]];
function kindHelp(g) {
  if (g.protocol === "truclient") return "TruClient: CPU and memory decide";
  if (g.kind === "web" || g.kind === "api") return "set by you — counts as " + (g.kind === "web" ? "web pages" : "API calls");
  if (g.pageShare == null) return "not read from a script — counts as web pages (the cautious side)";
  const n = g.requestsPerIter, p = g.pages != null ? g.pages : Math.round(g.pageShare * (n || 0));
  return n ? `${fmt(p)} page${p === 1 ? "" : "s"}, ${fmt(n - p)} API call${n - p === 1 ? "" : "s"} per iteration` : `${fmt(g.pageShare * 100)}% pages`;
}

/* ---------- inputs: the test ---------- */
function renderTestCards() {
  const sc = state.scenario;
  $("#test-types").innerHTML = Object.entries(E.TEST_TYPES).map(([k, t]) =>
    `<button class="wm-choice" data-tt="${k}" aria-pressed="${sc.testType === k}"><b>${esc(t.label.replace(/ \(.*/, ""))}</b>${shapeSvg(k, "wm-tt-shape")}<span>${TEST_HELP[k]}</span></button>`).join("");
}
function renderTest() {
  const sc = state.scenario;
  renderTestCards();
  renderAbout();
  const rec = E.TEST_TYPES[sc.testType].workload;
  $("#sc-workload").innerHTML = Object.entries(E.WORKLOADS).map(([k, l]) => `<option value="${k}"${k === sc.workload ? " selected" : ""}>${l}${k === rec ? " (recommended)" : ""}</option>`).join("");
  $("#wl-help").textContent = WL_HELP[sc.workload];
  $("#sc-steady").value = sc.steadyMin; $("#sc-total").value = sc.totalTps ?? ""; $("#sc-growth").value = sc.growth;
  $("#sc-licence").value = sc.licenceVusers ?? ""; $("#sc-headroom").value = sc.headroomPct; $("#sc-style").value = sc.pacingStyle;
  $("#sc-random").value = sc.randomPct; $("#sc-rate").value = sc.maxStartRate;
  const tt = E.TEST_TYPES[sc.testType];
  // the fields of the chosen test: full load (load, soak — or any test on a basic schedule); stress: one level held, or
  // steps; capacity: steps; spike: how long normal load is held
  const stepped = !!(tt.levels || tt.base), held = sc.testType === "stress" && sc.levels && sc.levels.length === 1;
  $("#sc-levels").value = (sc.levels || tt.levels || []).join(", ");
  $("#f-steady").style.display = !stepped || sc.workload !== "real-world" ? "" : "none";
  $("#f-shape").style.display = sc.testType === "stress" ? "" : "none";
  document.querySelectorAll("#sc-shape [data-shape]").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.shape === "hold") === !!held)));
  $("#f-level").style.display = held ? "" : "none";
  if (held && document.activeElement !== $("#sc-level")) $("#sc-level").value = sc.levels[0];
  $("#f-levels").style.display = tt.levels && !held ? "" : "none";
  $("#f-hold").style.display = stepped ? "" : "none";
  $("#f-spike").style.display = tt.base ? "" : "none";
  if (tt.base) {
    const s = spikeLevels();
    if (document.activeElement !== $("#sc-spike-base")) $("#sc-spike-base").value = s.base;
    if (document.activeElement !== $("#sc-spike-peak")) $("#sc-spike-peak").value = s.peak;
  }
  $("#hold-label").textContent = held ? `Hold at ${fmt(sc.levels[0])}%` : tt.base ? "Hold normal load" : "Hold at each step";
  $("#hold-help").textContent = held ? "how long the level is held, after the ramp-up" : "empty: the tool chooses (10 min, or 5 pacings when longer)";
  $("#sc-hold").value = sc.stepHoldMin ?? "";
  $("#steady-help").textContent = stepped ? "a basic schedule only ramps to 100% and holds it — choose “Real-world schedule” for this test" : "how long full load is held, after the ramp-up";
  $("#f-total").style.display = state.groups.some((g) => g.method === "share") ? "" : "none";
  const own = sc.rampMode === "own";
  $("#sc-ramp").value = own ? "own" : "auto";
  $("#f-ramp-own").hidden = !own || sc.workload === "goal";
  $("#sc-ramp").disabled = sc.workload === "goal";
  $("#ramp-help").textContent = sc.workload === "goal" ? "LRE adds Vusers itself in a goal-oriented test" : own ? "used for every start and stop (a spike's sudden jump stays the tool's)" : "spread over about three pacings, never faster than the start rate";
  $("#sc-start-per").value = sc.startPer ?? ""; $("#sc-start-every").value = sc.startEvery ?? "";
  $("#sc-stop-per").value = sc.stopPer ?? ""; $("#sc-stop-every").value = sc.stopEvery ?? "";
}
$("#test-types").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tt]"); if (!b) return;
  const sc = state.scenario; sc.testType = b.dataset.tt;
  const tt = E.TEST_TYPES[sc.testType]; sc.workload = tt.workload; sc.levels = null; sc.stepHoldMin = null;
  // the team's starting figures (team settings, testTypes): full load for load / soak; the stress level and its hold
  sc.steadyMin = (TEAM.types[sc.testType] && TEAM.types[sc.testType].fullLoadMin) || tt.steadyMin;
  if (sc.testType === "stress") stressShape(TEAM.types.stress.shape);
  sc.spikeBase = sc.testType === "spike" ? TEAM.types.spike.basePct : null; sc.spikePeak = sc.testType === "spike" ? TEAM.types.spike.peakPct : null;
  $("#spike-err").hidden = true;
  renderTest(); calc();
});
const bindNum = (id, key, nullable) => $(id).addEventListener("input", (e) => { const v = parseFloat(e.target.value); state.scenario[key] = Number.isFinite(v) ? v : (nullable ? null : 0); calc(); });
bindNum("#sc-steady", "steadyMin"); bindNum("#sc-total", "totalTps", true); bindNum("#sc-growth", "growth"); bindNum("#sc-licence", "licenceVusers", true);
bindNum("#sc-start-per", "startPer", true); bindNum("#sc-start-every", "startEvery", true); bindNum("#sc-stop-per", "stopPer", true); bindNum("#sc-stop-every", "stopEvery", true);
// "My own" ramp: starts from the ramp the tool worked out, so the user only changes what differs from the LRE test
$("#sc-ramp").addEventListener("change", (e) => {
  const sc = state.scenario; sc.rampMode = e.target.value;
  if (sc.rampMode === "own" && sc.startEvery == null) {
    const r = last && (last.actions || (last.groupPlans && last.groupPlans[0] && last.groupPlans[0].actions) || []).find((a) => a.type === "start");
    sc.startPer = r ? (r.all ? r.count : r.perStep) : 1; sc.startEvery = r ? (r.all ? 0 : r.every) : 5;
  }
  renderTest(); calc();
});
bindNum("#sc-headroom", "headroomPct"); bindNum("#sc-random", "randomPct"); bindNum("#sc-rate", "maxStartRate"); bindNum("#sc-hold", "stepHoldMin", true);
$("#sc-workload").addEventListener("change", (e) => { state.scenario.workload = e.target.value; $("#wl-help").textContent = WL_HELP[e.target.value]; renderTest(); calc(); });
$("#sc-style").addEventListener("change", (e) => { state.scenario.pacingStyle = e.target.value; calc(); });
// stress: one level held (the team's level and hold) or the tool's steps (50 … 150%, each held 10 min or 5 pacings)
function stressShape(shape) {
  const sc = state.scenario, st = TEAM.types.stress;
  if (shape === "hold") { sc.levels = [st.levelPct]; sc.stepHoldMin = st.holdMin; } else { sc.levels = null; sc.stepHoldMin = null; }
}
// spike: normal load 1 – 100% of the target, the burst above it (up to 1000%); a pair that cannot be used is said and not used
function spikeInput() {
  const b = parseFloat($("#sc-spike-base").value), p = parseFloat($("#sc-spike-peak").value), err = $("#spike-err");
  const bad = !(b >= 1 && b <= 100) ? "Normal load: 1 to 100% of the target." : !(p > b && p <= 1000) ? "The burst must be above normal load (up to 1000%)." : "";
  err.hidden = !bad; err.textContent = bad;
  [$("#sc-spike-base"), $("#sc-spike-peak")].forEach((x) => x.toggleAttribute("aria-invalid", !!bad));
  if (bad) return;
  state.scenario.spikeBase = b; state.scenario.spikePeak = p; renderAbout(); renderTestCards(); calc();
}
$("#sc-spike-base").addEventListener("input", spikeInput); $("#sc-spike-peak").addEventListener("input", spikeInput);
$("#sc-shape").addEventListener("click", (e) => { const b = e.target.closest("[data-shape]"); if (!b) return; stressShape(b.dataset.shape); renderTest(); calc(); });
$("#sc-level").addEventListener("input", (e) => { const v = parseFloat(e.target.value); if (v > 0) { state.scenario.levels = [v]; $("#hold-label").textContent = `Hold at ${fmt(v)}%`; calc(); } });
$("#sc-levels").addEventListener("input", (e) => { const l = e.target.value.split(/[,; ]+/).map(Number).filter((x) => x > 0); state.scenario.levels = l.length ? l : null; calc(); });

/* ---------- inputs: scripts ---------- */
const opt = (list, v) => list.map(([k, l]) => `<option value="${k}"${k === v ? " selected" : ""}>${esc(l)}</option>`).join("");
// help: text about this script (shown in every card), or gh("…") — what the field means, the same in every card: shown
// in the first open card only, and in any other card while its field has the focus (page.js markHelps)
const gh = (t) => ({ gh: t });
function num(label, key, val, unit, help, cls, extra) {
  return `<label class="wm-f ${cls || ""}">${label}<div class="${unit ? "wm-unit" : ""}"><input class="ds-field" type="number" data-k="${key}" value="${val ?? ""}" min="0" step="any" ${extra || ""}>${unit ? `<span>${unit}</span>` : ""}</div>${help ? (help.gh ? `<small class="wm-gh">${help.gh}</small>` : `<small>${help}</small>`) : ""}</label>`;
}
// Transactions per iteration: the script's own names in a window (long names — addresses — never fill the card)
const txOf = (g) => (g.txList && g.txList.length ? g.txList : (g.txNames || []).map((n) => ({ name: n })));
function txHelp(g) {
  const n = txOf(g).length;
  if (!n) return gh("that count for the TPS");
  return `${n} in the script <button type="button" class="wm-goto" data-txlist="${esc(g.id)}" title="Every transaction of one iteration, in order">see them all</button>`;
}
function openTxList(id) {
  const g = state.groups.find((x) => String(x.id) === String(id)); if (!g) return;
  const list = txOf(g), har = list.some((x) => x.requests != null), times = {};
  list.forEach((x) => { times[x.name] = (times[x.name] || 0) + 1; });
  const out = g.txOut || {}, outRows = [["In vuser_init (once per Vuser)", out.init], ["In vuser_end (once per Vuser)", out.end], ["Holding other transactions (nested)", out.nested]]
    .filter((r) => r[1] && r[1].length);
  const same = Number(g.txPerIter) === list.length;
  let d = document.getElementById("wm-tx-dlg");
  if (!d) {
    d = document.createElement("dialog"); d.id = "wm-tx-dlg"; d.className = "wm-dlg"; d.setAttribute("aria-labelledby", "wm-tx-h");
    document.body.appendChild(d);
    let downOut = false;
    const outside = (e) => { const r = d.getBoundingClientRect(); return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom; };
    d.addEventListener("pointerdown", (e) => { downOut = e.target === d && outside(e); });
    d.addEventListener("click", (e) => {
      if (e.target.closest("[data-close]") || (downOut && e.target === d && outside(e))) { d.close(); return; }
      if (e.target.closest("[data-copy]")) {
        const names = (d._names || []).join("\n");
        Promise.resolve(navigator.clipboard && navigator.clipboard.writeText(names)).then(() => { if (typeof toast === "function") toast("The transaction names are copied — one per line, ready to paste into Excel."); })
          .catch(() => { if (typeof toast === "function") toast("Could not copy: select the names in the list instead."); });
      }
    });
  }
  d._names = list.map((x) => x.name);
  d.innerHTML = `<div class="wm-dlg-h"><h2 id="wm-tx-h">Transactions — ${esc(g.name)}</h2></div>
    <div class="wm-dlg-b"><p class="wm-dlg-lead">${list.length} per iteration, in order${same ? " — the count the TPS uses." : ` — the Transactions per iteration box says ${esc(g.txPerIter)}: the TPS uses the box.`}${har ? " From the recording: its bookmarks (START / END), else its pages, else a pause over 1.5 s. Response time = the time the requests ran; a quiet gap over 1.5 s is the user (think time)." : ""}</p>
    <div class="wm-tw"><table class="ds-table wm-tx-t"><thead><tr><th class="ds-num">#</th><th>Transaction</th>${har ? '<th class="ds-num">Requests</th><th class="ds-num">Response time</th>' : ""}</tr></thead><tbody>${
      list.map((x, i) => `<tr><td class="ds-num">${i + 1}</td><td class="wm-txn">${esc(x.name)}${times[x.name] > 1 ? ` <span class="wm-muted">· ${times[x.name]} times per iteration</span>` : ""}</td>${
        har ? `<td class="ds-num">${fmt(x.requests)}</td><td class="ds-num">${x.time < 10 ? fmt(x.time, 2) + " s" : fmtS(x.time)}</td>` : ""}</tr>`).join("")}</tbody></table></div>
    ${outRows.length ? `<p class="wm-sub">Not counted <span class="wm-subh">— not part of an iteration's TPS</span></p><ul class="wm-tx-out">${outRows.map((r) => `<li><b>${r[0]}:</b> ${r[1].map(esc).join(", ")}</li>`).join("")}</ul>` : ""}</div>
    <div class="wm-dlg-f"><button type="button" class="ds-btn ds-btn-sm" data-copy>Copy names</button><button type="button" class="ds-btn ds-btn-sm ds-btn-primary" data-close>Close</button></div>`;
  d.showModal();
  d.querySelector("[data-close]").focus();
}
document.addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest("[data-txlist]");
  if (b) { e.preventDefault(); openTxList(b.dataset.txlist); }   // (inside a label: never focus its box instead)
});
// the replay settings act on the think time above: greyed out while there is none
const noThink = (g) => !(g.thinkPerIter > 0);
// Multiply / Random: the think time LRE will really wait, so a factor is never read as seconds (27 s × 3 = 81 s)
function thinkResult(g) {
  const t = g.thinkPerIter, f = g.thinkFactor ?? 1, lo = g.thinkMinPct ?? 50, hi = g.thinkMaxPct ?? 150;
  if (!(t > 0)) return g.thinkMode === "multiply" ? "a factor, not seconds — enter the think time above" : "of the recorded think time";
  const cut = g.thinkLimit > 0 ? `, before the ${fmtS(g.thinkLimit)} limit` : "";
  if (g.thinkMode === "multiply") return Number.isFinite(f) ? `a factor, not seconds: ${fmtS(t)} × ${Number.isInteger(f) ? fmt(f) : fmt(f, 2)} = ${fmtS(t * f)} think per iteration${cut}` : "a factor, not seconds";
  return Number.isFinite(lo) && Number.isFinite(hi) ? `${fmtS(t)} becomes ${fmtS(t * lo / 100)} – ${fmtS(t * hi / 100)}, about ${fmtS(t * (lo + hi) / 200)} on average${cut}` : "of the recorded think time";
}
const thinkHelp = (g) => (noThink(g) ? "no think time above — nothing to replay" : "LRE's Think Time setting — what LRE does with the think time above; “As recorded” waits it in full");
function scriptCard(g) {
  const m = g.method, p = g.pacing || {};
  const target = {
    tps: num("Target TPS", "targetTps", g.targetTps, "TPS", gh("transactions per second this script must reach"), "", `placeholder="${commonTps(g) != null ? fmt(commonTps(g), 2) + " — common" : ""}"`),
    volume: num("Volume per hour", "volumePerHour", g.volumePerHour, "/ hour", gh("business transactions in the peak hour")),
    share: num("Share of the scenario TPS", "sharePct", g.sharePct, "%", gh("of the total in step 1")),
    vusers: num("Vusers", "vusers", g.vusers, "", gh("the number of users you will run")),
    vusers_tps: num("Vusers", "vusers", g.vusers, "", gh("given to you")) + num("Target TPS", "targetTps", g.targetTps, "TPS", gh("given to you")),
    iterations: num("Iterations in full load", "iterations", g.iterations, "", gh("e.g. one per data row")),
  }[m];
  const pacing = m === "vusers_tps" ? `<p class="wm-muted wm-f wide" style="margin:0">Pacing follows from the Vusers and the TPS — the checks say whether it is possible.</p>` :
    `<label class="wm-f">Pacing<select class="ds-field" data-k="pacing.mode">${opt(PACING, p.mode || "auto")}</select></label>` +
    (p.mode === "fixed" ? num("Every", "pacing.fixed", p.fixed, "s") : "") +
    (p.mode === "random" ? num("Shortest", "pacing.min", p.min, "s") + num("Longest", "pacing.max", p.max, "s") : "") +
    (p.mode === "after" ? num("Delay", "pacing.delay", p.delay, "s") : "");
  const pools = state.pools.map((x) => [x.id, x.name]);
  return `<div class="wm-script${g.folded ? " is-folded" : ""}" data-id="${g.id}">
    <div class="wm-script-head" data-head>
      <button class="wm-chev" data-fold-card aria-expanded="${!g.folded}" aria-controls="body-${g.id}" aria-label="Show or hide ${esc(g.name)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
      <input class="ds-field wm-name-in" type="text" data-k="name" value="${esc(g.name)}" aria-label="Script name" title="${esc(g.name)}">
      <b class="wm-name" title="${esc(g.name)} · ${esc(PROTOS[g.protocol].label)}${g.source ? " · from " + esc(g.source) : ""}">${esc(g.name)}</b>
      <span class="ds-chip" title="${esc(PROTOS[g.protocol].label)}">${esc(({ web: "Web HTTP", other: "Other" })[g.protocol] || PROTOS[g.protocol].label)}</span>
      ${g.source ? `<span class="wm-src" title="Filled from ${esc(g.source)}">from ${esc(g.source)}</span>` : ""}
      <div class="wm-facts" id="facts-${g.id}"></div>
      <span class="wm-gres ds-chip" id="res-${g.id}">—</span>
      ${`<button class="wm-x" data-del aria-label="Remove ${esc(g.name)}" title="Remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`}
    </div>
    <div class="wm-script-body" id="body-${g.id}">
      <div class="wm-plan" id="plan-${g.id}"></div>
      <div><p class="wm-sub">Target</p><div class="wm-grid">
        <label class="wm-f">Target type<select class="ds-field" data-k="method">${opt(METHODS, m)}</select></label>${target}
        <label class="wm-f">Protocol<select class="ds-field" data-k="protocol">${opt(Object.entries(PROTOS).map(([k, v]) => [k, v.label]), g.protocol)}</select></label>
        ${pools.length > 1 ? `<label class="wm-f">Runs on<select class="ds-field" data-k="pool">${opt(pools, g.pool)}</select></label>` : ""}
        ${g.protocol === "truclient" ? "" : `<label class="wm-f">Kind of script<select class="ds-field" data-k="kind">${opt(KINDS, g.kind || "auto")}</select><small>${esc(kindHelp(g))} — for the load generators</small></label>`}
        ${num("Vusers per machine", "perLg", g.perLg, "", gh("your figure for this script, e.g. from a past run — replaces the rule"), "adv")}
      </div></div>
      <div><p class="wm-sub">One iteration <span class="wm-subh">— one run through the script</span></p><div class="wm-grid">
        ${num("Transactions per iteration", "txPerIter", g.txPerIter, "", txHelp(g))}
        ${num("Think time — total per iteration", "thinkPerIter", g.thinkPerIter, "s", gh("all think times of one iteration added up, not per transaction — e.g. 9 × lr_think_time(3) = 27 s"))}
        ${num("Fixed waits — total per iteration", "waitPerIter", g.waitPerIter, "s", gh("all sleep / load.sleep of one iteration added up — not think time: LRE always waits them in full"), g.waitPerIter > 0 ? "" : "adv")}
        ${num("Response time — per transaction", "rtAvg", g.rtAvg, "s", `<span id="rth-${g.id}">average per transaction</span>`, "", `placeholder="${state.common.rtAvg > 0 ? fmt(state.common.rtAvg, 2) + " — common" : "unknown"}"`)}
        <label class="wm-f adv">Response time from<select class="ds-field" data-k="rtSource">${opt(RTSRC, g.rtSource)}</select></label>
        ${num("90th percentile", "rt90", g.rt90, "s", gh("optional — for the worst case"), "adv")}
        ${num("Requests", "requestsPerIter", g.requestsPerIter, "", gh("per iteration — for hits per second"), "adv")}
        ${num("Data rows available", "dataRows", g.dataRows, "", gh("warns when the test needs more"), "adv")}
      </div></div>
      <div><p class="wm-sub">Replay in LRE <span class="wm-subh">— runtime settings</span></p><div class="wm-grid">${pacing}
        <label class="wm-f">Think time in LRE<select class="ds-field" data-k="thinkMode" data-thinkdep${noThink(g) ? " disabled" : ""}>${opt(THINK, g.thinkMode)}</select><small data-thinkhelp${noThink(g) ? "" : ' class="wm-gh"'}>${thinkHelp(g)}</small></label>
        ${g.thinkMode === "multiply" ? num("By", "thinkFactor", g.thinkFactor ?? 1, "×", `<span data-thinkres>${thinkResult(g)}</span>`) : ""}
        ${g.thinkMode === "random" ? num("From", "thinkMinPct", g.thinkMinPct ?? 50, "%", gh("of the recorded think time")) + num("To", "thinkMaxPct", g.thinkMaxPct ?? 150, "%", `<span data-thinkres>${thinkResult(g)}</span>`) : ""}
        ${g.thinkMode === "ignore" ? "" : num("Limit each think time to", "thinkLimit", g.thinkLimit, "s", gh("only if you tick LRE's “Limit think time to” — else leave empty"), g.thinkLimit > 0 ? "" : "adv", `data-thinkdep${noThink(g) ? " disabled" : ""}`)}
        ${g.thinkMode === "ignore" ? "" : num("How many think times", "thinkPauses", g.thinkPauses, "", gh("in one iteration, so the limit can cut each one — read from the script")).replace('<label class="wm-f ', `<label data-pauses${g.thinkLimit > 0 ? "" : " hidden"} class="wm-f `)}
      </div></div>
    </div></div>`;
}
function renderScripts() {
  const tv = tableView() && state.groups.length;
  $("#scripts").innerHTML = !state.groups.length ? `<p class="wm-empty">No scripts yet — drop your script ZIPs or HAR files above, or add one by hand.</p>`
    : tv ? "" : state.groups.map(scriptCard).join("");
  $("#tv").hidden = !tv;
  $("#tv").innerHTML = tv ? tvTable() : "";
  if (tv) tvWidth();
  $("#sview").querySelectorAll("[data-v]").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.v === "table") === tableView())));
  $("#scripts-bar").hidden = !state.groups.length;
  listChrome();
}
const STRUCT = new Set(["method", "pacing.mode", "thinkMode", "pool", "protocol", "kind"]);
function setKey(g, k, v) { if (k.startsWith("pacing.")) { g.pacing = g.pacing || {}; g.pacing[k.slice(7)] = v; } else g[k] = v; }
$("#scripts-list").addEventListener("input", (e) => {
  const el = e.target, k = el.dataset.k; if (!k) return;
  const g = state.groups.find((x) => x.id === el.closest("[data-id]").dataset.id);
  let v = el.value;
  if (el.type === "number") { v = parseFloat(v); if (!Number.isFinite(v)) v = null; }
  setKey(g, k, v); g.sample = false;
  if (k === "name") { el.title = v; const b = el.closest("[data-id]").querySelector(".wm-name"); if (b) { b.textContent = v; b.title = v; } }   // a long name: in full on hover
  // the number of think times matters only with a limit: shown while one is set (no redraw, the focus stays)
  if (k === "thinkPerIter") { const c = el.closest("[data-id]"); c.querySelectorAll("[data-thinkdep]").forEach((x) => { x.disabled = noThink(g); }); const h = c.querySelector("[data-thinkhelp]"); if (h) { h.textContent = thinkHelp(g); h.classList.toggle("wm-gh", !noThink(g)); } }
  if (["thinkPerIter", "thinkFactor", "thinkMinPct", "thinkMaxPct", "thinkLimit"].includes(k)) { const r = el.closest("[data-id]").querySelector("[data-thinkres]"); if (r) r.textContent = thinkResult(g); }
  if (k === "thinkLimit") { const f = el.closest("[data-id]").querySelector("[data-pauses]"); if (f) f.hidden = !(v > 0); }
  if (STRUCT.has(k)) { if (tableView()) tvRedraw(g, k); else renderScripts(); renderTest(); renderPools(); calc(); } else calcSoon();
});
$("#scripts").addEventListener("click", (e) => {
  const head = e.target.closest("[data-head]");
  if (head && !e.target.closest("[data-del], input, select, textarea, a") && (e.target.closest("[data-fold-card]") || !e.target.closest("button"))) {
    const g = state.groups.find((x) => x.id === head.closest("[data-id]").dataset.id);
    foldCard(g, !g.folded, { only: true });
    return;
  }
  const fx = e.target.closest("[data-fix]");
  if (fx) {
    const g = state.groups.find((x) => x.id === fx.closest("[data-id]").dataset.id), sets = JSON.parse(fx.dataset.fix);
    clearWith(`${g.name}: ${Object.entries(sets).map(([k, v]) => (k === "vusers" ? `${v} Vusers` : `pacing ${v} s`)).join(", ")}.`, () => { Object.entries(sets).forEach(([k, v]) => setKey(g, k, v)); g.sample = false; });
    return;
  }
  if (!e.target.closest("[data-del]")) return;
  const id = e.target.closest("[data-id]").dataset.id, g = state.groups.find((x) => x.id === id);
  clearWith(`Removed “${g.name}”.`, () => { state.groups = state.groups.filter((x) => x.id !== id); });
});
$("#btn-add").addEventListener("click", () => {
  state.groups.forEach((g) => { g.folded = true; }); const g = newScript({ pool: state.pools[0].id }); state.groups.push(g); renderScripts(); calc();
  const f = tableView() && $(`#tv tr[data-id="${g.id}"] [data-k="name"]`); if (f) { f.scrollIntoView({ block: "nearest" }); f.focus(); f.select(); }
});

/* ---------- the scripts as a table: one line per script, edited like a spreadsheet ----------
   Same state, same setKey + calc path as the cards. The rare fields are in the script's full card, opened under its row. */
const PACE_SHORT = { auto: "Tool chooses", fixed: "Fixed", random: "Random", asap: "No pacing", after: "After + delay" };
const THINK_SHORT = { recorded: "As recorded", ignore: "Ignore", multiply: "Multiply", random: "Random %" };
const TGT = { tps: ["targetTps", "TPS"], volume: ["volumePerHour", "/ h"], share: ["sharePct", "%"], vusers: ["vusers", "Vu"], iterations: ["iterations", "it."] };
let sview = null; try { sview = localStorage.getItem("wm-sview"); } catch (e) { /* private window */ }
// before the user chooses: cards for a few scripts, the table from 8
const tableView = () => (sview || (state.groups.length >= 8 ? "table" : "cards")) === "table";
let tvOpen = null;   // the script whose full card is open under its row (one at a time)
const sopt = (list, v, short) => list.map(([k, l]) => `<option value="${k}"${k === v ? " selected" : ""} title="${esc(l)}">${esc(short[k] || l)}</option>`).join("");
function tvNum(g, k, v, unit, label, ph) {
  return `<div class="wm-tu${unit ? "" : " nu"}"><input class="ds-field" type="number" data-k="${k}" value="${v ?? ""}" min="0" step="any" aria-label="${esc(label)} — ${esc(g.name)}"${ph ? ` placeholder="${esc(ph)}"` : ""}>${unit ? `<span>${unit}</span>` : ""}</div>`;
}
const tvSel = (g, k, list, v, short, label) => `<select class="ds-field" data-k="${k}" aria-label="${esc(label)} — ${esc(g.name)}">${sopt(list, v, short)}</select>`;
function tvRow(g) {
  const p = g.pacing || {}, pm = p.mode || "auto", m = g.method, open = tvOpen === g.id, ct = commonTps(g);
  const target = m === "vusers_tps" ? tvNum(g, "vusers", g.vusers, "Vu", "Vusers") + tvNum(g, "targetTps", g.targetTps, "TPS", "Target TPS")
    : tvNum(g, TGT[m][0], g[TGT[m][0]], TGT[m][1], "Target", ct != null ? fmt(ct, 2) + " — common" : "");
  const pace = m === "vusers_tps" ? `<span class="wm-na" title="Pacing follows from the Vusers and the TPS">follows</span>`
    : tvSel(g, "pacing.mode", PACING, pm, PACE_SHORT, "Pacing")
      + (pm === "fixed" ? tvNum(g, "pacing.fixed", p.fixed, "s", "Pacing every") : "")
      + (pm === "random" ? tvNum(g, "pacing.min", p.min, "s", "Shortest pacing") + tvNum(g, "pacing.max", p.max, "s", "Longest pacing") : "")
      + (pm === "after" ? tvNum(g, "pacing.delay", p.delay, "s", "Delay after the iteration") : "");
  const think = tvSel(g, "thinkMode", THINK, g.thinkMode, THINK_SHORT, "Think time at replay")
    + (g.thinkMode === "multiply" ? tvNum(g, "thinkFactor", g.thinkFactor ?? 1, "×", "Multiply think time by") : "")
    + (g.thinkMode === "random" ? tvNum(g, "thinkMinPct", g.thinkMinPct ?? 50, "%", "Random from") + tvNum(g, "thinkMaxPct", g.thinkMaxPct ?? 150, "%", "Random to") : "");
  const rtPh = state.common.rtAvg > 0 ? fmt(state.common.rtAvg, 2) + " — common" : "";
  const X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  return `<tr data-id="${g.id}"${open ? ' class="is-open"' : ""}>
    <td class="c-name"><div class="wm-tn"><button class="wm-chev" data-open aria-expanded="${open}" title="All fields of this script" aria-label="All fields of ${esc(g.name)}">${CHEV}</button><span class="wm-dot" id="tv-s-${g.id}" role="img" aria-label="status"></span><input class="ds-field" type="text" data-k="name" value="${esc(g.name)}" aria-label="Script name" title="${esc(g.name)}${g.source ? " · from " + esc(g.source) : ""}"></div></td>
    <td>${tvSel(g, "method", METHODS, m, METHOD_SHORT, "Target type")}</td>
    <td><div class="wm-tc">${target}</div></td>
    <td>${tvNum(g, "txPerIter", g.txPerIter, "", "Transactions per iteration")}</td>
    <td>${tvNum(g, "thinkPerIter", g.thinkPerIter, "s", "Think time per iteration")}</td>
    <td>${tvNum(g, "rtAvg", g.rtAvg, "s", "Response time", rtPh)}</td>
    <td><div class="wm-tc">${pace}</div></td>
    <td><div class="wm-tc">${think}</div></td>
    <td class="num" id="tv-v-${g.id}">—</td><td class="num" id="tv-t-${g.id}">—</td>
    <td><button class="wm-x" data-del aria-label="Remove ${esc(g.name)}" title="Remove">${X}</button></td></tr>`
    + (open ? `<tr class="wm-tv-card" data-card-of="${g.id}"><td colspan="11"><div class="wm-tv-cardin">${scriptCard(Object.assign({}, g, { folded: false }))}</div></td></tr>` : "");
}
function tvTable() {
  return `<table class="wm-tt"><thead><tr><th class="c-name">Script</th><th>Target type</th><th>Target</th><th title="Transactions per iteration">Transactions / iteration</th>
    <th title="All think times of one iteration added up — not per transaction">Think time (total)</th><th title="Average response time of one transaction">Response time (per tx)</th><th>Pacing</th><th>Think time at replay</th>
    <th class="num" title="Worked out">Vusers</th><th class="num" title="Worked out">TPS</th><th><span class="wm-vh">Remove</span></th></tr></thead><tbody>${state.groups.map(tvRow).join("")}</tbody></table>`;
}
/* Table view wider than its column with the results beside it: the results fold to their strip by themselves, so no
   box of the table is only reachable by scrolling sideways. Not remembered (Cards and the next visit are as before);
   opened again by the user, they stay open until the view changes; back to Cards, what was folded here opens again. */
const resAuto = { folded: false, declined: false };
const tvWidth = () => {
  const tv = $("#tv"); if (!tv) return;
  if (!tv.hidden) tv.style.setProperty("--tvw", (tv.clientWidth - 2) + "px");
  const page = $(".wm-page"), over = !tv.hidden && tv.scrollWidth > tv.clientWidth + 2;
  if (over && !resAuto.declined && !page.classList.contains("res-hidden") && !page.classList.contains("in-hidden")) {
    const rc = $("#results-col").getBoundingClientRect(), tr = tv.getBoundingClientRect();
    if (rc.width > 0 && rc.left >= tr.right - 1) {   // the results beside the table (not under it, as on narrow screens)
      resAuto.folded = true; setLayout("res-hidden", null, false);
      if (typeof toast === "function") toast("Results folded to the strip on the right, so the whole table fits — click the strip to see them.");
      return;
    }
  }
  $("#tv-more").hidden = !over;   // still wider than the window with the results folded (small screens): the hint stays, without its link
  $("#tv-wide-or").hidden = page.classList.contains("res-hidden");
};
$("#tv-wide").addEventListener("click", () => { setLayout("res-hidden"); tvWidth(); const f = $("#tv [data-k]"); if (f) f.focus({ preventScroll: true }); });
window.addEventListener("resize", tvWidth);
// the results fold and open with an animation: the table's box grows over a few frames — measured whenever its size changes
// (measured only at the start, the hint "More columns to the right" stayed although the table fitted)
if (typeof ResizeObserver === "function") new ResizeObserver(() => tvWidth()).observe($("#tv"));
const tvRows = () => [...document.querySelectorAll("#tv tr[data-id]")].filter((r) => !r.hidden);
// a choice that changes the row's boxes: redraw that row only (and its open card), the focus stays on the same field
function tvRedraw(g, k) {
  const tr = $(`#tv tr[data-id="${g.id}"]`); if (!tr) { renderScripts(); return; }
  const inCard = !!(document.activeElement && document.activeElement.closest && document.activeElement.closest(".wm-tv-card"));
  const old = $(`#tv tr[data-card-of="${g.id}"]`); if (old) old.remove();
  tr.insertAdjacentHTML("afterend", tvRow(g)); tr.remove();
  tvWidth();
  if (!k) return;
  const scope = $(inCard ? `#tv tr[data-card-of="${g.id}"]` : `#tv tr[data-id="${g.id}"]`);
  const f = scope && scope.querySelector(`[data-k="${k}"]`); if (f) f.focus();
}
function setSView(v) {
  sview = v; try { localStorage.setItem("wm-sview", v); } catch (e) { /* private window */ }
  // back to Cards: the results the table folded by itself open again; a new choice of Table may fold them again
  if (v !== "table" && resAuto.folded && $(".wm-page").classList.contains("res-hidden")) setLayout("", null, false);
  resAuto.folded = false; resAuto.declined = false;
  renderScripts(); calc();
}
$("#sview").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) setSView(b.dataset.v); });
$("#tv").addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-id]"); if (!tr) return;
  const g = state.groups.find((x) => x.id === tr.dataset.id);
  if (e.target.closest("[data-open]")) {
    const was = tvOpen; tvOpen = was === g.id ? null : g.id;
    const wg = was && was !== g.id && state.groups.find((x) => x.id === was); if (wg) tvRedraw(wg);
    tvRedraw(g); calc();
    const card = $(`#tv tr[data-card-of="${g.id}"]`);
    if (card) { card.scrollIntoView({ block: "nearest" }); const f = card.querySelector(".wm-script-body .ds-field"); if (f) f.focus({ preventScroll: true }); }
    else { const b = $(`#tv tr[data-id="${g.id}"] [data-open]`); if (b) b.focus(); }
    return;
  }
  if (e.target.closest("[data-del]")) clearWith(`Removed “${g.name}”.`, () => { state.groups = state.groups.filter((x) => x.id !== g.id); });
});
// ↑ / ↓ and Enter (Shift+Enter up) move to the same column in the next row shown — number boxes do not step their value
$("#tv").addEventListener("keydown", (e) => {
  const el = e.target; if (!el.matches || !el.matches("input[data-k], select[data-k]") || el.closest(".wm-tv-card") || e.altKey || e.ctrlKey || e.metaKey) return;
  const sel = el.tagName === "SELECT";
  const dir = e.key === "Enter" ? (e.shiftKey ? -1 : 1) : !sel && e.key === "ArrowDown" ? 1 : !sel && e.key === "ArrowUp" ? -1 : 0;
  if (!dir) return;
  e.preventDefault();
  const rows = tvRows(), ci = el.closest("td").cellIndex, k = el.dataset.k;
  for (let i = rows.indexOf(el.closest("tr")) + dir; i >= 0 && i < rows.length; i += dir) {
    const f = rows[i].querySelector(`[data-k="${k}"]`) || rows[i].cells[ci].querySelector("input, select");
    if (f) { f.focus(); f.scrollIntoView({ block: "nearest" }); try { if (f.select) f.select(); } catch (x) { /* number box */ } return; }
  }
});
// paste a block copied from Excel: down the rows shown, across the boxes to the right; an empty cell keeps the value; one Undo
const tvNumber = (s) => {
  s = String(s).replace(/[\s\u00a0]/g, "");
  s = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) ? s.split(",").join("") : s.replace(",", ".");
  const v = parseFloat(s); return Number.isFinite(v) && v >= 0 ? v : null;
};
const tvChoice = (sel, s) => {
  const n = xlNorm(s), o = [...sel.options];
  const hit = o.find((x) => xlNorm(x.textContent) === n || xlNorm(x.title) === n || xlNorm(x.value) === n)
    || (n.length >= 3 && o.find((x) => xlNorm(x.textContent).startsWith(n) || xlNorm(x.title).startsWith(n)));
  return hit ? hit.value : null;
};
$("#tv").addEventListener("paste", (e) => {
  const el = e.target; if (!el.matches || !el.matches("input[data-k]") || el.closest(".wm-tv-card")) return;
  const text = ((e.clipboardData || window.clipboardData).getData("text") || "").replace(/\r/g, "").replace(/\n+$/, "");
  const lines = text.split("\n");
  if (lines.length < 2 && !lines[0].includes("\t")) return;   // one value: the box takes it as usual
  e.preventDefault();
  const rows = tvRows(), start = rows.indexOf(el.closest("tr")), ci = el.closest("td").cellIndex, k0 = el.dataset.k, id0 = el.closest("tr").dataset.id;
  const boxes = (id) => { const f = [...$(`#tv tr[data-id="${id}"]`).cells].slice(ci).flatMap((td) => [...td.querySelectorAll("[data-k]")]);
    const at = f.findIndex((x) => x.dataset.k === k0); return at > 0 ? f.slice(at) : f; };
  const snap = snapshot(), touched = new Set(); let n = 0, unused = 0;
  // value by value: a choice that adds boxes (Pacing "Fixed" → its seconds) redraws the row before the next value
  lines.forEach((line, j) => {
    const cells = line.split("\t"), tr = rows[start + j];
    if (!tr) { unused += cells.filter((c) => c.trim()).length; return; }
    const g = state.groups.find((x) => x.id === tr.dataset.id);
    let f = boxes(g.id);
    cells.forEach((c, i) => {
      if (!c.trim()) return;
      const box = f[i]; if (!box) { unused++; return; }
      const v = box.tagName === "SELECT" ? tvChoice(box, c) : box.type === "number" ? tvNumber(c) : c.trim();
      if (v == null) { unused++; return; }
      setKey(g, box.dataset.k, v); g.sample = false; n++; touched.add(g.id);
      if (STRUCT.has(box.dataset.k)) { tvRedraw(g); f = boxes(g.id); }
    });
  });
  if (!n) { toast("Nothing pasted — no value fits these columns."); return; }
  undoSnap = snap; renderAll();
  toast(`Pasted ${n} value${n === 1 ? "" : "s"} into ${touched.size} script${touched.size === 1 ? "" : "s"}${unused ? ` — ${unused} not used (no matching row or column, or not a valid value)` : ""}.`, true);
  const back = $(`#tv tr[data-id="${id0}"] [data-k="${k0}"]`); if (back) back.focus();
});

/* ---------- inputs: load generators ---------- */
function poolCard(p, i) {
  const used = [...new Set(state.groups.filter((g) => (g.pool || state.pools[0].id) === p.id).map((g) => g.protocol))];
  return `<div class="wm-script${p.folded ? " is-folded" : ""}" data-pool="${p.id}">
    <div class="wm-script-head"><button class="wm-chev" data-fold-pool aria-expanded="${!p.folded}" aria-label="Show or hide ${esc(p.name)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
      <input class="ds-field" type="text" data-p="name" value="${esc(p.name)}" aria-label="Pool name">
      <select class="ds-field" data-p="kind" style="flex:0 1 250px" aria-label="Machine type">${opt(LG_TYPES.map((t) => [t.id, t.label]), lgType(p).id)}</select>
      ${state.pools.length > 1 ? `<button class="wm-x" data-pdel aria-label="Remove ${esc(p.name)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>` : ""}</div>
    <div class="wm-facts" data-fold-pool>${poolFacts(p)}</div>
    <div class="wm-script-body">
      <div><p class="wm-sub">Team rule <span class="wm-subh">— Vusers one machine carries</span></p><div class="wm-grid">
        ${pnum("Web pages", "webPerLg", p.webPerLg, "Vusers", "for a script of web pages")}
        ${pnum("API calls", "apiPerLg", p.apiPerLg, "Vusers", "for a script of API calls; a script of both counts in proportion")}
        ${used.map((k) => pnum(`From a past run — ${PROTOS[k].label}`, "cap." + k, (p.capacity || {})[k], "Vusers", "replaces the rule and the machine size (best)", "adv")).join("")}
      </div></div>
      <div><p class="wm-sub">Machine <span class="wm-subh">— its size, checked too</span></p><div class="wm-grid">
        ${pnum("CPU cores", "cores", p.cores, "", lgType(p).note ? lgType(p).label + ": " + lgType(p).note : "the CPUs the system shows (on AWS: vCPUs)")}
        ${pnum("Memory", "ramGb", p.ramGb, "GB")}
      </div></div>
      <div><p class="wm-sub">How many <span class="wm-subh">— in this pool</span></p><div class="wm-grid">
        ${pnum("Extra machines", "extra", p.extra ?? 0, "", "added and given Vusers too — every machine runs further below its limit")}
        ${pnum("Machines available", "available", p.available, "", "empty: no limit")}
      </div></div>
    </div></div>`;
}
const pnum = (label, key, val, unit, help, cls) => `<label class="wm-f ${cls || ""}">${label}<div class="${unit ? "wm-unit" : ""}"><input class="ds-field" type="number" data-p="${key}" value="${val ?? ""}" min="0" step="any">${unit ? `<span>${unit}</span>` : ""}</div>${help ? `<small>${help}</small>` : ""}</label>`;
// fill each machine (a script that does not fit whole runs as two groups in LRE) or one group per script
const LG_FILL = [["fill", "Fill each machine", "The fewest machines: each is filled up; a script that does not fit whole runs as two groups in LRE (LRE setup lists them)."],
  ["whole", "One group per script", "The simplest LRE setup: a script's Vusers are split evenly over its machines, so some machines may be half full."]];
function renderPools() {
  const v = state.scenario.lgFill || "fill";
  $("#lg-fill").innerHTML = LG_FILL.map(([k, l, h]) => `<button class="wm-choice" data-fill="${k}" aria-pressed="${v === k}"><b>${l}</b><span>${h}</span></button>`).join("");
  $("#pools").innerHTML = state.pools.map(poolCard).join("");
}
$("#lg-fill").addEventListener("click", (e) => { const b = e.target.closest("[data-fill]"); if (!b) return; state.scenario.lgFill = b.dataset.fill; renderPools(); calc(); });
$("#pools").addEventListener("input", (e) => {
  const k = e.target.dataset.p; if (!k) return;
  const p = state.pools.find((x) => x.id === e.target.closest("[data-pool]").dataset.pool);
  let v = e.target.value; if (e.target.type === "number") { v = parseFloat(v); if (!Number.isFinite(v)) v = null; }
  if (k.startsWith("cap.")) { p.capacity = p.capacity || {}; p.capacity[k.slice(4)] = v; } else p[k] = v;
  if (k === "kind") {
    // a machine type fills its size; the pool keeps a name the user gave it
    const t = lgType(p), was = LG_TYPES.map((x) => x.where);
    if (t.cores) { p.cores = t.cores; p.ramGb = t.ramGb; }
    // the type's rule figures replace empty ones and the previous type's own (not figures the user typed)
    if (t.webPerLg) ["webPerLg", "apiPerLg"].forEach((f) => { if (p[f] == null || LG_TYPES.some((x) => x[f] === p[f])) p[f] = t[f]; });
    if (!p.name || was.includes(p.name)) p.name = t.where;
    renderPools(); renderScripts();
  } else {
    // a size that is not the machine type's any more: "Another machine"
    const t = lgType(p), card = e.target.closest("[data-pool]");
    if (t.cores && (k === "cores" || k === "ramGb") && (p.cores !== t.cores || p.ramGb !== t.ramGb)) { p.kind = "custom"; card.querySelector('[data-p="kind"]').value = "custom"; }
    const fx = card.querySelector(".wm-facts"); if (fx) fx.innerHTML = poolFacts(p);
  }
  if (k === "name") renderScripts();
  calc();
});
$("#pools").addEventListener("click", (e) => {
  const f = e.target.closest("[data-fold-pool]");
  if (f) { const p = state.pools.find((x) => x.id === f.closest("[data-pool]").dataset.pool); p.folded = !p.folded; renderPools(); return; }
  if (!e.target.closest("[data-pdel]")) return;
  const id = e.target.closest("[data-pool]").dataset.pool;
  state.pools = state.pools.filter((x) => x.id !== id);
  state.groups.forEach((g) => { if (g.pool === id) g.pool = state.pools[0].id; });
  renderPools(); renderScripts(); calc();
});
let poolSeq = 1;
$("#btn-pool").addEventListener("click", () => { const t = LG_TYPES[1]; state.pools.push({ id: "p" + (++poolSeq), name: t.where, kind: t.id, cores: t.cores, ramGb: t.ramGb, webPerLg: t.webPerLg, apiPerLg: t.apiPerLg, extra: 0, capacity: {} }); renderPools(); renderScripts(); calc(); });
function renderProtoTable() {
  $("#proto-table").innerHTML = `<thead><tr><th>Protocol</th><th class="ds-num">Memory per Vuser (MB)</th><th class="ds-num">Vusers per CPU core</th></tr></thead><tbody>` +
    Object.entries(PROTOS).map(([k, p]) => `<tr><td>${esc(p.label)}</td><td class="ds-num"><input class="ds-field" style="width:90px;height:32px" type="number" data-proto="${k}.memMb" value="${p.memMb}" aria-label="${esc(p.label)} — memory per Vuser (MB)"></td><td class="ds-num"><input class="ds-field" style="width:90px;height:32px" type="number" data-proto="${k}.perCore" value="${p.perCore}" aria-label="${esc(p.label)} — Vusers per CPU core"></td></tr>`).join("") + "</tbody>";
}
$("#proto-table").addEventListener("input", (e) => { const [k, f] = e.target.dataset.proto.split("."); const v = parseFloat(e.target.value); if (v > 0) { PROTOS[k][f] = v; calc(); } });
function cal() {
  const c = E.capacityFromRun(+$("#cal-v").value, +$("#cal-cpu").value, +$("#cal-mem").value, TEAM.limitPct);
  const peak = Math.max(+$("#cal-cpu").value || 0, +$("#cal-mem").value || 0);
  $("#cal-out").textContent = c ? fmt(c) : "—";
  // the figure grows the run in a straight line up to 70%: from a lightly loaded machine that is a long guess
  $("#cal-note").textContent = c && peak < 35 ? `The machine was only ${fmt(peak)}% busy, so this is a rough guess — a run nearer ${TEAM.limitPct}% gives a safer figure.` : "";
}
["#cal-v", "#cal-cpu", "#cal-mem"].forEach((s) => $(s).addEventListener("input", cal));

/* ---------- results ---------- */
// "Not possible": why, in plain words, and the ways out — with a button where one box changes it (Undo in the toast)
function overrunHtml(r, g) {
  const o = r.overrun, fixed = g && (g.pacing || {}).mode === "fixed", byV = g && g.method === "vusers";
  const parts = [`${o.tx} × ${fmtS(o.rt / o.tx)} response`];
  if (o.think > 0) parts.push(`${fmtS(o.think)} think`);
  if (o.wait > 0) parts.push(`${fmtS(o.wait)} fixed waits`);
  const btn = (label, sets) => `<button type="button" class="ds-btn ds-btn-sm" data-fix='${esc(JSON.stringify(sets))}'>${esc(label)}</button>`;
  const pace = o.kind === "random" ? "shortest pacing" : "pacing";
  const ways = [];
  ways.push(`<li><b>Lengthen the ${pace}</b> to ${fmtS(o.pacingSafe)} — the iteration (${fmtS(o.iter)}) plus ${o.headroomPct}% room for slower responses${o.pacingSafe > o.pacingFit ? `; ${fmtS(o.pacingFit)} is the bare minimum` : ""}. ${o.sizedByTps ? `The tool then uses ${fmt(o.vusersAtSafe)} Vusers for the same ${fmt(o.askTps, 2)} TPS.` : `With ${fmt(r.vusers)} Vusers that gives <b>${fmt(o.tpsAtSafe, 2)} TPS</b>.`}${fixed ? " " + btn(`Use ${o.pacingSafe} s`, { "pacing.fixed": o.pacingSafe }) : ""}</li>`);
  if (byV) ways.push(`<li><b>Keep ${fmt(o.askTps, 2)} TPS:</b> ${fmt(o.vusersAtSafe)} Vusers with a ${fmtS(o.pacingSafe)} ${pace}.${fixed ? " " + btn(`Use ${o.vusersAtSafe} Vusers, ${o.pacingSafe} s`, { vusers: o.vusersAtSafe, "pacing.fixed": o.pacingSafe }) : ""}</li>`);
  ways.push(`<li><b>Or make one iteration shorter:</b> ${o.rtFit != null ? `the response time must stay under ${fmtS(o.rtFit)} per transaction, or ` : ""}${o.wait > 0 ? "less think time or fixed waits — " : o.think > 0 ? "less think time — " : ""}check the figures are per iteration (think time is the total, not per transaction).</li>`);
  return `<b>Not possible as it stands.</b> One iteration takes <b>${fmtS(o.iter)}</b> (${parts.join(" + ")}), but the ${pace} starts a new one every <b>${fmtS(o.pacing)}</b>. LRE starts each iteration late, so you would get about <b>${fmt(o.reachTps, 2)} TPS</b>, not the ${fmt(o.askTps, 2)} planned.
    <span class="wm-plan-fix">Change one of these:</span><ul class="wm-plan-ways">${ways.join("")}</ul>`;
}
let last = null;
function calc() {
  const res = resolved();
  const r = E.model({ scenario: state.scenario, groups: res.groups, pools: state.pools, protocols: PROTOS });
  lastResolved = res.groups;
  if (typeof workingNow === "function") workingNow();
  if (res.check) r.checks.unshift(res.check);
  commonUi(res);
  last = r;
  // per-card result chip
  r.groups.forEach((g) => {
    const el = $("#res-" + g.id); if (!el) return;
    el.className = "wm-gres ds-chip " + (g.status === "ok" ? "ok" : g.status === "infeasible" ? "bad" : "warn");
    rtHelp(g);
    el.textContent = ({ "needs-input": "needs input", estimate: "estimate", infeasible: "not possible" })[g.status] || "ready";
    const pl = $("#plan-" + g.id);
    if (pl) pl.innerHTML = g.status === "needs-input" ? `<b>Needs:</b> ${esc(((g.checks.find((c) => c.code.startsWith("needs-")) || {}).text || "more input").replace(g.name + ": ", ""))}`
      : g.status === "estimate" ? `<b>Plan:</b> ${fmt(g.vusers)} Vusers — the TPS depends on the response time (see “How it is worked out”).`
      : g.status === "infeasible" && g.overrun ? overrunHtml(g, state.groups.find((x) => x.id === g.id))
      : `<b>Plan:</b> ${fmt(g.vusers)} Vusers, a new iteration every ${g.pacing.kind === "random" ? fmtS(g.pacing.min) + " – " + fmtS(g.pacing.max) : fmtS(g.pacing.mean)}, ${fmt(g.tps, 2)} TPS${g.status === "infeasible" ? " — not possible as it stands (see Checks)" : ""}.`;
    if (pl) pl.classList.toggle("wm-plan-bad", g.status === "infeasible");
  });
  r.groups.forEach((g, i) => { const el = $("#facts-" + g.id); if (el) el.innerHTML = facts(res.groups[i], g); });
  r.groups.forEach((g) => {   // the table: status, worked-out Vusers and TPS, the box still needed in amber
    const s = $("#tv-s-" + g.id); if (!s) return;
    const need = g.status === "needs-input" ? g.checks.find((c) => c.code.startsWith("needs-")) : null;
    const st = ({ "needs-input": "Needs input", estimate: "Estimate", infeasible: "Not possible" })[g.status] || "Ready";
    s.className = "wm-dot " + (g.status === "ok" ? "ok" : g.status === "infeasible" ? "bad" : "warn");
    s.setAttribute("aria-label", st);
    s.title = st + (need ? " — " + need.text : g.status === "infeasible" ? (g.overrun ? ` — one iteration takes ${fmtS(g.overrun.iter)} but the pacing is ${fmtS(g.overrun.pacing)}: open the card for the fixes` : " — see Checks") : "");
    $("#tv-v-" + g.id).textContent = need ? "—" : fmt(g.vusers);
    $("#tv-t-" + g.id).textContent = need ? "—" : g.status === "estimate" ? "varies" : fmt(g.tps, g.tps < 10 ? 2 : 1);
    const tr = s.closest("tr");
    tr.querySelectorAll(".wm-need").forEach((x) => x.classList.remove("wm-need"));
    const box = need && need.field && tr.querySelector(`[data-k="${need.field}"]`); if (box) box.classList.add("wm-need");
  });
  sectionSums(r);
  applyFilter();
  const order = { need: 0, bad: 1, warn: 2, info: 3, ok: 4 };
  const checks = r.checks.map((c) => Object.assign({}, c, { level: c.code && c.code.startsWith("needs-") ? "need" : c.level }))
    .sort((a, b) => order[a.level] - order[b.level]);
  // one line instead of a "TPS holds while…" line per script when there are many (the limits are in Details › Per script)
  const budget = checks.filter((c) => c.code === "rt-budget");
  if (budget.length > 5) {
    const firstAt = checks.indexOf(budget[0]);
    checks.splice(0, checks.length, ...checks.filter((c) => c.code !== "rt-budget"));
    checks.splice(Math.min(firstAt, checks.length), 0, { level: budget.some((c) => c.level === "info") ? "info" : "ok", code: "rt-budget-all",
      text: `Response-time limits for ${budget.length} scripts: each script's TPS holds while its average response time stays under its limit — see Details › Per script.` });
  }
  groupNeeds(checks);
  // while the plan is not ready, the list of what to fill in is under Result — here one line points to it (no second copy)
  const needList = checks.filter((c) => c.level === "need");
  const shownChecks = !r.ready && needList.length
    ? [{ level: "need", code: "needs-see-result", text: `${needList.length} thing${needList.length === 1 ? "" : "s"} to fill in — listed under Result, each with “Go there”.` }]
        .concat(checks.filter((c) => c.level !== "need"))
    : checks;
  $("#checks").innerHTML = shownChecks.length ? shownChecks.map((c) => `<li class="${c.level === "need" ? "warn" : c.level}">${c.level === "need" ? "<b>Needs input:</b> " : ""}${esc(c.text)}${goto(c)}${c.many ? showNeed() : ""}</li>`).join("")
    : `<li class="ok">Nothing to report — the plan is consistent.</li>`;
  const bad = checks.filter((c) => c.level === "bad").length, warn = checks.filter((c) => c.level === "warn").length, needIn = checks.filter((c) => c.level === "need").length;
  $("#rail-v").firstChild.textContent = r.ready ? fmt(r.peakVusers) : "—";
  $("#rail-t").firstChild.textContent = r.ready ? fmt(r.totals.tps, r.totals.tps < 100 ? 1 : 0) : "—";
  $("#rail-c").className = "ds-chip " + (bad ? "bad" : needIn || warn ? "warn" : "ok");
  $("#rail-c").textContent = bad ? `${bad} to fix` : needIn ? `${needIn} to fill in` : warn ? `${warn} to see` : "all good";
  const needs = r.groups.filter((g) => g.status === "needs-input").length;
  $("#rail-s").firstChild.textContent = fmt(state.groups.length);
  $("#rail-n").className = "ds-chip " + (!state.groups.length || needs ? "warn" : "ok");
  $("#rail-n").textContent = !state.groups.length ? "add one" : needs ? `${needs} need input` : "ready";
  $("#sum-result").textContent = r.ready ? `— ${fmt(r.peakVusers)} Vusers · ${fmt(r.totals.tps, 2)} TPS · ${r.lgTotal == null ? "?" : fmt(r.lgTotal)} load generators · ${E.hms(r.duration)}` : "— needs input";
  $("#check-count").className = "ds-chip " + (bad ? "bad" : needIn || warn ? "warn" : "ok");
  $("#check-count").textContent = [bad && `${bad} to fix`, needIn && `${needIn} to fill in`, !bad && !needIn && warn && `${warn} to look at`].filter(Boolean).join(" · ") || "all good";

  // the outputs in the top bar look unavailable until the plan is complete (a click then says why)
  ["#btn-xlsx", "#btn-copy"].forEach((s) => {
    const b = $(s); if (!b.dataset.title) b.dataset.title = b.title;     // its own tooltip, kept for when the plan is ready
    b.setAttribute("aria-disabled", String(!r.ready)); b.title = r.ready ? b.dataset.title : "Complete the inputs first — see Checks";
  });
  if (!r.ready) {
    const todo = groupNeeds(r.checks.filter((c) => c.code && (c.code.startsWith("needs-") || c.code === "common-total")).map((c) => Object.assign({}, c)));
    $("#summary").className = "ds-note warn wm-summary";
    $("#summary").innerHTML = `<div class="wm-empty-res"><b>Almost there — the plan appears here when these are filled in:</b><ol>${(todo.length ? todo : r.checks.filter((c) => c.level === "bad"))
      .map((c) => `<li>${esc(c.text)}${goto(c)}${c.many ? showNeed() : ""}</li>`).join("")}</ol></div>`;
    $("#tiles").innerHTML = ""; $("#res-notes").innerHTML = ""; $("#chart").innerHTML = ""; $("#chart").style.display = "none"; $(".wm-legend").style.display = "none"; $("#phbar").innerHTML = ""; $("#phases").innerHTML = ""; $("#lre").textContent = "";
    $("#tab-per").innerHTML = perScript(r); $("#tab-lg").innerHTML = ""; $("#tab-how").innerHTML = how(r);
    $("#setup").innerHTML = `<p class="wm-muted" style="margin:0">The LRE setup appears here when the plan is complete — see Checks.</p>`;
    return;
  }
  $("#chart").style.display = ""; $(".wm-legend").style.display = "";
  $("#summary").className = "ds-note " + (bad ? "bad" : "ok") + " wm-summary";
  // lead with the problem in one line: what is wrong and where the fixes are
  const overGs = r.groups.filter((g) => g.overrun);
  const lead = overGs.length ? overGs.map((g) => `${g.name}: one iteration takes ${fmtS(g.overrun.iter)} but the pacing starts one every ${fmtS(g.overrun.pacing)}, so it reaches ${fmt(g.overrun.reachTps, 2)} TPS, not ${fmt(g.overrun.askTps, 2)}.`).join(" ") + " Its script card shows what to change. " : "The plan has problems to fix (see Checks). ";
  $("#summary").textContent = (bad ? lead + "As it stands: " : "") + r.summary;
  const t = r.totals, range = Math.abs(t.tpsMax - t.tpsMin) > 1e-6;
  const ph = phases(r);
  // Names both a tester and a manager read: "Transactions per second (TPS)". The load at full load first, then one
  // iteration (where think time and response time show), the test, and the totals of the whole test.
  const one = r.groups.length === 1 ? r.groups[0] : null;   // one script: its own figures in the notes
  const T = one ? one.T : null;
  const short = (s) => E.words(Math.round(s));
  const steadyMin = Math.round((r.steadyTo - r.steadyFrom) / 60);
  const over = t.reachTps != null;                          // an iteration longer than its pacing: what LRE will reach
  const tps = over ? t.reachTps : t.tps, ips = over ? t.reachIps : t.ips;
  const perVu = (x) => (t.vusers ? x / t.vusers : 0);
  const n1 = (x) => String(+x.toFixed(x < 10 ? 2 : 1));    // 0.2, 72, 74.5 — no padding zeros
  // one level held above the target (a stress test): what it reaches there too
  const heldAbove = r.peakVusers > t.vusers && (r.actions || []).filter((a) => a.type === "hold").length === 1;
  const overNote = over ? ` — not ${fmt(t.tps, 2)}: an iteration takes longer than the pacing (see Checks)` : "";
  const tiles = [
    ["Virtual users (Vusers)", fmt(r.peakVusers), r.peakVusers > t.vusers ? `${fmt(t.vusers)} at 100%` : `${r.groups.length} script${r.groups.length > 1 ? "s" : ""}`],
    ["Transactions per second (TPS)", fmt(tps, 2), (range && !over ? `${fmt(t.tpsMin, 2)} – ${fmt(t.tpsMax, 2)} (random pacing) · ` : "") + "at full load" + overNote + (heldAbove ? ` · about ${fmt(tps * r.peakVusers / t.vusers, 2)} at the held ${fmt(100 * r.peakVusers / t.vusers)}%` : ""), over],
    ["Transactions per hour (TPH)", fmt(tps * 3600), "at full load · TPS × 3,600", over],
    ["Iterations per hour", ips ? fmt(ips * 3600) : "—", ips ? `at full load, all Vusers · ${n1(perVu(ips * 3600))} per Vuser` : "depends on the response time", over],
  ];
  if (one && one.it && one.it.mean != null) {
    const it = one.it, P = one.pacing && one.pacing.mean, th = it.think.mean;
    const parts = [`${fmt(T)} × ${n1(it.rtMean / T)} s response`].concat(th ? [`${n1(th - (it.think.wait || 0))} s think`] : []).concat(it.think.wait ? [`${n1(it.think.wait)} s fixed waits`] : []);
    const fits = P == null || one.pacing.kind === "asap" || one.pacing.kind === "after" ? "" : it.mean <= P + 1e-9 ? ` · fits in the ${n1(P)} s pacing` : ` · longer than the ${n1(P)} s pacing`;
    tiles.push(["One iteration takes", n1(it.mean) + " s", parts.join(" + ") + fits, P != null && it.mean > P + 1e-9]);
  }
  tiles.push(
    ["Load generators", r.lgTotal == null ? "?" : fmt(r.lgTotal), r.lgTotal == null ? "machine size needed" : r.lg.filter((x) => x.total).map((x) => `${x.pool.name}: ${x.total}${x.extra ? ` (${x.needed} + ${x.extra} extra)` : ""}`).join(" · ")],
    ["Total test duration", E.hms(r.duration), ph.lengthNote],
    [ph.tileLabel === "Steady state" ? "Full load (steady state)" : ph.tileLabel, ph.tileValue, ph.tileNote + (ph.tileLabel === "Steady state" ? " — measure here" : "")],
    ["Total iterations (whole test)", fmt(t.iters.total), `all Vusers · about ${n1(perVu(t.iters.total))} per Vuser · ${fmt(t.iters.steady)} at full load + ${fmt(t.iters.total - t.iters.steady)} while Vusers start and stop`],
    ["Total transactions (whole test)", fmt(t.tx.total), `${T ? fmt(t.iters.total) + " iterations × " + fmt(T) + " · " : ""}test-data rows if each takes one`],
  );
  if (t.hitsPerSec) tiles.push(["Requests per second (hits)", fmt(t.hitsPerSec * (over && t.tps ? tps / t.tps : 1), 1), "at full load"]);
  // how to read them — with this plan's own numbers
  const howLines = [`<b>At full load</b> = while every Vuser runs (the steady state, ${steadyMin ? fmt(steadyMin) + " min" : "the held step"}): the figures to compare with your target and with LRE's results.`];
  if (one && one.pacing && one.pacing.mean && !over) {
    const P = one.pacing.mean;
    howLines.push(`${fmt(one.vusers)} Vusers ÷ ${n1(P)} s pacing = <b>${n1(one.ips)} iterations per second</b> (${fmt(one.ips * 3600)} per hour) → × ${fmt(T)} transactions = <b>${fmt(one.tps, 2)} TPS</b> → × 3,600 = <b>${fmt(one.tps * 3600)} TPH</b>.`);
    howLines.push(`Think time and response time do not change these numbers while one iteration (${n1(one.it.mean)} s) fits in the pacing (${n1(P)} s). They change the iteration time, the Checks and, a little, the test duration (the last iterations finish).`);
  } else if (over) {
    howLines.push(`An iteration takes longer than its pacing, so each Vuser starts its next iteration late: LRE will reach about <b>${fmt(t.reachTps, 2)} TPS</b>, not the ${fmt(t.tps, 2)} the pacing asks for. Checks says how to fix it.`);
  } else {
    howLines.push("For each script: Vusers ÷ pacing = iterations per second → × its transactions per iteration = its TPS; the tiles add the scripts up. Details › Per script shows each one.");
  }
  howLines.push(`<b>Whole test</b> totals include the ramp-up and ramp-down — use them for test data (one row per iteration or per transaction).`);
  $("#res-notes").innerHTML = `<summary>How to read these numbers</summary><ul>${howLines.map((x) => `<li>${x}</li>`).join("")}</ul>`;
  $("#tiles").innerHTML = tiles.map(([k, v, s, warn]) => `<div class="ds-tile${warn ? " wm-tile-warn" : ""}"><div class="ds-tile-label">${k}</div><div class="ds-tile-value">${v}</div><small>${esc(s)}</small></div>`).join("");
  drawChart(r);
  drawPhases(ph, r);
  $("#lre").textContent = r.lre + "\n\n" + ph.analysisText;
  $("#setup").innerHTML = setupTab(r); setupWidth();
  $("#tab-per").innerHTML = perScript(r);
  $("#tab-lg").innerHTML = lgTab(r);
  $("#tab-how").innerHTML = how(r);
}
function perScript(r) {
  const rows = r.groups.map((g) => {
    if (g.status === "needs-input") return `<tr><td>${esc(g.name)}</td><td colspan="6" class="wm-muted">needs input</td></tr>`;
    return `<tr><td>${esc(g.name)}</td><td class="ds-num">${g.it.mean == null ? "?" : fmtS(g.it.mean)}</td>
      <td class="ds-num">${g.tps == null ? "?" : fmt(g.tps, 2)}</td><td class="ds-num">${g.rtBudget > 0 ? fmt(g.rtBudget, 2) + " s" : "—"}</td>
      <td class="ds-num">${g.iters ? fmt(g.iters.rampUp) : "—"}</td><td class="ds-num">${g.iters ? fmt(g.iters.steady) : "—"}</td><td class="ds-num">${g.iters ? fmt(g.iters.rampDown) : "—"}</td></tr>`;
  }).join("");
  return `<div class="wm-tw"><table class="ds-table"><thead><tr><th>Script</th><th class="ds-num">Iteration time</th><th class="ds-num">TPS</th><th class="ds-num">Response-time limit</th><th class="ds-num">Iterations in ramp-up</th><th class="ds-num">Full load</th><th class="ds-num">Ramp-down</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="wm-muted">Response-time limit: the slowest average per transaction that still keeps the pacing (and so the TPS). Vusers, pacing and load generators: see LRE setup.</p>`;
}
/* ---------- LRE setup: one row per LRE group — everything to build the scenario in LRE ----------
   Times are HH:MM:SS, as LRE asks for them; the column names are LRE's own fields. */
const paceShort = (p) => p.kind === "random" ? `random ${fmtS(p.min)} – ${fmtS(p.max)}` : p.kind === "asap" ? "as soon as possible" : p.kind === "after" ? `after the previous + ${fmtS(p.delay)}` : `every ${fmtS(p.mean)}`;
function thinkShort(i) {
  const s = (lastResolved || state.groups)[i] || {}, m = s.thinkMode || "recorded";
  const lim = m !== "ignore" && s.thinkLimit > 0 ? `, at most ${fmt(s.thinkLimit, 1)} s each` : "";
  return (m === "multiply" ? `recorded × ${fmt(s.thinkFactor || 1, 2)}` : m === "random" ? `random ${s.thinkMinPct ?? 50}–${s.thinkMaxPct ?? 150}% of recorded` : m === "ignore" ? "ignored" : "as recorded") + lim;
}
// the load generators of an LRE group, by name only: the Vusers column says how many (LRE splits them evenly)
const lgNames = (lgs) => lgs.map((x) => x.name).join(", ");
const lgsShort = (g) => !g.lgs || !g.lgs.length ? '<span class="wm-muted">machine size needed</span>' : esc(lgNames(g.lgs));
// "3 every 4 s · 00:01:16" for a start or stop action: Vusers per step, the interval, the whole length (HH:MM:SS)
const steps = (a) => !a ? "—" : a.all ? "all at once" : `${a.perStep} every ${fmtS(a.every)} · ${E.hms((Math.ceil(a.count / a.perStep) - 1) * a.every)}`;
function setupTab(r) {
  const byGroup = r.workload === "basic-group";
  const head = ["Script", "Vusers", "Load generators", "Pacing", "Think time"].concat(byGroup ? ["Start (ramp-up)", "Duration (steady state)", "Stop (ramp-down)"] : []);
  // one row per LRE group, by script name: a script that fills one machine and goes on to another has two rows
  const rows = (r.lreGroups || r.groups.map((g, gi) => ({ id: g.id, gi, name: g.name, vusers: g.vusers, lgs: g.lgs, parts: 1 }))).map((x) => {
    const g = r.groups[x.gi];
    const cells = [esc(g.name), fmt(x.vusers), lgsShort(x), esc(paceShort(g.pacing)), esc(thinkShort(x.gi))];
    if (byGroup) {
      const pl = r.groupPlans.find((p) => p.group.id === x.id);
      if (pl) { const [up, hold, down] = pl.actions; cells.push(steps(up), E.hms(hold.dur), steps(down)); }
      else cells.push("—", "—", "—");
    }
    return `<tr>${cells.map((c, k) => `<td${k === 1 ? ' class="ds-num"' : ""}>${c}</td>`).join("")}</tr>`;
  }).join("");
  const more = `<p class="wm-tv-more" id="setup-more" hidden>More columns to the right — scroll the table sideways, or <button class="wm-goto" id="setup-wide">hide the inputs</button> to see them all.</p>`;
  const table = more + `<div class="wm-tw" id="setup-tw"><table class="ds-table wm-setup"><thead><tr>${head.map((h, k) => `<th${k === 1 ? ' class="ds-num"' : ""}>${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
  // one schedule for all groups (by test, real-world, goal): its steps under the table
  let sched = "";
  if (!byGroup && r.workload === "goal") {
    sched = `<p class="wm-muted" style="margin:10px 0 0"><b>Goal-oriented:</b> reach ${fmt(r.totals.tps, 2)} TPS with ${fmt(Math.max(1, Math.ceil(r.totals.vusers * 0.5)))} to ${fmt(Math.ceil(r.totals.vusers * 1.5))} Vusers, then run for ${E.hms(r.scenario.steadyMin * 60)}.</p>`;
  } else if (!byGroup) {
    let at = 0;
    const lines = (r.actions || []).map((a) => {
      const len = a.type === "hold" ? a.dur : a.all ? 0 : (Math.ceil(a.count / a.perStep) - 1) * a.every;
      const what = a.type === "hold" ? `Run for ${E.hms(a.dur)}${a.label ? " — " + esc(a.label) : ""}` : `${a.type === "start" ? "Start" : "Stop"} ${fmt(a.count)} Vusers: ${steps(a)}`;
      const row = `<tr><td>${E.hms(at)}</td><td>${what}</td></tr>`; at += len; return row;
    }).join("");
    sched = `<h4 class="wm-fh" style="margin:14px 0 6px">Schedule — all groups together</h4><div class="wm-tw"><table class="ds-table"><thead><tr><th>From (HH:MM:SS)</th><th>Step</th></tr></thead><tbody>${lines}</tbody></table></div>`;
  }
  const start = byGroup ? ` Every group: <b>Start Group</b> Immediately, <b>Initialize</b> each Vuser just before it runs. All start together and ramp over the same length, so every script reaches full load at ${E.hms(r.firstFull)}; a group whose last step comes a little earlier runs a little longer, so all stop together too (LRE counts the Duration from the end of each group's ramp). The scripts share the start rate — ${fmt(r.scenario.maxStartRate ?? 2)} new Vusers per second in all.` : "";
  const split = (r.lreGroups || []).some((x) => x.parts > 1) ? " A script on two rows fills one machine and goes on to another: add it to the scenario once per row (LRE names the second group itself), with the same runtime settings." : "";
  return table + sched + `<p class="wm-muted" style="margin:10px 0 0">Times are HH:MM:SS.${start} Load generators carry the peak Vusers (the highest step of a stepped test); a group's Vusers are split evenly over its load generators.${split} Stop: gradually — each Vuser finishes its current iteration.</p>`;
}
// the hint above the LRE setup table: only while columns are cut off and the inputs are still shown
function setupWidth() {
  const tw = $("#setup-tw"), hint = $("#setup-more"); if (!tw || !hint) return;
  hint.hidden = !tw.offsetParent || tw.scrollWidth <= tw.clientWidth + 2 || $(".wm-page").classList.contains("in-hidden");
}
$("#setup").addEventListener("click", (e) => { if (e.target.closest("#setup-wide")) { setLayout("in-hidden"); setupWidth(); } });
window.addEventListener("resize", () => setupWidth());
function lgTab(r) {
  const pct = (f) => `${Math.round(f * TEAM.limitPct)}%`;
  const machines = (pool) => r.machines.filter((m) => m.poolId === pool.id).map((m) => `<tr><td><b>${m.name}</b></td><td>${
      m.items.map((x) => `${esc(x.name)} <span class="wm-muted">${fmt(x.vusers)}</span>`).join("<br>") + (m.browser ? ' <span class="ds-chip">browsers only</span>' : "")}</td>
    <td class="ds-num">${m.rule ? `${Math.round(m.rule * 100)}%` : "—"}</td><td class="ds-num">${pct(m.cpu)}</td><td class="ds-num">${pct(m.mem)}</td><td class="ds-num">${!m.hits ? "—" : fmt(m.hits, m.hits < 10 ? 1 : 0)}</td></tr>`).join("");
  const kindOf = (w) => w.pageShare == null ? "—" : w.kind === "web" ? "Web pages (set)" : w.kind === "api" ? "API calls (set)" : w.pageShare >= 0.999 ? "Web pages" : w.pageShare <= 0.001 ? "API calls" : `${Math.round(w.pageShare * 100)}% pages`;
  const fromOf = (w) => ({ "team rule": "the team rule", "script figure": "your figure (script)", "your figure": "your figure (past run)", CPU: "machine CPU", memory: "machine memory" })[w.from] || "";
  return r.lg.map((x) => `<p style="margin:0 0 6px"><b>${esc(x.pool.name)}</b> — ${x.total == null ? "machine size needed" : x.extra ? `${x.needed} needed + ${x.extra} extra = <b>${x.total}</b>, the Vusers spread over all of them` : `<b>${x.total}</b>`}</p>
    ${x.total == null ? "" : `<div class="wm-tw" style="margin-bottom:10px"><table class="ds-table"><thead><tr><th>Load generator</th><th>Scripts (Vusers at the peak)</th><th class="ds-num" title="share of the team rule's Vusers per machine">Team rule</th><th class="ds-num">CPU (expected)</th><th class="ds-num">Memory (expected)</th><th class="ds-num">Requests per second</th></tr></thead><tbody>${machines(x.pool)}</tbody></table></div>`}
    <details class="wm-more" style="margin-bottom:14px"><summary>Vusers one machine carries, per script</summary><div class="wm-tw"><table class="ds-table"><thead><tr><th>Script</th><th>Protocol</th><th>Kind</th><th class="ds-num">Vusers (peak)</th><th class="ds-num">Per machine</th><th>Decided by</th></tr></thead><tbody>${
      x.rows.map((w) => `<tr><td>${esc(w.group)}</td><td>${esc(PROTOS[w.protocol].label)}</td><td>${esc(kindOf(w))}</td><td class="ds-num">${fmt(w.vusers)}</td><td class="ds-num">${w.cap ? fmt(w.cap) : "?"}</td><td class="wm-muted">${esc(fromOf(w))}</td></tr>`).join("") || `<tr><td colspan="6" class="wm-muted">no script runs here</td></tr>`
    }</tbody></table></div></details>`).join("") +
    `<p class="wm-muted">Each script's Vusers per machine is the smallest of three limits: the team rule (web pages / API calls, in proportion to the script's pages), the machine's CPU and its memory (kept under ${TEAM.limitPct}%) — a figure from a past run replaces them. Fill each machine (the default): each machine is filled up, and a script that does not fit whole runs as two groups in LRE. One group per script: a script that needs more than one machine gets its own, its Vusers split evenly; the others share the least-busy machine with room. Extra machines carry Vusers too: the same scripts are spread over more machines, with the fewest groups. TruClient (real browsers) runs on machines of its own. Check the load generators in the first run and enter a measured figure.</p>`;
}
function how(r) {
  const parts = r.groups.map((g) => {
    let s = `<p style="margin:0"><b>${esc(g.name)}</b></p><ul class="wm-why">${g.why.map((w) => `<li>${esc(w)}</li>`).join("") || "<li>Values as entered.</li>"}</ul>`;
    if (g.whatIf) s += `<div class="wm-tw" style="margin-bottom:14px"><table class="ds-table"><thead><tr><th class="ds-num">If the average response time is</th><th class="ds-num">An iteration takes</th><th class="ds-num">TPS</th></tr></thead><tbody>${g.whatIf.map((w) => `<tr><td class="ds-num">${fmt(w.rt, 2)} s</td><td class="ds-num">${fmtS(w.iter)}</td><td class="ds-num">${fmt(w.tps, 2)}</td></tr>`).join("")}</tbody></table></div>`;
    return s;
  }).join("");
  return parts + `<div class="ds-note"><div>
    <b>The rule:</b> TPS = Vusers × transactions per iteration ÷ pacing. An iteration takes its response times plus its think time; the pacing must be at least that, or iterations overrun and the TPS drops.
    The response time is needed only to choose a pacing; when you give a pacing, the tool tells you the response-time limit instead.
    Ramp-up: users start a few at a time over at least three pacing intervals (so their iterations spread out), never faster than the start rate. Ramp-down takes half as long.</div></div>`
    + formulas(r.scenario);
}
/* Every formula the engine (engine/workload-engine.js) uses, in plain words, with this page's own settings.
   Keep in step with the engine and docs/USER-GUIDE.md ("How the numbers are worked out"). */
function formulas(sc) {
  const h = sc.headroomPct ?? 25, rnd = sc.randomPct ?? 15, rate = sc.maxStartRate ?? 2;
  const sec = (title, items) => `<h4 class="wm-fh">${title}</h4><ul class="wm-why">${items.map((x) => `<li>${x}</li>`).join("")}</ul>`;
  const protos = Object.values(PROTOS).map((x) => `${esc(x.label)}: ${fmt(x.memMb)} MB per Vuser, ${fmt(x.perCore)} Vusers per core`).join(" · ");
  return `<details class="wm-more wm-formulas"><summary>All the formulas</summary>
    <p class="wm-muted">T = transactions per iteration · G = growth factor · λ = iterations per second the target needs (TPS ÷ T) · ⌈x⌉ = rounded up.
      Your settings: headroom ${fmt(h)}%, random spread ±${fmt(rnd)}%, start rate ${fmt(rate)} Vusers per second.</p>
    ${sec("1. The TPS each script needs", [
      "TPS target: target × G",
      "Transactions per hour: per hour ÷ 3,600 × G",
      "Share of the total: total TPS × G × share % ÷ 100 (the shares must add up to 100%)",
      "Vusers and TPS: TPS × G; the Vusers stay as entered",
      "Iterations: iterations × T ÷ full-load seconds (no growth)",
      "Number of Vusers: no target; the TPS is a result",
      "Defaults for every script — “Each script”: the default TPS; “In total”: (total − the TPS of the scripts with their own target) ÷ the scripts without one",
    ])}
    ${sec("2. One iteration", [
      "Think time (lr_think_time, load.thinkTime) — as recorded: t · ignore: 0 · multiply: t × factor · random %: on average t × (lowest % + highest %) ÷ 200, at most t × highest % ÷ 100",
      "Limit each think time to L s: every think time is cut to L after the setting above (random %: the average of the cut values); the think times as the script has them, else t in equal parts — over the number of think times, or one per transaction",
      "Fixed waits w (sleep, load.sleep): not think time — always waited in full, whatever the think-time setting",
      "Iteration = response time × T + think time (average) + w",
      "Slow iteration = the 90th percentile (or the average, whichever is larger) × T + the longest think time + w",
    ])}
    ${sec("3. Pacing and Vusers", [
      `Chosen by the tool: shortest pacing = ⌈iteration × ${fmt(1 + h / 100, 2)}⌉ s (random style: also at least slow iteration ÷ ${fmt(1 - rnd / 100, 2)}); Vusers = ⌈λ × shortest pacing⌉; then the pacing in whole seconds: exact if a few more Vusers (up to 10%, at least 2) give a whole number of seconds; otherwise the fewest Vusers whose whole-second pacing keeps the TPS at most 1% above the target; when even that is not possible (a short pacing, where one second is a big step) the pacing is kept to 0.1 s. The TPS never falls below the target. Random style: whole-second bounds around the same average`,
      "Fixed pacing P: Vusers = ⌈λ × P⌉",
      "Random pacing a to b: P = (a + b) ÷ 2, Vusers = ⌈λ × P⌉; the TPS lies between Vusers × T ÷ b and Vusers × T ÷ a",
      "As soon as possible / after the previous iteration + delay d: one Vuser's cycle = iteration + d; Vusers = ⌈λ × cycle⌉",
      "Vusers and TPS: pacing = Vusers ÷ λ",
      "Number of Vusers: TPS = Vusers × T ÷ pacing (the tool's pacing = the shortest pacing above)",
      "Planned TPS = Vusers × T ÷ pacing · iterations per second = Vusers ÷ pacing · hits per second = requests per iteration × iterations per second",
    ])}
    ${sec("4. Checks", [
      "Response-time limit = (shortest pacing − longest think time − w) ÷ T — the slowest average per transaction that keeps the TPS",
      `Not possible: shortest pacing < iteration; the TPS then drops to about Vusers × T ÷ iteration; enough Vusers = ⌈λ × iteration × ${fmt(1 + h / 100, 2)}⌉`,
      "Some iterations overrun: shortest pacing < slow iteration · Little headroom: shortest pacing < iteration × (1 + headroom)",
      "Think time longer than the pacing · rounding moved the TPS by more than 1% · more iterations than data rows · more Vusers than the licence",
    ])}
    ${sec("5. Ramp-up and ramp-down", [
      "Your own ramp (Ramp-up and ramp-down: My own): start s Vusers every n s and stop as typed (stop empty: as the start), for every start and stop — the rules below are then not used; a spike's sudden jump stays the tool's. By group: each script starts as typed and the quicker ones hold longer, so all stop together. A check says when it is faster than the start rate",
      `Wanted ramp-up = the larger of (Vusers ÷ ${fmt(rate)}) and the smaller of (3 × the longest pacing, at least 60 s) and (a quarter of full load, at least 60 s, at most 30 min)`,
      "“Start X Vusers every N s”: the fewest Vusers per step whose interval is 1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 45, 60, 90, 120, 180 or 300 s and gives a ramp within 10% of the wanted one, never faster than the start rate; one Vuser starts at once",
      `Ramp-down: half the ramp-up worked out as above with twice the start rate, but never shorter than Vusers ÷ ${fmt(rate * 2)} (the stop rate), so no step stops many Vusers at once; each Vuser finishes its current iteration`,
      `Basic schedule by group: each script its own ramp; a shorter ramp starts later by (longest ramp − its ramp), so all reach full load together. The scripts ramp at the same time, so they share the start rate: each gets ${fmt(rate)} × its share of the Vusers (at least 1 Vuser every 300 s) — together never more than ${fmt(rate)} new Vusers per second; the stop rate likewise`,
      "Stress held at one level (the team standard): Vusers × the level (150% → 1.5 ×), started at the start rate, held for the hold (120 min), then stopped",
      "Stress in steps / capacity: steps at a % of the Vusers (default 50, 75, 100, 125, 150% / 100 to 200%), each held 10 min or 5 × the longest pacing, whichever is longer (or the hold you set)",
      "Spike: normal load (50%) held, the burst to 200% started within one pacing (10 to 60 s) and held up to 10 min, the burst stopped at once, recovery held, then the stop",
      "Goal-oriented: goal = the total TPS; Vusers from ⌈50%⌉ to ⌈150%⌉ of the plan; run for the full-load time after the goal is reached",
    ])}
    ${sec("6. Timeline and totals", [
      "Each Vuser starts an iteration when it starts and then every cycle (the pacing's average) until it stops — an expected-value model, not a replay",
      "Iterations are counted per phase (ramp-up, full load, ramp-down); transactions = iterations × T; with gradual exit every iteration that starts also finishes",
      "Expected TPS at a moment = Σ running Vusers × T ÷ pacing",
      "Test length = end of the schedule + one slow iteration (the last iterations finish; a Vuser waiting for its next pacing slot leaves at once) — one pacing when no response time is known",
    ])}
    ${sec("7. Load generators", [
      "Team rule: Vusers per machine = 1 ÷ (p ÷ web + (1 − p) ÷ API), p = the script's share of page requests (web pages = 1, API calls = 0; not read from a script = 1). E.g. 100 / 250 and 3 pages in 20 requests: 1 ÷ (0.15 ÷ 100 + 0.85 ÷ 250) = 204",
      `Machine size: by memory (memory − 2 GB) × 1,024 × ${TEAM.limitPct}% ÷ MB per Vuser, by CPU cores × Vusers per core × ${TEAM.limitPct}%. A script's Vusers per machine = the smallest of the rule, CPU and memory; a figure from a past run (the script's own, else the pool's) replaces all three`,
      "Machines needed in a pool = ⌈the largest of Σ (peak Vusers ÷ rule), Σ (peak Vusers ÷ by CPU) and Σ (peak Vusers ÷ by memory)⌉ — the three are added up apart",
      "Extra machines: needed + extra, and the Vusers are spread over all of them (the lowest per-machine load that still fits) — no machine stands idle; never more machines than a script has Vusers; cut to the machines available",
      "Fast loop: more than 2 requests per second per Vuser is flagged — the Vusers-per-machine figures assume a normal pace",
      "Peak Vusers of a script = its Vusers × (the highest step ÷ the planned Vusers)",
      "Which machine — fill each machine (the default): largest script first; whole onto the fullest machine with room, else it fills the fullest machine with room for at least 5 of its Vusers and goes on to the next — in LRE it runs as one group per set of machines (name_1, name_2), each with its own ramp so all reach full load together. Machines = ⌈total⌉ as a rule",
      "Which machine — one group per script: a script needing more than one machine gets ⌈load⌉ machines of its own, its Vusers split evenly (LRE splits a group evenly over its load generators); the others, largest first, go to the least-busy machine with room. If whole scripts do not fit into ⌈total⌉ machines, more are used and Checks warns. TruClient runs on machines of its own (both ways)",
      `Names: LG1, LG2 … numbered on from one pool to the next. Expected CPU or memory of a machine = its load × ${TEAM.limitPct}%; requests per second = Σ Vusers × requests per iteration ÷ pacing`,
      `From a past run: Vusers per machine = Vusers it ran × ${TEAM.limitPct} ÷ the higher of its peak CPU % and memory % (a straight line — a rough guess below 35%)`,
      `Starting assumptions (not vendor figures): ${protos}`,
    ])}
  </details>`;
}
/* ---------- phases: ramp-up, steady state (or each held step), ramp-down — with clock times ----------
   Basic schedule: one steady state = the full-load hold (the window to analyse).
   Stepped tests (stress, capacity, spike): every hold is a window; the 100% step (or "normal load") is the one to
   compare with the target. The last iterations finish within one slow iteration after the schedule ends (one pacing without a response time). */
const PH_COL = { start: "var(--c-work)", hold: "color-mix(in srgb, var(--ds-accent-text) 45%, transparent)", steady: "var(--ds-ok)", stop: "var(--ds-warn)", finish: "var(--ds-text-3)" };
function phases(r) {
  const holds = r.marks.filter((m) => m.type === "hold"), stepped = holds.length > 1;
  const key = stepped ? (holds.find((m) => /^100%|^normal load/.test(m.label || "")) || null) : holds[0];
  const rows = r.marks.filter((m) => m.to - m.from > 0.5).map((m) => {
    const steady = m === key;
    const label = m.type === "start" ? (stepped && m.from > 0 ? "Add Vusers" : "Ramp-up")
      : m.type === "stop" ? (stepped && m !== r.marks[r.marks.length - 1] ? "Stop Vusers" : "Ramp-down")
      : stepped ? `Hold — ${(m.label || "").replace(/^./, (c) => c.toUpperCase())}` : "Steady state (full load)";
    return { kind: steady ? "steady" : m.type, label, from: m.from, to: m.to, steady };
  });
  const schedEnd = Math.max(...r.marks.map((m) => m.to));
  if (r.duration - schedEnd > 0.5) rows.push({ kind: "finish", label: "Last iterations finish", from: schedEnd, to: r.duration });
  const up = rows.filter((x) => x.kind === "start").reduce((a, x) => a + x.to - x.from, 0);
  const down = rows.filter((x) => x.kind === "stop").reduce((a, x) => a + x.to - x.from, 0);
  const short = (s) => E.words(Math.round(s));                // "1 min 6 s" — never mistaken for hh:mm
  const out = { rows, stepped };
  if (!stepped) {
    const h = holds[0] || { from: 0, to: 0 };
    out.tileLabel = "Steady state"; out.tileValue = E.hms(h.to - h.from); out.tileNote = `${E.hms(h.from)} → ${E.hms(h.to)} on the test clock`;
    out.lengthNote = `ramp-up ${short(up)} + full load ${short(h.to - h.from)} + ramp-down and last iterations ${short(r.duration - h.to)}`;
    out.analysisText = `Steady state (full load) for analysis: ${E.hms(h.from)} to ${E.hms(h.to)} (${E.hms(h.to - h.from)}) after the scenario starts.`;
  } else {
    const each = holds.map((m) => m.to - m.from);
    const same = each.every((x) => Math.abs(x - each[0]) < 1);
    out.tileLabel = "Held steps"; out.tileValue = same ? `${holds.length} × ${short(each[0])}` : `${holds.length} holds`;
    out.tileNote = key ? `${/^normal/.test(key.label) ? "normal load" : "100% step"} ${E.hms(key.from)} → ${E.hms(key.to)}` : "see the phase table";
    out.lengthNote = `${holds.length} held steps · ${short(each.reduce((a, x) => a + x, 0))} held in all`;
    out.analysisText = "Held steps for analysis (time after the scenario starts):\n" + holds.map((m) => `  ${E.hms(m.from)} to ${E.hms(m.to)}  ${m.label || ""}`).join("\n");
  }
  return out;
}
function drawPhases(ph, r) {
  $("#phbar").innerHTML = ph.rows.map((x) => `<span style="width:${(100 * (x.to - x.from) / r.duration).toFixed(3)}%;background:${PH_COL[x.kind]}" title="${esc(x.label)}: ${E.hms(x.from)} – ${E.hms(x.to)}"></span>`).join("");
  $("#phases").innerHTML = `<thead><tr><th>Phase</th><th>From</th><th>To</th><th>Length</th></tr></thead><tbody>${ph.rows.map((x) =>
    `<tr class="${x.steady ? "steady" : ""}"><td><i class="dot" style="background:${PH_COL[x.kind]}"></i>${esc(x.label)}${x.steady ? ' <span class="ds-chip ok">measure here</span>' : ""}</td><td>${E.hms(x.from)}</td><td>${E.hms(x.to)}</td><td>${E.hms(x.to - x.from)}</td></tr>`).join("")}</tbody>`;
}

function drawChart(r) {
  const W = 640, H = 190, L = 40, R = 44, B = 24, T = 12, tl = r.timeline, end = r.duration;
  const vMax = Math.max(1, ...tl.map((p) => p.vusers)), tMax = Math.max(0.001, ...tl.map((p) => p.tps));
  const x = (t) => L + (W - L - R) * t / end, yv = (v) => H - B - (H - B - T) * v / vMax, yt = (v) => H - B - (H - B - T) * v / tMax;
  const line = (f, k) => tl.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${f(p[k]).toFixed(1)}`).join("");
  const hold = r.marks.filter((m) => m.type === "hold");
  const shade = hold.map((m) => `<rect x="${x(m.from).toFixed(1)}" y="${T}" width="${Math.max(0, x(m.to) - x(m.from)).toFixed(1)}" height="${H - B - T}" fill="var(--ds-accent-soft)"/>`).join("");
  const ticks = [0, end / 4, end / 2, 3 * end / 4, end].map((t) => `<text x="${x(t).toFixed(1)}" y="${H - 6}" text-anchor="middle">${E.hms(t).slice(0, 5)}</text>`).join("");
  $("#chart").innerHTML = `${shade}<line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" stroke="currentColor" opacity=".25"/>
    <path d="${line(yv, "vusers")}" fill="none" stroke="var(--c-work)" stroke-width="2.5"/>
    <path d="${line(yt, "tps")}" fill="none" stroke="var(--ds-ok)" stroke-width="2" stroke-dasharray="6 4"/>
    <text x="${L - 6}" y="${yv(vMax) + 4}" text-anchor="end">${fmt(vMax)}</text><text x="${L - 6}" y="${H - B + 4}" text-anchor="end">0</text>
    <text x="${W - R + 6}" y="${yt(tMax) + 4}">${fmt(tMax, 1)}</text>${ticks}`;
  $("#lg-phase").innerHTML = `<i style="background:var(--ds-accent-soft);height:10px"></i>${r.marks.filter((m) => m.type === "hold").length > 1 ? "Held steps" : "Steady state"} (hh:mm on the axis)`;
}
