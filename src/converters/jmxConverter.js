/**
 * JMX Converter — Orchestrator
 * Parses a JMeter .jmx file and generates either DevWeb or VuGen Web HTTP/HTML scripts
 * plus a Workload Modelling Excel file.
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
    const parser  = new JmxParser(this.options.inputFile, this.options);
    const requests = await parser.parse();
    const metadata = parser.getMetadata();
    const collection = parser.getCollection();
    const threadGroups = parser.getThreadGroups();
    const csvDataSets  = parser.getCsvDataSets();

    if (!requests.length) {
      throw new Error('No HTTP requests found in this JMX file. Only HTTPSamplerProxy elements are converted.');
    }

    // 2. Load environment file if provided (same format as Postman/Bruno env files)
    const environmentVars = await this.loadEnvironmentFile();

    // Merge CSV variable names into environment vars so generators know about them
    this.injectCsvVariables(csvDataSets, environmentVars);

    // Inject any {{varName}} references found in requests as empty env vars.
    // Catches JMeter UDV/CSV vars that may not have been detected by the parser
    // due to nesting depth issues. Empty value → Rule 4 → Tier 1 Dynamic.
    this.injectRequestVariables(requests, environmentVars);

    // 3. Prepare output dir
    await fs.mkdir(this.options.outputDir, { recursive: true });

    // 4. Generate scripts
    const isWebHttp = this.options.protocol === 'web-http';
    const GeneratorClass = isWebHttp ? WebHttpScriptGenerator : AdvancedScriptGenerator;

    const generator = new GeneratorClass(
      requests,
      collection,
      { ...this.options, environmentVars }
    );

    const { script, analysis } = await generator.generate(this.options.outputDir);

    if (!isWebHttp) {
      const scriptPath = path.join(this.options.outputDir, 'main.js');
      await fs.writeFile(scriptPath, script, 'utf8');
    }

    // 5. Inject JMX-explicit correlations (RegexExtractor, BoundaryExtractor, etc.)
    //    into the generated script if the generator hasn't already handled them.
    //    (The generators' correlation detector runs on script content; JMX extractors
    //     are stored on each request's .extractors[] and already consumed by the generator
    //     via the normalized request format.)

    // 6. Generate CSV parameter files from CSVDataSet entries
    if (csvDataSets.length && this.options.useParameterization) {
      await this.generateCsvParameterFiles(csvDataSets, isWebHttp);
    }

    // 7. Generate Workload Modelling Excel
    let excelBuffer = null;
    if (this.options.generateWlmExcel) {
      const excelGen  = new WorkloadExcelGenerator(
        threadGroups,
        requests,
        metadata.name,
        this.options
      );
      excelBuffer = await excelGen.generateBuffer();
      const excelPath = path.join(this.options.outputDir, `${metadata.name.replace(/[^\w\s-]/g,'_')}_WLM.xlsx`);
      await fs.writeFile(excelPath, excelBuffer);
    }

    return {
      success:      true,
      outputDir:    this.options.outputDir,
      analysis,
      metadata,
      threadGroups,
      csvDataSets,
      excelBuffer
    };
  }

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
   * This catches JMeter UDVs and CSV vars that may be missed by the parser.
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
   * Inject CSV column variable names as empty placeholders so 3-tier
   * classification marks them as Tier 3 (iteration parameters).
   */
  injectCsvVariables(csvDataSets, environmentVars) {
    for (const ds of csvDataSets) {
      const cols = (ds.variableNames || '').split(',').map(s => s.trim()).filter(Boolean);
      for (const col of cols) {
        if (!(col in environmentVars)) {
          environmentVars[col] = '';  // empty → Tier 3 by rule 4
        }
      }
    }
  }

  /**
   * Generate parameter entries for CSVDataSet configs.
   * DevWeb → parameters.yml additions
   * VuGen  → ParameterFile.prm additions
   */
  async generateCsvParameterFiles(csvDataSets, isWebHttp) {
    if (isWebHttp) {
      // Append to ParameterFile.prm
      const prmPath = path.join(this.options.outputDir, 'ParameterFile.prm');
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
      // Append to parameters.yml
      const ymlPath = path.join(this.options.outputDir, 'parameters.yml');
      let ymlContent = '';
      try { ymlContent = await fs.readFile(ymlPath, 'utf8'); } catch {}
      if (!ymlContent.includes('parameters:')) ymlContent = 'parameters:\n';

      for (const ds of csvDataSets) {
        const cols = (ds.variableNames || '').split(',').map(s => s.trim()).filter(Boolean);
        const firstCol = cols[0];
        cols.forEach((col, idx) => {
          if (!ymlContent.includes(`name: ${col}`)) {
            ymlContent += `  - name: ${col}\n`;
            ymlContent += `    type: csv\n`;
            ymlContent += `    fileName: ${ds.filename || `${col}.csv`}\n`;
            ymlContent += `    columnName: ${col}\n`;
            ymlContent += `    nextValue: iteration\n`;
            if (idx === 0) {
              ymlContent += `    nextRow: sequential\n`;
            } else {
              ymlContent += `    nextRow: same as ${firstCol}\n`;
            }
            ymlContent += `    onEnd: loop\n`;
          }
        });
      }
      await fs.writeFile(ymlPath, ymlContent, 'utf8');
    }
  }
}

module.exports = JmxConverter;
