import { configRead, configWrite, configAddChangeListener } from './config.js';
import { SELECTORS, isWatchPage } from './utils.js';
import { readAccountContext } from './account-context.js';
import { showNotification } from './notifications.js';
import { createCaptionController } from './captions/controller.js';
import { captionTracks, captionTranslations, sanitizeCaptionStyle } from './captions/preferences.js';

let feature = null;
let status = 'Caption persistence is disabled';
const player = () => document.getElementById(SELECTORS.PLAYER_ID);
function videoId() { try { const p = player(); return p && p.getVideoData && p.getVideoData().video_id; } catch { return null; } }
function preferences() {
  return { enabled: configRead('enablePersistentCaptions'), language: configRead('captionLanguage'), size: configRead('captionFontSize'),
    style: configRead('captionStyle'), savedStyle: configRead('captionSavedStyle'), translate: configRead('captionAutoTranslate') };
}
const update = () => window.dispatchEvent(new CustomEvent('ytaf-captions-update'));
export function initCaptionPreferences() {
  if (feature) return;
  const controller = createCaptionController({ win: window, getPlayer: player, getVideoId: videoId,
    getIdentity: () => readAccountContext().key, isWatching: isWatchPage, preferences,
    report(text) { if (status !== text) { status = text; update(); } } });
  let attached = null, context = null, attempts = 0, timer = null;
  let moduleContext = null, modulePlayer = null;
  const events = ['onCaptionsTrackListChanged', 'onApiChange', 'onStateChange'];
  const request = () => { attempts = 0; controller.cancel(); configure(); update(); };
  const sync = () => {
    const p = preferences().enabled && isWatchPage() ? player() : null;
    const current = JSON.stringify([videoId(), readAccountContext().key, !!p]);
    if (attached !== p || context !== current) {
      if (attached && attached.removeEventListener) for (const name of events) attached.removeEventListener(name, request);
      controller.cancel(); attached = p; context = current; attempts = 0;
      if (attached && attached.addEventListener) for (const name of events) attached.addEventListener(name, request);
      update();
    }
    if (p && preferences().language !== 'native' && preferences().language !== 'off' && typeof p.loadModule === 'function' && (moduleContext !== current || modulePlayer !== p)) {
      moduleContext = current; modulePlayer = p;
      try { p.loadModule('captions'); } catch { /* Existing native controls remain available. */ }
    }
    if (!p || preferences().language === 'off' || preferences().language === 'native') { moduleContext = null; modulePlayer = null; }
    if (p && attempts++ < 20) controller.schedule();
    if (!preferences().enabled && status !== 'Caption persistence is disabled') { status = 'Caption persistence is disabled'; update(); }
  };
  const configure = () => {
    if (timer !== null) window.clearInterval(timer);
    timer = null; controller.cancel(); attempts = 0;
    if (preferences().enabled && configRead('captionSavedStyle') === null && isWatchPage()) {
      try {
        const p = player();
        const style = p && typeof p.getSubtitlesUserSettings === 'function' ? sanitizeCaptionStyle(p.getSubtitlesUserSettings()) : {};
        if (Object.keys(style).length) { configWrite('captionSavedStyle', style); return; }
      } catch { /* Keep native fallback if settings are not ready. */ }
    }
    sync();
    if (preferences().enabled) timer = window.setInterval(sync, 500);
    update();
  };
  for (const key of ['enablePersistentCaptions', 'captionLanguage', 'captionFontSize', 'captionStyle', 'captionSavedStyle', 'captionAutoTranslate']) configAddChangeListener(key, configure);
  window.addEventListener('ytaf-page-update', request);
  window.addEventListener('pagehide', () => controller.cancel());
  feature = { controller, request };
  configure();
}

export function captionLanguageChoices() {
  const choices = [{ value: 'native', label: 'Keep YouTube choice' }, { value: 'off', label: 'Off' }];
  const p = isWatchPage() ? player() : null;
  const tracks = captionTracks(p);
  for (const track of tracks) {
    if (!choices.some(item => item.value === track.languageCode)) choices.push({ value: track.languageCode, label: track.displayName || track.languageName || track.languageCode });
  }
  if (configRead('captionAutoTranslate')) {
    for (const target of captionTranslations(p, tracks)) {
      if (!choices.some(item => item.value === target.languageCode)) choices.push({ value: target.languageCode, label: `${target.languageName || target.languageCode} (auto-translate)` });
    }
  }
  const preferred = configRead('captionLanguage');
  if (typeof preferred === 'string' && !choices.some(item => item.value === preferred)) choices.push({ value: preferred, label: `${preferred} (unavailable in this video)` });
  return choices;
}

export function createCaptionExtras() {
  initCaptionPreferences();
  const root = document.createElement('div');
  root.id = 'ytaf-caption-controls';
  const text = document.createElement('div'); text.setAttribute('aria-live', 'polite');
  const render = () => { text.textContent = status; };
  const button = (label, id, action) => {
    const el = document.createElement('button'); el.type = 'button'; el.textContent = label; el.id = id;
    el.addEventListener('click', action); root.appendChild(el);
  };
  button('Available caption languages', 'ytaf-caption-languages', () => {
    const p = player();
    if (!isWatchPage() || !p) return showNotification('Open a video to choose caption languages');
    try { if (typeof p.loadModule === 'function') p.loadModule('captions'); feature.request(); }
    catch { showNotification('Native captions are unavailable for this video'); }
  });
  button('Save current caption appearance', 'ytaf-caption-save', () => {
    const p = player();
    try {
      if (!isWatchPage() || !p || typeof p.getSubtitlesUserSettings !== 'function') throw new Error('unavailable');
      const style = sanitizeCaptionStyle(p.getSubtitlesUserSettings());
      if (!Object.keys(style).length) throw new Error('unavailable');
      configWrite('captionSavedStyle', style); configWrite('captionFontSize', 'native'); configWrite('captionStyle', 'saved');
      showNotification('Caption appearance saved');
    } catch { showNotification('Caption appearance is unavailable for this video'); }
  });
  root.appendChild(text);
  const hint = document.createElement('small'); hint.textContent = 'Choose a language and appearance here, or edit native captions and save their current appearance. Missing languages keep your preference for the next video.';
  root.appendChild(hint); render();
  window.addEventListener('ytaf-captions-update', render);
  return root;
}
