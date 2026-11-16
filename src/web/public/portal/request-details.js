/* One request-details view for every tool (HAR Explorer, Script Studio): the summary line, Copy URL / Copy as cURL,
 * and the tabs Headers · Payload · Response · Preview · Cookies · Timing — drawn from the raw HAR entry, the way
 * the browser's DevTools show it. Moved unchanged from portal/har-explorer.js; styles in portal/request-details.css.
 *
 *   RequestDetails.html(o)   → the HTML of the view. o = {
 *       n, e: {method, url, status, size}, raw (the HAR entry), type (label), dur, start (ms from the first request),
 *       out (bool), why (text), tab, mask (Hide secrets), full ({req|res: true} = "Show all" used),
 *       hl (fn: html → html, marks a looked-up value; optional), top (html above the address; optional),
 *       extra ([{key, label, count, html}]: tabs of the page's own after the six; optional) }
 *   RequestDetails.copy(raw, kind, mask, url) → the text for "url" or "curl"
 *   RequestDetails.TABS, .SECRET, .bodyText, .size, .ms, .esc, .short, .methodClass (helpers the pages share)
 * Nothing here leaves the browser: the page preview runs sandboxed with every outside request blocked (CSP). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RequestDetails = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var SECRET = /^(authorization|proxy-authorization|cookie|set-cookie|x-xsrf-token|x-csrf-token|dpop)$|pass(word)?|secret|token|session|csrf|xsrf/i;
  var BIG = 300000;   // characters drawn before "Show all"
  var PREVIEW_CSP = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:\">";
  var ICON_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  var TABS = ["headers", "payload", "response", "preview", "cookies", "timing"];

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function short(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function size(n) { return n == null || n < 0 ? "—" : n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB"; }
  function ms(n) { return n < 1000 ? Math.round(n) + " ms" : (n / 1000).toFixed(2) + " s"; }
  function methodClass(m) { return { GET: "get", POST: "post", PUT: "put", PATCH: "put", DELETE: "del" }[m] || "oth"; }
  function same(x) { return x; }

  // decoded response / request text (HAR bodies can be Base64)
  function bodyText(c) {
    if (!c || c.text == null) return null;
    if (c.encoding === "base64" && !/^image\//i.test(c.mimeType || "")) {
      try { var b = atob(c.text), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return new TextDecoder().decode(a); } catch (e) { return c.text; }
    }
    return c.text;
  }
  function pretty(text, mime) {
    if (/json/i.test(mime || "") || /^\s*[{[]/.test(text)) {
      try {
        return esc(JSON.stringify(JSON.parse(text), null, 2)).replace(/(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/g, function (m, str, colon, kw, num) {
          return str ? '<span class="' + (colon ? "k" : "s") + '">' + str + "</span>" + (colon || "") : kw ? '<span class="t">' + kw + "</span>" : '<span class="n">' + num + "</span>";
        });
      } catch (e) { /* not JSON */ }
    }
    return esc(text);
  }
  function decode(s) { try { return decodeURIComponent(String(s).replace(/\+/g, " ")); } catch (e) { return s; } }
  function queryOf(rq) {
    if (rq.queryString && rq.queryString.length) return rq.queryString;
    var q = (rq.url || "").split("?")[1]; if (!q) return [];
    return q.split("#")[0].split("&").filter(Boolean).map(function (p) { var i = p.indexOf("="); return { name: decode(i < 0 ? p : p.slice(0, i)), value: i < 0 ? "" : p.slice(i + 1) }; });
  }
  function cookiesOf(list, headers, setCookie) {
    if (list && list.length) return list;
    var out = [];
    (headers || []).forEach(function (h) {
      if (setCookie ? !/^set-cookie$/i.test(h.name) : !/^cookie$/i.test(h.name)) return;
      (setCookie ? h.value.split(/\n/) : h.value.split(/;\s*/)).forEach(function (c) { var i = c.indexOf("="); if (i > 0) out.push({ name: c.slice(0, i).trim(), value: setCookie ? c.slice(i + 1).split(";")[0] : c.slice(i + 1) }); });
    });
    return out;
  }
  function maskBody(text) {
    return text.replace(/("(?:password|pass|pwd|secret|token|access_token|refresh_token|id_token|client_secret|_csrf)"\s*:\s*)"[^"]*"/gi, '$1"••••••"').replace(/((?:^|&)(?:password|pass|pwd|_csrf|token|client_secret)=)[^&]*/gi, "$1••••••");
  }
  function sec(title, inner, right, closed) {
    return '<details class="hx-sec"' + (closed ? "" : " open") + '><summary><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>' +
      title + (right ? '<span class="r">' + right + "</span>" : "") + "</summary>" + inner + "</details>";
  }
  function count(n) { return ' <span class="c">' + n + "</span>"; }

  function html(o) {
    var hl = o.hl || same, mask = !!o.mask, full = o.full || {};
    var shown = function (name, value) { return mask && SECRET.test(name) ? "••••••" : value; };
    var kv = function (list, empty) {
      if (!list || !list.length) return '<p class="hx-none">' + (empty || "None") + "</p>";
      return '<table class="hx-kv">' + list.map(function (h) {
        return "<tr" + (mask && SECRET.test(h.name) ? ' class="secret"' : "") + "><td>" + esc(h.name) + "</td><td>" + hl(esc(shown(h.name, h.value))) + "</td></tr>";
      }).join("") + "</table>";
    };
    var codeBlock = function (text, mime, key) {
      var t = text, cut = !full[key] && t.length > BIG;
      if (cut) t = t.slice(0, BIG);
      var out = '<pre class="hx-code">' + hl(pretty(t, mime)) + "</pre>";
      if (cut) out += '<button class="ds-btn ds-btn-sm hx-more" data-full="' + key + '">Show all (' + size(text.length) + ")</button>";
      return out;
    };
    var e = o.e, raw = o.raw || {}, rq = raw.request || {}, rs = raw.response || {}, content = rs.content || {}, pd = rq.postData;
    var body = bodyText(content), reqH = rq.headers || [], resH = rs.headers || [], query = queryOf(rq);
    var reqC = cookiesOf(rq.cookies, reqH, false), resC = cookiesOf(rs.cookies, resH, true);
    // a page may add tabs of its own after these (Script Studio: Dynamic values): o.extra = [{key, label, count, html}]
    var extra = o.extra || [], ex = extra.filter(function (x) { return x.key === o.tab; })[0];
    var tab = TABS.indexOf(o.tab) !== -1 || ex ? o.tab : "headers";
    var tabs = [["headers", "Headers", reqH.length + resH.length], ["payload", "Payload", query.length + (pd ? 1 : 0)], ["response", "Response"], ["preview", "Preview"], ["cookies", "Cookies", reqC.length + resC.length], ["timing", "Timing"]]
      .concat(extra.map(function (x) { return [x.key, x.label, x.count]; }));
    var h = ex ? ex.html : "", mime = content.mimeType || "";
    if (tab === "headers") {
      var gen = [{ name: "Request URL", value: e.url }, { name: "Request method", value: e.method }, { name: "Status code", value: (rs.status || "—") + " " + (rs.statusText || "") }, { name: "HTTP version", value: rs.httpVersion || rq.httpVersion || "" }];
      if (rs.redirectURL) gen.push({ name: "Redirects to", value: rs.redirectURL });
      h += sec("General", kv(gen));
      h += sec("Response headers" + count(resH.length), kv(resH));
      h += sec("Request headers" + count(reqH.length), kv(reqH));
    } else if (tab === "payload") {
      if (query.length) h += sec("Query string parameters" + count(query.length), kv(query.map(function (p) { var v = p.value, dv = decode(v); return { name: p.name, value: dv !== v ? v + "    (decoded: " + dv + ")" : v }; })));
      if (pd) {
        var params = pd.params || [];
        if (params.length) h += sec("Form data" + count(params.length), kv(params.map(function (p) { return { name: p.name, value: p.value != null ? p.value : (p.fileName ? "[file " + p.fileName + "]" : "") }; })), '<span class="mono">' + esc(pd.mimeType || "") + "</span>");
        if (pd.text) h += sec(params.length ? "Raw body" : "Request body", codeBlock(mask ? maskBody(pd.text) : pd.text, pd.mimeType, "req"), '<span class="mono">' + esc(pd.mimeType || "") + " · " + size(pd.text.length) + "</span>", params.length > 0);
      }
      if (!h) h = '<p class="hx-none">This request sends no query string and no body.</p>';
    } else if (tab === "response") {
      if (/^image\//i.test(mime) && content.text) h = '<p class="hx-none">An image — see Preview.</p>';
      else if (body == null || body === "") h = '<p class="hx-none">' + (rs.status >= 300 && rs.status < 400 ? "A redirect has no body — see “Redirects to” under Headers." : "No response body in this HAR — the response was empty, or the browser did not keep it (for example, served from its cache).") + "</p>";
      else h = sec("Response body", codeBlock(mask ? maskBody(body) : body, mime, "res"), '<span class="mono">' + esc(mime) + " · " + size(body.length) + "</span>");
    } else if (tab === "preview") {
      if (/^image\//i.test(mime) && content.text && content.encoding === "base64") h = '<div class="hx-sec hx-img"><img alt="The response image" src="data:' + esc(mime) + ";base64," + esc(content.text) + '"></div>';
      else if (/^image\/svg/i.test(mime) && body) h = '<div class="hx-sec hx-img"><img alt="The response image" src="data:image/svg+xml;charset=utf-8,' + encodeURIComponent(body) + '"></div>';
      // nothing may leave the PC: no scripts (sandbox) and no images, styles or fonts fetched from the site (CSP)
      else if (/html/i.test(mime) && body) h = sec("Page preview — scripts, links and the site's images switched off", '<iframe class="hx-frame" sandbox="" srcdoc="' + esc(PREVIEW_CSP + body) + '" title="Page preview"></iframe>');
      else if (body && /json/i.test(mime)) h = sec("JSON", codeBlock(mask ? maskBody(body) : body, mime, "res"));
      else if (!body && /html|json|image/i.test(mime)) h = '<p class="hx-none">Nothing to preview — this HAR does not contain the response body (the browser did not keep it, for example because it came from its cache).</p>';
      else h = '<p class="hx-none">Nothing to preview for this response.</p>';
    } else if (tab === "cookies") {
      h += sec("Request cookies" + count(reqC.length), kv(reqC, "No cookies sent"));
      h += sec("Response cookies (Set-Cookie)" + count(resC.length), kv(resC.map(function (c) { return { name: c.name, value: c.value + (c.httpOnly ? " · HttpOnly" : "") + (c.secure ? " · Secure" : "") }; }), "No cookies set"));
      h += '<p class="ds-note hx-hint">VuGen and DevWeb keep cookies between requests by themselves — a value that only travels in cookies needs no correlation.</p>';
    } else if (tab === "timing") {
      var t = raw.timings || {}, parts = [["blocked", "Queued / blocked"], ["dns", "DNS lookup"], ["connect", "Initial connection"], ["ssl", "TLS handshake"], ["send", "Request sent"], ["wait", "Waiting for the server (TTFB)"], ["receive", "Content download"]];
      var sum = 0; parts.forEach(function (p) { sum += Math.max(0, t[p[0]] || 0); }); sum = Math.max(sum, 1);
      var acc = 0;
      h = sec("Timing — " + ms(o.dur), '<div class="hx-tl">' + parts.map(function (p, i) {
        var v = Math.max(0, t[p[0]] || 0), bar = v ? '<i class="c' + i + '" style="left:' + (acc / sum * 100) + "%;width:" + Math.max(0.8, v / sum * 100) + '%"></i>' : "";
        acc += v; return '<div class="row"><span>' + p[1] + '</span><span class="bar">' + bar + '</span><span class="v">' + (t[p[0]] == null || t[p[0]] < 0 ? "—" : ms(v)) + "</span></div>";
      }).join("") + '<div class="row"><span>Started at</span><span></span><span class="v">+' + ms(o.start) + "</span></div></div>");
      h += '<p class="ds-note hx-hint">Under load, <b>Waiting for the server (TTFB)</b> is the part that grows — it is the server\'s own time. DNS, connection and TLS happen once per new connection.</p>';
    }
    return '<div class="hx-dh">' + (o.top || "") +
      '<div class="hx-durl"><span class="hx-meth ' + methodClass(e.method) + '">' + esc(e.method) + "</span><code>" + hl(esc(e.url)) + "</code></div>" +
      '<div class="hx-dsum"><span>#<b>' + o.n + '</b></span><span>Status <b class="st s' + String(e.status).charAt(0) + '">' + (rs.status || "—") + " " + esc(rs.statusText || "") + "</b></span><span>Type <b>" + o.type + "</b></span><span>Size <b>" + size(e.size) + "</b></span><span>Time <b>" + ms(o.dur) + "</b></span>" +
      '<span class="r"><button type="button" class="ds-btn ds-btn-sm ds-btn-ghost" data-copy="url">' + ICON_COPY + 'Copy URL</button><button type="button" class="ds-btn ds-btn-sm ds-btn-ghost" data-copy="curl">' + ICON_COPY + "Copy as cURL</button></span></div>" +
      (o.out ? '<p class="hx-left"><b>Left out of the script:</b> ' + esc(o.why) + "</p>" : "") +
      '<div class="hx-tabs" role="tablist">' + tabs.map(function (x) { return '<button type="button" role="tab" class="hx-tab" data-tab="' + x[0] + '" aria-selected="' + (tab === x[0]) + '">' + x[1] + (x[2] ? "<i>" + x[2] + "</i>" : "") + "</button>"; }).join("") + "</div></div>" +
      '<div class="hx-db">' + h + "</div>";
  }

  function copy(raw, kind, mask, url) {
    var rq = (raw && raw.request) || {};
    if (kind === "url") return rq.url || url;
    var shown = function (name, value) { return mask && SECRET.test(name) ? "••••••" : value; };
    var q = function (s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; };
    return "curl -X " + (rq.method || "GET") + " " + q(rq.url) + (rq.headers || []).filter(function (h) { return h.name.charAt(0) !== ":"; }).map(function (h) { return " \\\n  -H " + q(h.name + ": " + shown(h.name, h.value)); }).join("") +
      (rq.postData && rq.postData.text ? " \\\n  --data-raw " + q(mask ? maskBody(rq.postData.text) : rq.postData.text) : "");
  }

  return { html: html, copy: copy, TABS: TABS, SECRET: SECRET, bodyText: bodyText, pretty: pretty, size: size, ms: ms, esc: esc, short: short, methodClass: methodClass, maskBody: maskBody, ICON_COPY: ICON_COPY };
});
