/**
 * dpop.js - DPoP (Demonstrating Proof-of-Possession) for VuGen Web HTTP/HTML
 * Implements RFC 9449 using jsrsasign for real EC P-256 cryptography.
 *
 * Usage in Action.c:
 *   web_js_run(
 *       "Code=initDpopKey(LR.getParam('dpop_jwk')); var proof = generateDpopProof('https://...', 'POST'); proof;",
 *       "ResultParam=dpop_proof",
 *       SOURCES,
 *       "File=jsrsasign.js", ENDITEM,
 *       "File=dpop.js", ENDITEM,
 *       LAST);
 *
 * Requires: jsrsasign.js (same file used for JWT signing in VuGen scripts)
 */

// Global state - persists across web_js_run calls within the same SOURCES block
var dpopPrivateKeyObj = null; // KJUR.crypto.ECDSA key object
var dpopPrivateJwk = null; // JWK object {kty,crv,x,y,d}
var dpopPublicJwk = null; // JWK object {kty,crv,x,y} (no d)

/**
 * Initialize DPoP key pair. If jwkParam contains a valid JWK, import it.
 * Otherwise generate a new EC P-256 key pair.
 * @param {string} jwkParam - JWK JSON string from LR parameter, or empty
 * @returns {string} Status message
 */
function initDpopKey(jwkParam) {
  try {
    // Try to reuse existing key from LR parameter
    if (
      jwkParam &&
      jwkParam !== "" &&
      jwkParam !== "null" &&
      jwkParam !== "{dpop_jwk}"
    ) {
      var jwk = JSON.parse(jwkParam);
      if (jwk.kty === "EC" && jwk.crv === "P-256" && jwk.d) {
        dpopPrivateJwk = jwk;
        dpopPublicJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
        // Import into jsrsasign key object
        dpopPrivateKeyObj = KEYUTIL.getKey(jwk);
        return "Using existing EC P-256 key pair";
      }
    }

    // Generate new EC P-256 key pair using jsrsasign
    var kp = KEYUTIL.generateKeypair("EC", "P-256");
    dpopPrivateKeyObj = kp.prvKeyObj;

    // Export to JWK format
    var prvJwk = KEYUTIL.getJWKFromKey(kp.prvKeyObj);
    var pubJwk = KEYUTIL.getJWKFromKey(kp.pubKeyObj);

    dpopPrivateJwk = {
      kty: "EC",
      crv: "P-256",
      x: pubJwk.x,
      y: pubJwk.y,
      d: prvJwk.d,
    };
    dpopPublicJwk = { kty: "EC", crv: "P-256", x: pubJwk.x, y: pubJwk.y };

    // Store back to LR parameter for reuse across iterations
    LR.setParam("dpop_jwk", JSON.stringify(dpopPrivateJwk));

    return "Generated new EC P-256 key pair";
  } catch (e) {
    return "Error initializing DPoP key: " + e.message;
  }
}

/**
 * Generate a DPoP proof JWT (RFC 9449).
 * @param {string} htu - HTTP Target URI (no query params)
 * @param {string} htm - HTTP method (GET, POST, etc.)
 * @param {string} [accessToken] - Optional Bearer token for ath claim
 * @returns {string} Signed DPoP proof JWT
 */
function generateDpopProof(htu, htm, accessToken) {
  if (!dpopPrivateKeyObj || !dpopPublicJwk) {
    throw new Error("DPoP key pair not initialized. Call initDpopKey() first.");
  }

  // Header
  var header = {
    alg: "ES256",
    typ: "dpop+jwt",
    jwk: dpopPublicJwk,
  };

  // Payload
  var now = Math.floor(Date.now() / 1000);
  var payload = {
    htu: htu,
    htm: htm.toUpperCase(),
    iat: now,
    jti: generateUUID(),
  };

  // ath claim - SHA-256 hash of access token (RFC 9449 §4.2)
  if (
    accessToken &&
    accessToken !== "" &&
    accessToken !== "null" &&
    accessToken !== "undefined"
  ) {
    var md = new KJUR.crypto.MessageDigest({ alg: "sha256" });
    md.updateString(accessToken);
    var hashHex = md.digest();
    payload.ath = hextob64u(hashHex);
  }

  // Sign using jsrsasign - produces correct raw R||S signature for ES256
  var sHeader = JSON.stringify(header);
  var sPayload = JSON.stringify(payload);
  var token = KJUR.jws.JWS.sign("ES256", sHeader, sPayload, dpopPrivateKeyObj);

  return token;
}

/**
 * Generate multiple DPoP proofs in a single call (batch mode).
 * Avoids re-loading jsrsasign-vugen.js for each request.
 * @param {string} proofSpecs - JSON array of [{htu, htm, ath, paramName}]
 * @returns {string} Status message with count of proofs generated
 */
function generateDpopProofs(proofSpecs) {
  if (!dpopPrivateKeyObj || !dpopPublicJwk) {
    throw new Error("DPoP key pair not initialized. Call initDpopKey() first.");
  }
  var specs = JSON.parse(proofSpecs);
  for (var i = 0; i < specs.length; i++) {
    var s = specs[i];
    var proof = generateDpopProof(s.htu, s.htm, s.ath || null);
    LR.setParam(s.paramName, proof);
  }
  return specs.length + " proofs generated";
}

/**
 * Generate UUID v4
 * @returns {string} UUID string
 */
function generateUUID() {
  var hex = "0123456789abcdef";
  var uuid = "";
  for (var i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      uuid += "-";
    } else if (i === 14) {
      uuid += "4";
    } else if (i === 19) {
      uuid += hex[Math.floor(Math.random() * 4) + 8];
    } else {
      uuid += hex[Math.floor(Math.random() * 16)];
    }
  }
  return uuid;
}
