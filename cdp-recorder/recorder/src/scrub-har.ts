/**
 * scrub-har.ts — redacts one narrow, unambiguous category of secret from a
 * recorded HAR before it's written to disk: literal one-way credential
 * fields (password, PIN, CVV, etc.) in REQUEST bodies.
 *
 * This is deliberately NOT a general-purpose scrubber. Cookies and auth
 * headers (Authorization, Set-Cookie, session cookies) are left untouched
 * on purpose — Script Studio's correlation engine
 * (src/web/public/VuGen-Script-Studio-correlation.js singleHarCorrelate())
 * reads those exact header/cookie VALUES to detect which ones are dynamic
 * tokens worth extracting into the generated script. Redact them here and
 * every request would show the same literal placeholder, and the engine
 * could never tell "this token came from that earlier response" — breaking
 * the tool's actual purpose. A password field is different: it's a one-way
 * secret the user typed, never something a script re-extracts from a prior
 * response, so redacting it costs nothing.
 *
 * See CDP-RECORDER-IMPLEMENTATION-PLAN.md §6 for the fuller writeup of this
 * tradeoff and why it corrects the plan's original (too broad) scrubbing
 * example.
 *
 * THE RECORDED .har FILE STILL CONTAINS REAL COOKIES, AUTH HEADERS, AND
 * RESPONSE BODIES IN PLAINTEXT. Handle it like credential material — don't
 * email it, attach it to tickets, or store it longer than needed.
 */
const REDACTED = "[REDACTED]";
const SENSITIVE_FIELD_PATTERN = /password|passwd|\bpwd\b|\bpin\b|\bcvv\b|\bcvc\b|secret|ssn|social.?security/i;

function scrubJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubJsonValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_FIELD_PATTERN.test(k) ? REDACTED : scrubJsonValue(v);
    }
    return out;
  }
  return value;
}

function scrubBodyText(text: string, mimeType: string | undefined): string {
  if (!text) return text;
  if (mimeType && mimeType.includes("json")) {
    try {
      return JSON.stringify(scrubJsonValue(JSON.parse(text)));
    } catch {
      /* not valid JSON — fall through to the form-field pass below */
    }
  }
  // Best-effort for form-urlencoded / plain-text bodies: redact "field=value"
  // pairs whose field name looks like a one-way secret, without needing to
  // fully parse the format.
  return text.replace(
    new RegExp(`\\b([\\w.-]*(?:password|passwd|pwd|pin|cvv|cvc|secret)[\\w.-]*)=([^&\\s"']+)`, "gi"),
    (_m, k) => `${k}=${REDACTED}`,
  );
}

/** Mutates and returns the same HAR object — call once, right before writing it to disk. */
export function scrubHar(har: { log?: { entries?: unknown[] } }): typeof har {
  for (const entry of har?.log?.entries ?? []) {
    const postData = (entry as { request?: { postData?: { text?: string; mimeType?: string } } }).request?.postData;
    if (postData?.text) {
      postData.text = scrubBodyText(postData.text, postData.mimeType);
    }
  }
  return har;
}
