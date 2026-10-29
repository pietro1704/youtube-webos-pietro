const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const YAML = require('yaml');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('published catalog entries and build instructions belong to this fork', () => {
  for (const item of JSON.parse(read('repo.json')).packages) {
    assert.equal(item.manifest.sourceUrl, 'https://github.com/pietro1704/youtube-webos-pietro');
    assert.ok(item.manifest.ipkUrl.startsWith('https://github.com/pietro1704/youtube-webos-pietro/releases/'));
  }
  assert.ok(read('README.md').includes('git clone https://github.com/pietro1704/youtube-webos-pietro.git'));
});

test('generated IPKs are not tracked as source', () => {
  const files = execFileSync('git', ['ls-files', 'dist'], { cwd: root, encoding: 'utf8' });
  assert.equal(files.trim(), '');
});

test('PR and release builds share the same validation action for both targets', () => {
  const main = YAML.parse(read('.github/workflows/main.yml'));
  const release = YAML.parse(read('.github/workflows/release.yml'));
  for (const workflow of [main, release]) {
    assert.deepEqual(workflow.jobs.build.strategy.matrix.variant, ['legacy', 'modern']);
    const shared = workflow.jobs.build.steps.find(step => step.uses === './.github/actions/validate');
    assert.ok(shared); assert.equal(shared.with.variant, '${{ matrix.variant }}');
  }
  assert.equal(main.jobs.build.name, 'Build & Test (${{ matrix.variant }})', 'required check names are preserved');
  const action = YAML.parse(read('.github/actions/validate/action.yml'));
  const commands = action.runs.steps.map(step => step.run || '').join('\n');
  for (const required of ['npm run lint', 'npm run type-check', 'npm test', 'test:modern', 'run-perf-tests.cjs', 'test:native-audio-browser', 'npm run package', 'npm run manifest']) assert.ok(commands.includes(required), required);
  assert.ok(release.jobs.publish.needs.includes('build'));
  assert.ok(release.jobs.publish.steps.some(step => (step.run || '').includes('--require-clean')));
});

const os = require('node:os');
const crypto = require('node:crypto');
const { prepare } = require('../tools/prepare-release.cjs');
function fixture() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'distribution-'));
  const info = { version: '1.2.3', commit: 'a'.repeat(40), dirty: false, instrumentation: 'none' };
  for (const variant of ['legacy', 'modern']) {
    const dir = path.join(temp, variant); fs.mkdirSync(dir);
    const payload = path.join(dir, 'payload'); fs.mkdirSync(payload);
    fs.writeFileSync(path.join(payload, 'appinfo.json'), JSON.stringify({ id: 'youtube.leanback.v4', version: '1.2.3' }));
    fs.writeFileSync(path.join(payload, 'build-info.json'), JSON.stringify({ ...info, variant }));
    fs.copyFileSync(path.join(payload, 'build-info.json'), path.join(dir, 'build-info.json'));
    execFileSync('tar', ['-czf', path.join(dir, 'data.tar.gz'), '-C', payload, '.']);
    const ipk = 'youtube.leanback.v4_1.2.3_all.ipk';
    execFileSync('ar', ['rc', path.join(dir, ipk), path.join(dir, 'data.tar.gz')]);
    fs.writeFileSync(path.join(dir, 'youtube.leanback.v4.manifest.json'), JSON.stringify({ id: 'youtube.leanback.v4', title: 'YouTube', version: '1.2.3', sourceUrl: 'https://github.com/pietro1704/youtube-webos-pietro', ipkUrl: ipk, ipkHash: { sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, ipk))).digest('hex') } }));
  }
  return temp;
}
test('offline release preparation verifies packages and preserves their real identity', () => {
  const dir = fixture();
  try {
    const catalog = prepare(dir, path.join(dir, 'out'), 'v1.2.3', true);
    assert.equal(catalog.packages.length, 2);
    assert.deepEqual(catalog.packages.map(p => p.id), ['youtube.leanback.v4', 'youtube.leanback.v4']);
    assert.match(catalog.packages[1].manifest.ipkUrl, /1.2.3_modern_all.ipk$/);
    assert.ok(fs.existsSync(path.join(dir, 'out', 'repo.json')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
for (const scenario of ['tag', 'hash', 'identity', 'commit', 'dirty', 'instrumentation', 'missing', 'tag-commit']) {
  test('rejects inconsistent release: ' + scenario, () => {
    const dir = fixture(); const out = path.join(dir, 'out');
    const file = path.join(dir, 'modern', scenario === 'hash' || scenario === 'identity' ? 'youtube.leanback.v4.manifest.json' : 'build-info.json');
    const value = JSON.parse(fs.readFileSync(file));
    if (scenario === 'hash') value.ipkHash.sha256 = '0'.repeat(64);
    if (scenario === 'identity') value.id += '.webos22';
    if (scenario === 'commit') value.commit = 'b'.repeat(40);
    if (scenario === 'dirty') value.dirty = true;
    if (scenario === 'instrumentation') value.instrumentation = 'perf';
    fs.writeFileSync(file, JSON.stringify(value));
    if (scenario === 'missing') fs.unlinkSync(file);
    try {
      assert.throws(() => prepare(dir, out, scenario === 'tag' ? 'v9.9.9' : 'v1.2.3', true, scenario === 'tag-commit' ? 'c'.repeat(40) : undefined));
      assert.equal(fs.existsSync(out), false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
