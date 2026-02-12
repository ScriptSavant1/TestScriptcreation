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
        failOnError: options.failOnError
      });

      spinner.stop();
      console.log(); // Empty line for better formatting

      const results = await converter.convert();

      if (results.success) {
        console.log('\n' + chalk.green.bold('✨ Success!') + '\n');
        console.log(chalk.cyan('📊 Conversion Summary:'));
        console.log(`  Total Requests: ${chalk.bold(results.analysis.requests.total)}`);
        console.log(`  Correlations: ${chalk.bold(results.analysis.correlations.totalCorrelations)}`);
        console.log(`  Parameters: ${chalk.bold(results.analysis.parameters.totalParameters)}`);
        console.log(`  Auth Configs: ${chalk.bold(results.analysis.authentication.totalConfigs)}`);
        console.log(`\n📁 Output: ${chalk.bold(results.outputDir)}`);
        console.log(`\n${chalk.yellow('Next steps:')}`);
        console.log(`  1. cd ${results.outputDir}`);
        console.log(`  2. Review main.js`);
        console.log(`  3. Run: devweb run main.js`);
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
