// ===========================================================================
// AUTO-FOLLOW REDIRECT DETECTION
// ===========================================================================
// Returns Set of entry indices that VuGen reaches via automatic redirect-following.
// These can be omitted from generated scripts — VuGen follows them automatically.
// Recorder entries use respHdrsMap (flat object with lowercase keys).
function buildAutoFollowMap(entries) {
  const autoFollowSet = new Set();
  for (let i = 1; i < entries.length; i++) {
    const curr = entries[i];
    if (curr.filtered || curr.isMarker) continue;
    let prevI = i - 1;
    while (prevI >= 0 && (entries[prevI].filtered || entries[prevI].isMarker)) prevI--;
    if (prevI < 0) continue;
    const prev = entries[prevI];
    // 300-303, 307, 308 are browser-auto-followed redirects
    if (![301,302,303,307,308].includes(prev.status) && prev.status !== 300) continue;
    const locVal = (prev.respHdrsMap || {})['location'];
    if (!locVal) continue;
    try {
      const loc = new URL(locVal, prev.url);
      const tgt = new URL(curr.url);
      // Compare origin + pathname, then query via URLSearchParams (handles %-encoding differences)
      if (loc.origin === tgt.origin && loc.pathname === tgt.pathname) {
        const lp = [...new URLSearchParams(loc.search)].sort((a,b) => a[0] < b[0] ? -1 : 1);
        const tp = [...new URLSearchParams(tgt.search)].sort((a,b) => a[0] < b[0] ? -1 : 1);
        if (lp.length === tp.length && lp.every((p,k) => p[0]===tp[k][0] && p[1]===tp[k][1]))
          autoFollowSet.add(i);
      }
    } catch {
      if (locVal === curr.url || curr.url.endsWith(locVal)) autoFollowSet.add(i);
    }
  }
  // Also detect 401 challenge entries: same URL+method re-issued after 401.
  // VuGen handles 401→Negotiate/NTLM automatically via web_set_user() — skip the 401 entry,
  // keep only the successful (non-401) response entry.
  for (let i = 0; i < entries.length - 1; i++) {
    const curr = entries[i];
    if (curr.filtered || curr.isMarker || curr.status !== 401) continue;
    let nextI = i + 1;
    while (nextI < entries.length && (entries[nextI].filtered || entries[nextI].isMarker)) nextI++;
    if (nextI >= entries.length) continue;
    const next = entries[nextI];
    try {
      if (new URL(next.url).href === new URL(curr.url).href && next.method === curr.method)
        autoFollowSet.add(i);
    } catch {
      if (next.url === curr.url && next.method === curr.method) autoFollowSet.add(i);
    }
  }
  return autoFollowSet;
}

// ===========================================================================
// HEADERS SET ONCE PER VUSER
// ===========================================================================
// Headers never written by the scripts: VuGen sets them from the step's attributes (Referer=, EncType=) or
// manages them itself (connection, cookies, compression, caching), or the browser sends them only for itself.
const _REC_SKIP_HDR_AC=new Set([
  'referer',          // -> "Referer=" attribute in web_url / web_custom_request
  'content-type',     // -> "EncType=" attribute (or auto for web_submit_data ITEMDATA)
  'content-length',   // computed automatically by VuGen engine
  'host',             // always added by VuGen from the URL
  'connection',       // HTTP keep-alive managed by VuGen internally
  'keep-alive',       // same  -  connection persistence managed by VuGen
  'transfer-encoding',// chunked encoding handled by VuGen
  'upgrade-insecure-requests', // browser-only security hint
  'expect',           // 100-continue  -  connection-level, not needed in scripts
  'cookie','cookie2', // managed by VuGen cookie jar
  'te','trailer',     // HTTP/1.1 connection-level
  'via',              // proxy-inserted, irrelevant to load test
  'dnt',              // Do Not Track  -  browser privacy hint
  'accept-encoding',  // VuGen handles gzip/deflate/br decompression automatically
  'priority',         // HTTP/2 urgency hint  -  not applicable to VuGen protocol layer
  // Conditional / cache headers  -  not needed in scripted replay
  'x-forwarded-for',
  'if-none-match','if-modified-since','if-unmodified-since','if-match',
  'cache-control','pragma',
  // Browser client hints / fetch metadata  -  browser-generated, meaningless in load test
  'sec-ch-ua','sec-ch-ua-mobile','sec-ch-ua-platform',
  'sec-fetch-dest','sec-fetch-mode','sec-fetch-site','sec-fetch-user',
  // DPoP headers - replaced dynamically per-request
  'dpop','dpop-pf'
]);
// Never set once per Vuser, even when every request sent them: sign-in tokens and CSRF tokens (fetched during the
// iteration, they change), cookies, DPoP proofs, and Origin / CORS pre-flight headers.
const _REC_NEVER_GLOBAL=/^(authorization|proxy-authorization|cookie2?|dpop(-pf)?|origin|access-control-request-(method|headers))$|csrf|xsrf/i;
const _REC_IDENTITY_HDRS=new Set(['user-agent','accept-language']);

// Headers that EVERY scripted request sent with the same value -> set once per Vuser (VuGen: web_add_auto_header in
// vuser_init; DevWeb: load.WebRequest.defaults.headers). Any other header is added only to the requests that sent it,
// so a header that belongs to some requests is never sent with the others (or with page resources).
// Returns { lower-case name: { name (as recorded), value } }.
function _recCommonHeaders(scripted){
  const out={};
  if(!scripted.length) return out;
  const seen={}, count={};
  for(const e of scripted){
    const here=new Set();
    for(const h of (e.reqHdrs||[])){
      const k=String(h.name||'').toLowerCase();
      if(!k||k.startsWith(':')||here.has(k)||_REC_SKIP_HDR_AC.has(k)||SKIP_HDRS.has(k)||_REC_NEVER_GLOBAL.test(k)) continue;
      here.add(k);
      if(!(k in seen)) seen[k]={name:h.name,value:h.value};
      else if(seen[k]&&seen[k].value!==h.value) seen[k]=null;   // different values: not common
      count[k]=(count[k]||0)+1;
    }
  }
  // The browser's identity (user agent, language) is on every request it sends; requests DevTools served from its
  // cache are saved with provisional headers only (no Accept-Language), so for these two one value is enough.
  for(const k in seen) if(seen[k]&&(count[k]===scripted.length||_REC_IDENTITY_HDRS.has(k))) out[k]=seen[k];
  return out;
}

// The requests that become steps of the script (redirects followed automatically and page resources are not)
function _recPlanHeaders(){
  const af=buildAutoFollowMap(S.entries);
  const absorbed=PageResources.groupPageResources(S.entries,af).absorbed;
  S.initHeaders=_recCommonHeaders(S.entries.filter((e,i)=>!e.filtered&&!e.isMarker&&!af.has(i)&&!absorbed.has(i)));
  // VuGen: the browser's user agent goes to Runtime Settings > Browser Emulation (default.cfg), as VuGen records it
  S.recordedUA=S.initHeaders['user-agent']?S.initHeaders['user-agent'].value:null;
}

function hdrTitleCase(n){ return n.split('-').map(w=>w?w[0].toUpperCase()+w.slice(1):w).join('-'); }

// A page the browser opened (navigation or form post), as opposed to a call made by the page's JavaScript
function _recIsNavigation(e){
  const rt=(e._resourceType||'').toLowerCase();
  if(rt) return rt==='document';
  const mode=(e.hdrsMap||{})['sec-fetch-mode'];
  if(mode) return mode==='navigate';
  return /^(text\/html|application\/xhtml)/i.test(e.ct||'');
}

// Split an escaped C string into chunks of about `size` characters, never inside an escape sequence
// (\" \\ \n \xHH …) — a chunk ending in the first half of "\\" made the next quote part of the string (BUG-091).
function _cChunks(s,size){
  const out=[];
  let cur='', i=0;
  while(i<s.length){
    let len=1;
    if(s[i]==='\\') len=(s[i+1]==='x')?4:2;
    if(cur.length+len>size&&cur.length){ out.push(cur); cur=''; }
    cur+=s.substr(i,len); i+=len;
  }
  if(cur.length) out.push(cur);
  return out;
}

// ===========================================================================
// SCRIPT GENERATION  -  Web HTTP/HTML (Action.c)
// ===========================================================================
// Split an application/x-www-form-urlencoded body into decoded {k,v} pairs for
// web_submit_data ITEMDATA — VuGen re-encodes the values itself on replay.
// Same rule as Script Studio's genActionC (studio-codegen.js).
function parseFormUrlEncoded(raw){
  const dec=s=>{ try{ return decodeURIComponent(s.replace(/\+/g,' ')); }catch{ return s; } };
  return raw.split('&').filter(Boolean).map(pair=>{
    const eq=pair.indexOf('=');
    return eq>=0 ? {k:dec(pair.substring(0,eq)), v:dec(pair.substring(eq+1))} : {k:dec(pair), v:''};
  });
}

function genActionC(){
  const nc={};
  function name(url){
    let n='request';
    try{
      const p=new URL(url);
      const segs=p.pathname.split('/').filter(Boolean);
      let r=segs[segs.length-1]||p.hostname.split('.')[0]||'req';
      r=r.replace(/\.[^.]+$/,'').replace(/[^a-zA-Z0-9]/g,'_')
         .replace(/^_+|_+$/g,'').replace(/_+/g,'_').substring(0,24)||'request';
      if(/^\d/.test(r)) r='req_'+r;
      n=r;
    }catch{}
    if(nc[n]){nc[n]++;return n+'_'+nc[n];}
    nc[n]=1; return n;
  }

  // Pre-compute auto-follow set so redirect entries can be excluded from header analysis
  const acAutoFollowSet=buildAutoFollowMap(S.entries);
  // Static resources (CSS/JS/images…) belong to their page step, as in HTML mode — not separate steps
  const acPageRes=PageResources.groupPageResources(S.entries, acAutoFollowSet);

  // -- Headers --------------------------------------------------------------
  // Set once per Vuser in vuser_init: headers EVERY step sent with the same value (_recPlanHeaders; the user agent
  // goes to Runtime Settings instead). Every other header is added to the steps that sent it.
  const SKIP_HDR_AC=_REC_SKIP_HDR_AC;
  const autoHdrs={};
  for(const k in (S.initHeaders||{})) if(k!=='user-agent') autoHdrs[k]=S.initHeaders[k].value;

  // Server parameters ({host: name}) — set in vuser_init, used in every URL, header and body below
  const acHostVarMap=_recHostMap();

  // Page step's resources: the ones in its HTML download automatically (Mode=HTML);
  // the rest (script files, files loaded by CSS/JavaScript) are listed under EXTRARES on the same step,
  // exactly as VuGen's own HTML-mode recording does.
  function pageResComment(idx){
    const g=acPageRes.byPage.get(idx);
    if(!g) return '';
    const skip=g.skipped.length?`; ${g.skipped.length} failed or repeated not scripted`:'';
    if(!g.isPage) return `\t// Resources loaded during this step (no page load in this transaction): ${g.extra.length} listed under EXTRARES${skip}\n`;
    if(!g.htmlKnown) return `\t// Page HTML was not recorded: its ${g.extra.length} resource(s) are listed under EXTRARES${skip}\n`;
    return `\t// Page resources: ${g.inHtml.length} images/stylesheets in the page HTML download automatically (Mode=HTML)`+
      (g.extra.length?`; ${g.extra.length} other (scripts, CSS/JS-loaded files) ${g.extra.length===1?"is":"are"} listed under EXTRARES`:'')+
      (g.skipped.length?`; ${g.skipped.length} failed or repeated not scripted`:'')+`\n`;
  }
  function extraResC(idx){
    const g=acPageRes.byPage.get(idx);
    if(!g||!g.extra.length) return '';
    let s='\t\tEXTRARES,\n';
    for(const ri of g.extra){
      const r=S.entries[ri];
      s+=`\t\t"Url=${subHdrValC(r.url,acHostVarMap)}",`+(r.referer&&r.referer!==g.pageUrl?` "Referer=${subHdrValC(r.referer,acHostVarMap)}",`:'')+` ENDITEM,\n`;
    }
    return s;
  }

  let _dpopPfUsedAC=false;
  let o='Action()\n{\n\n';
  // Set once per Vuser in vuser_init (genVuserInit): servers, the SSL setting, headers every step sends
  const _hpNames=Object.values(acHostVarMap);
  o+=`\t// Set in vuser_init: ${_hpNames.length?'the servers ('+_hpNames.slice(0,2).map(n=>'{'+n+'}').join(', ')+(_hpNames.length>2?', …':'')+'), ':''}the SSL setting${Object.keys(autoHdrs).length?' and the headers every request sends':''}\n\n`;
  // DPoP: "Simulate a new user on each iteration" (Runtime Settings, on by default) also empties the JavaScript
  // engine, so lre-utils.js loaded in vuser_init is gone from iteration 2 — load it again once per iteration (BUG-092)
  if(S.hasDpop){
    o+=`\t// The JavaScript engine starts empty on every iteration — load lre-utils.js again for the DPoP proofs below\n`;
    o+=`\tweb_js_run(\n\t\t"Code=initDpopKey(LR.getParam('dpop_jwk')); 'DPoP engine ready';",\n\t\t"ResultParam=dpop_init_result",\n\t\tSOURCES,\n\t\t"File=lre-utils.js", ENDITEM,\n\t\tLAST);\n\n`;
  }
  // Authentication
  const AUTH_LABELS_C={kerberos:'Kerberos',ntlm:'NTLM',negotiate:'Negotiate (Kerberos/NTLM)',basic:'Basic',digest:'Digest'};
  if(S.auth && AUTH_LABELS_C[S.auth.type]){
    const lbl=AUTH_LABELS_C[S.auth.type];
    o+=`\t// ${lbl} Authentication\n`;
    if(S.auth.type==='kerberos'||S.auth.type==='negotiate'){
      o+=`\t// Runtime Settings: Internet Protocol -> Preferences -> Authentication\n`;
      o+=`\t//   [x] Enable Integrated Authentication\n`;
      o+=`\t//   [x] Use canonical name in SPN\n`;
    } else if(S.auth.type==='ntlm'){
      o+=`\t// Runtime Settings: Internet Protocol -> Preferences -> Authentication\n`;
      o+=`\t//   [x] Enable Integrated Authentication\n`;
    }
    const ntlmHost=S.auth.host||'server';
    const ntlmParam=acHostVarMap[ntlmHost];
    o+=`\tweb_set_user("{username}", "{password}", "${ntlmParam?'{'+ntlmParam+'}':ntlmHost}");\n\n`;
  }
  let snap=1;
  // think time between transactions, not after the last one
  let lastEnd=-1;
  S.entries.forEach((x,i)=>{ if(x.isMarker&&x.markerType==='end') lastEnd=i; });

  for(let idx=0;idx<S.entries.length;idx++){
    const e=S.entries[idx];
    if(e.isMarker){
      const acIdx=S.txns.findIndex(t=>t.name===e.txnName);
      const acSeq=String(acIdx+1).padStart(2,'0');
      const acSc=`SC01_${acSeq}_${e.txnName.replace(/^[Tt]\d+[_-]/,'').toUpperCase()}`;
      if(e.markerType==='start')
        o+=`\tlr_start_transaction("${acSc}");\n\n`;
      else{
        o+=`\tlr_end_transaction("${acSc}", LR_AUTO);\n\n`;
        if(idx!==lastEnd) o+=`\tlr_think_time(3);\n\n`;
      }
      continue;
    }
    if(e.filtered) continue;
    if(acPageRes.absorbed.has(idx)) continue; // downloaded as part of its page step

    // Skip auto-follow redirect (300-303/307) and 401 challenge entries — VuGen handles automatically
    if(acAutoFollowSet.has(idx)){
      o+=`\t// HTTP ${e.status} → VuGen auto-follows redirect to ${e.url} (omitted)\n`;
      continue;
    }
    // Count auto-follows triggered by this entry
    {let _j=idx+1,_fc=0; while(_j<S.entries.length&&acAutoFollowSet.has(_j)){_fc++;_j++;} if(_fc>0) o+=`\t// Note: VuGen auto-follows ${_fc} redirect(s) after this request\n`;}
    o+=pageResComment(idx);

    const n=name(e.url);
    const ct=e.ct||'text/html';
    const ref=e.referer||'';
    const sn=`t${snap++}.inf`;
    // Mode=HTML for pages the browser opened (VuGen parses them for their images and stylesheets) and for steps
    // with EXTRARES; Mode=HTTP for calls made by the page's JavaScript — the browser never parsed those answers
    const mode=(_recIsNavigation(e)||acPageRes.byPage.has(idx))?'HTML':'HTTP';

    // Per-request headers: only emit when value DIFFERS from global default (as an override)
    // DPoP proof generation — fresh proof per request via web_js_run
    if(S.hasDpop){
      const dpopHdrs=(e.reqHdrs||[]).filter(h=>/^dpop(-pf)?$/i.test(h.name));
      for(const dh of dpopHdrs){
        const dk=dh.name.toLowerCase();
        if(dk==='dpop-pf'&&_dpopPfUsedAC) continue;
        const resultParam=dk==='dpop-pf'?'_dpop_pf_proof':'_dpop_proof';
        let htu=e.url; try{const pu=new URL(e.url);htu=pu.origin+pu.pathname;}catch{}
        try{const pl=JSON.parse(atob(dh.value.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));if(pl.htu)htu=pl.htu;}catch{}
        const athArg=dk==='dpop'?`, LR.getParam('`+S.dpopTokenVar+`')`:``;
        o+=`\tweb_js_run(\n\t\t"Code=generateDpopProof(${_htuExpr(htu,acHostVarMap,'c')}, '${e.method}'${athArg});",\n\t\t"ResultParam=${resultParam}",\n\t\tLAST);\n`;
        o+=`\tweb_add_header("${hdrTitleCase(dk)}", "{${resultParam}}");\n`;
        if(dk==='dpop-pf') _dpopPfUsedAC=true;
      }
    }
    for(const h of (e.reqHdrs||[])){
      const k=h.name.toLowerCase();
      if(SKIP_HDR_AC.has(k)||k.startsWith(':')) continue;
      if(autoHdrs[k]===h.value) continue;         // set once in vuser_init with this exact value
      if(k==='user-agent'&&h.value===S.recordedUA) continue; // in Runtime Settings (default.cfg)
      if(k==='accept'&&h.value==='*/*') continue; // VuGen default — never needed
      // Suppress only Negotiate/NTLM challenge headers — Bearer and other auth headers must be emitted
      if(k==='authorization'&&S.auth&&['kerberos','ntlm','negotiate'].includes(S.auth.type)&&/^(negotiate|ntlm)\s/i.test(h.value)) continue;
      o+=`\tweb_add_header("${hdrTitleCase(k)}", "${escJs(subHdrValC(h.value,acHostVarMap))}");\n`;
    }

    if(e.method==='GET'||e.method==='HEAD'){
      o+=`\tweb_url("${n}",\n\t\t"URL=${subHdrValC(e.url,acHostVarMap)}",\n\t\t"Resource=0",\n`;
      o+=`\t\t"RecContentType=${ct}",\n\t\t"Referer=${subHdrValC(ref,acHostVarMap)}",\n`;
      o+=`\t\t"Snapshot=${sn}",\n\t\t"Mode=${mode}",\n`+extraResC(idx)+`\t\tLAST);\n\n`;
    } else {
      let encType='application/x-www-form-urlencoded';
      let rawBodyText='';
      if(e.body){
        encType=(e.body.mimeType||encType).split(';')[0].trim();
        rawBodyText=e.body.text||'';
      }
      // Detect content-type from request headers if body.mimeType not set
      const ctHdr=(e.hdrsMap['content-type']||'').split(';')[0].trim();
      if(!e.body && ctHdr) encType=ctHdr;
      // Multipart body detection
      if(encType==='multipart/form-data'){
        o+=`\t// TODO: Multipart body detected. VuGen uses web_add_body_part() for multipart uploads.\n`;
        o+=`\t// Consider splitting into parts: web_add_header("Content-Type","multipart/form-data; boundary=...") + individual web_add_body_part() calls.\n`;
        o+=`\t// For binary file uploads, use BodyFilePath= attribute or record directly in VuGen.\n`;
      }
      // Always use BodyBinary= to match VuGen native recording behavior.
      // Body= causes VuGen attribute parser errors with JSON braces, colons, and other special chars.
      const isBinary = true;
      // servers in the body (redirect_uri, callback URLs …) become their {Server} parameter, as in DevWeb
      const hostBody = rawBodyText ? subHdrValC(rawBodyText,acHostVarMap) : '';
      const body = hostBody
        ? (isBinary ? escBodyBinary(hostBody)
                    : hostBody.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\r?\n/g,'\\n').replace(/\t/g,'\\t'))
        : '';
      // NetLog source: POST body was not captured  -  emit TODO comment
      if(e._fromNetLog && !body){
        o+=`\t// TODO: POST body not available in NetLog - add BodyBinary= with your recorded request body\n`;
      }
      // Large body warning (e.g. .NET __VIEWSTATE not yet correlated)
      if(rawBodyText&&rawBodyText.length>1500&&!rawBodyText.includes('{')&&/__VIEWSTATE|__EVENTVALIDATION|__RequestVerificationToken/.test(rawBodyText)){
        o+=`\t// TODO: Large .NET hidden field(s) detected. These values are dynamic per-session.\n`;
        o+=`\t// Use VuGen-Script-Studio.html with two HARs to auto-correlate these values.\n`;
      }
      // Standard HTML form POST -> web_submit_data with ITEMDATA, as VuGen records it in
      // HTML mode. Everything else (JSON, XML, multipart, PUT/PATCH/DELETE) stays a
      // web_custom_request. Must match Script Studio's genActionC.
      if(e.method==='POST'&&encType==='application/x-www-form-urlencoded'&&rawBodyText&&rawBodyText.indexOf('=')>=0){
        o+=`\tweb_submit_data("${n}",\n\t\t"Action=${subHdrValC(e.url,acHostVarMap)}",\n\t\t"Method=POST",\n`;
        o+=`\t\t"RecContentType=${ct}",\n\t\t"Referer=${subHdrValC(ref,acHostVarMap)}",\n`;
        o+=`\t\t"Snapshot=${sn}",\n\t\t"Mode=HTML",\n\t\tITEMDATA,\n`;
        for(const {k,v} of parseFormUrlEncoded(rawBodyText))
          o+=`\t\t"Name=${escJs(k)}","Value=${escJs(subHdrValC(v,acHostVarMap))}",ENDITEM,\n`;
        o+=extraResC(idx)+`\t\tLAST);\n\n`;
        continue;
      }
      o+=`\tweb_custom_request("${n}",\n\t\t"URL=${subHdrValC(e.url,acHostVarMap)}",\n\t\t"Method=${e.method}",\n`;
      o+=`\t\t"Resource=0",\n\t\t"RecContentType=${ct}",\n`;
      o+=`\t\t"Referer=${subHdrValC(ref,acHostVarMap)}",\n\t\t"Snapshot=${sn}",\n\t\t"Mode=${mode}",\n`;
      o+=`\t\t"EncType=${encType}",\n`;
      if(body){
        // Split long bodies over several C strings, never inside an escape sequence (_cChunks, BUG-091):
        // splitting mid-escape produced "\" + quote (the string never ended) or "\xC""3…" (a wrong byte)
        const bodyAttr=isBinary?'BodyBinary':'Body';
        const CHUNK=200;
        if(body.length<=CHUNK){
          o+=`\t\t"${bodyAttr}=${body}",\n`;
        } else {
          const chunks=_cChunks(body,CHUNK);
          // Output: attr= on first chunk, comma only on last chunk, no comma on middle chunks
          o+=`\t\t"${bodyAttr}=${chunks[0]}"\n`;
          for(let i=1;i<chunks.length;i++){
            o+=(i===chunks.length-1)?`\t\t"${chunks[i]}",\n`:`\t\t"${chunks[i]}"\n`;
          }
        }
      }
      o+=extraResC(idx)+`\t\tLAST);\n\n`;
    }
  }
  o+='\treturn 0;\n}\n';
  return o;
}

// ===========================================================================
// SCRIPT GENERATION  -  DevWeb (main.js)
// ===========================================================================
// Groups HAR entries that fired concurrently (time-interval overlap) into Promise.all blocks.
// autoFollowSet: Set<idx> of redirect/challenge entries already excluded from generated script.
// excludeSet:    Set<idx> of entries that must remain sequential regardless (DPoP, extractors).
// skipSet:       Set<idx> of entries not scripted at all (page resources) — ignored, never break a group.
// Returns Map<idx, {size, pos}> — only entries in groups of size >= 2 are present.
function buildConcurrentGroups(entries, autoFollowSet, excludeSet, skipSet) {
  const groupMap = new Map();
  let buf = [];   // current group candidate: array of entry indices
  let maxEnd = 0;

  function flush() {
    if (buf.length >= 2) {
      buf.forEach((idx, pos) => groupMap.set(idx, {size: buf.length, pos}));
    }
    buf = []; maxEnd = 0;
  }

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (skipSet && skipSet.has(i)) continue;
    // Markers, filtered, auto-follow, and explicitly excluded entries break groups
    if (e.isMarker || e.filtered || autoFollowSet.has(i) || (excludeSet && excludeSet.has(i))) {
      flush(); continue;
    }
    // Navigation requests (full-page GET) always break groups — they TRIGGER the concurrent burst
    if ((e.hdrsMap && e.hdrsMap['sec-fetch-mode']) === 'navigate') { flush(); continue; }
    const startMs = e.startMs || 0;
    if (!startMs) { flush(); continue; } // no HAR timing data (NetLog) → sequential
    const endMs = startMs + Math.max(e.dur || 0, 1);
    if (buf.length === 0 || startMs < maxEnd) {
      buf.push(i);
      if (endMs > maxEnd) maxEnd = endMs;
    } else {
      flush();
      buf.push(i);
      maxEnd = endMs;
    }
  }
  flush();
  return groupMap;
}

function genMainJS(){
  let o='';
  let rid=1;
  let _dpopPfUsedMJ=false;
  const nc={};

  function rqName(url){
    let n='request';
    try{
      const p=new URL(url);
      const segs=p.pathname.split('/').filter(Boolean);
      let r=segs[segs.length-1]||p.hostname.split('.')[0]||'req';
      r=r.replace(/\.[^.]+$/,'').replace(/[^a-zA-Z0-9]/g,'_')
         .replace(/^_+|_+$/g,'').replace(/_+/g,'_').substring(0,30)||'request';
      if(/^\d/.test(r)) r='req_'+r;
      n=r;
    }catch{}
    if(nc[n]){nc[n]++;return n+'_'+nc[n];}
    nc[n]=1;return n;
  }

  function filtHdrs(e){
    const h={};
    for(const hdr of (e.reqHdrs||[])){
      const k=hdr.name.toLowerCase();
      if(!SKIP_HDRS.has(k)&&!k.startsWith(':')) h[hdr.name]=hdr.value;
    }
    return h;
  }

  // Pre-compute auto-follow set so redirect entries can be excluded
  const mjAutoFollowSet=buildAutoFollowMap(S.entries);
  // DPoP requests must stay sequential — proof computation lines appear before new load.WebRequest({)
  const _mjDpopExclude=new Set();
  if(S.hasDpop) S.entries.forEach((e,i)=>{ if((e.reqHdrs||[]).some(h=>/^dpop(-pf)?$/i.test(h.name))) _mjDpopExclude.add(i); });
  // Build concurrent group map from HAR timing overlap (DevWeb only — Web HTTP is always sequential)
  // Static resources (CSS/JS/images…) belong to their page request, not separate requests
  const mjPageRes=PageResources.groupPageResources(S.entries, mjAutoFollowSet);
  const mjGroupMap=buildConcurrentGroups(S.entries, mjAutoFollowSet, _mjDpopExclude, mjPageRes.absorbed);
  // Default headers: the ones EVERY request sent with the same value (_recPlanHeaders) — any other header is added
  // to the requests that sent it, so it is never sent with the others
  const defHdrs={}, defLc={};
  for(const k in (S.initHeaders||{})){ defHdrs[S.initHeaders[k].name]=S.initHeaders[k].value; defLc[k]=S.initHeaders[k].value; }
  // think time between transactions, not after the last one
  let mjLastEnd=-1;
  S.entries.forEach((x,i)=>{ if(x.isMarker&&x.markerType==='end') mjLastEnd=i; });

  // -- module-level declarations ---------------------------------------------
  // Server parameters ({host: name}) — one const each, used in every URL, header and body below
  const mjHostVarMap=_recHostMap();
  const _mjMain=(S.hostParams&&S.hostParams.main)||'';

  //DPoP helper require (module-level)
  if(S.hasDpop){
    o+="// DPoP Helper — EC P-256 key generation and DPoP proof signing\n";
    o+="const {getDpopProof} = require('./dpop-helper.js');\n";
  }

  // Servers
  if(Object.keys(mjHostVarMap).length){
    o+=_recDwServerBlock(mjHostVarMap,_mjMain);
  }
  o+='// Think time between transactions (seconds) — Runtime Settings > Think Time decides how it is used, as in VuGen\n';
  o+='let think_time = 3;\n\n';

  // Default request options (module-level)
  o+='// Default request options\n';
  o+='load.WebRequest.defaults.returnBody = false;\n';
  o+='load.WebRequest.defaults.downloadHtmlStaticResources = true;\n';
  o+='load.WebRequest.defaults.headers = {\n';
  for(const [k,v] of Object.entries(defHdrs)){
    // Suppress Negotiate/NTLM tokens — session-specific, handled by setUserCredentials
    if(k.toLowerCase()==='authorization'&&/^(negotiate|ntlm)\s/i.test(v)) continue;
    o+=`    "${escJs(k.toLowerCase())}": ${subHdrValMj(v,mjHostVarMap)},\n`;   // lower case, like every request's headers
  }
  o+='};\n\n';

  // Transaction declarations (module-level)
  if(S.txns.length>0){
    o+='// Transaction declarations\n';
    S.txns.forEach((txn,i)=>{
      const tsNum=String(i+1).padStart(2,'0');
      const scName=`SC01_${tsNum}_${txn.name.replace(/^[Tt]\d+[_-]/,'').toUpperCase()}`;
      o+=`let TS${tsNum} = new load.Transaction("${scName}");\n`;
    });
    o+='\n';
  }

  // -- initialize ------------------------------------------------------------
  o+='load.initialize("Initialize", async function() {\n';
  o+='    load.log("Initializing Vuser " + load.config.user.userId, load.LogLevel.debug);\n\n';
  if(S.hasDpop){
    o+='    // DPoP key pair — generated once, reused for all proofs in this VUser\n';
    o+='    load.global.dpop_jwk = null;\n\n';
  }
  o+='    load.log("Initialization complete", load.LogLevel.debug);\n';
  o+='});\n\n';

  // -- action ----------------------------------------------------------------
  o+='load.action("Action", async function() {\n';
  o+='    load.log("Starting action - Iteration " + load.config.runtime.iteration, load.LogLevel.debug);\n\n';

  // Authentication credentials (per-iteration — stays in action)
  const AUTH_LABELS_JS={kerberos:'Kerberos',ntlm:'NTLM',negotiate:'Negotiate (Kerberos/NTLM)',basic:'Basic',digest:'Digest'};
  if(S.auth && AUTH_LABELS_JS[S.auth.type]){
    const lbl=AUTH_LABELS_JS[S.auth.type];
    o+=`    // ${lbl} Authentication\n`;
    if(S.auth.type==='kerberos'||S.auth.type==='negotiate'){
      o+=`    // Runtime Settings: Replay -> enableIntegratedAuthentication: true\n`;
      o+=`    // Runtime Settings: Replay -> useCanonicalNameInSPN: true\n`;
    } else if(S.auth.type==='ntlm'){
      o+=`    // Runtime Settings: Replay -> enableIntegratedAuthentication: true\n`;
    }
    const hostArg=(S.auth.type==='basic'||S.auth.type==='digest')?'"*"':(mjHostVarMap[S.auth.host]||`"${S.auth.host||'server'}"`);
    const isWinAuth=S.auth.type==='kerberos'||S.auth.type==='ntlm'||S.auth.type==='negotiate';
    o+=`    load.setUserCredentials({\n`;
    o+=`        username: load.params['username'],\n`;
    o+=`        password: load.params['password'],\n`;
    if(isWinAuth) o+=`        domain: load.params['domain'],\n`;
    o+=`        host: ${hostArg}\n`;
    o+=`    });\n\n`;
  }

  // Process entries  -  all requests in one action, transactions started/stopped inline
  let currentTxn=null; // {name, tsNum}

  for(let idx=0;idx<S.entries.length;idx++){
    const e=S.entries[idx];
    if(e.isMarker){
      if(e.markerType==='start'){
        const txIdx=S.txns.findIndex(t=>t.name===e.txnName);
        const tsNum=String(txIdx+1).padStart(2,'0');
        currentTxn={name:e.txnName,tsNum};
        o+=`    TS${tsNum}.start();\n\n`;
      } else {
        if(currentTxn){
          o+=`    TS${currentTxn.tsNum}.stop();\n`;
          o+=idx!==mjLastEnd?`    load.thinkTime(think_time);\n\n`:'\n';
          currentTxn=null;
        }
      }
      continue;
    }
    if(e.filtered) continue;
    if(mjPageRes.absorbed.has(idx)) continue; // downloaded as part of its page request

    // Skip auto-follow redirect (300-303/307) and 401 challenge entries — VuGen handles automatically
    if(mjAutoFollowSet.has(idx)){
      o+=`    // HTTP ${e.status} → VuGen auto-follows redirect to ${escJs(e.url)} (omitted)\n`;
      continue;
    }
    // Determine concurrent group membership — drives Promise.all grouping and indentation
    const _ginfo = mjGroupMap.get(idx);
    const _inGrp = !!(_ginfo && _ginfo.size >= 2);
    const _grpFirst = !_ginfo || _ginfo.pos === 0;
    const _grpLast  = !_ginfo || _ginfo.pos === _ginfo.size - 1;
    const ind = _inGrp ? '        ' : '    ';     // request-line indent (8 or 4 spaces)
    const pi  = _inGrp ? '            ' : '        '; // property indent (12 or 8 spaces)
    const si  = _inGrp ? '                ' : '            '; // sub-item indent (16 or 12 spaces)

    // Count auto-follows triggered by this entry
    {let _j=idx+1,_fc=0; while(_j<S.entries.length&&mjAutoFollowSet.has(_j)){_fc++;_j++;} if(_fc>0) o+=`${ind}// Note: VuGen auto-follows ${_fc} redirect(s) after this request\n`;}

    const rn=rqName(e.url);

    // Parse URL into base + queryString object
    let urlBase=e.url, qsEntries=[];
    try{const pu=new URL(e.url);urlBase=pu.origin+pu.pathname;qsEntries=[...pu.searchParams.entries()];}catch{}

    // Only add headers that differ from defaults
    const allHdrs=filtHdrs(e);
    const extraHdrs={};
    for(const [k,v] of Object.entries(allHdrs)){
      const kl=k.toLowerCase();
      if(kl==='accept'&&v==='*/*') continue;
      if(defLc[kl]!==undefined&&defLc[kl]===v) continue;
      if(kl==='authorization'&&S.auth&&['kerberos','ntlm','negotiate'].includes(S.auth.type)&&/^(negotiate|ntlm)\s/i.test(v)) continue;
      extraHdrs[k]=v;
    }

    // Open Promise.all block before the first entry in a concurrent group
    if(_inGrp && _grpFirst) o+=`    await Promise.all([\n`;

    // Multipart body detection
    const mjCt=(e.hdrsMap&&e.hdrsMap['content-type']||'').split(';')[0].trim();
    if(mjCt==='multipart/form-data'){
      o+=`${ind}// TODO: Multipart body detected. For file uploads in DevWeb:\n`;
      o+=`${ind}// const formData = new load.FormData();\n`;
      o+=`${ind}// formData.append('field', value); // or readFile() for binary\n`;
    }
    o+=`${ind}// ${rn}\n`;
    const _pr=mjPageRes.byPage.get(idx);
    if(_pr){
      const _skip=_pr.skipped.length?`; ${_pr.skipped.length} failed or repeated not scripted`:'';
      if(!_pr.isPage) o+=`${ind}// Resources loaded during this step (no page load in this transaction): ${_pr.extra.length} listed in resources[]${_skip}\n`;
      else if(!_pr.htmlKnown) o+=`${ind}// Page HTML was not recorded: its ${_pr.extra.length} resource(s) are listed in resources[]${_skip}\n`;
      else o+=`${ind}// Page resources: ${_pr.inHtml.length} images/stylesheets in the page HTML download automatically (downloadHtmlStaticResources)`+
        (_pr.extra.length?`; ${_pr.extra.length} other (scripts, CSS/JS-loaded files) ${_pr.extra.length===1?"is":"are"} listed in resources[]`:'')+
        (_pr.skipped.length?`; ${_pr.skipped.length} failed or repeated not scripted`:'')+`\n`;
    }

    // DPoP proof generation — fresh proof per request (DPoP entries are always sequential)
    if(S.hasDpop){
      const dpopHdrs=(e.reqHdrs||[]).filter(h=>/^dpop(-pf)?$/i.test(h.name));
      for(const dh of dpopHdrs){
        const dk=dh.name.toLowerCase();
        if(dk==='dpop-pf'&&_dpopPfUsedMJ) continue;
        const varName=dk==='dpop-pf'?'dpop_pf_proof':'dpop_proof';
        // Extract real htu from the recorded token (dpop-pf points to a different server)
        let htu=urlBase; try{htu=new URL(e.url).origin+new URL(e.url).pathname;}catch{}
        try{const pl=JSON.parse(atob(dh.value.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));if(pl.htu)htu=pl.htu;}catch{}
        if(dk==='dpop'){
          o+=`      load.global.${varName} = getDpopProof(${_htuExpr(htu,mjHostVarMap,'js')}, '${e.method}', load.global.dpop_jwk, load.global.${S.dpopTokenVar});\n`;
        } else {
          o+=`      load.global.${varName} = getDpopProof(${_htuExpr(htu,mjHostVarMap,'js')}, '${e.method}', load.global.dpop_jwk);\n`;
          _dpopPfUsedMJ=true;
        }
      }
    }

    // Request opening — no `await` inside Promise.all; concurrent case has extra indent
    if(_inGrp){
      o+=`${ind}new load.WebRequest({\n`;
    } else {
      o+=`    await new load.WebRequest({\n`;
    }
    o+=`${pi}id: ${rid},\n`;
    // URL substitution — every server becomes its parameter (shared/host-params.js)
    o+=`${pi}url: ${subHdrValMj(urlBase, mjHostVarMap)},\n`;
    // queryString object (only when URL had query params)
    if(qsEntries.length>0){
      o+=`${pi}queryString: {\n`;
      for(const [k,v] of qsEntries) o+=`${si}"${escJs(k)}": ${subHdrValMj(v,mjHostVarMap)},\n`;
      o+=`${pi}},\n`;
    }
    o+=`${pi}method: "${e.method}",\n`;
    // DPoP headers: the proof made just above for this request — the variable itself, not text (BUG-093: written as
    // "${load.global.dpop_proof}" in a plain string, the header carried that text instead of the proof)
    const dpopExpr={};
    if(S.hasDpop){
      const dpopHdrs=(e.reqHdrs||[]).filter(h=>/^dpop(-pf)?$/i.test(h.name));
      for(const dh of dpopHdrs){
        const dk=dh.name.toLowerCase();
        extraHdrs[dh.name]='';
        dpopExpr[dh.name]=`load.global.${dk==='dpop-pf'?'dpop_pf_proof':'dpop_proof'}`;
      }
    }
    if(Object.keys(extraHdrs).length>0){
      o+=`${pi}headers: {\n`;
      // header names in lower case, like the defaults above (HTTP/2 sends them so; HTTP/1.1 ignores case) —
      // recordings mix "Referer" (cached / HTTP/1.1 entries) and "referer"
      for(const [k,v] of Object.entries(extraHdrs))
        o+=`${si}"${escJs(k.toLowerCase())}": ${dpopExpr[k]||subHdrValMj(v,mjHostVarMap)},\n`;
      o+=`${pi}},\n`;
    }
    if(e.body&&e.body.text){
      const bText=e.body.text;
      const bMime=(e.body.mimeType||'').split(';')[0].trim();
      if(bText.length>1500&&bMime==='application/x-www-form-urlencoded'&&/__VIEWSTATE|__EVENTVALIDATION|__RequestVerificationToken/.test(bText)){
        o+=`${pi}// TODO: Large .NET hidden field(s) in body. Use Script Studio with two HARs to auto-correlate.\n`;
      }
      if(bMime==='application/x-www-form-urlencoded'&&bText.indexOf('=')>=0){
        // Form body: decode key=value pairs and apply hostname substitution on each value
        const pairs=bText.split('&');
        o+=`${pi}body: {\n`;
        for(const pair of pairs){
          const eq=pair.indexOf('=');
          const rawK=eq>=0?pair.substring(0,eq):pair;
          const rawV=eq>=0?pair.substring(eq+1):'';
          let k=rawK; try{k=decodeURIComponent(rawK.replace(/\+/g,' '));}catch(ex){}
          let v=rawV; try{v=decodeURIComponent(rawV.replace(/\+/g,' '));}catch(ex){}
          o+=`${si}"${escJs(k)}": ${subHdrValMj(v,mjHostVarMap)},\n`;
        }
        o+=`${pi}},\n`;
      } else if(bMime==='application/json'||bMime==='text/json'){
        const {text:bSub,changed:bCh}=subRawMj(bText,mjHostVarMap);
        if(bCh){
          o+=`${pi}body: \`${escTpl(bSub).replace(/\x00HDRH_([^\x00]+)\x00/g,'${$1}')}\`,\n`;
        } else {
          try{
            const parsed=JSON.parse(bText);
            const lines=JSON.stringify(parsed,null,4).split('\n');
            o+=`${pi}body: ${lines.map((l,i)=>i===0?l:pi+l).join('\n')},\n`;
          }catch{ o+=`${pi}body: \`${escTpl(bText)}\`,\n`; }
        }
      } else {
        const {text:bSub,changed:bCh}=subRawMj(bText,mjHostVarMap);
        if(bCh) o+=`${pi}body: \`${escTpl(bSub).replace(/\x00HDRH_([^\x00]+)\x00/g,'${$1}')}\`,\n`;
        else    o+=`${pi}body: \`${escTpl(bText)}\`,\n`;
      }
    } else if(e._fromNetLog && e.method!=='GET' && e.method!=='HEAD'){
      o+=`${pi}// TODO: POST body not available in NetLog - add body property with your recorded request body\n`;
    }
    if(_pr&&_pr.extra.length){
      o+=`${pi}resources: [\n`;
      for(const ri of _pr.extra) o+=`${si}${subHdrValMj(S.entries[ri].url,mjHostVarMap)},\n`;
      o+=`${pi}],\n`;
    }
    // Request closing — concurrent: .send(), with optional Promise.all closer; sequential: .send();\n\n
    if(_inGrp){
      o+=`${ind}}).send(),\n`;
      if(_grpLast) o+=`    ]);\n\n`;
    } else {
      o+=`    }).send();\n\n`;
    }
    rid++;
  }

  o+='    load.log("Action complete", load.LogLevel.debug);\n';
  o+='});\n\n';

  // -- finalize --------------------------------------------------------------
  o+='load.finalize("Finalize", async function() {\n';
  o+='    load.log("Finalizing Vuser " + load.config.user.userId, load.LogLevel.debug);\n\n';
  o+='    // Cleanup code here if needed\n\n';
  o+='    load.log("Finalization complete", load.LogLevel.debug);\n';
  o+='});\n';
  return _recDwDropUnusedServers(o,mjHostVarMap);
}

// DevWeb servers — the same rule as VuGen's set_server(): a user argument with the parameter's name wins (rts.yml
// userArguments, or -userArgs), else the recorded server. Also used by Script Studio (studio-codegen.js).
function _recDwServerBlock(map,main){
  const e=Object.entries(map||{});
  if(!e.length) return '';
  let o='// Servers — change a value here to run against another environment, or set a user argument with the same\n'
    +'// name (rts.yml userArguments, or -userArgs) — it wins over the value here\n';
  for(const [h,v] of e) o+=`const ${v} = load.config.user.args["${v}"] || '${h}';${h===main?'   // main application':''}\n`;
  return o+'\n';
}
// A server that ended up in no URL, header or body of the script is not declared
function _recDwDropUnusedServers(o,map){
  const e=Object.entries(map||{});
  let dropped=0;
  for(const [h,v] of e){
    const decl=`const ${v} = load.config.user.args["${v}"] || '${h}';`;
    const i=o.indexOf(decl); if(i<0) continue;
    const eol=o.indexOf('\n',i);
    if(!(o.slice(0,i)+o.slice(eol)).includes('${'+v+'}')){ o=o.slice(0,i)+o.slice(eol+1); dropped++; }
  }
  if(e.length&&dropped===e.length) o=o.replace(/\/\/ Servers — change a value here[^\n]*\n\/\/ name \(rts\.yml[^\n]*\n\n/,'');
  return o;
}

// ===========================================================================
// OTHER GENERATED FILES
// ===========================================================================
var _REC_LRE_SETUP_COMMENT =
    "/*\n"
  + " * " + "═".repeat(62) + "\n"
  + " *  SETUP REQUIRED — 2 steps before running this script in VuGen\n"
  + " * " + "═".repeat(62) + "\n"
  + " *\n"
  + " *  lre-utils.dat contains the DPoP crypto library. It is\n"
  + " *  shipped as .dat to bypass antivirus scanners on IIS servers.\n"
  + " *  VuGen requires the .js extension to execute it. Do this once:\n"
  + " *\n"
  + " *  Step 1 — Rename the file (Windows Explorer or command prompt):\n"
  + " *            lre-utils.dat  →  lre-utils.js\n"
  + " *\n"
  + " *  Step 2 — In VuGen: Script > Script Properties > Extra Files\n"
  + " *            Remove lre-utils.dat  then Add Files → select lre-utils.js\n"
  + " *\n"
  + " * " + "═".repeat(62) + "\n"
  + " */\n\n";

// Set once per Vuser in vuser_init — kept for every iteration ("Simulate a new user" returns to the state at the end
// of vuser_init): the servers, the SSL setting and the headers every step sent with the same value.
// vuser_init's auto headers (Accept: */* is VuGen's own default — never written)
function _recInitHeaderLines(){
  const ah=Object.keys(S.initHeaders||{}).filter(k=>k!=='user-agent'&&!(k==='accept'&&S.initHeaders[k].value==='*/*'));
  return ah.map(k=>`\tweb_add_auto_header("${hdrTitleCase(k)}", "${escJs(subHdrValC(S.initHeaders[k].value,_recHostMap()))}");\n`);
}
// The servers the script really uses (Action.c, which is generated first, and the auto headers) — only these are set
function _recUsedHostKeys(){
  if(!S.hostParams||!S.hostParams.keys||!S.hostParams.keys.length) return [];
  return HostParams.usedKeys(S.hostParams,((S.scripts&&S.scripts.ac)||'')+_recInitHeaderLines().join(''));
}
function _recInitC(){
  let s='';
  const hp=S.hostParams, used=_recUsedHostKeys();
  if(used.length){
    s+='\t// Servers — change a value here to run against another environment, or add an attribute with the same\n';
    s+='\t// name in Runtime Settings > Additional attributes (it wins over the value here)\n';
    used.forEach(k=>{ s+=`\tset_server("${hp.map[k]}", "${k}");${k===hp.main?'\t// main application':''}\n`; });
    s+='\n';
  }
  s+='\tweb_set_sockets_option("SSL_VERSION", "AUTO");\n\n';
  const hl=_recInitHeaderLines();
  if(hl.length){
    s+='\t// Headers every request of the recording sent with the same value (the user agent is in Runtime Settings)\n';
    s+=hl.join('');
    s+='\n';
  }
  return s;
}
// set_server(): defined above vuser_init() when the script uses servers
function _recSetServerFn(){
  if(!_recUsedHostKeys().length) return '';
  return '// Server value: the Runtime Settings attribute with this name when there is one, else the recorded value\n'
    +'void set_server(char *name, char *recorded)\n{\n'
    +'\tchar *value = lr_get_attrib_string(name);\n'
    +'\tlr_save_string(value != NULL && value[0] != \'\\0\' ? value : recorded, name);\n}\n\n';
}
function genVuserInit(){
    if(S.hasDpop){
      return _REC_LRE_SETUP_COMMENT
        +_recSetServerFn()
        +`vuser_init()\n{\n\n`
        +_recInitC()
        +`\t// Load lre-utils.dat ONCE and initialize DPoP engine\n`
        +`\tweb_js_run(\n`
        +`\t\t"Code=initDpopKey(LR.getParam('dpop_jwk')); 'DPoP engine initialized successfully';",\n`
        +`\t\t"ResultParam=dpop_init_result",\n`
        +`\t\tSOURCES,\n`
        +`\t\t"File=lre-utils.js", ENDITEM,\n`
        +`\t\tLAST);\n\n`
        +`\tlr_output_message("DPoP Initialization: %s", lr_eval_string("{dpop_init_result}"));\n\n`
        +`\treturn 0;\n}\n`;
    }
    return `${_recSetServerFn()}vuser_init()\n{\n\n${_recInitC()}\treturn 0;\n}\n`;
  }
function genVuserEnd() { return 'vuser_end()\n{\n\treturn 0;\n}\n'; }
function genGlobalsH(){
  return `#ifndef _GLOBALS_H\n#define _GLOBALS_H\n\n`+
    `//--------------------------------------------------------------------\n`+
    `// Include Files\n`+
    `#include "lrun.h"\n`+
    `#include "web_api.h"\n`+
    `#include "lrw_custom_body.h"\n\n`+
    `//--------------------------------------------------------------------\n`+
    `// Global Variables\n\n`+
    `#endif // _GLOBALS_H\n`;
}

// ===========================================================================
// AUTHENTICATION DETECTION
// ===========================================================================
function detectAuth(entries){
  function urlParts(url){
    try{
      const u=new URL(url);
      const port=u.port||(u.protocol==='https:'?'443':'80');
      return{host:u.hostname,port,hostport:u.hostname+':'+port};
    }catch{return{host:'',port:'443',hostport:''};}
  }
  const PRIO={kerberos:7,ntlm:6,negotiate:5,digest:4,basic:3,bearer:2,saml:1};
  let best=null;
  function set(type,parts,extra){
    if(!best||(PRIO[type]||0)>(PRIO[best.type]||0))
      best={type,...parts,...(extra||{})};
  }
  for(const e of entries){
    if(e.isMarker) continue;
    const parts=urlParts(e.url);
    // Check WWW-Authenticate in response headers
    const wwwAuth=(e.respHdrsMap||{})['www-authenticate']||'';
    if(/^negotiate\b/i.test(wwwAuth)) set('negotiate',parts);
    else if(/^ntlm\b/i.test(wwwAuth)) set('ntlm',parts);
    else if(/^digest\b/i.test(wwwAuth)){
      const realm=(wwwAuth.match(/realm="([^"]+)"/i)||[])[1]||parts.hostport;
      set('digest',parts,{realm});
    } else if(/^basic\b/i.test(wwwAuth)){
      const realm=(wwwAuth.match(/realm="([^"]+)"/i)||[])[1]||parts.hostport;
      set('basic',parts,{realm});
    }
    // Check Authorization in request headers
    const authHdr=(e.hdrsMap||{})['authorization']||'';
    if(/^negotiate /i.test(authHdr)){
      let type='negotiate';
      try{
        const tok=authHdr.split(' ')[1]||'';
        const dec=atob(tok.substring(0,16));
        type=dec.includes('NTLMSSP')?'ntlm':'kerberos';
      }catch{}
      set(type,parts);
    } else if(/^ntlm /i.test(authHdr)){
      set('ntlm',parts);
    } else if(/^basic /i.test(authHdr)){
      let username='';
      try{username=atob(authHdr.split(' ')[1]||'').split(':')[0];}catch{}
      set('basic',parts,{realm:parts.hostport,username});
    } else if(/^digest /i.test(authHdr)){
      const realm=(authHdr.match(/realm="([^"]+)"/i)||[])[1]||parts.hostport;
      const username=(authHdr.match(/username="([^"]+)"/i)||[])[1]||'';
      set('digest',parts,{realm,username});
    } else if(/^bearer /i.test(authHdr)){
      set('bearer',parts);
    }
    // Check SAML in POST body
    const postText=(e.body&&e.body.text)||'';
    if(postText.includes('SAMLResponse')||postText.includes('SAMLRequest'))
      set('saml',parts);
  }
  return best;
}

// Fallback: if Chrome omitted Negotiate headers from the HAR, infer Windows auth from
// corporate-internal TLD hostnames (e.g. .mde .local .corp .internal).
function detectCorporateAuth(entries, currentAuth){
  if(currentAuth&&['kerberos','ntlm','negotiate'].includes(currentAuth.type)) return currentAuth;
  const PUB=/\.(com|org|net|io|co|app|dev|cloud|gov|edu|biz|info|tech|site|online|store|tv|me|us|uk|au|ca|de|fr|jp|sg|in|eu|nz|nl|se|no|fi|dk|be|at|ch|es|it|pl|cz|ru|br|mx|ar|cl|za|ae|sa|kw|qa)(\.[a-z]{2})?$/i;
  const AZURE=/^(login\.microsoftonline\.com|sts\.windows\.net|login\.windows\.net)$/i;
  for(const e of (entries||[])){
    if(e.isMarker||e.filtered) continue;
    let h=''; try{h=new URL(e.url).hostname;}catch{continue;}
    if(!h||/^\d{1,3}(\.\d{1,3}){3}$/.test(h)||h==='localhost') continue;
    if(!PUB.test(h)||AZURE.test(h)){
      try{
        const u=new URL(e.url),port=u.port||(u.protocol==='https:'?'443':'80'),hp=u.hostname+':'+port;
        return{type:'negotiate',host:u.hostname,port,hostport:hp,realm:hp};
      }catch{}
    }
  }
  return currentAuth;
}

function genDefaultCfg(auth){
  const overrides={};
  // The recorded browser's user agent, as VuGen records it (Runtime Settings > Browser Emulation)
  if(S.recordedUA&&!/[\r\n]/.test(S.recordedUA)){ overrides['UseCustomAgent']='1'; overrides['CustomUserAgent']=S.recordedUA; }
  if(S.hasDpop) overrides['EnableJsForTransport']='1';
  if(auth&&['kerberos','negotiate','ntlm'].includes(auth.type)){
    if(auth.type==='kerberos'||auth.type==='negotiate'){
      overrides['IntegratedAuthentication']='1';
      overrides['SPNCNameLookup']='1';
    } else {
      overrides['IntegratedAuthentication']='1';
      overrides['UseNativeNTLM']='1';
      overrides['OverrideNTLMCreds']='1';
    }
  }
  if(!Object.keys(overrides).length) return WEB_DEFAULT_CFG;
  return WEB_DEFAULT_CFG.split('\n').map(line=>{
    const eq=line.indexOf('=');
    if(eq<0) return line;
    const key=line.substring(0,eq);
    return key in overrides ? key+'='+overrides[key] : line;
  }).join('\n');
}

function genRtsYml(auth){
  if(!auth||!['kerberos','negotiate','ntlm'].includes(auth.type))
    return DEVWEB_RTS_YML;
  return DEVWEB_RTS_YML.replace(
    'enableIntegratedAuthentication: false',
    'enableIntegratedAuthentication: true'
  );
}

// ===========================================================================
// SERVER PARAMETERS — shared/host-params.js decides the servers, the main one and
// the names; the generators only read S.hostParams
// ===========================================================================
function _recHostMap(){ return (S.hostParams&&S.hostParams.map)||{}; }

// Names the script already uses — a server parameter must not take one of them
function _recReservedNames(){ return [S.dpopTokenVar||'AccessToken']; }

// DPoP "htu" (the request URL the proof is for) with its server as the parameter:
// C  -> 'https://' + LR.getParam('Name') + '/path'  (JavaScript run by web_js_run)
// js -> `https://${Name}/path`
function _htuExpr(htu,map,fmt){
  const m=/^(https?:\/\/)([^\/?#]+)(.*)$/i.exec(htu||'');
  const name=m&&map[HostParams.hostKey(htu)];
  if(!name) return fmt==='c'?`'${escJs(htu)}'`:`'${htu}'`;
  return fmt==='c'
    ?`'${escJs(m[1])}' + LR.getParam('${name}') + '${escJs(m[3])}'`
    :'`'+m[1]+'${'+name+'}'+escTpl(m[3])+'`';
}

function _recPlanHosts(){
  const af=buildAutoFollowMap(S.entries);
  S.hostParams=HostParams.plan(S.entries,(e,i)=>!e.filtered&&!e.isMarker&&!af.has(i),S.hostNames||{},_recReservedNames());
  S.serverHost=S.hostParams.main?{host:S.hostParams.main}:null;
}

function buildScripts(){
  S.auth=detectCorporateAuth(S.entries, detectAuth(S.entries));
  // DPoP detection — scan for dpop / dpop-pf headers in any request
  S.hasDpop=S.entries.some(e=>!e.filtered&&!e.isMarker&&(e.reqHdrs||[]).some(h=>/^dpop(-pf)?$/i.test(h.name)));
  // Detect the Bearer token variable name used alongside dpop headers.
  // Find the first request with both dpop + Authorization: Bearer, then
  // extract the token value and look for a matching correlation variable.
  S.dpopTokenVar='AccessToken'; // default fallback
  if(S.hasDpop){
    for(const e of S.entries){
      if(e.filtered||e.isMarker) continue;
      const hasDpopH=(e.reqHdrs||[]).some(h=>/^dpop$/i.test(h.name));
      if(!hasDpopH) continue;
      const authH=(e.reqHdrs||[]).find(h=>h.name.toLowerCase()==='authorization'&&/^Bearer /i.test(h.value));
      if(authH){ S.dpopBearerToken=authH.value.replace(/^Bearer\s+/i,''); break; }
    }
  }
  _recPlanHosts();
  _recPlanHeaders();
  const isWeb = S.format==='webhttp' || S.format==='both';
  const isDev = S.format==='devweb'  || S.format==='both';
  S.scripts={};
  if(isWeb){ S.scripts.ac=genActionC(); S.scripts.vi=genVuserInit(); S.scripts.ve=genVuserEnd(); S.scripts.gh=genGlobalsH(); }
  if(isDev){ S.scripts.mj=genMainJS(); }
}
