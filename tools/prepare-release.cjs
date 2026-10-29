// Offline preparation only: never creates or updates a GitHub release.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const sourceUrl = 'https://github.com/pietro1704/youtube-webos-pietro';
function prepare(input, output, tag, requireClean = false, expectedCommit) {
  assert.match(tag, /^v?\d+\.\d+\.\d+$/);
  const version = tag.replace(/^v/, '');
  const packages = [];
  let commit;
  const assets = [];
  for (const variant of ['legacy', 'modern']) {
    const dir = path.join(input, variant);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'youtube.leanback.v4.manifest.json')));
    const info = JSON.parse(fs.readFileSync(path.join(dir, 'build-info.json')));
    assert.equal(info.version, version);
    assert.equal(info.variant, variant);
    assert.equal(info.instrumentation, 'none');
    assert.match(info.commit, /^[a-f0-9]{40}$/);
    if (requireClean) assert.equal(info.dirty, false);
    if (commit) assert.equal(info.commit, commit);
    commit = info.commit;
    if (expectedCommit) assert.equal(info.commit, expectedCommit, 'Package must come from the release tag checkout');
    assert.equal(manifest.version, version);
    assert.equal(manifest.id, 'youtube.leanback.v4');
    assert.equal(manifest.sourceUrl, sourceUrl);
    assert.equal(manifest.ipkUrl, `youtube.leanback.v4_${version}_all.ipk`);
    const ipk = path.join(dir, manifest.ipkUrl);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(ipk)).digest('hex'), manifest.ipkHash.sha256);
    // Read metadata from the actual package, independently of checkout metadata.
    const data = execFileSync('ar', ['p', ipk, 'data.tar.gz']);
    const names = execFileSync('tar', ['-tzf', '-'], { input: data, encoding: 'utf8' }).trim().split('\n');
    const member = suffix => { const found = names.filter(name => name.endsWith(suffix)); assert.equal(found.length, 1); return found[0]; };
    const unpack = name => JSON.parse(execFileSync('tar', ['-xzOf', '-', member(name)], { input: data, encoding: 'utf8' }));
    const app = unpack('/appinfo.json');
    assert.equal(app.id, manifest.id); assert.equal(app.version, version);
    assert.deepEqual(unpack('/build-info.json'), info);
    const filename = `youtube.leanback.v4_${version}_${variant}_all.ipk`;
    const published = { ...manifest, ipkUrl: `${sourceUrl}/releases/download/${tag}/${filename}` };
    packages.push({ id: manifest.id, title: `${manifest.title} (${variant})`, description: variant === 'modern' ? 'webOS 22+' : 'webOS 3+', iconUri: manifest.iconUri, manifest: published });
    assets.push([filename, fs.readFileSync(ipk)], [`${variant}.manifest.json`, JSON.stringify(published, null, 2)], [`${variant}.build-info.json`, JSON.stringify(info, null, 2)]);
  }
  // Validate both packages before writing any output.
  fs.mkdirSync(output, { recursive: true });
  for (const [name, bytes] of assets) fs.writeFileSync(path.join(output, name), bytes);
  const catalog = { paging: { page: 1, count: 2, maxPage: 1, itemsTotal: 2 }, packages };
  fs.writeFileSync(path.join(output, 'repo.json'), JSON.stringify(catalog, null, 2) + '\n');
  return catalog;
}
module.exports = { prepare };
if (require.main === module) {
  const [input, output, tag, flag] = process.argv.slice(2);
  assert.ok(input && output && tag && (!flag || flag === '--require-clean'), 'Usage: prepare-release input output tag [--require-clean]');
  const expectedCommit = flag === '--require-clean' ? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() : undefined;
  prepare(input, output, tag, flag === '--require-clean', expectedCommit);
}
