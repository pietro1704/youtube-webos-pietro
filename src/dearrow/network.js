import { selectBranding } from './branding.js';

const API = 'https://sponsor.ajay.app/api/branding?videoID=';

export function createDeArrowClient(options = {}) {
  const fetchImpl = options.fetchImpl || window.fetch.bind(window);
  const timeoutMs = options.timeoutMs || 5000;
  const maxConcurrent = options.maxConcurrent || 4;
  const cache = new Map();
  const queue = [];
  let active = 0;

  function request(videoId) {
    let timer = null;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    const remote = Promise.resolve()
      .then(() =>
        fetchImpl(API + encodeURIComponent(videoId), { credentials: 'omit' }),
      )
      .then((response) => (response && response.ok ? response.json() : null))
      .then(selectBranding)
      .catch(() => null);

    return Promise.race([remote, timeout]).then((result) => {
      if (timer !== null) clearTimeout(timer);
      return result;
    });
  }

  function drain() {
    while (active < maxConcurrent && queue.length > 0) {
      const pending = queue.shift();
      active++;
      request(pending.videoId).then((result) => {
        active--;
        pending.resolve(result);
        drain();
      });
    }
  }

  function enqueue(videoId) {
    return new Promise((resolve) => {
      queue.push({ videoId, resolve });
      drain();
    });
  }

  return {
    get(videoId) {
      if (typeof videoId !== 'string' || !/^[\w-]{11}$/.test(videoId))
        return Promise.resolve(null);
      if (!cache.has(videoId)) cache.set(videoId, enqueue(videoId));
      return cache.get(videoId);
    },
    clear() {
      cache.clear();
    },
  };
}
