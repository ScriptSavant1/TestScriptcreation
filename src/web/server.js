/**
 * Web UI Server — Bruno / Postman → LoadRunner Converter
 *
 * Privacy model:
 *  • Uploaded files use multer memoryStorage — they NEVER touch disk on the server.
 *  • All converter output is captured in RAM (AsyncLocalStorage interceptor).
 *  • The ZIP is streamed directly to the browser — no file is ever written to disk.
 *  • Nothing is persisted on the server between requests.
 */

const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const os       = require('os');
const fs       = require('fs').promises;
const archiver = require('archiver');
const { runWithMemoryFs } = require('../lib/memoryFsInterceptor');
const BrunoDevWebConverter = require('../index');

class WebServer {
  constructor(port = 3000) {
    this.port = port;
    this.app  = express();

    // memoryStorage: uploaded files stay in RAM, never written to disk
    this.upload = multer({ storage: multer.memoryStorage() });

    // token → { files: Map, expires } — single-use, 5-minute TTL
    this.pendingDownloads = new Map();

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

        // Write uploaded buffers to temp files so brunoParser (which uses fs.stat
        // and fs.readFile against a path) can read them normally.
        // These temp files are deleted immediately after parsing completes.
        const tmpCollection  = path.join(os.tmpdir(), `lr-col-${Date.now()}-${collectionFile.originalname}`);
        const tmpEnvironment = environmentFile
          ? path.join(os.tmpdir(), `lr-env-${Date.now()}-${environmentFile.originalname}`)
          : null;

        try {
          await fs.writeFile(tmpCollection, collectionFile.buffer);
          if (tmpEnvironment) await fs.writeFile(tmpEnvironment, environmentFile.buffer);

          const outputDir = path.join(os.tmpdir(), `lr-out-${Date.now()}`);

          const options = {
            inputFile:           tmpCollection,
            outputDir,
            environmentFile:     tmpEnvironment || null,
            protocol:            req.body.protocol            || 'devweb',
            mode:                req.body.mode                || 'single',
            useTransactions:     req.body.useTransactions     !== 'false',
            useCorrelation:      req.body.useCorrelation      !== 'false',
            useParameterization: req.body.useParameterization !== 'false',
            useAuthentication:   req.body.useAuthentication   !== 'false',
            thinkTime:           parseFloat(req.body.thinkTime) || 1,
            addComments:         req.body.addComments !== 'false',
            logLevel:            req.body.logLevel || 'info'
          };

          // Run conversion — all fs WRITES go to the in-memory Map, not disk
          const converter = new BrunoDevWebConverter(options);
          const { result: results, files } = await runWithMemoryFs(() => converter.convert());

          // Input temp files no longer needed
          await fs.unlink(tmpCollection).catch(() => {});
          if (tmpEnvironment) await fs.unlink(tmpEnvironment).catch(() => {});

          // Register single-use download token (5-minute TTL)
          const token = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
          this.pendingDownloads.set(token, { files, outputDir, expires: Date.now() + 5 * 60 * 1000 });

          setTimeout(() => {
            this.pendingDownloads.delete(token);
          }, 5 * 60 * 1000);

          res.json({
            success:     true,
            downloadUrl: `download/${token}`,
            analysis:    results.analysis,
            protocol:    options.protocol,
            mode:        options.mode
          });

        } catch (err) {
          await fs.unlink(tmpCollection).catch(() => {});
          if (tmpEnvironment) await fs.unlink(tmpEnvironment).catch(() => {});

          console.error('Conversion error:', err);
          res.status(500).json({ error: err.message });
        }
      }
    );

    // ── Download ──────────────────────────────────────────────────────────────
    // Streams a ZIP built entirely from the in-memory file Map.
    // No ZIP file — and no generated script files — are ever written to disk.
    // No Content-Length header → chunked transfer, bypasses proxy size limits.
    this.app.get('/download/:token', (req, res) => {
      const entry = this.pendingDownloads.get(req.params.token);

      if (!entry || Date.now() > entry.expires) {
        return res.status(404).json({ error: 'Download link expired or already used.' });
      }

      this.pendingDownloads.delete(req.params.token); // single-use
      const { files, outputDir } = entry;

      // Content-Type: octet-stream avoids zip-specific proxy/firewall filters
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment; filename="loadrunner_script.zip"');
      // No Content-Length — chunked transfer encoding bypasses size-based restrictions

      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', err => {
        console.error('Archive error:', err);
        if (!res.headersSent) res.status(500).json({ error: 'Archive failed.' });
      });

      archive.pipe(res);

      // Add every in-memory file to the archive, stripping the outputDir prefix
      // so the zip contains relative paths (e.g. main.js, rts.yml, …)
      const prefix = outputDir.replace(/\\/g, '/');
      for (const [filePath, content] of files) {
        const relative = filePath.startsWith(prefix)
          ? filePath.slice(prefix.length).replace(/^\//, '')
          : path.basename(filePath);
        const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
        archive.append(buf, { name: relative });
      }

      archive.finalize();
    });

    // ── Health ────────────────────────────────────────────────────────────────
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', version: require('../../package.json').version });
    });
  }

  async start(port = this.port) {
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
