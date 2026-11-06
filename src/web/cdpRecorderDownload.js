/**
 * cdpRecorderDownload.js — decides which built CDP Recorder file the
 * /downloads/cdp-recorder route serves.
 *
 * The ZIP is preferred: some corporate proxies block downloading a bare .exe
 * but allow a .zip. The plain .exe is kept as a fallback so a server that was
 * deployed before the ZIP existed keeps working until its dist\ is refreshed.
 */
const fs = require("fs");
const path = require("path");

const CANDIDATES = ["cdp-recorder.zip", "cdp-recorder.exe"];

/**
 * @param {string} distDir - cdp-recorder/recorder/dist on this server
 * @param {(p: string) => boolean} [exists] - injectable for tests
 * @returns {{ filePath: string, fileName: string } | null} null when neither file is present
 */
function resolveCdpRecorderDownload(distDir, exists = fs.existsSync) {
  for (const fileName of CANDIDATES) {
    const filePath = path.join(distDir, fileName);
    if (exists(filePath)) return { filePath, fileName };
  }
  return null;
}

module.exports = { resolveCdpRecorderDownload, CANDIDATES };
