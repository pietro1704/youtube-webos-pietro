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

  // Inspect the actual IPK (ar + gzipped tar), not just the staging folder.
  const archive = fs.readFileSync(path.join(output, expected));
  let metadata = null;
  for (let offset = 8; offset + 60 <= archive.length;) {
    const header = archive.subarray(offset, offset + 60);
    const size = Number(header.subarray(48, 58).toString().trim());
    const body = archive.subarray(offset + 60, offset + 60 + size);
    offset += 60 + size + (size % 2);
    if (header.subarray(0, 16).toString().trim().replace(/\/$/, '') !== 'data.tar.gz') continue;
    const tar = require('node:zlib').gunzipSync(body);
    for (let cursor = 0; cursor + 512 <= tar.length;) {
      const name = tar.subarray(cursor, cursor + 100).toString().split('\0')[0];
      const length = parseInt(tar.subarray(cursor + 124, cursor + 136).toString().replace(/\0/g, '').trim(), 8) || 0;
      if (name.endsWith('/build-info.json')) metadata = JSON.parse(tar.subarray(cursor + 512, cursor + 512 + length).toString());
      cursor += 512 + Math.ceil(length / 512) * 512;
    }
  }
  const stagedInfo = JSON.parse(fs.readFileSync(path.join(repoRoot, 'dist/build-info.json'), 'utf8'));
  check('IPK contains the exact build identity of its staged bundle',
    JSON.stringify(metadata) === JSON.stringify(stagedInfo));

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
