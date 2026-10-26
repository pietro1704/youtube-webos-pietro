/** Audio containers/codecs accepted by our demuxer and WebCodecs path. */
function compatibleAudio(mime) {
  if (typeof mime !== 'string') return false;
  const match = mime.match(/^audio\/(mp4|webm)\s*;\s*codecs\s*=\s*["']?([^"';]+)/i);
  if (!match) return false;
  const codec = match[2].trim().toLowerCase();
  return codec === 'opus' || (match[1].toLowerCase() === 'mp4' && codec === 'mp4a.40.2');
}

export function filterAcceleratedAudio(streaming, speed) {
  if (Number(speed) === 1 || !streaming || !Array.isArray(streaming.adaptiveFormats)) return false;
  const formats = streaming.adaptiveFormats;
  if (!formats.some(format => format && compatibleAudio(format.mimeType))) return false;
  // Preserve every video format and the original progressive/muxed fallback.
  // Never remove all audio, or change platform-wide codec capabilities based
  // on a different video's offer.
  const filtered = formats.filter(format =>
    !format || typeof format.mimeType !== 'string' ||
    !/^audio\//i.test(format.mimeType) || compatibleAudio(format.mimeType));
  if (filtered.length !== formats.length) streaming.adaptiveFormats = filtered;
  return true;
}

export function installAudioFormatFilter(win, getSpeed) {
  const json = win.JSON || JSON;
  const originalParse = json.parse;
  const originalFetch = win.fetch;
  let active = true;
  const streamingData = data => data && typeof data === 'object' &&
    (data.streamingData || (data.playerResponse && data.playerResponse.streamingData));
  const filter = data => {
    const streaming = streamingData(data);
    if (!active || !streaming) return false;
    const before = streaming.adaptiveFormats;
    filterAcceleratedAudio(streaming, getSpeed());
    return before !== streaming.adaptiveFormats;
  };
  const parse = function () {
    const data = originalParse.apply(this, arguments);
    filter(data);
    return data;
  };
  json.parse = parse;

  const fetchAudio = function (resource) {
    let url;
    try {
      url = new URL(resource && resource.url ? resource.url : String(resource), win.location.href);
    } catch {
      return originalFetch.apply(this, arguments);
    }
    if (!active || getSpeed() === 1 || !/(?:^|\.)youtube\.com$/.test(url.hostname) ||
        !/\/(?:player|get_watch)$/.test(url.pathname)) {
      return originalFetch.apply(this, arguments);
    }
    return originalFetch.apply(this, arguments).then(async response => {
      if (!active || getSpeed() === 1 || !response.ok || response.type === 'opaque') return response;
      try {
        const data = originalParse.call(json, await response.clone().text());
        if (!filter(data)) return response;
        const headers = new win.Headers(response.headers);
        headers.delete('content-length');
        headers.delete('content-encoding');
        const rewritten = new win.Response(JSON.stringify(data), {
          status: response.status, statusText: response.statusText, headers
        });
        for (const key of ['url', 'type', 'redirected']) {
          Object.defineProperty(rewritten, key, { value: response[key] });
        }
        return rewritten;
      } catch {
        return response;
      }
    });
  };
  if (typeof originalFetch === 'function') win.fetch = fetchAudio;
  return {
    uninstall() {
      active = false;
      if (json.parse === parse) json.parse = originalParse;
      if (win.fetch === fetchAudio) win.fetch = originalFetch;
    }
  };
}
