/**
 * PM2 process configuration — PerfX Studio
 *
 * Usage:
 *   npm install pm2 -g          (one-time)
 *   pm2 start pm2.config.js     (start)
 *   pm2 stop perfx-studio       (stop)
 *   pm2 restart perfx-studio    (restart)
 *   pm2 logs perfx-studio       (view logs)
 *   pm2 monit                   (live dashboard)
 *   pm2 save && pm2 startup     (auto-start on reboot)
 *
 * IMPORTANT — do NOT change instances to "max" or any number > 1 without first
 * moving pendingDownloads to a shared store (Redis or file-based). The download
 * token store is per-process — a token created by process 0 will not be found
 * by process 1, causing "download expired" errors. See Docs/OPERATIONS.md.
 */

module.exports = {
  apps: [
    {
      name:        "perfx-studio",
      script:      "src/web/server.js",

      // Single instance — required until pendingDownloads moves to shared store.
      // Increase to "max" (all CPU cores) only after implementing shared tokens.
      instances:   1,
      exec_mode:   "fork",

      // Restart if RAM exceeds this threshold (prevents slow OOM degradation)
      max_memory_restart: "3G",

      // Environment variables
      env: {
        NODE_ENV:                    "production",
        PORT:                        3000,
        // Maximum simultaneous conversions. Set to number of physical CPU cores.
        // Users beyond this limit receive HTTP 503 and should retry.
        MAX_CONCURRENT_CONVERSIONS:  8,
      },

      // Structured log files (rotate daily, keep 14 days)
      error_file:         "logs/pm2-error.log",
      out_file:           "logs/pm2-out.log",
      log_date_format:    "YYYY-MM-DD HH:mm:ss",
      merge_logs:         true,

      // Restart behaviour
      autorestart:        true,
      max_restarts:       10,
      restart_delay:      3000,   // ms between restart attempts
      min_uptime:         "10s",  // must stay up 10s to count as stable start

      // Node.js flags — give the process more heap if conversions are large
      node_args:          "--max-old-space-size=4096",  // 4 GB heap limit

      // Watch: disabled — use pm2 restart after deployments instead
      watch:              false,
    },
  ],
};
