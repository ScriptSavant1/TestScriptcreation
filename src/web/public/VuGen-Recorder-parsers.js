// ===========================================================================
// NETLOG DETECTION & PARSING
// chrome://net-export/ produces a JSON with a top-level "constants" key that
// contains logEventTypes and a flat "events" array.
// ===========================================================================
function isNetLog(obj){
  // chrome://net-export/ always has top-level "constants" and "events" array
  // logEventTypes may be absent in newer Chrome versions — check constants alone
  return !!(obj && obj.constants && Array.isArray(obj.events) && !obj.log);
}

// Parse raw header string from NetLog: "HTTP/1.1 200 OK\r\nContent-Type: ..."
// or request: "GET /path HTTP/1.1\r\nHost: ..."
function parseNetLogHeaderBlock(raw){
  if(!raw) return [];
  const lines=raw.split(/\r?\n/);
  const out=[];
  for(let i=1;i<lines.length;i++){  // skip status/request line
    const colon=lines[i].indexOf(':');
    if(colon<1) continue;
    out.push({name:lines[i].slice(0,colon).trim(), value:lines[i].slice(colon+1).trim()});
  }
  return out;
}

function parseNetLog(netlog){
  const evTypes=netlog.constants.logEventTypes||{};  // name -> number
  // Build reverse map: number -> name
  const evNames={};
  for(const [name,num] of Object.entries(evTypes)) evNames[num]=name;
  // Handle both old format (ev.type=number) and new Chrome format (ev.type=string)
  const getEvName=ev=>typeof ev.type==='string'?ev.type:(evNames[ev.type]||'');

  // Group events by source.id
  const sources={};
  for(const ev of netlog.events){
    if(ev.source==null) continue;
    const sid=ev.source.id;
    if(sid==null) continue;
    if(!sources[sid]) sources[sid]={type:ev.source.type, evs:[]};
    sources[sid].evs.push(ev);
  }

  const tickOffset=parseInt(netlog.constants.timeTickOffset||netlog.constants.tickOffset||0);

  const entries=[];
  let id=0;

  for(const [sid, src] of Object.entries(sources)){
    // Identify URL_REQUEST sources by the presence of URL_REQUEST_START_JOB —
    // more robust than checking source.type numbers which change across Chrome versions
    if(!src.evs.some(ev=>getEvName(ev)==='URL_REQUEST_START_JOB')) continue;

    // Collect key events from this source
    let url='', method='GET', reqHdrsRaw='', respHdrsRaw='', startTime=0;

    for(const ev of src.evs){
      const name=getEvName(ev);
      const params=ev.params||{};

      // URL + method
      if(name==='URL_REQUEST_START_JOB'){
        url=params.url||'';
        method=(params.method||'GET').toUpperCase();
        startTime=tickOffset+parseInt(ev.time||0);
      }

      // Request headers (raw block: "GET /path HTTP/1.1\r\nHeader: val\r\n...")
      if(name.includes('SEND_REQUEST_HEADERS')||name==='HTTP_TRANSACTION_SEND_REQUEST'){
        if(params.headers){
          // headers may be array of "Name: Value" strings or a raw block string
          if(Array.isArray(params.headers)){
            reqHdrsRaw='_ARRAY_\r\n'+params.headers.join('\r\n');
          } else {
            reqHdrsRaw=params.headers;
          }
        }
      }

      // Response headers
      if(name.includes('READ_RESPONSE_HEADERS')||name==='HTTP_TRANSACTION_READ_RESPONSE'){
        if(params.headers){
          if(Array.isArray(params.headers)){
            respHdrsRaw='_ARRAY_\r\n'+params.headers.join('\r\n');
          } else {
            respHdrsRaw=params.headers;
          }
        }
      }
    }

    if(!url) continue;  // not a real HTTP request

    // Parse request headers
    let reqHdrs=[];
    if(reqHdrsRaw.startsWith('_ARRAY_\r\n')){
      const lines=reqHdrsRaw.slice(9).split('\r\n');
      for(const line of lines){
        const colon=line.indexOf(':');
        if(colon<1) continue;
        reqHdrs.push({name:line.slice(0,colon).trim(), value:line.slice(colon+1).trim()});
      }
    } else {
      reqHdrs=parseNetLogHeaderBlock(reqHdrsRaw);
    }

    // Parse response status from first response header line (e.g. "HTTP/1.1 200 OK")
    let status=0, ct='';
    let respHdrs=[];
    if(respHdrsRaw.startsWith('_ARRAY_\r\n')){
      const lines=respHdrsRaw.slice(9).split('\r\n');
      // First line is status line
      const statusMatch=(lines[0]||'').match(/\s(\d{3})\s/);
      if(statusMatch) status=parseInt(statusMatch[1]);
      for(let i=1;i<lines.length;i++){
        const colon=lines[i].indexOf(':');
        if(colon<1) continue;
        respHdrs.push({name:lines[i].slice(0,colon).trim(), value:lines[i].slice(colon+1).trim()});
      }
    } else if(respHdrsRaw){
      const statusMatch=respHdrsRaw.match(/\s(\d{3})\s/);
      if(statusMatch) status=parseInt(statusMatch[1]);
      respHdrs=parseNetLogHeaderBlock(respHdrsRaw);
    }

    // Build hdrsMap from request headers
    const hdrsMap={};
    for(const h of reqHdrs) hdrsMap[h.name.toLowerCase()]=h.value;

    // Build respHdrsMap from response headers
    const respHdrsMap={};
    for(const h of respHdrs){
      const k=h.name.toLowerCase();
      respHdrsMap[k]=h.value;
      if(k==='content-type') ct=h.value.split(';')[0].trim();
    }

    entries.push({
      id: 0,          // assigned after sort
      _startTime: startTime, // used for sort only
      url,
      method,
      status,
      ct,
      size: 0,        // NetLog doesn't reliably expose body size
      dur: 0,         // NetLog tick resolution not reliable per-request
      reqHdrs,
      hdrsMap,
      respHdrsMap,
      body: null,     // POST bodies not available in NetLog
      referer: hdrsMap['referer']||'',
      isMarker:false, markerType:null, txnName:null,
      txn:null, filtered:false,
      _fromNetLog: true
    });
  }

  // Sort by request start time so requests are in chronological order
  entries.sort((a,b)=>a._startTime-b._startTime);
  // Assign sequential IDs after sort
  entries.forEach((e,i)=>{ e.id=i+1; e.startMs=e._startTime||0; delete e._startTime; });
  return entries;
}

// ===========================================================================
// HAR / NETLOG PROCESSING
// ===========================================================================
function processHAR(har){
  S.entries=[]; S.txns=[]; S.colorMap={}; S.selIds.clear(); S.selMode=false;
  S.isNetLogSource=false; S.hasDpop=false;

  // Build page map for extension-recorded HARs (pageref id → transaction title)
  S.harPages = new Map();
  const _rPages = (har.log && har.log.pages) || [];
  for (const _p of _rPages) {
    if (_p.id && _p.title) S.harPages.set(_p.id, _p.title);
  }

  const raw = har.log && har.log.entries ? har.log.entries : [];
  let id=0;

  S.entries = raw.map(e=>{
    const resp = e.response || {};
    const hdrs={};
    (e.request.headers||[]).forEach(h=>{ hdrs[h.name.toLowerCase()]=h.value; });
    const respHdrs={};
    (resp.headers||[]).forEach(h=>{ respHdrs[h.name.toLowerCase()]=h.value; });
    const ct=((resp.content&&resp.content.mimeType)||'').split(';')[0].trim();
    return {
      id: ++id,
      url:   e.request.url||'',
      method: (e.request.method||'GET').toUpperCase(),
      status: resp.status||0,
      ct,
      size: resp.bodySize>0 ? resp.bodySize : (resp.content&&resp.content.size>0?resp.content.size:0),
      dur:  Math.round(e.time||0),
      startMs: (()=>{ try{return new Date(e.startedDateTime).getTime()||0;}catch{return 0;} })(),
      reqHdrs: e.request.headers||[],
      hdrsMap: hdrs,
      respHdrsMap: respHdrs,
      body: e.request.postData||null,
      referer: hdrs['referer']||'',
      _resourceType: e._resourceType||'',
      pageref: e.pageref||null,
      isMarker:false, markerType:null, txnName:null,
      txn:null, filtered:false
    };
  });

  detectMarkers();
  buildDomainStats();
  renderDomainPanel();
  applyFilters();
  buildScripts();
  renderTable();
  renderStats();
  showScript();
}

function processNetLog(netlog){
  S.entries=[]; S.txns=[]; S.colorMap={}; S.selIds.clear(); S.selMode=false;
  S.isNetLogSource=true; S.hasDpop=false;

  try {
    S.entries=parseNetLog(netlog);
  } catch(err){
    showToast('Could not parse NetLog file: '+err.message, 'error');
    return;
  }

  if(S.entries.length===0){
    showToast('No HTTP requests found in this NetLog file. Make sure you captured traffic with chrome://net-export/ while browsing.', 'error');
    return;
  }

  detectMarkers();
  buildDomainStats();
  renderDomainPanel();
  applyFilters();
  buildScripts();
  renderTable();
  renderStats();
  showScript();
}
