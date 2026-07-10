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
      name: "perfx-studio",
      script: "src/web/server.js",

      // Single instance — required until pendingDownloads moves to shared store.
      // Increase to "max" (all CPU cores) only after implementing shared tokens.
      instances: 1,
      exec_mode: "fork",

      // Restart if RAM exceeds this threshold (prevents slow OOM degradation)
      max_memory_restart: "3G",

      // Environment variables
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        // Maximum simultaneous conversions. Set to number of physical CPU cores.
        // Users beyond this limit receive HTTP 503 and should retry.
        MAX_CONCURRENT_CONVERSIONS: 8,
        // Analytics admin dashboard — REQUIRED to enable /admin routes.
        // Set ADMIN_TOKEN as an OS environment variable BEFORE starting PM2.
        // DO NOT hardcode a real password here — this file is committed to git.
        // Access via: http://your-server:3000/admin?token=<value>
        //
        // How to set it on the server (run once, persists across reboots):
        //   Windows: setx ADMIN_TOKEN "your-strong-password" /M
        //   Linux:   echo 'export ADMIN_TOKEN="your-strong-password"' >> /etc/environment
        //
        // Then: pm2 start pm2.config.js
        ADMIN_TOKEN: process.env.ADMIN_TOKEN || "",
        // Automatically delete analytics records older than N days (0 = keep forever).
        ANALYTICS_RETENTION_DAYS: 730,
        // Optional: override analytics DB path (default: ./data/analytics.db)
        // ANALYTICS_DB_PATH: "/data/perfx/analytics.db",
      },

      // Structured log files (rotate daily, keep 14 days)
      error_file: "logs/pm2-error.log",
      out_file: "logs/pm2-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,

      // Restart behaviour
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000, // ms between restart attempts
      min_uptime: "10s", // must stay up 10s to count as stable start

      // Node.js flags — give the process more heap if conversions are large
      node_args: "--max-old-space-size=4096", // 4 GB heap limit

      // Watch: disabled — use pm2 restart after deployments instead
      watch: false,
    },
  ],
};
