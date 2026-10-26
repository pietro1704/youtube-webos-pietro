const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ESLint } = require('eslint');
const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ytaf-checks-'));

(async () => {
  try {
    const fixture = path.join(scratch, 'fixture.ts');
    const config = path.join(scratch, 'tsconfig.json');
    fs.writeFileSync(config, JSON.stringify({ extends: path.join(root, 'tsconfig.json'), include: [fixture], references: [] }));
    const check = () => spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', config], { cwd: root, encoding: 'utf8' });
    fs.writeFileSync(fixture, 'export const value: number = 1;\n');
    let result = check();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(fs.existsSync(path.join(scratch, 'fixture.js')), false, 'type check must not emit JavaScript');
    fs.writeFileSync(fixture, "export const value: number = 'wrong';\n");
    result = check();
    assert.notEqual(result.status, 0, 'type errors must fail');
    assert.match(result.stdout, /TS2322/);
    const eslint = new ESLint({ cwd: root });
    let results = await eslint.lintText('const value = 1; console.log(value);\n', { filePath: path.join(root, 'src/check-fixture.js') });
    assert.equal(results[0].errorCount, 0);
    results = await eslint.lintText('missingVariable();\n', { filePath: path.join(root, 'src/check-fixture.js') });
    assert.ok(results[0].messages.some(message => message.ruleId === 'no-undef'));
    results = await eslint.lintText('const owned = Object.prototype.hasOwnProperty.call({}, "key"); console.log(owned);\n', { filePath: path.join(root, 'src/check-fixture.js') });
    assert.ok(!results[0].messages.some(message => message.ruleId === 'prefer-object-has-own'), 'lint must not request an unsupported webOS API');
    results = await eslint.lintText("console.log(Object.hasOwn({}, 'key'));\n", { filePath: path.join(root, 'src/check-fixture.js') });
    assert.ok(results[0].messages.some(message => message.ruleId === 'no-restricted-properties'), 'unsupported Object.hasOwn must be rejected');
    console.log('development checks: valid/invalid TypeScript, no emit, valid/invalid lint and legacy API compatibility passed');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
