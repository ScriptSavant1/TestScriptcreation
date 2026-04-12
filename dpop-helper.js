/**
 * DPoP Helper: EC P-256 key generation and DPoP proof signing using Node.js crypto
 * Implements RFC 9449 - OAuth 2.0 Demonstrating Proof-of-Possession at the Application Layer (DPoP)
 */

const crypto = require("crypto");

/**
 * Generate EC P-256 key pair in JWK format
 * @returns {Object} JWK private key with public key components
 */
function generateEcP256KeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });

  const privateJwk = privateKey.export({ format: "jwk" });

  return {
    kty: "EC",
    crv: "P-256",
    x: privateJwk.x,
    y: privateJwk.y,
    d: privateJwk.d,
  };
}

/**
 * Generate DPoP proof JWT
 * @param {string} htu - HTTP Target URI (without query parameters)
 * @param {string} htm - HTTP method (POST, GET, etc.)
 * @param {Object|string} jwk - EC P-256 private key in JWK format (object or JSON string)
 * @param {string} [accessToken] - Optional access token for ath (access token hash) claim
 * @returns {string} DPoP proof JWT
 */
function getDpopProof(htu, htm, jwk, accessToken) {
  // Parse JWK if it's a string
  let privateJwk;

  // Handle undefined, null, or empty string JWK - generate new key
  if (!jwk || jwk === "" || jwk === "null" || jwk === "undefined") {
    console.log(
      "No JWK provided, generating new EC P-256 key pair for DPoP...",
    );
    privateJwk = generateEcP256KeyPair();
    // Store the generated key back to load.global for reuse
    if (typeof load !== "undefined" && load.global) {
      load.global.dpop_jwk = JSON.stringify(privateJwk);
    }
  } else if (typeof jwk === "string") {
    try {
      privateJwk = JSON.parse(jwk);
    } catch (e) {
      console.log("Invalid JWK string, generating new key pair:", e.message);
      privateJwk = generateEcP256KeyPair();
      if (typeof load !== "undefined" && load.global) {
        load.global.dpop_jwk = JSON.stringify(privateJwk);
      }
    }
  } else if (typeof jwk === "object" && jwk !== null) {
    privateJwk = jwk;
  } else {
    console.log("Invalid JWK type, generating new key pair");
    privateJwk = generateEcP256KeyPair();
    if (typeof load !== "undefined" && load.global) {
      load.global.dpop_jwk = JSON.stringify(privateJwk);
    }
  }

  // Validate that we have a proper EC P-256 key
  if (
    !privateJwk ||
    !privateJwk.d ||
    privateJwk.kty !== "EC" ||
    privateJwk.crv !== "P-256"
  ) {
    console.log(
      "Invalid or incomplete JWK, generating new EC P-256 key pair for DPoP...",
    );
    privateJwk = generateEcP256KeyPair();
    // Store the generated key back to load.global for reuse
    if (typeof load !== "undefined" && load.global) {
      load.global.dpop_jwk = JSON.stringify(privateJwk);
    }
  }

  // Build public JWK for header (without private key 'd')
  const publicJwk = {
    kty: privateJwk.kty,
    crv: privateJwk.crv,
    x: privateJwk.x,
    y: privateJwk.y,
  };

  // Create DPoP header
  const header = {
    alg: "ES256",
    typ: "dpop+jwt",
    jwk: publicJwk,
  };

  // Create DPoP payload
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    htu: htu,
    htm: htm.toUpperCase(),
    iat: now,
    jti: crypto.randomUUID(),
  };

  // Add ath (access token hash) claim when an access token is provided (RFC 9449 §4.2)
  if (
    accessToken &&
    accessToken !== "" &&
    accessToken !== "null" &&
    accessToken !== "undefined"
  ) {
    const tokenHash = crypto
      .createHash("sha256")
      .update(accessToken)
      .digest("base64url");
    payload.ath = tokenHash;
  }

  // Base64URL encode header and payload
  const base64UrlEncode = (obj) => {
    return Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  };

  const encodedHeader = base64UrlEncode(header);
  const encodedPayload = base64UrlEncode(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  // Sign with ES256 (ECDSA using P-256 and SHA-256)
  const privateKey = crypto.createPrivateKey({
    key: privateJwk,
    format: "jwk",
  });

  // Node.js crypto.sign() returns DER-encoded ECDSA signature, but JWS (RFC 7515)
  // requires raw R||S format (64 bytes for P-256). Convert DER -> raw.
  const derSig = crypto.sign("sha256", Buffer.from(signingInput), privateKey);
  const rawSig = derToRawEcdsa(derSig, 32); // 32 bytes per component for P-256
  const encodedSignature = rawSig
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${signingInput}.${encodedSignature}`;
}

/**
 * Convert a DER-encoded ECDSA signature to raw R||S format.
 * DER: 0x30 <len> 0x02 <rLen> <R> 0x02 <sLen> <S>
 * Raw: <R padded to componentLen> <S padded to componentLen>
 * @param {Buffer} der - DER-encoded signature
 * @param {number} componentLen - Byte length of each component (32 for P-256)
 * @returns {Buffer} Raw R||S signature
 */
function derToRawEcdsa(der, componentLen) {
  let offset = 2; // skip 0x30 <totalLen>
  // R
  offset++; // skip 0x02
  const rLen = der[offset++];
  let r = der.subarray(offset, offset + rLen);
  offset += rLen;
  // S
  offset++; // skip 0x02
  const sLen = der[offset++];
  let s = der.subarray(offset, offset + sLen);
  // Strip leading zero padding (DER uses it for positive sign)
  if (r.length > componentLen) r = r.subarray(r.length - componentLen);
  if (s.length > componentLen) s = s.subarray(s.length - componentLen);
  // Pad to componentLen if shorter
  const raw = Buffer.alloc(componentLen * 2);
  r.copy(raw, componentLen - r.length);
  s.copy(raw, componentLen * 2 - s.length);
  return raw;
}

module.exports = { getDpopProof, generateEcP256KeyPair };
