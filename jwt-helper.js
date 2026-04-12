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
 * Generate JWT token with RS256 algorithm
 */
function generateJWT(header, payload, privateKey) {
  const base64UrlEncode = (str) => {
    return Buffer.from(str)
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  };

  const headerEncoded = base64UrlEncode(JSON.stringify(header));
  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
  const signatureInput = `${headerEncoded}.${payloadEncoded}`;

  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signatureInput);
  sign.end();

  const signature = sign
    .sign(
      {
        key: privateKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
      },
      "base64",
    )
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${signatureInput}.${signature}`;
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

  const resolve = (cmKey, ...fallbacks) => {
    if (cm[cmKey] && args[cm[cmKey]]) return args[cm[cmKey]];
    if (cm[cmKey] && params[cm[cmKey]]) return params[cm[cmKey]];
    for (const fb of fallbacks) {
      if (args[fb]) return args[fb];
      if (params[fb]) return params[fb];
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

  let prvkey = resolve(
    "secret",
    "secret",
    "private_key",
    "signing_private_key",
  );
  prvkey = decodeHtmlEntities(prvkey); // Decode HTML entities before crypto use (fixes "DECODER routines:: unsupported")
  prvkey = prvkey.replace(/\\n/g, "\n"); // Handle escaped newlines

  load.global.jwt_Token = generateJWT(header, payload, prvkey);
  load.global.jwt_expires_at = Date.now() + 9 * 60 * 1000; // Refresh at 9 min

  return load.global.jwt_Token;
}

module.exports = { generateJWT, getJwtToken };
