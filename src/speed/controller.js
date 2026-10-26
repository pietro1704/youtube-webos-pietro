import { AudioEngine } from './audio-engine.js';
import { installAudioFormatFilter } from './audio-formats.js';
import { qualityStorageHeight, selectPreferredQuality } from '../playback-preferences.js';
import {
  installMseHook,
  isSupportedSpeed,
  SUPPORTED_SPEEDS
} from './mse-hook.js';

export const SPEED_BUTTON_TYPE = 'TRANSPORT_CONTROLS_BUTTON_TYPE_SPEED_BUTTON';
export const SPEED_OVERLAY_TYPE = 'CLIENT_OVERLAY_TYPE_VIDEO_PLAYBACK_SPEED';

export function enableSpeedButton(response) {
  const holder =
    response && response.transportControls
      ? response
      : response &&
        response.playerOverlays &&
        response.playerOverlays.playerOverlayRenderer;
  const renderer =
    holder &&
    holder.transportControls &&
    holder.transportControls.transportControlsRenderer;
  if (!renderer || typeof renderer !== 'object') return 0;
  let enabled = 0;
  for (const key of Object.keys(renderer)) {
    const actions = renderer[key];
    if (!Array.isArray(actions)) continue;
    for (const action of actions) {
      if (!action || action.type !== SPEED_BUTTON_TYPE) continue;
      const button = action.button && action.button.buttonRenderer;
      if (!button || !button.isDisabled) continue;
      button.isDisabled = false;
      if (!button.command) {
        button.command = {
          openClientOverlayAction: { type: SPEED_OVERLAY_TYPE }
        };
      }
      enabled++;
    }
  }
  return enabled;
}

export function installSpeedButtonPatch(win, isOn) {
  const json = win.JSON || JSON;
  const original = json.parse;
  const patched = function () {
    const r = original.apply(this, arguments);
    if (
      r &&
      typeof r === 'object' &&
      (r.transportControls ||
        (r.playerOverlays &&
          r.playerOverlays.playerOverlayRenderer &&
          r.playerOverlays.playerOverlayRenderer.transportControls)) &&
      isOn()
    ) {
      enableSpeedButton(r);
    }
    return r;
  };
  json.parse = patched;
  return () => {
    if (json.parse === patched) json.parse = original;
  };
}

export function enableNativeSpeedMenu(win) {
  const proto = (win.Object || Object).prototype;
  const previous = Object.getOwnPropertyDescriptor(proto, 'enableSpeedOptions');
  Object.defineProperty(proto, 'enableSpeedOptions', {
    configurable: true,
    enumerable: false,
    get() {
      return true;
    },
    set(value) {
      Object.defineProperty(this, 'enableSpeedOptions', {
        value,
        writable: true,
        configurable: true,
        enumerable: true
      });
    }
  });
  return () => {
    if (previous) Object.defineProperty(proto, 'enableSpeedOptions', previous);
    else delete proto.enableSpeedOptions;
  };
}

export function hookRateAssignments(win, controller, now = () => Date.now()) {
  const proto = (win.Object || Object).prototype;
  const previous = Object.getOwnPropertyDescriptor(proto, 'setPlaybackRate');
  Object.defineProperty(proto, 'setPlaybackRate', {
    configurable: true,
    enumerable: false,
    get() {
      return undefined;
    },
    set(fn) {
      if (Object(this) !== this) return;
      const plain =
        Object.getPrototypeOf(this) === proto &&
        // Object.hasOwn is unavailable on the legacy webOS target.
        // eslint-disable-next-line prefer-object-has-own
        !Object.prototype.hasOwnProperty.call(this, 'constructor');
      Object.defineProperty(this, 'setPlaybackRate', {
        value:
          plain && typeof fn === 'function'
            ? wrapRate(fn, controller, now)
            : fn,
        writable: true,
        configurable: true,
        enumerable: true
      });
    }
  });
  return () => {
    if (previous) Object.defineProperty(proto, 'setPlaybackRate', previous);
    else delete proto.setPlaybackRate;
  };
}

export function bindPlayerRate(player, controller, now = () => Date.now()) {
  if (
    !player ||
    typeof player.setPlaybackRate !== 'function' ||
    player.__ytafSpeedBound
  )
    return false;
  const original = player.setPlaybackRate;
  player.__ytafOriginalSetPlaybackRate = original.__ytafUnwrapped || original;
  if (!original.__ytafUnwrapped)
    player.setPlaybackRate = wrapRate(original, controller, now);
  player.__ytafSpeedBound = true;
  return true;
}

function wrapRate(original, controller, now) {
  if (original.__ytafUnwrapped) return original;
  const wrapped = function (rate) {
    const result = original.apply(this, arguments);
    const r = Number(rate);
    const sinceReload = now() - controller.lastReloadAt();
    if (
      isSupportedSpeed(r) &&
      r !== controller.getSpeed() &&
      sinceReload > IGNORE_AFTER_RELOAD_MS
    ) {
      controller.setSpeed(r, { immediate: true });
    }
    return result;
  };
  wrapped.__ytafUnwrapped = original;
  return wrapped;
}

export const IGNORE_AFTER_RELOAD_MS = 3000;

export const SPEEDS = [1, 1.25, 1.5, 1.75, 2];

export const RELOAD_DELAY_MS = 800;

export function createSpeedController({
  win,
  getPlayer,
  notify,
  configRead,
  configWrite
}) {
  const configuredSpeed = Number(configRead('defaultPlaybackSpeed'));
  let currentSpeed = isSupportedSpeed(configuredSpeed) ? configuredSpeed : 1;
  let activeSink = null;
  let pending = null;
  let lastReloadAt = 0;
  let lastVideoId = null;
  let lastError = null;

  function videoId() {
    try {
      const player = getPlayer();
      return player && player.getVideoData && player.getVideoData().video_id;
    } catch { return null; }
  }

  function isSupported() {
    return typeof win.AudioDecoder !== 'undefined';
  }

  function enabled() {
    return configRead('enablePlaybackSpeed') !== false;
  }

  function getSpeed() {
    const id = videoId();
    if (id && id !== lastVideoId) {
      lastVideoId = id;
      const preferred = Number(configRead('defaultPlaybackSpeed'));
      currentSpeed = isSupportedSpeed(preferred) ? preferred : 1;
      lastError = null;
    }
    return enabled() && isSupported() ? currentSpeed : 1;
  }

  function position(player) {
    try {
      return player.getCurrentTime();
    } catch {
      return 0;
    }
  }

  function scheduleReload(fromSpeed, immediate = false) {
    const player = getPlayer();
    if (!player) return;
    if (pending && pending.videoId !== videoId()) {
      win.clearTimeout(pending.timer);
      pending = null;
    }
    if (pending) {
      win.clearTimeout(pending.timer);
    } else {
      pending = { position: position(player), videoId: videoId(), fromSpeed, timer: null };
    }
    if (immediate) {
      const p = pending;
      pending = null;
      applyReload(p);
      return;
    }
    pending.timer = win.setTimeout(() => {
      const p = pending;
      pending = null;
      applyReload(p);
    }, RELOAD_DELAY_MS);
  }

  function applyReload({ position: at, fromSpeed, videoId: expectedId }) {
    if (expectedId && expectedId !== videoId()) return;
    // Back where the burst started: the playing MediaSource is already right.
    if (currentSpeed === fromSpeed) return;
    // Stop any previous Web Audio engine immediately so it doesn't keep playing
    // while the new MediaSource is being set up.
    releaseAudioSink();
    const player = getPlayer();
    if (!player) return;
    if (
      currentSpeed > 1.25 &&
      typeof player.setPlaybackQualityRange === 'function'
    ) {
      const preferred = configRead('preferredVideoQuality');
      const limit = qualityStorageHeight(preferred);
      const capped = limit && limit <= 1080 ? preferred : 'hd1080';
      const quality = typeof player.getAvailableQualityLevels === 'function'
        ? selectPreferredQuality(player.getAvailableQualityLevels(), capped) || 'auto'
        : capped;
      player.setPlaybackQualityRange(quality, quality);
    } else if (
      fromSpeed > 1.25 &&
      typeof player.setPlaybackQualityRange === 'function'
    ) {
      const preferred = configRead('preferredVideoQuality');
      const quality =
        preferred && preferred !== 'auto'
          ? preferred
          : configRead('forceHighResVideo')
            ? 'highres'
            : 'auto';
      player.setPlaybackQualityRange(quality, quality);
    }
    const videoData = player.getVideoData && player.getVideoData();
    if (!videoData || !videoData.video_id) return;
    lastReloadAt = Date.now();
    player.loadVideoById(videoData.video_id, at);
    // If YouTube's own menu is bound (native-menu.js), keep what it shows in
    // line with the real speed once the reloaded video has started.
    const setRate = player.__ytafOriginalSetPlaybackRate;
    if (setRate && typeof player.getPlaybackRate === 'function') {
      win.setTimeout(() => {
        try {
          if (player.getPlaybackRate() !== currentSpeed)
            setRate.call(player, currentSpeed);
        } catch {
          // The menu only shows a stale value; playback itself is unaffected.
        }
      }, 2500);
    }
  }

  function setSpeed(speed, { immediate = false, shouldNotify = true, reload = true, persist = true } = {}) {
    speed = Number(speed);
    if (!isSupportedSpeed(speed)) return false;
    if (speed === currentSpeed) return true;
    if (!enabled()) {
      if (shouldNotify) notify('Playback speed is disabled in YTAF settings');
      return false;
    }
    if (!isSupported()) {
      if (shouldNotify) notify('Playback speed is not supported on this TV');
      return false;
    }
    const previousSpeed = currentSpeed;
    lastVideoId = videoId() || lastVideoId;
    currentSpeed = speed;
    if (persist && configWrite) configWrite('defaultPlaybackSpeed', String(speed));
    if (shouldNotify) notify(`Playback speed ${speed}×`);
    if (reload) scheduleReload(
      pending && pending.videoId === videoId() ? pending.fromSpeed : previousSpeed,
      immediate
    );
    return true;
  }

  function cycle() {
    const idx = SPEEDS.indexOf(currentSpeed);
    const nextIdx = (idx + 1) % SPEEDS.length;
    return setSpeed(SPEEDS[nextIdx]);
  }

  function step(dir) {
    let idx = SUPPORTED_SPEEDS.indexOf(currentSpeed);
    if (idx === -1) idx = SUPPORTED_SPEEDS.indexOf(1);
    const nextIdx = Math.min(
      SUPPORTED_SPEEDS.length - 1,
      Math.max(0, idx + (dir >= 0 ? 1 : -1))
    );
    return setSpeed(SUPPORTED_SPEEDS[nextIdx]);
  }

  function reset() {
    return setSpeed(1);
  }

  function onRateRequest() {}

  function onError(error) {
    lastError = error && (error.name + ': ' + error.message);
    if (currentSpeed !== 1) {
      const previousSpeed = currentSpeed;
      currentSpeed = 1;
      notify('Playback speed not available for this video');
      scheduleReload(pending && pending.videoId === videoId() ? pending.fromSpeed : previousSpeed);
    }
  }

  function releaseAudioSink() {
    if (!activeSink) return;
    activeSink.engine.destroy();
    if (activeSink.element)
      activeSink.element.removeEventListener(
        'volumechange',
        activeSink.listener
      );
    activeSink = null;
  }

  function destroy() {
    if (pending) win.clearTimeout(pending.timer);
    pending = null;
    releaseAudioSink();
  }

  function createAudioSink({ speed, element }) {
    releaseAudioSink();

    const engine = new AudioEngine({ win, speed, onError,
      audioOffsetMs: Number(configRead('audioSyncOffsetMs')) || 0 });
    if (element) {
      engine.attachVideo(element);
      engine.setVolume(element.volume, element.muted);
      const listener = () => {
        engine.setVolume(element.volume, element.muted);
      };
      element.addEventListener('volumechange', listener);
      activeSink = { engine, element, listener };
    } else {
      activeSink = { engine, element: null, listener: null };
    }
    return engine;
  }

  function handleKey(evt) {
    // YTAF's ui.js reads colour keys from charCode, the webOS docs from keyCode:
    // accept both.
    const code = evt.keyCode || evt.charCode;
    if (code === 405 || code === 170) {
      if (evt.type === 'keydown') {
        evt.preventDefault();
        if (evt.stopPropagation) evt.stopPropagation();
        // YouTube re-dispatches remote keys from its own listeners on document
        // (seen on the TV: one press cycled twice); ours runs first, so stop them.
        if (evt.stopImmediatePropagation) evt.stopImmediatePropagation();
        cycle();
        return true;
      } else if (evt.type === 'keypress' || evt.type === 'keyup') {
        evt.preventDefault();
        return true;
      }
    }
    return false;
  }

  return {
    diagnostic: () => ({ speed: currentSpeed, videoId: lastVideoId, lastError,
      audio: activeSink ? { codec: activeSink.engine.cfg && activeSink.engine.cfg.codec,
        contextState: activeSink.engine.ctx.state, baseLatency: activeSink.engine.ctx.baseLatency,
        outputLatency: activeSink.engine.ctx.outputLatency,
        compensatedLatency: activeSink.engine.outputLatencyS,
        offsetMs: activeSink.engine.audioOffsetMs,
        decoderState: activeSink.engine.decoder && activeSink.engine.decoder.state,
        elementAttached: !!activeSink.engine.video,
        decodedFrames: activeSink.engine.decodedFrames,
        scheduledFrames: activeSink.engine.scheduledFrames,
        lastPcmPeak: activeSink.engine.lastPcmPeak,
        recoveries: activeSink.engine.recoveries.length } : null }),
    activeEngine: () => (activeSink ? activeSink.engine : null),
    lastReloadAt: () => lastReloadAt,
    isSupported,
    getSpeed,
    setSpeed,
    cycle,
    step,
    reset,
    onRateRequest,
    onError,
    createAudioSink,
    releaseAudioSink,
    destroy,
    handleKey
  };
}

export function installSpeedFeature(
  win,
  { notify, configRead: cfgRead, configWrite: cfgWrite, getPlayer }
) {
  if (
    typeof win.AudioDecoder === 'undefined' ||
    typeof win.AudioContext === 'undefined' ||
    typeof win.MediaSource === 'undefined'
  ) {
    return null;
  }

  const ctrl = createSpeedController({
    win,
    getPlayer,
    notify,
    configRead: cfgRead,
    configWrite: cfgWrite
  });
  const mseHook = installMseHook(win, {
    getSpeed: ctrl.getSpeed,
    createAudioSink: ctrl.createAudioSink,
    onRateRequest: ctrl.onRateRequest,
    onError: ctrl.onError,
    onNativeAudio: ctrl.releaseAudioSink
  });
  const audioFormats = installAudioFormatFilter(win, ctrl.getSpeed);

  // The adopted speed row calls ctrl.setSpeed for explicit user choices.
  // YouTube's internal setPlaybackRate(1) during navigation is not user input
  // and must never overwrite defaultPlaybackSpeed or create a reload loop.

  const keyHandler = (evt) => ctrl.handleKey(evt);
  win.document.addEventListener('keydown', keyHandler, true);
  win.document.addEventListener('keypress', keyHandler, true);
  win.document.addEventListener('keyup', keyHandler, true);

  return {
    controller: ctrl,
    uninstall() {
      mseHook.uninstall();
      audioFormats.uninstall();
      ctrl.destroy();
      win.document.removeEventListener('keydown', keyHandler, true);
      win.document.removeEventListener('keypress', keyHandler, true);
      win.document.removeEventListener('keyup', keyHandler, true);
    }
  };
}
