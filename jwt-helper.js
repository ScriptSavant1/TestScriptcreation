/**
 * JWT helper: Fast JWT generation using Node.js crypto
 * Replaces jsrsasign.js with native crypto (10x faster)
 */

const crypto = require("crypto");

/**
 * Decode HTML entities that may have been introduced when the private key was stored
 * in a web-exported Postman/Bruno collection or a JMX XML file.
 * Without this, crypto.createPrivateKey() throws "DECODER routines:: unsupported"
 * because the PEM structure is corrupted (e.g. newlines encoded as &#10;).
 */
function decodeHtmlEntities(str) {
  if (typeof str !== "string") return str;
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x0*A;/gi, "\n") // &#xA; or &#x000A; — newlines in PEM blocks
    .replace(/&#x0*D;/gi, "\r") // &#xD;
    .replace(/&#0*13;/g, "\r") // &#13;
    .replace(/&#0*10;/g, "\n"); // &#10;
}

/**
 * Normalise a PEM private key delivered through various broken channels.
 *
 * DevWeb/LRE delivers private keys in several corrupted forms:
 *   YAML '>' folded scalar  — newlines become spaces (one long line)
 *   YAML '|' with indents  — leading spaces on every line
 *   CSV / collection_data  — literal '\n' two-character sequence
 *   Windows files          — \r\n line endings
 *
 * This function also decodes HTML entities (handles Postman/Bruno/JMX XML export).
 */
function normalisePem(raw) {
  let s = decodeHtmlEntities(String(raw || ""));

  // Step 1: unescape literal \n sequences (CSV / collection_data.csv delivery)
  s = s.replace(/\\n/g, "\n");

  // Step 2: normalise Windows \r\n and bare \r to Unix \n
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Step 3: handle YAML '>' folded scalar — newlines were collapsed into spaces,
  // producing one long space-separated blob. Detect and reformat as proper PEM.
  if (!s.includes("\n") || s.split("\n").length < 3) {
    const pemRe =
      /-----([^-]+)-----\s*([A-Za-z0-9+/=\s]+?)\s*-----([^-]+)-----/;
    const m = pemRe.exec(s);
    if (m) {
      const header = "-----" + m[1] + "-----";
      const footer = "-----" + m[3] + "-----";
      const body = m[2].replace(/\s+/g, ""); // strip all whitespace from body
      const lines = body.match(/.{1,64}/g) || []; // standard 64-char line wrap
      s = header + "\n" + lines.join("\n") + "\n" + footer;
    }
  }

  // Step 4: trim leading/trailing whitespace per line (YAML '|' indentation artefact)
  s = s
    .split("\n")
    .map(function (l) {
      return l.trim();
    })
    .filter(function (l) {
      return l.length > 0;
    })
    .join("\n")
    .trim();

  return s;
}

/**
 * Resolve the signing key to use with crypto.createSign().
 *
 * Node 18+ / OpenSSL 3.x: passing a raw PKCS#1 PEM string with PSS padding
 * throws "DECODER routines::unsupported" because OpenSSL 3.x can no longer
 * auto-detect the key type for PSS signing. Must use a KeyObject with an
 * explicit 'type' field instead.
 *
 * Backward compatibility tiers:
 *   Node < 11.6.0  — crypto.createPrivateKey does not exist; return raw PEM string
 *   Node 12-17     — createPrivateKey with explicit type works (OpenSSL 1.x)
 *   Node 18+       — createPrivateKey with explicit type required (OpenSSL 3.x)
 */
function resolveSignKey(normKey) {
  if (typeof crypto.createPrivateKey !== "function") {
    // Very old Node.js — fall back to raw PEM string (same as before this fix)
    return normKey;
  }

  const isPkcs1 = normKey.includes("BEGIN RSA PRIVATE KEY");
  const keyType = isPkcs1 ? "pkcs1" : "pkcs8";

  // Primary path: explicit type (works on all Node 12+ including 18+ / OpenSSL 3.x)
  try {
    return crypto.createPrivateKey({ key: normKey, format: "pem", type: keyType });
  } catch (_) {}

  // Fallback path: no explicit type (some Node 12-14 / OpenSSL 1.x edge cases)
  try {
    return crypto.createPrivateKey(normKey);
  } catch (e) {
    // Both KeyObject approaches failed — emit a diagnostic before re-throwing
    var preview = normKey.slice(0, 120).replace(/\n/g, "\\n");
    throw new Error(
      "jwt-helper: createPrivateKey failed. " +
        "Key preview (first 120 chars): [" +
        preview +
        "] | Original error: " +
        e.message
    );
  }
}

/**
 * Generate JWT token with RS256/PS256 algorithm.
 * Accepts PKCS#1 ('BEGIN RSA PRIVATE KEY') and PKCS#8 ('BEGIN PRIVATE KEY') PEM keys.
 * Normalises the key before signing to handle delivery corruption from YAML/CSV/HTML.
 */
function generateJWT(header, payload, privateKey) {
  const base64UrlEncode = function (str) {
    return Buffer.from(str)
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  };

  const headerEncoded = base64UrlEncode(JSON.stringify(header));
  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
  const signatureInput = headerEncoded + "." + payloadEncoded;

  // Normalise and resolve key — handles all corruption modes and Node versions
  const normKey = normalisePem(privateKey);
  const signKey = resolveSignKey(normKey);

  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signatureInput);
  sign.end();

  const signature = sign
    .sign(
      {
        key: signKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
      },
      "base64"
    )
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return signatureInput + "." + signature;
}

// get Jwt Token - auto-generates or refreshes if expired
// call this function whenever you need a JWT token
// claimMap (optional): { kid:'signing_kid', iss:'client_id', aud:'aud', secret:'secret' }
//   Extracted from the original pre-request script by the converter.
//   Maps JWT claim names to the actual parameter names the user chose.
// JWT params are stored in rts.yml userArguments and accessed via load.config.user.args.
function getJwtToken(params, claimMap) {
  if (load.global.jwt_Token && Date.now() < load.global.jwt_expires_at) {
    return load.global.jwt_Token; // Return cached token
  }

  // Token expired or doesn't exist - generate new one.
  // JWT parameters live in rts.yml userArguments (load.config.user.args).
  // Fallback to load.params (CSV) for backward compatibility.
  const cm = claimMap || {};
  const args = (load.config && load.config.user && load.config.user.args) || {};

  const resolve = function (cmKey) {
    var fallbacks = Array.prototype.slice.call(arguments, 1);
    if (cm[cmKey] && args[cm[cmKey]]) return args[cm[cmKey]];
    if (cm[cmKey] && params[cm[cmKey]]) return params[cm[cmKey]];
    for (var i = 0; i < fallbacks.length; i++) {
      if (args[fallbacks[i]]) return args[fallbacks[i]];
      if (params[fallbacks[i]]) return params[fallbacks[i]];
    }
    return "";
  };

  const kid = resolve("kid", "signing_kid", "signingKid");
  const clientId = resolve("iss", "client_id", "clientId");
  const aud = resolve("aud", "aud");
  const scope = resolve("scope", "scope");
  const alg = cm.alg || "PS256";

  const header = { kid: kid, typ: "JWT", alg: alg };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: aud,
    iss: clientId,
    sub: resolve("sub", "client_id", "clientId") || clientId,
    iat: now,
    exp: now + 60 * 10, // 10 minutes
    jti: load.utils.uuid(), // DevWeb SDK - cryptographically random GUID v4
  };
  if (scope) payload.scope = scope;

  // Key normalisation (HTML entities, escaped newlines, YAML corruption) is
  // handled inside generateJWT() via normalisePem() — no pre-processing needed here.
  const prvkey = resolve("secret", "secret", "private_key", "signing_private_key");

  load.global.jwt_Token = generateJWT(header, payload, prvkey);
  load.global.jwt_expires_at = Date.now() + 9 * 60 * 1000; // Refresh at 9 min

  return load.global.jwt_Token;
}

module.exports = { generateJWT, getJwtToken };
