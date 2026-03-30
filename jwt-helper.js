/**
 * JWT helper: Fast JWT generation using Node.js crypto
 * Replaces jsrassign.js with native crypto (10x faster)
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
    .replace(/&amp;/g,    "&")
    .replace(/&lt;/g,     "<")
    .replace(/&gt;/g,     ">")
    .replace(/&quot;/g,   '"')
    .replace(/&#39;/g,    "'")
    .replace(/&apos;/g,   "'")
    .replace(/&#x0*A;/gi, "\n")   // &#xA; or &#x000A; — newlines in PEM blocks
    .replace(/&#0*10;/g,  "\n")   // &#10;
    .replace(/&#x0*D;/gi, "\r")   // &#xD;
    .replace(/&#0*13;/g,  "\r");  // &#13;
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
function getJwtToken(params) {
  if (load.global.jwt_Token && Date.now() < load.global.jwt_expires_at) {
    return load.global.jwt_Token; // Return cached token
  }

  // Token expired or doesn't exist — generate new one
  const header = {
    kid: params.signingKid,
    typ: "JWT",
    alg: "PS256",
  };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: params.aud,
    iss: params.clientId,
    sub: params.clientId,
    iat: now,
    exp: now + 60 * 10, // 10 minutes
    jti: load.utils.uuid(), // DevWeb SDK — cryptographically random UUID v4
  };

  let prvkey = params.secret || "";
  prvkey = decodeHtmlEntities(prvkey);   // Decode HTML entities before crypto use (fixes "DECODER routines:: unsupported")
  prvkey = prvkey.replace(/\\n/g, "\n"); // Handle escaped newlines

  load.global.jwt_Token = generateJWT(header, payload, prvkey);
  load.global.jwt_expires_at = Date.now() + 9 * 60 * 1000; // Refresh at 9 min

  return load.global.jwt_Token;
}

module.exports = { generateJWT, getJwtToken };
