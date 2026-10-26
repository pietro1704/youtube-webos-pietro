const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createBuildInfo } = require('../tools/build-info.cjs');
const root = require('node:path').resolve(__dirname, '..');
const version = require('../package.json').version;
for (const variant of ['legacy', 'modern']) {
  const info = createBuildInfo(root, version, variant);
  assert.equal(info.commit, execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim());
  assert.equal(info.variant, variant);
  assert.equal(info.version, version);
  assert.equal(typeof info.dirty, 'boolean');
}
assert.throws(() => createBuildInfo(root, version, 'unknown'));
assert.throws(() => createBuildInfo(root, 'invalid', 'legacy'));
assert.throws(() => createBuildInfo('/dev/null', version, 'legacy'));
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ytaf-provenance-'));
try {
  const git = args => execFileSync('git', args, { cwd: scratch, stdio: 'pipe' });
  git(['init', '-q']);
  fs.writeFileSync(path.join(scratch, 'source.js'), 'original');
  git(['add', 'source.js']);
  git(['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']);
  assert.equal(createBuildInfo(scratch, version, 'legacy').dirty, false);
  fs.writeFileSync(path.join(scratch, 'source.js'), 'modified');
  assert.equal(createBuildInfo(scratch, version, 'legacy').dirty, true);
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
console.log('build metadata: exact commit, variants and invalid/missing provenance passed');
