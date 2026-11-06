/**
 * JMX Dependency Resolver
 *
 * Analyses a parsed JMX file and a set of uploaded supporting files to
 * produce a dependency report: which CSV / cert / JAR files are referenced
 * by the test plan, which were uploaded, and which are missing.
 *
 * This is purely a reporting module — it does NOT modify any converter state.
 */

'use strict';

const path = require('path');

class JmxDependencyResolver {
  /**
   * @param {object[]}  csvDataSets    - from JmxParser.getCsvDataSets()
   * @param {object[]}  uploadedFiles  - multer file objects (originalname, size, mimetype)
   */
  constructor(csvDataSets = [], uploadedFiles = []) {
    this.csvDataSets   = csvDataSets;
    // Build a lookup map keyed on lowercase basename for fast matching
    this.uploadedMap   = new Map(
      uploadedFiles.map(f => [path.basename(f.originalname || '').toLowerCase(), f])
    );
  }

  /**
   * Run the dependency analysis.
   * @returns {{
   *   required: DependencyItem[],
   *   found:    DependencyItem[],
   *   missing:  DependencyItem[],
   *   warnings: string[],
   *   summary:  { total:number, found:number, missing:number }
   * }}
   */
  resolve() {
    const required = [];
    const found    = [];
    const missing  = [];
    const warnings = [];

    // ── CSV Data Set Dependencies ─────────────────────────────────────────
    for (const ds of this.csvDataSets) {
      const filename = (ds.filename || '').trim();
      if (!filename) {
        warnings.push('CSVDataSet element found with no filename configured.');
        continue;
      }

      const basename = path.basename(filename).toLowerCase();
      const item = {
        type:        'csv',
        filename,
        basename,
        variables:   (ds.variableNames || '').split(',').map(s => s.trim()).filter(Boolean),
        delimiter:   ds.delimiter || ',',
        shareMode:   ds.shareMode || 'All threads',
        description: `CSV parameter file (variables: ${ds.variableNames || 'unknown'})`,
      };

      required.push(item);

      if (this.uploadedMap.has(basename)) {
        const uploadedFile = this.uploadedMap.get(basename);
        found.push({ ...item, uploadedSize: uploadedFile.size });
      } else {
        missing.push({ ...item,
          message: `CSV file "${filename}" is referenced in a CSVDataSet but was not uploaded. ` +
                   `Script parameterization for [${item.variables.join(', ')}] will need this file at runtime.`,
        });
      }
    }

    // ── Certificate / Keystore hints (warn-only — we can't parse .jks/.p12) ─
    // Certificates are not directly referenced in JMX XML in a consistent way,
    // but some test plans use properties like HTTPSampler.use_keepalive or
    // custom BSF scripts. We just report uploaded cert files as informational.
    const certExtensions = new Set(['.jks', '.p12', '.cer', '.crt', '.key', '.pem', '.pfx']);
    for (const [, file] of this.uploadedMap) {
      const ext = path.extname(file.originalname || '').toLowerCase();
      if (certExtensions.has(ext)) {
        found.push({
          type:        'certificate',
          filename:    file.originalname,
          basename:    file.originalname.toLowerCase(),
          uploadedSize: file.size,
          description: 'SSL certificate / keystore (informational — place in script directory)',
        });
      }
    }

    // ── JAR / plugin files ────────────────────────────────────────────────
    for (const [, file] of this.uploadedMap) {
      const ext = path.extname(file.originalname || '').toLowerCase();
      if (ext === '.jar') {
        warnings.push(
          `JAR file "${file.originalname}" uploaded. Custom JMeter plugins are not directly ` +
          `convertible; any custom samplers or functions from this JAR will appear as TODO ` +
          `comments in the generated script.`
        );
        found.push({
          type:        'jar',
          filename:    file.originalname,
          basename:    file.originalname.toLowerCase(),
          uploadedSize: file.size,
          description: 'Custom JMeter plugin JAR (not convertible — see TODO comments)',
        });
      }
    }

    const summary = {
      total:   required.length,
      found:   found.filter(f => f.type === 'csv').length,
      missing: missing.length,
    };

    return { required, found, missing, warnings, summary };
  }
}

module.exports = JmxDependencyResolver;
