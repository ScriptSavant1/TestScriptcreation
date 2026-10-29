/**
 * Server (host) parameters for generated scripts.
 *
 * Every server the script talks to gets one parameter, used in every URL, header and body that carries
 * that server, and set once per Vuser: VuGen in vuser_init (set_server), DevWeb as a const at the top
 * of main.js; a Runtime Settings attribute (VuGen) or user argument (DevWeb) with the same name overrides it.
 *
 *  - main host   = the server of the first page load in the script (the application), not the server
 *                  with the most requests — that is often an ad or analytics server
 *  - names       = by role (App_Server, Api_Server, Auth_Server, Static_Server, Recaptcha_Server …, else
 *                  <Organisation>_Server), the same in both formats;
 *                  the user can rename them (validName says whether a name can be used)
 *
 * UMD: browser global `HostParams` (Recorder, Script Studio), or require() in Node (converters, unit tests).
 * URLs are split by hand, never with new URL(): a recording may hold {{variables}}.
 */
(function (exports) {
  "use strict";

  // second-level labels used under a two-letter country code: shop.co.uk, bank.com.au
  var SLD = { co: 1, com: 1, net: 1, org: 1, gov: 1, ac: 1, edu: 1, ltd: 1, plc: 1, nhs: 1, mod: 1, police: 1, sch: 1 };
  // private / internal suffixes: app.perf.internal.corp -> "app"
  var LOCAL = { local: 1, lan: 1, corp: 1, internal: 1, intranet: 1, intra: 1, localdomain: 1, home: 1, ad: 1 };

  var MAX_LEN = 40;

  var RESERVED = (
    // C
    "auto break case char const continue default do double else enum extern float for goto if int long register " +
    "return short signed sizeof static struct switch typedef union unsigned void volatile while " +
    // JavaScript
    "await class delete export extends false finally function implements import in instanceof interface let new " +
    "null package private protected public super this throw true try typeof var with yield arguments eval catch " +
    "undefined NaN Infinity " +
    // names the generated scripts already use
    "load think_time getDpopProof require module exports console JSON Math Promise Date Object String Number " +
    "username password domain dpop_jwk dpop_init_result _dpop_proof _dpop_pf_proof LR"
  ).split(" ");
  var RESERVED_LC = {};
  RESERVED.forEach(function (w) { if (w) RESERVED_LC[w.toLowerCase()] = w; });

  /** "host" or "host:port" (lower case; the default port of the scheme is dropped). "" when not http(s). */
  function hostKey(url) {
    var m = /^(https?):\/\/(?:[^@\/?#]*@)?([^\/?#]+)/i.exec(String(url || ""));
    if (!m) return "";
    var scheme = m[1].toLowerCase(), hp = m[2].toLowerCase();
    var pm = /^(\[[^\]]*\]|[^:]*)(?::(\d*))?$/.exec(hp);
    var host = pm ? pm[1] : hp, port = pm && pm[2] ? pm[2] : "";
    if ((scheme === "https" && port === "443") || (scheme === "http" && port === "80")) port = "";
    return port ? host + ":" + port : host;
  }

  /** Host name without the port — what the Domains panel shows. */
  function hostName(key) { return String(key || "").replace(/:\d+$/, ""); }

  /** A page the user opened (a navigation), not a resource or an API call. */
  function isPageLoad(e) {
    if (!e || String(e.method || "GET").toUpperCase() !== "GET") return false;
    var st = e.status || 0;
    if (st < 200 || st >= 400) return false;
    var rt = String(e._resourceType || "").toLowerCase();
    if (rt === "document") return true;
    var mode = e.hdrsMap && e.hdrsMap["sec-fetch-mode"];
    if (mode === "navigate") return true;
    if (rt) return false;
    return /^(text\/html|application\/xhtml)/i.test(String(e.ct || ""));
  }

  // server names inside request header values (Referer, Origin …) — cookies carry no server to call
  var URL_IN_TEXT = /https?:\/\/[^\/\s?#"'`<>,;)\]}|\\]+/gi;
  var NO_SCAN = { cookie: 1, cookie2: 1, host: 1 };

  /**
   * The servers of the script, in order of first use, the main one first.
   * @param entries   the tool's full entry array
   * @param scripted  (entry, index) -> true when that request becomes a step of the script
   */
  function collect(entries, scripted) {
    var keys = [], seen = {}, firstPage = "", count = {}, paths = {};
    function add(k) { if (k && !seen[k]) { seen[k] = 1; keys.push(k); } }
    (entries || []).forEach(function (e, i) {
      if (!e || e.isMarker || !scripted(e, i)) return;
      var k = hostKey(e.url);
      if (!k) return;
      add(k);
      count[k] = (count[k] || 0) + 1;
      // a few paths per server — what it is used for (e.g. /recaptcha/ on www.google.com) names it
      var pth = String(e.url).replace(/^https?:\/\/[^\/?#]+/i, "").split(/[?#]/)[0];
      if (!paths[k]) paths[k] = [];
      if (paths[k].length < 20) paths[k].push(pth);
      if (!firstPage && isPageLoad(e)) firstPage = k;
      (e.reqHdrs || []).forEach(function (h) {
        var n = String(h.name || "").toLowerCase();
        if (NO_SCAN[n] || n.charAt(0) === ":") return;
        var v = String(h.value || ""), m;
        URL_IN_TEXT.lastIndex = 0;
        while ((m = URL_IN_TEXT.exec(v))) add(hostKey(m[0]));
      });
    });
    var main = firstPage;
    if (!main) {   // no page load (API-only recording): the server with the most steps, the first one on a tie
      keys.forEach(function (k) { if ((count[k] || 0) > (count[main] || 0)) main = k; });
    }
    if (main) keys = [main].concat(keys.filter(function (k) { return k !== main; }));
    return { main: main || "", keys: keys, paths: paths };
  }

  function clean(s) { return String(s).replace(/[^A-Za-z0-9_]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, ""); }

  // the label that names the organisation: "fundingchoicesmessages.google.com" -> "google"
  function parts(key) {
    var h = hostName(key);
    if (/^\[/.test(h)) return { base: "ipv6", sub: "" };
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return { base: "ip_" + h.replace(/\./g, "_"), sub: "" };
    var L = h.split(".").filter(Boolean);
    if (L.length < 2) return { base: L[0] || "server", sub: "" };
    var i = L.length - 1;
    if (LOCAL[L[i]]) { while (i > 0 && LOCAL[L[i]]) i--; }
    else {
      i--;                                                         // the top-level label: com, net, uk, google …
      if (i > 0 && L[L.length - 1].length === 2 && SLD[L[i]]) i--; // co.uk, com.au
    }
    return { base: L[i], sub: L.slice(0, i).join("_") };
  }

  function cut(n) { return n.length > MAX_LEN ? n.slice(0, MAX_LEN).replace(/_+$/, "") : n; }

  // Names by role — what the server does for the script, as a performance engineer names them by hand.
  // Well-known services first (host, optionally a path it is used for), then the first label of the host.
  var KNOWN = [
    [/^(www\.)?google\.[a-z.]+$|^www\.recaptcha\.net$/, /^\/recaptcha\//, "Recaptcha_Server"],
    [/^fonts\.googleapis\.com$/, null, "Google_Fonts"],
    [/^fonts\.gstatic\.com$/, null, "Google_Fonts_Files"],
    [/^www\.gstatic\.com$/, null, "Google_Static"],
    [/^maps\.(googleapis|gstatic)\.com$/, null, "Google_Maps"],
    [/^accounts\.google\.com$/, null, "Google_Login"],
    [/^login\.(microsoftonline|windows|live)\.(com|net)$/, null, "Microsoft_Login"],
    [/\.b2clogin\.com$/, null, "Azure_B2C_Login"],
    [/\.okta(preview)?\.com$/, null, "Okta_Server"],
    [/\.auth0\.com$/, null, "Auth0_Server"],
    [/\.cloudfront\.net$/, null, "Cloudfront_Cdn"],
    [/\.(akamaihd|akamaized)\.net$/, null, "Akamai_Cdn"],
    [/\.azureedge\.net$/, null, "Azure_Cdn"],
    [/\.blob\.core\.windows\.net$/, null, "Azure_Storage"],
    [/(^|\.)s3[.-]([a-z0-9-]+\.)?amazonaws\.com$/, null, "S3_Storage"],
    [/^(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com|code\.jquery\.com|ajax\.googleapis\.com)$/, null, "Js_Library_Cdn"],
  ];
  var ROLE = [
    [/^(api|apis|rest|gateway|gw|services?|ws|graphql|backend)\d*$/, "Api_Server"],
    [/^(auth|login|logon|signin|sso|id|identity|idp|iam|oauth|accounts?|adfs|sts)\d*$/, "Auth_Server"],
    [/^(cdn|static|assets|img|images|media|content|files|res|resources)\d*$/, "Static_Server"],
  ];
  function title(s) { return String(s).split("_").filter(Boolean).map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join("_"); }

  /**
   * Default names for ordered host keys (the first one is the main application): { key: name }.
   * By role — App_Server, Api_Server, Auth_Server, Static_Server, well-known services (Recaptcha_Server,
   * Google_Fonts …), else <Organisation>_Server; a clash takes the organisation in front, then a number.
   * @param hints  { paths: { key: [path, …] } } — what each server was used for (optional)
   */
  function defaultNames(keys, hints) {
    var paths = (hints && hints.paths) || {};
    var out = {}, used = {};
    var mainOrg = keys.length ? title(clean(parts(keys[0]).base)) : "";
    function take(k, names) {
      for (var i = 0; i < names.length; i++) {
        var n = cut(names[i]);
        if (!/^[A-Za-z_]/.test(n)) n = "Srv_" + n;
        if (!used[n.toLowerCase()]) { used[n.toLowerCase()] = 1; out[k] = n; return; }
      }
      var base = cut(names[names.length - 1]), j = 2;
      while (used[(base + "_" + j).toLowerCase()]) j++;
      used[(base + "_" + j).toLowerCase()] = 1; out[k] = base + "_" + j;
    }
    keys.forEach(function (k, idx) {
      var h = hostName(k), p = parts(k);
      var org = title(clean(p.base)) || "Server";
      var first = clean(String(p.sub).split("_")[0] || "").toLowerCase();
      var port = (/:(\d+)$/.exec(k) || [])[1] || "";
      var role = "";
      for (var i = 0; i < KNOWN.length && !role; i++) {
        var kn = KNOWN[i];
        if (kn[0].test(h) && (!kn[1] || (paths[k] || []).some(function (x) { return kn[1].test(x); }))) role = kn[2];
      }
      if (!role) for (var r = 0; r < ROLE.length && !role; r++) if (ROLE[r][0].test(first)) role = ROLE[r][1];
      if (!role && idx === 0) role = "App_Server";                                  // the main application
      // the main application's server on another port: App_Server_8443
      if (!role && port && keys.length && h === hostName(keys[0]) && out[keys[0]]) role = out[keys[0]] + "_" + port;
      var sub = title(clean(String(p.sub).replace(/^www(_|$)/, "")));
      // another server of the application's own organisation: by its subdomain (partner.shop.com → Partner_Server)
      if (!role && sub && org === mainOrg) role = sub + "_Server";
      if (!role) role = org + "_Server";
      // on a clash: the organisation in front, then the subdomain, then the port, then a number
      var cands = [role];
      if (role.indexOf(org + "_") !== 0) cands.push(org + "_" + role);
      if (sub) cands.push(org + "_" + sub + "_Server");
      if (port) cands.push(cands[cands.length - 1] + "_" + port);
      take(k, cands);
    });
    return out;
  }

  /**
   * Why a name cannot be used — "" when it can.
   * @param taken   { otherKey: name } of the other servers
   * @param extra   more names the script already uses (e.g. the DPoP token parameter)
   */
  function validName(name, key, taken, extra) {
    name = String(name == null ? "" : name).trim();
    if (!name) return "Enter a name.";
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return "Use letters, numbers and underscores only, starting with a letter or an underscore.";
    if (name.length > MAX_LEN) return "Use " + MAX_LEN + " characters or fewer.";
    var lc = name.toLowerCase();
    if (RESERVED_LC[lc] || /^ts\d+$/.test(lc) || (extra || []).some(function (w) { return String(w).toLowerCase() === lc; }))
      return "“" + name + "” is already used by the script. Choose another name.";
    for (var k in taken) {
      if (k !== key && String(taken[k]).toLowerCase() === lc) return "“" + name + "” is already the name of " + hostName(k) + ". Choose another name.";
    }
    return "";
  }

  /**
   * The parameters of a script.
   * @param renames  { key: name } chosen by the user — a name that can no longer be used falls back to the default
   * @param extra    more reserved names (see validName)
   * @returns { main, keys, map: { key: name }, list: [{ key, name, renamed, main }] }
   */
  function plan(entries, scripted, renames, extra) {
    var c = collect(entries, scripted);
    var map = {}, list = [];
    renames = renames || {};
    // the user's names first, then the default names around them
    c.keys.forEach(function (k) {
      if (renames[k] && !validName(renames[k], k, map, extra)) map[k] = String(renames[k]).trim();
    });
    var defs = defaultNames(c.keys, { paths: c.paths }), used = {};
    Object.keys(map).forEach(function (k) { used[map[k].toLowerCase()] = 1; });
    c.keys.forEach(function (k) {
      if (map[k]) return;
      var n = defs[k], cand = n, j = 2;
      while (used[cand.toLowerCase()] || validName(cand, k, map, extra)) cand = cut(n) + "_" + j++;
      used[cand.toLowerCase()] = 1; map[k] = cand;
    });
    c.keys.forEach(function (k) { list.push({ key: k, name: map[k], renamed: !!renames[k] && renames[k] === map[k], main: k === c.main }); });
    return { main: c.main, keys: c.keys, map: map, list: list };
  }

  /**
   * The servers of a plan that the generated text really uses — "{Name}" (VuGen) or "${Name}" (DevWeb).
   * A server can be planned but never written (e.g. found only in a header of a request that is listed as a page
   * resource, which carries no headers): it is not declared.
   */
  function usedKeys(p, text) {
    if (!p || !p.keys) return [];
    text = String(text || "");
    return p.keys.filter(function (k) { return text.indexOf("{" + p.map[k] + "}") >= 0; });
  }

  exports.usedKeys = usedKeys;
  exports.hostKey = hostKey;
  exports.hostName = hostName;
  exports.isPageLoad = isPageLoad;
  exports.collect = collect;
  exports.defaultNames = defaultNames;
  exports.validName = validName;
  exports.plan = plan;
  exports.MAX_LEN = MAX_LEN;
})(typeof module !== "undefined" && module.exports ? module.exports : (window.HostParams = {}));
