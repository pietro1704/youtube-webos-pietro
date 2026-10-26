import { selectBranding } from './branding.js';

const API = 'https://sponsor.ajay.app/api/branding?videoID=';

export function createDeArrowClient(options = {}) {
  const fetchImpl = options.fetchImpl || window.fetch.bind(window);
  const timeoutMs = options.timeoutMs || 5000;
  const maxConcurrent = options.maxConcurrent || 4;
  const maxQueue = options.maxQueue || 64;
  const maxCacheEntries = options.maxCacheEntries || 256;
  const cacheTtlMs = options.cacheTtlMs || 600000;
  const negativeTtlMs = options.negativeTtlMs || 30000;
  const now = options.now || Date.now;
  const Abort = options.AbortControllerImpl === undefined
    ? (typeof AbortController === 'function' ? AbortController : null)
    : options.AbortControllerImpl;
  const cache = new Map();
  const pending = new Map();
  const active = new Set();
  const queue = [];
  let destroyed = false;

  function finish(entry, result) {
    if (entry.settled) return;
    entry.settled = true;
    clearTimeout(entry.timer);
    if (pending.get(entry.videoId) === entry) pending.delete(entry.videoId);
    const index = queue.indexOf(entry);
    if (index !== -1) queue.splice(index, 1);
    if (!destroyed) {
      cache.delete(entry.videoId);
      cache.set(entry.videoId, { result, expires: now() + (result ? cacheTtlMs : negativeTtlMs) });
      while (cache.size > maxCacheEntries) cache.delete(cache.keys().next().value);
    }
    entry.resolve(result);
  }

  function abort(entry) {
    if (entry.controller) {
      try { entry.controller.abort(); } catch { /* legacy or incomplete abort API */ }
    }
  }

  function drain() {
    while (!destroyed && active.size < maxConcurrent && queue.length > 0) {
      const entry = queue.shift();
      active.add(entry);
      entry.controller = Abort ? new Abort() : null;
      const init = { credentials: 'omit' };
      if (entry.controller) init.signal = entry.controller.signal;
      Promise.resolve()
        .then(() => entry.settled ? null : fetchImpl(API + encodeURIComponent(entry.videoId), init))
        .then(response => response && response.ok ? response.json() : null)
        .then(selectBranding)
        .catch(() => null)
        .then(result => {
          finish(entry, result);
          // A timeout resolves callers, but only completion/abort frees a real
          // network slot. This also bounds legacy fetch without AbortController.
          active.delete(entry);
          drain();
        });
    }
  }

  function clear() {
    for (const entry of Array.from(pending.values())) finish(entry, null);
    for (const entry of Array.from(active)) abort(entry);
    cache.clear();
  }

  return {
    get(videoId) {
      if (destroyed || typeof videoId !== 'string' || !/^[\w-]{11}$/.test(videoId))
        return Promise.resolve(null);
      const cached = cache.get(videoId);
      if (cached) {
        cache.delete(videoId);
        if (cached.expires > now()) {
          cache.set(videoId, cached);
          return Promise.resolve(cached.result);
        }
      }
      if (pending.has(videoId)) return pending.get(videoId).promise;
      if (active.size >= maxConcurrent && queue.length >= maxQueue) return Promise.resolve(null);
      const entry = { videoId, settled: false, controller: null };
      entry.promise = new Promise(resolve => { entry.resolve = resolve; });
      pending.set(videoId, entry);
      entry.timer = setTimeout(() => {
        finish(entry, null);
        abort(entry);
      }, timeoutMs);
      queue.push(entry);
      drain();
      return entry.promise;
    },
    clear,
    destroy() {
      destroyed = true;
      clear();
    },
  };
}
