// VuGen Script Studio — Orchestrator
// Split from VuGen-Script-Studio-app.js — Phase 4B
// Contains: ZIP download, analyze() main entry point, tick().
// Dependencies: all other studio-*.js files must be loaded first.
// ═══════════════════════════════════════════════════════════════════════════
// ZIP DOWNLOAD
// ═══════════════════════════════════════════════════════════════════════════
async function dlZip(fmt) {
  if (!S.scripts.ac && !S.scripts.mj) {
    showToast("No scripts generated yet.", "warning");
    return;
  }
  if (typeof JSZip === "undefined") {
    showToast("JSZip not loaded.", "error");
    return;
  }
  const isWeb = fmt === "webhttp" || fmt === "both";
  const isDev = fmt === "devweb" || fmt === "both";

  async function makeWebHttpZip() {
    const nm = "WebHttpScript_Correlated";
    const zip = new JSZip();
    zip.file("Action.c", S.scripts.ac || "");
    zip.file("vuser_init.c", S.scripts.vi || "");
    zip.file("vuser_end.c", S.scripts.ve || "");
    zip.file("globals.h", S.scripts.gh || "");
    zip.file("default.cfg", genDefaultCfg(S.auth));
    zip.file("default.usp", WEB_DEFAULT_USP);
    zip.file(nm + ".usr", genUsrFile(nm));
    zip.file("ScriptUploadMetadata.xml", genScriptUploadMetadata(nm));
    zip.file("lrw_custom_body.h", LRW_CUSTOM_BODY_H);
    zip.file("custom_body_variables.txt", CUSTOM_BODY_VARIABLES_TXT);
    zip.file(
      "Bookmarks.xml",
      '<?xml version="1.0" encoding="utf-8"?><Bookmarks />',
    );
    zip.file("Breakpoints.xml", '<BreakpointsRoot Version="1" />');
    // lre-utils.dat — shared crypto utilities for VuGen (DPoP proofs, PKCE generation, JWT signing)
    if (S.hasDpop || S.hasPkce) {
      try {
        const _bp = window.location.pathname.replace(/\/[^\\/]*$/, "");
        let r = await fetch(_bp + "/lre-utils-helper.js");
        if (!r.ok) r = await fetch("/lre-utils-helper.js");
        if (r.ok) zip.file("lre-utils.dat", await r.text());
      } catch {}
    }
    // Parameterization files
    if (S.params && S.params.length > 0) {
      zip.file("ParameterFile.prm", S.scripts.prm || genParamFilePrm());
      zip.file(
        "collection_data.dat",
        S.scripts.dat || genCollectionDataCsv(),
      );
    }
    const blob = await zip.generateAsync({
      type: "blob",
      mimeType: "application/zip",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nm + ".zip";
    a.click();
  }

  async function makeDevWebZip() {
    const nm = "DevWebScript_Correlated";
    const zip = new JSZip();
    zip.file("main.js", S.scripts.mj || "");
    if (S.scripts.corrjs) zip.file("correlations.js", S.scripts.corrjs);
    zip.file("rts.yml", genRtsYml(S.auth));
    zip.file("scenario.yml", DEVWEB_SCENARIO_YML);
    zip.file("parameters.yml", S.scripts.pyml || genParamsYml());
    zip.file("tsconfig.json", DEVWEB_TSCONFIG_JSON);
    zip.file("default.cfg", DEVWEB_DEFAULT_CFG);
    zip.file("default.usp", DEVWEB_DEFAULT_USP);
    zip.file(nm + ".usr", genDevWebUsrFile(nm));
    zip.file(
      "ScriptUploadMetadata.xml",
      genDevWebScriptUploadMetadata(nm),
    );
    zip.file("Action.c", "Action()\n{\n\treturn 0;\n}\n");
    zip.file("vuser_init.c", "vuser_init()\n{\n\treturn 0;\n}\n");
    zip.file("vuser_end.c", "vuser_end()\n{\n\treturn 0;\n}\n");
    zip.file(
      "Bookmarks.xml",
      '<?xml version="1.0" encoding="utf-8"?><Bookmarks />',
    );
    zip.file("Breakpoints.xml", '<BreakpointsRoot Version="1" />');
    zip.file(
      "UserTasks.xml",
      '<?xml version="1.0" encoding="utf-8"?>\n<App Name="Virtual User Generator">\n  <Tasks />\n</App>',
    );
    // Parameterization data file
    if (S.params && S.params.length > 0) {
      zip.file(
        "collection_data.csv",
        S.scripts.csv || genCollectionDataCsv(),
      );
    }
    // DevWebSdk.d.ts — fetch from local static file instead of embedding
    try {
      const _bp = window.location.pathname.replace(/\/[^\\/]*$/, "");
      let rSdk = await fetch(_bp + "/DevWebSdk.d.ts");
      if (!rSdk.ok) rSdk = await fetch("/DevWebSdk.d.ts");
      if (rSdk.ok) zip.file("DevWebSdk.d.ts", await rSdk.text());
    } catch {}
    // DPoP helper for DevWeb
    if (S.hasDpop) {
      try {
        const _bp = window.location.pathname.replace(/\/[^\\/]*$/, "");
        let r = await fetch(_bp + "/dpop-helper.js");
        if (!r.ok) r = await fetch("/dpop-helper.js");
        if (r.ok) zip.file("dpop-helper.js", await r.text());
      } catch {}
    }
    const blob = await zip.generateAsync({
      type: "blob",
      mimeType: "application/zip",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nm + ".zip";
    a.click();
  }

  if (isWeb) await makeWebHttpZip();
  if (isDev) await makeDevWebZip();
}


// ═══════════════════════════════════════════════════════════════════════════
// MAIN ANALYZE FUNCTION
// ═══════════════════════════════════════════════════════════════════════════
async function analyze() {
  if (!S.har1) {
    showToast("Please load at least one HAR file.", "warning");
    return;
  }
  showPhase("ph-proc");
  S._analyzeStart = Date.now();

  // Use setTimeout to allow UI to update before heavy processing
  await new Promise((r) => setTimeout(r, 50));

  try {
    setMsg("Parsing recording files...", "Reading request/response data");
    await tick();

    S.entries1 = S.isNetLog1 ? parseNetLog(S.har1) : parseHar(S.har1);
    if (S.har2)
      S.entries2 = S.isNetLog2 ? parseNetLog(S.har2) : parseHar(S.har2);

    // Quality / source warnings
    S.candidates = [];
    S.advisorCandidates = [];
    S.harWarning = "";

    // NetLog warning — response bodies unavailable, correlation will be pattern-only
    const netlogSlots = [
      S.isNetLog1 && "Recording 1",
      S.isNetLog2 && S.har2 && "Recording 2",
    ].filter(Boolean);
    if (netlogSlots.length) {
      S.harWarning =
        `NetLog source (${netlogSlots.join(" & ")}): POST request bodies and response bodies are not ` +
        `available in NetLog files. Correlation engine will use pattern-based detection only. ` +
        `GET requests are fully reproduced. POST bodies will show TODO comments in generated scripts.`;
    }

    // Detect truncated response bodies in HAR files (Chrome omits body when served from cache)
    if (!S.isNetLog1) {
      const rawEntries = S.har1.log.entries;
      const truncated = rawEntries.filter((e) => {
        const rc = e.response && e.response.content;
        const size = rc && rc.size > 0 ? rc.size : 0;
        const body = rc && rc.text ? rc.text.length : 0;
        return size > 0 && body === 0;
      }).length;
      if (truncated > 0 && truncated / rawEntries.length > 0.1) {
        const cacheWarn =
          `${truncated} of ${rawEntries.length} responses have empty bodies (served from browser cache). ` +
          `Dynamic values in those responses cannot be traced. Re-record with DevTools "Disable cache" checked (\u2699 \u2192 Disable cache).`;
        S.harWarning = S.harWarning
          ? S.harWarning + " " + cacheWarn
          : cacheWarn;
      }
    }

    setMsg(
      "Detecting transactions...",
      "Finding START/END markers in HAR",
    );
    await tick();
    detectMarkers(S.entries1); // sets isMarker, txnName, S.txns

    setMsg("Applying filters...", "Removing static resources & noise");
    await tick();
    applyFilters(S.entries1);
    if (S.entries2.length) applyFilters(S.entries2);

    setMsg("Running correlation engine...", "Detecting dynamic values");
    await tick();

    if (S.mode === "two" && S.entries2.length) {
      S.correlations = twoHarCorrelate(S.entries1, S.entries2);
      // Warn if very few values changed between the two recordings — likely the same browser
      // session was reused (session tokens don't change when you stay logged in).
      const matchedCount = S.entries1.filter(
        (e) => !e.filtered && !e.isMarker,
      ).length;
      if (S.correlations.length === 0 && matchedCount > 5) {
        const sameSessionWarning =
          "No dynamic values were detected between the two recordings. " +
          "This usually means both recordings share the same browser session — session tokens, " +
          "CSRF tokens, and cookies did not change. " +
          "For Recording 2, use an Incognito/Private window (Ctrl+Shift+N) or log out fully " +
          "and clear cookies before re-recording, then regenerate.";
        S.harWarning = S.harWarning
          ? S.harWarning + " " + sameSessionWarning
          : sameSessionWarning;
      } else if (S.correlations.length <= 2 && matchedCount > 10) {
        const fewCorrWarning =
          "Only " +
          S.correlations.length +
          " dynamic value(s) detected. " +
          "If you expected more correlations, ensure Recording 2 used a fresh session " +
          "(Incognito window or full logout + cookie clear) — reusing the same session " +
          "means tokens do not change and the diff finds nothing.";
        S.harWarning = S.harWarning
          ? S.harWarning + " " + fewCorrWarning
          : fewCorrWarning;
      }
    } else {
      S.correlations = singleHarCorrelate(S.entries1);
    }

    // Phase 4: Value-based auto-correlation — catches non-standard header names
    // and custom JSON paths that the pattern engine misses (e.g. x-xsrf-token,
    // x-financial-id, custom session headers where we see the VALUE but not the name).
    try {
      var vbacCorrs = valueBasedCorrelate(S.entries1, S.correlations, S.entries2);
      if (vbacCorrs && vbacCorrs.length) {
        S.correlations = S.correlations.concat(vbacCorrs);
      }
    } catch (vbacErr) {
      console.warn('[VBAC] Value-based correlation error (non-fatal):', vbacErr);
    }

    setMsg(
      "Detecting parameters & authentication...",
      "Scanning for user-entered values and auth type",
    );
    await tick();
    S.params = detectParams(S.entries1, S.correlations);

    // Auth detection — also applies corporate-TLD fallback for sites where Chrome omits Negotiate headers
    S.auth = detectCorporateAuth(S.entries1, detectAuth(S.entries1));
    // Add username / password / domain params when credential-based auth is present
    if (
      S.auth &&
      ["kerberos", "negotiate", "ntlm", "basic", "digest"].includes(
        S.auth.type,
      )
    ) {
      if (!S.params.some((p) => p.csvKey === "username")) {
        const usernameDefault = S.auth.username || "<enter_username>";
        const isWinAuthParam = ["kerberos", "ntlm", "negotiate"].includes(
          S.auth.type,
        );
        const authParams = [
          {
            name: "password",
            csvKey: "password",
            value: "<enter_password>",
            usages: [],
          },
          {
            name: "username",
            csvKey: "username",
            value: usernameDefault,
            usages: [],
          },
        ];
        if (isWinAuthParam)
          authParams.push({
            name: "domain",
            csvKey: "domain",
            value: "<enter_domain>",
            usages: [],
          });
        S.params.unshift(...authParams);
      }
    }
    // ServerHost detection — used to build SERVER_HOST variable in generated scripts
    S.serverHost = detectServerHost(
      S.entries1.filter((e) => !e.filtered && !e.isMarker),
    );

    // DPoP detection — scan for dpop / dpop-pf headers in any request
    S.hasDpop = S.entries1.some(
      (e) =>
        !e.filtered &&
        !e.isMarker &&
        (e.reqHdrs || []).some((h) => /^dpop(-pf)?$/i.test(h.name)),
    );
    // Detect the Bearer token correlation name used alongside dpop headers.
    S.dpopTokenVar = "AccessToken"; // default fallback
    if (S.hasDpop && S.correlations) {
      // Find a correlation whose usages include an Authorization: Bearer header
      for (const c of S.correlations) {
        if (
          c.usages &&
          c.usages.some(
            (u) =>
              u.location === "header" &&
              /^authorization$/i.test(u.key) &&
              (u.prefix || "").includes("Bearer"),
          )
        ) {
          S.dpopTokenVar = c.name;
          break;
        }
      }
    }

    // PKCE detection — scan for code_challenge in URL query params or code_verifier in POST form body.
    // Both indicate an OAuth2 PKCE flow (RFC 7636). Values are client-generated, so we add special
    // "pkce" correlations that instruct the code generator to produce runtime generation code instead
    // of replaying hardcoded values.
    S.hasPkce = false;
    {
      const _pkceByName = new Map();
      for (let _pi = 0; _pi < S.entries1.length; _pi++) {
        const _pe = S.entries1[_pi];
        if (_pe.filtered || _pe.isMarker) continue;
        // code_challenge in URL query string (GET /authorize?...&code_challenge=xxx)
        const _pqs = (_pe.url || "").includes("?")
          ? (_pe.url || "").split("?")[1]
          : "";
        const _ccm = /(?:^|&)code_challenge=([^&]{32,})/.exec(_pqs);
        if (_ccm) {
          S.hasPkce = true;
          const _cv = decodeURIComponent(_ccm[1]);
          if (!_pkceByName.has("pkce_challenge")) {
            _pkceByName.set("pkce_challenge", {
              name: "pkce_challenge",
              sourceIdx: -1,
              extractorType: "pkce",
              extractorConfig: { role: "challenge" },
              usages: [],
            });
          }
          _pkceByName.get("pkce_challenge").usages.push({
            reqIdx: _pi,
            location: "query",
            key: "code_challenge",
            tokenValue: _cv,
            originalValue: _cv,
          });
        }
        // code_verifier in form body (POST /token body: code_verifier=xxx&...)
        const _bmt = (_pe.body && _pe.body.mimeType) || "";
        const _btext = (_pe.body && _pe.body.text) || "";
        if (_bmt.includes("form") || _bmt.includes("urlencoded")) {
          const _cvm = /(?:^|&)code_verifier=([^&]{32,})/.exec(_btext);
          if (_cvm) {
            S.hasPkce = true;
            const _vv = decodeURIComponent(_cvm[1]);
            if (!_pkceByName.has("pkce_verifier")) {
              _pkceByName.set("pkce_verifier", {
                name: "pkce_verifier",
                sourceIdx: -1,
                extractorType: "pkce",
                extractorConfig: { role: "verifier" },
                usages: [],
              });
            }
            _pkceByName.get("pkce_verifier").usages.push({
              reqIdx: _pi,
              location: "body_form",
              key: "code_verifier",
              tokenValue: _vv,
              originalValue: _vv,
            });
          }
        }
      }
      // Inject PKCE correlations so body/URL injectors can substitute the hardcoded values
      if (S.hasPkce) {
        for (const [, _pc] of _pkceByName) S.correlations.push(_pc);
      }
    }

    // SSO / OAuth redirect chain detection
    // Patterns cover: PingFederate (/as/authorization), OAuth2, OIDC, SAML, ADFS, Okta, Keycloak,
    // Azure AD (login.microsoftonline.com), response_type= / client_id= OAuth2 query params.
    const SSO_URL_PATTERN =
      /\/oauth2?\/|\/oidc\/|\/as\/authoris|\/sso\/|\/saml\/|\/connect\/token|\.ping$|authorization\.oauth|response_type=|client_id=|\.okta\.|\/adfs\/|\/realms\/|login\.microsoftonline\.com/i;
    const redirectEntries = S.entries1.filter(
      (e) =>
        !e.filtered && !e.isMarker && e.status >= 300 && e.status < 400,
    );
    const ssoRedirects = redirectEntries.filter(
      (e) =>
        SSO_URL_PATTERN.test(e.url) ||
        SSO_URL_PATTERN.test((e.respHdrsMap || {})["location"] || ""),
    );
    if (ssoRedirects.length > 0) {
      // Collect unique SSO hostnames for display and for targeted Windows-auth check below
      const ssoHostSet = new Set(
        ssoRedirects
          .map((e) => {
            try {
              return new URL(e.url).hostname;
            } catch {
              return "";
            }
          })
          .filter(Boolean),
      );
      // Also add hostnames from Location headers of the SSO redirects
      for (const e of ssoRedirects) {
        const loc = (e.respHdrsMap || {})["location"] || "";
        if (loc) {
          try {
            ssoHostSet.add(new URL(loc).hostname);
          } catch {}
        }
      }
      const ssoHosts = [...ssoHostSet].join(", ");

      // ── Windows auth detection specific to SSO servers ─────────────────────────
      // Chrome/Edge DevTools HAR sometimes omits the Authorization: Negotiate header
      // for SSO flows because the browser handles NTLM/Kerberos challenge-response
      // transparently. detectAuth() above ran first — if it found nothing, check again
      // explicitly on all entries (including filtered) that touch the SSO hostnames.
      // Performance testing from LRE load generators (Linux/Windows service accounts)
      // REQUIRES web_set_user() + Runtime Settings → Enable Integrated Authentication
      // because load generator machines do NOT have the user's Windows session.
      // Well-known public TLDs — SSO servers on these are cloud/SaaS (form-based OAuth/OIDC).
      // SSO servers on ANY OTHER TLD are corporate internal networks → Windows auth required.
      // Examples of corporate internal TLDs: .local .internal .corp .intranet .mde .nwgrp .net1 etc.
      const PUBLIC_TLD =
        /\.(com|org|net|io|co|app|dev|cloud|gov|edu|biz|info|tech|site|online|store|tv|me|us|uk|au|ca|de|fr|jp|sg|in|eu|nz|nl|se|no|fi|dk|be|at|ch|es|it|pl|cz|ru|br|mx|ar|cl|za|ae|sa|kw|qa)(\.[a-z]{2})?$/i;
      // Known public Windows auth IdP hostnames (Azure AD / ADFS on Azure)
      const AZURE_WIN_AUTH =
        /^(login\.microsoftonline\.com|sts\.windows\.net|login\.windows\.net|login\.live\.com)$/i;

      let ssoWindowsAuth = false;
      if (!S.auth) {
        // Check 1: Negotiate or NTLM header on any entry whose host is in the SSO chain
        // (Chrome DevTools sometimes omits these — checks below handle that gap)
        const negotiateOnSso = S.entries1.some((e) => {
          let h = "";
          try {
            h = new URL(e.url).hostname;
          } catch {
            return false;
          }
          if (!ssoHostSet.has(h)) return false;
          const reqAuth = (e.hdrsMap || {})["authorization"] || "";
          const wwwAuth = (e.respHdrsMap || {})["www-authenticate"] || "";
          return (
            /^(Negotiate|NTLM)\s/i.test(reqAuth) ||
            /\b(Negotiate|NTLM)\b/i.test(wwwAuth)
          );
        });
        // Check 2: ADFS URL pattern → always Windows auth
        const adfsInChain = ssoRedirects.some(
          (e) =>
            /\/adfs\/|\/wsfed/i.test(e.url) ||
            /\/adfs\/|\/wsfed/i.test(
              (e.respHdrsMap || {})["location"] || "",
            ),
        );
        // Check 3: Any SSO hostname uses a non-public (corporate internal) TLD.
        // Corporate internal networks (e.g. .mde .local .corp .internal .nwgrp) are never used
        // by cloud SaaS SSO providers — this is a reliable indicator of Windows-authenticated SSO.
        const corporateInternalSso = [...ssoHostSet].some(
          (h) => !PUBLIC_TLD.test(h),
        );
        // Check 4: Known public Windows auth IdP (Azure AD)
        const azureAdSso = [...ssoHostSet].some((h) =>
          AZURE_WIN_AUTH.test(h),
        );

        if (
          negotiateOnSso ||
          adfsInChain ||
          corporateInternalSso ||
          azureAdSso
        ) {
          // Set auth so web_set_user() + Runtime Settings are generated automatically
          const ssoRealm = (() => {
            try {
              return new URL(ssoRedirects[0].url).hostname;
            } catch {
              return "sso-server";
            }
          })();
          S.auth = {
            type: "negotiate",
            host: ssoRealm,
            realm: ssoRealm,
            hostport: ssoRealm,
          };
          ssoWindowsAuth = true;
          // username/password/domain params: the main block above ran before SSO detection,
          // so add them here if not already present.
          if (!S.params.some((p) => p.csvKey === "username")) {
            S.params.unshift(
              {
                name: "domain",
                csvKey: "domain",
                value: "<enter_domain>",
                usages: [],
              },
              {
                name: "password",
                csvKey: "password",
                value: "<enter_password>",
                usages: [],
              },
              {
                name: "username",
                csvKey: "username",
                value: "<enter_username>",
                usages: [],
              },
            );
          }
        }
      } else if (
        ["kerberos", "ntlm", "negotiate"].includes(S.auth.type)
      ) {
        ssoWindowsAuth = true; // detectAuth() already found it in the main scan
      }

      // Build auth note for warning
      const authNote = ssoWindowsAuth
        ? `Windows authentication (${((S.auth && S.auth.type) || "negotiate").toUpperCase()}) detected on SSO servers — ` +
          `web_set_user() and Runtime Settings (Enable Integrated Authentication) are generated automatically. ` +
          `Set username and password in collection_data.csv to the load generator service account credentials ` +
          `(domain\\username format for NTLM, UPN format for Kerberos).`
        : `No Windows authentication (NTLM/Kerberos) headers found on SSO servers — treating as form-based OAuth/OIDC login. ` +
          `If VuGen replays fail with 401 on the SSO page, your IdP uses Windows auth: ` +
          `add web_set_user("{username}","{password}","sso-server") at the top of Action.c.`;

      const ssoMsg =
        `SSO/OAuth redirect chain detected (${ssoRedirects.length} redirect step${ssoRedirects.length > 1 ? "s" : ""} — ${ssoHosts}). ` +
        `Redirect tokens and state parameters are correlated automatically. ` +
        `${authNote} ` +
        `Verify manually: (1) login form POST is in the script, (2) OAuth callback POST (id_token/code) is in the script.`;
      S.harWarning = S.harWarning
        ? S.harWarning + " | " + ssoMsg
        : ssoMsg;
    }

    // Correlation Advisor — scan request bodies for values that came from prior responses.
    // Runs AFTER all existing correlation engines so it skips already-handled values.
    // Results go to S.advisorCandidates; rendered by renderAdvisorPanel() below.
    try {
      // Pass only active (non-suppressed) correlations so _advAlreadyCorrelated doesn't
      // block candidates whose auto-generated correlation was suppressed by array_reconstruct.
      advisorScan(S.entries1, (S.correlations || []).filter(c => !c._suppressed));
    } catch (advErr) {
      console.warn('[Advisor] Non-fatal scan error:', advErr);
      S.advisorCandidates = [];
    }

    // ── Phase 4: Background review gate ─────────────────────────────────────
    // If this HAR was recorded by the extension and has periodic entries,
    // show the review panel and let the user decide before generating scripts.
    const _perfxSummary = _buildPeriodicSummary(S.entries1);
    if (_perfxSummary.length > 0) {
      S.bgDecisions = new Map(_perfxSummary.map(p => [p.normalizedUrl, 'exclude']));
      renderBackgroundReview(_perfxSummary);
      showPhase('ph-res');
      return;
    }
    S.bgDecisions = new Map();
    // ─────────────────────────────────────────────────────────────────────────

    await _generateAndRenderScripts();
  } catch (err) {
    console.error(err);
    showToast(
      "Analysis failed: " + err.message,
      "error",
      7000,
    );
    showPhase("ph-upload");
  }
}

function tick() {
  return new Promise((r) => setTimeout(r, 20));
}

// =============================================================================
// PHASE 4 — BACKGROUND REVIEW HELPERS
// =============================================================================

/**
 * Group S.entries1 entries that carry _perfx_class = 'periodic' by
 * normalizedUrl and return a summary array for the review panel.
 */
function _buildPeriodicSummary(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if ((entry._perfx_class || 'unknown') !== 'periodic') continue;
    const key = entry._normalizedUrl || entry.url;
    if (!groups.has(key)) {
      groups.set(key, {
        normalizedUrl: key,
        exampleUrl:   entry.url,
        method:       entry.method || 'GET',
        occurrences:  0,
        intervalMs:   entry._perfx_interval || null,
        userDecision: 'exclude',
      });
    }
    groups.get(key).occurrences++;
  }
  return [...groups.values()];
}

/**
 * Run code generation + UI update + showPhase("ph-res").
 * Called from analyze() (non-perfx path) and applyBgDecisions() (perfx path).
 */
async function _generateAndRenderScripts() {
  setMsg("Generating scripts...", "Building VuGen code with correlations & parameters");
  await tick();

  const reqCount = S.entries1.filter(e => !e.filtered && !e.isMarker).length;

  const isWeb = S.format === "webhttp" || S.format === "both";
  const isDev = S.format === "devweb"  || S.format === "both";
  S.scripts = {};
  const _activeCorrs = (S.correlations || []).filter(c => !c._suppressed);

  if (isWeb) {
    S.scripts.ac  = genActionC(S.entries1, _activeCorrs);
    S.scripts.vi  = genVuserInit();
    S.scripts.ve  = genVuserEnd();
    S.scripts.gh  = genGlobalsH();
    S.scripts.prm = genParamFilePrm();
    S.scripts.dat = genCollectionDataCsv();
    S.tab = "ac";
  }
  if (isDev) {
    S.scripts.mj     = genMainJS(S.entries1, _activeCorrs);
    S.scripts.corrjs = genCorrelationsJS(_activeCorrs);
    S.scripts.pyml   = genParamsYml();
    S.scripts.csv    = genCollectionDataCsv();
    if (!isWeb) S.tab = "mj";
  }

  // Update stats bar
  document.getElementById("st-req").textContent = reqCount;
  const corrEl = document.getElementById("st-corr");
  corrEl.textContent =
    S.correlations.length +
    (S.candidates.length > 0 ? "+" + S.candidates.length : "");
  if (S.candidates.length > 0)
    corrEl.closest(".stat") &&
      (corrEl.closest(".stat").className = "stat stat-warn");
  document.getElementById("st-mode").textContent =
    S.mode === "two" ? "Diff" : "Pattern";
  document.getElementById("st-fmt").textContent = {
    webhttp: "Web HTTP/HTML",
    devweb:  "DevWeb",
    both:    "Both",
  }[S.format];
  const paramEl = document.getElementById("st-params");
  if (paramEl) {
    paramEl.textContent = S.params.length;
    paramEl.closest(".stat").className =
      S.params.length > 0 ? "stat stat-ok" : "stat";
  }
  const txnStat = document.getElementById("st-txn");
  if (txnStat) txnStat.textContent = S.txns.length || "Auto";
  const authWrap = document.getElementById("st-auth-wrap");
  const authEl   = document.getElementById("st-auth");
  if (S.auth && authEl && authWrap) {
    const AUTH_LABELS = {
      kerberos: "Kerberos", ntlm: "NTLM", negotiate: "Negotiate",
      basic: "Basic", digest: "Digest", bearer: "Bearer", saml: "SAML",
    };
    authEl.textContent = AUTH_LABELS[S.auth.type] || S.auth.type;
    authWrap.style.display = "";
    authWrap.className = "stat stat-ok";
  } else if (authWrap) {
    authWrap.style.display = "none";
  }

  renderCorrelations();
  renderAdvisorPanel();
  renderParams();
  renderTabs();
  renderDlBar();
  document.getElementById("code-body").textContent =
    S.scripts[S.tab] || "// No content";

  // Silently record Studio usage — fires when analysis completes (not on download).
  // Mirrors the server-side analytics.finishEvent() used by the converter tools.
  try {
    const _entries = (S.entries1 || []).filter(function(e){ return !e.filtered && !e.isMarker; });
    const _corrs   = (S.correlations || []).filter(function(c){ return !c._suppressed; });
    const _found   = ((S.advisorCandidates || S.candidates || []).length + _corrs.length) || null;
    fetch("/analytics/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool: "studio",
        protocol: S.format || null,
        filename: S.har1Name || null,
        requestCount: _entries.length || null,
        correlationsFound: _found,
        correlationsAccepted: _corrs.length || null,
        result: "success",
        duration: S._analyzeStart ? Date.now() - S._analyzeStart : null,
      }),
    }).catch(function(){});
  } catch (_) {}

  showPhase("ph-res");
}

/**
 * Called by the "Apply & Generate Script" button in the background review panel.
 * Reads toggle decisions, updates S.bgDecisions, hides the panel, then generates.
 */
async function applyBgDecisions() {
  document.querySelectorAll('.bg-decision-toggle').forEach(el => {
    const url    = el.dataset.url;
    const active = el.querySelector('.bg-dec.active');
    if (url && active) S.bgDecisions.set(url, active.dataset.val);
  });
  const panel = document.getElementById('bgReviewPanel');
  if (panel) panel.style.display = 'none';

  try {
    await _generateAndRenderScripts();
  } catch (err) {
    console.error('[BG decisions] generation failed:', err);
    showToast('Script generation failed: ' + err.message, 'error', 6000);
  }
}

// =============================================================================
// REGENERATE FROM ADVISOR
// Called by advisorApplyAndRegen() in studio-ui.js after merging accepted
// advisor candidates into S.correlations. Re-runs only the code generation
// tail — no re-parsing, no re-correlating. Fast (< 1 second).
// =============================================================================
function regenerateFromAdvisor() {
  try {
    const isWeb = S.format === 'webhttp' || S.format === 'both';
    const isDev = S.format === 'devweb'  || S.format === 'both';
    // Exclude suppressed correlations (auto-generated ones overridden by array_reconstruct)
    const _activeCorrs = (S.correlations || []).filter(c => !c._suppressed);

    if (isWeb) {
      S.scripts.ac  = genActionC(S.entries1, _activeCorrs);
      S.scripts.vi  = genVuserInit();
      S.scripts.ve  = genVuserEnd();
      S.scripts.gh  = genGlobalsH();
      S.scripts.prm = genParamFilePrm();
      S.scripts.dat = genCollectionDataCsv();
    }
    if (isDev) {
      S.scripts.mj     = genMainJS(S.entries1, _activeCorrs);
      S.scripts.corrjs = genCorrelationsJS(_activeCorrs);
      S.scripts.pyml   = genParamsYml();
      S.scripts.csv    = genCollectionDataCsv();
    }

    // Update correlation count stat
    const corrEl = document.getElementById('st-corr');
    if (corrEl) corrEl.textContent = S.correlations.length + (S.candidates.length > 0 ? '+' + S.candidates.length : '');

    renderCorrelations();
    renderAdvisorPanel(); // re-render to reflect applied state
    renderTabs();
    renderDlBar();
    const codeEl = document.getElementById('code-body');
    if (codeEl) codeEl.textContent = S.scripts[S.tab] || '// No content';

    showToast('Script regenerated with ' + S.correlations.length + ' correlations.', 'success');
  } catch (err) {
    console.error('[Advisor regen]', err);
    showToast('Regeneration error: ' + err.message, 'error', 6000);
  }
}