#!/usr/bin/env node

/**
 * Command Line Interface for Bruno to DevWeb Converter
 */

const { Command } = require('commander');
const chalk = require('chalk');
const ora = require('ora');
const path = require('path');
const BrunoDevWebConverter = require('./index');
const packageJson = require('../package.json');

const program = new Command();

program
  .name('bruno-devweb')
  .description('Convert Bruno/Postman collections to LoadRunner DevWeb scripts')
  .version(packageJson.version);

program
  .command('convert')
  .description('Convert a collection to DevWeb script')
  .requiredOption('-i, --input <file>', 'Input collection file (.json or .bru)')
  .option('-e, --environment <file>', 'Postman environment file (.json)')
  .option('-o, --output <dir>', 'Output directory', './devweb-script')
  .option('--no-transactions', 'Disable transaction grouping')
  .option('--no-correlation', 'Disable automatic correlation detection')
  .option('--no-parameterization', 'Disable parameterization')
  .option('--no-authentication', 'Disable authentication handling')
  .option('-t, --think-time <seconds>', 'Think time between requests', '1')
  .option('--no-comments', 'Disable code comments')
  .option('--log-level <level>', 'Log level (error/warning/info/debug)', 'info')
  .option('--fail-on-error', 'Stop execution on first error')
  .option('-m, --mode <mode>', 'Script generation mode: single (one script) or multi (one script per top-level folder)', 'single')
  .option('--protocol <protocol>', 'Output protocol: devweb (JavaScript) or web-http (VuGen C)', 'devweb')
  .action(async (options) => {
    const spinner = ora('Starting conversion...').start();

    try {
      const converter = new BrunoDevWebConverter({
        inputFile: options.input,
        environmentFile: options.environment,
        outputDir: options.output,
        useTransactions: options.transactions,
        useCorrelation: options.correlation,
        useParameterization: options.parameterization,
        useAuthentication: options.authentication,
        thinkTime: parseFloat(options.thinkTime),
        addComments: options.comments,
        logLevel: options.logLevel,
        failOnError: options.failOnError,
        mode: options.mode,
        protocol: options.protocol
      });

      spinner.stop();
      console.log(); // Empty line for better formatting

      const results = await converter.convert();

      if (results.success) {
        console.log('\n' + chalk.green.bold('✨ Success!') + '\n');

        if (results.scripts) {
          // Multi-mode output
          console.log(chalk.cyan('📊 Multi-Script Conversion Summary:'));
          console.log(`  Total Scripts: ${chalk.bold(results.scripts.length)}`);
          console.log(`  Total Requests: ${chalk.bold(results.totalRequests)}`);
          results.scripts.forEach(s => {
            console.log(`\n  ${chalk.bold(s.folder)}/ (${s.requests} requests)`);
            console.log(`    Correlations: ${s.correlations}, Parameters: ${s.parameters}`);
          });
          if (results.crossFolderWarnings && results.crossFolderWarnings.length > 0) {
            console.log(`\n${chalk.yellow('⚠  Cross-folder dependencies:')}`);
            results.crossFolderWarnings.forEach(w => console.log(`  ${w}`));
          }
          console.log(`\n📁 Output: ${chalk.bold(results.outputDir)}`);
          console.log(`\n${chalk.yellow('Next steps:')}`);
          console.log(`  1. cd ${results.outputDir}`);
          console.log(`  2. Review each script folder`);
          console.log(`  3. Upload scripts to LoadRunner Enterprise`);
        } else {
          // Single-mode output
          console.log(chalk.cyan('📊 Conversion Summary:'));
          console.log(`  Total Requests: ${chalk.bold(results.analysis.requests.total)}`);
          console.log(`  Correlations: ${chalk.bold(results.analysis.correlations.totalCorrelations)}`);
          console.log(`  Parameters: ${chalk.bold(results.analysis.parameters.totalParameters)}`);
          console.log(`  Auth Configs: ${chalk.bold(results.analysis.authentication.totalConfigs)}`);
          console.log(`\n📁 Output: ${chalk.bold(results.outputDir)}`);
          console.log(`\n${chalk.yellow('Next steps:')}`);
          console.log(`  1. cd ${results.outputDir}`);
          if (options.protocol === 'web-http') {
            console.log(`  2. Review Action.c`);
            console.log(`  3. Open in VuGen or upload to LoadRunner Enterprise`);
          } else {
            console.log(`  2. Review main.js`);
            console.log(`  3. Run: devweb run main.js`);
          }
        }
      }
    } catch (error) {
      spinner.fail(chalk.red('Conversion failed'));
      console.error(chalk.red('\n❌ Error:'), error.message);
      process.exit(1);
    }
  });

program
  .command('analyze')
  .description('Analyze collection without generating script')
  .requiredOption('-i, --input <file>', 'Input collection file')
  .action(async (options) => {
    const BrunoParser = require('./parsers/brunoParser');
    const CorrelationDetector = require('./analyzers/correlationDetector');
    const ParameterizationEngine = require('./analyzers/parameterizationEngine');
    const AuthenticationHandler = require('./analyzers/authenticationHandler');

    const spinner = ora('Analyzing collection...').start();

    try {
      // Parse
      const parser = new BrunoParser(options.input);
      const requests = await parser.parse();
      const metadata = parser.getMetadata();

      // Analyze
      const correlationDetector = new CorrelationDetector();
      const paramEngine = new ParameterizationEngine();
      const authHandler = new AuthenticationHandler();

      const correlations = correlationDetector.analyzeRequests(requests);
      await paramEngine.extractParameters(parser.collection);
      authHandler.extractAuthentication(parser.collection);

      spinner.succeed(chalk.green('Analysis complete!'));

      console.log('\n' + chalk.cyan.bold('📊 Collection Analysis') + '\n');
      console.log(chalk.bold('Collection Info:'));
      console.log(`  Name: ${metadata.name}`);
      console.log(`  Type: ${metadata.type}`);
      console.log(`  Requests: ${requests.length}`);

      console.log('\n' + chalk.bold('Correlations:'));
      console.log(`  Total: ${correlations.length}`);
      if (correlations.length > 0) {
        correlations.forEach((corr, i) => {
          console.log(`  ${i + 1}. ${corr.name} (${corr.type}): ${corr.producerRequest} → ${corr.consumerRequest}`);
        });
      }

      console.log('\n' + chalk.bold('Parameters:'));
      console.log(`  Total: ${paramEngine.parameters.size}`);
      const paramReport = paramEngine.getReport();
      Object.entries(paramReport.byType).forEach(([type, count]) => {
        console.log(`  ${type}: ${count}`);
      });

      console.log('\n' + chalk.bold('Authentication:'));
      const authSummary = authHandler.getAuthSummary();
      console.log(`  Total: ${authSummary.totalConfigs}`);
      Object.entries(authSummary.byType).forEach(([type, count]) => {
        console.log(`  ${type.toUpperCase()}: ${count}`);
      });

    } catch (error) {
      spinner.fail(chalk.red('Analysis failed'));
      console.error(chalk.red('\n❌ Error:'), error.message);
      process.exit(1);
    }
  });

program
  .command('convert-jmx')
  .description('Convert a JMeter .jmx file to DevWeb or VuGen Web HTTP/HTML script')
  .requiredOption('-i, --input <file>', 'Input JMeter script file (.jmx)')
  .option('-o, --output <dir>', 'Output directory', './jmx-converted')
  .option('--protocol <protocol>', 'Output protocol: devweb (JavaScript) or web-http (VuGen C)', 'devweb')
  .option('-t, --think-time <seconds>', 'Default think time between requests (sec)', '1')
  .option('--no-excel', 'Skip Workload Modelling Excel file generation')
  .option('--no-transactions', 'Disable transaction grouping')
  .option('--no-correlation', 'Disable correlation detection')
  .option('--no-parameterization', 'Disable parameterization')
  .option('--no-authentication', 'Disable authentication handling')
  .option('--no-comments', 'Disable code comments in generated script')
  .action(async (options) => {
    const JmxConverter = require('./converters/jmxConverter');
    const spinner = ora('Parsing JMX file...').start();

    try {
      const converter = new JmxConverter({
        inputFile:           options.input,
        outputDir:           options.output,
        protocol:            options.protocol,
        thinkTime:           parseFloat(options.thinkTime),
        generateWlmExcel:    options.excel,
        useTransactions:     options.transactions,
        useCorrelation:      options.correlation,
        useParameterization: options.parameterization,
        useAuthentication:   options.authentication,
        addComments:         options.comments
      });

      spinner.text = 'Converting...';
      const results = await converter.convert();
      spinner.succeed(chalk.green('Conversion complete!'));

      const a  = results.analysis || {};
      const tg = results.threadGroups || [];

      console.log('\n' + chalk.cyan.bold('📊 JMX Conversion Summary') + '\n');
      console.log(chalk.bold('Script:'));
      console.log(`  Name:          ${results.metadata.name}`);
      console.log(`  Protocol:      ${options.protocol === 'devweb' ? 'DevWeb (JavaScript)' : 'VuGen Web HTTP/HTML (C)'}`);
      console.log(`  Requests:      ${chalk.bold(results.metadata.totalRequests)}`);
      console.log(`  Thread Groups: ${chalk.bold(tg.length)}`);
      console.log(`  CSV Datasets:  ${chalk.bold(results.csvDataSets?.length || 0)}`);

      if (tg.length > 0) {
        console.log('\n' + chalk.bold('Thread Groups (→ use in LRE Workload Model):'));
        tg.forEach((g, i) => {
          console.log(`  ${i + 1}. [${g.type}] ${g.name}`);
          console.log(`     VUs: ${g.virtualUsers}  Ramp-up: ${g.rampUpSec}s  Hold: ${g.holdSec}s  Iterations: ${g.iterations}`);
        });
      }

      if (a.correlations?.totalCorrelations > 0) {
        console.log('\n' + chalk.bold('Correlations detected:'), a.correlations.totalCorrelations);
        (a.correlations.correlations || []).slice(0, 5).forEach(c =>
          console.log(`  - ${c.name} (${c.type || c.extractorType})`));
        if (a.correlations.totalCorrelations > 5)
          console.log(`  ... and ${a.correlations.totalCorrelations - 5} more`);
      }

      if (a.authentication?.totalConfigs > 0) {
        console.log('\n' + chalk.bold('Authentication:'), Object.entries(a.authentication.byType || {})
          .map(([t, n]) => `${t.toUpperCase()} ×${n}`).join(', '));
      }

      console.log('\n' + chalk.bold('📁 Output:'), chalk.cyan(results.outputDir));
      console.log(chalk.bold('📁 Files generated:'));

      if (options.protocol === 'web-http') {
        console.log('  Action.c, vuser_init.c, vuser_end.c, globals.h');
        console.log('  default.cfg, ParameterFile.prm');
      } else {
        console.log('  main.js, rts.yml, scenario.yml, parameters.yml');
        console.log('  DevWebSdk.d.ts, tsconfig.json');
      }
      if (options.excel) {
        console.log(`  ${results.metadata.name.replace(/[^\w\s-]/g,'_')}_WLM.xlsx  ← Workload Model (open in Excel)`);
      }

      console.log('\n' + chalk.yellow('Next steps:'));
      console.log(`  1. cd ${results.outputDir}`);
      if (options.protocol === 'web-http') {
        console.log('  2. Review Action.c, check correlations and auth');
        console.log('  3. Open .usr file in VuGen or upload to LRE');
      } else {
        console.log('  2. Review main.js, check correlations and auth');
        console.log('  3. Upload to LoadRunner Enterprise');
      }
      if (options.excel) {
        console.log('  4. Open *_WLM.xlsx — copy thread group values into LRE test configuration');
      }

    } catch (error) {
      spinner.fail(chalk.red('Conversion failed'));
      console.error(chalk.red('\n❌ Error:'), error.message);
      if (process.env.DEBUG) console.error(error.stack);
      process.exit(1);
    }
  });

program
  .command('web')
  .description('Start web UI server')
  .option('-p, --port <port>', 'Server port', '3000')
  .action(async (options) => {
    console.log(chalk.cyan('🌐 Starting web server...'));
    
    try {
      const webServer = require('./web/server');
      await webServer.start(parseInt(options.port));
    } catch (error) {
      console.error(chalk.red('Failed to start web server:'), error.message);
      process.exit(1);
    }
  });

program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
