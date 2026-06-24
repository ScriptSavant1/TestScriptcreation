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
// SCRIPT GENERATION  -  Web HTTP/HTML (Action.c)
// ===========================================================================
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

  // -- Header analysis: determine universal (auto) vs per-request headers ----
  // Headers handled by VuGen attributes or managed internally  -  never emit via web_add_header
  const SKIP_HDR_AC=new Set([
    // VuGen attributes handle these  -  never emit via web_add_header
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
  // Convert "accept-language" -> "Accept-Language"  -  split on hyphen, capitalise first char, rejoin
  function hdrTitleCase(n){ return n.split('-').map(w=>w?w[0].toUpperCase()+w.slice(1):w).join('-'); }
  // Count header name+value occurrences across scripted entries (non-filtered, non-marker, non-redirect)
  const visEntries=S.entries.filter((e,i)=>!e.filtered&&!e.isMarker&&!acAutoFollowSet.has(i));
  const hdrFreq={};    // k → Map<value, count-of-entries-with-that-value>
  const hdrKeyFreq={}; // k → count-of-entries-that-have-this-header (any value)
  for(const ev of visEntries){
    const seenKeys=new Set();
    for(const h of (ev.reqHdrs||[])){
      const k=h.name.toLowerCase();
      if(SKIP_HDR_AC.has(k)||k.startsWith(':')) continue;
      if(!hdrFreq[k]) hdrFreq[k]=new Map();
      hdrFreq[k].set(h.value,(hdrFreq[k].get(h.value)||0)+1);
      if(!seenKeys.has(k)){ seenKeys.add(k); hdrKeyFreq[k]=(hdrKeyFreq[k]||0)+1; }
    }
  }
  // Global headers: key appears on ≥80% of entries → use most common value as web_add_auto_header
  // This correctly handles headers like Accept that have 2 values (nav text/html + XHR json):
  // the most common value becomes global; requests with a different value emit a per-request override.
  const autoHdrs={};
  const aThresh=Math.max(1,Math.ceil(visEntries.length*0.8));
  for(const [k,valMap] of Object.entries(hdrFreq)){
    if((hdrKeyFreq[k]||0)>=aThresh){
      // Key present on ≥80% of entries → pick most common value as global default
      const [bestVal]=[...valMap.entries()].sort((a,b)=>b[1]-a[1])[0];
      autoHdrs[k]=bestVal;
    }
  }
  // Force-global: User-Agent and Accept-Language are always session-wide constants
  for(const fk of ['user-agent','accept-language']){
    if(hdrFreq[fk]&&autoHdrs[fk]===undefined){
      const [bestVal]=[...hdrFreq[fk].entries()].sort((a,b)=>b[1]-a[1])[0];
      autoHdrs[fk]=bestVal;
    }
  }
  // Suppress Authorization header only when value is a Negotiate/NTLM challenge — web_set_user handles those.
  // Bearer tokens must remain so they appear on every API request after SSO login.
  if(S.auth&&['kerberos','ntlm','negotiate'].includes(S.auth.type)&&
     autoHdrs['authorization']&&/^(negotiate|ntlm)\s/i.test(autoHdrs['authorization']))
    delete autoHdrs['authorization'];

  // Helper: substitute primary server hostname with {ServerHost} param token
  const _sh=S.serverHost;
  function subHostC(url){
    if(!_sh||!url.startsWith(_sh.prefix)) return url;
    return _sh.proto+'//{ServerHost}'+url.slice(_sh.prefix.length);
  }

  // Build host variable map for header value substitution
  const acHostVarMap=buildHdrHostMap(S.entries,_sh?_sh.host:'');

  let _dpopPfUsedAC=false;
  let o='Action()\n{\n\n\tweb_set_sockets_option("SSL_VERSION", "AUTO");\n\n';
  // Server configuration
  if(_sh){
    o+=`\t// Server configuration — update "ServerHost" value to target different environments\n`;
    o+=`\t// e.g. test: ${_sh.host}  prod: prod-server.company.com\n`;
    o+=`\tlr_save_string("${_sh.host}", "ServerHost");\n`;
    // Extra hostnames found in headers
    Object.entries(acHostVarMap).forEach(([hh,hv])=>{
      if(hv==='SERVER_HOST') return;
      const lrP='ServerHost'+hv.replace('SERVER_HOST','');
      o+=`\tlr_save_string("${hh}", "${lrP}");\n`;
    });
    o+='\n';
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
    o+=`\tweb_set_user("{username}", "{password}", "${ntlmHost}");\n\n`;
  }
  // Global headers (same value on every request)  -  set once with web_add_auto_header
  for(const [k,v] of Object.entries(autoHdrs)){
    o+=`\tweb_add_auto_header("${hdrTitleCase(k)}", "${escJs(subHdrValC(v,acHostVarMap))}");\n`;
  }
  if(Object.keys(autoHdrs).length) o+='\n';
  let snap=1;

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
        o+=`\tlr_think_time(3);\n\n`;
      }
      continue;
    }
    if(e.filtered) continue;

    // Skip auto-follow redirect (300-303/307) and 401 challenge entries — VuGen handles automatically
    if(acAutoFollowSet.has(idx)){
      o+=`\t// HTTP ${e.status} → VuGen auto-follows redirect to ${e.url} (omitted)\n`;
      continue;
    }
    // Count auto-follows triggered by this entry
    {let _j=idx+1,_fc=0; while(_j<S.entries.length&&acAutoFollowSet.has(_j)){_fc++;_j++;} if(_fc>0) o+=`\t// Note: VuGen auto-follows ${_fc} redirect(s) after this request\n`;}

    const n=name(e.url);
    const ct=e.ct||'text/html';
    const ref=e.referer||'';
    const sn=`t${snap++}.inf`;

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
        o+=`\tweb_js_run(\n\t\t"Code=generateDpopProof('${escJs(htu)}', '${e.method}'${athArg});",\n\t\t"ResultParam=${resultParam}",\n\t\tLAST);\n`;
        o+=`\tweb_add_header("${hdrTitleCase(dk)}", "{${resultParam}}");\n`;
        if(dk==='dpop-pf') _dpopPfUsedAC=true;
      }
    }
    for(const h of (e.reqHdrs||[])){
      const k=h.name.toLowerCase();
      if(SKIP_HDR_AC.has(k)||k.startsWith(':')) continue;
      if(autoHdrs[k]===h.value) continue;         // global already covers this exact value — skip
      if(k==='accept'&&h.value==='*/*') continue; // VuGen default — never needed
      // Suppress only Negotiate/NTLM challenge headers — Bearer and other auth headers must be emitted
      if(k==='authorization'&&S.auth&&['kerberos','ntlm','negotiate'].includes(S.auth.type)&&/^(negotiate|ntlm)\s/i.test(h.value)) continue;
      o+=`\tweb_add_header("${hdrTitleCase(k)}", "${escJs(subHdrValC(h.value,acHostVarMap))}");\n`;
    }

    if(e.method==='GET'||e.method==='HEAD'){
      o+=`\tweb_url("${n}",\n\t\t"URL=${subHdrValC(e.url,acHostVarMap)}",\n\t\t"Resource=0",\n`;
      o+=`\t\t"RecContentType=${ct}",\n\t\t"Referer=${subHdrValC(ref,acHostVarMap)}",\n`;
      o+=`\t\t"Snapshot=${sn}",\n\t\t"Mode=HTML",\n\t\tLAST);\n\n`;
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
      const body = rawBodyText
        ? (isBinary ? escBodyBinary(rawBodyText)
                    : rawBodyText.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\r?\n/g,'\\n').replace(/\t/g,'\\t'))
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
      o+=`\tweb_custom_request("${n}",\n\t\t"URL=${subHdrValC(e.url,acHostVarMap)}",\n\t\t"Method=${e.method}",\n`;
      o+=`\t\t"Resource=0",\n\t\t"RecContentType=${ct}",\n`;
      o+=`\t\t"Referer=${subHdrValC(ref,acHostVarMap)}",\n\t\t"Snapshot=${sn}",\n\t\t"Mode=HTML",\n`;
      o+=`\t\t"EncType=${encType}",\n`;
      if(body){
        // Smart chunking  -  never break inside an escape sequence (\xHH, \X).
        // Splitting mid-escape produces invalid C hex literals e.g. "\xC""3..." -> wrong byte.
        const bodyAttr=isBinary?'BodyBinary':'Body';
        const CHUNK=200;
        if(body.length<=CHUNK){
          o+=`\t\t"${bodyAttr}=${body}",\n`;
        } else {
          const chunks=[];
          let pos=0;
          while(pos<body.length){
            let end=Math.min(pos+CHUNK, body.length);
            if(end<body.length){
              // Back up to avoid splitting inside a \xHH or \X escape sequence
              if(body[end-1]==='\\') end--;                                            // lone '\'
              else if(end>=2  && body[end-2]==='\\' && body[end-1]==='x') end-=2;     // '\x'
              else if(end>=3  && body[end-3]==='\\' && body[end-2]==='x') end-=3;     // '\xH'
            }
            chunks.push(body.substring(pos,end));
            pos=end;
          }
          // Output: attr= on first chunk, comma only on last chunk, no comma on middle chunks
          o+=`\t\t"${bodyAttr}=${chunks[0]}"\n`;
          for(let i=1;i<chunks.length;i++){
            o+=(i===chunks.length-1)?`\t\t"${chunks[i]}",\n`:`\t\t"${chunks[i]}"\n`;
          }
        }
      }
      o+=`\t\tLAST);\n\n`;
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
// Returns Map<idx, {size, pos}> — only entries in groups of size >= 2 are present.
function buildConcurrentGroups(entries, autoFollowSet, excludeSet) {
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
  const mjGroupMap=buildConcurrentGroups(S.entries, mjAutoFollowSet, _mjDpopExclude);
  // Extract default headers from first scripted (non-redirect) request
  const firstE=S.entries.find((e,i)=>!e.isMarker&&!e.filtered&&!mjAutoFollowSet.has(i));
  const defHdrs=firstE?filtHdrs(firstE):{'accept-language':'en-US,en;q=0.9'};

  // -- module-level declarations ---------------------------------------------
  const _shHost=S.serverHost?S.serverHost.host:'';
  const mjHostVarMap=buildHdrHostMap(S.entries,_shHost);

  //DPoP helper require (module-level)
  if(S.hasDpop){
    o+="// DPoP Helper — EC P-256 key generation and DPoP proof signing\n";
    o+="const {getDpopProof} = require('./dpop-helper.js');\n";
  }

  // Host variables
  o+=`let SERVER_HOST = '${_shHost}';\n`;
  Object.entries(mjHostVarMap).filter(([,v])=>v!=='SERVER_HOST').forEach(([h,v])=>{o+=`let ${v} = '${h}';\n`;});
  o+='\nlet think_time = 1;\n\n';

  // Default request options (module-level)
  o+='// Default request options\n';
  o+='load.WebRequest.defaults.returnBody = false;\n';
  o+='load.WebRequest.defaults.downloadHtmlStaticResources = true;\n';
  o+='load.WebRequest.defaults.headers = {\n';
  for(const [k,v] of Object.entries(defHdrs)){
    // Suppress Negotiate/NTLM tokens — session-specific, handled by setUserCredentials
    if(k.toLowerCase()==='authorization'&&/^(negotiate|ntlm)\s/i.test(v)) continue;
    o+=`    "${escJs(k)}": "${escJs(v)}",\n`;
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
    const hostArg=(S.auth.type==='basic'||S.auth.type==='digest')?'"*"':`"${S.auth.host||'server'}"`;
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
          o+=`    load.sleep(think_time);\n\n`;
          currentTxn=null;
        }
      }
      continue;
    }
    if(e.filtered) continue;

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
      if(defHdrs[k]!==undefined&&defHdrs[k]===v) continue;
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
          o+=`      load.global.${varName} = getDpopProof('${htu}', '${e.method}', load.global.dpop_jwk, load.global.${S.dpopTokenVar});\n`;
        } else {
          o+=`      load.global.${varName} = getDpopProof('${htu}', '${e.method}', load.global.dpop_jwk);\n`;
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
    // URL substitution — replaces all known hostnames (SERVER_HOST, SERVER_HOST1, …)
    o+=`${pi}url: ${subHdrValMj(urlBase, mjHostVarMap)},\n`;
    // queryString object (only when URL had query params)
    if(qsEntries.length>0){
      o+=`${pi}queryString: {\n`;
      for(const [k,v] of qsEntries) o+=`${si}"${escJs(k)}": ${subHdrValMj(v,mjHostVarMap)},\n`;
      o+=`${pi}},\n`;
    }
    o+=`${pi}method: "${e.method}",\n`;
    // Inject DPoP headers with dynamic proof values
    if(S.hasDpop){
      const dpopHdrs=(e.reqHdrs||[]).filter(h=>/^dpop(-pf)?$/i.test(h.name));
      for(const dh of dpopHdrs){
        const dk=dh.name.toLowerCase();
        const varName=dk==='dpop-pf'?'dpop_pf_proof':'dpop_proof';
        extraHdrs[dh.name]=`\${load.global.${varName}}`;
      }
    }
    if(Object.keys(extraHdrs).length>0){
      o+=`${pi}headers: {\n`;
      for(const [k,v] of Object.entries(extraHdrs))
        o+=`${si}"${escJs(k)}": ${subHdrValMj(v,mjHostVarMap)},\n`;
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
  return o;
}

// ===========================================================================
// OTHER GENERATED FILES
// ===========================================================================
var _REC_LRE_SETUP_COMMENT =
    "/*\n"
  + " * " + "═".repeat(62) + "\n"
  + " *  SETUP REQUIRED — 3 steps before running this script in VuGen\n"
  + " * " + "═".repeat(62) + "\n"
  + " *\n"
  + " *  lre-utils.dat contains the DPoP crypto library. It is\n"
  + " *  shipped as .dat to bypass antivirus scanners on IIS servers.\n"
  + " *  VuGen requires the .js extension to execute it. Do this once:\n"
  + " *\n"
  + " *  Step 1 — Rename the file (Windows Explorer or command prompt):\n"
  + " *            lre-utils.dat  →  lre-utils.js\n"
  + " *\n"
  + " *  Step 2 — In this file (vuser_init.c) and in Action.c:\n"
  + ' *            Find:    "File=lre-utils.dat"\n'
  + ' *            Replace: "File=lre-utils.js"\n'
  + " *\n"
  + " *  Step 3 — In VuGen: Script > Script Properties > Extra Files\n"
  + " *            Remove lre-utils.dat  then Add Files → select lre-utils.js\n"
  + " *\n"
  + " * " + "═".repeat(62) + "\n"
  + " */\n\n";

function genVuserInit(){
    if(S.hasDpop){
      return _REC_LRE_SETUP_COMMENT
        +`vuser_init()\n{\n\n`
        +`\t// Load lre-utils.dat ONCE and initialize DPoP engine\n`
        +`\tweb_js_run(\n`
        +`\t\t"Code=initDpopKey(LR.getParam('dpop_jwk')); 'DPoP engine initialized successfully':",\n`
        +`\t\t"ResultParam=dpop_init_result",\n`
        +`\t\tSOURCES,\n`
        +`\t\t"File=lre-utils.dat", ENDITEM,    /* <- Step 2: update to "File=lre-utils.js" after renaming */\n`
        +`\t\tLAST);\n\n`
        +`\tlr_output_message("DPoP Initialization: %s", lr_eval_string("{dpop_init_result}"));\n\n`
        +`\treturn 0;\n}\n`;
    }
    return `vuser_init()\n{\n\treturn 0;\n}\n`;
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

function detectServerHost(entries){
  const counts={};
  for(const e of entries){
    try{
      const u=new URL(e.url);
      if(!u.hostname) continue;
      const stdPort=u.protocol==='https:'?'443':'80';
      const portPart=u.port&&u.port!==stdPort?':'+u.port:'';
      const host=u.hostname+portPart;
      const prefix=u.protocol+'//'+host;
      if(!counts[prefix]) counts[prefix]={host,proto:u.protocol,prefix,count:0};
      counts[prefix].count++;
    }catch{}
  }
  const sorted=Object.values(counts).sort((a,b)=>b.count-a.count);
  if(!sorted.length) return null;
  const total=sorted.reduce((s,e)=>s+e.count,0);
  const top=sorted[0];
  if(top.count/total<0.35&&sorted.length>1) return null; // no dominant host
  return top;
}

function buildScripts(){
  S.auth=detectCorporateAuth(S.entries, detectAuth(S.entries));
  S.serverHost=detectServerHost(S.entries.filter(e=>!e.filtered&&!e.isMarker));
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
  const isWeb = S.format==='webhttp' || S.format==='both';
  const isDev = S.format==='devweb'  || S.format==='both';
  S.scripts={};
  if(isWeb){ S.scripts.ac=genActionC(); S.scripts.vi=genVuserInit(); S.scripts.ve=genVuserEnd(); S.scripts.gh=genGlobalsH(); }
  if(isDev){ S.scripts.mj=genMainJS(); }
}
