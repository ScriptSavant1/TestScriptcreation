/**
 * Web UI Server — Bruno / Postman → LoadRunner Converter
 *
 * Privacy model:
 *  • Uploaded files use multer memoryStorage — they NEVER touch disk on the server.
 *  • All converter output is captured in RAM (AsyncLocalStorage interceptor).
 *  • The ZIP is streamed directly to the browser — no file is ever written to disk.
 *  • Nothing is persisted on the server between requests.
 */

const express = require("express");
const multer = require("multer");
const path = require("path");
const os = require("os");
const fs = require("fs").promises;
const archiver = require("archiver");
const { runWithMemoryFs } = require("../lib/memoryFsInterceptor");
const BrunoDevWebConverter = require("../index");
const JmxConverter = require("../converters/jmxConverter");
const JmxDependencyResolver = require("../lib/jmxDependencyResolver");

class WebServer {
  constructor(port = 3000) {
    this.port = port;
    this.app = express();

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

    // Block direct .html file access — only clean routes are allowed
    this.app.use((req, res, next) => {
      if (req.method === "GET" && req.path.toLowerCase().endsWith(".html")) {
        return res
          .status(404)
          .sendFile(path.join(__dirname, "public", "404.html"));
      }
      next();
    });

    this.app.use(express.static(path.join(__dirname, "public")));
    //Serve static files under /converter/ too - needed because Recorder
    // and Studio HTML pages are served at /converter/recorder etc. and
    // resolve asset paths relative to /converter/.
    this.app.use("/converter", express.static(path.join(__dirname, "public")));
    this.app.set("view engine", "ejs");
    this.app.set("views", path.join(__dirname, "views"));
  }

  setupRoutes() {
    // ── Converter home─────────────────────────────────────────────────────────────
    // Under IIS virtual dir, requests arrive as /converter/...
    // Routes use the /converter prefix so they match directly.
    const renderHome = (req, res) => {
      res.render("index", {
        title: "Bruno / Postman → LoadRunner Converter",
        version: require("../../package.json").version,
      });
    };
    this.app.get("/", renderHome);
    this.app.get("/converter", renderHome);
    this.app.get("/converter/", (req, res) => res.redirect("/converter"));

    // ── Tool routes ─────────────────────────────────────────────────────────────
    this.app.get("/converter/recorder", (req, res) => {
      res.sendFile(path.join(__dirname, "public", "VuGen-Recorder.html"));
    });
    this.app.get("/converter/studio", (req, res) => {
      res.sendFile(path.join(__dirname, "public", "VuGen-Script-Studio.html"));
    });
    // Standalone fallbacks (no /converter prefix)
    this.app.get("/tools/recorder", (req, res) => {
      res.sendFile(path.join(__dirname, "public", "VuGen-Recorder.html"));
    });
    this.app.get("/tools/studio", (req, res) => {
      res.sendFile(path.join(__dirname, "public", "VuGen-Script-Studio.html"));
    });

    // — DPoP / crypto helper files (served for ZIP download by Recorder/Studio) —
    const PROJECT_ROOT = path.join(__dirname, "..", "..");
    // Routes at both / and /converter/ — needed because Recorder/Studio iframes
    // resolve paths relative to /converter/ under IIS virtual directory.
    // fallback: when the primary filename doesn't exist at root, serve the
    // fallback file instead.  This handles two real-world cases:
    //   lre-utils-helper.js → lre-utils.js  (AV blocks .js; HTML tools fetch
    //     as lre-utils-helper.js then save into the zip as lre-utils.dat)
    //   jsrsasign-vugen.js  → jsrsasign.js   (VuGen alias; same library)
    const cryptoFileRoutes = [
      { name: "dpop-helper.js" },
      { name: "lre-utils-helper.js", fallback: "lre-utils.js" },
      { name: "dpop.js" },
      { name: "jsrsasign.js" },
      { name: "jsrsasign-vugen.js", fallback: "jsrsasign.js" },
    ];

    for (const { name, fallback } of cryptoFileRoutes) {
      const handler = (req, res) => {
        const f = path.join(PROJECT_ROOT, name);
        if (require("fs").existsSync(f)) return res.sendFile(f);
        if (fallback) {
          const fb = path.join(PROJECT_ROOT, fallback);
          if (require("fs").existsSync(fb)) return res.sendFile(fb);
        }
        res.status(404).json({ error: `${name} not found` });
      };
      this.app.get(`/${name}`, handler);
      this.app.get(`/converter/${name}`, handler);
    }

    // ── Convert ───────────────────────────────────────────────────────────────
    this.app.post(
      "/converter/convert",
      this.upload.fields([
        { name: "collection", maxCount: 1 },
        { name: "environment", maxCount: 1 },
      ]),
      async (req, res) => {
        const collectionFile = req.files?.collection?.[0];
        const environmentFile = req.files?.environment?.[0];

        if (!collectionFile) {
          return res
            .status(400)
            .json({ error: "Collection file is required." });
        }

        // Write uploaded buffers to temp files so brunoParser (which uses fs.stat
        // and fs.readFile against a path) can read them normally.
        // These temp files are deleted immediately after parsing completes.
        const tmpCollection = path.join(
          os.tmpdir(),
          `lr-col-${Date.now()}-${collectionFile.originalname}`,
        );
        const tmpEnvironment = environmentFile
          ? path.join(
              os.tmpdir(),
              `lr-env-${Date.now()}-${environmentFile.originalname}`,
            )
          : null;

        try {
          await fs.writeFile(tmpCollection, collectionFile.buffer);
          if (tmpEnvironment)
            await fs.writeFile(tmpEnvironment, environmentFile.buffer);

          const outputDir = path.join(os.tmpdir(), `lr-out-${Date.now()}`);

          const options = {
            inputFile: tmpCollection,
            outputDir,
            environmentFile: tmpEnvironment || null,
            protocol: req.body.protocol || "devweb",
            mode: req.body.mode || "single",
            useTransactions: req.body.useTransactions !== "false",
            useCorrelation: req.body.useCorrelation !== "false",
            useParameterization: req.body.useParameterization !== "false",
            useAuthentication: req.body.useAuthentication !== "false",
            thinkTime: parseFloat(req.body.thinkTime) || 1,
            addComments: req.body.addComments !== "false",
            logLevel: req.body.logLevel || "info",
          };

          // Run conversion — all fs WRITES go to the in-memory Map, not disk
          const converter = new BrunoDevWebConverter(options);
          const { result: results, files } = await runWithMemoryFs(() =>
            converter.convert(),
          );

          // Input temp files no longer needed
          await fs.unlink(tmpCollection).catch(() => {});
          if (tmpEnvironment) await fs.unlink(tmpEnvironment).catch(() => {});

          // Register single-use download token (5-minute TTL)
          const token = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
          this.pendingDownloads.set(token, {
            files,
            outputDir,
            expires: Date.now() + 5 * 60 * 1000,
          });

          setTimeout(
            () => {
              this.pendingDownloads.delete(token);
            },
            5 * 60 * 1000,
          );

          res.json({
            success: true,
            downloadUrl: `/converter/download/${token}`,
            analysis: results.analysis,
            protocol: options.protocol,
            mode: options.mode,
          });
        } catch (err) {
          await fs.unlink(tmpCollection).catch(() => {});
          if (tmpEnvironment) await fs.unlink(tmpEnvironment).catch(() => {});

          console.error("Conversion error:", err);
          res.status(500).json({ error: err.message });
        }
      },
    );

    // ── Download ──────────────────────────────────────────────────────────────
    // Streams a ZIP built entirely from the in-memory file Map.
    // No ZIP file — and no generated script files — are ever written to disk.
    // No Content-Length header → chunked transfer, bypasses proxy size limits.
    this.app.get("/converter/download/:token", (req, res) => {
      const entry = this.pendingDownloads.get(req.params.token);

      if (!entry || Date.now() > entry.expires) {
        return res
          .status(404)
          .json({ error: "Download link expired or already used." });
      }

      this.pendingDownloads.delete(req.params.token); // single-use
      const { files, outputDir } = entry;

      // Content-Type: octet-stream - generic binary download
      // application/zip was tried but triggers stricter scanning on corporate newtorks.
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="loadrunner_script.zip"',
      );
      // No Content-Length — chunked transfer encoding bypasses size-based restrictions

      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.on("error", (err) => {
        console.error("Archive error:", err);
        if (!res.headersSent)
          res.status(500).json({ error: "Archive failed." });
      });

      archive.pipe(res);

      // Add every in-memory file to the archive, stripping the outputDir prefix
      // so the zip contains relative paths (e.g. main.js, rts.yml, …)
      const prefix = outputDir.replace(/\\/g, "/");
      for (const [filePath, content] of files) {
        const relative = filePath.startsWith(prefix)
          ? filePath.slice(prefix.length).replace(/^\//, "")
          : path.basename(filePath);
        const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
        archive.append(buf, { name: relative });
      }

      archive.finalize();
    });

    // ── Convert JMX ──────────────────────────────────────────────────────────
    this.app.post(
      "/converter/convert-jmx",
      this.upload.fields([
        { name: "jmxFile", maxCount: 1 },
        { name: "csvFiles", maxCount: 30 },
        { name: "certFiles", maxCount: 10 },
      ]),
      async (req, res) => {
        const jmxFile = req.files?.jmxFile?.[0];
        const csvFiles = req.files?.csvFiles || [];
        const certFiles = req.files?.certFiles || [];

        if (!jmxFile) {
          return res.status(400).json({ error: "JMX file is required." });
        }

        const tmpFiles = []; // all temp paths to clean up
        const tmpJmx = path.join(
          os.tmpdir(),
          `lr-jmx-${Date.now()}-${jmxFile.originalname}`,
        );
        tmpFiles.push(tmpJmx);

        try {
          await fs.writeFile(tmpJmx, jmxFile.buffer);

          // Write uploaded CSV / cert files to a temp directory so the converter
          // can reference them by path if needed (dependency resolver uses in-memory).
          const tmpSupportDir = path.join(
            os.tmpdir(),
            `lr-jmx-support-${Date.now()}`,
          );
          const uploadedSupportFiles = [...csvFiles, ...certFiles];
          const csvFilePaths = {}; // originalname → tmpPath

          if (uploadedSupportFiles.length) {
            await fs.mkdir(tmpSupportDir, { recursive: true });
            for (const f of uploadedSupportFiles) {
              const tmpPath = path.join(tmpSupportDir, f.originalname);
              await fs.writeFile(tmpPath, f.buffer);
              tmpFiles.push(tmpPath);
              csvFilePaths[f.originalname] = tmpPath;
            }
            tmpFiles.push(tmpSupportDir);
          }

          const outputDir = path.join(os.tmpdir(), `lr-jmx-out-${Date.now()}`);

          const options = {
            inputFile: tmpJmx,
            outputDir,
            protocol: req.body.protocol || "devweb",
            mode: req.body.mode || "single",
            useTransactions: req.body.useTransactions !== "false",
            useCorrelation: req.body.useCorrelation !== "false",
            useParameterization: req.body.useParameterization !== "false",
            useAuthentication: req.body.useAuthentication !== "false",
            thinkTime: parseFloat(req.body.thinkTime) || 1,
            addComments: req.body.addComments !== "false",
            logLevel: req.body.logLevel || "info",
            generateWlmExcel: req.body.generateWlmExcel !== "false",
            csvFilePaths, // map of filename → tmpPath for converter use
          };

          const converter = new JmxConverter(options);
          const { result: results, files } = await runWithMemoryFs(() =>
            converter.convert(),
          );

          // Dependency report — runs after parse (results.csvDataSets populated)
          const resolver = new JmxDependencyResolver(
            results.csvDataSets || [],
            uploadedSupportFiles,
          );
          const dependency = resolver.resolve();

          // Copy uploaded CSV / cert files into the in-memory file map so they
          // are included in the output ZIP alongside the generated scripts.
          for (const f of uploadedSupportFiles) {
            const dest = path
              .join(outputDir, f.originalname)
              .replace(/\\/g, "/");
            files.set(dest, f.buffer);
          }

          // Clean up temp files (the JMX itself — support dir handled separately)
          await Promise.all(tmpFiles.map((p) => fs.unlink(p).catch(() => {})));
          await fs.rmdir(tmpSupportDir).catch(() => {});

          const token = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
          this.pendingDownloads.set(token, {
            files,
            outputDir,
            expires: Date.now() + 5 * 60 * 1000,
          });
          setTimeout(() => this.pendingDownloads.delete(token), 5 * 60 * 1000);

          res.json({
            success: true,
            downloadUrl: `/converter/download/${token}`,
            analysis: results.analysis,
            threadGroups: results.threadGroups,
            scripts: results.scripts || null, // non-null only in multi mode
            multiScript: results.multiScript || false,
            metadata: results.metadata,
            dependency,
            protocol: options.protocol,
            mode: options.mode,
          });
        } catch (err) {
          await Promise.all(tmpFiles.map((p) => fs.unlink(p).catch(() => {})));
          console.error("JMX conversion error:", err);
          res.status(500).json({ error: err.message });
        }
      },
    );

    // ── Health ────────────────────────────────────────────────────────────────
    this.app.get("/health", (req, res) => {
      res.json({
        status: "ok",
        version: require("../../package.json").version,
      });
    });
    this.app.get("/converter/health", (req, res) => {
      res.json({
        status: "ok",
        version: require("../../package.json").version,
      });
    });

    // ── Catch-all 404 ─────────────────────────────────────────────────────────
    this.app.use((req, res) => {
      res.status(404).sendFile(path.join(__dirname, "public", "404.html"));
    });

    // ── JSON error handler ────────────────────────────────────────────────────
    // MUST be last and have 4 params (err, req, res, next) for Express to treat
    // it as an error handler.  Without this, Express returns an HTML error page
    // whenever multer, body-parser or any middleware calls next(err), which
    // causes the browser to receive <!DOCTYPE html> when it expects JSON and
    // shows "unexpected token '<'...is not valid JSON".
    // eslint-disable-next-line no-unused-vars
    this.app.use((err, req, res, next) => {
      console.error("Unhandled middleware error:", err);
      const status = err.status || err.statusCode || 500;
      res
        .status(status)
        .json({ error: err.message || "Internal server error" });
    });
  }

  async start(port = this.port) {
    return new Promise((resolve) => {
      this.server = this.app.listen(port, () => {
        console.log(
          `\n🌐  Converter UI  →  http://localhost:${port}/converter\n`,
        );
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
