/* Recorder engine functions that the classic page (VuGen-Recorder.html) keeps in
 * its inline script: transaction-marker detection, request classification and
 * filters. detectMarkers, _recInjectPagerefMarkers, _makeRecMarker,
 * classifyHarEntry and refresh are VERBATIM copies of VuGen-Recorder.html —
 * tests/unit/recorderCoreParity.test.js fails if they drift apart; change both
 * together. applyFilters is this page's own (type buttons instead of the
 * "Static assets" tick box — see below). */
// ===========================================================================
// TRANSACTION MARKER DETECTION
// ===========================================================================
function detectMarkers(){
  S.txns=[]; S.colorMap={};
  let cIdx=0;

  for(const e of S.entries){
    const url=e.url;
    // Match: https://START-TxnName.invalid  or  https://TxnName-START.invalid
    const sm = url.match(/\/\/START[-_]([^/.\s?]+)\.invalid/i)
            || url.match(/\/\/([^/.\s?]+)[-_]START\.invalid/i);
    const em = url.match(/\/\/END[-_]([^/.\s?]+)\.invalid/i)
            || url.match(/\/\/([^/.\s?]+)[-_]END\.invalid/i);

    if(sm){
      const name = sm[1].replace(/[-]/g,'_');
      e.isMarker=true; e.markerType='start'; e.txnName=name;
      if(!S.colorMap[name]){
        const c=COLORS[cIdx%COLORS.length]; cIdx++;
        S.colorMap[name]=c;
        S.txns.push({name,color:c});
      }
    } else if(em){
      const name = em[1].replace(/[-]/g,'_');
      e.isMarker=true; e.markerType='end'; e.txnName=name;
    }
  }

  // CDP Recorder pageref-based transactions: if no bookmarklet markers found
  // and the HAR has pages, inject synthetic start/end markers so generators
  // emit lr_start_transaction / lr_end_transaction with the correct names.
  if(S.txns.length===0 && S.harPages && S.harPages.size>0){
    _recInjectPagerefMarkers();
    cIdx=S.txns.length; // keep cIdx in sync for any future use
  }

  // Assign txn membership to entries between markers
  let active=null;
  for(const e of S.entries){
    if(e.isMarker){ active = e.markerType==='start' ? e.txnName : null; }
    else { e.txn=active; }
  }
}

function _recInjectPagerefMarkers(){
  const harPages=S.harPages;
  // Build ordered unique pagerefs, populate S.txns and S.colorMap
  const prSeen=new Set();
  let cIdx=0;
  for(const e of S.entries){
    if(e.isMarker||!e.pageref||!harPages.has(e.pageref)) continue;
    if(!prSeen.has(e.pageref)){
      prSeen.add(e.pageref);
      const name=harPages.get(e.pageref);
      const c=COLORS[cIdx%COLORS.length]; cIdx++;
      S.colorMap[name]=c;
      S.txns.push({name,color:c});
    }
  }
  if(prSeen.size===0) return;

  // Rebuild S.entries in one pass injecting start/end at pageref boundaries
  const result=[];
  let currentPr=null;
  for(const e of S.entries){
    const pr=e.isMarker?null:(e.pageref||null);
    if(pr!==currentPr){
      if(currentPr!==null&&harPages.has(currentPr))
        result.push(_makeRecMarker('end',harPages.get(currentPr)));
      if(pr!==null&&harPages.has(pr))
        result.push(_makeRecMarker('start',harPages.get(pr)));
      currentPr=pr;
    }
    result.push(e);
  }
  if(currentPr!==null&&harPages.has(currentPr))
    result.push(_makeRecMarker('end',harPages.get(currentPr)));

  // Replace S.entries in-place
  S.entries.length=0;
  for(const e of result) S.entries.push(e);
}

function _makeRecMarker(markerType,txnName){
  return{
    id:-1, url:'', method:'GET', status:0, ct:'', size:0, dur:0, startMs:0,
    reqHdrs:[], hdrsMap:{}, respHdrsMap:{}, body:null, referer:'',
    _resourceType:'', pageref:null,
    filtered:false, isMarker:true, markerType, txnName, txn:null
  };
}

// ===========================================================================
// FILTERS
// ===========================================================================
function classifyHarEntry(e){
  const rt=(e._resourceType||'').toLowerCase();
  if(rt==='fetch'||rt==='xhr') return 'fetch';
  if(rt==='document') return 'document';
  if(rt==='stylesheet') return 'stylesheet';
  if(rt==='script') return 'script';
  if(rt==='font') return 'font';
  if(rt==='image') return 'image';
  if(rt==='media') return 'media';
  if(rt==='manifest') return 'manifest';
  if(rt==='websocket') return 'websocket';
  if(rt&&rt!=='other'&&rt!=='') return rt;
  const ct=(e.ct||'').toLowerCase();
  if(/json|graphql|form-urlencoded|form-data|xml|text\/plain/.test(ct)||e.method==='POST'||e.method==='PUT'||e.method==='PATCH') return 'fetch';
  if(ct.startsWith('text/html')||ct.startsWith('application/xhtml')) return 'document';
  if(ct.startsWith('text/css')) return 'stylesheet';
  if(/javascript/.test(ct)) return 'script';
  if(ct.startsWith('font/')) return 'font';
  if(ct.startsWith('image/')) return 'image';
  if(ct.startsWith('audio/')||ct.startsWith('video/')) return 'media';
  const path=(e.url||'').split('?')[0].toLowerCase();
  if(/\.(css)$/.test(path)) return 'stylesheet';
  if(/\.(js)$/.test(path)) return 'script';
  if(/\.(woff2?|ttf|eot|otf)$/.test(path)) return 'font';
  if(/\.(png|jpe?g|gif|ico|svg|webp)$/.test(path)) return 'image';
  if(/\.(mp4|webm|mp3|ogg|wav)$/.test(path)) return 'media';
  return 'other';
}

// ---------------------------------------------------------------------------
// Request types ("In the script" buttons) and left-out reasons.
// Since the type buttons replaced the "Static assets" tick box, applyFilters()
// differs from the classic page on purpose; the other functions above are still
// verbatim copies.
// ---------------------------------------------------------------------------
const REC_TYPES=['document','fetch','script','stylesheet','image','font','media','other'];

// The type a request is counted under. A static file (the old "Static assets"
// rule: STATIC_CT / STATIC_EXT) is JS, CSS, Img or Font by its content, so turning
// those four off leaves out exactly what "Static assets" left out. A request the
// browser called a script / image … that is NOT a static file (JSONP, a pixel
// answering HTML) goes under Fetch/XHR or Other, which stay in the script.
function recTypeKey(e){
  const ct=(e.ct||'').toLowerCase();
  const path=(e.url||'').split('?')[0];
  if(STATIC_CT.has(e.ct)){
    if(ct==='text/css') return 'stylesheet';
    if(/javascript/.test(ct)) return 'script';
    if(ct.startsWith('image/')) return 'image';
    return 'font';
  }
  if(STATIC_EXT.test(path)){
    if(/\.css$/i.test(path)) return 'stylesheet';
    if(/\.(js\.map|map)$/i.test(path)) return 'script';
    if(/\.(woff2?|ttf|eot|otf)$/i.test(path)) return 'font';
    return 'image';
  }
  const c=classifyHarEntry(e);
  if(c==='stylesheet'||c==='script'||c==='image'||c==='font')
    return /json|xml|text\/plain|graphql|form-urlencoded/.test(ct)?'fetch':'other';
  return REC_TYPES.indexOf(c)>=0?c:'other';
}

function recFilterFlags(){
  return {
    noise:document.getElementById('f-noise')?.checked??true,
    opts:document.getElementById('f-opts')?.checked??true
  };
}

// Why a request is left out of the script — null when it is in the script.
// One rule set: applyFilters() and the request list both read it.
function recLeftOut(e,f){
  // CSP violation reports  -  browser auto-sends these when our bookmarklet
  // .invalid marker URLs are blocked by the app's Content Security Policy
  const reqCt=((e.hdrsMap||{})['content-type']||'').split(';')[0].trim().toLowerCase();
  if(reqCt==='application/csp-report'||reqCt==='application/reports+json') return 'report';
  if(e.body&&e.body.text&&e.body.text.includes('"blocked-uri"')) return 'report';
  // WebSocket upgrade requests  -  wss:// and ws:// cannot be replayed by VuGen
  // Web HTTP/HTML protocol; including them causes 400 Bad Request errors
  if(/^wss?:\/\//i.test(e.url)) return 'websocket';
  // data:, blob:, chrome-extension:, about: … — never a network request, cannot be replayed
  if(!/^https?:\/\//i.test(e.url)) return 'nonhttp';
  // A page the browser fetched in advance (speculation rules / <link rel=prefetch>) and then opened: the real
  // navigation is in the script, so the prefetch would load the page twice
  if(S._prefetchDup&&S._prefetchDup.has(e)) return 'prefetch';
  let host='';
  try{ host=new URL(e.url).hostname; }catch{}
  if(host&&S.domainFilter[host]===false) return 'domain';
  if(f.opts&&e.method==='OPTIONS') return 'options';
  if(f.noise&&host&&(NOISY.test(host)||(typeof NOISY_URL!=='undefined'&&NOISY_URL.test(e.url)))) return 'ads';
  if(S.typeOff&&S.typeOff.has(recTypeKey(e))) return 'type';
  return null;
}

// Prefetches of a page that the browser then opened (same URL, a later GET that is not a prefetch)
function recPrefetchDuplicates(entries){
  const dup=new Set(), isPf=e=>/prefetch|prerender/i.test(((e.hdrsMap||{})['sec-purpose']||(e.hdrsMap||{})['purpose']||''));
  const later=new Set();
  for(let i=entries.length-1;i>=0;i--){
    const e=entries[i];
    if(e.isMarker||(e.method||'GET')!=='GET') continue;
    if(isPf(e)){ if(later.has(e.url)) dup.add(e); }
    else later.add(e.url);
  }
  return dup;
}

function applyFilters(){
  const f=recFilterFlags();
  S._prefetchDup=recPrefetchDuplicates(S.entries);
  for(const e of S.entries){
    if(e.isMarker){e.filtered=false;e.leftOut=null;continue;}
    e.leftOut=recLeftOut(e,f);
    e.filtered=!!e.leftOut;
  }
}

function refresh(){
  applyFilters(); buildScripts(); renderTable(); renderStats(); showScript();
}
