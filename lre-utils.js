/* lre-utils.js  —  DPoP (ES256) + JWT (PS256) for VuGen Web HTTP/HTML
 * BigInteger and EC math embedded from jsrsasign (Tom Wu / Kenji Urushima).
 * No external dependencies required. Load via SOURCES File=lre-utils.js
 * Every web_js_run Code= must call initDpopKey() before generateDpopProof().
 */

/* BigInteger core */
var dbits;function BigInteger(e,d,f){if(e!=null){if("number"==typeof e){this.fromNumber(e,d,f)}else{if(d==null&&"string"!=typeof e){this.fromString(e,256)}else{this.fromString(e,d)}}}}function nbi(){return new BigInteger(null)}function am1(f,a,b,e,h,g){while(--g>=0){var d=a*this[f++]+b[e]+h;h=Math.floor(d/67108864);b[e++]=d&67108863}return h}function am2(f,q,r,e,o,a){var k=q&32767,p=q>>15;while(--a>=0){var d=this[f]&32767;var g=this[f++]>>15;var b=p*d+g*k;d=k*d+((b&32767)<<15)+r[e]+(o&1073741823);o=(d>>>30)+(b>>>15)+p*g+(o>>>30);r[e++]=d&1073741823}return o}function am3(f,q,r,e,o,a){var k=q&16383,p=q>>14;while(--a>=0){var d=this[f]&16383;var g=this[f++]>>14;var b=p*d+g*k;d=k*d+((b&16383)<<14)+r[e]+o;o=(d>>28)+(b>>14)+p*g;r[e++]=d&268435455}return o}BigInteger.prototype.am=am3;dbits=28;BigInteger.prototype.DB=dbits;BigInteger.prototype.DM=((1<<dbits)-1);BigInteger.prototype.DV=(1<<dbits);var BI_FP=52;BigInteger.prototype.FV=Math.pow(2,BI_FP);BigInteger.prototype.F1=BI_FP-dbits;BigInteger.prototype.F2=2*dbits-BI_FP;var BI_RM="0123456789abcdefghijklmnopqrstuvwxyz";var BI_RC=new Array();var rr,vv;rr="0".charCodeAt(0);for(vv=0;vv<=9;++vv){BI_RC[rr++]=vv}rr="a".charCodeAt(0);for(vv=10;vv<36;++vv){BI_RC[rr++]=vv}rr="A".charCodeAt(0);for(vv=10;vv<36;++vv){BI_RC[rr++]=vv}function int2char(a){return BI_RM.charAt(a)}function intAt(b,a){var d=BI_RC[b.charCodeAt(a)];return(d==null)?-1:d}function bnpCopyTo(b){for(var a=this.t-1;a>=0;--a){b[a]=this[a]}b.t=this.t;b.s=this.s}function bnpFromInt(a){this.t=1;this.s=(a<0)?-1:0;if(a>0){this[0]=a}else{if(a<-1){this[0]=a+this.DV}else{this.t=0}}}function nbv(a){var b=nbi();b.fromInt(a);return b}function bnpFromString(h,c){var e;if(c==16){e=4}else{if(c==8){e=3}else{if(c==256){e=8}else{if(c==2){e=1}else{if(c==32){e=5}else{if(c==4){e=2}else{this.fromRadix(h,c);return}}}}}}this.t=0;this.s=0;var g=h.length,d=false,f=0;while(--g>=0){var a=(e==8)?h[g]&255:intAt(h,g);if(a<0){if(h.charAt(g)=="-"){d=true}continue}d=false;if(f==0){this[this.t++]=a}else{if(f+e>this.DB){this[this.t-1]|=(a&((1<<(this.DB-f))-1))<<f;this[this.t++]=(a>>(this.DB-f))}else{this[this.t-1]|=a<<f}}f+=e;if(f>=this.DB){f-=this.DB}}if(e==8&&(h[0]&128)!=0){this.s=-1;if(f>0){this[this.t-1]|=((1<<(this.DB-f))-1)<<f}}this.clamp();if(d){BigInteger.ZERO.subTo(this,this)}}function bnpClamp(){var a=this.s&this.DM;while(this.t>0&&this[this.t-1]==a){--this.t}}function bnToString(c){if(this.s<0){return"-"+this.negate().toString(c)}var e;if(c==16){e=4}else{if(c==8){e=3}else{if(c==2){e=1}else{if(c==32){e=5}else{if(c==4){e=2}else{return this.toRadix(c)}}}}}var g=(1<<e)-1,l,a=false,h="",f=this.t;var j=this.DB-(f*this.DB)%e;if(f-->0){if(j<this.DB&&(l=this[f]>>j)>0){a=true;h=int2char(l)}while(f>=0){if(j<e){l=(this[f]&((1<<j)-1))<<(e-j);l|=this[--f]>>(j+=this.DB-e)}else{l=(this[f]>>(j-=e))&g;if(j<=0){j+=this.DB;--f}}if(l>0){a=true}if(a){h+=int2char(l)}}}return a?h:"0"}function bnNegate(){var a=nbi();BigInteger.ZERO.subTo(this,a);return a}function bnAbs(){return(this.s<0)?this.negate():this}function bnCompareTo(b){var d=this.s-b.s;if(d!=0){return d}var c=this.t;d=c-b.t;if(d!=0){return(this.s<0)?-d:d}while(--c>=0){if((d=this[c]-b[c])!=0){return d}}return 0}function nbits(a){var c=1,b;if((b=a>>>16)!=0){a=b;c+=16}if((b=a>>8)!=0){a=b;c+=8}if((b=a>>4)!=0){a=b;c+=4}if((b=a>>2)!=0){a=b;c+=2}if((b=a>>1)!=0){a=b;c+=1}return c}function bnBitLength(){if(this.t<=0){return 0}return this.DB*(this.t-1)+nbits(this[this.t-1]^(this.s&this.DM))}function bnpDLShiftTo(c,b){var a;for(a=this.t-1;a>=0;--a){b[a+c]=this[a]}for(a=c-1;a>=0;--a){b[a]=0}b.t=this.t+c;b.s=this.s}function bnpDRShiftTo(c,b){for(var a=c;a<this.t;++a){b[a-c]=this[a]}b.t=Math.max(this.t-c,0);b.s=this.s}function bnpLShiftTo(j,e){var b=j%this.DB;var a=this.DB-b;var g=(1<<a)-1;var f=Math.floor(j/this.DB),h=(this.s<<b)&this.DM,d;for(d=this.t-1;d>=0;--d){e[d+f+1]=(this[d]>>a)|h;h=(this[d]&g)<<b}for(d=f-1;d>=0;--d){e[d]=0}e[f]=h;e.t=this.t+f+1;e.s=this.s;e.clamp()}function bnpRShiftTo(g,d){d.s=this.s;var e=Math.floor(g/this.DB);if(e>=this.t){d.t=0;return}var b=g%this.DB;var a=this.DB-b;var f=(1<<b)-1;d[0]=this[e]>>b;for(var c=e+1;c<this.t;++c){d[c-e-1]|=(this[c]&f)<<a;d[c-e]=this[c]>>b}if(b>0){d[this.t-e-1]|=(this.s&f)<<a}d.t=this.t-e;d.clamp()}function bnpSubTo(d,f){var e=0,g=0,b=Math.min(d.t,this.t);while(e<b){g+=this[e]-d[e];f[e++]=g&this.DM;g>>=this.DB}if(d.t<this.t){g-=d.s;while(e<this.t){g+=this[e];f[e++]=g&this.DM;g>>=this.DB}g+=this.s}else{g+=this.s;while(e<d.t){g-=d[e];f[e++]=g&this.DM;g>>=this.DB}g-=d.s}f.s=(g<0)?-1:0;if(g<-1){f[e++]=this.DV+g}else{if(g>0){f[e++]=g}}f.t=e;f.clamp()}function bnpMultiplyTo(c,e){var b=this.abs(),f=c.abs();var d=b.t;e.t=d+f.t;while(--d>=0){e[d]=0}for(d=0;d<f.t;++d){e[d+b.t]=b.am(0,f[d],e,d,0,b.t)}e.s=0;e.clamp();if(this.s!=c.s){BigInteger.ZERO.subTo(e,e)}}function bnpSquareTo(d){var a=this.abs();var b=d.t=2*a.t;while(--b>=0){d[b]=0}for(b=0;b<a.t-1;++b){var e=a.am(b,a[b],d,2*b,0,1);if((d[b+a.t]+=a.am(b+1,2*a[b],d,2*b+1,e,a.t-b-1))>=a.DV){d[b+a.t]-=a.DV;d[b+a.t+1]=1}}if(d.t>0){d[d.t-1]+=a.am(b,a[b],d,2*b,0,1)}d.s=0;d.clamp()}function bnpDivRemTo(n,h,g){var w=n.abs();if(w.t<=0){return}var k=this.abs();if(k.t<w.t){if(h!=null){h.fromInt(0)}if(g!=null){this.copyTo(g)}return}if(g==null){g=nbi()}var d=nbi(),a=this.s,l=n.s;var v=this.DB-nbits(w[w.t-1]);if(v>0){w.lShiftTo(v,d);k.lShiftTo(v,g)}else{w.copyTo(d);k.copyTo(g)}var p=d.t;var b=d[p-1];if(b==0){return}var o=b*(1<<this.F1)+((p>1)?d[p-2]>>this.F2:0);var A=this.FV/o,z=(1<<this.F1)/o,x=1<<this.F2;var u=g.t,s=u-p,f=(h==null)?nbi():h;d.dlShiftTo(s,f);if(g.compareTo(f)>=0){g[g.t++]=1;g.subTo(f,g)}BigInteger.ONE.dlShiftTo(p,f);f.subTo(d,d);while(d.t<p){d[d.t++]=0}while(--s>=0){var c=(g[--u]==b)?this.DM:Math.floor(g[u]*A+(g[u-1]+x)*z);if((g[u]+=d.am(0,c,g,s,0,p))<c){d.dlShiftTo(s,f);g.subTo(f,g);while(g[u]<--c){g.subTo(f,g)}}}if(h!=null){g.drShiftTo(p,h);if(a!=l){BigInteger.ZERO.subTo(h,h)}}g.t=p;g.clamp();if(v>0){g.rShiftTo(v,g)}if(a<0){BigInteger.ZERO.subTo(g,g)}}function bnMod(b){var c=nbi();this.abs().divRemTo(b,null,c);if(this.s<0&&c.compareTo(BigInteger.ZERO)>0){b.subTo(c,c)}return c}function Classic(a){this.m=a}function cConvert(a){if(a.s<0||a.compareTo(this.m)>=0){return a.mod(this.m)}else{return a}}function cRevert(a){return a}function cReduce(a){a.divRemTo(this.m,null,a)}function cMulTo(a,c,b){a.multiplyTo(c,b);this.reduce(b)}function cSqrTo(a,b){a.squareTo(b);this.reduce(b)}Classic.prototype.convert=cConvert;Classic.prototype.revert=cRevert;Classic.prototype.reduce=cReduce;Classic.prototype.mulTo=cMulTo;Classic.prototype.sqrTo=cSqrTo;function bnpInvDigit(){if(this.t<1){return 0}var a=this[0];if((a&1)==0){return 0}var b=a&3;b=(b*(2-(a&15)*b))&15;b=(b*(2-(a&255)*b))&255;b=(b*(2-(((a&65535)*b)&65535)))&65535;b=(b*(2-a*b%this.DV))%this.DV;return(b>0)?this.DV-b:-b}function Montgomery(a){this.m=a;this.mp=a.invDigit();this.mpl=this.mp&32767;this.mph=this.mp>>15;this.um=(1<<(a.DB-15))-1;this.mt2=2*a.t}function montConvert(a){var b=nbi();a.abs().dlShiftTo(this.m.t,b);b.divRemTo(this.m,null,b);if(a.s<0&&b.compareTo(BigInteger.ZERO)>0){this.m.subTo(b,b)}return b}function montRevert(a){var b=nbi();a.copyTo(b);this.reduce(b);return b}function montReduce(a){while(a.t<=this.mt2){a[a.t++]=0}for(var c=0;c<this.m.t;++c){var b=a[c]&32767;var d=(b*this.mpl+(((b*this.mph+(a[c]>>15)*this.mpl)&this.um)<<15))&a.DM;b=c+this.m.t;a[b]+=this.m.am(0,d,a,c,0,this.m.t);while(a[b]>=a.DV){a[b]-=a.DV;a[++b]++}}a.clamp();a.drShiftTo(this.m.t,a);if(a.compareTo(this.m)>=0){a.subTo(this.m,a)}}function montSqrTo(a,b){a.squareTo(b);this.reduce(b)}function montMulTo(a,c,b){a.multiplyTo(c,b);this.reduce(b)}Montgomery.prototype.convert=montConvert;Montgomery.prototype.revert=montRevert;Montgomery.prototype.reduce=montReduce;Montgomery.prototype.mulTo=montMulTo;Montgomery.prototype.sqrTo=montSqrTo;function bnpIsEven(){return((this.t>0)?(this[0]&1):this.s)==0}function bnpExp(h,j){if(h>4294967295||h<1){return BigInteger.ONE}var f=nbi(),a=nbi(),d=j.convert(this),c=nbits(h)-1;d.copyTo(f);while(--c>=0){j.sqrTo(f,a);if((h&(1<<c))>0){j.mulTo(a,d,f)}else{var b=f;f=a;a=b}}return j.revert(f)}function bnModPowInt(b,a){var c;if(b<256||a.isEven()){c=new Classic(a)}else{c=new Montgomery(a)}return this.exp(b,c)}BigInteger.prototype.copyTo=bnpCopyTo;BigInteger.prototype.fromInt=bnpFromInt;BigInteger.prototype.fromString=bnpFromString;BigInteger.prototype.clamp=bnpClamp;BigInteger.prototype.dlShiftTo=bnpDLShiftTo;BigInteger.prototype.drShiftTo=bnpDRShiftTo;BigInteger.prototype.lShiftTo=bnpLShiftTo;BigInteger.prototype.rShiftTo=bnpRShiftTo;BigInteger.prototype.subTo=bnpSubTo;BigInteger.prototype.multiplyTo=bnpMultiplyTo;BigInteger.prototype.squareTo=bnpSquareTo;BigInteger.prototype.divRemTo=bnpDivRemTo;BigInteger.prototype.invDigit=bnpInvDigit;BigInteger.prototype.isEven=bnpIsEven;BigInteger.prototype.exp=bnpExp;BigInteger.prototype.toString=bnToString;BigInteger.prototype.negate=bnNegate;BigInteger.prototype.abs=bnAbs;BigInteger.prototype.compareTo=bnCompareTo;BigInteger.prototype.bitLength=bnBitLength;BigInteger.prototype.mod=bnMod;BigInteger.prototype.modPowInt=bnModPowInt;BigInteger.ZERO=nbv(0);BigInteger.ONE=nbv(1);

/* BigInteger extended methods */
function bnClone(){var a=nbi();this.copyTo(a);return a}function bnIntValue(){if(this.s<0){if(this.t==1){return this[0]-this.DV}else{if(this.t==0){return -1}}}else{if(this.t==1){return this[0]}else{if(this.t==0){return 0}}}return((this[1]&((1<<(32-this.DB))-1))<<this.DB)|this[0]}function bnByteValue(){return(this.t==0)?this.s:(this[0]<<24)>>24}function bnShortValue(){return(this.t==0)?this.s:(this[0]<<16)>>16}function bnpChunkSize(a){return Math.floor(Math.LN2*this.DB/Math.log(a))}function bnSigNum(){if(this.s<0){return -1}else{if(this.t<=0||(this.t==1&&this[0]<=0)){return 0}else{return 1}}}function bnpToRadix(c){if(c==null){c=10}if(this.signum()==0||c<2||c>36){return"0"}var f=this.chunkSize(c);var e=Math.pow(c,f);var i=nbv(e),j=nbi(),h=nbi(),g="";this.divRemTo(i,j,h);while(j.signum()>0){g=(e+h.intValue()).toString(c).substr(1)+g;j.divRemTo(i,j,h)}return h.intValue().toString(c)+g}function bnpFromRadix(m,h){this.fromInt(0);if(h==null){h=10}var f=this.chunkSize(h);var g=Math.pow(h,f),e=false,a=0,l=0;for(var c=0;c<m.length;++c){var k=intAt(m,c);if(k<0){if(m.charAt(c)=="-"&&this.signum()==0){e=true}continue}l=h*l+k;if(++a>=f){this.dMultiply(g);this.dAddOffset(l,0);a=0;l=0}}if(a>0){this.dMultiply(Math.pow(h,a));this.dAddOffset(l,0)}if(e){BigInteger.ZERO.subTo(this,this)}}function bnpFromNumber(f,e,h){if("number"==typeof e){if(f<2){this.fromInt(1)}else{this.fromNumber(f,h);if(!this.testBit(f-1)){this.bitwiseTo(BigInteger.ONE.shiftLeft(f-1),op_or,this)}if(this.isEven()){this.dAddOffset(1,0)}while(!this.isProbablePrime(e)){this.dAddOffset(2,0);if(this.bitLength()>f){this.subTo(BigInteger.ONE.shiftLeft(f-1),this)}}}}else{var d=new Array(),g=f&7;d.length=(f>>3)+1;e.nextBytes(d);if(g>0){d[0]&=((1<<g)-1)}else{d[0]=0}this.fromString(d,256)}}function bnToByteArray(){var b=this.t,c=new Array();c[0]=this.s;var e=this.DB-(b*this.DB)%8,f,a=0;if(b-->0){if(e<this.DB&&(f=this[b]>>e)!=(this.s&this.DM)>>e){c[a++]=f|(this.s<<(this.DB-e))}while(b>=0){if(e<8){f=(this[b]&((1<<e)-1))<<(8-e);f|=this[--b]>>(e+=this.DB-8)}else{f=(this[b]>>(e-=8))&255;if(e<=0){e+=this.DB;--b}}if((f&128)!=0){f|=-256}if(a==0&&(this.s&128)!=(f&128)){++a}if(a>0||f!=this.s){c[a++]=f}}}return c}function bnEquals(b){return(this.compareTo(b)==0)}function bnMin(b){return(this.compareTo(b)<0)?this:b}function bnMax(b){return(this.compareTo(b)>0)?this:b}function bnpBitwiseTo(c,h,e){var d,g,b=Math.min(c.t,this.t);for(d=0;d<b;++d){e[d]=h(this[d],c[d])}if(c.t<this.t){g=c.s&this.DM;for(d=b;d<this.t;++d){e[d]=h(this[d],g)}e.t=this.t}else{g=this.s&this.DM;for(d=b;d<c.t;++d){e[d]=h(g,c[d])}e.t=c.t}e.s=h(this.s,c.s);e.clamp()}function op_and(a,b){return a&b}function bnAnd(b){var c=nbi();this.bitwiseTo(b,op_and,c);return c}function op_or(a,b){return a|b}function bnOr(b){var c=nbi();this.bitwiseTo(b,op_or,c);return c}function op_xor(a,b){return a^b}function bnXor(b){var c=nbi();this.bitwiseTo(b,op_xor,c);return c}function op_andnot(a,b){return a&~b}function bnAndNot(b){var c=nbi();this.bitwiseTo(b,op_andnot,c);return c}function bnNot(){var b=nbi();for(var a=0;a<this.t;++a){b[a]=this.DM&~this[a]}b.t=this.t;b.s=~this.s;return b}function bnShiftLeft(b){var a=nbi();if(b<0){this.rShiftTo(-b,a)}else{this.lShiftTo(b,a)}return a}function bnShiftRight(b){var a=nbi();if(b<0){this.lShiftTo(-b,a)}else{this.rShiftTo(b,a)}return a}function lbit(a){if(a==0){return -1}var b=0;if((a&65535)==0){a>>=16;b+=16}if((a&255)==0){a>>=8;b+=8}if((a&15)==0){a>>=4;b+=4}if((a&3)==0){a>>=2;b+=2}if((a&1)==0){++b}return b}function bnGetLowestSetBit(){for(var a=0;a<this.t;++a){if(this[a]!=0){return a*this.DB+lbit(this[a])}}if(this.s<0){return this.t*this.DB}return -1}function cbit(a){var b=0;while(a!=0){a&=a-1;++b}return b}function bnBitCount(){var c=0,a=this.s&this.DM;for(var b=0;b<this.t;++b){c+=cbit(this[b]^a)}return c}function bnTestBit(b){var a=Math.floor(b/this.DB);if(a>=this.t){return(this.s!=0)}return((this[a]&(1<<(b%this.DB)))!=0)}function bnpChangeBit(c,b){var a=BigInteger.ONE.shiftLeft(c);this.bitwiseTo(a,b,a);return a}function bnSetBit(a){return this.changeBit(a,op_or)}function bnClearBit(a){return this.changeBit(a,op_andnot)}function bnFlipBit(a){return this.changeBit(a,op_xor)}function bnpAddTo(d,f){var e=0,g=0,b=Math.min(d.t,this.t);while(e<b){g+=this[e]+d[e];f[e++]=g&this.DM;g>>=this.DB}if(d.t<this.t){g+=d.s;while(e<this.t){g+=this[e];f[e++]=g&this.DM;g>>=this.DB}g+=this.s}else{g+=this.s;while(e<d.t){g+=d[e];f[e++]=g&this.DM;g>>=this.DB}g+=d.s}f.s=(g<0)?-1:0;if(g>0){f[e++]=g}else{if(g<-1){f[e++]=this.DV+g}}f.t=e;f.clamp()}function bnAdd(b){var c=nbi();this.addTo(b,c);return c}function bnSubtract(b){var c=nbi();this.subTo(b,c);return c}function bnMultiply(b){var c=nbi();this.multiplyTo(b,c);return c}function bnSquare(){var a=nbi();this.squareTo(a);return a}function bnDivide(b){var c=nbi();this.divRemTo(b,c,null);return c}function bnRemainder(b){var c=nbi();this.divRemTo(b,null,c);return c}function bnDivideAndRemainder(b){var d=nbi(),c=nbi();this.divRemTo(b,d,c);return new Array(d,c)}function bnpDMultiply(a){this[this.t]=this.am(0,a-1,this,0,0,this.t);++this.t;this.clamp()}function bnpDAddOffset(b,a){if(b==0){return}while(this.t<=a){this[this.t++]=0}this[a]+=b;while(this[a]>=this.DV){this[a]-=this.DV;if(++a>=this.t){this[this.t++]=0}++this[a]}}function NullExp(){}function nNop(a){return a}function nMulTo(a,c,b){a.multiplyTo(c,b)}function nSqrTo(a,b){a.squareTo(b)}NullExp.prototype.convert=nNop;NullExp.prototype.revert=nNop;NullExp.prototype.mulTo=nMulTo;NullExp.prototype.sqrTo=nSqrTo;function bnPow(a){return this.exp(a,new NullExp())}function bnpMultiplyLowerTo(b,f,e){var d=Math.min(this.t+b.t,f);e.s=0;e.t=d;while(d>0){e[--d]=0}var c;for(c=e.t-this.t;d<c;++d){e[d+this.t]=this.am(0,b[d],e,d,0,this.t)}for(c=Math.min(b.t,f);d<c;++d){this.am(0,b[d],e,d,0,f-d)}e.clamp()}function bnpMultiplyUpperTo(b,e,d){--e;var c=d.t=this.t+b.t-e;d.s=0;while(--c>=0){d[c]=0}for(c=Math.max(e-this.t,0);c<b.t;++c){d[this.t+c-e]=this.am(e-c,b[c],d,0,0,this.t+c-e)}d.clamp();d.drShiftTo(1,d)}function Barrett(a){this.r2=nbi();this.q3=nbi();BigInteger.ONE.dlShiftTo(2*a.t,this.r2);this.mu=this.r2.divide(a);this.m=a}function barrettConvert(a){if(a.s<0||a.t>2*this.m.t){return a.mod(this.m)}else{if(a.compareTo(this.m)<0){return a}else{var b=nbi();a.copyTo(b);this.reduce(b);return b}}}function barrettRevert(a){return a}function barrettReduce(a){a.drShiftTo(this.m.t-1,this.r2);if(a.t>this.m.t+1){a.t=this.m.t+1;a.clamp()}this.mu.multiplyUpperTo(this.r2,this.m.t+1,this.q3);this.m.multiplyLowerTo(this.q3,this.m.t+1,this.r2);while(a.compareTo(this.r2)<0){a.dAddOffset(1,this.m.t+1)}a.subTo(this.r2,a);while(a.compareTo(this.m)>=0){a.subTo(this.m,a)}}function barrettSqrTo(a,b){a.squareTo(b);this.reduce(b)}function barrettMulTo(a,c,b){a.multiplyTo(c,b);this.reduce(b)}Barrett.prototype.convert=barrettConvert;Barrett.prototype.revert=barrettRevert;Barrett.prototype.reduce=barrettReduce;Barrett.prototype.mulTo=barrettMulTo;Barrett.prototype.sqrTo=barrettSqrTo;function bnModPow(q,f){var o=q.bitLength(),h,b=nbv(1),v;if(o<=0){return b}else{if(o<18){h=1}else{if(o<48){h=3}else{if(o<144){h=4}else{if(o<768){h=5}else{h=6}}}}}if(o<8){v=new Classic(f)}else{if(f.isEven()){v=new Barrett(f)}else{v=new Montgomery(f)}}var p=new Array(),d=3,s=h-1,a=(1<<h)-1;p[1]=v.convert(this);if(h>1){var A=nbi();v.sqrTo(p[1],A);while(d<=a){p[d]=nbi();v.mulTo(A,p[d-2],p[d]);d+=2}}var l=q.t-1,x,u=true,c=nbi(),y;o=nbits(q[l])-1;while(l>=0){if(o>=s){x=(q[l]>>(o-s))&a}else{x=(q[l]&((1<<(o+1))-1))<<(s-o);if(l>0){x|=q[l-1]>>(this.DB+o-s)}}d=h;while((x&1)==0){x>>=1;--d}if((o-=d)<0){o+=this.DB;--l}if(u){p[x].copyTo(b);u=false}else{while(d>1){v.sqrTo(b,c);v.sqrTo(c,b);d-=2}if(d>0){v.sqrTo(b,c)}else{y=b;b=c;c=y}v.mulTo(c,p[x],b)}while(l>=0&&(q[l]&(1<<o))==0){v.sqrTo(b,c);y=b;b=c;c=y;if(--o<0){o=this.DB-1;--l}}}return v.revert(b)}function bnGCD(c){var b=(this.s<0)?this.negate():this.clone();var h=(c.s<0)?c.negate():c.clone();if(b.compareTo(h)<0){var e=b;b=h;h=e}var d=b.getLowestSetBit(),f=h.getLowestSetBit();if(f<0){return b}if(d<f){f=d}if(f>0){b.rShiftTo(f,b);h.rShiftTo(f,h)}while(b.signum()>0){if((d=b.getLowestSetBit())>0){b.rShiftTo(d,b)}if((d=h.getLowestSetBit())>0){h.rShiftTo(d,h)}if(b.compareTo(h)>=0){b.subTo(h,b);b.rShiftTo(1,b)}else{h.subTo(b,h);h.rShiftTo(1,h)}}if(f>0){h.lShiftTo(f,h)}return h}function bnpModInt(e){if(e<=0){return 0}var c=this.DV%e,b=(this.s<0)?e-1:0;if(this.t>0){if(c==0){b=this[0]%e}else{for(var a=this.t-1;a>=0;--a){b=(c*b+this[a])%e}}}return b}function bnModInverse(f){var j=f.isEven();if((this.isEven()&&j)||f.signum()==0){return BigInteger.ZERO}var i=f.clone(),h=this.clone();var g=nbv(1),e=nbv(0),l=nbv(0),k=nbv(1);while(i.signum()!=0){while(i.isEven()){i.rShiftTo(1,i);if(j){if(!g.isEven()||!e.isEven()){g.addTo(this,g);e.subTo(f,e)}g.rShiftTo(1,g)}else{if(!e.isEven()){e.subTo(f,e)}}e.rShiftTo(1,e)}while(h.isEven()){h.rShiftTo(1,h);if(j){if(!l.isEven()||!k.isEven()){l.addTo(this,l);k.subTo(f,k)}l.rShiftTo(1,l)}else{if(!k.isEven()){k.subTo(f,k)}}k.rShiftTo(1,k)}if(i.compareTo(h)>=0){i.subTo(h,i);if(j){g.subTo(l,g)}e.subTo(k,e)}else{h.subTo(i,h);if(j){l.subTo(g,l)}k.subTo(e,k)}}if(h.compareTo(BigInteger.ONE)!=0){return BigInteger.ZERO}if(k.compareTo(f)>=0){return k.subtract(f)}if(k.signum()<0){k.addTo(f,k)}else{return k}if(k.signum()<0){return k.add(f)}else{return k}}var lowprimes=[2,3,5,7,11,13,17,19,23,29,31,37,41,43,47,53,59,61,67,71,73,79,83,89,97,101,103,107,109,113,127,131,137,139,149,151,157,163,167,173,179,181,191,193,197,199,211,223,227,229,233,239,241,251,257,263,269,271,277,281,283,293,307,311,313,317,331,337,347,349,353,359,367,373,379,383,389,397,401,409,419,421,431,433,439,443,449,457,461,463,467,479,487,491,499,503,509,521,523,541,547,557,563,569,571,577,587,593,599,601,607,613,617,619,631,641,643,647,653,659,661,673,677,683,691,701,709,719,727,733,739,743,751,757,761,769,773,787,797,809,811,821,823,827,829,839,853,857,859,863,877,881,883,887,907,911,919,929,937,941,947,953,967,971,977,983,991,997];var lplim=(1<<26)/lowprimes[lowprimes.length-1];function bnIsProbablePrime(e){var d,b=this.abs();if(b.t==1&&b[0]<=lowprimes[lowprimes.length-1]){for(d=0;d<lowprimes.length;++d){if(b[0]==lowprimes[d]){return true}}return false}if(b.isEven()){return false}d=1;while(d<lowprimes.length){var a=lowprimes[d],c=d+1;while(c<lowprimes.length&&a<lplim){a*=lowprimes[c++]}a=b.modInt(a);while(d<c){if(a%lowprimes[d++]==0){return false}}}return b.millerRabin(e)}function bnpMillerRabin(f){var g=this.subtract(BigInteger.ONE);var c=g.getLowestSetBit();if(c<=0){return false}var h=g.shiftRight(c);f=(f+1)>>1;if(f>lowprimes.length){f=lowprimes.length}var b=nbi();for(var e=0;e<f;++e){b.fromInt(lowprimes[Math.floor(Math.random()*lowprimes.length)]);var l=b.modPow(h,this);if(l.compareTo(BigInteger.ONE)!=0&&l.compareTo(g)!=0){var d=1;while(d++<c&&l.compareTo(g)!=0){l=l.modPowInt(2,this);if(l.compareTo(BigInteger.ONE)==0){return false}}if(l.compareTo(g)!=0){return false}}}return true}BigInteger.prototype.chunkSize=bnpChunkSize;BigInteger.prototype.toRadix=bnpToRadix;BigInteger.prototype.fromRadix=bnpFromRadix;BigInteger.prototype.fromNumber=bnpFromNumber;BigInteger.prototype.bitwiseTo=bnpBitwiseTo;BigInteger.prototype.changeBit=bnpChangeBit;BigInteger.prototype.addTo=bnpAddTo;BigInteger.prototype.dMultiply=bnpDMultiply;BigInteger.prototype.dAddOffset=bnpDAddOffset;BigInteger.prototype.multiplyLowerTo=bnpMultiplyLowerTo;BigInteger.prototype.multiplyUpperTo=bnpMultiplyUpperTo;BigInteger.prototype.modInt=bnpModInt;BigInteger.prototype.millerRabin=bnpMillerRabin;BigInteger.prototype.clone=bnClone;BigInteger.prototype.intValue=bnIntValue;BigInteger.prototype.byteValue=bnByteValue;BigInteger.prototype.shortValue=bnShortValue;BigInteger.prototype.signum=bnSigNum;BigInteger.prototype.toByteArray=bnToByteArray;BigInteger.prototype.equals=bnEquals;BigInteger.prototype.min=bnMin;BigInteger.prototype.max=bnMax;BigInteger.prototype.and=bnAnd;BigInteger.prototype.or=bnOr;BigInteger.prototype.xor=bnXor;BigInteger.prototype.andNot=bnAndNot;BigInteger.prototype.not=bnNot;BigInteger.prototype.shiftLeft=bnShiftLeft;BigInteger.prototype.shiftRight=bnShiftRight;BigInteger.prototype.getLowestSetBit=bnGetLowestSetBit;BigInteger.prototype.bitCount=bnBitCount;BigInteger.prototype.testBit=bnTestBit;BigInteger.prototype.setBit=bnSetBit;BigInteger.prototype.clearBit=bnClearBit;BigInteger.prototype.flipBit=bnFlipBit;BigInteger.prototype.add=bnAdd;BigInteger.prototype.subtract=bnSubtract;BigInteger.prototype.multiply=bnMultiply;BigInteger.prototype.divide=bnDivide;BigInteger.prototype.remainder=bnRemainder;BigInteger.prototype.divideAndRemainder=bnDivideAndRemainder;BigInteger.prototype.modPow=bnModPow;BigInteger.prototype.modInverse=bnModInverse;BigInteger.prototype.pow=bnPow;BigInteger.prototype.gcd=bnGCD;BigInteger.prototype.isProbablePrime=bnIsProbablePrime;BigInteger.prototype.square=bnSquare;

/* EC field / point / curve */
function ECFieldElementFp(b,a){this.x=a;this.q=b}function feFpEquals(a){if(a==this){return true}return(this.q.equals(a.q)&&this.x.equals(a.x))}function feFpToBigInteger(){return this.x}function feFpNegate(){return new ECFieldElementFp(this.q,this.x.negate().mod(this.q))}function feFpAdd(a){return new ECFieldElementFp(this.q,this.x.add(a.toBigInteger()).mod(this.q))}function feFpSubtract(a){return new ECFieldElementFp(this.q,this.x.subtract(a.toBigInteger()).mod(this.q))}function feFpMultiply(a){return new ECFieldElementFp(this.q,this.x.multiply(a.toBigInteger()).mod(this.q))}function feFpSquare(){return new ECFieldElementFp(this.q,this.x.square().mod(this.q))}function feFpDivide(a){return new ECFieldElementFp(this.q,this.x.multiply(a.toBigInteger().modInverse(this.q)).mod(this.q))}ECFieldElementFp.prototype.equals=feFpEquals;ECFieldElementFp.prototype.toBigInteger=feFpToBigInteger;ECFieldElementFp.prototype.negate=feFpNegate;ECFieldElementFp.prototype.add=feFpAdd;ECFieldElementFp.prototype.subtract=feFpSubtract;ECFieldElementFp.prototype.multiply=feFpMultiply;ECFieldElementFp.prototype.square=feFpSquare;ECFieldElementFp.prototype.divide=feFpDivide;ECFieldElementFp.prototype.sqrt=function(){return new ECFieldElementFp(this.q,this.x.sqrt().mod(this.q))};function ECPointFp(c,a,d,b){this.curve=c;this.x=a;this.y=d;if(b==null){this.z=BigInteger.ONE}else{this.z=b}this.zinv=null}function pointFpGetX(){if(this.zinv==null){this.zinv=this.z.modInverse(this.curve.q)}return this.curve.fromBigInteger(this.x.toBigInteger().multiply(this.zinv).mod(this.curve.q))}function pointFpGetY(){if(this.zinv==null){this.zinv=this.z.modInverse(this.curve.q)}return this.curve.fromBigInteger(this.y.toBigInteger().multiply(this.zinv).mod(this.curve.q))}function pointFpEquals(a){if(a==this){return true}if(this.isInfinity()){return a.isInfinity()}if(a.isInfinity()){return this.isInfinity()}var c,b;c=a.y.toBigInteger().multiply(this.z).subtract(this.y.toBigInteger().multiply(a.z)).mod(this.curve.q);if(!c.equals(BigInteger.ZERO)){return false}b=a.x.toBigInteger().multiply(this.z).subtract(this.x.toBigInteger().multiply(a.z)).mod(this.curve.q);return b.equals(BigInteger.ZERO)}function pointFpIsInfinity(){if((this.x==null)&&(this.y==null)){return true}return this.z.equals(BigInteger.ZERO)&&!this.y.toBigInteger().equals(BigInteger.ZERO)}function pointFpNegate(){return new ECPointFp(this.curve,this.x,this.y.negate(),this.z)}function pointFpAdd(l){if(this.isInfinity()){return l}if(l.isInfinity()){return this}var p=l.y.toBigInteger().multiply(this.z).subtract(this.y.toBigInteger().multiply(l.z)).mod(this.curve.q);var o=l.x.toBigInteger().multiply(this.z).subtract(this.x.toBigInteger().multiply(l.z)).mod(this.curve.q);if(BigInteger.ZERO.equals(o)){if(BigInteger.ZERO.equals(p)){return this.twice()}return this.curve.getInfinity()}var j=new BigInteger("3");var e=this.x.toBigInteger();var n=this.y.toBigInteger();var c=l.x.toBigInteger();var k=l.y.toBigInteger();var m=o.square();var i=m.multiply(o);var d=e.multiply(m);var g=p.square().multiply(this.z);var a=g.subtract(d.shiftLeft(1)).multiply(l.z).subtract(i).multiply(o).mod(this.curve.q);var h=d.multiply(j).multiply(p).subtract(n.multiply(i)).subtract(g.multiply(p)).multiply(l.z).add(p.multiply(i)).mod(this.curve.q);var f=i.multiply(this.z).multiply(l.z).mod(this.curve.q);return new ECPointFp(this.curve,this.curve.fromBigInteger(a),this.curve.fromBigInteger(h),f)}function pointFpTwice(){if(this.isInfinity()){return this}if(this.y.toBigInteger().signum()==0){return this.curve.getInfinity()}var g=new BigInteger("3");var c=this.x.toBigInteger();var h=this.y.toBigInteger();var e=h.multiply(this.z);var j=e.multiply(h).mod(this.curve.q);var i=this.curve.a.toBigInteger();var k=c.square().multiply(g);if(!BigInteger.ZERO.equals(i)){k=k.add(this.z.square().multiply(i))}k=k.mod(this.curve.q);var b=k.square().subtract(c.shiftLeft(3).multiply(j)).shiftLeft(1).multiply(e).mod(this.curve.q);var f=k.multiply(g).multiply(c).subtract(j.shiftLeft(1)).shiftLeft(2).multiply(j).subtract(k.square().multiply(k)).mod(this.curve.q);var d=e.square().multiply(e).shiftLeft(3).mod(this.curve.q);return new ECPointFp(this.curve,this.curve.fromBigInteger(b),this.curve.fromBigInteger(f),d)}function pointFpMultiply(d){if(this.isInfinity()){return this}if(d.signum()==0){return this.curve.getInfinity()}var m=d;var l=m.multiply(new BigInteger("3"));var b=this.negate();var j=this;var q=this.curve.q.subtract(d);var o=q.multiply(new BigInteger("3"));var c=new ECPointFp(this.curve,this.x,this.y);var a=c.negate();var g;for(g=l.bitLength()-2;g>0;--g){j=j.twice();var n=l.testBit(g);var f=m.testBit(g);if(n!=f){j=j.add(n?this:b)}}for(g=o.bitLength()-2;g>0;--g){c=c.twice();var p=o.testBit(g);var r=q.testBit(g);if(p!=r){c=c.add(p?c:a)}}return j}function pointFpMultiplyTwo(c,a,b){var d;if(c.bitLength()>b.bitLength()){d=c.bitLength()-1}else{d=b.bitLength()-1}var f=this.curve.getInfinity();var e=this.add(a);while(d>=0){f=f.twice();if(c.testBit(d)){if(b.testBit(d)){f=f.add(e)}else{f=f.add(this)}}else{if(b.testBit(d)){f=f.add(a)}}--d}return f}ECPointFp.prototype.getX=pointFpGetX;ECPointFp.prototype.getY=pointFpGetY;ECPointFp.prototype.equals=pointFpEquals;ECPointFp.prototype.isInfinity=pointFpIsInfinity;ECPointFp.prototype.negate=pointFpNegate;ECPointFp.prototype.add=pointFpAdd;ECPointFp.prototype.twice=pointFpTwice;ECPointFp.prototype.multiply=pointFpMultiply;ECPointFp.prototype.multiplyTwo=pointFpMultiplyTwo;function ECCurveFp(e,d,c){this.q=e;this.a=this.fromBigInteger(d);this.b=this.fromBigInteger(c);this.infinity=new ECPointFp(this,null,null)}function curveFpGetQ(){return this.q}function curveFpGetA(){return this.a}function curveFpGetB(){return this.b}function curveFpEquals(a){if(a==this){return true}return(this.q.equals(a.q)&&this.a.equals(a.a)&&this.b.equals(a.b))}function curveFpGetInfinity(){return this.infinity}function curveFpFromBigInteger(a){return new ECFieldElementFp(this.q,a)}function curveFpDecodePointHex(m){switch(parseInt(m.substr(0,2),16)){case 0:return this.infinity;case 2:case 3:var c=m.substr(0,2);var l=m.substr(2);var j=this.fromBigInteger(new BigInteger(k,16));var i=this.getA();var h=this.getB();var e=j.square().add(i).multiply(j).add(h);var g=e.sqrt();if(c=="03"){g=g.negate()}return new ECPointFp(this,j,g);case 4:case 6:case 7:var d=(m.length-2)/2;var k=m.substr(2,d);var f=m.substr(d+2,d);return new ECPointFp(this,this.fromBigInteger(new BigInteger(k,16)),this.fromBigInteger(new BigInteger(f,16)));default:return null}}ECCurveFp.prototype.getQ=curveFpGetQ;ECCurveFp.prototype.getA=curveFpGetA;ECCurveFp.prototype.getB=curveFpGetB;ECCurveFp.prototype.equals=curveFpEquals;ECCurveFp.prototype.getInfinity=curveFpGetInfinity;ECCurveFp.prototype.fromBigInteger=curveFpFromBigInteger;ECCurveFp.prototype.decodePointHex=curveFpDecodePointHex;

/* EC affine extensions (bitcoinjs) */
ECFieldElementFp.prototype.getByteLength=function(){return Math.floor((this.toBigInteger().bitLength()+7)/8)};ECPointFp.prototype.getEncoded=function(c){var d=function(h,f){var g=h.toByteArrayUnsigned();if(f<g.length){g=g.slice(g.length-f)}else{while(f>g.length){g.unshift(0)}}return g};var a=this.getX().toBigInteger();var e=this.getY().toBigInteger();var b=d(a,32);if(c){if(e.isEven()){b.unshift(2)}else{b.unshift(3)}}else{b.unshift(4);b=b.concat(d(e,32))}return b};ECPointFp.decodeFrom=function(g,c){var f=c[0];var e=c.length-1;var d=c.slice(1,1+e/2);var b=c.slice(1+e/2,1+e);d.unshift(0);b.unshift(0);var a=new BigInteger(d);var h=new BigInteger(b);return new ECPointFp(g,g.fromBigInteger(a),g.fromBigInteger(h))};ECPointFp.decodeFromHex=function(g,c){var f=c.substr(0,2);var e=c.length-2;var d=c.substr(2,e/2);var b=c.substr(2+e/2,e/2);var a=new BigInteger(d,16);var h=new BigInteger(b,16);return new ECPointFp(g,g.fromBigInteger(a),g.fromBigInteger(h))};ECPointFp.prototype.add2D=function(c){if(this.isInfinity()){return c}if(c.isInfinity()){return this}if(this.x.equals(c.x)){if(this.y.equals(c.y)){return this.twice()}return this.curve.getInfinity()}var g=c.x.subtract(this.x);var e=c.y.subtract(this.y);var a=e.divide(g);var d=a.square().subtract(this.x).subtract(c.x);var f=a.multiply(this.x.subtract(d)).subtract(this.y);return new ECPointFp(this.curve,d,f)};ECPointFp.prototype.twice2D=function(){if(this.isInfinity()){return this}if(this.y.toBigInteger().signum()==0){return this.curve.getInfinity()}var b=this.curve.fromBigInteger(BigInteger.valueOf(2));var e=this.curve.fromBigInteger(BigInteger.valueOf(3));var a=this.x.square().multiply(e).add(this.curve.a).divide(this.y.multiply(b));var c=a.square().subtract(this.x.multiply(b));var d=a.multiply(this.x.subtract(c)).subtract(this.y);return new ECPointFp(this.curve,c,d)};ECPointFp.prototype.multiply2D=function(b){if(this.isInfinity()){return this}if(b.signum()==0){return this.curve.getInfinity()}var g=b;var f=g.multiply(new BigInteger("3"));var l=this.negate();var d=this;var c;for(c=f.bitLength()-2;c>0;--c){d=d.twice();var a=f.testBit(c);var j=g.testBit(c);if(a!=j){d=d.add2D(a?this:l)}}return d};ECPointFp.prototype.isOnCurve=function(){var d=this.getX().toBigInteger();var i=this.getY().toBigInteger();var f=this.curve.getA().toBigInteger();var c=this.curve.getB().toBigInteger();var h=this.curve.getQ();var e=i.multiply(i).mod(h);var g=d.multiply(d).multiply(d).add(f.multiply(d)).add(c).mod(h);return e.equals(g)};ECPointFp.prototype.toString=function(){return"("+this.getX().toBigInteger().toString()+","+this.getY().toBigInteger().toString()+")"};ECPointFp.prototype.validate=function(){var c=this.curve.getQ();if(this.isInfinity()){throw new Error("Point is at infinity.")}var a=this.getX().toBigInteger();var b=this.getY().toBigInteger();if(a.compareTo(BigInteger.ONE)<0||a.compareTo(c.subtract(BigInteger.ONE))>0){throw new Error("x coordinate out of bounds")}if(b.compareTo(BigInteger.ONE)<0||b.compareTo(c.subtract(BigInteger.ONE))>0){throw new Error("y coordinate out of bounds")}if(!this.isOnCurve()){throw new Error("Point is not on the curve.")}if(this.multiply(c).isInfinity()){throw new Error("Point is not a scalar multiple of G.")}return true};


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
   generatePkce  —  RFC 7636 PKCE code_verifier + code_challenge
   Generates a 43-char base64url code_verifier using Math.random (sufficient
   for load-test isolation; not for production secret material).
   Computes code_challenge = BASE64URL(SHA-256(ASCII(code_verifier))) using
   the built-in _sha256() above — no external crypto dependency.
   Stores both values via LR.setParam so VuGen body/URL substitution works.
   Call once at the start of each Action() iteration before any request.
   ========================================================= */
function generatePkce(){
  var chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  var vBytes=[];
  for(var i=0;i<32;i++) vBytes.push(Math.floor(Math.random()*256));
  var verifier=vBytes.map(function(b){return chars[b%chars.length];}).join('');
  /* SHA-256 of ASCII bytes of verifier string */
  var vAscii=[];
  for(var i=0;i<verifier.length;i++) vAscii.push(verifier.charCodeAt(i)&0xff);
  var hash=_sha256(vAscii);
  /* Base64url-encode the 32-byte hash (no padding) */
  var B64='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var b64='';
  for(var i=0;i<hash.length;i+=3){
    var b0=hash[i],b1=i+1<hash.length?hash[i+1]:0,b2=i+2<hash.length?hash[i+2]:0;
    b64+=B64[(b0>>2)&63]+B64[((b0<<4)|(b1>>4))&63];
    b64+=i+1<hash.length?B64[((b1<<2)|(b2>>6))&63]:'=';
    b64+=i+2<hash.length?B64[b2&63]:'=';
  }
  var challenge=b64.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  LR.setParam('pkce_verifier',verifier);
  LR.setParam('pkce_challenge',challenge);
  return verifier;
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
