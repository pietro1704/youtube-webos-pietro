import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createVideoQueue } from '../src/queue/controller.js';
const first = { id: 'aaaaaaaaaaa', title: 'A' };
const second = { id: 'bbbbbbbbbbb', title: 'B' };
function harness() {
  let identity = 'account-A', video = 'xxxxxxxxxxx', watching = true, enabled = true, time = 0;
  const commands = [], notices = [];
  let dispatcher = async () => command => { commands.push(command); };
  const queue = createVideoQueue({ enabled: () => enabled, getIdentity: () => identity, getVideoId: () => video,
    isWatching: () => watching, getDispatcher: () => dispatcher(), now: () => time, notify: text => notices.push(text) });
  return { queue, commands, notices, account(value) { identity = value; }, video(value) { video = value; },
    watching(value) { watching = value; }, enabled(value) { enabled = value; }, dispatcher(value) { dispatcher = value; }, time(value) { time = value; } };
}
test('add, deduplicate, play next, remove and clear preserve exact video identity', () => {
  const h = harness();
  assert.equal(h.queue.add(first), true); assert.equal(h.queue.add(first), false);
  h.queue.add(second); h.queue.moveNext(second.id);
  assert.deepEqual(h.queue.list(), [second, first]);
  h.queue.remove(second.id); assert.deepEqual(h.queue.list(), [first]);
  assert.equal(h.queue.add({ id: 'invalid' }), false);
  h.queue.clear(); assert.deepEqual(h.queue.list(), []);
});
test('ending local playback dispatches exactly one native watch command and dequeues only after confirmation', async () => {
  const h = harness(); h.queue.add(first); h.queue.add(second);
  assert.equal(await h.queue.onEnded(), true); assert.equal(await h.queue.onEnded(), false);
  assert.deepEqual(h.commands, [{ watchEndpoint: { videoId: first.id } }]);
  assert.equal(h.queue.list().length, 2);
  h.video(first.id); h.queue.observe(); assert.deepEqual(h.queue.list(), [second]);
});
for (const reason of ['clear', 'disable', 'account', 'navigate', 'external', 'destroy']) {
  test(`pending advancement is cancelled on ${reason}`, async () => {
    const h = harness(); let release;
    h.dispatcher(() => new Promise(resolve => { release = resolve; })); h.queue.add(first);
    const pending = h.queue.onEnded();
    if (reason === 'clear') h.queue.clear();
    if (reason === 'disable') h.enabled(false);
    if (reason === 'account') { h.account('account-B'); h.queue.observe(); }
    if (reason === 'navigate') h.video('zzzzzzzzzzz');
    if (reason === 'external') h.queue.externalLaunch();
    if (reason === 'destroy') h.queue.destroy();
    release(command => h.commands.push(command));
    assert.equal(await pending, false); assert.deepEqual(h.commands, []);
  });
}
test('failed navigation and unconfirmed start keep the queue for retry', async () => {
  const h = harness(); h.queue.add(first); h.dispatcher(async () => () => { throw new Error('native unavailable'); });
  assert.equal(await h.queue.play(), false); assert.deepEqual(h.queue.list(), [first]);
  h.dispatcher(async () => command => h.commands.push(command)); await h.queue.play();
  h.time(11000); h.queue.observe(); assert.deepEqual(h.queue.list(), [first]);
  assert.equal(h.notices.length, 2);
});
test('account changes clear queued videos and leaving playback prevents auto advance', async () => {
  const h = harness(); h.queue.add(first); h.watching(false);
  assert.equal(await h.queue.onEnded(), false);
  h.account('account-B'); h.queue.observe(); assert.deepEqual(h.queue.list(), []);
});

test('starting from browse waits for the requested watch page before consuming an item', async () => {
  const h = harness(); h.watching(false); h.queue.add(first);
  assert.equal(await h.queue.play(), true); h.queue.observe();
  h.watching(true); h.video(first.id); h.queue.observe();
  assert.deepEqual(h.queue.list(), []);
});
test('clearing after dispatch makes a late native completion inert', async () => {
  const h = harness(); let release;
  h.queue.add(first); h.dispatcher(async () => () => new Promise(resolve => { release = resolve; }));
  const pending = h.queue.play(); await Promise.resolve(); await Promise.resolve();
  h.queue.clear(); release(); assert.equal(await pending, false);
});
