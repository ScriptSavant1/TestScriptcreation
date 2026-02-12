/**
 * Web UI Server for Bruno to DevWeb Converter
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const archiver = require('archiver');
const BrunoDevWebConverter = require('../index');

class WebServer {
  constructor(port = 3000) {
    this.port = port;
    this.app = express();
    this.upload = multer({ dest: 'uploads/' });
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(express.static(path.join(__dirname, 'public')));
    this.app.set('view engine', 'ejs');
    this.app.set('views', path.join(__dirname, 'views'));
  }

  setupRoutes() {
    // Home page
    this.app.get('/', (req, res) => {
      res.render('index', {
        title: 'Bruno to DevWeb Converter',
        version: require('../../package.json').version
      });
    });

    // Upload and convert
    this.app.post('/convert', this.upload.single('collection'), async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: 'No file uploaded' });
        }

        const options = {
          inputFile: req.file.path,
          outputDir: `./output/${Date.now()}`,
          useTransactions: req.body.useTransactions !== 'false',
          useCorrelation: req.body.useCorrelation !== 'false',
          useParameterization: req.body.useParameterization !== 'false',
          useAuthentication: req.body.useAuthentication !== 'false',
          thinkTime: parseFloat(req.body.thinkTime) || 1,
          addComments: req.body.addComments !== 'false',
          logLevel: req.body.logLevel || 'info'
        };

        const converter = new BrunoDevWebConverter(options);
        const results = await converter.convert();

        // Cleanup uploaded file
        await fs.unlink(req.file.path);

        // Create zip of output
        const zipPath = `${options.outputDir}.zip`;
        await this.createZip(options.outputDir, zipPath);

        res.json({
          success: true,
          downloadUrl: `/download/${path.basename(zipPath)}`,
          analysis: results.analysis,
          outputDir: options.outputDir
        });

      } catch (error) {
        console.error('Conversion error:', error);
        res.status(500).json({
          error: error.message,
          stack: error.stack
        });
      }
    });

    // Download generated script
    this.app.get('/download/:filename', async (req, res) => {
      const filePath = path.join(__dirname, '../../output', req.params.filename);
      
      try {
        await fs.access(filePath);
        res.download(filePath, (err) => {
          if (!err) {
            // Cleanup after download
            setTimeout(() => {
              fs.unlink(filePath).catch(console.error);
              const dir = filePath.replace('.zip', '');
              fs.rm(dir, { recursive: true }).catch(console.error);
            }, 5000);
          }
        });
      } catch (error) {
        res.status(404).json({ error: 'File not found' });
      }
    });

    // Analyze collection
    this.app.post('/analyze', this.upload.single('collection'), async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: 'No file uploaded' });
        }

        const BrunoParser = require('../parsers/brunoParser');
        const CorrelationDetector = require('../analyzers/correlationDetector');
        const ParameterizationEngine = require('../analyzers/parameterizationEngine');
        const AuthenticationHandler = require('../analyzers/authenticationHandler');

        const parser = new BrunoParser(req.file.path);
        const requests = await parser.parse();
        const metadata = parser.getMetadata();

        const correlationDetector = new CorrelationDetector();
        const paramEngine = new ParameterizationEngine();
        const authHandler = new AuthenticationHandler();

        const correlations = correlationDetector.analyzeRequests(requests);
        await paramEngine.extractParameters(parser.collection);
        authHandler.extractAuthentication(parser.collection);

        // Cleanup uploaded file
        await fs.unlink(req.file.path);

        res.json({
          metadata,
          requests: {
            total: requests.length,
            sample: requests.slice(0, 5)
          },
          correlations: correlationDetector.getCorrelationReport(),
          parameters: paramEngine.getReport(),
          authentication: authHandler.getAuthSummary()
        });

      } catch (error) {
        console.error('Analysis error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', version: require('../../package.json').version });
    });
  }

  /**
   * Create zip file of directory
   */
  async createZip(sourceDir, outPath) {
    return new Promise((resolve, reject) => {
      const output = require('fs').createWriteStream(outPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => resolve(outPath));
      archive.on('error', reject);

      archive.pipe(output);
      archive.directory(sourceDir, false);
      archive.finalize();
    });
  }

  /**
   * Start the server
   */
  async start(port = this.port) {
    // Create necessary directories
    await fs.mkdir('uploads', { recursive: true });
    await fs.mkdir('output', { recursive: true });

    return new Promise((resolve) => {
      this.server = this.app.listen(port, () => {
        console.log(`\n🌐 Web UI server running at http://localhost:${port}`);
        console.log(`📊 Upload your collection and convert to DevWeb!\n`);
        resolve(this.server);
      });
    });
  }

  /**
   * Stop the server
   */
  async stop() {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(resolve);
      });
    }
  }
}

// Export for use in CLI
module.exports = new WebServer();

// Start server if run directly
if (require.main === module) {
  const port = process.env.PORT || 3000;
  module.exports.start(port);
}
