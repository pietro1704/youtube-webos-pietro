const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRequire } = require('node:module');
const cliRequire = createRequire(require.resolve('@webos-tools/cli/package.json'));
const proxyaddr = cliRequire('proxy-addr');

test('short IPv4-mapped IPv6 trust prefix cannot trust arbitrary IPv4 clients', () => {
  const trust = proxyaddr.compile('::ffff:10.0.0.0/8');
  assert.equal(trust('203.0.113.9'), false);
  const req = { socket: { remoteAddress: '203.0.113.9' }, headers: { 'x-forwarded-for': '192.0.2.123' } };
  assert.equal(proxyaddr(req, trust), '203.0.113.9');
});

test('correct IPv4 and IPv4-mapped IPv6 subnets retain intended trust boundaries', () => {
  for (const subnet of ['10.0.0.0/8', '::ffff:10.0.0.0/104']) {
    const trust = proxyaddr.compile(subnet);
    assert.equal(trust('10.2.3.4'), true);
    assert.equal(trust('203.0.113.9'), false);
    const req = { socket: { remoteAddress: '10.2.3.4' }, headers: { 'x-forwarded-for': '192.0.2.123' } };
    assert.equal(proxyaddr(req, trust), '192.0.2.123');
  }
});
