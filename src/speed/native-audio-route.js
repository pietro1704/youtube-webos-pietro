import { silentAacBase64 } from './silent-aac.js';

/** Establish a native PCM-capable route on webOS even when its previous eARC
 * state was passthrough without a mixer. The carrier itself contains silence. */
export function createNativeAudioRoute({ win, createNativeAudioSource, onError }) {
  let closed = false;
  let source = null;
  let element = null;
  let buffer = null;
  let timer = null;

  function destroy() {
    if (closed) return;
    closed = true;
    if (timer !== null) win.clearTimeout(timer);
    source?.mediaSource.removeEventListener('sourceopen', opened);
    if (buffer) {
      buffer.removeEventListener('updateend', appended);
      buffer.removeEventListener('error', failed);
    }
    if (element) {
      element.removeEventListener('error', failed);
      element.pause();
      element.removeAttribute('src');
      element.load();
      element.remove();
    }
    if (source) win.URL.revokeObjectURL(source.url);
  }

  function failed(error) {
    if (closed) return;
    destroy();
    onError(error instanceof Error ? error : new Error('Native audio route failed'));
  }

  function appended() {
    if (closed) return;
    buffer.removeEventListener('updateend', appended);
    try { source.mediaSource.endOfStream(); } catch (error) { failed(error); }
  }

  function opened() {
    if (closed) return;
    source.mediaSource.removeEventListener('sourceopen', opened);
    try {
      buffer = source.mediaSource.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
      buffer.addEventListener('updateend', appended);
      buffer.addEventListener('error', failed);
      const raw = win.atob(silentAacBase64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      buffer.appendBuffer(bytes);
    } catch (error) { failed(error); }
  }

  try {
    source = createNativeAudioSource();
    element = win.document.createElement('audio');
    element.setAttribute('data-ytaf-native-audio-route', '');
    element.setAttribute('aria-hidden', 'true');
    element.loop = true;
    element.autoplay = true;
    // Do not mute the native element: webOS must open its output route. The
    // encoded samples are silent; the engine's PCM carries the actual sound.
    element.addEventListener('error', failed);
    source.mediaSource.addEventListener('sourceopen', opened);
    element.src = source.url;
    win.document.body.appendChild(element);
    timer = win.setTimeout(() => failed(new Error('Native audio route timed out')), 8000);
    Promise.resolve(element.play()).then(() => {
      if (closed) return;
      win.clearTimeout(timer);
      timer = null;
    }, failed);
  } catch (error) { failed(error); }
  return { destroy };
}
