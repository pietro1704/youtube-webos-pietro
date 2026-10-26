import { captionAppearance, selectCaptionTrack } from './preferences.js';

// Native contract checked against TV player dce23b30 and TizenTube's caption persistence.
export function createCaptionController({ win, getPlayer, getVideoId, getIdentity, isWatching, preferences, report = () => {} }) {
  let timer = null;
  let generation = 0;
  let destroyed = false;
  let applied = '';
  let appliedPlayer = null;
  let requestedTrack = '';
  let requestedPlayer = null;
  function cancel() { generation++; if (timer !== null) win.clearTimeout(timer); timer = null; applied = ''; appliedPlayer = null; requestedTrack = ''; requestedPlayer = null; }
  function schedule() {
    if (destroyed) return;
    if (timer !== null) win.clearTimeout(timer);
    timer = null;
    const token = ++generation;
    const player = getPlayer(), id = getVideoId(), identity = getIdentity();
    const pref = preferences();
    if (!pref.enabled || !player || !id || !isWatching()) { applied = ''; return; }
    const encodedPreferences = JSON.stringify(pref);
    const signature = JSON.stringify([id, identity, pref]);
    if (signature === applied && player === appliedPlayer) return;
    timer = win.setTimeout(() => {
      timer = null;
      const valid = () => !destroyed && token === generation && preferences().enabled && JSON.stringify(preferences()) === encodedPreferences && isWatching() && getPlayer() === player && getVideoId() === id && getIdentity() === identity;
      if (!valid()) return;
      try {
        if (typeof player.getSubtitlesUserSettings !== 'function' || typeof player.updateSubtitlesUserSettings !== 'function') {
          report('Caption preferences are unavailable on this player. Native captions remain available.'); return;
        }
        const current = player.getSubtitlesUserSettings();
        if (!current || typeof current !== 'object') { report('Waiting for caption settings'); return; }
        const style = captionAppearance(current, pref);
        if (!Object.keys(style).every(key => style[key] === current[key])) player.updateSubtitlesUserSettings(style, true);
        if (!valid()) return;
        if (pref.language !== 'native') {
          if (typeof player.setOption !== 'function') { report('Caption language selection is unavailable on this player'); return; }
          const track = pref.language === 'off' ? {} : selectCaptionTrack(player, pref.language, pref.translate);
          if (!track) { report('Preferred language is unavailable for this video. Preference kept for the next video.'); return; }
          if (requestedTrack !== signature || requestedPlayer !== player) {
            player.setOption('captions', 'track', track);
            requestedTrack = signature; requestedPlayer = player;
          }
          if (!valid()) return;
          if (typeof player.getOption === 'function') {
            const actual = player.getOption('captions', 'track');
            const language = actual && (actual.translationLanguage ? actual.translationLanguage.languageCode : actual.languageCode);
            if (pref.language === 'off' ? !!language : language !== pref.language) { report('Waiting for the preferred caption track'); return; }
          }
        }
        applied = signature;
        appliedPlayer = player;
        report('Caption preferences applied');
      } catch { report('Unable to apply caption preferences. Native captions remain available.'); }
    }, 100);
  }
  return { schedule, cancel, destroy() { destroyed = true; cancel(); } };
}
