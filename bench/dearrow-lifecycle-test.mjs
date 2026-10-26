import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createDeArrowClient } from '../src/dearrow/network.js';
import { createDeArrowDomAdapter } from '../src/dearrow/dom.js';

const id = n => String(n).padStart(11, 'a');
const branding = { title: 'Better', thumbnailTimestamp: null };
const response = () => ({ ok: true, json: async () => ({ titles: [{ title: 'Better', votes: 1 }] }) });

test('timeouts abort requests and preserve the physical concurrency limit', async () => {
  let active = 0;
  let peak = 0;
  let aborted = 0;
  const client = createDeArrowClient({ timeoutMs: 10, maxConcurrent: 2,
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      peak = Math.max(peak, ++active);
      options.signal?.addEventListener('abort', () => {
        active--; aborted++; reject(new Error('aborted'));
      });
    }) });
  await Promise.all(Array.from({ length: 8 }, (_, n) => client.get(id(n))));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(peak <= 2, `physical peak ${peak}`);
  assert.equal(active, 0);
  assert.ok(aborted > 0);
  client.destroy();
});

test('legacy timeouts resolve without starting more unabortable requests', async () => {
  let calls = 0;
  const client = createDeArrowClient({ timeoutMs: 5, maxConcurrent: 2,
    AbortControllerImpl: null, fetchImpl: () => { calls++; return new Promise(() => {}); } });
  const values = await Promise.all(Array.from({ length: 8 }, (_, n) => client.get(id(n))));
  assert.deepEqual(values, Array(8).fill(null));
  assert.equal(calls, 2);
  client.destroy();
});

test('transient failure expires and duplicate callers share an in-flight request', async () => {
  let calls = 0;
  let clock = 0;
  const client = createDeArrowClient({ negativeTtlMs: 10, now: () => clock,
    fetchImpl: async () => { if (++calls === 1) throw new Error('offline'); return response(); } });
  assert.equal(await client.get(id(1)), null);
  assert.equal(await client.get(id(1)), null);
  assert.equal(calls, 1);
  clock = 11;
  const first = client.get(id(1));
  assert.equal(client.get(id(1)), first);
  assert.deepEqual(await first, branding);
  assert.equal(calls, 2);
  client.destroy();
});

test('cache size and lifetime are bounded', async () => {
  let calls = 0;
  let clock = 0;
  const client = createDeArrowClient({ maxCacheEntries: 2, cacheTtlMs: 10, now: () => clock,
    fetchImpl: async () => { calls++; return response(); } });
  await client.get(id(1)); await client.get(id(2)); await client.get(id(3));
  await client.get(id(1));
  assert.equal(calls, 4, 'oldest cached entry must be evicted');
  clock = 11;
  await client.get(id(1));
  assert.equal(calls, 5, 'expired successful result must be refreshed');
  client.destroy();
});

test('destroy resolves active and queued requests and ignores late completion', async () => {
  let complete;
  let calls = 0;
  const client = createDeArrowClient({ maxConcurrent: 1, maxQueue: 1,
    fetchImpl: () => { calls++; return new Promise(resolve => { complete = resolve; }); } });
  const first = client.get(id(1));
  const queued = client.get(id(2));
  await Promise.resolve();
  assert.equal(await client.get(id(3)), null, 'overflow must settle immediately');
  client.destroy();
  assert.deepEqual(await Promise.all([first, queued]), [null, null]);
  complete(response());
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(await client.get(id(4)), null);
  assert.equal(calls, 1);
});

test('removed tiles reject late branding and can be reinserted with fresh nodes', async () => {
  const dom = new JSDOM('<main><div data-video-id="aaaaaaaaaa1"><span data-title>Original</span></div></main>');
  const root = dom.window.document.querySelector('main');
  const tile = root.firstElementChild;
  let complete;
  const adapter = createDeArrowDomAdapter({ root, getMode: () => 'titles',
    client: { get: () => new Promise(resolve => { complete = resolve; }) } });
  adapter.refresh();
  tile.remove();
  adapter.refresh();
  complete(branding);
  await Promise.resolve();
  assert.equal(tile.textContent, 'Original');
  tile.innerHTML = '<span data-title>New original</span>';
  root.appendChild(tile);
  adapter.refresh();
  complete(branding);
  await Promise.resolve();
  assert.equal(tile.textContent, 'Better');
  adapter.destroy();
  assert.equal(tile.textContent, 'New original');
  dom.window.close();
});

test('clearing on disable cancels work and permits a later retry', async () => {
  let calls = 0;
  const client = createDeArrowClient({ fetchImpl: (_url, options) => {
    if (++calls > 1) return Promise.resolve(response());
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  } });
  const pending = client.get(id(1));
  await Promise.resolve();
  client.clear();
  assert.equal(await pending, null);
  assert.deepEqual(await client.get(id(1)), branding);
  assert.equal(calls, 2);
  client.destroy();
});
