import { filterWatchedVideos, watchedPage } from './progress.js';

export function installWatchedNetworkFilter(win, { enabled, identity, preferences, report = () => {} }) {
  const originalFetch = win.fetch, OriginalXHR = win.XMLHttpRequest;
  const parse = win.JSON ? win.JSON.parse.bind(win.JSON) : JSON.parse;
  const stringify = win.JSON ? win.JSON.stringify.bind(win.JSON) : JSON.stringify;
  const continuations = new Map();
  let active = true, generation = 0, lastIdentity = identity();
  function context() {
    const key = identity();
    if (key !== lastIdentity) { lastIdentity = key; generation++; continuations.clear(); }
    return key;
  }
  function urlFor(resource) {
    try {
      const url = new URL(resource && resource.url ? resource.url : String(resource), win.location.href);
      return url.protocol === 'https:' && /(?:^|\.)youtube\.com$/.test(url.hostname) && /\/youtubei\/v1\/(?:browse|search|next|get_watch)$/.test(url.pathname) ? url : null;
    } catch { return null; }
  }
  function capture(url, body, signal) {
    if (!active || !enabled()) return null;
    const account = context();
    if (!account) return null;
    const pref = preferences();
    let page = watchedPage(url, body);
    if (!page && body && typeof body.continuation === 'string') {
      const saved = continuations.get(body.continuation);
      if (saved && saved.account === account && saved.generation === generation) page = saved.page;
    }
    if (!page || !Array.isArray(pref.pages) || pref.pages.indexOf(page) === -1) return null;
    return { account, generation, page, pref: stringify(pref), threshold: pref.threshold, signal };
  }
  function valid(state) {
    if (!state || !active || !enabled()) return false;
    const account = context();
    return active && enabled() && account === state.account && generation === state.generation && stringify(preferences()) === state.pref && !(state.signal && state.signal.aborted);
  }
  function transform(data, state) {
    if (!valid(state)) return { removed: 0 };
    const result = filterWatchedVideos(data, state.threshold);
    if (result.limited || !valid(state)) return { removed: 0 };
    for (const token of result.tokens || []) {
      continuations.delete(token);
      continuations.set(token, { page: state.page, account: state.account, generation });
      while (continuations.size > 100) continuations.delete(continuations.keys().next().value);
    }
    if (result.removed) report({ page: state.page, removed: result.removed });
    return result;
  }
  function metadata(response, original) {
    for (const key of ['url', 'type', 'redirected']) Object.defineProperty(response, key, { value: original[key], configurable: true });
    const clone = response.clone;
    Object.defineProperty(response, 'clone', { value() { return metadata(clone.call(this), original); }, configurable: true, writable: true });
    return response;
  }
  const wrappedFetch = function (resource, init) {
    const url = enabled() && active ? urlFor(resource) : null;
    if (!url) return originalFetch.apply(this, arguments);
    const signal = init && init.signal !== undefined ? init.signal : resource && resource.signal;
    let body = init && init.body, bodyPromise = null;
    try { if (body === undefined && resource && typeof resource.clone === 'function') bodyPromise = resource.clone().text().catch(() => null); }
    catch { /* Preserve consumed/unsupported request behavior. */ }
    let state = null;
    try { if (!bodyPromise) state = capture(url, typeof body === 'string' ? parse(body) : null, signal); }
    catch { /* Malformed or opaque bodies are kept untouched. */ }
    // Snapshot account/settings before any asynchronous Request body decoding.
    const account = context(), epoch = generation, pref = stringify(preferences());
    const original = originalFetch.apply(this, arguments);
    return original.then(async response => {
      try {
        if (bodyPromise) {
          body = await bodyPromise;
          if (context() !== account || generation !== epoch || stringify(preferences()) !== pref) return response;
          state = capture(url, typeof body === 'string' ? parse(body) : null, signal);
        }
        if (!valid(state) || !response.ok || response.type === 'opaque' || (response.url && !urlFor(response.url))) return response;
        const text = await response.clone().text();
        if (!valid(state)) return response;
        const data = parse(text);
        if (!transform(data, state).removed || !valid(state)) return response;
        const headers = new win.Headers(response.headers); headers.delete('content-length'); headers.delete('content-encoding');
        return metadata(new win.Response(stringify(data), { status: response.status, statusText: response.statusText, headers }), response);
      } catch { return response; }
    });
  };
  if (typeof originalFetch === 'function') win.fetch = wrappedFetch;

  function descriptor(object, key) {
    for (let node = object; node; node = Object.getPrototypeOf(node)) { const value = Object.getOwnPropertyDescriptor(node, key); if (value) return value; }
    return null;
  }
  function WatchedXHR() {
    const xhr = new OriginalXHR();
    const ownOpen = Object.getOwnPropertyDescriptor(xhr, 'open'), ownSend = Object.getOwnPropertyDescriptor(xhr, 'send');
    const text = descriptor(xhr, 'responseText'), response = descriptor(xhr, 'response');
    let url = null, state = null, cache = null, listeners = [];
    function delegate(key, own, args) {
      const method = own && own.value ? own.value : Object.getPrototypeOf(xhr)[key];
      return method.apply(xhr, args);
    }
    function clean() {
      if (xhr.removeEventListener) for (const [name, fn] of listeners) xhr.removeEventListener(name, fn);
      listeners = [];
    }
    xhr.open = function (_method, resource) {
      const result = delegate('open', ownOpen, arguments);
      clean(); url = urlFor(resource); state = null; cache = null; return result;
    };
    xhr.send = function (body) {
      state = null; cache = null;
      try { if (url) state = capture(url, typeof body === 'string' ? parse(body) : null, null); } catch { /* Keep native response. */ }
      if (state && xhr.addEventListener) {
        const request = state;
        for (const name of ['abort', 'error', 'timeout']) {
          const fn = () => { request.cancelled = true; }; xhr.addEventListener(name, fn); listeners.push([name, fn]);
        }
        const done = () => clean(); xhr.addEventListener('loadend', done); listeners.push(['loadend', done]);
      }
      return delegate('send', ownSend, arguments);
    };
    function rewrite(raw, json) {
      if (!valid(state) || state.cancelled || xhr.readyState !== 4 || xhr.status < 200 || xhr.status >= 300 || (xhr.responseURL && !urlFor(xhr.responseURL))) return raw;
      if (cache && cache.raw === raw && cache.json === json) return cache.value;
      try {
        const data = parse(json ? stringify(raw) : raw);
        const result = transform(data, state);
        const value = result.removed && valid(state) ? (json ? data : stringify(data)) : raw;
        cache = { raw, json, value }; return value;
      } catch { return raw; }
    }
    if (text && text.get) Object.defineProperty(xhr, 'responseText', { configurable: true, get() { return rewrite(text.get.call(xhr), false); } });
    if (response && response.get) Object.defineProperty(xhr, 'response', { configurable: true, get() {
      const raw = response.get.call(xhr);
      return xhr.responseType === 'json' ? rewrite(raw, true) : typeof raw === 'string' ? rewrite(raw, false) : raw;
    } });
    return xhr;
  }
  if (typeof OriginalXHR === 'function') {
    WatchedXHR.prototype = OriginalXHR.prototype;
    for (const name of ['UNSENT', 'OPENED', 'HEADERS_RECEIVED', 'LOADING', 'DONE']) WatchedXHR[name] = OriginalXHR[name];
    win.XMLHttpRequest = WatchedXHR;
  }
  return {
    invalidate() { generation++; continuations.clear(); },
    uninstall() { active = false; generation++; continuations.clear(); if (win.fetch === wrappedFetch) win.fetch = originalFetch; if (win.XMLHttpRequest === WatchedXHR) win.XMLHttpRequest = OriginalXHR; }
  };
}
