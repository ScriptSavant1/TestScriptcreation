// ===========================================================================
// RENDER TABLE
// ===========================================================================
function renderTable(){
  let html='';
  for(const e of S.entries){
    if(e.isMarker){ html+=markerRow(e); continue; }
    html+=entryRow(e);
  }
  document.getElementById('tbody').innerHTML = html||'<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--muted)">No entries</td></tr>';
  applyCollapse();
  updateCollapseAllBtn();
}

// Toggle a single transaction group collapsed/expanded.
// row  -  the clicked .txn-start <tr> element (passed via onclick="toggleTxn(this)")
function toggleTxn(row){
  const name=row.dataset.grp;
  S.collapsed[name]=!S.collapsed[name];
  applyCollapse();
  updateCollapseAllBtn();
}

// Apply S.collapsed state to visible DOM rows.
// Walks tbody children: for each txn-start row, shows/hides all rows
// belonging to that group (requests + txn-end) based on S.collapsed.
function applyCollapse(){
  const tbody=document.getElementById('tbody');
  if(!tbody) return;
  let currentGrp=null;
  let collapsed=false;
  for(const row of tbody.rows){
    if(row.classList.contains('txn-start')){
      currentGrp=row.dataset.grp;
      collapsed=!!(S.collapsed[currentGrp]);
      // Update arrow
      const arrow=row.querySelector('.txn-arrow');
      if(arrow) arrow.textContent=collapsed?'>':'v';
      row.style.display='';
    } else if(row.classList.contains('txn-end')){
      row.style.display=collapsed?'none':'';
      currentGrp=null; collapsed=false;
    } else {
      // request row  -  hide if inside a collapsed group
      row.style.display=(currentGrp&&collapsed)?'none':'';
    }
  }
}

function collapseAll(){
  for(const t of S.txns) S.collapsed[t.name]=true;
  applyCollapse();
  updateCollapseAllBtn();
}

function expandAll(){
  S.collapsed={};
  applyCollapse();
  updateCollapseAllBtn();
}

function toggleCollapseAll(){
  const anyExpanded=S.txns.some(t=>!S.collapsed[t.name]);
  if(anyExpanded) collapseAll(); else expandAll();
}

function updateCollapseAllBtn(){
  const btn=document.getElementById('btn-collapse-all');
  if(!btn) return;
  btn.style.display=S.txns.length?'':'none';
  const anyExpanded=S.txns.some(t=>!S.collapsed[t.name]);
  btn.textContent=anyExpanded?'- Collapse All':'+ Expand All';
}

function markerRow(e){
  const c=S.colorMap[e.txnName]||COLORS[0];
  const border=e.markerType==='start'?'border-top':'border-bottom';
  if(e.markerType==='start'){
    const arrow=S.collapsed[e.txnName]?'>':'v';
    return `<tr class="txn-start" data-grp="${esc(e.txnName)}" style="background:${c.bg};${border}:2px solid ${c.bd};cursor:pointer;user-select:none" onclick="toggleTxn(this)">
      <td colspan="7" style="color:${c.tx};font-weight:700;font-size:11px;letter-spacing:.4px">
        <span class="txn-arrow" style="display:inline-block;width:14px;text-align:center">${arrow}</span> START: ${esc(e.txnName)}
      </td></tr>`;
  } else {
    return `<tr class="txn-end" data-grp="${esc(e.txnName)}" style="background:${c.bg};${border}:2px solid ${c.bd}">
      <td colspan="7" style="color:${c.tx};font-weight:700;font-size:11px;letter-spacing:.4px">
        <span style="display:inline-block;width:14px;text-align:center">#</span> END: ${esc(e.txnName)}
      </td></tr>`;
  }
}

function entryRow(e){
  const mc='m-'+(['GET','POST','PUT','DELETE','PATCH'].includes(e.method)?e.method:'X');
  let sc='s0';
  if(e.status>=200&&e.status<300)sc='s2';
  else if(e.status>=300&&e.status<400)sc='s3';
  else if(e.status>=400&&e.status<500)sc='s4';
  else if(e.status>=500)sc='s5';

  const shortCt=e.ct.replace(/application\//,'').replace(/text\//,'')
    .replace('json','JSON').replace('html','HTML').replace('xml','XML')
    .replace('javascript','JS').replace('x-www-form-urlencoded','Form').substring(0,14);

  const c=e.txn&&S.colorMap[e.txn]?S.colorMap[e.txn]:null;
  const rowBg=c&&!e.filtered?`background:${c.bg}30`:'';
  const dim=e.filtered?'row-dim':'';
  const sel=S.selIds.has(e.id)?'row-sel':'';
  const selable=S.selMode&&!e.filtered?'selectable':'';

  const urlShort=e.url.length>75?e.url.substring(0,75)+'...':e.url;

  return `<tr id="r${e.id}" class="${dim} ${sel} ${selable}" data-grp="${esc(e.txn||'')}"
    style="${rowBg}" onclick="rowClick(${e.id})" title="${esc(e.url)}">
    <td style="color:var(--muted)">${e.id}</td>
    <td><span class="m ${mc}">${e.method}</span></td>
    <td class="url-cell">${esc(urlShort)}</td>
    <td><span class="s ${sc}">${e.status||'-'}</span></td>
    <td style="color:var(--muted);font-size:11px">${esc(shortCt)}</td>
    <td style="color:var(--muted)">${fmtSize(e.size)}</td>
    <td style="color:var(--muted)">${e.dur>0?e.dur+'ms':'-'}</td>
  </tr>`;
}

function renderStats(){
  const total=S.entries.filter(e=>!e.isMarker).length;
  const shown=S.entries.filter(e=>!e.isMarker&&!e.filtered).length;
  const tc=S.txns.length;
  document.getElementById('stats').textContent=
    `${shown}/${total} requests  |  ${tc} transaction${tc!==1?'s':''}`;
  // Show/hide NetLog warning banner
  document.getElementById('netlog-banner').classList.toggle('hidden', !S.isNetLogSource);
  // Show/hide auth badge
  const authBadge=document.getElementById('auth-badge');
  if(S.auth){
    const AUTH_BADGE_LABELS={kerberos:'&#x1F512; Kerberos',ntlm:'&#x1F512; NTLM',negotiate:'&#x1F512; Negotiate',basic:'&#x1F512; Basic Auth',digest:'&#x1F512; Digest Auth',bearer:'&#x1F511; Bearer Token',saml:'&#x1F511; SAML'};
    authBadge.innerHTML=AUTH_BADGE_LABELS[S.auth.type]||'&#x1F512; Auth';
    authBadge.style.display='';
  } else {
    authBadge.style.display='none';
  }
}

// ===========================================================================
// SCRIPT PREVIEW
// ===========================================================================
function switchTab(el,tab){
  document.querySelectorAll('.code-tab').forEach(t=>t.classList.remove('act'));
  el.classList.add('act');
  var titleEl = document.getElementById('code-panel-title');
  if(titleEl) titleEl.textContent = el.textContent || tab;
  S.tab=tab; showScript();
}
function showScript(){
  document.getElementById('code-body').textContent =
    S.scripts[S.tab]||'// No content  -  load a HAR file first';
}

// ===========================================================================
// DOWNLOAD
// ===========================================================================
function dl(key){
  const c=S.scripts[key];
  if(!c){showToast('Load a HAR file first.', 'warning');return;}
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([c],{type:'text/plain'}));
  a.download=FILE_NAMES[key]; a.click();
}

// ===========================================================================
// SELECT MODE  -  MANUAL TRANSACTION CREATION
// ===========================================================================
function toggleSelMode(){
  S.selMode=!S.selMode;
  const btn=document.getElementById('btn-sel');
  const bar=document.getElementById('sel-bar');
  if(S.selMode){
    btn.style.cssText='background:var(--primary-bg);color:var(--primary);font-weight:700';
    bar.style.display='flex';
  } else {
    btn.style.cssText=''; clearSel();
    bar.style.display='none';
  }
  renderTable();
}

function rowClick(id){
  if(!S.selMode) return;
  const e=S.entries.find(x=>x.id===id);
  if(!e||e.filtered||e.isMarker) return;
  if(S.selIds.has(id)) S.selIds.delete(id);
  else S.selIds.add(id);
  const row=document.getElementById('r'+id);
  if(row) row.classList.toggle('row-sel',S.selIds.has(id));
  document.getElementById('sel-cnt').textContent=`${S.selIds.size} selected`;
}

function clearSel(){
  S.selIds.clear();
  document.querySelectorAll('.row-sel').forEach(r=>r.classList.remove('row-sel'));
  document.getElementById('sel-cnt').textContent='0 selected';
}

function openTxnModal(){
  if(S.selIds.size===0){showToast('Click rows to select them first.', 'warning');return;}
  document.getElementById('modal-bg').classList.remove('hidden');
  const inp=document.getElementById('txn-inp');
  inp.value=`T${String(S.txns.length+1).padStart(2,'0')}_`;
  setTimeout(()=>inp.focus(),50);
}

function closeModal(){ document.getElementById('modal-bg').classList.add('hidden'); }

function confirmTxn(){
  const name=document.getElementById('txn-inp').value.trim();
  if(!name){showToast('Enter a transaction name.', 'warning');return;}
  if(!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)){
    showToast('Name must start with a letter and contain only letters, numbers, underscores.', 'error');return;
  }
  closeModal();

  // Sort selected IDs in original order
  const ids=Array.from(S.selIds).sort((a,b)=>a-b);
  const firstIdx=S.entries.findIndex(e=>e.id===ids[0]);
  const lastIdx =S.entries.findIndex(e=>e.id===ids[ids.length-1]);

  const c=COLORS[S.txns.length%COLORS.length];
  S.txns.push({name,color:c});
  S.colorMap[name]=c;

  const mk=(type)=>({id:-Date.now()-Math.random(),url:'',method:'',status:0,ct:'',
    size:0,dur:0,reqHdrs:[],hdrsMap:{},body:null,referer:'',
    isMarker:true,markerType:type,txnName:name,filtered:false,txn:null});

  // Insert END marker after last, START marker before first
  S.entries.splice(lastIdx+1, 0, mk('end'));
  S.entries.splice(firstIdx, 0, mk('start'));

  // Mark entries as belonging to this transaction
  for(const e of S.entries){ if(ids.includes(e.id)) e.txn=name; }

  S.selMode=false;
  document.getElementById('btn-sel').style.cssText='';
  document.getElementById('sel-bar').style.display='none';
  clearSel();
  buildScripts(); renderTable(); renderStats(); showScript();
}

// ===========================================================================
// DOMAIN FILTER PANEL
// ===========================================================================
function buildDomainStats(){
  S.domainStats={};
  for(const e of S.entries){
    if(e.isMarker) continue;
    try{
      const host=new URL(e.url).hostname;
      if(!S.domainStats[host]) S.domainStats[host]={count:0,size:0};
      S.domainStats[host].count++;
      S.domainStats[host].size+=(e.size||0);
      if(S.domainFilter[host]===undefined) S.domainFilter[host]=true; // default: include
    }catch{}
  }
  // Clean up stale entries from a previous HAR
  const valid=new Set(Object.keys(S.domainStats));
  Object.keys(S.domainFilter).forEach(d=>{ if(!valid.has(d)) delete S.domainFilter[d]; });
}

function renderDomainPanel(search=''){
  const q=(search||'').trim().toLowerCase();
  // Sort: unchecked first? No  -  sort by request count desc (most requests at top, like VuGen)
  const domains=Object.keys(S.domainStats)
    .filter(d=>!q||d.includes(q))
    .sort((a,b)=>S.domainStats[b].count-S.domainStats[a].count);

  // Update header title
  const total=Object.keys(S.domainStats).length;
  const active=Object.values(S.domainFilter).filter(Boolean).length;
  document.getElementById('dp-title').textContent=
    `Domains (${active}/${total})`;

  if(!domains.length){
    document.getElementById('dp-list').innerHTML=
      `<div class="dp-empty">${q?'No match':'No domains'}</div>`;
    return;
  }

  let html='';
  for(const d of domains){
    const st=S.domainStats[d];
    const on=S.domainFilter[d]!==false;
    const dEsc=d.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    html+=`<div class="dp-row${on?'':' dm-off'}" title="${d}" onclick="onDpClick(event,'${dEsc}')">
      <input type="checkbox" ${on?'checked':''} onclick="event.stopPropagation();toggleDomain('${dEsc}',this.checked)">
      <span class="dp-domain">${d}</span>
      <span class="dp-meta">${st.count}req<br>${fmtSize(st.size)}</span>
    </div>`;
  }
  document.getElementById('dp-list').innerHTML=html;
}

// Called when user clicks the row div (not the checkbox directly)
function onDpClick(event, domain){
  const chk=event.currentTarget.querySelector('input[type=checkbox]');
  const newState=!chk.checked;
  chk.checked=newState;
  toggleDomain(domain, newState);
}

function toggleDomain(domain, state){
  S.domainFilter[domain]=state;
  const q=document.querySelector('.dp-search')?.value||'';
  renderDomainPanel(q);
  applyFilters(); buildScripts(); renderTable(); renderStats(); showScript();
}

function toggleAllDomains(state){
  Object.keys(S.domainFilter).forEach(d=>S.domainFilter[d]=state);
  renderDomainPanel(document.querySelector('.dp-search')?.value||'');
  applyFilters(); buildScripts(); renderTable(); renderStats(); showScript();
}

// ===========================================================================
// FORMAT PICKER
// ===========================================================================
function openFmtModal(fromToolbar){
  // Show/hide Cancel button  -  only useful when already in main panel
  document.getElementById('fmt-cancel-btn').classList.toggle('hidden', !fromToolbar);
  // Highlight current selection
  ['webhttp','devweb','both'].forEach(f=>{
    document.getElementById('fc-'+f).classList.toggle('selected', f===S.format);
  });
  document.getElementById('fmt-modal-bg').classList.remove('hidden');
}

function selectFmt(fmt){
  S.format=fmt;
  ['webhttp','devweb','both'].forEach(f=>{
    document.getElementById('fc-'+f).classList.toggle('selected', f===fmt);
  });
}

function closeFmtModal(){
  document.getElementById('fmt-modal-bg').classList.add('hidden');
}

function confirmFmt(){
  closeFmtModal();
  if(S.pendingNetLog){
    processNetLog(S.pendingNetLog);
  } else {
    processHAR(S.pendingHar);
  }
  document.getElementById('welcome').classList.add('hidden');
  document.getElementById('main').classList.remove('hidden');
  applyFmtUI();
}

function applyFmtUI(){
  const isWeb=S.format==='webhttp'||S.format==='both';
  const isDev=S.format==='devweb' ||S.format==='both';

  // Show/hide code tabs
  document.querySelector('[data-tab="ac"]').classList.toggle('hidden',!isWeb);
  document.querySelector('[data-tab="vi"]').classList.toggle('hidden',!isWeb);
  document.querySelector('[data-tab="ve"]').classList.toggle('hidden',!isWeb);
  document.querySelector('[data-tab="gh"]').classList.toggle('hidden',!isWeb);
  document.querySelector('[data-tab="mj"]').classList.toggle('hidden',!isDev);

  // Show/hide download bar sections
  document.getElementById('dl-webhttp').classList.toggle('hidden',!isWeb);
  document.getElementById('dl-devweb').classList.toggle('hidden',!isDev);
  document.getElementById('dl-sep').classList.toggle('hidden',!(isWeb&&isDev));

  // Update format badge
  const labels={webhttp:'🌐 Web HTTP/HTML', devweb:'⚡ DevWeb', both:'🌐+⚡ Both Formats'};
  document.getElementById('fmt-badge').textContent=labels[S.format]||'';

  // Activate the best default tab
  if(isDev && !isWeb){
    const el=document.querySelector('[data-tab="mj"]');
    switchTab(el,'mj');
  } else {
    const el=document.querySelector('[data-tab="ac"]');
    switchTab(el,'ac');
  }
}

// ===========================================================================
// NAVIGATION
// ===========================================================================
function showWelcome(){
  document.getElementById('welcome').classList.remove('hidden');
  document.getElementById('main').classList.add('hidden');
}
function clearAll(){
  if(S.entries.length>0 && !confirm('Clear all data?')) return;
  S.entries=[]; S.txns=[]; S.colorMap={}; S.selIds.clear(); S.scripts={}; S.pendingHar=null; S.pendingNetLog=null; S.isNetLogSource=false; S.domainFilter={}; S.domainStats={}; S.auth=null; S.serverHost=null;
  document.getElementById('tbody').innerHTML='';
  document.getElementById('stats').textContent='';
  document.getElementById('auth-badge').style.display='none';
  document.getElementById('code-body').textContent='// Load a HAR file to generate scripts';
  document.getElementById('hf').value='';
  document.getElementById('dp-list').innerHTML='<div class="dp-empty">Load a HAR file</div>';
  document.getElementById('dp-title').textContent='Domains';
  showWelcome();
}

// ===========================================================================
// UTILITIES
// ===========================================================================
function esc(s){ return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escJs(s){ return(s||'').replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,'\\n').replace(/\r/g,'\\r').replace(/\t/g,'\\t'); }
function escTpl(s){ return(s||'').replace(/\\/g,'\\\\').replace(/`/g,'\\`').replace(/\$\{/g,'\\${'); }
// Build hostname→variable map by scanning all scripted request header values for URLs
function buildHdrHostMap(entries,primaryHost){
  const map={};
  if(primaryHost) map[primaryHost]='SERVER_HOST';
  const seen=new Set(primaryHost?[primaryHost]:[]);
  const extra=[];
  for(const e of(entries||[])){
    if(e.filtered||e.isMarker) continue;
    for(const h of(e.reqHdrs||[])){
      let m,re=/https?:\/\/([^/\s?#:]+)(?::[0-9]+)?/g;
      while((m=re.exec(h.value||''))!==null){
        if(!seen.has(m[1])){seen.add(m[1]);extra.push(m[1]);}
      }
    }
  }
  extra.forEach((hh,i)=>{map[hh]='SERVER_HOST'+(i+1);});
  return map;
}
// Substitute known hostnames in a header string value — DevWeb (backtick template literal)
function subHdrValMj(val,hostVarMap){
  let r=val,ch=false;
  for(const[_h,_v]of Object.entries(hostVarMap).sort((a,b)=>b[0].length-a[0].length)){
    if(!_h) continue;
    const esc=_h.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    // Raw URL form: https://hostname/path
    const n=r.replace(new RegExp('(https?://)'+esc+'(:[0-9]+)?(?=[/?#\\s"\'`]|$)','g'),'$1\x00HDRH_'+_v+'\x00$2');
    if(n!==r){ch=true;r=n;}
    // URL-encoded form: https%3A%2F%2Fhostname (common in redirect_uri= POST body params)
    const n2=r.replace(new RegExp('(https?%3A%2F%2F)'+esc+'(?=%2F|%3F|%23|&|\\s|$)','gi'),'$1\x00HDRH_'+_v+'\x00');
    if(n2!==r){ch=true;r=n2;}
  }
  if(!ch) return'"'+escJs(val)+'"';
  return'`'+escTpl(r).replace(/\x00HDRH_([^\x00]+)\x00/g,'${$1}')+'`';
}
// Apply hostname substitution to raw text, returning text with \x00HDRH_VAR\x00 placeholders (for body/backtick emission)
function subRawMj(text,hostVarMap){
  let r=text,ch=false;
  for(const[_h,_v]of Object.entries(hostVarMap).sort((a,b)=>b[0].length-a[0].length)){
    if(!_h) continue;
    const esc=_h.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const n=r.replace(new RegExp('(https?://)'+esc+'(:[0-9]+)?(?=[/?#\\s"\'`]|$)','g'),'$1\x00HDRH_'+_v+'\x00$2');
    if(n!==r){ch=true;r=n;}
    const n2=r.replace(new RegExp('(https?%3A%2F%2F)'+esc+'(?=%2F|%3F|%23|&|\\s|$)','gi'),'$1\x00HDRH_'+_v+'\x00');
    if(n2!==r){ch=true;r=n2;}
  }
  return{text:r,changed:ch};
}
// Substitute known hostnames in a header string value — Web HTTP/HTML C ({LrParam} notation)
function subHdrValC(val,hostVarMap){
  let r=val;
  for(const[_h,_v]of Object.entries(hostVarMap).sort((a,b)=>b[0].length-a[0].length)){
    if(!_h) continue;
    const esc=_h.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const lrP=_v==='SERVER_HOST'?'ServerHost':'ServerHost'+_v.replace('SERVER_HOST','');
    // Raw URL form: https://hostname/path
    r=r.replace(new RegExp('(https?://)'+esc+'(:[0-9]+)?(?=[/?#\\s"\'`]|$)','g'),'$1{'+lrP+'}$2');
    // URL-encoded form: https%3A%2F%2Fhostname (common in redirect_uri= POST body params)
    r=r.replace(new RegExp('(https?%3A%2F%2F)'+esc+'(?=%2F|%3F|%23|&|\\s|$)','gi'),'$1{'+lrP+'}');
  }
  return r;
}
// Returns true if body text requires BodyBinary= (non-printable chars outside \t \n \r range)
function needsBinary(text){
  for(let i=0;i<text.length;i++){
    const c=text.charCodeAt(i);
    if(c>126) return true;
    if(c<32&&c!==9&&c!==10&&c!==13) return true;
  }
  return false;
}
// Escape body for BodyBinary=  -  encodes as C string safe for VuGen's attribute parser.
// Non-ASCII chars are emitted as UTF-8 bytes using \xHH sequences.
function escBodyBinary(text){
  let out='';
  for(let i=0;i<text.length;i++){
    const c=text.charCodeAt(i);
    if(c===34)       out+='\\"';
    else if(c===92)  out+='\\\\';
    else if(c===9)   out+='\\t';
    else if(c===10)  out+='\\n';
    else if(c===13)  out+='\\r';
    else if(c<32)    out+='\\x'+c.toString(16).padStart(2,'0').toUpperCase();
    else if(c<127)   out+=text[i];
    else if(c<0x800){
      out+='\\x'+(0xC0|(c>>6)).toString(16).toUpperCase().padStart(2,'0');
      out+='\\x'+(0x80|(c&0x3F)).toString(16).toUpperCase().padStart(2,'0');
    } else if(c>=0xD800&&c<=0xDBFF&&i+1<text.length){
      const lo=text.charCodeAt(i+1);
      if(lo>=0xDC00&&lo<=0xDFFF){
        const cp=0x10000+((c-0xD800)<<10)+(lo-0xDC00);
        out+='\\x'+(0xF0|(cp>>18)).toString(16).toUpperCase().padStart(2,'0');
        out+='\\x'+(0x80|((cp>>12)&0x3F)).toString(16).toUpperCase().padStart(2,'0');
        out+='\\x'+(0x80|((cp>>6)&0x3F)).toString(16).toUpperCase().padStart(2,'0');
        out+='\\x'+(0x80|(cp&0x3F)).toString(16).toUpperCase().padStart(2,'0');
        i++;
      }
    } else {
      out+='\\x'+(0xE0|(c>>12)).toString(16).toUpperCase().padStart(2,'0');
      out+='\\x'+(0x80|((c>>6)&0x3F)).toString(16).toUpperCase().padStart(2,'0');
      out+='\\x'+(0x80|(c&0x3F)).toString(16).toUpperCase().padStart(2,'0');
    }
  }
  return out;
}
function fmtSize(b){
  if(!b||b<=0) return '-';
  if(b<1024) return b+'B';
  if(b<1048576) return(b/1024).toFixed(1)+'KB';
  return(b/1048576).toFixed(1)+'MB';
}

// ===========================================================================
// RESIZABLE PANELS
// ===========================================================================
function setupResizer(rsId, side){
  const rs=document.getElementById(rsId);
  if(!rs) return;
  rs.addEventListener('mousedown',function(e){
    e.preventDefault();
    // side='left'  -> resize the pane to the LEFT of this resizer (domain-pane)
    // side='right' -> resize the pane to the RIGHT of this resizer (code-pane)
    const pane = side==='left' ? rs.previousElementSibling : rs.nextElementSibling;
    const startX=e.clientX;
    const startW=pane.getBoundingClientRect().width;
    rs.classList.add('rs-active');
    document.body.style.cursor='col-resize';
    document.body.style.userSelect='none';

    function onMove(mv){
      const dx=mv.clientX-startX;
      let newW;
      if(side==='left'){
        newW=Math.max(120, Math.min(420, startW+dx));
      } else {
        // dragging right resizer left -> code-pane grows; right -> shrinks
        newW=Math.max(220, Math.min(900, startW-dx));
      }
      pane.style.width=newW+'px';
      pane.style.flex='none';
    }
    function onUp(){
      rs.classList.remove('rs-active');
      document.body.style.cursor='';
      document.body.style.userSelect='';
      document.removeEventListener('mousemove',onMove);
      document.removeEventListener('mouseup',onUp);
    }
    document.addEventListener('mousemove',onMove);
    document.addEventListener('mouseup',onUp);
  });
}
