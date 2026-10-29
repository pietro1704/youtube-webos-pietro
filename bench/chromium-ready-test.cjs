const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { waitForDevToolsPort } = require('./chromium-ready.cjs');

for (const partial of ['', '92']) test('DevTools waits for a complete port after partial publication: ' + JSON.stringify(partial), async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ytaf-port-test-'));
  const file = path.join(profile, 'DevToolsActivePort');
  let writer;
  try {
    fs.writeFileSync(file, partial);
    writer = setTimeout(() => fs.writeFileSync(file, '9222\n/devtools/browser/test\n'), 30);
    assert.equal(await waitForDevToolsPort(profile, { exitCode: null }, { timeoutMs: 500, pollMs: 5 }), 9222);
  } finally { clearTimeout(writer); fs.rmSync(profile, { recursive: true, force: true }); }
});

for (const value of ['', '0\n', 'NaN\n', '70000\n', '9222garbage\n']) test('invalid DevTools port fails with a bounded timeout: ' + JSON.stringify(value), async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ytaf-port-test-'));
  try {
    fs.writeFileSync(path.join(profile, 'DevToolsActivePort'), value);
    await assert.rejects(waitForDevToolsPort(profile, { exitCode: null }, { timeoutMs: 20, pollMs: 5 }), /DevTools.*port/i);
  } finally { fs.rmSync(profile, { recursive: true, force: true }); }
});

test('a browser that exits before publishing a port fails immediately', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ytaf-port-test-'));
  try { await assert.rejects(waitForDevToolsPort(profile, { exitCode: 1 }), /exited/i); }
  finally { fs.rmSync(profile, { recursive: true, force: true }); }
});
