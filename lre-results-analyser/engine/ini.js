/**
 * ini.js — INI parser for LRE files (RunInfo.ini, res*.lrr, *.usp, *.cfg, *.usr, RawData.map,
 * collate.txt, sum_dat.ini).
 *
 * - Section names and keys keep their case; look-ups are case-insensitive via get().
 * - A value wrapped in double quotes ("...") is unwrapped once (usp/cfg/map style).
 * - Values may contain ';' and '=' (e.g. "Global Schedule=ST27_1E5;R28800;").
 * - Lines before the first section belong to section "".
 * - Each section also keeps its entries in file order (RawData.map order matters).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./text"));
  else (root.LreRA = root.LreRA || {}).ini = factory(root.LreRA.text);
})(typeof self !== "undefined" ? self : this, function (text) {
  "use strict";

  function unquote(v) {
    return v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"' ? v.slice(1, -1) : v;
  }

  /**
   * @param {string|Uint8Array} input
   * @returns {{ sections: Object<string, {name:string, entries:Array<[string,string]>, values:Object<string,string>}> ,
   *             section(name): object|null, get(section, key): string|undefined }}
   */
  function parse(input) {
    const sections = {};
    let current = { name: "", entries: [], values: {} };
    sections[""] = current;
    for (const raw of text.lines(text.decode(input))) {
      const line = raw.trim();
      if (!line || line[0] === ";" || line[0] === "#") continue;
      const sec = /^\[(.*)\]$/.exec(line);
      if (sec) {
        const name = sec[1].trim();
        current = sections[name] || { name, entries: [], values: {} };
        sections[name] = current;
        continue;
      }
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      const value = unquote(line.slice(eq + 1).trim());
      current.entries.push([key, value]);
      current.values[key] = value;
    }
    const lower = {};
    for (const name of Object.keys(sections)) lower[name.toLowerCase()] = sections[name];

    function section(name) {
      return lower[String(name).toLowerCase()] || null;
    }
    function get(sectionName, key) {
      const s = section(sectionName);
      if (!s) return undefined;
      if (key in s.values) return s.values[key];
      const k = Object.keys(s.values).find((x) => x.toLowerCase() === String(key).toLowerCase());
      return k === undefined ? undefined : s.values[k];
    }
    return { sections, section, get };
  }

  return { parse, unquote };
});
