/* Recorder engine functions that the classic page (VuGen-Recorder.html) keeps in
 * its inline script: transaction-marker detection, request classification and
 * filters. Copied VERBATIM from VuGen-Recorder.html so both pages run the same
 * logic — tests/unit/recorderCoreParity.test.js fails if the copies drift apart.
 * Change both together. */
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

function applyFilters(){
  const fSt=document.getElementById('f-static')?.checked??true;
  const fNo=document.getElementById('f-noise')?.checked??true;
  const fOp=document.getElementById('f-opts')?.checked??true;

  for(const e of S.entries){
    if(e.isMarker){e.filtered=false;continue;}
    // Filter CSP violation reports  -  browser auto-sends these when our bookmarklet
    // .invalid marker URLs are blocked by the app's Content Security Policy
    const reqCt=(e.hdrsMap['content-type']||'').split(';')[0].trim().toLowerCase();
    if(reqCt==='application/csp-report'||reqCt==='application/reports+json'){e.filtered=true;continue;}
    if(e.body&&e.body.text&&e.body.text.includes('"blocked-uri"')){e.filtered=true;continue;}
    // Filter WebSocket upgrade requests  -  wss:// and ws:// cannot be replayed by VuGen
    // Web HTTP/HTML protocol; including them causes 400 Bad Request errors
    if(/^wss?:\/\//i.test(e.url)){e.filtered=true;continue;}
    // data:, blob:, chrome-extension:, about: … — never a network request, cannot be replayed
    if(!/^https?:\/\//i.test(e.url)){e.filtered=true;continue;}
    // Domain filter (unchecked domains are excluded)
    try{
      const host=new URL(e.url).hostname;
      if(S.domainFilter[host]===false){e.filtered=true;continue;}
    }catch{}
    if(fOp && e.method==='OPTIONS'){e.filtered=true;continue;}
    if(fSt){
      if(STATIC_CT.has(e.ct)){e.filtered=true;continue;}
      if(STATIC_EXT.test(e.url.split('?')[0])){e.filtered=true;continue;}
    }
    if(fNo){
      try{ if(NOISY.test(new URL(e.url).hostname)){e.filtered=true;continue;} }catch{}
    }
    if(S.resourceTypeFilter&&S.resourceTypeFilter.size>0){
      if(!S.resourceTypeFilter.has(classifyHarEntry(e))){e.filtered=true;continue;}
    }
    e.filtered=false;
  }
}

function refresh(){
  applyFilters(); buildScripts(); renderTable(); renderStats(); showScript();
}
