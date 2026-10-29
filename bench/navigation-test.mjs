import assert from 'node:assert/strict';
import { test } from 'node:test';
import { customizeGuide, guideCatalog } from '../src/navigation/guide.js';
import { createSubscriptionStartup, isHomeLocation, hasExternalTarget } from '../src/navigation/startup.js';
const entry = (id, title = id) => ({ guideEntryRenderer: { formattedTitle: { simpleText: title }, navigationEndpoint: { browseEndpoint: { browseId: id } } } });
function guide() { return { items: [{ guideSectionRenderer: { items: [entry('FEwhat_to_watch'), { unknownKidsRenderer: { value: 1 } }, entry('FEsubscriptions'), entry('FElibrary'), entry('UCchannel')] } }] }; }
test('sidebar reorders/hides native links while preserving unknown/profile entries and object identity', () => {
  const data = guide(), unknown = data.items[0].guideSectionRenderer.items[1];
  assert.equal(customizeGuide(data, { order: [], hidden: [] }), false);
  customizeGuide(data, { order: ['FEsubscriptions', 'FEwhat_to_watch'], hidden: ['FElibrary'], hideChannels: true });
  assert.equal(data.items[0].guideSectionRenderer.items[0].guideEntryRenderer.navigationEndpoint.browseEndpoint.browseId, 'FEsubscriptions');
  assert.equal(data.items[0].guideSectionRenderer.items[1], unknown);
  assert.equal(data.items[0].guideSectionRenderer.items.length, 3);
  assert.equal(customizeGuide(data, { order: ['FEsubscriptions', 'FEwhat_to_watch'], hidden: ['FElibrary'], hideChannels: true }), false);
});
test('catalog contains only public main navigation; malformed guide and all-hidden settings remain usable', () => {
  assert.equal(guideCatalog(guide()).some(item => item.id === 'UCchannel'), false);
  assert.equal(customizeGuide(null, { hidden: ['x'], order: null }), false);
  const data = { items: [{ guideSectionRenderer: { items: [entry('FEwhat_to_watch'), entry('FEsubscriptions')] } }] };
  customizeGuide(data, { hidden: ['FEwhat_to_watch', 'FEsubscriptions'] }); assert.equal(data.items[0].guideSectionRenderer.items.length, 1);
});
function harness() {
  let enabled = true, account = 'A', landing = true, external = false;
  let dispatcher = async () => command => calls.push(command); const calls = [], statuses = [];
  const controller = createSubscriptionStartup({ enabled: () => enabled, getAccount: () => account, isLanding: () => landing,
    hasExternalLaunch: () => external, getDispatcher: () => dispatcher(), report: text => statuses.push(text) });
  return { controller, calls, statuses, enabled(value) { enabled = value; }, account(value) { account = value; }, landing(value) { landing = value; },
    external(value) { external = value; }, dispatcher(value) { dispatcher = value; } };
}
const catalog = [{ id: 'FEsubscriptions' }];
test('startup opens native Subscriptions once for the confirmed account', async () => {
  const h = harness(); assert.equal(await h.controller.consider(catalog), true); assert.equal(await h.controller.consider(catalog), false);
  assert.deepEqual(h.calls, [{ browseEndpoint: { browseId: 'FEsubscriptions' } }]);
});
for (const reason of ['disabled', 'account', 'navigation', 'external', 'cancel']) {
  test(`startup cannot hijack a pending ${reason} transition`, async () => {
    const h = harness(); let release; h.dispatcher(() => new Promise(resolve => { release = resolve; }));
    const pending = h.controller.consider(catalog);
    if (reason === 'disabled') h.enabled(false);
    if (reason === 'account') h.account('B');
    if (reason === 'navigation') h.landing(false);
    if (reason === 'external') h.external(true);
    if (reason === 'cancel') h.controller.cancel();
    release(command => h.calls.push(command)); assert.equal(await pending, false); assert.deepEqual(h.calls, []);
  });
}
test('guest/unknown accounts, missing subscriptions and native errors preserve the native page', async () => {
  const h = harness(); h.account(null); assert.equal(await h.controller.consider(catalog), false);
  h.account('A'); assert.equal(await h.controller.consider([]), false);
  h.dispatcher(async () => () => { throw Error('native failure'); }); assert.equal(await h.controller.consider(catalog), false); assert.deepEqual(h.calls, []);
});
test('only Home routes are startup candidates', () => {
  for (const hash of ['', '#/', '#/home', '#/browse?c=FEwhat_to_watch']) assert.equal(isHomeLocation({ hash }), true);
  for (const hash of ['#/watch?v=aaaaaaaaaaa', '#/browse?c=UCchannel', '#/search?q=video', '#/subscriptions']) assert.equal(isHomeLocation({ hash }), false);
});

test('launcher metadata does not block startup, while video/voice/cast targets do', () => {
  assert.equal(hasExternalTarget({ reason: 'launcher', target: '' }), false);
  for (const value of [{ target: 'v=aaaaaaaaaaa' }, { contentTarget: { intent: 'search', intentParam: 'video' } }, { dialLaunchParams: 'video' }, 'malformed']) assert.equal(hasExternalTarget(value), true);
});

for (const reason of ['account', 'navigation', 'disabled']) test('invalidating a pending startup permanently retires that startup: ' + reason, async () => {
  const h = harness(); let release;
  h.dispatcher(() => new Promise(resolve => { release = resolve; }));
  const first = h.controller.consider(catalog);
  if (reason === 'account') h.account('B');
  if (reason === 'navigation') h.landing(false);
  if (reason === 'disabled') h.enabled(false);
  release(command => h.calls.push(command)); assert.equal(await first, false);
  h.landing(true); h.enabled(true); h.dispatcher(async () => command => h.calls.push(command));
  assert.equal(await h.controller.consider(catalog), false);
  assert.deepEqual(h.calls, []);
});
