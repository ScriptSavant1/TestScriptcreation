# Correlation Logic — How It Works
## A Plain-English Guide for the Whole Team

---

## What is a Correlation?

When you record a load test, the browser and server talk to each other.
Sometimes the server sends back a **temporary value** (like a login token, a session ID, or a generated order number)
and the browser uses that value in a **later request**.

If you hardcode that value in your script, it only works once.
Every new test run the server sends back a **different** value — so your hardcoded value becomes stale and the test fails.

**Correlation** = automatically capturing that value at runtime and reusing it wherever it appears.

```
Without correlation:
  Request 5 sends: { "token": "ABC123" }   ← hardcoded, breaks on next run

With correlation:
  Request 3 response: { "token": "ABC123" }  ← captured at runtime into a variable
  Request 5 sends:    { "token": <variable> } ← uses the variable instead
```

---

## The Golden Rule of Correlation

```
Server REPLY produces a value  →  Browser REQUEST consumes it
```

The direction is always **left to right in time**:
- A value can only be extracted from a response that came **before** the request that uses it.
- You never go forward in time.

---

## How the Correlation Advisor Detects Values Automatically

The Correlation Advisor runs in **3 phases** after you upload your HAR file.

---

### Phase 1 — Collect Everything from Server Replies

The advisor reads **every response** the server sent (JSON, HTML, plain text — anything).
It walks through all the fields and writes down every value it finds, along with where it came from.

**Example:**

```
Reply #2  (POST /oauth/token):
  Response body: {
    "access_token": "eyJa...(long JWT)...",
    "expires_in": 3600,
    "token_type": "Bearer"
  }

Advisor notebook after Reply #2:
  "eyJa...(long JWT)..." → came from Reply #2, field $.access_token
  "3600"                → too short / looks static, skipped
  "Bearer"              → in skip-list (common static word), skipped
```

It does this for every reply, building one big lookup table:
```
value  →  { which reply, which JSON field }
```

Short values (< 10 chars), common words like "true/false/null/error", and
infrastructure headers like Content-Type are skipped automatically.

---

### Phase 2 — Check Every Browser Request

Now the advisor reads **every request** the browser sent.
For each request it checks:
- The **URL** (query string parameters)
- The **body / payload** (JSON fields, form fields)
- The **request headers** (Authorization, X-Token, etc.)

For every value it finds, it asks: *"Is this in my notebook? And if so, did that reply come BEFORE this request?"*

**Example (continuing from above):**

```
Request #4  (POST /api/orders):
  Request headers:
    Authorization: Bearer eyJa...(same JWT)...
  Request body:
    { "amount": 500, "currency": "USD" }

Advisor check:
  "eyJa..." found in notebook! → came from Reply #2 (which is before Request #4) ✓
  Conclusion: Reply #2 PRODUCES it → Request #4 USES it in the Authorization header
```

---

### Phase 3 — Pattern Scan (Backup)

Sometimes the HAR is incomplete and the source response is missing.
The advisor still looks for **values that LOOK dynamic** (JWTs, UUIDs, long hex strings, long tokens)
even if it can't find where they came from.

These are flagged as **medium confidence** candidates.
The developer still needs to confirm them manually.

---

### Phase 4 — Merge and Filter

The advisor then:
1. Removes duplicates
2. Groups array-indexed items (e.g. `items[0].id`, `items[1].id`, `items[2].id` → `items[*].id`)
3. Filters out values that are already correlated by the existing engine
4. Caps the list at 20 candidates to avoid overwhelming the user

---

## Substitution — Every Single Occurrence Gets Replaced

This is important: **when a correlation is applied, it replaces the value in ALL requests where it appears**, not just the first one.

**Example:**

```
access_token "eyJa..." appears in:
  Request #4  — Authorization header
  Request #6  — request body field "token"
  Request #8  — URL query parameter ?auth=eyJa...

After applying correlation:
  Request #4  — Authorization: Bearer {access_token}
  Request #6  — body: { "token": load.global.access_token }
  Request #8  — URL: ?auth={access_token}

All three are replaced automatically.
```

This is tracked in the `usages[]` array inside each correlation object.
Each usage records: which request index, which location (body / header / query), and the original value.

---

## Anatomy of a Correlation Object

Every correlation the tool creates has this structure:

```
{
  name:          "accessToken",          ← variable name used in the script
  sourceIdx:     2,                      ← S.entries1 index of the response to extract from
  extractorType: "jsonpath",             ← how to extract: jsonpath / boundary / header / regexp
  extractorConfig: {
    path: "$.access_token"               ← the JSON path (or boundary strings, or regexp)
  },
  usages: [
    { reqIdx: 4, location: "header",    tokenValue: "eyJa..." },
    { reqIdx: 6, location: "body_json", tokenValue: "eyJa..." },
    { reqIdx: 8, location: "query",     tokenValue: "eyJa..." }
  ]
}
```

The code generator reads `sourceIdx` to know where to place the extractor,
and iterates `usages[]` to know where to substitute.

---

## The "Next Value" Scenario (Your Example)

You asked: *"Request #2 body has a `next` field with multiple JSONs inside it.
I want to correlate `next` and substitute it everywhere it's used."*

**Answer: Yes, this is handled automatically.**

```
Reply #1  (GET /api/feed):
  Response body: {
    "items": [...],
    "next": "cursor_abc_XyZ_789"    ← advisor captures this
  }

Request #2  (GET /api/feed?cursor=cursor_abc_XyZ_789):
  URL query: cursor=cursor_abc_XyZ_789   ← advisor finds it here (usage #1)

Request #5  (POST /api/export):
  Body: { "pagination": { "cursor": "cursor_abc_XyZ_789" } }   ← usage #2

Request #8  (GET /api/next-page?token=cursor_abc_XyZ_789):
  URL query: token=cursor_abc_XyZ_789    ← usage #3
```

The advisor generates ONE correlation for `next` / `cursor_abc_XyZ_789` and replaces it
in all three places (Request #2, #5, and #8).

---

## Manual Correlation — When Auto-Detection Misses Something

If the advisor doesn't automatically find a correlation, you can add one manually:

1. Click **Add Manual** in the Correlation Advisor panel
2. **Source Request dropdown** — pick the request whose **RESPONSE** contains the value
   (you are picking the response side, NOT the request side)
3. The field browser shows all fields in that response body
4. Select the field you want to extract
5. The tool automatically scans all later requests for that value and builds the `usages[]` list

The source dropdown skips filtered-out requests and folder markers.
You can type to filter the list by URL or method.

---

## Array Reconstruction (Advanced)

Sometimes a server returns a list of items and the next request sends back a modified version of that list.

```
Reply #3  (POST /sfcm/home):
  Response: {
    "liveGridData": [
      { "systemId": "STF03...", "pairingId": "PAR01...", "relatedRef": "REF01..." },
      { "systemId": "STF01...", "pairingId": "PAR02...", "relatedRef": "REF02..." },
      ...  (could be 2000+ items)
    ]
  }

Request #6  (POST /alert_tuned):
  Body: {
    "systemID": "STF03...",
    "nextAlerts": [
      { "systemID": "STF03...", "pairingID": "PAR01...", "lockId": "0" },
      { "systemID": "STF01...", "pairingID": "PAR02...", "lockId": "0" },
      ...  (same 2000+ items reconstructed)
    ]
  }
```

A simple scalar correlation can't handle this — you can't replace 2000 hardcoded items with `load.global.someVar`.

The Array Reconstruction feature:
1. Detects that `systemId`, `pairingId`, `relatedRef` all come from the same source array
2. Groups them as columns of that array
3. Extracts ALL values using `SelectAll` extractors
4. Generates a **runtime loop** that rebuilds the array dynamically

See `ARRAY-RECONSTRUCTION-PLAN.md` for the full design.

---

## Extractor Types at a Glance

| Type | When Used | Example Config |
|------|-----------|----------------|
| `jsonpath` | Value is in a JSON response body | `{ path: "$.data.token" }` |
| `jsonpath` + `selectAll` | Value is an array in JSON response | `{ path: "$.items[*].id", selectAll: true }` |
| `boundary` | Value is in HTML or non-JSON response | `{ lb: "name=\"token\" value=\"", rb: "\"" }` |
| `boundary_header` | Value is in a response header | `{ lb: "X-Auth-Token: ", rb: "\r\n" }` |
| `regexp` | Value has a recognisable pattern | `{ pattern: "token=([A-Za-z0-9]+)", group: 1 }` |
| `array_reconstruct` | Array of items needs to be rebuilt | `{ targetArrayKey: "nextAlerts", columns: [...] }` |

---

## Where the Code Lives

| File | Purpose |
|------|---------|
| `src/web/public/studio-advisor.js` | All detection logic (Phases 1–4, merge, filter) |
| `src/web/public/studio-codegen.js` | DevWeb JS code generation with correlations applied |
| `src/web/public/VuGen-Script-Studio-app.js` | VuGen C code generation (mirrors studio-codegen.js) |
| `src/web/public/studio-ui.js` | Advisor panel UI, manual modal, card rendering |

---

## Common Questions

**Q: Does it work on HTML responses, not just JSON?**
Yes. Phase 1 tries JSON first; if parsing fails it looks for token-shaped strings in the raw text.
Boundary extractors are used for HTML (left boundary + right boundary around the value).

**Q: What if the same value appears in both a response AND a request at the same time?**
The source must come BEFORE the usage. The advisor enforces `src.entryIdx < i` strictly.

**Q: What if the value changes between test runs?**
That's exactly the point — correlation captures the fresh value at runtime every time,
so the hardcoded recording value is never used.

**Q: What if the HAR has 200 requests — will it be slow?**
Phase 1 and Phase 2 are both single-pass O(n) loops. The value map lookup is O(1) (JavaScript Map).
In practice it runs in under 100ms even for large HARs.

**Q: The advisor found a correlation I don't want. What do I do?**
Dismiss it in the advisor panel. Dismissed candidates are not applied to the script.
