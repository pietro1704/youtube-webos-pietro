const path = require('node:path');
const { spawnSync } = require('node:child_process');

function runNodeSuites(suites, { cwd = path.resolve(__dirname, '..'), stdio = 'inherit' } = {}) {
  for (const args of suites) {
    const result = spawnSync(process.execPath, args, { cwd, stdio });
    if (result.error) console.error(result.error);
    if (result.status !== 0) return result.status || 1;
  }
  return 0;
}
function runGroup(group, bundle = path.resolve(__dirname, '../dist/webOSUserScripts/userScript.js')) {
  const suites = require('./test-suites.cjs')[group];
  if (!suites) throw new Error('Unknown test group: ' + group);
  return runNodeSuites(suites.map(args => args.map(arg => arg === '<bundle>' ? bundle : arg === '<variant>' ? (group === 'modern' ? 'modern' : 'legacy') : arg)));
}
module.exports = { runNodeSuites, runGroup };
if (require.main === module) process.exitCode = runGroup(process.argv[2] || 'legacy', process.argv[3] && path.resolve(process.argv[3]));
