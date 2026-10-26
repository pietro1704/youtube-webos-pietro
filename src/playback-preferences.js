export const playbackSpeedModes = {
  0.25: '0.25x',
  0.5: '0.5x',
  0.75: '0.75x',
  1: '1x',
  1.25: '1.25x',
  1.5: '1.5x',
  1.75: '1.75x',
  2: '2x',
};

export const videoQualityModes = {
  auto: 'Automatic',
  hd720: '720p',
  hd1080: '1080p',
  hd1440: '1440p',
  hd2160: '2160p / 4K',
};

export const audioSyncModes = {};
for (let milliseconds = -500; milliseconds <= 500; milliseconds += 25) {
  audioSyncModes[String(milliseconds)] = `${milliseconds > 0 ? '+' : ''}${milliseconds} ms`;
}

const QUALITY_HEIGHTS = {
  tiny: 144,
  small: 240,
  medium: 360,
  large: 480,
  hd720: 720,
  hd1080: 1080,
  hd1440: 1440,
  hd2160: 2160,
  hd2880: 2880,
  hd4320: 4320,
  highres: 4320,
};

function allowed(map, value, fallback) {
  // Object.hasOwn is Chrome 93; legacy webOS starts at Chromium 38.
  return Object.prototype.hasOwnProperty.call(map, value) ? value : fallback;
}

export function normalizePlaybackPreferences(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    defaultPlaybackSpeed: allowed(
      playbackSpeedModes,
      String(source.defaultPlaybackSpeed),
      '1',
    ),
    preferredVideoQuality: allowed(
      videoQualityModes,
      source.preferredVideoQuality,
      'auto',
    ),
  };
}

export function selectPreferredQuality(availableLevels, preference) {
  if (preference === 'auto' || !Array.isArray(availableLevels)) return null;
  const limit = QUALITY_HEIGHTS[preference];
  if (!limit) return null;

  let selected = null;
  let selectedHeight = 0;
  for (let i = 0; i < availableLevels.length; i++) {
    const level = availableLevels[i];
    const height = QUALITY_HEIGHTS[level] || 0;
    if (height <= limit && height > selectedHeight) {
      selected = level;
      selectedHeight = height;
    }
  }
  return selected;
}

export function qualityStorageHeight(preference) {
  return QUALITY_HEIGHTS[preference] || 0;
}
