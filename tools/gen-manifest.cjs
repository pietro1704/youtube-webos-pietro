#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const outfile = process.argv[2];
const verify = process.argv[3] === '--verify';
if (!outfile || (process.argv[3] && !verify) || process.argv.length > 4)
  throw new Error('Usage: gen-manifest <outfile> [--verify]');

const appinfo = require('../assets/appinfo.json');
const ipkfile = `${appinfo.id}_${appinfo.version}_all.ipk`;
const ipkhash = crypto.createHash('sha256')
  .update(fs.readFileSync(path.join(path.dirname(outfile), ipkfile)))
  .digest('hex');

const manifest = {
  id: appinfo.id,
  version: appinfo.version,
  type: appinfo.type,
  title: appinfo.title,
  iconUri: 'https://raw.githubusercontent.com/pietro1704/youtube-webos-pietro/main/assets/largeIcon.png',
  sourceUrl: 'https://github.com/pietro1704/youtube-webos-pietro',
  rootRequired: false,
  ipkUrl: ipkfile,
  ipkHash: { sha256: ipkhash }
};

if (verify) {
  assert.deepEqual(JSON.parse(fs.readFileSync(outfile, 'utf8')), manifest,
    'Manifest metadata or package SHA-256 does not match');
} else {
  fs.writeFileSync(outfile, `${JSON.stringify(manifest, null, 2)}\n`);
}
