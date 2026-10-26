import { initCaptionPreferences } from '../caption-preferences.js';
import { initVideoQueue } from '../video-queue.js';
import { initDeArrow } from '../dearrow/index.js';
import { initPlaybackSpeed } from '../playback-speed.js';
import { initVideoQualityModule } from '../video-quality.js';

export const bundledMods = [
  { id: 'caption-preferences', version: '1.0.0', init: initCaptionPreferences },
  { id: 'video-queue', version: '1.0.0', init: initVideoQueue },
  { id: 'playback-preferences', version: '1.0.0', init: initPlaybackSpeed },
  { id: 'video-quality', version: '1.0.0', init: initVideoQualityModule },
  { id: 'dearrow', version: '1.0.0', init: initDeArrow },
];

let started = false;

export function startBundledMods() {
  if (started) return;
  started = true;
  const status = [];
  for (let i = 0; i < bundledMods.length; i++) {
    const mod = bundledMods[i];
    try {
      mod.init();
      status.push({
        id: mod.id,
        version: mod.version,
        source: 'bundled',
        state: 'started',
      });
    } catch (error) {
      console.warn('[Mods] Failed to start ' + mod.id, error);
      status.push({
        id: mod.id,
        version: mod.version,
        source: 'bundled',
        state: 'failed',
      });
    }
  }
  window.__ytafMods = status;
}
