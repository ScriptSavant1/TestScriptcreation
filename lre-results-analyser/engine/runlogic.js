/**
 * runlogic.js — per-script workload settings: pacing (*.usp), think time (*.cfg), transactions (*.usr).
 *
 * Pacing (.usp [RunLogicRunRoot] RunLogicPaceType):
 *   ASAP        → as soon as the previous iteration ends
 *   Const       → start a new iteration every RunLogicPaceConstTime s (fixed intervals)
 *   Random      → start every RunLogicRandomPaceMin..Max s (random intervals)
 *   ConstAfter  → RunLogicPaceConstAfterTime s after the previous iteration ends
 *   RandomAfter → RunLogicAfterPaceMin..Max s after the previous iteration ends
 * Unrecognised types are reported verbatim.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./ini"));
  else (root.LreRA = root.LreRA || {}).runlogic = factory(root.LreRA.ini);
})(typeof self !== "undefined" ? self : this, function (ini) {
  "use strict";

  const n = (v) => { const x = Number(v); return v !== undefined && v !== "" && Number.isFinite(x) ? x : null; };

  function pacing(uspBytes) {
    const p = ini.parse(uspBytes || "");
    const g = (k) => p.get("RunLogicRunRoot", k);
    const type = g("RunLogicPaceType") || null;
    const iterations = n(g("RunLogicNumOfIterations"));
    let kind, text, seconds = null, min = null, max = null;
    switch ((type || "").toLowerCase()) {
      case "":
      case "asap": kind = "asap"; text = "As soon as the previous iteration ends"; break;
      case "const": kind = "fixedInterval"; seconds = n(g("RunLogicPaceConstTime")); text = `Start every ${seconds} s`; break;
      case "random": kind = "randomInterval"; min = n(g("RunLogicRandomPaceMin")); max = n(g("RunLogicRandomPaceMax")); text = `Start every ${min}–${max} s (random)`; break;
      case "constafter": kind = "fixedDelay"; seconds = n(g("RunLogicPaceConstAfterTime")); text = `${seconds} s after the previous iteration ends`; break;
      case "randomafter": kind = "randomDelay"; min = n(g("RunLogicAfterPaceMin")); max = n(g("RunLogicAfterPaceMax")); text = `${min}–${max} s (random) after the previous iteration ends`; break;
      default: kind = "unknown"; text = `Unrecognised pace type "${type}"`;
    }
    return { rawType: type, kind, seconds, min, max, text, iterationsSetting: iterations };
  }

  /** Think time: DevWeb → [DevWebYaml] yaml JSON (replay.thinkTime / thinkTime); other protocols → [ThinkTime]. */
  function thinkTime(cfgBytes) {
    const c = ini.parse(cfgBytes || "");
    const yaml = c.get("DevWebYaml", "yaml");
    if (yaml) {
      try {
        const j = JSON.parse(yaml);
        const tt = (j.replay && j.replay.thinkTime) || j.thinkTime || null;
        if (tt) {
          const type = tt.type || tt.mode || null;
          const limit = tt.limit != null ? Number(tt.limit) : null;
          const t = String(type || "").toLowerCase();
          const words = t === "ignore" ? "Ignored" :
            t === "asrecorded" ? "As recorded" + (limit ? ` (limit ${limit} s)` : "") :
            t === "multiply" ? `Recorded × ${tt.multiplyFactor != null ? tt.multiplyFactor : "?"}` + (limit ? ` (limit ${limit} s)` : "") :
            t === "random" ? `Random ${tt.minPercentage != null ? tt.minPercentage : "?"}–${tt.maxPercentage != null ? tt.maxPercentage : "?"}% of recorded` + (limit ? ` (limit ${limit} s)` : "") :
            `"${type}"`;
          return { source: "cfg [DevWebYaml]", type, limit, raw: tt, text: words };
        }
      } catch (e) {
        return { source: "cfg [DevWebYaml]", type: null, limit: null, raw: null, text: "Could not read DevWeb settings JSON", error: String(e.message || e) };
      }
    }
    const s = c.section("ThinkTime");
    if (s) {
      const opt = c.get("ThinkTime", "Options") || null;
      const factor = n(c.get("ThinkTime", "Factor"));
      const limit = n(c.get("ThinkTime", "Limit"));
      const limitOn = c.get("ThinkTime", "LimitFlag") === "1";
      const o = String(opt || "").toUpperCase();
      // VuGen writes ThinkTimeRandomLow/High; older files RandomLow/High
      const low = c.get("ThinkTime", "ThinkTimeRandomLow") || c.get("ThinkTime", "RandomLow");
      const high = c.get("ThinkTime", "ThinkTimeRandomHigh") || c.get("ThinkTime", "RandomHigh");
      const words = o === "NOTHINK" ? "Ignored" :
        o === "RECORDED" ? "As recorded" + (limitOn ? ` (limit ${limit} s)` : "") :
        o === "MULTIPLY" ? `Recorded × ${factor}` + (limitOn ? ` (limit ${limit} s)` : "") :
        o === "RANDOM" ? (low != null && high != null ? `Random ${low}–${high} % of recorded` : "Random % of recorded") + (limitOn ? ` (limit ${limit} s)` : "") :
        `"${opt}"`;
      return { source: "cfg [ThinkTime]", type: opt, limit: limitOn ? limit : null, raw: Object.assign({}, s.values), text: words };
    }
    return null;
  }

  /** Transactions defined in the script, in script order. */
  function transactions(usrBytes) {
    const u = ini.parse(usrBytes || "");
    const order = u.get("TransactionsOrder", "Order");
    if (order) return order.split("__*delimiter*__").map((s) => s.trim()).filter(Boolean);
    const t = u.section("Transactions");
    return t ? t.entries.map(([k]) => k) : [];
  }

  function scriptInfo(usrBytes) {
    const u = ini.parse(usrBytes || "");
    return {
      type: u.get("General", "Type") || null,
      language: u.get("General", "ScriptLanguage") || null,
      transactions: transactions(usrBytes),
    };
  }

  return { pacing, thinkTime, transactions, scriptInfo };
});
