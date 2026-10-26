const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const appinfo = require('../assets/appinfo.json');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ytaf-manifest-'));
const script = path.resolve('tools/gen-manifest.cjs');
const filename = `${appinfo.id}_${appinfo.version}_all.ipk`;
const output = path.join(scratch, 'release.manifest.json');
const bytes = Buffer.from('test package bytes');
const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: os.tmpdir(), encoding: 'utf8' });
try {
  fs.writeFileSync(path.join(scratch, filename), bytes);
  const generated = run(output);
  assert.equal(generated.status, 0, generated.stderr);
  const manifest = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(manifest.ipkUrl, filename);
  assert.equal(manifest.id, appinfo.id);
  assert.equal(manifest.version, appinfo.version);
  assert.equal(manifest.sourceUrl, 'https://github.com/pietro1704/youtube-webos-pietro');
  assert.equal(manifest.ipkHash.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.equal(run(output, '--verify').status, 0);
  fs.appendFileSync(path.join(scratch, filename), 'modified');
  assert.notEqual(run(output, '--verify').status, 0, 'modified package must reject verification');
  fs.writeFileSync(output, 'invalid JSON');
  assert.notEqual(run(output, '--verify').status, 0, 'invalid manifest must fail');
  fs.unlinkSync(path.join(scratch, filename));
  fs.unlinkSync(output);
  assert.notEqual(run(output).status, 0, 'missing package must fail');
  assert.equal(fs.existsSync(output), false, 'missing package must never create a manifest');
  assert.notEqual(run().status, 0, 'missing arguments must fail');
  console.log('manifest: generation, identity, SHA-256, tampering, malformed/missing input and alternate cwd passed');
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
