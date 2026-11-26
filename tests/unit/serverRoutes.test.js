/**
 * Route registration of the web server (src/web/server.js): every route answers at the bare root AND under
 * /converter — the portal's links are built from the page's own address, which is '' or '/converter' (BUG-EXT-013
 * reached a user because nothing exercised Express route matching).
 *
 * The real app is started on a free port with a throwaway analytics database and admin token. A route counts as
 * registered when its answer is its own — never the catch-all 404 page.
 */
"use strict";

const os = require("os");
const fs = require("fs");
const path = require("path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "perfx-routes-"));
process.env.ANALYTICS_DB_PATH = path.join(TMP, "analytics.db");
process.env.ADMIN_TOKEN = "route-test-token";
process.env.PERFX_LOG_DIR = TMP;

const web = require("../../src/web/server.js");
const NOT_FOUND = fs.readFileSync(path.join(__dirname, "../../src/web/public/404.html"), "utf8");

let server, base;
beforeAll(async () => {
  await new Promise((resolve) => { server = web.app.listen(0, "127.0.0.1", resolve); });
  base = "http://127.0.0.1:" + server.address().port;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  try { require("../../src/analytics/db.js").close?.(); } catch (e) { /* not opened */ }
});

const get = (p, opts) => fetch(base + p, { redirect: "manual", ...opts });
const text = async (r) => (r.body ? await r.text() : "");
const isCatchAll = (body) => body === NOT_FOUND;
const BOTH = (p) => [p, "/converter" + p];

describe("pages", () => {
  test("the portal answers at / and /converter/; /converter goes to /converter/", async () => {
    for (const p of ["/", "/converter/"]) {
      const r = await get(p);
      expect(r.status).toBe(200);
      expect(await text(r)).toContain("PerfX Studio");
    }
    const r = await get("/converter");
    expect(r.status).toBe(301);
    expect(r.headers.get("location")).toBe("/converter/");
  });

  test.each([
    ["/studio", "data-portal-tool=\"studio\""],
    ["/har-explorer", "data-portal-tool=\"explore\""],
    ["/results-analyser", "data-portal-tool=\"results\""],
    ["/workload-modeller", "data-portal-tool=\"workload\""],
  ])("%s at both addresses", async (p, mark) => {
    for (const u of BOTH(p)) {
      const r = await get(u);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toMatch(/text\/html/);
      expect(await text(r)).toContain(mark);
    }
  });

  test("the Recorder's old addresses open Script Studio", async () => {
    for (const u of BOTH("/recorder")) {
      const r = await get(u);
      expect(r.status).toBe(301);
      expect(r.headers.get("location")).toBe(u.replace(/recorder$/, "studio"));
    }
    for (const u of ["/tools/recorder", "/tools/studio"]) {
      const r = await get(u);
      expect(r.status).toBe(301);
      expect(r.headers.get("location")).toBe("/converter/");
    }
  });

  test("a page's .html address is never served (only routes)", async () => {
    for (const u of ["/Studio.html", "/converter/Studio.html", "/HarExplorer.html"]) {
      const r = await get(u);
      expect(r.status).toBe(404);
      expect(isCatchAll(await text(r))).toBe(true);
    }
  });

  test("an unknown address gets the 404 page", async () => {
    const r = await get("/converter/no-such-page");
    expect(r.status).toBe(404);
    expect(isCatchAll(await text(r))).toBe(true);
  });
});

describe("files the pages load", () => {
  test.each([
    ["/portal/ds.css", /text\/css/],
    ["/portal/shell.js", /javascript/],
    ["/shared/vugen-codegen.js", /javascript/],
    ["/DevWebSdk.d.ts", /./],
    ["/ra/zip.js", /javascript/],
    ["/ra/engine/analyse.js", /javascript/],
    ["/ra/report/format.js", /javascript/],
    ["/wm/app.js", /javascript/],
    ["/wm/engine/workload-engine.js", /javascript/],
  ])("%s at both addresses", async (p, type) => {
    for (const u of BOTH(p)) {
      const r = await get(u);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toMatch(type);
    }
  });

  test("the team settings of the Workload Modeller are never cached", async () => {
    for (const u of BOTH("/wm/config/workload-settings.json")) {
      const r = await get(u);
      expect(r.status).toBe(200);
      expect(r.headers.get("cache-control")).toBe("no-cache");
    }
  });

  test.each([["/dpop-helper.js", "not_found"], ["/lre-utils-helper.js", "not_found"]])("%s at both addresses", async (p, missing) => {
    for (const u of BOTH(p)) {
      const r = await get(u);
      if (r.status === 404) expect((await r.json()).error).toBe(missing); // its own answer, not the catch-all
      else expect(r.status).toBe(200);
    }
  });

  test("the CDP Recorder download at both addresses (the file, or its own 'not built' answer)", async () => {
    for (const u of BOTH("/downloads/cdp-recorder")) {
      const r = await get(u);
      if (r.status === 404) expect((await r.json()).error).toBe("cdp_recorder_not_built");
      else { expect(r.status).toBe(200); expect(r.headers.get("content-disposition")).toMatch(/cdp-recorder\.(zip|exe)/); await r.arrayBuffer(); }
    }
  });
});

describe("converters and service routes", () => {
  test("/convert at both addresses: without a collection, its own 400", async () => {
    for (const u of BOTH("/convert")) {
      const r = await get(u, { method: "POST", body: new FormData() });
      expect(r.status).toBe(400);
      expect((await r.json()).error).toBe("collection_file_required");
    }
  });

  test("/convert-jmx at both addresses: without a test plan, its own 400", async () => {
    for (const u of BOTH("/convert-jmx")) {
      const r = await get(u, { method: "POST", body: new FormData() });
      expect(r.status).toBe(400);
      expect((await r.json()).error).toBe("jmx_file_required");
    }
  });

  test("a download link that does not exist: its own 404", async () => {
    const r = await get("/converter/download/no-such-token");
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe("download_expired");
  });

  test("status and health at both addresses", async () => {
    for (const u of BOTH("/status")) { const r = await get(u); expect(r.status).toBe(200); expect(await r.json()).toHaveProperty("uptime"); }
    for (const u of BOTH("/health")) { const r = await get(u); expect(r.status).toBe(200); expect(await r.json()).toEqual({ status: "ok" }); }
  });

  test("the usage ping at both addresses", async () => {
    for (const u of BOTH("/analytics/track")) {
      const r = await get(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool: "explorer", mode: "test" }) });
      expect(r.status).toBe(204);
    }
  });
});

describe("admin", () => {
  test("signed out: the sign-in page at both addresses; the data needs a sign-in", async () => {
    for (const u of BOTH("/admin")) {
      const r = await get(u);   // the address of the folder: the same with a closing slash
      expect(r.status).toBe(301);
      expect(r.headers.get("location")).toBe(u + "/");
      const s = await get(u + "/");
      expect(s.status).toBe(200);
      expect(await text(s)).toContain("Admin token");
    }
    // signed out, every data address answers with the sign-in page — never the data
    for (const sub of ["/api/stats", "/api/events", "/download/csv", "/download/xlsx", "/download/docx"]) for (const u of BOTH("/admin" + sub)) {
      const r = await get(u);
      expect(r.headers.get("content-type")).toMatch(/text\/html/);
      const body = await text(r);
      expect(body).toContain("Admin token");
      expect(body).not.toMatch(/"total"|PERF-|started_at/);
    }
  });

  test("a wrong token is refused; the right one signs in, at both addresses", async () => {
    for (const pfx of BOTH("/admin")) {
      const bad = await get(pfx + "/login", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "token=wrong" });
      expect(bad.status).toBe(200);
      expect(await text(bad)).toContain("Admin token");
      const ok = await get(pfx + "/login", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "token=route-test-token" });
      expect(ok.status).toBe(302);
      const cookie = (ok.headers.get("set-cookie") || "").split(";")[0];
      expect(cookie).toMatch(/^perfx_admin=/);
      const page = await get(pfx + "/", { headers: { Cookie: cookie } });
      expect(page.status).toBe(200);
      expect(await text(page)).toContain("Usage analytics");
      for (const sub of ["/api/stats", "/api/events", "/download/csv", "/vendor/chart.js"]) {
        const r = await get(pfx + sub, { headers: { Cookie: cookie } });
        expect([sub, r.status]).toEqual([sub, 200]);
        await r.arrayBuffer();
      }
      const out = await get(pfx + "/logout", { headers: { Cookie: cookie } });
      expect(out.status).toBe(302);
    }
  });
});
