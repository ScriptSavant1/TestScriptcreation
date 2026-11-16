/* The HAR reading engine's transaction-marker detection, request classification and
 * filters (detectMarkers, _recInjectPagerefMarkers, _makeRecMarker, classifyHarEntry,
 * refresh, applyFilters). Used by the HAR Explorer (portal/har-explorer-model.js) with
 * VuGen-Recorder-state.js and VuGen-Recorder-parsers.js; Script Studio follows the same
 * rules through shared/request-filter.js. Kept unchanged from the Recorder tool, now part
 * of Script Studio (tests/unit/harExplorerModel.test.js, requestFilter.test.js). */
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
// The rules live in shared/request-filter.js (one rule set for the Recorder, Script Studio and the HAR Explorer —
// BUG-142); these names stay for the code that calls them.
function _recRules(){ return { STATIC_CT, STATIC_EXT, NOISY, NOISY_URL: typeof NOISY_URL!=='undefined'?NOISY_URL:null }; }
function recTypeKey(e){
  return RequestFilter.typeKey(e,_recRules());
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
  return RequestFilter.leftOut(e,{ rules:_recRules(), noise:f.noise, options:f.opts, typeOff:S.typeOff,
    domainOff:S.domainFilter, prefetchDup:S._prefetchDup });
}

// Prefetches of a page that the browser then opened (same URL, a later GET that is not a prefetch)
function recPrefetchDuplicates(entries){
  return RequestFilter.prefetchDuplicates(entries);
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

// (Kept here so the HAR Explorer repairs a recording exactly like Script Studio — BUG-113.)
// A transaction whose START is missing from the recording (an END without a START — the START bookmark fired
// before DevTools was recording) starts where the previous transaction ended, or at the beginning. Without this,
// VuGen got lr_end_transaction for a transaction never started and DevWeb dropped the transaction.
function _repairOrphanEnds() {
  var open = [], from = 0, added = 0;
  for (var i = 0; i < S.entries.length; i++) {
    var e = S.entries[i];
    if (!e.isMarker) continue;
    if (e.markerType === 'start') { open.push(e.txnName); from = i + 1; continue; }
    var k = open.lastIndexOf(e.txnName);
    if (k >= 0) { open.splice(k); from = i + 1; continue; }
    S.entries.splice(from, 0, _makeRecMarker('start', e.txnName));
    i++;
    for (var j = from + 1; j < i; j++) { var r = S.entries[j]; if (!r.isMarker && !r.txn) r.txn = e.txnName; }
    from = i + 1; added++;
  }
  if (!added) return 0;
  // transaction list (numbering SC01_01 …) in the order the transactions start
  var byName = {}, seen = {}, list = [];
  S.txns.forEach(function (t) { byName[t.name] = t; });
  S.entries.forEach(function (x) { if (x.isMarker && x.markerType === 'start' && !seen[x.txnName]) { seen[x.txnName] = 1; list.push(x.txnName); } });
  S.txns = list.map(function (n, ix) {
    var t = byName[n] || { name: n, color: COLORS[ix % COLORS.length] };
    S.colorMap[n] = t.color;
    return t;
  });
  return added;
}

function refresh(){
  applyFilters(); buildScripts(); renderTable(); renderStats(); showScript();
}
