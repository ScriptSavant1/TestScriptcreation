/**
 * sla.js — SLAConfiguration.xml: transactions in SLA scope and any rules present.
 *
 * Run 59 has only a <TxList> and an empty <SLARules> tracking period (no thresholds), so
 * thresholds come from the user later. Regex-based (no DOMParser in Node / workers).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./text"));
  else (root.LreRA = root.LreRA || {}).sla = factory(root.LreRA.text);
})(typeof self !== "undefined" ? self : this, function (text) {
  "use strict";

  const unesc = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const tag = (xml, name) => { const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml); return m ? unesc(m[1].trim()) : null; };

  function parse(input) {
    const xml = text.decode(input || "");
    const txList = [];
    const listBody = /<TxList>([\s\S]*?)<\/TxList>/.exec(xml);
    if (listBody) {
      const re = /<Tx>([\s\S]*?)<\/Tx>/g;
      let m;
      while ((m = re.exec(listBody[1]))) txList.push(unesc(m[1].trim()));
    }
    const rulesBody = /<SLARules>([\s\S]*?)<\/SLARules>/.exec(xml);
    const rules = rulesBody ? rulesBody[1] : "";
    return {
      version: (/<SLA[^>]*Version="([^"]*)"/.exec(xml) || [])[1] || null,
      transactions: txList,
      trackingPeriodType: tag(rules, "TrackingPeriodType"),
      trackingPeriodValue: tag(rules, "TrackingPeriodValue") || null,
      // Anything inside <SLARules> other than the tracking-period tags = rules we do not decode yet.
      hasOtherRules: rules.replace(/<TrackingPeriod\w+>[\s\S]*?<\/TrackingPeriod\w+>|<TrackingPeriod\w+\s*\/>/g, "").trim().length > 0,
    };
  }

  return { parse };
});
