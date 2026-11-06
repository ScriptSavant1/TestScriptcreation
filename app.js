/**
 * app.js — IIS/iisnode entry point for PerfX Studio
 *
 * This thin wrapper exists so that iisnode's entry point lives at the
 * project root (app.js) rather than deep inside src/web/server.js.
 * All application logic remains in src/web/server.js.
 */

// First, so that anything the server prints while loading is in the log too.
require('./src/lib/appLog').start();

const webServer = require('./src/web/server.js');

const port = process.env.PORT || 3000;

webServer.start(port).then(() => {
  console.log(`PerfX Studio started on port ${port}`);
}).catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
