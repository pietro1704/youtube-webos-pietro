import { createNativeAudioRoute } from './native-audio-route.js';

/** A native audio track in the video already keeps webOS's eARC mixer open.
 * Send PCM directly in that case: a MediaStream element would add Chromium's
 * AudioShifter, whose startup clock correction raises pitch by up to 10%.
 * Keep the media-element route for callers without a native video carrier. */
export function createAudioOutput({ win, context, source, onError, createNativeAudioSource, hasNativeAudioTrack = false }) {
  let closed = false;
  let destination = null;
  let element = null;
  let nativeRoute = null;
  const mediaOutput = !hasNativeAudioTrack && typeof context.createMediaStreamDestination === 'function' && !!win.document?.body;
  const type = mediaOutput ? 'media-stream' : 'audio-context';

  function destroy() {
    if (closed) return;
    closed = true;
    nativeRoute?.destroy();
    try { source.disconnect?.(); } catch { /* already disconnected */ }
    if (element) {
      element.removeEventListener('error', failed);
      element.pause();
      element.srcObject = null;
      element.remove();
    }
    if (destination) destination.stream.getTracks().forEach(track => { track.stop(); });
  }

  function failed(error) {
    if (closed) return;
    destroy();
    onError(error instanceof Error ? error : new Error('Accelerated audio output failed'));
  }

  try {
    if (mediaOutput) {
      destination = context.createMediaStreamDestination();
      element = win.document.createElement('audio');
      element.setAttribute('data-ytaf-audio-output', '');
      element.setAttribute('aria-hidden', 'true');
      element.autoplay = true;
      element.srcObject = destination.stream;
      element.addEventListener('error', failed);
      win.document.body.appendChild(element);
      source.connect(destination);
      Promise.resolve(element.play()).catch(failed);
      if (createNativeAudioSource) {
        nativeRoute = createNativeAudioRoute({ win, createNativeAudioSource, onError: failed });
      }
    } else {
      source.connect(context.destination);
    }
  } catch (error) {
    failed(error);
  }
  return { type, destroy };
}
