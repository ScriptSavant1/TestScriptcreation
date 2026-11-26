// End-to-end test of the floating bar (0.3.0) in the real recording browser: the real recorder from the sources,
// started as the PerfX Studio page starts it, against a local test site; Playwright attaches to the recording
// browser to click the bar like a user. Spare ports only (UI 8796, browser 9336 — never a user's own 8787).
// CDP_RECORDER_BAR_TEST=1 gives the bar an open shadow root so Playwright can reach its buttons.
//
// Checks: the bar in the first page; Enter ends the running transaction and starts the next (no End); the details
// (list, counts, rename, Undo); a page with a strict Content-Security-Policy and Trusted Types; above the
// application's own modal dialog and still clickable; keys typed in the bar never reach the page; a sign-in pop-up
// (500 px) gets the same bar, compact; the dock button (remembered in its file); Alt+Shift+H; Stop and save from the
// bar; nothing of the bar in the HAR; the bar off (bar: false).
//
// Run from cdp-recorder/recorder/:  node tests-manual/floating-bar.mjs [edge|chrome] [shots-folder]
// The packaged program:               CDP_RECORDER_EXE=dist/cdp-recorder.exe node tests-manual/floating-bar.mjs
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const browserName = process.argv[2] || "edge";
const SHOTS = process.argv[3] || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const UI = 8796, CDP_PORT = 9336;
const API = `http://127.0.0.1:${UI}`;
const PORTAL = "http://portal.test:3999";
const failures = [];
const check = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"} - ${msg}`); if (!cond) failures.push(msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (method, path, body) => {
  const headers = { Origin: PORTAL };
  if (body) headers["Content-Type"] = "application/json";
  const r = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await r.json(); } catch { /* no body */ }
  return { status: r.status, json };
};
// a drag as a person makes it: about two seconds, so the bar's state arrives (every 0.7 s) during it
const slowDrag = async (p, x0, y0, x1, y1) => {
  await p.mouse.move(x0, y0); await p.mouse.down();
  for (let i = 1; i <= 30; i++) { await p.mouse.move(x0 + (x1 - x0) * i / 30, y0 + (y1 - y0) * i / 30); await new Promise((r) => setTimeout(r, 70)); }
  await p.mouse.up();
};
const status = async () => (await call("GET", "/api/status")).json;

// ── the test site ──
const page = (title, body, headers) => ({ title, body, headers: headers || {} });
const PAGES = {
  "/select": page("Product selection | Example Shop", `<h1>Select</h1><p id="keys">0</p><button id="pop" onclick="window.open('/signin','signin','width=500,height=600')">Sign in</button>
    <script>let k=0;document.addEventListener('keydown',()=>{document.getElementById('keys').textContent=String(++k)});fetch('/api/one')</script>`),
  "/strict": page("Strict page | Example Shop", `<h1>Strict</h1><script src="/strict.js"></script>`,
    { "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; require-trusted-types-for 'script'; trusted-types none" }),
  "/modal": page("Modal | Example Shop", `<h1>Modal</h1><dialog id="d"><p>Accept cookies?</p><button>Accept</button></dialog><script>document.getElementById('d').showModal()</script>`),
  "/signin": page("Sign in | Example Login", `<h1>Sign in</h1><input placeholder="user"><script>fetch('/api/login')</script>`),
};
const fixture = createServer((req, res) => {
  const p = PAGES[req.url];
  if (p) { res.writeHead(200, { "Content-Type": "text/html", ...p.headers }); res.end(`<!doctype html><html><head><title>${p.title}</title></head><body>${p.body}</body></html>`); return; }
  if (req.url === "/strict.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); res.end("fetch('/api/strict')"); return; }
  if (req.url.startsWith("/api/")) { res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"ok":true}'); return; }
  res.writeHead(404); res.end();
});
await new Promise((r) => fixture.listen(0, "127.0.0.1", r));
const site = `http://127.0.0.1:${fixture.address().port}`;
const out = mkdtempSync(join(tmpdir(), "cdp-bar-test-"));
const barFile = join(out, "floating-bar.json");
const env = { ...process.env, CDP_RECORDER_BAR_TEST: "1", CDP_RECORDER_BAR_FILE: barFile, CDP_RECORDER_ALLOWED_FILE: join(out, "allowed.json") };
// CDP_RECORDER_EXE=dist/cdp-recorder.exe: the packaged program instead of the sources
const EXE = process.env.CDP_RECORDER_EXE;
// started as the PerfX Studio page starts it (a perfx-recorder: link) — such a recorder closes itself once a saved
// recording's windows have closed (0.3.1), so the test starts it again for the part after
let log = "";
const startApp = () => {
  const a = spawn(EXE || process.execPath, [...(EXE ? [] : ["--import", "tsx", "src/main.ts"]), "--ui-port", String(UI), "--cdp-port", String(CDP_PORT), "--out", out, "--portal", `perfx-recorder://start?portal=${encodeURIComponent(PORTAL + "/converter/")}`],
    { stdio: ["ignore", "pipe", "pipe"], env });
  a.stdout.on("data", (d) => (log += d));
  a.stderr.on("data", (d) => (log += d));
  return a;
};
let app = startApp();

const BAR = "perfx-recorder-bar";
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: join(SHOTS, name + ".png") }); };
let pw;
try {
  for (let i = 0; i < 40; i++) { await wait(250); try { await fetch(API + "/api/status"); break; } catch { /* starting */ } }
  check((await status()).version === "0.3.3", "version 0.3.3");
  const s = await call("POST", "/api/session", { url: site + "/select", browser: browserName, private: true, name: "Booking", firstTx: "T01_Launch", plan: "Launch\nAdd to basket\nCheckout" });
  check(s.status === 200, "Start recording — " + s.status + " " + JSON.stringify(s.json));

  pw = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const ctx = pw.contexts()[0];
  let p;
  for (let i = 0; i < 40 && !p; i++) { p = ctx.pages().find((x) => x.url().includes("/select")); if (!p) await wait(250); }
  check(!!p, "the recording window shows the application");
  const size = await p.evaluate(() => [outerWidth, outerHeight, screen.availWidth, screen.availHeight]);
  check(size[0] >= size[2] - 4 && size[1] >= size[3] - 4, "the recording window opens maximised: " + size.join(" × "));
  await p.setViewportSize({ width: 1366, height: 768 }).catch(() => {});
  const bar = (q) => p.locator(`${BAR} ${q}`);
  await bar(".pill").waitFor({ timeout: 15000 }).catch(() => {});
  check(await bar(".pill").isVisible(), "the floating bar is in the first page");
  await wait(3500);
  check((await status()).toolbarOpen === false, "no separate toolbar window — the bar holds what it held");
  if (!(await bar(".pill").isVisible())) { console.log("DEBUG url", p.url(), "pages", ctx.pages().map((x) => x.url()).join(" | "), "contexts", pw.contexts().length, "hosts", await p.evaluate(() => document.querySelectorAll("perfx-recorder-bar").length), "shadow", await p.evaluate(() => { const h = document.querySelector("perfx-recorder-bar"); return h ? String(!!h.shadowRoot) + " " + (h.shadowRoot ? h.shadowRoot.innerHTML.slice(0, 200) : "") : "-"; })); if (SHOTS) await p.screenshot({ path: join(SHOTS, "00-debug.png") }); }
  check(/T01_Launch/.test(await bar(".txn b").textContent()), "it shows the running transaction T01_Launch");
  check(await bar('button:has-text("End")').count() === 0, "no End button");
  check((await bar(".box input").getAttribute("placeholder")) === "Add to basket", "the hint is the next planned step: " + await bar(".box input").getAttribute("placeholder"));
  await shot(p, "01-first-page");

  // keys typed in the bar never reach the page
  await bar(".box input").click(); await p.keyboard.type("Add to basket"); await p.keyboard.press("Enter");
  await wait(600);
  check((await p.textContent("#keys")) === "0", "keys typed in the bar did not reach the page");
  let st = await status();
  check(st.activeTransaction === "T02_Add_to_basket" && st.transactions.includes("T01_Launch"), "Enter ended T01_Launch and started T02_Add_to_basket — " + st.activeTransaction);
  check(/T01_Launch ended · T02_Add_to_basket started/.test(await bar(".toast").textContent().catch(() => "")), "the message says both");

  // details: list, counts, rename, Undo
  await bar('button[aria-expanded]').click(); await wait(300);
  check(await bar(".tl li").count() === 2, "the details list both transactions");
  check(/request/.test(await bar(".tl li.live .c").textContent()), "with their request counts");
  await shot(p, "02-details");
  await bar(".tl li:first-child .ren").click(); await bar(".tl input").fill("Home"); await bar(".tl input").press("Enter"); await wait(500);
  st = await status();
  check(st.transactions.includes("T01_Home"), "rename in the bar: T01_Launch → T01_Home");
  await bar('.box input').fill("Oops"); await bar('.box input').press("Enter"); await wait(400);
  await bar('button:has-text("Undo last mark")').click(); await wait(400);
  st = await status();
  check(st.activeTransaction === "T02_Add_to_basket", "Undo last mark took back T03_Oops — " + st.activeTransaction);
  await bar('button[aria-expanded]').click();

  // a strict page (CSP + Trusted Types)
  await p.goto(site + "/strict"); await bar(".pill").waitFor({ timeout: 10000 }).catch(() => {});
  const bg = await bar(".pill").evaluate((e) => getComputedStyle(e).backgroundColor).catch(() => "");
  check(bg === "rgb(23, 20, 42)", "on a page with a strict security policy the bar is there, styled: " + bg);
  await shot(p, "03-strict-page");

  // above the application's own modal dialog, and clickable
  await p.goto(site + "/modal"); await bar(".pill").waitFor({ timeout: 10000 }).catch(() => {});
  await wait(1500);
  const onTop = await p.evaluate((tag) => { const b = document.querySelector(tag); if (!b) return "no bar"; const el = document.elementFromPoint(innerWidth / 2, 30); return el === b ? "bar" : el ? el.tagName : "none"; }, BAR);
  check(onTop === "bar", "above the application's modal dialog: " + onTop);
  await bar(".box input").fill("Checkout"); await bar('button:has-text("Mark")').click(); await wait(500);
  check((await status()).activeTransaction === "T03_Checkout", "Mark works over the modal dialog");
  await shot(p, "04-over-modal");

  // a sign-in pop-up (500 px): the same bar, compact
  await p.goto(site + "/select"); await bar(".pill").waitFor({ timeout: 10000 }).catch(() => {});
  const [pop] = await Promise.all([ctx.waitForEvent("page", { timeout: 10000 }), p.click("#pop")]);
  await pop.waitForLoadState().catch(() => {});
  await pop.setViewportSize({ width: 500, height: 600 }).catch(() => {});
  const pb = (q) => pop.locator(`${BAR} ${q}`);
  await pb(".pill").waitFor({ timeout: 10000 }).catch(() => {});
  check(await pb(".pill").isVisible(), "the pop-up has the bar too");
  await wait(1200);
  const shown = async (pg) => pg.evaluate((tag) => { const h = document.querySelector(tag); return !!h && getComputedStyle(h).display !== "none"; }, BAR);
  check(!(await shown(p)), "one bar on screen: the main window hides its bar while the pop-up is in front");
  await p.mouse.click(600, 500); await wait(1200);
  check((await shown(p)) && !(await shown(pop)), "a click in the main window moves the bar there (the pop-up hides it)");
  await pop.mouse.click(250, 400); await wait(1200);
  check((await shown(pop)) && !(await shown(p)), "a click in the pop-up moves it back");
  check(/T03_Checkout/.test(await pb(".narrow").textContent().catch(() => "")) || /T03_Checkout/.test(await pb(".txn b").textContent().catch(() => "")), "with the same recording (T03_Checkout)");
  const fits = await pop.evaluate((tag) => { const r = document.querySelector(tag).shadowRoot; const pill = r.querySelector(".pill").getBoundingClientRect(); return [...r.querySelectorAll(".pill button")].filter((b) => b.offsetParent).every((b) => b.getBoundingClientRect().right <= Math.min(pill.right, innerWidth) + 1); }, BAR);
  check(fits, "every button of the bar fits a 500 px pop-up");
  // the bar keeps its look in a pop-up (0.3.3): a pop-up starts as an empty page and the bar made for it is moved
  // into the real page — the browser drops a style sheet made for another page
  const styled = async (pg) => pg.evaluate((tag) => { const r = document.querySelector(tag).shadowRoot, pill = r.querySelector(".pill"); return (r.adoptedStyleSheets.length > 0 || !!r.querySelector("style")) && getComputedStyle(pill).backgroundColor !== "rgba(0, 0, 0, 0)" && getComputedStyle(pill).display === "flex"; }, BAR);
  check(await styled(pop), "the bar in the pop-up has its look (style sheet, dark pill)");
  check(await styled(p), "the bar in the main window has its look");
  await shot(pop, "05-popup-500");
  await pop.close();
  await p.bringToFront(); await wait(1500);
  check(await shown(p), "the pop-up closed: the bar is back in the main window");

  // dock to the bottom: remembered in its file, every window follows
  await bar(".dockb").click(); await wait(500);
  check(existsSync(barFile) && JSON.parse(readFileSync(barFile, "utf8")).dock === "bottom", "the bar's place is remembered (floating-bar.json)");
  await wait(900);
  check(/bottom/.test(await bar(".fb").getAttribute("class")), "the bar moved to the bottom");
  await shot(p, "06-bottom");
  await bar(".dockb").click(); await wait(300);

  // drag anywhere (0.3.1): it stays where it is let go — no snapping — and the place is remembered; a double-click on
  // the grip puts it back at the top, in the middle
  {
    await wait(600);
    await bar(".grip").waitFor({ state: "visible", timeout: 10000 }).catch(() => {});   // after the dock change the bar is drawn again
    const g = await bar(".grip").boundingBox(), f0 = await bar(".fb").boundingBox(), off = g.y + g.height / 2 - f0.y, vw = await p.evaluate(() => innerWidth), vh = await p.evaluate(() => innerHeight);
    const tx = Math.round(vw * 0.3), ty = Math.round(vh * 0.55);
    await slowDrag(p, g.x + g.width / 2, g.y + g.height / 2, tx, ty); await wait(900);
    const fb = await bar(".fb").boundingBox(), saved = existsSync(barFile) ? JSON.parse(readFileSync(barFile, "utf8")) : {};
    check(Math.abs(fb.y - (ty - off)) < 12 && fb.y > vh * 0.35, "a dropped bar stays where it is let go (" + Math.round(fb.x) + ", " + Math.round(fb.y) + ")");
    check(typeof saved.x === "number" && typeof saved.y === "number" && saved.y > 0.3, "the dropped place is remembered (x " + saved.x + ", y " + saved.y + ")");
    await shot(p, "06b-dropped");
    await bar(".grip").dblclick(); await wait(900);
    const back = await bar(".fb").boundingBox(), reset = JSON.parse(readFileSync(barFile, "utf8"));
    check(back.y < 40 && reset.x === undefined, "a double-click on the grip puts it back at the top");
    // not only by the grip: by the bar itself (REC, the time) — anything that is not a button or the name box
    const rec = await bar(".pill .rec").boundingBox();
    await slowDrag(p, rec.x + rec.width / 2, rec.y + rec.height / 2, Math.round(vw * 0.5), Math.round(vh * 0.7)); await wait(900);
    const byRec = await bar(".fb").boundingBox();
    check(byRec.y > vh * 0.5, "the bar also moves when dragged by REC, not only by its grip (" + Math.round(byRec.x) + ", " + Math.round(byRec.y) + ")");
    await bar(".grip").dblclick(); await wait(600);
  }

  // Alt+Shift+H
  await p.keyboard.press("Alt+Shift+H"); await wait(300);
  check(/hide/.test(await bar(".fb").getAttribute("class")), "Alt+Shift+H hides the bar");
  await p.keyboard.press("Alt+Shift+H"); await wait(300);
  check(!/hide/.test(await bar(".fb").getAttribute("class")), "Alt+Shift+H brings it back");

  // Stop and save from the bar
  await bar(".b.stop").click();
  for (let i = 0; i < 40; i++) { await wait(250); st = await status(); if (!st.recording && st.lastHarPath) break; }
  check(!st.recording && !!st.lastHarPath, "Stop and save from the bar saved " + (st.lastHarPath || "").split(/[\\/]/).pop());
  const har = JSON.parse(readFileSync(st.lastHarPath, "utf8"));
  const urls = har.log.entries.map((e) => e.request.url);
  check(urls.length > 0 && !urls.some((u) => /perfx|8796|__perfxBar/i.test(u)), "nothing of the bar in the HAR (" + urls.length + " requests)");
  check(har.log.pages.map((x) => x.title).join(",") === "T01_Home,T02_Add_to_basket,T03_Checkout", "transactions in the HAR: " + har.log.pages.map((x) => x.title).join(","));
  await wait(4500);
  check(await p.locator(BAR).count() === 0, "after saving, the bar goes from the page");
  await pw.close().catch(() => {}); pw = null;

  // started by the link: once the saved recording's windows close (after 10 s), the recorder closes itself — its
  // console window too; Start recording starts it again
  {
    let gone = app.exitCode !== null;
    const exited = new Promise((r) => app.once("exit", () => { gone = true; r(); }));
    await Promise.race([exited, wait(25000)]);
    check(gone, "started by the link, the recorder closes itself after the saved recording's windows close");
    app = startApp();
    for (let i = 0; i < 60; i++) { if (await status().catch(() => null)) break; await wait(250); }
  }

  // the bar off
  const s2 = await call("POST", "/api/session", { url: site + "/select", browser: browserName, private: true, name: "NoBar", bar: false });
  check(s2.status === 200, "Start recording without the bar");
  pw = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  let p2;
  for (let i = 0; i < 40 && !p2; i++) { p2 = pw.contexts()[0].pages().find((x) => x.url().includes("/select")); if (!p2) await wait(250); }
  await wait(1500);
  check(!!p2 && (await p2.locator(BAR).count()) === 0, "bar: false — no bar in the page");
  let tbOpen = false;
  for (let i = 0; i < 40 && !tbOpen; i++) { await wait(250); tbOpen = (await status()).toolbarOpen === true; }
  check(tbOpen, "bar: false — the toolbar window opens, as before");
  await call("POST", "/api/stop", {});
} catch (err) {
  check(false, "test error: " + err.message);
} finally {
  if (pw) await pw.close().catch(() => {});
  await call("POST", "/api/quit").catch(() => {});
  await wait(2500);
  app.kill();
  fixture.close();
  try { rmSync(out, { recursive: true, force: true }); } catch { /* still in use */ }
}
if (failures.length) { console.log("\n" + log.split("\n").filter((l) => /warn|error|bar/i.test(l)).slice(-25).join("\n")); }
console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
process.exit(failures.length ? 1 : 0);
