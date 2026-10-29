const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runNodeSuites } = require('./test-runner.cjs');

test('runner succeeds only after every real child command succeeds', () => {
  assert.equal(runNodeSuites([['-e', 'process.exit(0)'], ['-e', 'process.exit(0)']], { stdio: 'pipe' }), 0);
});
for (const failure of [['-e', 'process.exit(7)'], ['-e', "process.kill(process.pid, 'SIGTERM')"], ['missing-test-file.cjs']]) {
  test('runner preserves failure and does not execute later suites: ' + failure.join(' '), () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ytaf-runner-test-')), marker = path.join(folder, 'ran');
    try {
      const code = `require('fs').writeFileSync(${JSON.stringify(marker)}, 'unexpected')`;
      assert.notEqual(runNodeSuites([failure, ['-e', code]], { stdio: 'pipe' }), 0);
      assert.equal(fs.existsSync(marker), false);
    } finally { fs.rmSync(folder, { recursive: true, force: true }); }
  });
}

for (const exit of [0, 7]) test('CLI exits with the real child status: ' + exit, () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ytaf-runner-cli-'));
  try {
    fs.copyFileSync(path.join(__dirname, 'test-runner.cjs'), path.join(folder, 'test-runner.cjs'));
    fs.writeFileSync(path.join(folder, 'test-suites.cjs'), `module.exports = { legacy: [['-e', 'process.exit(${exit})']] };`);
    const result = require('node:child_process').spawnSync(process.execPath, [path.join(folder, 'test-runner.cjs'), 'legacy'], { stdio: 'pipe' });
    assert.equal(result.status, exit);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
