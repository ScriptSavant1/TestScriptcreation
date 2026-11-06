/**
 * portal-mode.js — pure helpers for recording started from the PerfX Studio Recorder page.
 *
 * The page starts the recorder through a link registered for the current Windows user
 * (perfx-recorder://start?portal=<the portal's origin>), then drives it over the local
 * control server. No browser, file system or registry access here — those stay in
 * portal-link.ts / server.ts — so tests/unit/cdpPortalMode.test.js can load this file
 * the same way as har-builder.js.
 */

export const LINK_SCHEME = "perfx-recorder";

/** Origin "scheme://host[:port]" of an http(s) address, or null. Never uses the path. */
export function originOf(value) {
  const m = /^(https?):\/\/([^/?#\s]+)/i.exec(String(value || "").trim());
  if (!m) return null;
  const host = m[2].replace(/^[^@]*@/, "").toLowerCase(); // drop user:pass@
  if (!/^[a-z0-9.\-[\]:]+$/.test(host)) return null;
  return m[1].toLowerCase() + "://" + host;
}

/**
 * perfx-recorder://start?portal=https%3A%2F%2Fhost → { action: "start", portal: "https://host" }.
 * Only the portal's origin travels in the link — never an application address, so a web
 * page cannot make the recorder open anything by itself. Null when the link is not ours.
 */
export function parsePortalLink(link) {
  const s = String(link || "").trim();
  const m = new RegExp("^" + LINK_SCHEME + ":(?://)?([a-z]+)/?(?:\\?(.*))?$", "i").exec(s);
  if (!m) return null;
  const params = {};
  for (const part of (m[2] || "").split("&")) {
    if (!part) continue;
    const i = part.indexOf("=");
    const k = decodeURIComponent((i < 0 ? part : part.slice(0, i)).replace(/\+/g, " "));
    let v = "";
    try { v = decodeURIComponent((i < 0 ? "" : part.slice(i + 1)).replace(/\+/g, " ")); } catch { v = ""; }
    params[k] = v;
  }
  return { action: m[1].toLowerCase(), portal: originOf(params.portal) };
}

/** The command Windows runs for the link: the .exe, in portal mode, with the link as one argument. */
export function linkCommand(exePath) {
  return `"${exePath}" --portal "%1"`;
}

/**
 * Who is calling the control server:
 *   "local"  — no Origin header: a program on this computer (a second cdp-recorder.exe), not a web page
 *   "self"   — the floating toolbar (served by this server)
 *   "portal" — a PerfX Studio page whose origin arrived through the link
 *   "other"  — any other web page
 */
export function originAccess(origin, uiPort, portals) {
  if (!origin) return "local";
  const o = originOf(origin);
  if (!o) return "other";
  if (o === `http://localhost:${uiPort}` || o === `http://127.0.0.1:${uiPort}`) return "self";
  return portals && portals.has(o) ? "portal" : "other";
}

/** "SC01 Booking" + date → "SC01_Booking_2026-10-30_1442.har" (safe on Windows). */
export function harFileName(name, date) {
  const d = date || new Date();
  const p = (n) => String(n).padStart(2, "0");
  const base = String(name || "").trim().replace(/[^\w.-]+/g, "_").replace(/^[._]+|[._]+$/g, "").slice(0, 80) || "Recording";
  return `${base}_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.har`;
}

/** %USERPROFILE%\Downloads → C:\Users\x\Downloads (REG_EXPAND_SZ values in "User Shell Folders"). */
export function expandEnv(value, env) {
  return String(value || "").replace(/%([^%]+)%/g, (all, k) => {
    const key = Object.keys(env || {}).find((x) => x.toLowerCase() === k.toLowerCase());
    return key ? env[key] : all;
  });
}

/** Checks the body of POST /api/session. Returns { ok, url, browser, private, name, firstTx } or { ok: false, error }. */
export function readSession(body) {
  const b = body || {};
  const url = String(b.url || "").trim();
  if (!/^https?:\/\/[^\s/?#]+/i.test(url)) return { ok: false, error: "Enter an address starting with http:// or https://" };
  const browser = String(b.browser || "edge").toLowerCase();
  if (browser !== "edge" && browser !== "chrome") return { ok: false, error: "The browser must be Edge or Chrome" };
  const clean = (v, n) => String(v || "").trim().slice(0, n);
  return { ok: true, url, browser, private: b.private !== false, name: clean(b.name, 80), firstTx: clean(b.firstTx, 80) };
}

/**
 * One row of the live list on the Recorder page, from a har-builder entry (pending or finished).
 * `background` comes from bg-detector (a confirmed periodic call) — the HAR's own _perfx_class is
 * only stamped at stop.
 */
export function liveRow(entry, n, txNames, background) {
  const req = entry.request || {};
  const res = entry.response || {};
  const mime = (res.content && res.content.mimeType) || "";
  return {
    n,
    method: req.method || "GET",
    url: req.url || "",
    status: typeof res.status === "number" && res.status > 0 ? res.status : 0,
    type: entry._resourceType || "Other",
    mime: mime.split(";")[0],
    tx: entry.pageref ? txNames[entry.pageref] || null : null,
    background: !!background,
    tab: entry._tabId || "",
    done: !!entry._finishedTimestamp || res.status !== undefined,
  };
}

/**
 * A page asking to be allowed (POST /api/ask) when the recorder was started by hand — the link that would
 * hand it the page's origin cannot always start a program. The toolbar shows the question; nothing is
 * allowed until someone clicks Allow there. One question at a time; it lapses after `holdMs`; after
 * "Don't allow" the same page is not asked about again for `denyMs`.
 */
export function createAskQueue(opts) {
  const o = opts || {};
  const holdMs = o.holdMs || 120000, denyMs = o.denyMs || 60000, now = o.now || Date.now;
  let pending = null; // { origin, at }
  const denied = new Map(); // origin → when
  const tidy = () => {
    if (pending && now() - pending.at > holdMs) pending = null;
    for (const [k, t] of denied) if (now() - t > denyMs) denied.delete(k);
  };
  return {
    /** "pending" (the toolbar asks), "busy" (another page is being asked about) or "denied" (asked again too soon). */
    ask(origin) {
      tidy();
      if (denied.has(origin)) return "denied";
      if (pending) return pending.origin === origin ? "pending" : "busy";
      pending = { origin, at: now() };
      return "pending";
    },
    /** The toolbar's answer about `origin` → true when that page is now allowed; false when it was not the question. */
    answer(origin, allow) {
      tidy();
      if (!pending || pending.origin !== origin) return false;
      pending = null;
      if (!allow) denied.set(origin, now());
      return !!allow;
    },
    /** The page the toolbar asks about now, or null. */
    pending() {
      tidy();
      return pending ? pending.origin : null;
    },
    /** For the asking page's status: "pending", "denied" or null. */
    stateOf(origin) {
      tidy();
      if (pending && pending.origin === origin) return "pending";
      return denied.has(origin) ? "denied" : null;
    },
  };
}

/** The remembered pages file (JSON {"pages": [origins]}) → the valid origins in it; anything else is ignored. */
export function readAllowedPages(text) {
  let j;
  try { j = JSON.parse(String(text || "")); } catch { return []; }
  const list = j && Array.isArray(j.pages) ? j.pages : [];
  const out = [];
  for (const p of list) {
    const o = originOf(p);
    if (o && out.indexOf(o) < 0) out.push(o);
  }
  return out;
}
