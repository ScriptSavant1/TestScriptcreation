/**
 * dpop-service.js - Localhost DPoP proof generation service for VuGen Web HTTP/HTML
 *
 * Eliminates the performance penalty of loading jsrsasign-vugen.js in every web_js_run call
 * by providing a persistent HTTP service that uses Node.js native crypto (OpenSSL).
 *
 * Usage:
 *   node dpop-service.js [--port 7777] [--per-vuser]
 *
 * Endpoints:
 *   POST /dpop          - Generate a DPoP proof using shared key pair
 *   POST /dpop/init     - Generate a new key pair, return JWK (for per-VUser mode)
 *   POST /dpop/vuser    - Generate proof using caller-supplied JWK
 *   GET  /health        - Health check (returns 200 OK)
 *   POST /shutdown      - Graceful shutdown (optional, for automation)
 *
 * Request body (JSON):
 *   { "method": "POST", "url": "https://...", "ath": "<access_token_or_hash>" }
 *
 * Response body (JSON):
 *   { "proof": "eyJ..." }
 *   { "error": "..." }   on failure
 *
 * VuGen Action.c usage (replaces web_js_run):
 *   web_reg_save_param_json("ParamName=dpop_proof", "QueryString=$.proof", LAST);
 *   web_custom_request("DPoP_GetProof",
 *       "URL=http://127.0.0.1:7777/dpop",
 *       "Method=POST",
 *       "Resource=0",
 *       "RecContentType=application/json",
 *       "EncType=application/json",
 *       "Body={\"method\":\"POST\",\"url\":\"https://api.example.com/endpoint\",\"ath\":\"{AccessToken}\"}",
 *       LAST);
 *   web_add_header("DPoP", "{dpop_proof}");
 *
 * Start before test run on each LG:
 *   node dpop-service.js --port 7777
 */

"use strict";

const http = require("http");
const crypto = require("crypto");

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const PORT = parseInt(
  args[args.indexOf("--port") + 1] || process.env.DPOP_PORT || "7777",
  10
);

// ─── Shared key pair (generated once at startup, reused for all VUsers) ───────
// In most DPoP implementations the server validates the proof signature against
// the embedded JWK — it does NOT check whether the JWK was pre-registered.
// A single key pair per LG is therefore correct for load testing.
let sharedKeyPair = null;

function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const privateJwk = privateKey.export({ format: "jwk" });
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: privateJwk.x,
    y: privateJwk.y,
    d: privateJwk.d,
  };
  return {
    jwk,
    publicJwk: { kty: "EC", crv: "P-256", x: privateJwk.x, y: privateJwk.y },
    privateKeyObj: crypto.createPrivateKey({ key: jwk, format: "jwk" }),
  };
}

function buildProof(htu, htm, privateKeyObj, publicJwk, accessToken) {
  const header = { alg: "ES256", typ: "dpop+jwt", jwk: publicJwk };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    htu: htu,
    htm: htm.toUpperCase(),
    iat: now,
    jti: crypto.randomUUID(),
  };

  // ath = base64url(sha256(access_token)) — RFC 9449 §4.2
  if (accessToken && accessToken !== "" && accessToken !== "null") {
    payload.ath = crypto
      .createHash("sha256")
      .update(accessToken)
      .digest("base64url");
  }

  const b64url = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

  const signingInput = `${b64url(header)}.${b64url(payload)}`;
  const derSig = crypto.sign("sha256", Buffer.from(signingInput), privateKeyObj);
  const rawSig = derToRaw(derSig, 32);
  const sig = rawSig
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${signingInput}.${sig}`;
}

// DER → raw R||S (RFC 7515 requirement for ECDSA in JWS)
function derToRaw(der, len) {
  let offset = 2;
  offset++; // 0x02
  const rLen = der[offset++];
  let r = der.subarray(offset, offset + rLen);
  offset += rLen;
  offset++; // 0x02
  const sLen = der[offset++];
  let s = der.subarray(offset, offset + sLen);
  if (r.length > len) r = r.subarray(r.length - len);
  if (s.length > len) s = s.subarray(s.length - len);
  const raw = Buffer.alloc(len * 2);
  r.copy(raw, len - r.length);
  s.copy(raw, len * 2 - s.length);
  return raw;
}

// ─── Request body reader ──────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(new Error("Invalid JSON body: " + e.message));
      }
    });
    req.on("error", reject);
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

function validateProofRequest(body) {
  if (!body.method) return "Missing field: method";
  if (!body.url) return "Missing field: url";
  return null;
}

// ─── HTTP server ──────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  try {
    const url = req.url.split("?")[0];

    // ── GET /health ──────────────────────────────────────────────────────────
    if (req.method === "GET" && url === "/health") {
      return send(res, 200, { status: "ok", port: PORT });
    }

    // ── POST /dpop  (shared key pair) ────────────────────────────────────────
    if (req.method === "POST" && url === "/dpop") {
      const body = await readBody(req);
      const err = validateProofRequest(body);
      if (err) return send(res, 400, { error: err });

      const proof = buildProof(
        body.url,
        body.method,
        sharedKeyPair.privateKeyObj,
        sharedKeyPair.publicJwk,
        body.ath || ""
      );
      return send(res, 200, { proof });
    }

    // ── POST /dpop/init  (generate a new key pair, return JWK to caller) ─────
    // Use this for per-VUser key pairs: call once in vuser_init, store JWK as param,
    // then pass it in /dpop/vuser calls.
    if (req.method === "POST" && url === "/dpop/init") {
      const kp = generateKeyPair();
      return send(res, 200, { jwk: JSON.stringify(kp.jwk) });
    }

    // ── POST /dpop/vuser  (caller supplies their own JWK) ────────────────────
    // Body: { method, url, ath, jwk: "<JWK JSON string>" }
    if (req.method === "POST" && url === "/dpop/vuser") {
      const body = await readBody(req);
      const err = validateProofRequest(body);
      if (err) return send(res, 400, { error: err });
      if (!body.jwk) return send(res, 400, { error: "Missing field: jwk" });

      let jwk;
      try {
        jwk = typeof body.jwk === "string" ? JSON.parse(body.jwk) : body.jwk;
      } catch (e) {
        return send(res, 400, { error: "Invalid JWK JSON: " + e.message });
      }

      const privateKeyObj = crypto.createPrivateKey({ key: jwk, format: "jwk" });
      const publicJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
      const proof = buildProof(
        body.url,
        body.method,
        privateKeyObj,
        publicJwk,
        body.ath || ""
      );
      return send(res, 200, { proof });
    }

    // ── POST /shutdown ────────────────────────────────────────────────────────
    if (req.method === "POST" && url === "/shutdown") {
      send(res, 200, { status: "shutting down" });
      server.close(() => process.exit(0));
      return;
    }

    send(res, 404, { error: "Not found" });
  } catch (e) {
    console.error("[dpop-service] Error:", e.message);
    send(res, 500, { error: e.message });
  }
});

// ─── Startup ──────────────────────────────────────────────────────────────────
sharedKeyPair = generateKeyPair();
console.log("[dpop-service] Generated shared EC P-256 key pair");

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[dpop-service] Listening on http://127.0.0.1:${PORT}`);
  console.log(`[dpop-service] Endpoints:`);
  console.log(`  POST /dpop        - Generate proof (shared key)`);
  console.log(`  POST /dpop/init   - New key pair (per-VUser mode)`);
  console.log(`  POST /dpop/vuser  - Generate proof (caller JWK)`);
  console.log(`  GET  /health      - Health check`);
  console.log(`  POST /shutdown    - Graceful stop`);
});

process.on("SIGINT", () => {
  console.log("\n[dpop-service] Stopping...");
  server.close(() => process.exit(0));
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
