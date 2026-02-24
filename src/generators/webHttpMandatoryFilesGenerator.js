/**
 * Mandatory Files Generator for VuGen Web HTTP/HTML Scripts
 *
 * Generates the required VuGen configuration files:
 *   [ScriptName].usr  — VuGen metadata (INI)
 *   default.cfg       — Runtime settings (INI)
 *   default.usp       — Run logic profile (INI)
 *   ParameterFile.prm — Parameter definitions (XML)
 *   collection_data.dat — Parameter values (CSV)
 *   ScriptUploadMetadata.xml — LRE upload manifest (XML)
 */

const fs = require('fs');
const path = require('path');

class WebHttpMandatoryFilesGenerator {
  constructor(options = {}) {
    this.scriptName = options.scriptName || 'VuGenScript';
  }

  /**
   * Generate all required VuGen configuration files.
   * @param {string} outputDir      - Output directory path
   * @param {Map}    parameters     - Map of name → {name, nextValue, paramValue, ...}
   * @param {string[]} [transactionNames] - Optional list of LR transaction names
   */
  async generateAll(outputDir, parameters, transactionNames = []) {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const safeScriptName = this.sanitizeName(this.scriptName);

    this.writeFile(outputDir, `${safeScriptName}.usr`,
      this.generateUsrFile(safeScriptName, transactionNames));
    this.writeFile(outputDir, 'default.cfg',
      this.generateDefaultCfg());
    this.writeFile(outputDir, 'default.usp',
      this.generateDefaultUsp());
    this.writeFile(outputDir, 'ParameterFile.prm',
      this.generateParameterFilePrm(parameters));
    this.writeFile(outputDir, 'collection_data.dat',
      this.generateCollectionDataDat(parameters));
    this.writeFile(outputDir, 'ScriptUploadMetadata.xml',
      this.generateScriptUploadMetadata(safeScriptName));

    console.log(`✓ Generated VuGen config files (${safeScriptName}.usr, default.cfg, default.usp, ParameterFile.prm, collection_data.dat, ScriptUploadMetadata.xml)`);
  }

  writeFile(dir, filename, content) {
    fs.writeFileSync(path.join(dir, filename), content, 'utf8');
  }

  sanitizeName(name) {
    return String(name)
      .replace(/[<>:"/\\|?* ]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      || 'VuGenScript';
  }

  // ─── [ScriptName].usr (INI) ──────────────────────────────────────────────────

  generateUsrFile(scriptName, transactionNames = []) {
    const txOrder = transactionNames.length > 0
      ? `\n[TransactionsOrder]\nOrder="${transactionNames.join('__*delimiter*__')}"\n`
      : '';

    const txSection = transactionNames.length > 0
      ? `\n[Transactions]\n${transactionNames.map(n => `${n}=`).join('\n')}\n`
      : '';

    return `[General]
Type=Multi
DefaultCfg=default.cfg
ParameterFile=ParameterFile.prm
GlobalParameterFile=
NewFunctionHeader=1
RunType=cci
ActionLogicExt=action_logic
LastActiveAction=Action
MajorVersion=26
MinorVersion=1
ActiveTypes=QTWeb
GenerateTypes=QTWeb
AdditionalTypes=QTWeb
DevelopTool=Vugen
ParamLeftBrace={
ParamRightBrace=}
ScriptLanguage=C
Encoding=ANSI
Description=

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
${txOrder}${txSection}`;
  }

  // ─── default.cfg (INI) ───────────────────────────────────────────────────────

  generateDefaultCfg() {
    return `[General]
XlBridgeTimeout=120
DefaultRunLogic=default.usp
AutomaticTransactions=1
Encoding=ANSI

[ThinkTime]
Options=NOTHINK
Factor=1
LimitFlag=0

[Iterations]
NumOfIterations=1
IterationPace=IterationASAP
StartEvery=60

[Log]
LogOptions=LogBrief

[WEB]
SearchForImages=1
HttpVer=1.1
KeepAlive=Yes
EnableChecks=0
AnalogMode=0
`;
  }

  // ─── default.usp (INI) ───────────────────────────────────────────────────────

  generateDefaultUsp() {
    return `[Profile Actions]
MercIniTreeFather=""
Profile Actions name=vuser_init,Action,vuser_end

[RunLogicInitRoot]
Name="Init"
RunLogicActionOrder="vuser_init"
RunLogicNumOfIterations="1"
RunLogicObjectKind="Group"
RunLogicRunMode="Sequential"

[RunLogicRunRoot]
Name="Run"
RunLogicActionOrder="Action"
RunLogicNumOfIterations="1"
RunLogicObjectKind="Group"
RunLogicRunMode="Sequential"

[RunLogicEndRoot]
Name="End"
RunLogicActionOrder="vuser_end"
RunLogicNumOfIterations="1"
RunLogicObjectKind="Group"
RunLogicRunMode="Sequential"
`;
  }

  // ─── ParameterFile.prm (VuGen INI format) ───────────────────────────────────
  //
  // This is the format that VuGen's GUI produces via "Replace with Parameter".
  // Each [parameter:name] section maps one LR parameter to a named column in
  // collection_data.dat.  The CSV has a header row; VuGen resolves the column
  // by matching ColumnName against that header, then reads data from StartRow=1
  // (first data row after the header).
  //
  //   GenerateNewVal="Once"           → same value for all iterations (config)
  //   GenerateNewVal="EachIteration"  → new value per iteration (test data)
  //   OutOfRangePolicy="ContinueWithLast" → repeat last row when data runs out
  //   SelectNextRow="Sequential"      → iterate rows in order
  //   StartRow="1"                    → first data row (header is auto-skipped)

  generateParameterFilePrm(parameters) {
    if (!parameters || parameters.size === 0) {
      return '; VuGen Parameter File\n; No parameters defined\n';
    }

    let ini = '; ParameterFile.prm — VuGen Web HTTP/HTML Parameter Definitions\n';
    ini += '; Generated by Bruno to DevWeb Converter\n';
    ini += ';\n';
    ini += '; HOW TO UPDATE VALUES:\n';
    ini += ';   Edit collection_data.dat (same folder) — one row per iteration.\n';
    ini += ';   Column names must match the ColumnName entries below.\n';
    ini += ';\n';
    ini += '; PARAMETER TYPES:\n';
    ini += ';   GenerateNewVal="Once"          → config (base URL, client IDs, API keys)\n';
    ini += ';   GenerateNewVal="EachIteration" → test data (username, password)\n';
    ini += '\n';

    for (const [name, config] of parameters.entries()) {
      const generateNewVal = config.nextValue === 'iteration' ? 'EachIteration' : 'Once';
      const originalValue  = (config.paramValue !== undefined && config.paramValue !== null)
        ? String(config.paramValue) : '';

      ini += `[parameter:${name}]\n`;
      ini += `ColumnName="${name}"\n`;
      ini += `Delimiter=","\n`;
      ini += `GenerateNewVal="${generateNewVal}"\n`;
      ini += `OriginalValue="${originalValue}"\n`;
      ini += `OutOfRangePolicy="ContinueWithLast"\n`;
      ini += `ParamName="${name}"\n`;
      ini += `SelectNextRow="Sequential"\n`;
      ini += `StartRow="1"\n`;
      ini += `Table="collection_data.dat"\n`;
      ini += `TableLocation="Local"\n`;
      ini += `Type="Table"\n`;
      ini += `auto_allocate_block_size="1"\n`;
      ini += `value_for_each_vuser=""\n`;
      ini += '\n';
    }

    return ini;
  }

  // ─── collection_data.dat (CSV) ───────────────────────────────────────────────

  generateCollectionDataDat(parameters) {
    if (!parameters || parameters.size === 0) {
      return '';
    }

    const names = Array.from(parameters.keys());
    const header = names.map(n => this.csvEscape(n)).join(',');
    const values = names.map(name => {
      const config = parameters.get(name);
      return this.csvEscape(
        config.paramValue !== undefined && config.paramValue !== null
          ? String(config.paramValue)
          : ''
      );
    }).join(',');

    return `${header}\n${values}\n`;
  }

  // ─── ScriptUploadMetadata.xml ────────────────────────────────────────────────

  generateScriptUploadMetadata(scriptName) {
    return `<?xml version="1.0" encoding="utf-8"?>
<VugenScriptMetadata>
  <ScriptName>${this.xmlEscape(scriptName)}</ScriptName>
  <Protocol>Web - HTTP/HTML</Protocol>
  <ActionFiles>
    <FileEntry Name="vuser_init.c" Filter="2" />
    <FileEntry Name="Action.c" Filter="2" />
    <FileEntry Name="vuser_end.c" Filter="2" />
    <FileEntry Name="globals.h" Filter="2" />
  </ActionFiles>
  <GeneralFiles>
    <FileEntry Name="${this.xmlEscape(scriptName)}.usr" Filter="4" />
    <FileEntry Name="default.cfg" Filter="4" />
    <FileEntry Name="default.usp" Filter="4" />
    <FileEntry Name="ParameterFile.prm" Filter="4" />
    <FileEntry Name="collection_data.dat" Filter="4" />
  </GeneralFiles>
</VugenScriptMetadata>
`;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  xmlEscape(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  csvEscape(str) {
    const s = String(str);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }
}

module.exports = WebHttpMandatoryFilesGenerator;
