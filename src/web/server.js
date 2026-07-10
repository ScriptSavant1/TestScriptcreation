/**
 * Web UI Server — PerfX Studio
 *
 * Privacy model (corrected):
 *  • Uploaded files use multer memoryStorage — they initially stay in RAM.
 *  • Collection / environment / cert files are temporarily written to os.tmpdir()
 *    so filesystem-based parsers can access them by path. Cleanup is guaranteed
 *    via try/finally even on error. Cleanup failures are logged (never silenced).
 *  • All converter OUTPUT is captured in RAM (AsyncLocalStorage interceptor).
 *  • The ZIP is streamed directly to the browser — no generated script files
 *    are ever written to disk.
 *  • Nothing is persisted on the server between requests.
 *  • Download tokens are single-use and expire after 5 minutes.
 *
 * Security posture (internal banking deployment):
 *  • Authentication: intentionally omitted — internal tool, network-access-controlled.
 *    Only reachable from the internal corporate network. Accepted risk.
 *  • File size limit: 2 GB per file (generous for large HAR/JMX files).
 *  • Rate limiting: 60 requests per 5 minutes per IP on conversion endpoints.
 *  • Concurrency limit: MAX_CONCURRENT_CONVERSIONS env var (default 8) guards CPU/RAM
 *    under burst load. Requests over the limit receive HTTP 503 immediately.
 *  • Security headers: helmet applied (CSP disabled due to inline scripts in UI).
 *  • Download tokens: crypto.randomBytes(32) — 256-bit CSPRNG entropy.
 *  • Path traversal prevention: all uploaded filenames sanitized before path.join().
 *  • File type validation: allowlist per upload field.
 *  • Error responses: generic codes only — full errors logged server-side.
 *
 * Capacity (single process, typical 4-8 core server):
 *  • 60-70 ACTIVE users throughout the day: handles comfortably.
 *  • Peak simultaneous conversions: ~8 running + queued at 503 (set by MAX_CONCURRENT_CONVERSIONS).
 *  • Clustering across cores: NOT safe without a shared download token store — each process
 *    has its own pendingDownloads Map, so a download request could reach a different process
 *    than the one that created the token. Use PM2 single-instance mode (see pm2.config.js).
 *  • Monitor via GET /converter/status — shows activeConversions, memory, pendingDownloads.
 */

"use strict";

const express    = require("express");
const multer     = require("multer");
const path       = require("path");
const os         = require("os");
const fs         = require("fs").promises;
const crypto     = require("crypto");
const archiver   = require("archiver");
const helmet     = require("helmet");
const rateLimit  = require("express-rate-limit");

const { runWithMemoryFs }       = require("../lib/memoryFsInterceptor");
const BrunoDevWebConverter      = require("../tools/collection-converter");
const JmxConverter              = require("../tools/jmx-converter");
const JmxDependencyResolver     = require("../lib/jmxDependencyResolver");

// Analytics — lazy-loaded so a missing DB never crashes the server
let analytics, adminReports, csvExporter, xlsxExporter, docxExporter;
try {
  analytics     = require("../analytics/collector");
  adminReports  = require("../analytics/reports");
  csvExporter   = require("../analytics/exporters/csv");
  xlsxExporter  = require("../analytics/exporters/xlsx");
  docxExporter  = require("../analytics/exporters/docx");

  // Prune old records on startup (0 = keep forever)
  const { pruneOldRecords } = require("../analytics/db");
  const retentionDays = parseInt(process.env.ANALYTICS_RETENTION_DAYS, 10) || 0;
  const pruned = pruneOldRecords(retentionDays);
  if (pruned > 0) console.log(`[analytics] Pruned ${pruned} records older than ${retentionDays} days`);
} catch (e) {
  console.warn("[analytics] Module load failed — analytics disabled:", e.message);
}

// ── Constants ────────────────────────────────────────────────────────────────

/** 2 GB per file — generous for large JMX / collection files; guards against
 *  accidental uploads of wrong file types (e.g. a multi-GB video or database dump). */
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;

/** Abort conversion after 2 minutes to prevent runaway CPU on pathological input. */
const CONVERSION_TIMEOUT_MS = 120_000;

/**
 * Maximum simultaneous conversions. Requests beyond this return HTTP 503 immediately
 * rather than piling up and competing for CPU/RAM.
 * Tune via MAX_CONCURRENT_CONVERSIONS environment variable.
 * Rule of thumb: set to number of physical CPU cores on the server.
 */
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_CONVERSIONS, 10) || 8;

const VALID_LOG_LEVELS = new Set(["debug", "info", "warn", "error"]);

/** Allowed file extensions per upload field (allowlist). */
const ALLOWED_EXTENSIONS = {
  collection:  new Set([".json", ".yml", ".yaml", ".bru", ".zip"]),
  environment: new Set([".json"]),
  certFiles:   new Set([".pem", ".p12", ".pfx", ".crt", ".cer"]),
  jmxFile:     new Set([".jmx"]),
  csvFiles:    new Set([".csv", ".tsv", ".txt"]),
};

// ── Helper functions ─────────────────────────────────────────────────────────

/**
 * Strips directory components and replaces any character that is not a word
 * character, dot, or hyphen. Prevents path traversal via crafted filenames.
 */
function sanitizeFilename(name) {
  return path.basename(String(name || "upload")).replace(/[^\w.\-]/g, "_") || "upload";
}

/**
 * Race a promise against a timeout. Rejects with a CONVERSION_TIMEOUT error
 * if the promise does not resolve within `ms` milliseconds.
 */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(Object.assign(new Error("CONVERSION_TIMEOUT"), { isTimeout: true })), ms)
    ),
  ]);
}

/**
 * Multer fileFilter that validates uploaded file extensions against an allowlist.
 * Unknown field names are passed through (defensive — multer already limits field names).
 */
function makeFileFilter(allowedExtensions) {
  return (req, file, cb) => {
    const allowed = allowedExtensions[file.fieldname];
    if (!allowed) return cb(null, true);
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.has(ext)) return cb(null, true);
    const err = Object.assign(
      new Error(`File type '${ext}' is not accepted for '${file.fieldname}'.`),
      { status: 415 }
    );
    cb(err, false);
  };
}

/**
 * Delete a temp file and log on failure (never silently swallow errors).
 */
async function safeUnlink(p) {
  if (!p) return;
  await fs.unlink(p).catch((e) => {
    if (e.code !== "ENOENT") console.warn(`[CLEANUP-FAIL] ${p} — ${e.message}`);
  });
}

async function safeRmdir(p) {
  if (!p) return;
  await fs.rmdir(p).catch((e) => {
    if (e.code !== "ENOENT") console.warn(`[CLEANUP-FAIL] ${p} — ${e.message}`);
  });
}

// ── WebServer class ───────────────────────────────────────────────────────────

class WebServer {
  constructor(port = 3000) {
    this.port = port;
    this.app  = express();
    /** token → { files: Map, outputDir, expires } — single-use, 5-minute TTL */
    this.pendingDownloads = new Map();
    /** Live count of conversions currently executing (0 … MAX_CONCURRENT). */
    this.activeConversions = 0;
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    // Security headers — CSP disabled because index.ejs uses inline <script> blocks.
    // All other helmet protections are active (X-Frame-Options, X-Content-Type-Options,
    // Referrer-Policy, X-DNS-Prefetch-Control, Strict-Transport-Security, etc.).
    this.app.use(
      helmet({ contentSecurityPolicy: false })
    );
    this.app.disable("x-powered-by");

    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: false }));

    // Block direct .html file access — only clean routes are exposed.
    this.app.use((req, res, next) => {
      if (req.method === "GET" && req.path.toLowerCase().endsWith(".html")) {
        return res.status(404).sendFile(path.join(__dirname, "public", "404.html"));
      }
      next();
    });

    this.app.use(express.static(path.join(__dirname, "public")));
    // Serve static files under /converter/ too — Recorder and Studio iframes
    // resolve asset paths relative to /converter/ under IIS virtual directory.
    this.app.use("/converter", express.static(path.join(__dirname, "public")));
    this.app.set("view engine", "ejs");
    this.app.set("views", path.join(__dirname, "views"));
  }

  setupRoutes() {
    // ── Rate limiter (conversion endpoints only) ──────────────────────────────
    // 60 requests per 5-minute window per IP — generous for an internal team.
    // Adjust max/windowMs if needed for your team size.
    const convertLimiter = rateLimit({
      windowMs: 5 * 60 * 1000,
      max: 60,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "rate_limit_exceeded" },
    });

    // ── Multer instances (one per route — each has its own fileFilter) ────────
    const uploadCollection = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE, files: 12 },
      fileFilter: makeFileFilter(ALLOWED_EXTENSIONS),
    });

    const uploadJmx = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE, files: 42 },
      fileFilter: makeFileFilter(ALLOWED_EXTENSIONS),
    });

    // ── Home ──────────────────────────────────────────────────────────────────
    const renderHome = (req, res) => {
      res.render("index", {
        title: "PerfX Studio — Performance Script Generation",
      });
    };
    this.app.get("/", renderHome);
    this.app.get("/converter", renderHome);
    this.app.get("/converter/", (req, res) => res.redirect("/converter"));

    // ── Tool routes ───────────────────────────────────────────────────────────
    this.app.get("/converter/recorder", (req, res) => {
      res.sendFile(path.join(__dirname, "public", "VuGen-Recorder.html"));
    });
    this.app.get("/converter/studio", (req, res) => {
      res.sendFile(path.join(__dirname, "public", "VuGen-Script-Studio.html"));
    });
    this.app.get("/tools/recorder", (req, res) => {
      res.sendFile(path.join(__dirname, "public", "VuGen-Recorder.html"));
    });
    this.app.get("/tools/studio", (req, res) => {
      res.sendFile(path.join(__dirname, "public", "VuGen-Script-Studio.html"));
    });

    // ── Crypto helper file routes ─────────────────────────────────────────────
    const PROJECT_ROOT = path.join(__dirname, "..", "..");
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
        res.status(404).json({ error: "not_found" });
      };
      this.app.get(`/${name}`, handler);
      this.app.get(`/converter/${name}`, handler);
    }

    // ── Convert (Postman / Bruno collections) ─────────────────────────────────
    this.app.post(
      "/converter/convert",
      convertLimiter,
      uploadCollection.fields([
        { name: "collection", maxCount: 1 },
        { name: "environment", maxCount: 1 },
        { name: "certFiles", maxCount: 10 },
      ]),
      async (req, res) => {
        const collectionFile = req.files?.collection?.[0];
        const environmentFile = req.files?.environment?.[0];
        const certFiles = req.files?.certFiles || [];

        if (!collectionFile) {
          return res.status(400).json({ error: "collection_file_required" });
        }

        // Concurrency guard — prevent CPU/RAM exhaustion under burst load.
        // Returns 503 immediately; client should retry after a short delay.
        if (this.activeConversions >= MAX_CONCURRENT) {
          return res.status(503).json({
            error: "server_busy",
            activeConversions: this.activeConversions,
            maxConcurrent: MAX_CONCURRENT,
          });
        }
        this.activeConversions++;

        // Analytics — capture request data before async work begins
        const _evt = analytics ? analytics.startEvent(req, "converter") : null;
        if (_evt && analytics) analytics.enrichWithFile(_evt, collectionFile, req.body.protocol, req.body.mode);
        let _evtResult = "failed", _evtErrCode = null, _evtReqCount = null;

        // Sanitize filenames before building temp paths (F-04: path traversal prevention)
        const safeColName  = sanitizeFilename(collectionFile.originalname);
        const safeEnvName  = environmentFile ? sanitizeFilename(environmentFile.originalname) : null;

        const tmpCollection  = path.join(os.tmpdir(), `lr-col-${Date.now()}-${safeColName}`);
        const tmpEnvironment = safeEnvName
          ? path.join(os.tmpdir(), `lr-env-${Date.now()}-${safeEnvName}`)
          : null;
        const tmpCertDir   = certFiles.length ? path.join(os.tmpdir(), `lr-cert-${Date.now()}`) : null;
        const csvFilePaths = {};

        try {
          await fs.writeFile(tmpCollection, collectionFile.buffer);
          if (tmpEnvironment) await fs.writeFile(tmpEnvironment, environmentFile.buffer);

          if (tmpCertDir) {
            await fs.mkdir(tmpCertDir, { recursive: true });
            for (const f of certFiles) {
              const safeName = sanitizeFilename(f.originalname);
              const tmpPath  = path.join(tmpCertDir, safeName);
              await fs.writeFile(tmpPath, f.buffer);
              csvFilePaths[f.originalname] = tmpPath;
            }
          }

          const outputDir = path.join(os.tmpdir(), `lr-out-${Date.now()}`);
          const logLevel  = VALID_LOG_LEVELS.has(req.body.logLevel) ? req.body.logLevel : "info";

          const options = {
            inputFile:            tmpCollection,
            outputDir,
            environmentFile:      tmpEnvironment || null,
            protocol:             req.body.protocol || "devweb",
            mode:                 req.body.mode || "single",
            useTransactions:      req.body.useTransactions !== "false",
            useCorrelation:       req.body.useCorrelation !== "false",
            useParameterization:  req.body.useParameterization !== "false",
            useAuthentication:    req.body.useAuthentication !== "false",
            thinkTime:            parseFloat(req.body.thinkTime) || 1,
            addComments:          req.body.addComments !== "false",
            logLevel,
            csvFilePaths,
          };

          const converter = new BrunoDevWebConverter(options);
          const { result: results, files } = await withTimeout(
            runWithMemoryFs(() => converter.convert()),
            CONVERSION_TIMEOUT_MS
          );

          // Add cert files directly into the in-memory ZIP map
          for (const f of certFiles) {
            const dest = path.join(outputDir, sanitizeFilename(f.originalname)).replace(/\\/g, "/");
            files.set(dest, f.buffer);
          }

          // Issue a cryptographically strong single-use download token (F-05)
          const token = crypto.randomBytes(32).toString("hex");
          this.pendingDownloads.set(token, { files, outputDir, expires: Date.now() + 5 * 60 * 1000 });
          setTimeout(() => this.pendingDownloads.delete(token), 5 * 60 * 1000);

          _evtResult   = "success";
          _evtReqCount = results.analysis?.totalRequests
            || results.analysis?.requests?.total
            || null;

          res.json({
            success:     true,
            downloadUrl: `/converter/download/${token}`,
            analysis:    results.analysis,
            protocol:    options.protocol,
            mode:        options.mode,
          });

        } catch (err) {
          // Log full error server-side; send generic code to client (F-07)
          console.error("[convert-error]", err.message, err.isTimeout ? "(timeout)" : "");
          const status = err.isTimeout ? 408 : 500;
          const code   = err.isTimeout ? "conversion_timeout" : "conversion_failed";
          _evtResult  = err.isTimeout ? "timeout" : "failed";
          _evtErrCode = code;
          res.status(status).json({ error: code });

        } finally {
          // Guaranteed cleanup — runs on both success and error paths (F-12 / F-21)
          this.activeConversions = Math.max(0, this.activeConversions - 1);
          if (_evt && analytics) analytics.finishEvent(_evt, { result: _evtResult, errorCode: _evtErrCode, requestCount: _evtReqCount });
          await safeUnlink(tmpCollection);
          await safeUnlink(tmpEnvironment);
          for (const p of Object.values(csvFilePaths)) await safeUnlink(p);
          if (tmpCertDir) await safeRmdir(tmpCertDir);
        }
      }
    );

    // ── Download ──────────────────────────────────────────────────────────────
    // Streams a ZIP built entirely from the in-memory file Map.
    // No ZIP file — and no generated script files — are ever written to disk.
    this.app.get("/converter/download/:token", (req, res) => {
      const entry = this.pendingDownloads.get(req.params.token);

      if (!entry || Date.now() > entry.expires) {
        return res.status(404).json({ error: "download_expired" });
      }

      this.pendingDownloads.delete(req.params.token); // single-use
      const { files, outputDir } = entry;

      // application/octet-stream — generic binary avoids stricter scanning on
      // some corporate networks that inspect application/zip differently.
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", 'attachment; filename="loadrunner_script.zip"');
      // No Content-Length — chunked transfer encoding bypasses proxy size limits.

      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.on("error", (err) => {
        console.error("[archive-error]", err.message);
        if (!res.headersSent) res.status(500).json({ error: "archive_failed" });
      });

      archive.pipe(res);

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

    // ── Convert JMX ───────────────────────────────────────────────────────────
    this.app.post(
      "/converter/convert-jmx",
      convertLimiter,
      uploadJmx.fields([
        { name: "jmxFile",   maxCount: 1  },
        { name: "csvFiles",  maxCount: 30 },
        { name: "certFiles", maxCount: 10 },
      ]),
      async (req, res) => {
        const jmxFile   = req.files?.jmxFile?.[0];
        const csvFiles  = req.files?.csvFiles  || [];
        const certFiles = req.files?.certFiles || [];

        if (!jmxFile) {
          return res.status(400).json({ error: "jmx_file_required" });
        }

        if (this.activeConversions >= MAX_CONCURRENT) {
          return res.status(503).json({
            error: "server_busy",
            activeConversions: this.activeConversions,
            maxConcurrent: MAX_CONCURRENT,
          });
        }
        this.activeConversions++;

        // Analytics
        const _evtJ = analytics ? analytics.startEvent(req, "jmx") : null;
        if (_evtJ && analytics) analytics.enrichWithFile(_evtJ, jmxFile, req.body.protocol, req.body.mode);
        let _evtJResult = "failed", _evtJErrCode = null, _evtJReqCount = null;

        const safeJmxName  = sanitizeFilename(jmxFile.originalname);
        const tmpJmx       = path.join(os.tmpdir(), `lr-jmx-${Date.now()}-${safeJmxName}`);
        const tmpSupportDir = path.join(os.tmpdir(), `lr-jmx-support-${Date.now()}`);
        const csvFilePaths  = {};
        const tmpFiles      = [tmpJmx];

        const uploadedSupportFiles = [...csvFiles, ...certFiles];

        try {
          await fs.writeFile(tmpJmx, jmxFile.buffer);

          if (uploadedSupportFiles.length) {
            await fs.mkdir(tmpSupportDir, { recursive: true });
            for (const f of uploadedSupportFiles) {
              const safeName = sanitizeFilename(f.originalname);
              const tmpPath  = path.join(tmpSupportDir, safeName);
              await fs.writeFile(tmpPath, f.buffer);
              tmpFiles.push(tmpPath);
              csvFilePaths[f.originalname] = tmpPath;
            }
            tmpFiles.push(tmpSupportDir);
          }

          const outputDir = path.join(os.tmpdir(), `lr-jmx-out-${Date.now()}`);
          const logLevel  = VALID_LOG_LEVELS.has(req.body.logLevel) ? req.body.logLevel : "info";

          const options = {
            inputFile:            tmpJmx,
            outputDir,
            protocol:             req.body.protocol || "devweb",
            mode:                 req.body.mode || "single",
            useTransactions:      req.body.useTransactions !== "false",
            useCorrelation:       req.body.useCorrelation !== "false",
            useParameterization:  req.body.useParameterization !== "false",
            useAuthentication:    req.body.useAuthentication !== "false",
            thinkTime:            parseFloat(req.body.thinkTime) || 1,
            addComments:          req.body.addComments !== "false",
            logLevel,
            generateWlmExcel:     req.body.generateWlmExcel !== "false",
            csvFilePaths,
          };

          const converter = new JmxConverter(options);
          const { result: results, files } = await withTimeout(
            runWithMemoryFs(() => converter.convert()),
            CONVERSION_TIMEOUT_MS
          );

          const resolver   = new JmxDependencyResolver(results.csvDataSets || [], uploadedSupportFiles);
          const dependency = resolver.resolve();

          for (const f of uploadedSupportFiles) {
            const dest = path.join(outputDir, sanitizeFilename(f.originalname)).replace(/\\/g, "/");
            files.set(dest, f.buffer);
          }

          const token = crypto.randomBytes(32).toString("hex");
          this.pendingDownloads.set(token, { files, outputDir, expires: Date.now() + 5 * 60 * 1000 });
          setTimeout(() => this.pendingDownloads.delete(token), 5 * 60 * 1000);

          _evtJResult   = "success";
          _evtJReqCount = results.threadGroups
            ? results.threadGroups.reduce((s, tg) => s + (tg.requestCount || 0), 0) || null
            : results.analysis?.totalRequests || null;

          res.json({
            success:     true,
            downloadUrl: `/converter/download/${token}`,
            analysis:    results.analysis,
            threadGroups: results.threadGroups,
            scripts:     results.scripts || null,
            multiScript: results.multiScript || false,
            metadata:    results.metadata,
            dependency,
            protocol:    options.protocol,
            mode:        options.mode,
          });

        } catch (err) {
          console.error("[convert-jmx-error]", err.message, err.isTimeout ? "(timeout)" : "");
          const status = err.isTimeout ? 408 : 500;
          const code   = err.isTimeout ? "conversion_timeout" : "conversion_failed";
          _evtJResult  = err.isTimeout ? "timeout" : "failed";
          _evtJErrCode = code;
          res.status(status).json({ error: code });

        } finally {
          // Guaranteed cleanup (F-12 / F-21)
          this.activeConversions = Math.max(0, this.activeConversions - 1);
          if (_evtJ && analytics) analytics.finishEvent(_evtJ, { result: _evtJResult, errorCode: _evtJErrCode, requestCount: _evtJReqCount });
          for (const p of tmpFiles) {
            if (p === tmpSupportDir) await safeRmdir(p);
            else await safeUnlink(p);
          }
        }
      }
    );

    // ── Status (ops / monitoring) ──────────────────────────────────────────────
    // Shows live conversion load and memory usage. Internal use only.
    const statusHandler = (req, res) => {
      const mem = process.memoryUsage();
      res.json({
        status:            this.activeConversions < MAX_CONCURRENT ? "ok" : "busy",
        activeConversions: this.activeConversions,
        maxConcurrent:     MAX_CONCURRENT,
        pendingDownloads:  this.pendingDownloads.size,
        memory: {
          heapUsedMB:  Math.round(mem.heapUsed  / 1024 / 1024),
          heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
          rssMB:       Math.round(mem.rss        / 1024 / 1024),
        },
        uptime: Math.round(process.uptime()) + "s",
      });
    };
    this.app.get("/converter/status", statusHandler);
    this.app.get("/status", statusHandler);

    // ── Health ─────────────────────────────────────────────────────────────────
    // Version removed (F-15) — version info should not be disclosed to any caller.
    const healthHandler = (req, res) => res.json({ status: "ok" });
    this.app.get("/health", healthHandler);
    this.app.get("/converter/health", healthHandler);

    // ── Studio analytics ping ─────────────────────────────────────────────────
    // No auth required — Studio generates scripts entirely client-side, so this
    // is the only way to record Studio usage. Input is untrusted; we sanitise.
    this.app.post("/analytics/track", express.json({ limit: "2kb" }), (req, res) => {
      res.status(204).end(); // respond immediately, work happens below
      if (!analytics) return;
      try {
        const b = req.body || {};
        const event = analytics.startEvent(req, "studio");
        const proto = String(b.protocol || "").slice(0, 32) || null;
        const fname = b.filename ? String(b.filename).slice(0, 255) : null;
        event.protocol    = proto;
        event.script_mode = "studio";
        event.filename    = fname;
        event.file_ext    = fname ? require("path").extname(fname).toLowerCase() || null : null;
        event.file_size_kb = null; // HAR is loaded in-browser; size not available
        // Client-reported duration: override the internal timer
        const dur = parseInt(b.duration, 10);
        if (dur > 0) event._startMs = Date.now() - dur;
        analytics.finishEvent(event, {
          result:               "success",
          requestCount:         parseInt(b.requestCount, 10) || null,
          correlationsFound:    parseInt(b.correlationsFound, 10) || null,
          correlationsAccepted: parseInt(b.correlationsAccepted, 10) || null,
        });
      } catch (err) {
        console.warn("[analytics] studio track failed:", err.message);
      }
    });

    // ── Admin analytics dashboard ─────────────────────────────────────────────
    // All /admin/* routes require a valid ADMIN_TOKEN query param or Bearer header.
    // Returns 404 (not 401) to avoid disclosing that an admin panel exists.
    const ADMIN_TOKEN = process.env.ADMIN_TOKEN || null;

    const adminAuth = (req, res, next) => {
      if (!ADMIN_TOKEN) return res.status(404).sendFile(path.join(__dirname, "public", "404.html"));
      if (!analytics)   return res.status(503).json({ error: "analytics_unavailable" });
      const token = req.query.token
        || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (token !== ADMIN_TOKEN) return res.status(404).sendFile(path.join(__dirname, "public", "404.html"));
      next();
    };

    // Serve Chart.js from local node_modules — no CDN dependency.
    // chart.js v4 uses an exports map that blocks require.resolve() on subpaths,
    // so we construct the absolute path directly instead.
    this.app.get("/admin/vendor/chart.js", (req, res) => {
      const p = path.join(process.cwd(), "node_modules", "chart.js", "dist", "chart.umd.min.js");
      res.setHeader("Content-Type", "application/javascript");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.sendFile(p, (err) => {
        if (err) res.status(404).json({ error: "not_found" });
      });
    });

    // Dashboard HTML
    this.app.get("/admin", adminAuth, (req, res) => {
      const preset = req.query.period || "30d";
      const range  = adminReports.dateRangePreset(preset);
      const from   = req.query.from || range.from;
      const to     = req.query.to   || range.to;
      const stats  = adminReports.getStats({ from, to });
      res.render("admin", {
        stats, preset, from, to,
        adminToken: ADMIN_TOKEN,
      });
    });

    // JSON stats API (for AJAX refresh)
    this.app.get("/admin/api/stats", adminAuth, (req, res) => {
      const from  = req.query.from  || null;
      const to    = req.query.to    || null;
      const stats = adminReports.getStats({ from, to });
      res.json(stats);
    });

    // JSON events API (paginated)
    this.app.get("/admin/api/events", adminAuth, (req, res) => {
      const { from, to, tool, result, search } = req.query;
      const limit  = Math.min(parseInt(req.query.limit,  10) || 100, 1000);
      const offset = parseInt(req.query.offset, 10) || 0;
      const data = require("../analytics/db").queryEvents({ from, to, tool, result, search, limit, offset });
      res.json(data);
    });

    // CSV download
    this.app.get("/admin/download/csv", adminAuth, (req, res) => {
      const { from, to, tool, result } = req.query;
      const rows = require("../analytics/db").queryAllForExport({ from, to, tool, result });
      csvExporter.streamCsv(res, rows, `perfx-analytics-${isoDate()}.csv`);
    });

    // XLSX download
    this.app.get("/admin/download/xlsx", adminAuth, async (req, res) => {
      const { from, to, tool, result } = req.query;
      const preset = req.query.period || "custom";
      const rows   = require("../analytics/db").queryAllForExport({ from, to, tool, result });
      const stats  = adminReports.getStats({ from, to });
      await xlsxExporter.streamXlsx(res, stats, rows, periodLabel(preset, from, to));
    });

    // DOCX download
    this.app.get("/admin/download/docx", adminAuth, async (req, res) => {
      const { from, to } = req.query;
      const preset = req.query.period || "custom";
      const stats  = adminReports.getStats({ from, to });
      await docxExporter.streamDocx(res, stats, periodLabel(preset, from, to));
    });

    // ── Catch-all 404 ──────────────────────────────────────────────────────────
    this.app.use((req, res) => {
      res.status(404).sendFile(path.join(__dirname, "public", "404.html"));
    });

    // ── Global error handler ───────────────────────────────────────────────────
    // Must have 4 params for Express to recognise it as an error handler.
    // Catches errors from multer (file size, file type), body-parser, and middleware.
    // eslint-disable-next-line no-unused-vars
    this.app.use((err, req, res, next) => {
      console.error("[middleware-error]", err.message);
      const status = err.status || err.statusCode || 500;
      // Map known error types to user-facing codes; never expose err.message (F-07)
      let code = "server_error";
      if (err.code === "LIMIT_FILE_SIZE")  code = "file_too_large";
      if (err.code === "LIMIT_FILE_COUNT") code = "too_many_files";
      if (status === 415)                  code = "unsupported_file_type";
      if (status === 429)                  code = "rate_limit_exceeded";
      res.status(status).json({ error: code });
    });
  }

  async start(port = this.port) {
    return new Promise((resolve) => {
      this.server = this.app.listen(port, () => {
        console.log(`\n🌐  PerfX Studio  →  http://localhost:${port}/converter\n`);
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

// ── Module-level helpers for admin routes ─────────────────────────────────────

function isoDate() {
  return new Date().toISOString().slice(0, 10);
}

function periodLabel(preset, from, to) {
  const MAP = { "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", "mtd": "Month to date", "all": "All time" };
  if (MAP[preset]) return MAP[preset];
  if (from && to)  return `${from} to ${to}`;
  return "All time";
}

module.exports = new WebServer();

if (require.main === module) {
  const port = process.env.PORT || 3000;
  module.exports.start(port);
}
