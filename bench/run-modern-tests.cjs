// Compatibility entrypoint; the suite registry and failure handling are shared.
const path = require('node:path');
const { runGroup } = require('./test-runner.cjs');
process.exitCode = runGroup('modern', process.argv[2] && path.resolve(process.argv[2]));
