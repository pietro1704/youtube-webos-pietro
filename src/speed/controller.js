import { AudioEngine } from './audio-engine.js';
import { installAudioFormatFilter } from './audio-formats.js';
import { selectPreferredQuality } from '../playback-preferences.js';
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
  let destroyed = false;
  let menuTimer = null;
  let operationGeneration = 0;
  let pauseRestore = null;

  function cancelPauseRestore() {
    if (!pauseRestore) return;
    win.clearTimeout(pauseRestore.timer);
    win.removeEventListener?.('yt-player-state-change', pauseRestore.listener);
    pauseRestore = null;
  }

  function cancelPending() {
    operationGeneration++;
    if (pending) win.clearTimeout(pending.timer);
    pending = null;
    cancelPauseRestore();
  }

  function cancelForNavigation(evt) {
    if (evt.type === 'ytaf-page-update' && evt.detail?.isWatch !== false) return;
    cancelPending();
    cancelMenuSync();
  }
  for (const type of ['hashchange', 'pagehide', 'ytaf-page-update'])
    win.addEventListener?.(type, cancelForNavigation);
  const cancelPauseForInput = evt => {
    if (!evt.__ytafSynthetic) cancelPauseRestore();
  };
  for (const type of ['keydown', 'mousedown'])
    win.addEventListener?.(type, cancelPauseForInput, true);

  function cancelMenuSync() {
    if (menuTimer !== null) win.clearTimeout(menuTimer);
    menuTimer = null;
  }

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

  function sameContext(op) {
    return !destroyed && enabled() && operationGeneration === op.generation &&
      getPlayer() === op.player && videoId() === op.videoId &&
      win.location?.href === op.location;
  }

  function scheduleReload(fromSpeed, immediate = false, options = {}) {
    const player = getPlayer(), id = videoId();
    if (!player || !id) return;
    const previous = pending && pending.player === player && pending.videoId === id &&
      pending.location === win.location?.href ? pending : null;
    cancelPending();
    const op = {
      player, videoId: id, location: win.location?.href,
      fromSpeed: previous ? previous.fromSpeed : fromSpeed,
      previousDefault: previous ? previous.previousDefault : options.previousDefault,
      persist: options.persist, shouldNotify: options.shouldNotify,
      speed: currentSpeed, generation: operationGeneration, timer: null
    };
    pending = op;
    const run = () => {
      if (pending !== op) return;
      pending = null;
      applyReload(op);
    };
    if (immediate) run();
    else op.timer = win.setTimeout(run, RELOAD_DELAY_MS);
  }

  function restorePause(op) {
    cancelPauseRestore();
    const pause = () => {
      if (!sameContext(op)) return;
      try { op.player.pauseVideo(); }
      catch (error) {
        lastError = String(error);
        notify('Could not restore paused playback');
      }
    };
    // Some players start asynchronously after loadVideoById returns. Reapply
    // pause on that first PLAYING event, unless the user has interacted since.
    const restoration = { listener: null, timer: null };
    restoration.listener = evt => {
      if (pauseRestore !== restoration || evt.detail?.state !== 1) return;
      cancelPauseRestore();
      pause();
    };
    restoration.timer = win.setTimeout(() => {
      if (pauseRestore === restoration) cancelPauseRestore();
    }, 2500);
    pauseRestore = restoration;
    win.addEventListener?.('yt-player-state-change', restoration.listener);
    pause();
  }

  function applyReload(op) {
    if (!sameContext(op) || currentSpeed === op.fromSpeed) return;
    const player = op.player;
    try {
      lastError = null;
      if (typeof player.setPlaybackQualityRange === 'function') {
        try {
          const preferred = configRead('preferredVideoQuality') || 'auto';
          const quality = typeof player.getAvailableQualityLevels === 'function'
            ? selectPreferredQuality(player.getAvailableQualityLevels(), preferred) || 'auto'
            : preferred;
          player.setPlaybackQualityRange(quality, quality);
        } catch (error) {
          lastError = String(error);
          if (sameContext(op)) notify('Could not apply preferred quality; using current quality');
        }
      }
      if (!sameContext(op) || currentSpeed !== op.speed) return;
      const at = player.getCurrentTime();
      if (!Number.isFinite(at) || at < 0) throw new Error('Playback position unavailable');
      const state = player.getPlayerState?.();
      const paused = state === 2 || state === 5;
      const cue = paused && typeof player.cueVideoById === 'function';
      if (paused && !cue && typeof player.pauseVideo !== 'function')
        throw new Error('Pause control unavailable');
      if (!sameContext(op) || currentSpeed !== op.speed) return;
      const previousSink = activeSink;
      // Keep the old sink alive if the player rejects the load. A synchronous
      // replacement pipeline owns its new sink; never destroy that newer sink.
      if (cue) player.cueVideoById(op.videoId, at);
      else player.loadVideoById(op.videoId, at);
      if (!sameContext(op) || currentSpeed !== op.speed) return;
      lastReloadAt = Date.now();
      if (activeSink === previousSink) releaseAudioSink();
      if (paused && !cue) restorePause(op);
      if (op.shouldNotify) notify(`Playback speed ${op.speed}×`);
    } catch (error) {
      if (!sameContext(op) || currentSpeed !== op.speed) return;
      lastError = String(error);
      currentSpeed = op.fromSpeed;
      if (op.persist && configWrite && configRead('defaultPlaybackSpeed') === String(op.speed))
        configWrite('defaultPlaybackSpeed', op.previousDefault);
      notify('Could not change playback speed: ' + error.message);
      return;
    }
    // Keep the native menu consistent only while this exact operation owns it.
    const setRate = player.__ytafOriginalSetPlaybackRate;
    if (setRate && typeof player.getPlaybackRate === 'function') {
      cancelMenuSync();
      const timer = win.setTimeout(() => {
        if (menuTimer !== timer) return;
        menuTimer = null;
        if (!sameContext(op) || currentSpeed !== op.speed) return;
        try {
          if (player.getPlaybackRate() !== op.speed) setRate.call(player, op.speed);
        } catch { /* Menu text can lag without affecting playback. */ }
      }, 2500);
      menuTimer = timer;
    }
  }

  function setSpeed(speed, { immediate = false, shouldNotify = true, reload = true, persist = true } = {}) {
    if (destroyed) return false;
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
    const previousDefault = configRead('defaultPlaybackSpeed');
    cancelMenuSync();
    lastVideoId = videoId() || lastVideoId;
    currentSpeed = speed;
    if (persist && configWrite) configWrite('defaultPlaybackSpeed', String(speed));
    if (reload) scheduleReload(previousSpeed, immediate, { previousDefault, persist, shouldNotify });
    else {
      cancelPending();
      if (shouldNotify) notify(`Playback speed ${speed}×`);
    }
    return !immediate || !reload || currentSpeed === speed;
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
    if (destroyed) return;
    cancelMenuSync();
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
    activeSink = null;
  }

  function destroy() {
    destroyed = true;
    cancelMenuSync();
    cancelPending();
    for (const type of ['hashchange', 'pagehide', 'ytaf-page-update'])
      win.removeEventListener?.(type, cancelForNavigation);
    for (const type of ['keydown', 'mousedown'])
      win.removeEventListener?.(type, cancelPauseForInput, true);
    releaseAudioSink();
  }

  function createAudioSink({ speed, element, createNativeAudioSource }) {
    releaseAudioSink();

    const engine = new AudioEngine({ win, speed, onError, createNativeAudioSource,
      audioOffsetMs: Number(configRead('audioSyncOffsetMs')) || 0 });
    if (element) engine.attachVideo(element);
    activeSink = { engine };
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
      audio: activeSink ? { output: activeSink.engine.output.type, codec: activeSink.engine.cfg && activeSink.engine.cfg.codec,
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
