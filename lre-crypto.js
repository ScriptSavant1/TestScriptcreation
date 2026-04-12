/**
 * lre-crypto.js — Unified crypto helper for LoadRunner/VuGen Web HTTP/HTML scripts
 *
 * Replaces jsrsasign.js (340KB) + dpop.js with a single ~40KB file.
 * Same function signatures — zero change required in Action.c.
 *
 * DPoP (RFC 9449):
 *   initDpopKey(jwkParam)                        — init/reuse EC P-256 key pair
 *   generateDpopProof(htu, htm, accessToken)     — unique proof per request
 *   generateDpopProofs(specsJson)                — batch proofs (one web_js_run call)
 *
 * JWT (PS256 — RSA-PSS with SHA-256):
 *   createJWT(clientId, aud, scope, signingKid, secret)
 *
 * No external dependencies. Works on Windows and Linux LGs.
 * Requires VuGen LR 2023+ (V8 JS engine with BigInt support).
 */

// ─── SHA-256 ──────────────────────────────────────────────────────────────────
var _SHA256 = (function () {
  var K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ];
  function rotr(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }
  function hash(bytes) {
    var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var msg = bytes.slice();
    var len = msg.length;
    msg.push(0x80);
    while ((msg.length % 64) !== 56) msg.push(0);
    var bl = len * 8;
    msg.push(0,0,0,0,(bl/0x1000000)>>>0,(bl>>>16)&0xff,(bl>>>8)&0xff,bl&0xff);
    for (var blk = 0; blk < msg.length; blk += 64) {
      var W = [];
      for (var i = 0; i < 16; i++)
        W[i] = (msg[blk+i*4]<<24)|(msg[blk+i*4+1]<<16)|(msg[blk+i*4+2]<<8)|msg[blk+i*4+3];
      for (var i = 16; i < 64; i++) {
        var s0 = rotr(W[i-15],7)^rotr(W[i-15],18)^(W[i-15]>>>3);
        var s1 = rotr(W[i-2],17)^rotr(W[i-2],19)^(W[i-2]>>>10);
        W[i] = (W[i-16]+s0+W[i-7]+s1)>>>0;
      }
      var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
      for (var i = 0; i < 64; i++) {
        var t1=(h+(rotr(e,6)^rotr(e,11)^rotr(e,25))+((e&f)^(~e&g))+K[i]+W[i])>>>0;
        var t2=((rotr(a,2)^rotr(a,13)^rotr(a,22))+((a&b)^(a&c)^(b&c)))>>>0;
        h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
      }
      H[0]=(H[0]+a)>>>0;H[1]=(H[1]+b)>>>0;H[2]=(H[2]+c)>>>0;H[3]=(H[3]+d)>>>0;
      H[4]=(H[4]+e)>>>0;H[5]=(H[5]+f)>>>0;H[6]=(H[6]+g)>>>0;H[7]=(H[7]+h)>>>0;
    }
    var out = [];
    for (var i = 0; i < 8; i++)
      out.push((H[i]>>>24)&0xff,(H[i]>>>16)&0xff,(H[i]>>>8)&0xff,H[i]&0xff);
    return out;
  }
  return { hash: hash };
})();

// ─── HMAC-SHA256 (used by RFC 6979 deterministic k) ──────────────────────────
function _hmacSha256(keyBytes, dataBytes) {
  var k = keyBytes.length > 64 ? _SHA256.hash(keyBytes) : keyBytes.slice();
  while (k.length < 64) k.push(0);
  var iPad = [], oPad = [];
  for (var i = 0; i < 64; i++) { iPad.push(k[i]^0x36); oPad.push(k[i]^0x5c); }
  return _SHA256.hash(oPad.concat(_SHA256.hash(iPad.concat(dataBytes))));
}

// ─── Encoding helpers ─────────────────────────────────────────────────────────
function _hexToBytes(hex) {
  var b = [];
  for (var i = 0; i < hex.length; i += 2) b.push(parseInt(hex.substr(i,2),16));
  return b;
}
function _bytesToHex(b) {
  var s = '';
  for (var i = 0; i < b.length; i++) s += ('0'+(b[i]&0xff).toString(16)).slice(-2);
  return s;
}
function _b64urlEncode(bytes) {
  var t='', C='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (var i = 0; i < bytes.length; i += 3) {
    var b0=bytes[i],b1=bytes[i+1]||0,b2=bytes[i+2]||0;
    t+=C[b0>>2]+C[((b0&3)<<4)|(b1>>4)];
    t+=i+1<bytes.length?C[((b1&15)<<2)|(b2>>6)]:'=';
    t+=i+2<bytes.length?C[b2&63]:'=';
  }
  return t.replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
function _b64urlEncodeStr(s) {
  var b = [];
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) b.push(c);
    else if (c < 0x800) b.push(0xc0|(c>>6), 0x80|(c&0x3f));
    else b.push(0xe0|(c>>12), 0x80|((c>>6)&0x3f), 0x80|(c&0x3f));
  }
  return _b64urlEncode(b);
}
function _b64urlEncodeObj(o) { return _b64urlEncodeStr(JSON.stringify(o)); }
function _b64Decode(s) {
  s=s.replace(/-/g,'+').replace(/_/g,'/');
  while(s.length%4)s+='=';
  var C='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',b=[];
  for(var i=0;i<s.length;i+=4){
    var a=C.indexOf(s[i]),bb=C.indexOf(s[i+1]),c=C.indexOf(s[i+2]),d=C.indexOf(s[i+3]);
    b.push((a<<2)|(bb>>4));
    if(s[i+2]!=='=')b.push(((bb&15)<<4)|(c>>2));
    if(s[i+3]!=='=')b.push(((c&3)<<6)|d);
  }
  return b;
}
function _generateUUID() {
  var h='0123456789abcdef',u='';
  for(var i=0;i<36;i++){
    if(i===8||i===13||i===18||i===23)u+='-';
    else if(i===14)u+='4';
    else if(i===19)u+=h[Math.floor(Math.random()*4)+8];
    else u+=h[Math.floor(Math.random()*16)];
  }
  return u;
}
function _decodeHtmlEntities(str) {
  if(typeof str!=='string')return str;
  return str
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&apos;/g,"'")
    .replace(/&#x0*A;/gi,'\n').replace(/&#x0*D;/gi,'\r')
    .replace(/&#0*10;/g,'\n').replace(/&#0*13;/g,'\r');
}

// ─── BigInt helpers ───────────────────────────────────────────────────────────
function _bytesToBigInt(bytes) {
  if(!bytes||!bytes.length)return 0n;
  return BigInt('0x'+_bytesToHex(bytes));
}
function _bigIntToBytes(n, len) {
  var h=n.toString(16);
  if(h.length%2)h='0'+h;
  var b=_hexToBytes(h);
  if(len!==undefined){
    while(b.length<len)b.unshift(0);
    if(b.length>len)b=b.slice(b.length-len);
  }
  return b;
}
function _modPow(base,exp,mod){
  var r=1n;base=((base%mod)+mod)%mod;
  while(exp>0n){if(exp&1n)r=r*base%mod;exp>>=1n;base=base*base%mod;}
  return r;
}
function _modInv(a,m){
  a=((a%m)+m)%m;var m0=m,x0=0n,x1=1n;
  while(a>1n){var q=a/m0,t=m0;m0=a%m0;a=t;t=x0;x0=x1-q*x0;x1=t;}
  return x1<0n?x1+m:x1;
}

// ─── EC P-256 (ES256 for DPoP) — Jacobian coordinates for performance ────────
// Jacobian (X:Y:Z) represents affine (X/Z², Y/Z³).
// Avoids modular inversion during scalar multiplication (only 1 inv at end).
// P-256 has a = -3, enabling the fast doubling formula (alpha shortcut).
var _P256 = (function () {
  var p  = BigInt('0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF');
  var n  = BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551');
  var Gx = BigInt('0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296');
  var Gy = BigInt('0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5');

  function mp(x){ return ((x%p)+p)%p; }

  // Jacobian point doubling — a=-3 optimised (saves 1 field multiplication)
  function jDbl(X,Y,Z){
    if(Z===0n)return[0n,1n,0n];
    var YY=mp(Y*Y), ZZ=mp(Z*Z);
    var alpha=mp(3n*mp((X-ZZ)*(X+ZZ)));   // 3(X-Z²)(X+Z²) because a=-3
    var beta =mp(X*YY);
    var X3   =mp(alpha*alpha - 8n*beta);
    var Z3   =mp((Y+Z)*(Y+Z) - YY - ZZ);
    var Y3   =mp(alpha*(4n*beta - X3) - 8n*YY*YY);
    return[X3,Y3,Z3];
  }

  // Jacobian point addition — mixed (P2 affine Z2=1 for first call after init)
  function jAdd(X1,Y1,Z1,X2,Y2,Z2){
    if(Z1===0n)return[X2,Y2,Z2];
    if(Z2===0n)return[X1,Y1,Z1];
    var Z1Z1=mp(Z1*Z1), Z2Z2=mp(Z2*Z2);
    var U1=mp(X1*Z2Z2), U2=mp(X2*Z1Z1);
    var S1=mp(Y1*Z2*Z2Z2), S2=mp(Y2*Z1*Z1Z1);
    var H=mp(U2-U1);
    if(H===0n){ return mp(S2-S1)===0n ? jDbl(X1,Y1,Z1) : [0n,1n,0n]; }
    var I=mp(2n*H); I=mp(I*I);
    var J=mp(H*I), r=mp(2n*(S2-S1)), V=mp(U1*I);
    var X3=mp(r*r - J - 2n*V);
    var Y3=mp(r*(V-X3) - 2n*S1*J);
    var Z3=mp(((Z1+Z2)*(Z1+Z2) - Z1Z1 - Z2Z2)*H);
    return[X3,Y3,Z3];
  }

  // Scalar multiplication (double-and-add in Jacobian, single affine conversion at end)
  function jMul(k,Px,Py){
    var RX=0n,RY=1n,RZ=0n, QX=Px,QY=Py,QZ=1n;
    while(k>0n){
      if(k&1n){var t=jAdd(RX,RY,RZ,QX,QY,QZ);RX=t[0];RY=t[1];RZ=t[2];}
      var q=jDbl(QX,QY,QZ);QX=q[0];QY=q[1];QZ=q[2];
      k>>=1n;
    }
    if(RZ===0n)return null;
    var zI=_modInv(RZ,p), zI2=mp(zI*zI);   // single modular inversion here
    return[mp(RX*zI2), mp(RY*mp(zI*zI2))];
  }

  // RFC 6979 — deterministic k (no RNG for signing, same k for same input)
  function detK(dBytes,hBytes){
    var d32=[],h32=[];
    for(var i=0;i<32;i++){d32.push(i<dBytes.length?dBytes[i]:0);}
    for(var i=0;i<32;i++){h32.push(i<hBytes.length?hBytes[i]:0);}
    var V=[],K=[];
    for(var i=0;i<32;i++){V.push(1);K.push(0);}
    K=_hmacSha256(K,V.concat([0]).concat(d32).concat(h32));
    V=_hmacSha256(K,V);
    K=_hmacSha256(K,V.concat([1]).concat(d32).concat(h32));
    V=_hmacSha256(K,V);
    for(var att=0;att<100;att++){
      V=_hmacSha256(K,V);
      var k=_bytesToBigInt(V);
      if(k>=1n&&k<n)return k;
      K=_hmacSha256(K,V.concat([0]));V=_hmacSha256(K,V);
    }
    throw new Error('RFC6979: no valid k found');
  }

  function sign(dBytes,hashBytes){
    var d=_bytesToBigInt(dBytes);
    var z=_bytesToBigInt(hashBytes.slice(0,32));
    var k=detK(dBytes,hashBytes.slice(0,32));
    var R=jMul(k,Gx,Gy);
    var r=R[0]%n;
    if(r===0n)throw new Error('ECDSA: r is zero');
    var s=_modInv(k,n)*(((z+r*d)%n)+n)%n;
    if(s>n/2n)s=n-s;  // low-S normalisation
    if(s===0n)throw new Error('ECDSA: s is zero');
    return[r,s];
  }
  function mulG(k){ return jMul(k,Gx,Gy); }

  return{ n:n, sign:sign, mulG:mulG };
})();

// ─── DER / ASN.1 parser (RSA key extraction) ─────────────────────────────────
function _derLen(bytes,pos){
  var f=bytes[pos++];
  if(f<0x80)return{len:f,pos:pos};
  var nb=f&0x7f,len=0;
  for(var i=0;i<nb;i++)len=(len<<8)|bytes[pos++];
  return{len:len,pos:pos};
}
function _derTag(bytes,pos){
  var tag=bytes[pos++],r=_derLen(bytes,pos);
  return{tag:tag,len:r.len,pos:r.pos,end:r.pos+r.len};
}
function _derInt(bytes,pos){
  var r=_derTag(bytes,pos);
  if(r.tag!==0x02)throw new Error('DER: expected INTEGER');
  var b=bytes.slice(r.pos,r.end);
  while(b.length>1&&b[0]===0)b=b.slice(1);
  return{val:_bytesToBigInt(b),end:r.end};
}

function _parseRsaKey(pem){
  pem=_decodeHtmlEntities(pem).replace(/\\n/g,'\n');
  var isPkcs8=pem.indexOf('BEGIN PRIVATE KEY')>=0;
  var b64=pem.replace(/-----[^-]+-----/g,'').replace(/[\r\n\s]/g,'');
  var der=_b64Decode(b64);
  var pos=0;
  var seq=_derTag(der,pos); // outer SEQUENCE
  if(seq.tag!==0x30)throw new Error('DER: outer not SEQUENCE');
  pos=seq.pos;
  if(isPkcs8){
    var v=_derTag(der,pos);pos=v.end;       // version
    var alg=_derTag(der,pos);pos=alg.end;   // algorithm SEQUENCE
    var oct=_derTag(der,pos);               // OCTET STRING
    if(oct.tag!==0x04)throw new Error('DER: expected OCTET STRING in PKCS#8');
    pos=oct.pos;
    var inner=_derTag(der,pos);             // inner RSAPrivateKey SEQUENCE
    if(inner.tag!==0x30)throw new Error('DER: inner not SEQUENCE');
    pos=inner.pos;
  }
  // RSAPrivateKey fields: version, n, e, d, p, q, dp, dq, qInv
  var ver=_derTag(der,pos);pos=ver.end;
  var N=_derInt(der,pos);pos=N.end;
  var e=_derInt(der,pos);pos=e.end;
  var d=_derInt(der,pos);pos=d.end;
  var pp=_derInt(der,pos);pos=pp.end;
  var q=_derInt(der,pos);pos=q.end;
  var dp=_derInt(der,pos);pos=dp.end;
  var dq=_derInt(der,pos);pos=dq.end;
  var qi=_derInt(der,pos);
  return{n:N.val,e:e.val,d:d.val,p:pp.val,q:q.val,dp:dp.val,dq:dq.val,qi:qi.val};
}

// ─── MGF1-SHA256 ─────────────────────────────────────────────────────────────
function _mgf1(seed,len){
  var T=[],ctr=0;
  while(T.length<len){
    var C=[(ctr>>>24)&0xff,(ctr>>>16)&0xff,(ctr>>>8)&0xff,ctr&0xff];
    T=T.concat(_SHA256.hash(seed.concat(C)));ctr++;
  }
  return T.slice(0,len);
}

// ─── RSA-PSS sign (PS256 — matches jwt-helper.js: PSS + SHA256, sLen = hLen) ─
function _rsaPssSign(key,msgBytes){
  // Compute modulus bit-length from hex
  var nHex=key.n.toString(16);
  var modBits=(nHex.length-1)*4+Math.floor(Math.log2(parseInt(nHex[0],16)+1)|0)+1;
  // Recount accurately
  var tmp=key.n,modBits=0; while(tmp>0n){tmp>>=1n;modBits++;}

  var hLen=32,sLen=32; // SHA-256, salt = digest length (RSA_PSS_SALTLEN_DIGEST)
  var emLen=Math.ceil((modBits-1)/8);

  var mHash=_SHA256.hash(msgBytes);

  // Random salt (PSS)
  var salt=[];
  for(var i=0;i<sLen;i++)salt.push(Math.floor(Math.random()*256));

  // M' = 0x00*8 || mHash || salt
  var mPrime=[0,0,0,0,0,0,0,0].concat(mHash).concat(salt);
  var H=_SHA256.hash(mPrime);

  // DB = 0x00*(emLen-sLen-hLen-2) || 0x01 || salt
  var DB=[];
  for(var i=0;i<emLen-sLen-hLen-2;i++)DB.push(0);
  DB.push(0x01);
  DB=DB.concat(salt);

  // maskedDB = DB XOR MGF1(H, emLen-hLen-1)
  var dbMask=_mgf1(H,emLen-hLen-1);
  var maskedDB=[];
  for(var i=0;i<DB.length;i++)maskedDB.push(DB[i]^dbMask[i]);

  // Clear top bits per PSS spec
  maskedDB[0]&=(0xff>>>(8*emLen-(modBits-1)));

  // EM = maskedDB || H || 0xbc
  var EM=maskedDB.concat(H).concat([0xbc]);

  // RSA private-key operation using CRT (fast)
  var m=_bytesToBigInt(EM);
  var sig;
  if(key.p&&key.q&&key.dp&&key.dq&&key.qi){
    var sp=_modPow(m%key.p,key.dp,key.p);
    var sq=_modPow(m%key.q,key.dq,key.q);
    var h2=key.qi*((sp-sq+key.p)%key.p)%key.p;
    sig=sq+h2*key.q;
  }else{
    sig=_modPow(m,key.d,key.n);
  }
  return _bigIntToBytes(sig,Math.ceil(modBits/8));
}

// ─── DPoP module-level state ──────────────────────────────────────────────────
// These persist within a single web_js_run SOURCES block (same behaviour as dpop.js)
var dpopPrivateKeyBytes = null;  // 32-byte EC P-256 private key d
var dpopPublicJwk       = null;  // { kty, crv, x, y } — embedded in DPoP header

/**
 * initDpopKey — identical API to dpop.js
 * Reuses existing EC P-256 JWK stored in LR param; generates a new pair if none.
 */
function initDpopKey(jwkParam) {
  try {
    if (jwkParam && jwkParam !== '' && jwkParam !== 'null' && jwkParam !== '{dpop_jwk}') {
      var jwk = JSON.parse(jwkParam);
      if (jwk.kty === 'EC' && jwk.crv === 'P-256' && jwk.d) {
        var dRaw = _b64Decode(jwk.d);
        while (dRaw.length < 32) dRaw.unshift(0);
        dpopPrivateKeyBytes = dRaw.slice(dRaw.length - 32);
        dpopPublicJwk = { kty:'EC', crv:'P-256', x:jwk.x, y:jwk.y };
        return 'Using existing EC P-256 key pair';
      }
    }
    return _generateDpopKeyPair();
  } catch (e) {
    return 'Error in initDpopKey: ' + e.message;
  }
}

function _generateDpopKeyPair() {
  // Random private key d in [1, n-1]
  var n = _P256.n;
  var d, dBytes;
  do {
    dBytes = [];
    for (var i = 0; i < 32; i++) dBytes.push(Math.floor(Math.random() * 256));
    d = _bytesToBigInt(dBytes);
  } while (d < 1n || d >= n);

  dpopPrivateKeyBytes = _bigIntToBytes(d, 32);

  // Public key Q = d * G
  var Q = _P256.mulG(d);
  var xBytes = _bigIntToBytes(Q[0], 32);
  var yBytes = _bigIntToBytes(Q[1], 32);

  dpopPublicJwk = {
    kty: 'EC', crv: 'P-256',
    x: _b64urlEncode(xBytes),
    y: _b64urlEncode(yBytes)
  };

  // Persist full JWK (with private d) so next initDpopKey call can reuse it
  var fullJwk = JSON.stringify({
    kty:'EC', crv:'P-256',
    x: dpopPublicJwk.x, y: dpopPublicJwk.y,
    d: _b64urlEncode(dpopPrivateKeyBytes)
  });
  if (typeof LR !== 'undefined') LR.setParam('dpop_jwk', fullJwk);

  return 'Generated new EC P-256 key pair';
}

/**
 * generateDpopProof — identical API to dpop.js
 * Generates a unique DPoP proof JWT per request (RFC 9449).
 *
 * @param {string} htu         HTTP Target URI (no query string)
 * @param {string} htm         HTTP method (GET, POST, etc.)
 * @param {string} accessToken Optional — Bearer token for ath claim
 * @returns {string}           Signed DPoP JWT (header.payload.signature)
 */
function generateDpopProof(htu, htm, accessToken) {
  if (!dpopPrivateKeyBytes || !dpopPublicJwk) {
    throw new Error('DPoP key pair not initialised. Call initDpopKey() first.');
  }

  var header = { alg:'ES256', typ:'dpop+jwt', jwk: dpopPublicJwk };
  var now = Math.floor(Date.now() / 1000);
  var payload = {
    htu: htu,
    htm: htm.toUpperCase(),
    iat: now,
    jti: _generateUUID()
  };

  // ath = base64url(SHA-256(access_token)) — RFC 9449 §4.2
  if (accessToken && accessToken !== '' && accessToken !== 'null' && accessToken !== 'undefined') {
    var atBytes = [];
    for (var i = 0; i < accessToken.length; i++) {
      var c = accessToken.charCodeAt(i);
      if (c < 0x80) atBytes.push(c);
      else if (c < 0x800) atBytes.push(0xc0|(c>>6), 0x80|(c&0x3f));
      else atBytes.push(0xe0|(c>>12), 0x80|((c>>6)&0x3f), 0x80|(c&0x3f));
    }
    payload.ath = _b64urlEncode(_SHA256.hash(atBytes));
  }

  var signingInput = _b64urlEncodeObj(header) + '.' + _b64urlEncodeObj(payload);

  // Sign with ES256 — RFC 6979 deterministic k (no RNG for signing)
  var msgBytes = [];
  for (var i = 0; i < signingInput.length; i++) msgBytes.push(signingInput.charCodeAt(i) & 0xff);
  var hashBytes = _SHA256.hash(msgBytes);
  var rs = _P256.sign(dpopPrivateKeyBytes, hashBytes);

  // Raw R||S format (64 bytes for P-256) — required by RFC 7515
  var rawSig = _bigIntToBytes(rs[0], 32).concat(_bigIntToBytes(rs[1], 32));
  return signingInput + '.' + _b64urlEncode(rawSig);
}

/**
 * generateDpopProofs — identical API to dpop.js batch function.
 * Generates multiple proofs in ONE web_js_run call → reduces web_js_run count.
 *
 * @param {string} specsJson  JSON array of { htu, htm, ath, paramName }
 * @returns {string}          "N proofs generated"
 */
function generateDpopProofs(specsJson) {
  if (!dpopPrivateKeyBytes || !dpopPublicJwk) {
    throw new Error('DPoP key pair not initialised. Call initDpopKey() first.');
  }
  var specs = JSON.parse(specsJson);
  for (var i = 0; i < specs.length; i++) {
    var s = specs[i];
    var proof = generateDpopProof(s.htu, s.htm, s.ath || '');
    if (typeof LR !== 'undefined') LR.setParam(s.paramName, proof);
  }
  return specs.length + ' proofs generated';
}

/**
 * createJWT — PS256 JWT for VuGen Web HTTP scripts.
 * Matches exact call signature emitted by the converter in Action.c:
 *   createJWT(LR.getParam('client_id'), LR.getParam('aud'), LR.getParam('scope'),
 *             LR.getParam('signing_kid'), LR.getParam('secret'))
 *
 * Algorithm: RSA-PSS with SHA-256 (PS256) — identical to jwt-helper.js
 * Token lifetime: 10 minutes (cached by caller if needed)
 *
 * @param {string} clientId   client_id — used as iss and sub
 * @param {string} aud        audience claim
 * @param {string} scope      scope claim (omitted from payload if empty)
 * @param {string} signingKid kid header value
 * @param {string} secret     RSA private key PEM (PKCS#1 or PKCS#8)
 * @returns {string}          Signed JWT string
 */
function createJWT(clientId, aud, scope, signingKid, secret) {
  var header = { kid: signingKid, typ: 'JWT', alg: 'PS256' };
  var now = Math.floor(Date.now() / 1000);
  var payload = {
    aud: aud,
    iss: clientId,
    sub: clientId,
    iat: now,
    exp: now + 600,   // 10 minutes — matches jwt-helper.js
    jti: _generateUUID()
  };
  if (scope && scope !== '' && scope !== 'null') payload.scope = scope;

  var signingInput = _b64urlEncodeObj(header) + '.' + _b64urlEncodeObj(payload);

  // Parse RSA private key PEM
  var pem = _decodeHtmlEntities(secret || '').replace(/\\n/g, '\n');
  var key = _parseRsaKey(pem);

  // Sign with RSA-PSS SHA-256 (PS256)
  var msgBytes = [];
  for (var i = 0; i < signingInput.length; i++) msgBytes.push(signingInput.charCodeAt(i) & 0xff);
  var sigBytes = _rsaPssSign(key, msgBytes);

  return signingInput + '.' + _b64urlEncode(sigBytes);
}
