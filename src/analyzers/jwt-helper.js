/**
 * JWT helper: Fast JWT generation using Node.js crypto
 * Replaces jsrassign.js with native crypto (10x faster)
 */

const crypto = require("crypto");

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

// Generate UUID v4

function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c == "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// get Jwt Token - auto-generates or refreshes if expired
// call this function whenever you need a JWT token
// claimMap (optional): { iss:'client_id', kid:'signing_kid', scope:'scope', aud:'_jwt_aud', secret:'private_key', ... }
// Resolves each field from params[claimMap.field]; falls back to legacy hardcoded property names.
function getJwtToken(params, claimMap) {
  if (global.jwtToken && Date.now() < global.jwtExpiresAt) {
    return global.jwtToken;
  }

  const cm = claimMap || {};

  // Resolve param values via claimMap; fall back to legacy hardcoded names for backward compat
  const clientId  = (cm.iss ? params[cm.iss] : null) ||
                    (cm.sub ? params[cm.sub] : null) ||
                    params.clientId || '';
  const signingKid = (cm.kid    ? params[cm.kid]    : null) || params.signingKid || '';
  const scope      = (cm.scope  ? params[cm.scope]  : null) || params.scope || '';
  const aud        = (cm.aud    ? params[cm.aud]    : null) || params.aud || '';
  // secret: try claimMap name, then common fallbacks (private_key covers JKS-converted PEM)
  const secret     = (cm.secret ? params[cm.secret] : null) ||
                     params.secret || params.private_key || params.signing_private_key || '';

  const header = { kid: signingKid, typ: "JWT", alg: "PS256" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud,
    iss: clientId,
    sub: clientId,
    iat: now,
    exp: now + 60 * 10,
    jti: uuidv4(),
  };
  if (scope) payload.scope = scope;

  let prvkey = String(secret || "");
  prvkey = prvkey.replace(/\\n/g, "\n");

  global.jwtToken = generateJWT(header, payload, prvkey);
  global.jwtExpiresAt = Date.now() + 9 * 60 * 1000;

  return global.jwtToken;
}

module.exports = { generateJWT, uuidv4, getJwtToken };
