const { spawnSync } = require('node:child_process');
const path = require('node:path');

const bundle = path.resolve(process.argv[2] || 'dist/webOSUserScripts/userScript.js');
const suites = [
  'modern-smoke.cjs',
  'build-info-test.cjs',
  'queue-ui-test.cjs',
  'captions-ui-test.cjs',
  'navigation-ui-test.cjs',
  'spatnav-correctness.cjs',
  'playback-defaults-test.cjs',
  'native-speed-menu-test.cjs',
  'speed-hardware-test.cjs',
  'speed-test.cjs',
  'settings-speed-test.cjs',
  'settings-entry-test.cjs',
  'video-quality-test.cjs',
  'content-preferences-test.cjs',
  'adblock-test.cjs',
  'dislike-timing-test.cjs',
  'module-behaviour-test.cjs'
];

for (const suite of suites) {
  const result = spawnSync(process.execPath, [path.join(__dirname, suite), bundle, 'modern'], {
    stdio: 'inherit'
  });
  if (result.error) console.error(result.error);
  if (result.status !== 0) process.exit(result.status || 1);
}
