import { prunePlayerAnnotations } from '../player-annotations.js';
import { prunePromotions } from './promotions.js';
const parseResponse = JSON.parse;
import { objectPruneFn } from './object-prune.js';

// uAssets/filters/filters.txt at 6ddd246494b8c630ee1a93e715090214cb073903.
// These are the official YouTube rules; browser-extension APIs are replaced
// with webview hooks. This is not the complete uBlock Origin extension.
export const RULESET = {
  source: 'https://github.com/uBlockOrigin/uAssets/blob/6ddd246494b8c630ee1a93e715090214cb073903/filters/filters.txt',
  engine: 'https://github.com/gorhill/uBlock/blob/527a05c7af552a669fa2f51c29d5c7a214da7a2c/src/js/resources/object-prune.js',
  prune: 'playerResponse.adPlacements playerResponse.playerAds playerResponse.adSlots adPlacements playerAds adSlots important',
  shorts: 'reelWatchSequenceResponse.entries.[-].command.reelWatchEndpoint.adClientParams.isAd entries.[-].command.reelWatchEndpoint.adClientParams.isAd'
};

export function pruneYouTubeAds(data) {
  if (!data || typeof data !== 'object') return data;
  objectPruneFn(data, RULESET.prune, '');
  objectPruneFn(data, RULESET.shorts, '');
  prunePromotions(data);
  return data;
}

function youtubeUrl(raw, base) {
  try {
    const url = new URL(String(raw), base);
    return /(?:^|\.)youtube\.com$/.test(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

export function shouldBlockRequest(raw, base) {
  try {
    const url = new URL(String(raw), base);
    return /(?:^|\.)googlevideo\.com$/.test(url.hostname) &&
      url.pathname === '/initplayback' && url.searchParams.get('source') === 'youtube' &&
      url.searchParams.get('c') === 'TVHTML5' && url.searchParams.has('oad');
  } catch {
    return false;
  }
}

export function rewriteYouTubeResponse(text, rawUrl, base, ads = true, annotations = false) {
  const url = youtubeUrl(rawUrl, base);
  if (!url || typeof text !== 'string') return text;
  if (/\/(?:player|get_watch|browse|next)$/.test(url.pathname)) {
    try {
      const data = parseResponse(text);
      const removedPromotions = ads && prunePromotions(data);
      const removedAnnotations = annotations && prunePlayerAnnotations(data);
      if (removedPromotions || removedAnnotations) text = JSON.stringify(data);
    } catch { /* malformed responses pass through unchanged */ }
  }
  if (!ads) return text;
  // trusted-replace-fetch-response / trusted-replace-xhr-response and the
  // corresponding HTML-filtering replace rules, all from the pinned uAssets.
  if (/\/(?:player|get_watch)$/.test(url.pathname) ||
      (url.pathname === '/watch' && url.search) ||
      (url.pathname === '/playlist' && url.searchParams.has('list'))) {
    return text.replace(/"adPlacements"/g, '"no_ads"')
      .replace(/"adSlots"/g, '"no_ads"');
  }
  if (/\/reel_watch_sequence$/.test(url.pathname)) {
    try {
      const data = JSON.parse(text);
      objectPruneFn(data, RULESET.shorts, '');
      return JSON.stringify(data);
    } catch {
      return text;
    }
  }
  return text;
}

export function installYouTubeNetworkRules(win, enabled, hideAnnotations = () => false) {
  const nativeFetch = win.fetch;
  const NativeXHR = win.XMLHttpRequest;
  const base = win.location.href;
  if (typeof nativeFetch === 'function') {
    win.fetch = function (resource, init) {
      const url = resource && resource.url ? resource.url : String(resource);
      if (!enabled() && !hideAnnotations()) return nativeFetch.apply(this, arguments);
      const signal = init && init.signal !== undefined ? init.signal : resource && resource.signal;
      if (signal && signal.aborted) return nativeFetch.apply(this, arguments);
      if (enabled() && shouldBlockRequest(url, base)) {
        return Promise.reject(new TypeError('Failed to fetch'));
      }
      const original = nativeFetch.apply(this, arguments);
      const parsed = youtubeUrl(url, base);
      if (!parsed || !/\/(?:player|get_watch|watch|playlist|reel_watch_sequence|browse|next)$/.test(parsed.pathname)) return original;
      return original.then(async (response) => {
        if ((!enabled() && !hideAnnotations()) || !response.ok || response.type === 'opaque') return response;
        const text = await response.clone().text();
        const next = rewriteYouTubeResponse(text, url, base, enabled(), hideAnnotations());
        if (next === text) return response;
        const headers = new win.Headers(response.headers);
        headers.delete('content-length');
        headers.delete('content-encoding');
        const rewritten = new win.Response(next, {
          status: response.status, statusText: response.statusText, headers
        });
        for (const key of ['url', 'type', 'redirected']) {
          Object.defineProperty(rewritten, key, { value: response[key] });
        }
        return rewritten;
      });
    };
  }
  if (typeof NativeXHR === 'function') {
    const descriptor = (key) => {
      let proto = NativeXHR.prototype;
      while (proto) {
        const found = Object.getOwnPropertyDescriptor(proto, key);
        if (found) return found;
        proto = Object.getPrototypeOf(proto);
      }
      return null;
    };
    const textDescriptor = descriptor('responseText');
    const responseDescriptor = descriptor('response');
    // Construct the host object directly: Babel's ES5 subclass transform cannot
    // call native/class XHR constructors using Function.apply on older webOS.
    function FilteredXHR() {
      const xhr = new NativeXHR();
      const open = xhr.open;
      const send = xhr.send;
      let requestUrl = '';
      let blocked = false;
      xhr.open = function (method, url) {
        requestUrl = String(url);
        const args = Array.prototype.slice.call(arguments);
        blocked = false;
        if (enabled() && shouldBlockRequest(url, base)) {
          args[0] = 'GET';
          args[1] = 'data:text/plain,';
          blocked = true;
        }
        return (NativeXHR.prototype.open || open).apply(xhr, args);
      };
      xhr.send = function (body) {
        return (NativeXHR.prototype.send || send).call(xhr, blocked ? null : body);
      };
      if (textDescriptor && textDescriptor.get) {
        Object.defineProperty(xhr, 'responseText', { configurable: true, get() {
          const text = textDescriptor.get.call(xhr);
          return enabled() || hideAnnotations() ? rewriteYouTubeResponse(text, requestUrl, base, enabled(), hideAnnotations()) : text;
        } });
      }
      if (responseDescriptor && responseDescriptor.get) {
        Object.defineProperty(xhr, 'response', { configurable: true, get() {
          const value = responseDescriptor.get.call(xhr);
          if ((!enabled() && !hideAnnotations()) || !youtubeUrl(requestUrl, base)) return value;
          if (xhr.responseType === 'json') {
            if (enabled()) pruneYouTubeAds(value);
            if (hideAnnotations()) prunePlayerAnnotations(value);
            return value;
          }
          return typeof value === 'string' ? rewriteYouTubeResponse(value, requestUrl, base, enabled(), hideAnnotations()) : value;
        } });
      }
      return xhr;
    }
    FilteredXHR.prototype = NativeXHR.prototype;
    for (const key of ['UNSENT', 'OPENED', 'HEADERS_RECEIVED', 'LOADING', 'DONE']) {
      FilteredXHR[key] = NativeXHR[key];
    }
    win.XMLHttpRequest = FilteredXHR;
  }
}

export function installInitialResponseRules(win, enabled, hideAnnotations = () => false) {
  const filter = value => {
    if (enabled()) pruneYouTubeAds(value);
    if (hideAnnotations()) prunePlayerAnnotations(value);
    return value;
  };
  for (const key of ['ytInitialPlayerResponse', 'playerResponse', 'ytInitialData']) {
    let value = win[key];
    const previous = Object.getOwnPropertyDescriptor(win, key);
    if (previous && previous.configurable === false) {
      filter(value);
      continue;
    }
    Object.defineProperty(win, key, {
      configurable: true,
      enumerable: true,
      get() { return filter(value); },
      set(next) { value = filter(next); }
    });
  }
}
