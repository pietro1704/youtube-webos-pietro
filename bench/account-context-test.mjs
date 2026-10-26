import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readAccountContext } from '../src/account-context.js';

function harness(data, extra = {}) {
  const win = { JSON, document: { body: { classList: { contains: () => false } } }, localStorage: { getItem: () => JSON.stringify({ data, ...extra }) } };
  return { win, read: () => readAccountContext(win) };
}
const account = (id = 'A', token = 'test-only-token') => ({ identityType: 'CORE_ID', gaiaDelegationType: 1, ownerObfuscatedGaiaId: 'owner', effectiveObfuscatedGaiaId: id, identityCredentials: { refreshToken: token } });

test('native CORE_ID account is authenticated without bootstrap LOGGED_IN', () => {
  assert.equal(harness(account()).read().authenticated, true);
});
test('credential rotation preserves identity and credentials never enter the key', () => {
  const a = harness(account()).read(), b = harness(account('A', 'rotated-test-token')).read();
  assert.equal(a.key, b.key);
  assert.ok(!a.key.includes('test-only-token'));
  assert.ok(!a.key.includes('identityCredentials'));
});
test('native effective account, owner and delegation changes invalidate identity', () => {
  const a = account();
  for (const changed of [account('B'), { ...a, ownerObfuscatedGaiaId: 'other-owner' }, { ...a, gaiaDelegationType: 3 }]) assert.notEqual(harness(a).read().key, harness(changed).read().key);
});
test('native child and supervised account types retain separate identities', () => {
  const parent = harness(account()).read();
  for (const identityType of ['PERSONA_CHILD', 'UNICORN_LITE_PROFILE', 'FULL_UNICORN', 'SUPEX']) {
    const result = harness({ ...account(), identityType }).read();
    assert.equal(result.authenticated, true); assert.notEqual(result.key, parent.key);
  }
});
test('guest and uncredentialed remembered accounts never enable account filtering', () => {
  const remembered = account(); delete remembered.identityCredentials;
  assert.equal(harness(remembered).read().authenticated, false);
  assert.notEqual(harness(remembered).read().key, harness(account()).read().key, 'revoked credentials invalidate the authenticated lease');
  for (const identityType of ['UNAUTHENTICATED_IDENTITY_TYPE_GUEST', 'UNAUTHENTICATED_IDENTITY_TYPE_GUEST_KID', 'UNAUTHENTICATED_IDENTITY_TYPE_INCOGNITO', 'UNAUTHENTICATED_IDENTITY_TYPE_UNKNOWN']) assert.equal(harness({ identityType }).read().authenticated, false);
});
test('missing or unsupported identity and malformed storage fail closed', () => {
  for (const data of [null, {}, { identityType: 'CORE_ID', identityCredentials: {} }, { ...account(), identityType: 'future-unknown-type' }]) assert.deepEqual(harness(data).read(), { key: null, authenticated: false });
  const h = harness(account()); h.win.localStorage.getItem = () => '{';
  assert.deepEqual(h.read(), { key: null, authenticated: false });
});
test('account selector cancels even a valid account context', () => {
  const h = harness(account()); h.win.document.body.classList.contains = name => name === 'WEB_PAGE_TYPE_ACCOUNT_SELECTOR';
  assert.deepEqual(h.read(), { key: null, authenticated: false });
});
test('native string-wrapped account data is supported', () => {
  assert.equal(harness(JSON.stringify(account())).read().authenticated, true);
});
