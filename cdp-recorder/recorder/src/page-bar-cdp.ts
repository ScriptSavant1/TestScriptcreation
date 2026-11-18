/**
 * page-bar-cdp.ts — puts the floating bar (page-bar.js) into every recorded page and answers it.
 *
 * Each page target, while it is still paused at attach (cdp-capture.ts handleAttached): a binding only the bar's
 * isolated world can see (Runtime.addBinding with executionContextName), then the bar's source for every new
 * document of that target (Page.addScriptToEvaluateOnNewDocument with worldName; runImmediately for a page already
 * open when recording starts). The bar asks through the binding (Runtime.bindingCalled, with its context id); the
 * answer is Runtime.evaluate in that same context. No network request, so nothing of the bar is in the HAR.
 *
 * server.ts supplies the state (setBarState) and handles the actions (setBarActions): mark, undo, rename, stop,
 * prefs. Off with setBarEnabled(false) (the Start recording option, or --no-bar).
 */
import type CDP from "chrome-remote-interface";
import { randomBytes } from "node:crypto";
import { BAR_WORLD, barScript } from "./page-bar.js";

type Client = CDP.Client;
type Send = (method: string, params: object | undefined, sessionId?: string) => Promise<unknown>;

export interface BarNote { text: string; bad?: boolean; scroll?: boolean }
export type BarAction = { act: string; name?: string; from?: string; to?: string; prefs?: unknown; title?: string; used?: number };

const BINDING = "__perfxBar_" + randomBytes(6).toString("hex");
let enabled = true;
let stateOf: () => unknown = () => null;
let actions: (a: BarAction) => Promise<BarNote | null> = async () => null;
// the bar's context in each page session (the latest one asking: a new document gets a new context)
const contexts = new Map<string, number>();
// ONE bar on screen: the one in the recorded window the user works in (the last one whose page had the focus).
// The others hide theirs; clicking into another recorded window moves the bar there at its next ask (700 ms).
let front = "", frontAt = 0;
const seenSessions = new Set<string>();
let wired: Client | null = null;
const DEBUG = process.env.CDP_RECORDER_BAR_TEST === "1";
const seen = new Set<string>(), answered = new Set<string>();

export function setBarEnabled(on: boolean): void { enabled = on; }
export function barEnabled(): boolean { return enabled; }
export function setBarState(fn: () => unknown): void { stateOf = fn; }
export function setBarActions(fn: (a: BarAction) => Promise<BarNote | null>): void { actions = fn; }

const send = (client: Client): Send => (method, params, sessionId) => (client.send as unknown as Send).call(client, method, params, sessionId);

/**
 * Called for each page target before it is resumed. Adds NO delay: the commands are sent and not waited for — the
 * browser runs a session's commands in order, so they are in place before the resume that cdp-capture sends next.
 * Never throws: the recording goes on without a bar.
 */
export function setupBar(client: Client, sessionId: string): void {
  if (DEBUG) console.log("[cdp-recorder] floating bar setup " + sessionId + " enabled=" + enabled);
  if (!enabled || process.env.CDP_RECORDER_NO_BAR === "1") return;
  wire(client);
  const s = send(client);
  const warn = (err: unknown) => { if (!warned.has(sessionId)) { warned.add(sessionId); console.warn(`[cdp-recorder] the floating bar could not be added to a page (${(err as Error).message}) — recording goes on`); } };
  // the bar's calls (Runtime.bindingCalled) are only reported with the Runtime domain on
  s("Runtime.enable", undefined, sessionId).catch(warn);
  // without the Page domain on, the bar's world is not created again on the next document (a navigation)
  s("Page.enable", undefined, sessionId).catch(warn);
  s("Runtime.addBinding", { name: BINDING, executionContextName: BAR_WORLD }, sessionId).catch(warn);
  // CDP_RECORDER_BAR_TEST=1 (tests-manual/floating-bar.mjs only): an open shadow root, so the test can click the bar
  const params = { source: barScript(BINDING, { open: process.env.CDP_RECORDER_BAR_TEST === "1" }), worldName: BAR_WORLD };
  // runImmediately: also the page already open when recording starts (a browser too old for it: new documents only)
  s("Page.addScriptToEvaluateOnNewDocument", { ...params, runImmediately: true }, sessionId)
    .catch(() => s("Page.addScriptToEvaluateOnNewDocument", params, sessionId).catch(warn));
}
const warned = new Set<string>();

function wire(client: Client): void {
  if (wired === client) return;
  wired = client;
  client.on("Runtime.bindingCalled", (params: unknown, sessionId?: string) => {
    const p = params as { name: string; payload: string; executionContextId: number };
    if (DEBUG && p.name === BINDING && !seen.has(sessionId || "")) { seen.add(sessionId || ""); console.log("[cdp-recorder] floating bar asks from session " + sessionId); }
    if (!sessionId || p.name !== BINDING) return;
    contexts.set(sessionId, p.executionContextId);
    let a: BarAction;
    try { a = JSON.parse(p.payload) as BarAction; } catch { return; }
    handle(client, sessionId, p.executionContextId, a).catch((err) => console.warn(`[cdp-recorder] floating bar: ${(err as Error).message}`));
  });
  client.on("Target.detachedFromTarget", (params: unknown) => {
    const sid = (params as { sessionId: string }).sessionId;
    contexts.delete(sid);
    // the window in front closed (a pop-up): the bar goes back to the window opened last before it
    if (front === sid) front = [...contexts.keys()].pop() || "";
  });
}

async function handle(client: Client, sessionId: string, contextId: number, a: BarAction): Promise<void> {
  let note: BarNote | null = null;
  // a window opened during the recording (pop-up, new tab or window) takes the bar at once; afterwards the window
  // clicked or typed in last has it
  if (!seenSessions.has(sessionId)) { seenSessions.add(sessionId); front = sessionId; frontAt = Date.now(); }
  else if (typeof a.used === "number" && a.used > frontAt) { front = sessionId; frontAt = a.used; }
  else if (!front || !contexts.has(front)) front = sessionId;
  if (a.act !== "poll") {
    try { note = await actions(a); } catch (err) { note = { text: (err as Error).message, bad: true }; }
    // every other window shows the new state at its next poll; this one at once, with the message
  }
  await answer(client, sessionId, contextId, note);
}

async function answer(client: Client, sessionId: string, contextId: number, note: BarNote | null): Promise<void> {
  const expr = `globalThis.__perfxBarUpdate && globalThis.__perfxBarUpdate(${JSON.stringify(stateOf())}, ${JSON.stringify(note)}, ${front === sessionId})`;
  try {
    const r = (await send(client)("Runtime.evaluate", { expression: expr, contextId }, sessionId)) as { exceptionDetails?: { exception?: { description?: string } } };
    if (DEBUG && !answered.has(sessionId)) { answered.add(sessionId); console.log("[cdp-recorder] floating bar first answer: " + JSON.stringify(r).slice(0, 300)); }
    if (r && r.exceptionDetails && DEBUG) console.warn("[cdp-recorder] floating bar error in the page: " + (r.exceptionDetails.exception?.description || "").split(/\r?\n/)[0]);
  } catch (err) { if (DEBUG) console.warn("[cdp-recorder] floating bar answer: " + (err as Error).message); /* the page navigated or closed */ }
}

/** Tells every bar the recording is being saved (before the sessions are detached) — each removes itself shortly after. */
export async function barsFinal(client: Client | undefined): Promise<void> {
  if (!client || !enabled) return;
  await Promise.all([...contexts].map(([sid, ctx]) => answer(client, sid, ctx, null)));
}

/** Hides (or shows again) the bar in these page sessions — around the transaction screenshots. */
export async function barsHidden(client: Client, sessionIds: string[], hidden: boolean): Promise<void> {
  if (!enabled) return;
  await Promise.all(sessionIds.map(async (sid) => {
    const ctx = contexts.get(sid);
    if (ctx === undefined) return;
    try { await send(client)("Runtime.evaluate", { expression: `globalThis.__perfxBarHide && globalThis.__perfxBarHide(${hidden})`, contextId: ctx }, sid); } catch { /* gone */ }
  }));
}

export function resetBars(): void { contexts.clear(); seenSessions.clear(); front = ""; frontAt = 0; }
