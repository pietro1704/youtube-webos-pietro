import { configRead, configAddChangeListener, configRemoveChangeListener } from './config.js';
import { showNotification } from './notifications.js';
import { isWebOS25 } from './webos-utils.js';
import { sendKey, REMOTE_KEYS, SELECTORS, isWatchPage } from './utils.js';
import { qualityStorageHeight, selectPreferredQuality } from './playback-preferences.js';

const DEBUG = false;

const IS_WEBOS_25 = isWebOS25();
const QUALITY_KEY = 'yt-player-quality';
const ONE_YEAR_MS = 31536000000; // 365 * 24 * 60 * 60 * 1000

// Caching: In-memory cache for localStorage & Config
let cachedQualitySettings = null;
let _preferredQuality = 'auto';

let player = null;
let lastVideoId = null;
let initTimer = null;
let configCleanup = null;
let isDestroyed = false;
let statePollingInterval = null;
let lastKnownState = null;
let lastPolledVideoId = null;
let _isWatchPageCached = false;
let videoBeingProcessed = null;
let kickstartInProgress = false;
let qualityAttemptKey = null;
let qualityAttempts = 0;
let lastTargetQuality = null;

const qualitySetForVideo = new Set();

// webOS 25 first video fix
let hasKickstarted = false;

// Player States
const STATE_UNSTARTED = -1;
// const STATE_ENDED = 0;
const STATE_PLAYING = 1;
// const STATE_PAUSED = 2;
const STATE_BUFFERING = 3;
// const STATE_CUED = 5;

function isForceEnabled() {
  return _preferredQuality !== 'auto' && (!player?.isInline || !player.isInline());
}


async function ensurePlaybackStarts() {
  if (!IS_WEBOS_25 || hasKickstarted || isDestroyed || !player || kickstartInProgress) return;

  kickstartInProgress = true;
  if (DEBUG) console.info('[VideoQuality] 🚀 Starting playback enforcer...');

  const MAX_ATTEMPTS = 10;
  const INTERVAL_MS = 500;

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    if (isDestroyed || !player || hasKickstarted) {
      kickstartInProgress = false;
      return;
    }

    try {
      const currentState = player.getPlayerState?.();

      if (currentState === STATE_PLAYING) {
        hasKickstarted = true;
        kickstartInProgress = false;
        if (DEBUG) console.info('[VideoQuality] ✅ Playback verified! Kickstart complete.');
        
        requestAnimationFrame(() => {
            const controls = document.querySelector('yt-focus-container[idomkey="controls"]');
            const isControlsVisible = controls && controls.classList.contains('MFDzfe--focused');

            if (isControlsVisible) {
                if (DEBUG) console.info('[VideoQuality] 🎮 Controls are focused. Hiding and dismissing...');

                const hideStyle = document.createElement('style');
                hideStyle.textContent = '.GLc3cc { opacity: 0 !important; transition: opacity 0.1s; }';
                document.head.appendChild(hideStyle);

                sendKey(REMOTE_KEYS.UP);                            
                setTimeout(() => sendKey(REMOTE_KEYS.UP), 250);     
                setTimeout(() => sendKey(REMOTE_KEYS.UP), 500);     

                setTimeout(() => {
                    if (hideStyle.isConnected) hideStyle.remove();
                }, 750);
            }
        });
        
        return;
      }

      if (DEBUG) console.log(`[VideoQuality] 👊 Kick attempt ${i + 1}/${MAX_ATTEMPTS} (State: ${currentState})`);
      player.playVideo?.();

    } catch (e) {
      if (DEBUG) console.warn('[VideoQuality] Kick attempt failed:', e);
    }
	
	// eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, INTERVAL_MS));
  }

  kickstartInProgress = false;
  if (DEBUG && !hasKickstarted) {
    console.warn('[VideoQuality] ⚠️ Playback enforcer timed out without confirming PLAYING state.');
  }
}

function getTargetQuality() {
  if (!player || !isForceEnabled()) return null;
  try {
    return selectPreferredQuality(player.getAvailableQualityLevels?.() || [], _preferredQuality);
  } catch {
    return null;
  }
}

function isQualityAlreadyPreferred() {
  if (!player) return false;
  try {
    const target = getTargetQuality();
    if (!target) return false;
    const currentQuality = player.getPlaybackQuality?.();
    return currentQuality === target;
  } catch {
    return false;
  }
}

function setLocalStorageQuality() {
  if (!isForceEnabled()) return false;
  const height = qualityStorageHeight(_preferredQuality);
  if (!height) return false;
  
  const now = Date.now();

  if (cachedQualitySettings && cachedQualitySettings.quality === height && cachedQualitySettings.previousQuality === height) {
    return false; 
  }
  
  try {
    if (!cachedQualitySettings) {
      const stored = window.localStorage.getItem(QUALITY_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed && parsed.data) {
             cachedQualitySettings = JSON.parse(parsed.data);
          }
        } catch { /* ignore */ }
      }
    }

    if (cachedQualitySettings && 
        cachedQualitySettings.quality === height &&
        cachedQualitySettings.previousQuality === height) {
        return false; 
    }

    const innerData = { quality: height, previousQuality: height };
      
    const qualityObj = {
      data: JSON.stringify(innerData),
      creation: now,
      expiration: now + ONE_YEAR_MS
    };
    
    window.localStorage.setItem(QUALITY_KEY, JSON.stringify(qualityObj));
    cachedQualitySettings = innerData;
    
    DEBUG && console.info('[VideoQuality] Set localStorage quality to', height + 'p');
    return true;
    
  } catch (e) {
    DEBUG && console.warn('[VideoQuality] Failed to set localStorage quality:', e);
    return false;
  }
}

function clearStoredQuality() {
  cachedQualitySettings = null;
  try {
    window.localStorage.removeItem(QUALITY_KEY);
  } catch {
    /* storage unavailable */
  }
}

function setQualityOnPlayer() {
  if (!player || !isForceEnabled() || isDestroyed) {
    return { success: false, upgraded: false };
  }
  
  try {
    if (!player.setPlaybackQualityRange) {
      return { success: false, upgraded: false };
    }
    
    const target = getTargetQuality();
    if (!target) {
      return { success: false, upgraded: false };
    }

    const attemptKey = player.getVideoData?.()?.video_id + ':' + target;
    if (qualityAttemptKey !== attemptKey) {
      qualityAttemptKey = attemptKey;
      qualityAttempts = 0;
    }
    if (isQualityAlreadyPreferred()) {
      return { success: true, upgraded: false };
    }
    // A player that rejects a request must not receive writes forever.
    if (qualityAttempts >= 20) return { success: false, upgraded: false };
    qualityAttempts++;
    
    DEBUG && console.log('[VideoQuality] Upgrading quality from:', player.getPlaybackQuality?.());
    
    player.setPlaybackQualityRange(target, target);
    player.setPlaybackQuality?.(target);
    
    const afterQuality = player.getPlaybackQuality?.();
    const qualityLabel = player.getPlaybackQualityLabel?.();
    
    DEBUG && console.info('[VideoQuality] ✅ Quality upgraded to:', afterQuality, qualityLabel);
    
    return { 
      success: afterQuality === target,
      upgraded: afterQuality === target,
      newQuality: qualityLabel || afterQuality
    };
    
  } catch (e) {
    DEBUG && console.warn('[VideoQuality] Error setting quality:', e);
    return { success: false, upgraded: false };
  }
}

function notifyIfUpgraded(result) {
  if (result && result.upgraded) {
    const notifiedPlayer = player;
    const notifiedVideo = player?.getVideoData?.()?.video_id;
    setTimeout(() => {
      if (isDestroyed || player !== notifiedPlayer || player?.getVideoData?.()?.video_id !== notifiedVideo) return;
      try {
        const finalQuality = player.getPlaybackQualityLabel?.() || result.newQuality || 'high quality';
        showNotification(`Video quality upgraded to ${finalQuality}`);
        DEBUG && console.info('[VideoQuality] Notification shown:', finalQuality);
      } catch {
        showNotification('Video quality upgraded to high quality');
      }
    }, 500);
  }
}

function interceptAndUpgradeQuality(videoId) {
  if (!player || !isForceEnabled() || isDestroyed) return;
  
  if (videoBeingProcessed === videoId) return;
  
  if (isQualityAlreadyPreferred()) {
    qualitySetForVideo.add(videoId);
    return;
  }
  
  videoBeingProcessed = videoId;
  DEBUG && console.info('[VideoQuality] 🛑 Intercepting playback to upgrade quality:', videoId);
  
  const result = setQualityOnPlayer();
  if (result.success) qualitySetForVideo.add(videoId);
  notifyIfUpgraded(result);
  videoBeingProcessed = null;
}

function handleStateChange(state) {
  if (isDestroyed || !player) return;

  const actualState = (state && state.data !== undefined) ? state.data : state;

  // Publish FIRST. This event is shared infrastructure: watch.js (clock
  // visibility) and sponsorblock.js (overlay cache invalidation, observer
  // re-arm, chain-skip re-arm, high-freq loop teardown) both subscribe to it.
  // It must not be suppressed by an unrelated quality setting.
  window.dispatchEvent(new CustomEvent('yt-player-state-change', {
    detail: { state: actualState, videoId: lastVideoId }
  }));

  // Everything below is quality forcing only.
  if (!isForceEnabled()) return;

  try {
    const videoData = player.getVideoData?.();
    const videoId = videoData?.video_id;
    
    if (!videoId) return;
    
    const targetQuality = getTargetQuality();
    if (targetQuality !== lastTargetQuality) {
      lastTargetQuality = targetQuality;
      qualitySetForVideo.clear();
    }
    const isNewVideo = videoId !== lastVideoId;
    
    if (isNewVideo) {
      lastVideoId = videoId;
      qualitySetForVideo.clear();
      qualityAttemptKey = null;
      videoBeingProcessed = null;
      DEBUG && console.info('[VideoQuality] 🎬 New video:', videoId);
      
      if (actualState === STATE_UNSTARTED) {
          setLocalStorageQuality();
      }
    }
    
    if (qualitySetForVideo.has(videoId)) {
      if (actualState === STATE_PLAYING) ensurePlaybackStarts();
      return;
    }
    
    switch (actualState) {
        // Identical handling: setQualityOnPlayer() already short-circuits when
        // the quality is maxed (returning upgraded:false, making
        // notifyIfUpgraded a no-op), so both cases collapse to one path.
        case STATE_UNSTARTED:
        case STATE_BUFFERING:
            if (player.getAvailableQualityLevels?.()?.length > 0) {
                const result = setQualityOnPlayer();
                if (result.success) qualitySetForVideo.add(videoId);
                notifyIfUpgraded(result);
            }
            break;

        case 2: // Apply an explicit selection without resuming a paused video.
        case STATE_PLAYING:
            if (!isQualityAlreadyPreferred()) {
                interceptAndUpgradeQuality(videoId);
            } else {
                qualitySetForVideo.add(videoId);
            }
            break;
    }

	if (actualState !== 2) ensurePlaybackStarts();
  } catch (e) {
    DEBUG && console.warn('[VideoQuality] Error in state change handler:', e);
  }
}

function startStatePolling() {
  if (statePollingInterval) return;
  
  DEBUG && console.info('[VideoQuality] Starting state polling (Fallback)');
  
  statePollingInterval = setInterval(() => {
    if (isDestroyed || !player) {
      stopStatePolling();
      return;
    }
    try {
      const state = player.getPlayerState?.();
      const id = player.getVideoData?.()?.video_id;
      if (state !== lastKnownState || id !== lastPolledVideoId || (isForceEnabled() && (!qualitySetForVideo.has(id) || getTargetQuality() !== lastTargetQuality))) {
        lastKnownState = state;
        lastPolledVideoId = id;
        handleStateChange(state);
      }
    } catch { /* ignore */ }
  }, 250);
}

function stopStatePolling() {
  if (statePollingInterval) {
    clearInterval(statePollingInterval);
    statePollingInterval = null;
  }
}

export function destroyVideoQuality() {
  DEBUG && console.info('[VideoQuality] Destroying');
  
  isDestroyed = true;
  
  if (initTimer) {
    clearTimeout(initTimer);
    initTimer = null;
  }
  
  stopStatePolling();
  
  if (player) {
    try {
      player.removeEventListener?.('onStateChange', handleStateChange);
    } catch { /* ignore */ }
  }
  
  if (configCleanup) {
    try {
      configCleanup();
    } catch { /* ignore */ }
  }
  
  player = null;
  lastVideoId = null;
  lastKnownState = null;
  lastPolledVideoId = null;
  lastTargetQuality = null;
  configCleanup = null;
  qualitySetForVideo.clear();
  qualityAttemptKey = null;
  videoBeingProcessed = null;
  _isWatchPageCached = false;
  kickstartInProgress = false;
  // Don't reset hasKickstarted here so it persists for the session
}

export function initVideoQuality() {
  if (initTimer || player) return;
  
  DEBUG && console.info('[VideoQuality] Initializing');
  
  isDestroyed = false;
  _isWatchPageCached = true;
  
  _preferredQuality = configRead('preferredVideoQuality');

  if (!isForceEnabled()) clearStoredQuality();
  else setLocalStorageQuality();
  
  const attach = () => {
    if (isDestroyed) return true;
    
    const p = document.getElementById(SELECTORS.PLAYER_ID);
    if (!p || !p.setPlaybackQualityRange || !p.isConnected) {
      return false;
    }
    
    try {
      player = p;
      
      try {
        if (player.addEventListener) {
            player.addEventListener('onStateChange', handleStateChange);
            DEBUG && console.log('[VideoQuality] Native listener attached');
        }
      } catch (e) {
        DEBUG && console.warn('[VideoQuality] Event listener failed, falling back to poll:', e);
      }
      
      // Some webOS players accept addEventListener but omit events during
      // autoplay. Track both state and video identity even with a listener.
      startStatePolling();
      
      if (configAddChangeListener && !configCleanup) {
        const onChange = (evt) => {
          if (isDestroyed) return;
          _preferredQuality = evt.detail.newValue;
          
          if (isForceEnabled()) {
            cachedQualitySettings = null;
            setLocalStorageQuality();
            qualitySetForVideo.clear();
            qualityAttemptKey = null;
            handleStateChange(player?.getPlayerState?.());
          } else {
            clearStoredQuality();
            qualitySetForVideo.clear();
            qualityAttemptKey = null;
            player?.setPlaybackQualityRange?.('auto', 'auto');
            player?.setPlaybackQuality?.('auto');
          }
        };
        configAddChangeListener('preferredVideoQuality', onChange);
        const onSpeedChange = () => {
          cachedQualitySettings = null;
          qualitySetForVideo.clear();
          qualityAttemptKey = null;
          if (isForceEnabled()) {
            setLocalStorageQuality();
            handleStateChange(player?.getPlayerState?.());
          } else {
            clearStoredQuality();
            player?.setPlaybackQualityRange?.('auto', 'auto');
          }
        };
        configAddChangeListener('defaultPlaybackSpeed', onSpeedChange);
        configCleanup = () => {
          configRemoveChangeListener('preferredVideoQuality', onChange);
          configRemoveChangeListener('defaultPlaybackSpeed', onSpeedChange);
        };
      }
      
      DEBUG && console.info('[VideoQuality] ✅ Attached to player');
      
      handleStateChange(player.getPlayerState?.());
      
      return true;
    } catch (e) {
      DEBUG && console.warn('[VideoQuality] Error attaching:', e);
      player = null;
      return false;
    }
  };

  if (attach()) return;

  let attempts = 0;
  const poll = () => {
    if (isDestroyed) {
      clearTimeout(initTimer);
      initTimer = null;
      return;
    }
    if (attach() || attempts++ >= 50) {
      clearTimeout(initTimer);
      initTimer = null;
    } else {
      initTimer = setTimeout(poll, 200);
    }
  };
  
  poll();
}

function handleNavigation(event) {
  const isWatch = (event?.detail?.pageType === 'watch') || isWatchPage();
  
  if (isWatch && !_isWatchPageCached) {
    DEBUG && console.info('[VideoQuality] Navigation: Entering watch page');
    setTimeout(initVideoQuality, 0); 
    
  } else if (!isWatch && _isWatchPageCached) {
    DEBUG && console.info('[VideoQuality] Navigation: Leaving watch page');
    destroyVideoQuality();
  }
}

let listenersSetup = false;
function setupListeners() {
    if (listenersSetup) return;
    listenersSetup = true;
    window.addEventListener('yt-navigate-finish', handleNavigation);

    // Passed directly: handleNavigation falls back to isWatchPage() when the
    // event carries no pageType, and ytaf-page-update never does.
    window.addEventListener('ytaf-page-update', handleNavigation);
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => handleNavigation());
    } else {
        handleNavigation();
    }
    
    window.addEventListener('beforeunload', destroyVideoQuality);
}

export function initVideoQualityModule() {
  setupListeners();
}
