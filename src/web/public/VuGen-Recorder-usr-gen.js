// ===========================================================================
// ZIP PROJECT GENERATORS
// ===========================================================================
function genUsrFile(scriptName, paramFile=''){
  const txnNames = S.txns.map(t=>t.name);
  const orderLine = txnNames.length
    ? `[TransactionsOrder]\nOrder="${txnNames.join('__*delimiter*__')}"\n` : '';
  const txnLines = txnNames.length
    ? '[Transactions]\n' + txnNames.map(n=>`${n}=`).join('\n') + '\n' : '[Transactions]\n';
  return `[General]
Type=Multi
DefaultCfg=default.cfg
ParameterFile=${paramFile}
GlobalParameterFile=
NewFunctionHeader=1
RunType=cci
ActionLogicExt=action_logic
LastActiveAction=Action
MajorVersion=25
MinorVersion=3
ActiveTypes=QTWeb
GenerateTypes=QTWeb
AdditionalTypes=QTWeb
DevelopTool=Vugen
LastModifyVer=25.3.0.0
DFERebrandFlag=Done
ParamLeftBrace={
ParamRightBrace=}
ScriptLanguage=C
LastCodeGenerationVer=25.3.0.0
DisableRegenerate=0
Encoding=ANSI
Description=
ScriptLocale=en-US
[Actions]
vuser_init=vuser_init.c
Action=Action.c
vuser_end=vuser_end.c
[RunLogicFiles]
Default Profile=default.usp
[VuserProfiles]
Profiles=Default Profile
[CfgFiles]
Default Profile=default.cfg
[ExtraFiles]
globals.h=
[Modified Actions]
vuser_init=0
Action=1
vuser_end=0
[Recorded Actions]
vuser_init=0
Action=1
vuser_end=0
[Replayed Actions]
vuser_init=0
Action=0
vuser_end=0
[Interpreters]
vuser_init=cci
Action=cci
vuser_end=cci
${orderLine}[StateManagement]
LastReplayStatus=0
[ActiveReplay]
LastReplayedRunName=
ActiveRunName=
${txnLines}${S.hasDpop?'[ManuallyExtraFiles]\nlre-utils.dat=\n':''}`;
}

function genScriptUploadMetadata(scriptName){
  return `<?xml version="1.0" encoding="utf-8"?>
<VugenScriptMetadata>
  <ScriptName>${scriptName}</ScriptName>
  <Protocol>Web - HTTP/HTML</Protocol>
  <ActionFiles>
    <FileEntry Name="vuser_init.c" Filter="2" />
    <FileEntry Name="Action.c" Filter="2" />
    <FileEntry Name="vuser_end.c" Filter="2" />
  </ActionFiles>
  <GeneralFiles>
    <FileEntry Name="${scriptName}.usr" Filter="4" />
    <FileEntry Name="default.cfg" Filter="4" />
    <FileEntry Name="default.usp" Filter="4" />
    <FileEntry Name="globals.h" Filter="2" />
    <FileEntry Name="Bookmarks.xml" Filter="1" />
    <FileEntry Name="Breakpoints.xml" Filter="1" />
    <FileEntry Name="custom_body_variables.txt" Filter="1" />
    <FileEntry Name="lrw_custom_body.h" Filter="1" />
    <FileEntry Name="ScriptUploadMetadata.xml" Filter="1" />
  ${S.hasDpop?'    <FileEntry Name="lre-utils.dat" Filter="2" />\n' : ''} </GeneralFiles>
</VugenScriptMetadata>`;
}

function genDevWebUsrFile(scriptName, paramFile=''){
  const txnNames = S.txns.map(t=>t.name);
  const orderVal = txnNames.join('__*delimiter*__');
  return `[General]
Type=DevWeb
DefaultCfg=default.cfg
MajorVersion=25
MinorVersion=3
ParameterFile=${paramFile}
GlobalParameterFile=
RunType=DevWeb
NewFunctionHeader=1
ActionLogicExt=action_logic
LastActiveAction=Main
ScriptLanguage=JavaScript
Encoding=UTF8
DevelopTool=Vugen
LastModifyVer=25.3.0.0
ActiveTypes=DevWeb
AdditionalTypes=DevWeb
GenerateTypes=DevWeb
ParamLeftBrace={
ParamRightBrace=}
LastCodeGenerationVer=
DisableRegenerate=0
Description=
ScriptLocale=en-US
[ExtraFiles]
parameters.yml=
rts.yml=
[Actions]
Main=main.js
[Recorded Actions]
Main=0
[Interpreters]
Main=DevWeb
[RunLogicFiles]
Default Profile=default.usp
[Modified Actions]
Main=0
[Replayed Actions]
Main=0
[TransactionsOrder]
Order=${orderVal}
[StateManagement]
LastReplayStatus=0
[ActiveReplay]
LastReplayedRunName=
ActiveRunName=
${S.hasDpop?'\n[ManuallyExtraFiles]\ndpop-helper.js=\n':''}`;
}

function genDevWebScriptUploadMetadata(scriptName){
  return `<?xml version="1.0" encoding="utf-8"?>
<VugenScriptMetadata>
  <ScriptName>${scriptName}</ScriptName>
  <Protocol>DevWeb</Protocol>
  <ActionFiles>
    <FileEntry Name="main.js" Filter="2" />
  </ActionFiles>
  <GeneralFiles>
    <FileEntry Name="${scriptName}.usr" Filter="4" />
    <FileEntry Name="default.cfg" Filter="4" />
    <FileEntry Name="default.usp" Filter="4" />
    <FileEntry Name="parameters.yml" Filter="2" />
    <FileEntry Name="rts.yml" Filter="2" />
    <FileEntry Name="Action.c" Filter="1" />
    <FileEntry Name="Bookmarks.xml" Filter="1" />
    <FileEntry Name="Breakpoints.xml" Filter="1" />
    <FileEntry Name="DevWebSdk.d.ts" Filter="1" />
    <FileEntry Name="tsconfig.json" Filter="1" />
    <FileEntry Name="UserTasks.xml" Filter="1" />
    <FileEntry Name="vuser_end.c" Filter="1" />
    <FileEntry Name="vuser_init.c" Filter="1" />
    <FileEntry Name="ScriptUploadMetadata.xml" Filter="1" />
  ${S.hasDpop?'    <FileEntry Name="dpop-helper.js" Filter="2" />\n' : ''} </GeneralFiles>
</VugenScriptMetadata>`;
}

async function dlZip(format){
  if(!S.scripts.ac&&!S.scripts.mj){showToast('Load a HAR file first.', 'warning');return;}
  if(typeof JSZip==='undefined'){showToast('JSZip library not loaded. Check your internet connection and reload the page.', 'error');return;}
  const fmt=format||S.format;
  const isWeb=fmt==='webhttp'||fmt==='both';
  const isDev=fmt==='devweb' ||fmt==='both';

  async function makeWebHttpZip(){
    const name='WebHttpScript';
    const zip=new JSZip();
    // Auth params
    const _acAuth=S.auth&&['kerberos','ntlm','negotiate','basic','digest'].includes(S.auth.type);
    const _acWin=S.auth&&['kerberos','ntlm','negotiate'].includes(S.auth.type);
    const _acKeys=_acAuth?(_acWin?['username','password','domain']:['username','password']):[];
    const _acVals=_acAuth?(_acWin?['<enter_username>','<enter_password>','<enter_domain>']:['<enter_username>','<enter_password>']):[];
    let _acPrmFile='';
    if(_acKeys.length){
      let prm='';
      _acKeys.forEach((k,i)=>{prm+=`[parameter:${k}]\nColumnName="${k}"\nDelimiter=","\nGenerateNewVal="EachIteration"\nOriginalValue="${_acVals[i]}"\nOutOfRangePolicy="ContinueWithLast"\nParamName="${k}"\nSelectNextRow="Sequential"\nStartRow="1"\nTable="collection_data.dat"\nTableLocation="Local"\nType="Table"\nauto_allocate_block_size="1"\nvalue_for_each_vuser=""\n\n`;});
      zip.file('ParameterFile.prm', prm);
      zip.file('collection_data.dat', _acKeys.join(',')+'\n'+_acVals.join(',')+'\n');
      _acPrmFile='ParameterFile.prm';
    }
    zip.file('Action.c',         S.scripts.ac||'');
    zip.file('vuser_init.c',     S.scripts.vi||'');
    zip.file('vuser_end.c',      S.scripts.ve||'');
    zip.file('globals.h',        S.scripts.gh||'');
    zip.file('default.cfg',      genDefaultCfg(S.auth));
    zip.file('default.usp',      WEB_DEFAULT_USP);
    zip.file(name+'.usr',        genUsrFile(name, _acPrmFile));
    zip.file('ScriptUploadMetadata.xml', genScriptUploadMetadata(name));
    zip.file('lrw_custom_body.h',        LRW_CUSTOM_BODY_H);
    zip.file('custom_body_variables.txt',CUSTOM_BODY_VARIABLES_TXT);
    zip.file('Bookmarks.xml',   '<?xml version="1.0" encoding="utf-8"?><Bookmarks />');
    zip.file('Breakpoints.xml', '<BreakpointsRoot Version="1" />');
    // DPoP helper for VuGen (lre-utils.dat - unified DPoP + JWT crypto)
    if(S.hasDpop){
      try{ const _bp=window.location.pathname.replace(/\/[^\/]*$/,''); let r=await fetch(_bp+'/lre-utils-helper.js'); if(!r.ok) r=await fetch('/lre-utils-helper.js'); if(r.ok) zip.file('lre-utils.dat', await r.text()); }catch{}
    }
    const blob=await zip.generateAsync({type:'blob', mimeType:'application/zip'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=name+'.zip'; a.click();
  }

  async function makeDevWebZip(){
    const name='DevWebScript';
    const zip=new JSZip();
    // Auth params
    const _dvAuth=S.auth&&['kerberos','ntlm','negotiate','basic','digest'].includes(S.auth.type);
    const _dvWin=S.auth&&['kerberos','ntlm','negotiate'].includes(S.auth.type);
    const _dvKeys=_dvAuth?(_dvWin?['username','password','domain']:['username','password']):[];
    const _dvVals=_dvAuth?(_dvWin?['<enter_username>','<enter_password>','<enter_domain>']:['<enter_username>','<enter_password>']):[];
    let _dvPrmsYml='parameters: []\n';
    let _dvCsv='';
    let _dvPrmFile='';
    if(_dvKeys.length){
      _dvPrmsYml='parameters:\n'+_dvKeys.map(k=>`  - name: ${k}\n    type: csv\n    fileName: collection_data.csv\n    columnName: ${k}\n    nextValue: iteration\n    nextRow: sequential\n    onEnd: loop\n`).join('');
      _dvCsv=_dvKeys.join(',')+'\n'+_dvVals.join(',')+'\n';
      _dvPrmFile='parameters.yml';
    }
    zip.file('main.js',        S.scripts.mj||'');
    zip.file('rts.yml',        genRtsYml(S.auth));
    zip.file('scenario.yml',   DEVWEB_SCENARIO_YML);
    zip.file('tsconfig.json',  DEVWEB_TSCONFIG_JSON);
    zip.file('default.cfg',    DEVWEB_DEFAULT_CFG);
    zip.file('default.usp',    DEVWEB_DEFAULT_USP);
    zip.file(name+'.usr',      genDevWebUsrFile(name, _dvPrmFile));
    zip.file('ScriptUploadMetadata.xml', genDevWebScriptUploadMetadata(name));
    zip.file('Action.c',       'Action()\n{\n\treturn 0;\n}\n');
    zip.file('vuser_init.c',   'vuser_init()\n{\n\treturn 0;\n}\n');
    zip.file('vuser_end.c',    'vuser_end()\n{\n\treturn 0;\n}\n');
    zip.file('Bookmarks.xml',  '<?xml version="1.0" encoding="utf-8"?><Bookmarks />');
    zip.file('Breakpoints.xml','<BreakpointsRoot Version="1" />');
    zip.file('UserTasks.xml',  '<?xml version="1.0" encoding="utf-8"?>\n<App Name="Virtual User Generator">\n  <Tasks />\n</App>');
    zip.file('parameters.yml', _dvPrmsYml);
    if(_dvCsv) zip.file('collection_data.csv', _dvCsv);
    zip.file('DevWebSdk.d.ts', DEVWEB_SDK_DTS);
    // DPoP helper for DevWeb (dpop-helper.js)
    if(S.hasDpop){
      try{ const _bp=window.location.pathname.replace(/\/[^\/]*$/,''); let r=await fetch(_bp+'/dpop-helper.js'); if(!r.ok) r=await fetch('/dpop-helper.js'); if(r.ok) zip.file('dpop-helper.js', await r.text()); }catch{}
    }
    const blob=await zip.generateAsync({type:'blob', mimeType:'application/zip'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=name+'.zip'; a.click();
  }

  if(isWeb) await makeWebHttpZip();
  if(isDev) await makeDevWebZip();
}
