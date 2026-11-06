/**
 * rawmap.js — RawData.map: ID → name tables per section.
 *
 * [END_TRANSACTION] gives transaction IDs; [DATA_POINT] gives data-point IDs. The two ID ranges
 * overlap, so they are kept apart. Entries are not always in ID order (10 before 9 in run 59).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./ini"));
  else (root.LreRA = root.LreRA || {}).rawmap = factory(root.LreRA.ini);
})(typeof self !== "undefined" ? self : this, function (ini) {
  "use strict";

  function parse(input) {
    const p = ini.parse(input || "");
    const sections = {};
    for (const name of Object.keys(p.sections)) {
      if (!name) continue;
      const m = new Map();
      for (const [k, v] of p.sections[name].entries) {
        const id = parseInt(k, 10);
        if (Number.isFinite(id)) m.set(id, v);
      }
      sections[name] = m;
    }
    const transactions = sections.END_TRANSACTION || new Map();
    const dataPoints = sections.DATA_POINT || new Map();
    return {
      sections,
      transactions,
      dataPoints,
      txName: (id) => transactions.get(id) || `TX_${id}`,
    };
  }

  return { parse };
});
