const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const cli = require.resolve('@webos-tools/cli/bin/ares-package.js');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'webos-cli-package-'));
const output = path.join(scratch, 'output');

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`);
  }
}

try {
  const packaged = spawnSync(process.execPath, [cli, '-n', path.join(repoRoot, 'dist'), '-o', output], {
    encoding: 'utf8'
  });
  const expected = 'youtube.leanback.v4_0.8.4_all.ipk';

  check('ares-package completes with the locked dependency graph', packaged.status === 0,
    `${packaged.stdout}\n${packaged.stderr}`.trim());
  check('package identity matches appinfo', fs.existsSync(path.join(output, expected)), expected);

  const rejected = spawnSync(process.execPath, [cli, '-n', path.join(scratch, 'missing'), '-o', output], {
    encoding: 'utf8'
  });
  check('ares-package rejects a missing input directory', rejected.status !== 0,
    `exit status ${rejected.status}`);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
