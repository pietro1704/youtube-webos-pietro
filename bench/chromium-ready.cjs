const fs = require('node:fs');
const path = require('node:path');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitForDevToolsPort(profile, browser, { timeoutMs = 30000, pollMs = 50 } = {}) {
  const file = path.join(profile, 'DevToolsActivePort'), deadline = Date.now() + timeoutMs;
  do {
    if (browser.exitCode !== null || browser.signalCode) throw new Error('Chromium exited before publishing its DevTools port');
    try {
      const content = fs.readFileSync(file, 'utf8');
      const newline = content.indexOf('\n');
      const value = newline > 0 ? content.slice(0, newline).trim() : '';
      const port = Number(value);
      if (/^\d+$/.test(value) && port > 0 && port <= 65535) return port;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await wait(pollMs);
  } while (Date.now() < deadline);
  throw new Error('Timed out waiting for a valid Chromium DevTools port');
}
module.exports = { waitForDevToolsPort };
