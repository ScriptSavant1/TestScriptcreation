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

    // 2. Resolve CSVDataSet filenames that reference JMX variables
    //    e.g. filename="{{csvFile1}}" where csvFile1="users.csv" in UDVs
    //    Must run BEFORE filterJmxCollectionVars removes the path variables.
    this.resolveCsvFilenames(csvDataSets, collection.variable || []);

    // 2b. If any CSVDataSet has empty variableNames, read column headers from
    //     the uploaded CSV file (JMeter's own behaviour: first row = headers
    //     when variableNames is blank).
    await this.enrichCsvVariableNames(csvDataSets);

    // 3. Remove JMX-internal variables from the collection so they never reach
    //    the generator's classifyVariables().  Without this, vars like
    //    nrThreads=50, csvFile1=users.csv, lines1=100 become spurious Tier 2
    //    Config parameters and pollute collection_data.csv / parameters.yml.
    this.filterJmxCollectionVars(collection);

    // 4. Build shared environment variables
    const environmentVars = await this.loadEnvironmentFile();
    this.injectCsvVariables(csvDataSets, environmentVars);
    this.injectRequestVariables(requests, environmentVars);
    this.injectProxyVariables(collection, environmentVars);

    // 3. Prepare root output dir
    await fs.mkdir(this.options.outputDir, { recursive: true });

    // 4. Fetch standalone JSR223/BeanShell samplers (stamped with threadGroupType by parser)
    const standaloneScripts = parser.getStandaloneScripts ? parser.getStandaloneScripts() : [];

    // 5. Dispatch to single or multi mode
    const enabledTGs = threadGroups.filter(tg => tg.enabled !== false);
    if (this.options.mode === 'multi' && enabledTGs.length > 1) {
      return await this._convertMulti(
        parser, requests, standaloneScripts, collection, threadGroups, csvDataSets, environmentVars, metadata
      );
    }
    return await this._convertSingle(
      requests, standaloneScripts, collection, threadGroups, csvDataSets, environmentVars, metadata
    );
  }

  // ── Single-script path (original behaviour) ──────────────────────────────

  async _convertSingle(requests, standaloneScripts, collection, threadGroups, csvDataSets, environmentVars, metadata) {
    const isWebHttp      = this.options.protocol === 'web-http';
    const GeneratorClass = isWebHttp ? WebHttpScriptGenerator : AdvancedScriptGenerator;

    // Split requests by thread-group role so setUp/tearDown go to the correct
    // lifecycle section (initialize / finalize) rather than into action().
    const setupReqs    = requests.filter(r => r.threadGroupType === 'SetUp');
    const teardownReqs = requests.filter(r => r.threadGroupType === 'TearDown');
    const mainReqs     = requests.filter(r => r.threadGroupType !== 'SetUp' && r.threadGroupType !== 'TearDown');

    // Standalone JSR223/BeanShell samplers — split the same way
    const setupScripts    = (standaloneScripts || []).filter(s => s.threadGroupType === 'SetUp');
    const teardownScripts = (standaloneScripts || []).filter(s => s.threadGroupType === 'TearDown');

    const generator = new GeneratorClass(
      mainReqs,
      collection,
      {
        ...this.options,
        environmentVars,
        csvDataSets,
        setupRequests:    setupReqs,
        teardownRequests: teardownReqs,
        setupScripts,
        teardownScripts,
      }
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

  async _convertMulti(parser, requests, standaloneScripts, collection, threadGroups, csvDataSets, environmentVars, metadata) {
    const isWebHttp      = this.options.protocol === 'web-http';
    const GeneratorClass = isWebHttp ? WebHttpScriptGenerator : AdvancedScriptGenerator;

    const tgRequestsMap = parser.getThreadGroupRequests();
    const scripts       = [];
    let   firstAnalysis = null;

    for (const [tgName, tgReqs] of tgRequestsMap) {
      if (!tgReqs.length) continue;

      // Resolve which thread group index these requests belong to
      const tgIndex = tgReqs[0]?.threadGroupIndex ?? -1;
      const tgType  = tgReqs[0]?.threadGroupType  ?? 'Standard';

      // ── Per-TG CSVDataSet filtering ──────────────────────────────────────
      const tgCsvDataSets = csvDataSets.filter(csv =>
        csv.threadGroupIndex === -1 || csv.threadGroupIndex === tgIndex
      );

      // ── Per-TG variable map ───────────────────────────────────────────────
      const tgLocalVars  = parser.getThreadGroupVars(tgIndex);
      const otherTgCsvCols = new Set();
      for (const csv of csvDataSets) {
        if (csv.threadGroupIndex !== -1 && csv.threadGroupIndex !== tgIndex) {
          for (const col of (csv.variableNames || '').split(',').map(c => c.trim()).filter(Boolean)) {
            otherTgCsvCols.add(col);
          }
        }
      }
      const tgEnvVars = {};
      for (const [k, v] of Object.entries(environmentVars)) {
        if (!otherTgCsvCols.has(k)) tgEnvVars[k] = v;
      }
      Object.assign(tgEnvVars, tgLocalVars);

      // ── SetUp / TearDown thread groups ────────────────────────────────────
      // In multi-script mode, setUp/tearDown TGs generate a real script but
      // their HTTP requests go to initialize()/finalize() rather than action().
      // Standalone JSR223/BeanShell samplers in those TGs become TODO comments
      // in the same lifecycle section.
      const tgStandaloneScripts = (standaloneScripts || []).filter(s => s.threadGroupIndex === tgIndex);
      const isSetUp    = tgType === 'SetUp';
      const isTearDown = tgType === 'TearDown';

      // Create a safe directory name from the thread group name
      const safeName   = tgName
        .replace(/[<>:"/\\|?*]/g, '')
        .replace(/\s+/g, '_')
        .trim() || 'ThreadGroup';
      const tgOutputDir = path.join(this.options.outputDir, safeName);
      await fs.mkdir(tgOutputDir, { recursive: true });

      // Find the thread group metadata object for WLM Excel
      const tgMeta = threadGroups.find(tg => tg.name === tgName) || null;

      // For SetUp/TearDown TGs: all requests go to init/finalize, action() is empty.
      // For Standard TGs: normal generation.
      const generatorOpts = {
        ...this.options,
        environmentVars: tgEnvVars,
        csvDataSets:     tgCsvDataSets,
        outputDir:       tgOutputDir,
      };
      if (isSetUp) {
        generatorOpts.setupRequests = tgReqs;
        generatorOpts.setupScripts  = tgStandaloneScripts;
        generatorOpts.teardownRequests = [];
        generatorOpts.teardownScripts  = [];
        // action() should be empty — pass an empty array as main requests
      } else if (isTearDown) {
        generatorOpts.teardownRequests = tgReqs;
        generatorOpts.teardownScripts  = tgStandaloneScripts;
        generatorOpts.setupRequests    = [];
        generatorOpts.setupScripts     = [];
      } else {
        // Standard TG — standalone JSR223s in this TG become pre/post script comments
        generatorOpts.setupRequests    = [];
        generatorOpts.setupScripts     = [];
        generatorOpts.teardownRequests = [];
        generatorOpts.teardownScripts  = [];
      }

      const mainReqsForTg = (isSetUp || isTearDown) ? [] : tgReqs;
      const generator = new GeneratorClass(
        mainReqsForTg,
        collection,
        generatorOpts
      );

      const { script, analysis } = await generator.generate(tgOutputDir);
      if (!firstAnalysis) firstAnalysis = analysis;

      if (!isWebHttp) {
        await fs.writeFile(path.join(tgOutputDir, 'main.js'), script, 'utf8');
      }

      // DevWeb only: append CSV vars to parameters.yml (VuGen handles it in generator)
      if (tgCsvDataSets.length && this.options.useParameterization && !isWebHttp) {
        await this.generateCsvParameterFiles(tgCsvDataSets, false, tgOutputDir);
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
   * Resolve {{varName}} references in CSVDataSet filenames.
   *
   * JMeter tests often make CSV paths configurable via User Defined Variables:
   *   UDV:       csvFile1 = "users.csv"
   *   CSVDataSet filename = "${csvFile1}"  → parsed as "{{csvFile1}}"
   *
   * After this step ds.filename = "users.csv" instead of "{{csvFile1}}", so
   * parameters.yml / ParameterFile.prm point to the real file.
   *
   * @param {object[]} csvDataSets  - parsed CSVDataSet objects (mutated in place)
   * @param {object[]} collectionVars - collection.variable array [{key,value}]
   */
  resolveCsvFilenames(csvDataSets, collectionVars) {
    if (!csvDataSets.length || !collectionVars.length) return;
    const varMap = new Map(collectionVars.map(v => [v.key, String(v.value || '').trim()]));

    for (const ds of csvDataSets) {
      if (!ds.filename || !ds.filename.includes('{{')) continue;
      const resolved = ds.filename.replace(/\{\{([^}]+)\}\}/g, (match, name) => {
        const val = varMap.get(name.trim());
        // Only substitute when the resolved value itself is a plain filename/path
        if (val && !val.includes('{{') && val.trim()) {
          return path.basename(val.trim()); // keep just the filename, strip any path prefix
        }
        return match; // leave unresolved if lookup fails
      });
      if (resolved !== ds.filename) ds.filename = resolved;
    }
  }

  /**
   * Remove JMeter-internal variables from collection.variable so they are
   * never classified as LoadRunner parameters.
   *
   * Three categories are filtered:
   *
   * A) CSV path variables — value ends in ".csv"
   *    e.g. csvFile1="users.csv", dataFile="orders.csv"
   *    JMeter uses these to make CSVDataSet paths configurable.
   *    LoadRunner references CSV files directly — no variable needed.
   *
   * B) JMeter execution/scheduling properties — fixed name list
   *    e.g. nrThreads, rampUp, duration, loopCount
   *    These control JMeter's thread model and have no LR equivalent.
   *
   * C) Numeric-count pattern names — lines1, lineCount, rowCount, etc.
   *    Typically used to pass CSV row counts between JMeter components.
   *
   * NOTE: This only affects JMX collections.  Bruno/Postman collections
   * never pass through jmxConverter so this method is never called for them.
   */
  filterJmxCollectionVars(collection) {
    if (!collection || !Array.isArray(collection.variable)) return;

    // B) Hard-coded list of JMeter execution property names
    const JMETER_EXEC = new Set([
      'nrthreads', 'numthreads', 'threadcount', 'vusers', 'concurrency',
      'rampup', 'ramptime', 'ramp_up', 'ramp_time',
      'loopcount', 'loops', 'iterations', 'loopnum',
      'duration', 'holdduration', 'holdtime', 'hold_time',
      'startdelay', 'start_delay', 'initialdelay',
      'throughput', 'targetthroughput', 'target_throughput', 'targettps',
      'scheduler',
    ]);

    // C) Numeric-count patterns: lines1, lines2, lineCount, nrLines, rowCount, records1 …
    const COUNT_RE = /^(?:lines?\d*|linecount|nrlines|rowcount|rows?\d*|csvlines?\d*|records?\d*)$/i;

    collection.variable = collection.variable.filter(v => {
      const key = String(v.key || '').trim();
      const val = String(v.value || '').trim();

      if (!key) return false;                            // skip blank keys
      if (/\.csv$/i.test(val)) return false;             // A) CSV path var
      if (JMETER_EXEC.has(key.toLowerCase())) return false; // B) execution prop
      if (COUNT_RE.test(key)) return false;              // C) count pattern
      return true;
    });
  }

  /**
   * Inject CSV column variable names as empty placeholders so 3-tier
   * classification marks them as Tier 3 (iteration parameters).
   */
  /**
   * If a CSVDataSet has no variableNames, try to read the first line of the
   * uploaded CSV file as column headers (mirrors JMeter's behaviour).
   * csvFilePaths is a map of originalname → tmpPath populated by the web server.
   */
  async enrichCsvVariableNames(csvDataSets) {
    const csvFilePaths = this.options.csvFilePaths || {};
    if (!csvDataSets.length || !Object.keys(csvFilePaths).length) return;

    for (const ds of csvDataSets) {
      if (ds.variableNames) continue;   // already has column names
      const filename = (ds.filename || '').replace(/\\/g, '/').split('/').pop();
      if (!filename) continue;

      // Find the uploaded file by basename (case-insensitive)
      const matchedPath = csvFilePaths[filename]
        || csvFilePaths[Object.keys(csvFilePaths).find(k => k.toLowerCase() === filename.toLowerCase())];
      if (!matchedPath) continue;

      try {
        const content = await fs.readFile(matchedPath, 'utf8');
        const firstLine = content.split(/\r?\n/)[0].trim();
        if (firstLine) {
          ds.variableNames = firstLine;
          console.log(`  ✓ Auto-detected CSV columns for "${filename}": ${firstLine}`);
        }
      } catch { /* silently skip unreadable files */ }
    }
  }

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
