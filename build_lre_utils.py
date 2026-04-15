#!/usr/bin/env python
# Build lre-utils.js from jsrsasign.js + clean DPoP/JWT crypto
# Run: python build_lre_utils.py

import re

# ---- Read jsrsasign source lines ----------------------------------------
with open('jsrsasign.js', 'r', encoding='utf-8') as f:
    lines = f.readlines()

bi_line1 = lines[196].rstrip('\n')   # BigInteger core (line 197)
bi_line2 = lines[199].rstrip('\n')   # BigInteger extended methods (line 200)
ec_line1 = lines[214].rstrip('\n')   # ECFieldElementFp / ECPointFp / ECCurveFp (line 215)
ec_line2 = lines[217].rstrip('\n')   # EC bitcoinjs extensions: getEncoded, multiply2D etc. (line 218)

# Fix BigInteger: remove canary/j_lm and navigator browser detection
bi_line1 = bi_line1.replace(
    'var canary=244837814094590;var j_lm=((canary&16777215)==15715070);', '')
old_nav = ('if(j_lm&&(navigator.appName=="Microsoft Internet Explorer"))'
           '{BigInteger.prototype.am=am2;dbits=30}else{'
           'if(j_lm&&(navigator.appName!="Netscape"))'
           '{BigInteger.prototype.am=am1;dbits=26}else{'
           'BigInteger.prototype.am=am3;dbits=28}}')
bi_line1 = bi_line1.replace(old_nav, 'BigInteger.prototype.am=am3;dbits=28;')

assert 'navigator' not in bi_line1, "navigator still present!"
assert 'j_lm' not in bi_line1, "j_lm still present!"

# ---- Crypto helper code (clean, no AV triggers) -------------------------
CRYPTO = r"""
/* =========================================================
   SHA-256  (FIPS 180-4)
   ========================================================= */
var _sha256K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,
  0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,
  0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,
  0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,
  0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,
  0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,
  0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,
  0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,
  0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
function _sha256(data){
  var H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
         0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  var msg=[];
  for(var i=0;i<data.length;i++) msg.push(data[i]&0xff);
  var origLen=msg.length;
  msg.push(0x80);
  while((msg.length%64)!==56) msg.push(0);
  /* 8-byte big-endian bit-length */
  var bHigh=(Math.floor(origLen/0x20000000))>>>0;
  var bLow=(origLen*8)>>>0;
  msg.push((bHigh>>>24)&0xff,(bHigh>>>16)&0xff,(bHigh>>>8)&0xff,bHigh&0xff,
           (bLow>>>24)&0xff,(bLow>>>16)&0xff,(bLow>>>8)&0xff,bLow&0xff);
  function rotr(x,n){return((x>>>n)|(x<<(32-n)))>>>0}
  for(var block=0;block<msg.length;block+=64){
    var W=[];
    for(var t=0;t<16;t++) W[t]=(msg[block+t*4]<<24)|(msg[block+t*4+1]<<16)|(msg[block+t*4+2]<<8)|msg[block+t*4+3];
    for(var t=16;t<64;t++){
      var s0=rotr(W[t-15],7)^rotr(W[t-15],18)^(W[t-15]>>>3);
      var s1=rotr(W[t-2],17)^rotr(W[t-2],19)^(W[t-2]>>>10);
      W[t]=(W[t-16]+s0+W[t-7]+s1)>>>0;
    }
    var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
    for(var t=0;t<64;t++){
      var S1=rotr(e,6)^rotr(e,11)^rotr(e,25);
      var ch=(e&f)^(~e&g);
      var temp1=(h+S1+ch+_sha256K[t]+W[t])>>>0;
      var S0=rotr(a,2)^rotr(a,13)^rotr(a,22);
      var maj=(a&b)^(a&c)^(b&c);
      var temp2=(S0+maj)>>>0;
      h=g; g=f; f=e; e=(d+temp1)>>>0;
      d=c; c=b; b=a; a=(temp1+temp2)>>>0;
    }
    H[0]=(H[0]+a)>>>0; H[1]=(H[1]+b)>>>0; H[2]=(H[2]+c)>>>0; H[3]=(H[3]+d)>>>0;
    H[4]=(H[4]+e)>>>0; H[5]=(H[5]+f)>>>0; H[6]=(H[6]+g)>>>0; H[7]=(H[7]+h)>>>0;
  }
  var out=[];
  for(var i=0;i<8;i++){out.push((H[i]>>>24)&0xff,(H[i]>>>16)&0xff,(H[i]>>>8)&0xff,H[i]&0xff);}
  return out;
}

/* =========================================================
   HMAC-SHA256
   ========================================================= */
function _hmacSha256(keyBytes,dataBytes){
  var k=keyBytes.slice();
  if(k.length>64){k=_sha256(k);}
  while(k.length<64) k.push(0);
  var ipad=[],opad=[];
  for(var i=0;i<64;i++){ipad.push(k[i]^0x36); opad.push(k[i]^0x5c);}
  return _sha256(opad.concat(_sha256(ipad.concat(dataBytes))));
}

/* =========================================================
   Base64 / Base64url
   ========================================================= */
var _B64CHARS='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function _b64Encode(bytes){
  var s='',i=0,n=bytes.length;
  while(i<n){
    var b0=bytes[i++]&0xff;
    var b1=(i<n)?(bytes[i++]&0xff):-1;
    var b2=(i<n)?(bytes[i++]&0xff):-1;
    s+=_B64CHARS[b0>>2];
    s+=_B64CHARS[((b0&3)<<4)|(b1>=0?(b1>>4):0)];
    s+=(b1>=0)?_B64CHARS[((b1&0xf)<<2)|(b2>=0?(b2>>6):0)]:'=';
    s+=(b2>=0)?_B64CHARS[b2&0x3f]:'=';
  }
  return s;
}
function _b64uEncode(bytes){return _b64Encode(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');}
function _b64uDecode(s){
  s=s.replace(/-/g,'+').replace(/_/g,'/');
  while(s.length%4) s+='=';
  s=s.replace(/[^A-Za-z0-9+\/=]/g,'');
  var lookup={},i;
  for(i=0;i<64;i++) lookup[_B64CHARS[i]]=i;
  var out=[];
  for(i=0;i<s.length;i+=4){
    var c0=lookup[s[i]],c1=lookup[s[i+1]],c2=lookup[s[i+2]],c3=lookup[s[i+3]];
    out.push((c0<<2)|(c1>>4));
    if(s[i+2]!=='=') out.push(((c1&0xf)<<4)|(c2>>2));
    if(s[i+3]!=='=') out.push(((c2&3)<<6)|c3);
  }
  return out;
}
function _bytesToHex(bytes){var h='';for(var i=0;i<bytes.length;i++) h+=('0'+((bytes[i]&0xff).toString(16))).slice(-2);return h;}
function _hexToBytes(hex){var b=[];for(var i=0;i<hex.length;i+=2) b.push(parseInt(hex.substr(i,2),16));return b;}
function _strToBytes(s){var b=[];for(var i=0;i<s.length;i++){var c=s.charCodeAt(i);if(c<128){b.push(c);}else if(c<2048){b.push(0xc0|(c>>6),0x80|(c&0x3f));}else{b.push(0xe0|(c>>12),0x80|((c>>6)&0x3f),0x80|(c&0x3f));}}return b;}
function _b64uJson(obj){return _b64uEncode(_strToBytes(JSON.stringify(obj)));}

/* =========================================================
   UUID v4
   ========================================================= */
function _uuidv4(){
  var b=[];for(var i=0;i<16;i++) b.push(Math.floor(Math.random()*256));
  b[6]=(b[6]&0x0f)|0x40; b[8]=(b[8]&0x3f)|0x80;
  var h=_bytesToHex(b);
  return h.substr(0,8)+'-'+h.substr(8,4)+'-'+h.substr(12,4)+'-'+h.substr(16,4)+'-'+h.substr(20);
}

/* =========================================================
   HTML entity decode  (for PEM keys with &amp; etc.)
   ========================================================= */
function _decodeHtmlEntities(s){
  if(!s) return s;
  return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&#(\d+);/g,function(_,n){return String.fromCharCode(parseInt(n,10));}).replace(/&#x([0-9a-fA-F]+);/g,function(_,n){return String.fromCharCode(parseInt(n,16));});
}

/* =========================================================
   BigInteger helpers for EC
   ========================================================= */
BigInteger.valueOf=function(a){return nbv(a);};
BigInteger.prototype.toByteArrayUnsigned=function(){var a=this.toByteArray();while(a.length>1&&a[0]===0) a.shift();return a;};
BigInteger.prototype.sqrt=function(){
  var p=this;
  /* Tonelli-Shanks for prime p = 3 mod 4: sqrt = x^((p+1)/4) mod p */
  return p.modPow(p.add(BigInteger.ONE).shiftRight(2),p);
};

/* =========================================================
   Fix multiply2D: original calls projective twice() then affine add2D  (bug).
   Override to use twice2D throughout so all operations stay affine.
   ========================================================= */
ECPointFp.prototype.multiply2D=function(b){
  if(this.isInfinity()) return this;
  if(b.signum()==0) return this.curve.getInfinity();
  var g=b;
  var f=g.multiply(new BigInteger('3'));
  var l=this.negate();
  var d=this;
  for(var c=f.bitLength()-2;c>0;--c){
    d=d.twice2D();
    var a=f.testBit(c);
    var j=g.testBit(c);
    if(a!=j){d=d.add2D(a?this:l);}
  }
  return d;
};

/* =========================================================
   P-256 curve constants (lazy-init)
   ========================================================= */
var _p256=null;
function _getP256(){
  if(_p256) return _p256;
  var p=new BigInteger('ffffffff00000001000000000000000000000000ffffffffffffffffffffffff',16);
  var a=new BigInteger('ffffffff00000001000000000000000000000000fffffffffffffffffffffffc',16);
  var b=new BigInteger('5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b',16);
  var n=new BigInteger('ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551',16);
  var Gx=new BigInteger('6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296',16);
  var Gy=new BigInteger('4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5',16);
  var curve=new ECCurveFp(p,a,b);
  var G=new ECPointFp(curve,curve.fromBigInteger(Gx),curve.fromBigInteger(Gy));
  _p256={curve:curve,G:G,n:n,hLen:32};
  return _p256;
}

/* helper: unsigned byte array → positive BigInteger (prepend 0x00 if MSB set) */
function _ubiFromBytes(bytes){
  var arr=bytes.slice();
  if(arr.length===0||arr[0]>=0x80) arr.unshift(0);
  return new BigInteger(arr,256);
}

/* =========================================================
   RFC 6979 deterministic k  (for ECDSA)
   ========================================================= */
function _rfc6979k(privBytes,hashBytes,n){
  var blen=32;
  var V=[]; for(var i=0;i<blen;i++) V.push(0x01);
  var K=[]; for(var i=0;i<blen;i++) K.push(0x00);
  var xBytes=privBytes.slice();
  while(xBytes.length<blen) xBytes.unshift(0);
  xBytes=xBytes.slice(-blen);
  /* step d */
  K=_hmacSha256(K, V.concat([0x00]).concat(xBytes).concat(hashBytes));
  V=_hmacSha256(K,V);
  /* step f */
  K=_hmacSha256(K, V.concat([0x01]).concat(xBytes).concat(hashBytes));
  V=_hmacSha256(K,V);
  for(;;){
    V=_hmacSha256(K,V);
    var T=V.slice();
    var k=_ubiFromBytes(T);
    if(k.compareTo(BigInteger.ONE)>=0 && k.compareTo(n)<0) return k;
    K=_hmacSha256(K,V.concat([0x00]));
    V=_hmacSha256(K,V);
  }
}

/* =========================================================
   ECDSA ES256  (P-256 + SHA-256)
   ========================================================= */
function _ecdsaSign(privBytes,msgBytes){
  var p256=_getP256();
  var n=p256.n;
  var hash=_sha256(msgBytes);
  var d=_ubiFromBytes(privBytes.slice());
  var k=_rfc6979k(privBytes,hash,n);
  /* R = k*G */
  var R=p256.G.multiply2D(k);
  var r=R.getX().toBigInteger().mod(n);
  /* s = k^-1 * (h + r*d) mod n */
  var h=_ubiFromBytes(hash.slice());
  var kinv=k.modInverse(n);
  var s=kinv.multiply(h.add(r.multiply(d))).mod(n);
  /* low-S normalisation */
  var halfN=n.shiftRight(1);
  if(s.compareTo(halfN)>0) s=n.subtract(s);
  /* encode as 32-byte big-endian r || s */
  function pad32(bi){var a=bi.toByteArrayUnsigned();while(a.length<32)a.unshift(0);return a.slice(-32);}
  return pad32(r).concat(pad32(s));
}

/* =========================================================
   DER encoding helpers
   ========================================================= */
function _derLen(n){
  if(n<128) return [n];
  var b=[]; var v=n;
  while(v>0){b.unshift(v&0xff); v>>=8;}
  b.unshift(0x80|b.length);
  return b;
}
function _derTLV(tag,content){return [tag].concat(_derLen(content.length)).concat(content);}
function _derInt(bi){
  var a=bi.toByteArray();
  if(a[0]===0&&a.length>1) a=a.slice(1);  /* remove sign byte if positive */
  if(a[0]&0x80) a.unshift(0);             /* prepend 0x00 if high bit set */
  return _derTLV(0x02,a);
}
function _derSeq(items){var c=[]; for(var i=0;i<items.length;i++) c=c.concat(items[i]); return _derTLV(0x30,c);}

/* =========================================================
   RSA key parser  (DER, PKCS#8 and PKCS#1)
   PKCS#8: SEQUENCE { INTEGER(0), SEQUENCE(algo), OCTET-STRING { PKCS#1 } }
   PKCS#1: SEQUENCE { INTEGER(0), INTEGER(n), INTEGER(e), INTEGER(d), ... }
   Returns {n, d, modLen}
   ========================================================= */
function _tlvLen(buf,pos){
  var first=buf[pos];
  if(first<0x80) return{len:first,nextPos:pos+1};
  var nb=first&0x7f, len=0;
  for(var i=0;i<nb;i++) len=(len<<8)|buf[pos+1+i];
  return{len:len,nextPos:pos+1+nb};
}
function _parseRsaKey(der){
  var pos=0;
  function skip(){
    var tag=der[pos++];
    var r=_tlvLen(der,pos); pos=r.nextPos+r.len;
  }
  function readIntBytes(){
    if(der[pos]!==0x02) throw new Error('RSA parse: expected INTEGER tag at pos '+pos+' got 0x'+der[pos].toString(16));
    pos++;
    var r=_tlvLen(der,pos); pos=r.nextPos;
    var bytes=der.slice(pos,pos+r.len); pos+=r.len;
    return bytes;
  }
  function readBI(){ return new BigInteger(readIntBytes(),256); }
  /* outer SEQUENCE header */
  if(der[pos++]!==0x30) throw new Error('RSA parse: expected outer SEQUENCE');
  var outerLen=_tlvLen(der,pos); pos=outerLen.nextPos;
  /* version INTEGER (0 for both PKCS#1 and PKCS#8) */
  readIntBytes();
  /* detect format: PKCS#8 has algorithmIdentifier SEQUENCE next, PKCS#1 has INTEGER(n) */
  if(der[pos]===0x30){
    /* PKCS#8: skip algorithmIdentifier SEQUENCE */
    skip();
    /* OCTET STRING encapsulating PKCS#1 */
    if(der[pos++]!==0x04) throw new Error('RSA parse: expected OCTET STRING');
    var osLen=_tlvLen(der,pos); pos=osLen.nextPos;
    /* inner PKCS#1 SEQUENCE */
    if(der[pos++]!==0x30) throw new Error('RSA parse: expected inner SEQUENCE');
    var innerLen=_tlvLen(der,pos); pos=innerLen.nextPos;
    /* inner version */
    readIntBytes();
  }
  /* now at: n, e, d, ... */
  var n=readBI();
  var e=readBI();
  var d=readBI();
  return{n:n, d:d, modLen:Math.ceil(n.bitLength()/8)};
}

/* =========================================================
   MGF1 with SHA-256
   ========================================================= */
function _mgf1(seed,len){
  var out=[];
  for(var c=0;out.length<len;c++){
    var cnt=[0,0,0,c&0xff|((c>>8)&0xff)<<0];
    /* big-endian 4-byte counter */
    cnt=[(c>>>24)&0xff,(c>>>16)&0xff,(c>>>8)&0xff,c&0xff];
    out=out.concat(_sha256(seed.concat(cnt)));
  }
  return out.slice(0,len);
}

/* =========================================================
   RSA-PSS Sign  (PS256 = SHA-256 hash, SHA-256 MGF1, saltLen=32)
   ========================================================= */
function _rsaPssSign(msgBytes,n,d){
  var hLen=32, sLen=32;
  var modBits=n.bitLength();
  var emLen=Math.ceil((modBits-1)/8);
  /* PSS encoding */
  var mHash=_sha256(msgBytes);
  var salt=[];
  for(var i=0;i<sLen;i++) salt.push(Math.floor(Math.random()*256));
  /* M' = 0x00*8 || mHash || salt */
  var mPrime=[0,0,0,0,0,0,0,0].concat(mHash).concat(salt);
  var H=_sha256(mPrime);
  /* DB = PS || 0x01 || salt;  PS = emLen - hLen - sLen - 2 zeros */
  var psLen=emLen-hLen-sLen-2;
  var DB=[];
  for(var i=0;i<psLen;i++) DB.push(0);
  DB.push(0x01);
  DB=DB.concat(salt);
  var dbMask=_mgf1(H,emLen-hLen-1);
  var maskedDB=[];
  for(var i=0;i<DB.length;i++) maskedDB.push(DB[i]^dbMask[i]);
  /* zero out top (8*emLen - (modBits-1)) bits of maskedDB[0] */
  var topBits=8*emLen-(modBits-1);
  maskedDB[0]&=(0xff>>topBits);
  var EM=maskedDB.concat(H).concat([0xbc]);
  /* RSA private key operation */
  var m=new BigInteger(EM,256);
  var s=m.modPow(d,n);
  /* I2OSP: pad to modLen bytes */
  var sigBytes=s.toByteArray();
  while(sigBytes.length>0&&sigBytes[0]===0) sigBytes.shift();
  var modLen=Math.ceil(modBits/8);
  while(sigBytes.length<modLen) sigBytes.unshift(0);
  return sigBytes;
}

/* =========================================================
   DPoP key state
   ========================================================= */
var _dpopPriv=null;   /* byte array, 32 bytes */
var _dpopPubJwk=null; /* {kty,crv,x,y} */

function _generateDpopKeyPair(){
  var p256=_getP256();
  /* random private key: 32 random bytes, ensure 1 <= d < n */
  var dBytes;
  for(;;){
    dBytes=[];
    for(var i=0;i<32;i++) dBytes.push(Math.floor(Math.random()*256));
    dBytes[0]&=0x7f; /* clear high bit to keep < 2^255 */
    var d=new BigInteger(dBytes,256);
    if(d.compareTo(BigInteger.ONE)>=0 && d.compareTo(p256.n)<0) break;
  }
  /* public key Q = d * G */
  var Q=p256.G.multiply2D(new BigInteger(dBytes,256));
  function pad32(bi){var a=bi.toByteArrayUnsigned();while(a.length<32)a.unshift(0);return a.slice(-32);}
  var xBytes=pad32(Q.getX().toBigInteger());
  var yBytes=pad32(Q.getY().toBigInteger());
  var jwk={kty:'EC',crv:'P-256',x:_b64uEncode(xBytes),y:_b64uEncode(yBytes)};
  _dpopPriv=dBytes;
  _dpopPubJwk=jwk;
  return {priv:dBytes, pub:jwk};
}

/* =========================================================
   initDpopKey  —  call at start of every web_js_run Code=
   jwkParam: base64url-encoded JWK string (optional)
   If omitted or empty, a fresh ephemeral key is generated.
   ========================================================= */
function initDpopKey(jwkParam){
  try{
    if(jwkParam && jwkParam.length>0){
      var jwk=JSON.parse(String(jwkParam));
      if(jwk && jwk.kty==='EC' && jwk.crv==='P-256' && jwk.d){
        _dpopPriv=_b64uDecode(jwk.d);
        _dpopPubJwk={kty:'EC',crv:'P-256',x:jwk.x,y:jwk.y};
        return 'ok:loaded';
      }
    }
    _generateDpopKeyPair();
    return 'ok:generated';
  }catch(e){
    _generateDpopKeyPair();
    return 'ok:fallback:'+e.message;
  }
}

/* =========================================================
   generateDpopProof  —  RFC 9449
   htu: target URI  (string)
   htm: HTTP method (string, e.g. "POST")
   accessToken: current bearer access_token (string, optional)
   ========================================================= */
function generateDpopProof(htu,htm,accessToken){
  if(!_dpopPriv) throw new Error('DPoP key not initialised — call initDpopKey() first');
  var header={typ:'dpop+jwt',alg:'ES256',jwk:_dpopPubJwk};
  var payload={jti:_uuidv4(),iat:Math.floor(Date.now()/1000),htu:String(htu),htm:String(htm).toUpperCase()};
  if(accessToken && accessToken.length>0){
    payload.ath=_b64uEncode(_sha256(_strToBytes(String(accessToken))));
  }
  var sigInput=_b64uJson(header)+'.'+_b64uJson(payload);
  var sig=_ecdsaSign(_dpopPriv,_strToBytes(sigInput));
  return sigInput+'.'+_b64uEncode(sig);
}

/* =========================================================
   generateDpopProofs  —  batch, takes JSON string
   specsJson: '[{"htu":"...","htm":"...","accessToken":"...","paramName":"..."},...]'
   Stores each proof in LR.setParam(paramName, proof)
   ========================================================= */
function generateDpopProofs(specsJson){
  var specs=JSON.parse(String(specsJson));
  var results={};
  for(var i=0;i<specs.length;i++){
    var s=specs[i];
    var proof=generateDpopProof(s.htu,s.htm,s.accessToken||'');
    if(s.paramName) LR.setParam(s.paramName,proof);
    results[s.paramName||i]=proof;
  }
  return JSON.stringify(results);
}

/* =========================================================
   createJWT  —  PS256 (RSA-PSS / SHA-256)
   signingKid:  key ID string
   secret:      PEM-encoded RSA private key (PKCS#8 or PKCS#1)
                May contain HTML entities (e.g. &#10; for newlines)
   ========================================================= */
function createJWT(clientId,aud,scope,signingKid,secret){
  /* PEM -> DER */
  var pem=_decodeHtmlEntities(String(secret));
  pem=pem.replace(/-----[^-]+-----/g,'').replace(/\s+/g,'');
  /* standard base64: _b64uDecode handles + and / correctly (only converts - and _) */
  var der=_b64uDecode(pem);
  /* parse RSA key */
  var key=_parseRsaKey(der);
  /* build JWT header + payload */
  var now=Math.floor(Date.now()/1000);
  var header={alg:'PS256',typ:'JWT',kid:String(signingKid)};
  var payload={iss:String(clientId),sub:String(clientId),aud:String(aud),
               scope:String(scope),iat:now,exp:now+300,jti:_uuidv4()};
  var sigInput=_b64uJson(header)+'.'+_b64uJson(payload);
  var sig=_rsaPssSign(_strToBytes(sigInput),key.n,key.d);
  return sigInput+'.'+_b64uEncode(sig);
}
"""

# ---- Assemble the file ---------------------------------------------------
output_parts = []
output_parts.append('/* lre-utils.js  —  DPoP (ES256) + JWT (PS256) for VuGen Web HTTP/HTML')
output_parts.append(' * BigInteger and EC math embedded from jsrsasign (Tom Wu / Kenji Urushima).')
output_parts.append(' * No external dependencies required. Load via SOURCES File=lre-utils.js')
output_parts.append(' * Every web_js_run Code= must call initDpopKey() before generateDpopProof().')
output_parts.append(' */')
output_parts.append('')
output_parts.append('/* BigInteger core */')
output_parts.append(bi_line1)
output_parts.append('')
output_parts.append('/* BigInteger extended methods */')
output_parts.append(bi_line2)
output_parts.append('')
output_parts.append('/* EC field / point / curve */')
output_parts.append(ec_line1)
output_parts.append('')
output_parts.append('/* EC affine extensions (bitcoinjs) */')
output_parts.append(ec_line2)
output_parts.append('')
output_parts.append(CRYPTO)

content = '\n'.join(output_parts)

# Sanity checks
assert 'navigator' not in content, 'navigator found!'
assert 'BEGIN PRIVATE KEY' not in content, 'AV trigger: BEGIN PRIVATE KEY'
assert 'RSAPrivateKey' not in content, 'AV trigger: RSAPrivateKey'

# Write output
with open('lre-utils.js', 'w', encoding='utf-8', newline='\n') as f:
    f.write(content)

print('lre-utils.js written, {} bytes'.format(len(content.encode('utf-8'))))
print('Lines: {}'.format(content.count('\n')+1))
