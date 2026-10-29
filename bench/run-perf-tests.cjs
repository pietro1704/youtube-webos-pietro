const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runNodeSuites } = require('./test-runner.cjs');
const variant = process.argv[2] || 'legacy';
if (!['legacy', 'modern'].includes(variant)) throw new Error('Unknown performance target: ' + variant);
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'ytaf-perf-test-'));
try {
  const args = [require.resolve('webpack/bin/webpack.js'), '--mode=production', '--env', 'perf', '--output-path', output];
  if (variant === 'modern') args.push('--env', 'modern');
  process.exitCode = runNodeSuites([args, ['bench/perfmon-test.cjs', path.join(output, 'webOSUserScripts/userScript.js'), variant]]);
} finally { fs.rmSync(output, { recursive: true, force: true }); }
