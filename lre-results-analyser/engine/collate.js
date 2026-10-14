/**
 * collate.js — collate.txt / remote_results.txt: load-generator hosts and collation status.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./ini"));
  else (root.LreRA = root.LreRA || {}).collate = factory(root.LreRA.ini);
})(typeof self !== "undefined" ? self : this, function (ini) {
  "use strict";

  function parse(collateBytes, remoteBytes) {
    const c = ini.parse(collateBytes || "");
    const r = ini.parse(remoteBytes || "");
    const hosts = new Set();
    for (const p of [c, r]) {
      const s = p.section("Hosts");
      if (s) for (const [h] of s.entries) hosts.add(h);
    }
    return {
      hosts: [...hosts],
      completed: c.get("Collate Recovery", "Completed") === "1" ? true : c.get("Collate Recovery", "Completed") === "0" ? false : null,
      postRunActions: c.get("Post Run Actions", "Actions") || null,
      runtimeCollate: c.get("Post Run Actions", "IsRuntimeCollate") || null,
      vusersResultsZipStatus: r.get("Collate Results", "VusersResultsZipStatus") || null,
    };
  }

  return { parse };
});
