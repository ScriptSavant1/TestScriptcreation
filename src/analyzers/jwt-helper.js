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
function getJwtToken(params) {
  if (global.jwtToken && Date.now() < global.jwtExpiresAt) {
    return global.jwt_Token; // Return cached token
  }

  //Token expired or doesn't exist - generate new one
  load.log("Generating JWT token", loadLogLevel.Info);
  const header = {
    kid: params.signingKid,
    typ: "JWT",
    alg: "PS256",
  };
  const now = Math.floor(Date.now() / 1000); // Refresh at 9 min
  const payload = {
    aud: params.aud,
    iss: params.clientId,
    sub: params.clientId,
    iat: now,
    exp: now + 60 * 10, // 10 minutes
    jti: uuidv4(),
  };

  let prvkey = params.secret || "";
  prvkey = prvkey.replace(/\\n/g, "\n"); // Handle escaped newlines

  load.global.jwt_Token = generateJWT(header, payload, prvkey);
  load.global.jwt_expires_at = Date.now() + 9 * 60 * 1000; // Refresh at 9 min

  return load.global.jwt_Token;
}

module.exports = { generateJwt, uuidv4, getJwtToken };
