# LRE Toolkit — VuGen Web HTTP/HTML Protocol Guide

**Version:** 2.9.2 | **Date:** May 2026

VuGen Web HTTP/HTML is the classic LoadRunner protocol. Scripts are written in C.

---

## Generated File Manifest

| File | Required | Purpose |
|---|---|---|
| `Action.c` | Always | Main script — all requests per iteration |
| `vuser_init.c` | Always | Initialization — auth, lib loading, per-VUser setup |
| `vuser_end.c` | Always | Cleanup — logout, teardown |
| `globals.h` | Always | Parameter declarations (extern) |
| `ScriptName.usr` | Always | VuGen project descriptor |
| `default.cfg` | Always | Runtime settings (think time, proxy, connection) |
| `ParameterFile.prm` | Always | Parameter file (INI format) |
| `collection_data.dat` | Always | Tier 2 + Tier 3 variable values |
| `ScriptUploadMetadata.xml` | Always | LRE upload manifest |
| `lre-utils.dat` | If DPoP/PKCE | JavaScript crypto library |
| `jsrsasign.js` | If JWT | RSA/EC crypto library |
| `transport.pem` | If JWT | Placeholder private key |

---

## Action.c Structure

```c
#include "globals.h"

Action()
{
    /* ── Per-iteration PKCE generation (if detected) ─────────────── */
    web_js_run(
        "Code=generatePkce();",
        "ResultParam=pkce_verifier",
        LAST);

    /* ── Per-iteration DPoP proof for request 1 ──────────────────── */
    web_js_run(
        "Code=generateDpopProof('POST','https://auth.example.com/token');",
        "ResultParam=dpop_proof",
        LAST);

    /* ── Transaction T01 ─────────────────────────────────────────── */
    lr_start_transaction("T01_LoginUser");

    web_add_header("DPoP", "{dpop_proof}");
    web_add_header("Content-Type", "application/x-www-form-urlencoded");

    web_custom_request("T01_LoginUser",
        "URL=https://{host}/api/login",
        "Method=POST",
        "Snapshot=t1.inf",
        "Mode=HTML",
        "Body=username={username}&password={password}",
        LAST);

    lr_end_transaction("T01_LoginUser", LR_AUTO);

    lr_think_time(1);

    /* ── Transaction T02 ─────────────────────────────────────────── */
    lr_start_transaction("T02_GetAccount");

    web_add_header("Authorization", "Bearer {access_token}");

    web_url("T02_GetAccount",
        "URL=https://{host}/api/account",
        "Snapshot=t2.inf",
        "Mode=HTML",
        LAST);

    lr_end_transaction("T02_GetAccount", LR_AUTO);

    return 0;
}
```

---

## vuser_init.c Structure

```c
#include "globals.h"

vuser_init()
{
    /* ── Load lre-utils.dat (DPoP / PKCE) ───────────────────────── */
    web_js_run(
        "Code='lre-utils loaded';",
        "ResultParam=_lre_init",
        SOURCES,
            "File=lre-utils.dat", ENDITEM,
        LAST);

    /* ── Generate EC P-256 key pair for DPoP (once per VUser) ────── */
    web_js_run(
        "Code=generateDpopKeyPair();",
        "ResultParam=dpop_public_jwk",
        LAST);

    /* ── OAuth2 token acquisition ────────────────────────────────── */
    web_reg_save_param_json("access_token",
        "QueryString=$.access_token",
        LAST);

    web_add_header("DPoP", "{dpop_proof_init}");

    web_custom_request("GetToken",
        "URL={token_endpoint}",
        "Method=POST",
        "Snapshot=t0.inf",
        "Mode=HTML",
        "Body=grant_type=client_credentials&client_id={client_id}&client_secret={client_secret}",
        LAST);

    return 0;
}
```

---

## VuGen C API Reference

### Request Functions

| Function | Use |
|---|---|
| `web_url("name", "URL=...", "Snapshot=tN.inf", "Mode=HTML", LAST)` | GET request |
| `web_custom_request("name", "URL=...", "Method=POST", "Body=...", LAST)` | Any method |
| `web_submit_form("name", "Snapshot=...", ITEMDATA, "Name=field", "Value=val", ENDITEM, LAST)` | Form POST |
| `web_submit_data("name", "Action=...", ITEMDATA, ..., LAST)` | Form data |

### Correlation / Extraction

| Function | Use |
|---|---|
| `web_reg_save_param_json("name", "QueryString=$.path", LAST)` | JSON path extraction |
| `web_reg_save_param_xpath("name", "QueryString=//xpath", "SelectAll=Yes", LAST)` | XPath extraction |
| `web_reg_save_param("name", "LB=left", "RB=right", "Ord=1", LAST)` | Boundary extraction |
| `web_reg_save_param_regexp("name", "RegExp=pattern", "Group=1", "Ordinal=1", LAST)` | Regex extraction |

**Critical:** `web_reg_save_param_*` must be called **BEFORE** the request that produces the value.

### Header Management

```c
// Scoped to next request only
web_add_header("X-Custom-Header", "value");

// Global (all subsequent requests)
web_add_auto_header("X-Global-Header", "value");
web_remove_auto_header("X-Global-Header");
```

### JavaScript Runner

```c
// Run JS code in VuGen's JS engine context
web_js_run(
    "Code=var x = LR.getParam('myParam'); LR.setParam('result', x.toUpperCase());",
    "ResultParam=result",
    LAST);

// Load file once, then call functions
web_js_run(
    "Code='init';",
    "ResultParam=_init",
    SOURCES,
        "File=lre-utils.dat", ENDITEM,
    LAST);
```

VuGen's JS context **persists** between `web_js_run` calls within the same VUser. Functions defined in `lre-utils.dat` (loaded in `vuser_init.c`) are available in all subsequent `web_js_run` calls in `Action.c`.

### Transactions

```c
lr_start_transaction("T01_Login");
// ... requests ...
lr_end_transaction("T01_Login", LR_AUTO);  // LR_AUTO = PASS if no errors
```

### Think Time

```c
lr_think_time(2);  // 2 seconds (float accepted: 1.5)
```

### NTLM / Kerberos

```c
// vuser_init.c
web_set_user("{runtime_host}", "{AuthUsername}", "{AuthPassword}", "{AuthDomain}");
// Note: host is hostname only, no port (LRE 26.1 requirement)
```

---

## Parameter File Format (ParameterFile.prm)

INI format — NOT XML:

```ini
[parameter:username]
Dat=collection_data.dat
Column=username
Delimeter=,
GenerateNewVal=EachIteration
WhenOutOfValues=Cycle
SelectNextRow=Sequential

[parameter:client_id]
Dat=collection_data.dat
Column=client_id
Delimeter=,
GenerateNewVal=Once
WhenOutOfValues=Cycle
SelectNextRow=Sequential
```

`GenerateNewVal=Once` → same value for all VUsers (Tier 2 Config)  
`GenerateNewVal=EachIteration` → different value per VUser per iteration (Tier 3 TestData)

---

## collection_data.dat Format

Same CSV format as DevWeb but with `.dat` extension:

```
username,password,client_id,access_token
user1,pass1,my-client-id,
user2,pass2,my-client-id,
```

---

## globals.h

Declares all parameters used in the script so VuGen's C compiler knows about them:

```c
#ifndef GLOBALS_H
#define GLOBALS_H

extern char *username;
extern char *password;
extern char *client_id;
extern char *access_token;
extern char *host;

#endif
```

---

## Snapshot Counter

Every request function must have a unique `"Snapshot=tN.inf"` argument. The number N starts at 1 and increments globally through `Action.c`. This is required by VuGen's playback engine.

The generator tracks this with `this.snapshotCounter` and increments it for every request.

---

## BodyFilePath (Large Request Bodies)

Request bodies larger than 500 characters are written to separate `.dat` files and referenced via:

```c
"BodyFilePath=RequestBody_1.dat",
```

This avoids C string length limits and keeps `Action.c` readable. The `BodyFilePath` method also supports LR parameter substitution: `{paramName}` placeholders within the file are expanded at runtime.

---

## Known VuGen C Rules

| Rule | Details |
|---|---|
| C89 variable declarations | All `var type name;` declarations must be at the TOP of the function, before any statements |
| No `lr_get_vuser_id()` | Does not exist. Use `lr_whoami(int*, char**, int*)` instead |
| `web_add_header()` scope | Applies to the NEXT single request only — not persistent |
| `web_reg_save_param_xpath` no `Ord=` | XPath uses `SelectAll=Yes` instead |
| `web_reg_save_param_regexp` uses `Ordinal=` | NOT `Ord=` (different from boundary) |
| Formdata/multipart in `web_custom_request` | NOT supported in `Body=` — emits `console.warn` in generated code |
| `"Snapshot=tN.inf"` BEFORE `"Mode=HTML"` | Always in this order |

---

*See also: [Auth Guide](AUTH-GUIDE.md) | [DevWeb Protocol Guide](DEVWEB-PROTOCOL.md)*
