/**
 * Workload Modelling Excel Generator
 * Converts JMeter Thread Group data into a LoadRunner-ready .xlsx workbook.
 *
 * Sheets:
 *   1. Thread Groups   — one row per group with all load model values
 *   2. Transactions    — list of all transaction names and their thread group
 *   3. LRE Setup Guide — static instructions for recreating the model in LRE
 */

'use strict';

const ExcelJS = require('exceljs');

// ─── Colour palette ───────────────────────────────────────────────────────────
const C = {
  headerBg:    '1F4E79',  // dark blue
  headerFont:  'FFFFFF',
  setUp:       'D6E4F7',  // light blue
  tearDown:    'FDEBD0',  // light orange
  standard:    'FFFFFF',
  stepping:    'E8F5E9',  // light green
  ultimate:    'F3E5F5',  // light purple
  concurrency: 'FFF9C4',  // light yellow
  arrivals:    'FCE4EC',  // light pink
  sectionHdr:  'C6EFCE',  // green (for guide sheet)
  notesBg:     'FFF2CC',
  border:      '95B3D7'
};

function tgColor(type) {
  const m = { SetUp: C.setUp, TearDown: C.tearDown, Standard: C.standard,
              Stepping: C.stepping, Ultimate: C.ultimate,
              Concurrency: C.concurrency, Arrivals: C.arrivals };
  return m[type] || C.standard;
}

function hdrStyle(extra = {}) {
  return {
    font:      { bold: true, color: { argb: 'FF' + C.headerFont }, size: 11 },
    fill:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + C.headerBg } },
    alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    border:    { bottom: { style: 'thin', color: { argb: 'FF' + C.border } } },
    ...extra
  };
}

function cellStyle(bgArgb, bold = false, align = 'left') {
  return {
    font:      { bold, size: 10 },
    fill:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + bgArgb } },
    alignment: { horizontal: align, vertical: 'middle', wrapText: true },
    border: {
      top:    { style: 'hair', color: { argb: 'FFCCCCCC' } },
      bottom: { style: 'hair', color: { argb: 'FFCCCCCC' } },
      left:   { style: 'hair', color: { argb: 'FFCCCCCC' } },
      right:  { style: 'hair', color: { argb: 'FFCCCCCC' } }
    }
  };
}

// ─── Sheet 1: Thread Groups ───────────────────────────────────────────────────
function buildThreadGroupSheet(ws, threadGroups, scriptName) {
  ws.properties.defaultRowHeight = 20;

  // Title row
  ws.mergeCells('A1:N1');
  const title = ws.getCell('A1');
  title.value = `JMeter → LoadRunner Enterprise — Workload Model: ${scriptName}`;
  title.style = {
    font:      { bold: true, size: 14, color: { argb: 'FF1F4E79' } },
    alignment: { horizontal: 'center', vertical: 'middle' }
  };
  ws.getRow(1).height = 28;

  // Sub-title / instructions
  ws.mergeCells('A2:N2');
  const sub = ws.getCell('A2');
  sub.value = 'Use the values below when creating your LRE test scenario. Each row = one Thread Group in JMeter.';
  sub.style = { font: { italic: true, size: 10 }, alignment: { horizontal: 'center' } };

  ws.addRow([]); // spacer

  // Column definitions — header property intentionally omitted to avoid ExcelJS
  // writing duplicate values into row 1 (which is already a merged title cell).
  const columns = [
    { key: 'seq',         width: 5  },
    { key: 'name',        width: 28 },
    { key: 'type',        width: 14 },
    { key: 'script',      width: 22 },
    { key: 'vus',         width: 18 },
    { key: 'rampUp',      width: 14 },
    { key: 'hold',        width: 18 },
    { key: 'rampDown',    width: 16 },
    { key: 'iterations',  width: 12 },
    { key: 'delay',       width: 16 },
    { key: 'stepSize',    width: 14 },
    { key: 'stepDur',     width: 16 },
    { key: 'thinkTime',   width: 14 },
    { key: 'notes',       width: 36 }
  ];
  ws.columns = columns;

  // Header row (row 4)
  const hdrRow = ws.getRow(4);
  hdrRow.height = 32;
  columns.forEach((col, idx) => {
    const cell = hdrRow.getCell(idx + 1);
    cell.value = col.header;
    cell.style = hdrStyle();
  });

  // Data rows
  threadGroups.forEach((tg, i) => {
    const row = ws.addRow({
      seq:        i + 1,
      name:       tg.name,
      type:       tg.type,
      script:     scriptName,
      vus:        tg.virtualUsers,
      rampUp:     tg.rampUpSec,
      hold:       tg.holdSec,
      rampDown:   tg.rampDownSec || 0,
      iterations: tg.iterations,
      delay:      tg.startDelaySec || 0,
      stepSize:   tg.stepSize ?? '',
      stepDur:    tg.stepDuration ?? '',
      thinkTime:  '',   // filled from CSVDataSet / timer analysis
      notes:      buildNotes(tg)
    });

    const bg = tgColor(tg.type);
    row.eachCell({ includeEmpty: true }, cell => {
      cell.style = cellStyle(bg, false, 'center');
    });
    // Name column left-aligned
    row.getCell(2).style = cellStyle(bg, true, 'left');
    row.getCell(14).style = cellStyle(C.notesBg, false, 'left');
    row.height = 22;
  });

  // Legend
  ws.addRow([]);
  ws.addRow(['Legend:']);
  const legendData = [
    ['Standard', 'Fixed VUs — use Goal-Oriented: VU-based in LRE'],
    ['SetUp',    'Initialization — runs once before test. Map to Initialize vuser block.'],
    ['TearDown', 'Cleanup — runs once after test. Map to Finalize vuser block.'],
    ['Stepping', 'Step-up ramp — use Custom Scheduler with step-up load in LRE'],
    ['Ultimate', 'Complex schedule — use Custom Scheduler in LRE'],
    ['Concurrency', 'Concurrent VU target — use Goal-Oriented: VU-based with ramp'],
    ['Arrivals',  'Throughput/TPS target — use Goal-Oriented: Hits per second in LRE']
  ];
  legendData.forEach(([type, desc]) => {
    const lr = ws.addRow(['', type, '', desc]);
    lr.getCell(2).style = cellStyle(tgColor(type), true, 'left');
    lr.getCell(4).style = cellStyle('F5F5F5', false, 'left');
  });

  // Freeze panes at row 5 (after headers)
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 4 }];
}

function buildNotes(tg) {
  const notes = [];
  if (tg.type === 'SetUp')     notes.push('Run once before test. Use in Initialize vuser.');
  if (tg.type === 'TearDown')  notes.push('Run once after test. Use in Finalize vuser.');
  if (tg.iterations !== 'Infinite' && tg.iterations !== '-1')
    notes.push(`Fixed iterations: ${tg.iterations}`);
  if (tg.type === 'Stepping')
    notes.push(`Step ${tg.stepSize ?? '?'} VUs every ${tg.stepDuration ?? '?'}s`);
  if (tg.type === 'Concurrency')
    notes.push('Maintain concurrency — map to VU-based goal in LRE');
  if (tg.type === 'Arrivals')
    notes.push('Throughput-based — map to Hits/sec goal in LRE');
  return notes.join(' | ') || '—';
}

// ─── Sheet 2: Transactions ────────────────────────────────────────────────────
function buildTransactionsSheet(ws, requests, threadGroups) {
  ws.properties.defaultRowHeight = 18;

  ws.mergeCells('A1:E1');
  const title = ws.getCell('A1');
  title.value = 'Transaction List — for LRE Test Configuration';
  title.style = { font: { bold: true, size: 13, color: { argb: 'FF1F4E79' } }, alignment: { horizontal: 'center' } };
  ws.getRow(1).height = 24;
  ws.addRow([]);

  ws.columns = [
    { key: 'seq',     width: 6  },
    { key: 'name',    width: 36 },
    { key: 'tg',      width: 28 },
    { key: 'method',  width: 12 },
    { key: 'url',     width: 48 }
  ];

  const hdrRow = ws.getRow(3);
  hdrRow.height = 28;
  ['#','Transaction Name','Thread Group','HTTP Method','URL / Path'].forEach((h, idx) => {
    const cell = hdrRow.getCell(idx + 1);
    cell.value = h;
    cell.style = hdrStyle();
  });

  // Generate T-prefixed transaction names the same way our generator does
  let counter = 0;
  requests.forEach(req => {
    counter++;
    const nn  = String(counter).padStart(2, '0');
    // Strip leading digits from request name for label
    const label = req.name.replace(/^\d+[\s\-_.]*/, '').replace(/[^a-zA-Z0-9_]/g, '_') || 'Request';
    const txName = `T${nn}_${label}`;
    const tgName = req.folder ? req.folder.split('/')[0] : (threadGroups[0]?.name || 'Thread Group');

    const row = ws.addRow({ seq: counter, name: txName, tg: tgName, method: req.method, url: req.url });
    row.eachCell({ includeEmpty: true }, cell => {
      cell.style = cellStyle('FFFFFF', false, 'left');
    });
    row.getCell(2).style = cellStyle('EBF5FB', true, 'left');
    row.getCell(4).style = cellStyle('FFFFFF', false, 'center');
  });

  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 3 }];
}

// ─── Sheet 3: LRE Setup Guide ─────────────────────────────────────────────────
function buildGuideSheet(ws) {
  ws.properties.defaultRowHeight = 18;

  ws.mergeCells('A1:C1');
  const title = ws.getCell('A1');
  title.value = 'LRE (LoadRunner Enterprise) — Workload Model Setup Guide';
  title.style = { font: { bold: true, size: 14, color: { argb: 'FF1F4E79' } }, alignment: { horizontal: 'center' } };
  ws.getRow(1).height = 28;

  ws.columns = [
    { key: 'jmeter', width: 32 },
    { key: 'lre',    width: 36 },
    { key: 'how',    width: 60 }
  ];

  const guide = [
    { section: 'LOAD PROFILE' },
    { jmeter: 'Thread Group → Number of Threads (Users)', lre: 'Virtual Users', how: 'Test → Edit → Load → Virtual Users count' },
    { jmeter: 'Thread Group → Ramp-Up Period (sec)',      lre: 'Ramp-Up Duration', how: 'Test → Edit → Load → Initialize: Ramp up to X VUs over Y seconds' },
    { jmeter: 'Thread Group → Duration (scheduler)',      lre: 'Test Duration', how: 'Test → Edit → Load → Duration (seconds)' },
    { jmeter: 'Thread Group → Loop Count',                lre: 'Iterations', how: 'Test → Edit → Load → Iterations (set 0 for infinite)' },
    { jmeter: 'Stepping Thread Group',                    lre: 'Step-Up Schedule', how: 'Test → Edit → Load → Custom Scheduler → add step entries' },
    { jmeter: 'Concurrency Thread Group',                 lre: 'Goal-Oriented: VU-based', how: 'Test → Edit → Load → Goal-Oriented → Virtual Users' },
    { jmeter: 'Arrivals Thread Group',                    lre: 'Goal-Oriented: Hits/sec', how: 'Test → Edit → Load → Goal-Oriented → Hits per second' },
    { section: 'THINK TIME' },
    { jmeter: 'Constant Timer → delay (ms)',              lre: 'Think Time (sec)',  how: 'Script runtime settings OR add lr_think_time() / load.utils.thinkTime() in script' },
    { jmeter: 'Gaussian Random Timer',                    lre: 'Think Time (random)', how: 'Runtime Settings → Pacing → Random pause between iterations' },
    { section: 'PARAMETERIZATION' },
    { jmeter: 'CSV Data Set Config',                      lre: 'Parameter File (.prm / parameters.yml)', how: 'Script → Parameters tab → add CSV file, set Iteration/Sequential mode' },
    { jmeter: '${variableName}',                          lre: '{variableName} (VuGen) / load.params.variableName (DevWeb)', how: 'Auto-converted in generated script. Verify in parameters.yml.' },
    { section: 'CORRELATION' },
    { jmeter: 'Regular Expression Extractor',             lre: 'web_reg_save_param_regexp / load.RegExpExtractor', how: 'Auto-generated in script. Verify extraction boundaries.' },
    { jmeter: 'Boundary Extractor',                       lre: 'load.BoundaryExtractor / web_reg_save_param_regexp', how: 'Auto-generated. Check left/right boundaries in script.' },
    { jmeter: 'JSON Path Extractor',                      lre: 'load.JsonPathExtractor / web_reg_save_param_json', how: 'Auto-generated. Verify JSON path expression.' },
    { jmeter: 'XPath Extractor',                          lre: 'load.XPathExtractor / web_reg_save_param_xpath', how: 'Auto-generated. Verify XPath expression.' },
    { section: 'AUTHENTICATION' },
    { jmeter: 'HTTP Authorization Manager → Basic',       lre: 'web_set_user() / load.connection.defaults.credentials', how: 'Auto-generated in vuser_init.c / initialize(). Update credentials in parameters.' },
    { jmeter: 'HTTP Authorization Manager → NTLM',        lre: 'web_set_user() + IntegratedAuthentication=1', how: 'Auto-generated. Runtime Settings → Internet Protocol → Enable Integrated Authentication' },
    { jmeter: 'HTTP Authorization Manager → Kerberos',    lre: 'web_set_user() + IntegratedAuthentication=1 + SPNCNameLookup=1', how: 'Auto-generated. Kerberos requires domain machine; use UPN format for username.' },
    { section: 'SETUP / TEARDOWN' },
    { jmeter: 'SetUp Thread Group',                       lre: 'Initialize vuser (vuser_init.c / initialize())', how: 'Requests from SetUp group placed in initialize block of generated script.' },
    { jmeter: 'TearDown Thread Group',                    lre: 'Finalize vuser (vuser_end.c / finalize())', how: 'Requests from TearDown group placed in finalize block of generated script.' },
    { section: 'TRANSACTIONS' },
    { jmeter: 'Transaction Controller',                   lre: 'lr_start/end_transaction / load.Transaction', how: 'Auto-generated with T01_, T02_... prefix. Transactions sheet lists all names.' },
    { section: 'CONTROLLER / LOGIC' },
    { jmeter: 'If Controller / Loop Controller',          lre: 'Manual (flattened in script)', how: 'Logic controllers are flattened sequentially. See TODO comments in generated script.' },
    { jmeter: 'JSR223 / BeanShell Sampler',              lre: 'Manual conversion needed', how: 'Complex Groovy/Java code: see TODO comments in script. JWT code auto-converted where possible.' },
  ];

  // Header row
  const hdrRow = ws.getRow(3);
  hdrRow.height = 28;
  ['JMeter Setting', 'LRE Equivalent', 'How To Configure'].forEach((h, idx) => {
    hdrRow.getCell(idx + 1).value = h;
    hdrRow.getCell(idx + 1).style = hdrStyle();
  });

  guide.forEach(row => {
    if (row.section) {
      const secRow = ws.addRow([row.section, '', '']);
      ws.mergeCells(`A${secRow.number}:C${secRow.number}`);
      secRow.getCell(1).style = {
        font:      { bold: true, size: 11, color: { argb: 'FF1F4E79' } },
        fill:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + C.sectionHdr } },
        alignment: { horizontal: 'left', vertical: 'middle' }
      };
      secRow.height = 22;
    } else {
      const dr = ws.addRow({ jmeter: row.jmeter, lre: row.lre, how: row.how });
      dr.eachCell({ includeEmpty: true }, cell => {
        cell.style = cellStyle('FFFFFF', false, 'left');
      });
      dr.height = 20;
    }
  });

  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 3 }];
}

// ─── Main generator ───────────────────────────────────────────────────────────
class WorkloadExcelGenerator {
  constructor(threadGroups, requests, scriptName, options = {}) {
    this.threadGroups = threadGroups || [];
    this.requests     = requests     || [];
    this.scriptName   = scriptName   || 'JMeter Script';
    this.options      = options;
  }

  /**
   * Generate and return the workbook as a Buffer.
   * The buffer is stored in the in-memory FS by the caller.
   */
  async generateBuffer() {
    const wb = new ExcelJS.Workbook();
    wb.creator  = 'Bruno DevWeb Converter';
    wb.created  = new Date();
    wb.modified = new Date();
    wb.properties.date1904 = false;

    const ws1 = wb.addWorksheet('Thread Groups',    { tabColor: { argb: 'FF1F4E79' } });
    const ws2 = wb.addWorksheet('Transactions',     { tabColor: { argb: 'FF2E86AB' } });
    const ws3 = wb.addWorksheet('LRE Setup Guide',  { tabColor: { argb: 'FF27AE60' } });

    buildThreadGroupSheet(ws1, this.threadGroups, this.scriptName);
    buildTransactionsSheet(ws2, this.requests, this.threadGroups);
    buildGuideSheet(ws3);

    return wb.xlsx.writeBuffer();
  }
}

module.exports = WorkloadExcelGenerator;
