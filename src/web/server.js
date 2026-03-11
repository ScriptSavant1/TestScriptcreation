/**
 * Web UI Server — Bruno / Postman → LoadRunner Converter
 */

const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs').promises;
const fsSync   = require('fs');
const archiver = require('archiver');
const BrunoDevWebConverter = require('../index');

class WebServer {
  constructor(port = 3000) {
    this.port = port;
    this.app  = express();

    // Accept up to 2 files: collection + optional environment
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
    // ── Home page ─────────────────────────────────────────────────────────────
    this.app.get('/', (req, res) => {
      res.render('index', {
        title:   'Bruno / Postman → LoadRunner Converter',
        version: require('../../package.json').version
      });
    });

    // ── Convert ───────────────────────────────────────────────────────────────
    // Accepts: collection (required) + environment (optional)
    this.app.post('/convert',
      this.upload.fields([
        { name: 'collection',  maxCount: 1 },
        { name: 'environment', maxCount: 1 }
      ]),
      async (req, res) => {
        const collectionFile  = req.files?.collection?.[0];
        const environmentFile = req.files?.environment?.[0];

        if (!collectionFile) {
          return res.status(400).json({ error: 'Collection file is required.' });
        }

        const outputDir = `./output/${Date.now()}`;

        try {
          const options = {
            inputFile:           collectionFile.path,
            outputDir,
            environmentFile:     environmentFile ? environmentFile.path : null,
            protocol:            req.body.protocol   || 'devweb',
            mode:                req.body.mode        || 'single',
            useTransactions:     req.body.useTransactions     !== 'false',
            useCorrelation:      req.body.useCorrelation      !== 'false',
            useParameterization: req.body.useParameterization !== 'false',
            useAuthentication:   req.body.useAuthentication   !== 'false',
            thinkTime:           parseFloat(req.body.thinkTime) || 1,
            addComments:         req.body.addComments !== 'false',
            logLevel:            req.body.logLevel || 'info'
          };

          const converter = new BrunoDevWebConverter(options);
          const results   = await converter.convert();

          // Cleanup uploads
          await fs.unlink(collectionFile.path).catch(() => {});
          if (environmentFile) await fs.unlink(environmentFile.path).catch(() => {});

          // Zip the output
          const zipName = `script_${Date.now()}.zip`;
          const zipPath = `./output/${zipName}`;
          await this.createZip(outputDir, zipPath);

          res.json({
            success:     true,
            downloadUrl: `/download/${zipName}`,
            analysis:    results.analysis,
            protocol:    options.protocol,
            mode:        options.mode
          });

        } catch (err) {
          // Cleanup on error
          await fs.unlink(collectionFile.path).catch(() => {});
          if (environmentFile) await fs.unlink(environmentFile.path).catch(() => {});

          console.error('Conversion error:', err);
          res.status(500).json({ error: err.message });
        }
      }
    );

    // ── Download ──────────────────────────────────────────────────────────────
    this.app.get('/download/:filename', async (req, res) => {
      const safe = path.basename(req.params.filename);  // prevent path traversal
      const filePath = path.join(process.cwd(), 'output', safe);

      try {
        await fs.access(filePath);
        res.download(filePath, `loadrunner_script.zip`, (err) => {
          if (!err) {
            setTimeout(() => {
              fs.unlink(filePath).catch(() => {});
              const dir = filePath.replace('.zip', '');
              fs.rm(dir, { recursive: true }).catch(() => {});
            }, 10000);
          }
        });
      } catch {
        res.status(404).json({ error: 'File not found or already downloaded.' });
      }
    });

    // ── Health ────────────────────────────────────────────────────────────────
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', version: require('../../package.json').version });
    });
  }

  async createZip(sourceDir, outPath) {
    return new Promise((resolve, reject) => {
      const output  = fsSync.createWriteStream(outPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => resolve(outPath));
      archive.on('error', reject);

      archive.pipe(output);
      archive.directory(sourceDir, false);
      archive.finalize();
    });
  }

  async start(port = this.port) {
    await fs.mkdir('uploads', { recursive: true });
    await fs.mkdir('output',  { recursive: true });

    return new Promise((resolve) => {
      this.server = this.app.listen(port, () => {
        console.log(`\n🌐  Converter UI  →  http://localhost:${port}\n`);
        resolve(this.server);
      });
    });
  }

  async stop() {
    if (this.server) {
      return new Promise((resolve) => this.server.close(resolve));
    }
  }
}

module.exports = new WebServer();

if (require.main === module) {
  const port = process.env.PORT || 3000;
  module.exports.start(port);
}
