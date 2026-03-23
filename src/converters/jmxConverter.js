/**
 * JMX Converter — Orchestrator
 * Parses a JMeter .jmx file and generates either DevWeb or VuGen Web HTTP/HTML scripts
 * plus a Workload Modelling Excel file.
 *
 * mode:'single' → one script from all thread groups (default, existing behaviour)
 * mode:'multi'  → one script per thread group, each in its own sub-directory
 *
 * Reuses the same generators as the Bruno/Postman converter — only the parser is new.
 */

'use strict';

const path                  = require('path');
const fs                    = require('fs').promises;
const JmxParser             = require('../parsers/jmxParser');
const AdvancedScriptGenerator    = require('../generators/advancedScriptGenerator');
const WebHttpScriptGenerator     = require('../generators/webHttpScriptGenerator');
const WorkloadExcelGenerator     = require('../generators/workloadExcelGenerator');

class JmxConverter {
  constructor(options = {}) {
    this.options = {
      inputFile:           options.inputFile,
      outputDir:           options.outputDir || './jmx-converted',
      protocol:            options.protocol  || 'devweb',   // 'devweb' | 'web-http'
      mode:                options.mode      || 'single',   // 'single' | 'multi'
      useTransactions:     options.useTransactions     !== false,
      useCorrelation:      options.useCorrelation      !== false,
      useParameterization: options.useParameterization !== false,
      useAuthentication:   options.useAuthentication   !== false,
      useCustomScripts:    options.useCustomScripts    !== false,
      thinkTime:           options.thinkTime     || 1,
      addComments:         options.addComments   !== false,
      logLevel:            options.logLevel      || 'info',
      generateDataFiles:   options.generateDataFiles !== false,
      generateWlmExcel:    options.generateWlmExcel   !== false,
      ...options
    };
  }

  async convert() {
    // 1. Parse JMX
    const parser       = new JmxParser(this.options.inputFile, this.options);
    const requests     = await parser.parse();
    const metadata     = parser.getMetadata();
    const collection   = parser.getCollection();
    const threadGroups = parser.getThreadGroups();
    const csvDataSets  = parser.getCsvDataSets();

    if (!requests.length) {
      throw new Error('No HTTP requests found in this JMX file. Only HTTPSamplerProxy elements are converted.');
    }

    // 2. Build shared environment variables
    const environmentVars = await this.loadEnvironmentFile();
    this.injectCsvVariables(csvDataSets, environmentVars);
    this.injectRequestVariables(requests, environmentVars);
    this.injectProxyVariables(collection, environmentVars);

    // 3. Prepare root output dir
    await fs.mkdir(this.options.outputDir, { recursive: true });

    // 4. Dispatch to single or multi mode
    const enabledTGs = threadGroups.filter(tg => tg.enabled !== false);
    if (this.options.mode === 'multi' && enabledTGs.length > 1) {
      return await this._convertMulti(
        parser, requests, collection, threadGroups, csvDataSets, environmentVars, metadata
      );
    }
    return await this._convertSingle(
      requests, collection, threadGroups, csvDataSets, environmentVars, metadata
    );
  }

  // ── Single-script path (original behaviour) ──────────────────────────────

  async _convertSingle(requests, collection, threadGroups, csvDataSets, environmentVars, metadata) {
    const isWebHttp      = this.options.protocol === 'web-http';
    const GeneratorClass = isWebHttp ? WebHttpScriptGenerator : AdvancedScriptGenerator;

    const generator = new GeneratorClass(
      requests,
      collection,
      { ...this.options, environmentVars, csvDataSets }
    );

    const { script, analysis } = await generator.generate(this.options.outputDir);

    if (!isWebHttp) {
      const scriptPath = path.join(this.options.outputDir, 'main.js');
      await fs.writeFile(scriptPath, script, 'utf8');
    }

    // DevWeb: generateCsvParameterFiles() appends to parameters.yml for CSV vars.
    // VuGen:  CSV vars are already in ParameterFile.prm via the generator's parameters map.
    if (csvDataSets.length && this.options.useParameterization && !isWebHttp) {
      await this.generateCsvParameterFiles(csvDataSets, false, this.options.outputDir);
    }

    let excelBuffer = null;
    if (this.options.generateWlmExcel) {
      const excelGen  = new WorkloadExcelGenerator(threadGroups, requests, metadata.name, this.options);
      excelBuffer     = await excelGen.generateBuffer();
      const excelPath = path.join(this.options.outputDir, `${metadata.name.replace(/[^\w\s-]/g,'_')}_WLM.xlsx`);
      await fs.writeFile(excelPath, excelBuffer);
    }

    return { success: true, outputDir: this.options.outputDir, multiScript: false,
             analysis, metadata, threadGroups, csvDataSets, excelBuffer };
  }

  // ── Multi-script path (one sub-directory per thread group) ────────────────

  async _convertMulti(parser, requests, collection, threadGroups, csvDataSets, environmentVars, metadata) {
    const isWebHttp      = this.options.protocol === 'web-http';
    const GeneratorClass = isWebHttp ? WebHttpScriptGenerator : AdvancedScriptGenerator;

    const tgRequestsMap = parser.getThreadGroupRequests();
    const scripts       = [];
    let   firstAnalysis = null;

    for (const [tgName, tgReqs] of tgRequestsMap) {
      if (!tgReqs.length) continue;

      // Create a safe directory name from the thread group name
      const safeName   = tgName
        .replace(/[<>:"/\\|?*]/g, '')   // strip invalid chars
        .replace(/\s+/g, '_')
        .trim() || 'ThreadGroup';
      const tgOutputDir = path.join(this.options.outputDir, safeName);
      await fs.mkdir(tgOutputDir, { recursive: true });

      // Find the thread group metadata object for WLM Excel
      const tgMeta = threadGroups.find(tg => tg.name === tgName) || null;

      // Special thread group types map to init/end sections
      // SetUp   → always first, used as vuser_init equivalent
      // TearDown → always last, used as vuser_end equivalent
      const tgType = tgMeta?.type || 'Standard';

      const generator = new GeneratorClass(
        tgReqs,
        collection,
        { ...this.options, environmentVars, csvDataSets, outputDir: tgOutputDir }
      );

      const { script, analysis } = await generator.generate(tgOutputDir);
      if (!firstAnalysis) firstAnalysis = analysis;

      if (!isWebHttp) {
        await fs.writeFile(path.join(tgOutputDir, 'main.js'), script, 'utf8');
      }

      // DevWeb only: append CSV vars to parameters.yml (VuGen handles it in generator)
      if (csvDataSets.length && this.options.useParameterization && !isWebHttp) {
        await this.generateCsvParameterFiles(csvDataSets, false, tgOutputDir);
      }

      // Per-thread-group WLM Excel (only when we have metadata for this group)
      if (this.options.generateWlmExcel && tgMeta) {
        const eg         = new WorkloadExcelGenerator([tgMeta], tgReqs, tgName, this.options);
        const excelBuf   = await eg.generateBuffer();
        const excelPath  = path.join(tgOutputDir, `${safeName}_WLM.xlsx`);
        await fs.writeFile(excelPath, excelBuf);
      }

      scripts.push({
        threadGroupName: tgName,
        threadGroupType: tgType,
        outputDir:       tgOutputDir,
        safeDirName:     safeName,
        requestCount:    tgReqs.length,
        analysis,
      });
    }

    // Combined WLM Excel at the root level (all thread groups together)
    let excelBuffer = null;
    if (this.options.generateWlmExcel) {
      const rootExcelGen  = new WorkloadExcelGenerator(threadGroups, requests, metadata.name, this.options);
      excelBuffer         = await rootExcelGen.generateBuffer();
      const rootExcelPath = path.join(this.options.outputDir, `${metadata.name.replace(/[^\w\s-]/g,'_')}_WLM.xlsx`);
      await fs.writeFile(rootExcelPath, excelBuffer);
    }

    return {
      success:     true,
      outputDir:   this.options.outputDir,
      multiScript: true,
      scripts,
      analysis:    firstAnalysis,
      metadata,
      threadGroups,
      csvDataSets,
      excelBuffer,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Load environment file (Postman/Bruno format: { values: [{key,value,enabled}] })
   */
  async loadEnvironmentFile() {
    if (!this.options.environmentFile) return {};
    try {
      const content = await fs.readFile(this.options.environmentFile, 'utf8');
      const data    = JSON.parse(content);
      const vars    = {};
      (data.values || []).filter(v => v.enabled !== false).forEach(v => {
        vars[v.key] = v.value;
      });
      return vars;
    } catch { return {}; }
  }

  /**
   * Scan all requests for {{varName}} references and inject unknown ones as
   * empty strings so the 3-tier classifier treats them as Tier 1 Dynamic.
   */
  injectRequestVariables(requests, environmentVars) {
    const varPattern = /\{\{([^}]+)\}\}/g;
    for (const req of requests) {
      const texts = [
        req.url || '',
        JSON.stringify(req.body || ''),
        JSON.stringify(req.headers || {}),
      ];
      for (const text of texts) {
        let m;
        while ((m = varPattern.exec(text)) !== null) {
          const name = m[1].trim();
          if (name && !(name in environmentVars)) {
            environmentVars[name] = '';
          }
        }
      }
    }
  }

  /**
   * Forward proxy settings extracted from JMX HTTP Request Defaults into
   * environmentVars so generators' detectProxyConfig() picks them up.
   */
  injectProxyVariables(collection, environmentVars) {
    const proxy = collection && collection.config && collection.config.proxy;
    if (!proxy || !proxy.host) return;
    if (!environmentVars['proxyHost']) environmentVars['proxyHost'] = proxy.host;
    if (!environmentVars['proxyPort']) environmentVars['proxyPort'] = String(proxy.port || '');
    if (proxy.username && !environmentVars['proxyUser'])
      environmentVars['proxyUser'] = proxy.username;
    if (proxy.password && !environmentVars['proxyPass'])
      environmentVars['proxyPass'] = proxy.password;
  }

  /**
   * Inject CSV column variable names as empty placeholders so 3-tier
   * classification marks them as Tier 3 (iteration parameters).
   */
  injectCsvVariables(csvDataSets, environmentVars) {
    for (const ds of csvDataSets) {
      const cols = (ds.variableNames || '').split(',').map(s => s.trim()).filter(Boolean);
      for (const col of cols) {
        if (!(col in environmentVars)) {
          environmentVars[col] = '';
        }
      }
    }
  }

  /**
   * Generate parameter entries for CSVDataSet configs.
   * DevWeb → parameters.yml    VuGen → ParameterFile.prm
   * @param {string} [outputDir] — defaults to this.options.outputDir
   */
  async generateCsvParameterFiles(csvDataSets, isWebHttp, outputDir = this.options.outputDir) {
    if (isWebHttp) {
      const prmPath = path.join(outputDir, 'ParameterFile.prm');
      let prmContent = '';
      try { prmContent = await fs.readFile(prmPath, 'utf8'); } catch {}

      for (const ds of csvDataSets) {
        const cols = (ds.variableNames || '').split(',').map(s => s.trim()).filter(Boolean);
        cols.forEach((col, idx) => {
          if (!prmContent.includes(`[parameter:${col}]`)) {
            prmContent += `\n[parameter:${col}]\n`;
            prmContent += `GenerateNewVal=EachIteration\n`;
            prmContent += `FileName=${ds.filename || `${col}.csv`}\n`;
            prmContent += `Column=${idx + 1}\n`;
            prmContent += `Delimiter=${ds.delimiter || ','}\n`;
            prmContent += `StartRow=0\n`;
            prmContent += `TableLocation=0\n`;
          }
        });
      }
      await fs.writeFile(prmPath, prmContent.trim(), 'utf8');
    } else {
      const ymlPath = path.join(outputDir, 'parameters.yml');
      let ymlContent = '';
      try { ymlContent = await fs.readFile(ymlPath, 'utf8'); } catch {}
      if (!ymlContent.includes('parameters:')) ymlContent = 'parameters:\n';

      for (const ds of csvDataSets) {
        const cols     = (ds.variableNames || '').split(',').map(s => s.trim()).filter(Boolean);
        const firstCol = cols[0];
        cols.forEach((col, idx) => {
          if (!ymlContent.includes(`name: ${col}`)) {
            ymlContent += `  - name: ${col}\n`;
            ymlContent += `    type: csv\n`;
            ymlContent += `    fileName: ${ds.filename || `${col}.csv`}\n`;
            ymlContent += `    columnName: ${col}\n`;
            ymlContent += `    nextValue: iteration\n`;
            ymlContent += idx === 0
              ? `    nextRow: sequential\n`
              : `    nextRow: same as ${firstCol}\n`;
            ymlContent += `    onEnd: loop\n`;
          }
        });
      }
      await fs.writeFile(ymlPath, ymlContent, 'utf8');
    }
  }
}

module.exports = JmxConverter;
