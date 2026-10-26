import assert from 'node:assert/strict';
import {
  normalizePlaybackPreferences,
  selectPreferredQuality,
} from '../src/playback-preferences.js';

assert.deepEqual(
  normalizePlaybackPreferences({
    defaultPlaybackSpeed: '1.5',
    preferredVideoQuality: 'hd1080',
  }),
  { defaultPlaybackSpeed: '1.5', preferredVideoQuality: 'hd1080' },
);
assert.deepEqual(
  normalizePlaybackPreferences({
    defaultPlaybackSpeed: 'fast',
    preferredVideoQuality: '8k',
  }),
  { defaultPlaybackSpeed: '1', preferredVideoQuality: 'auto' },
);
assert.equal(
  selectPreferredQuality(['hd2160', 'hd1440', 'hd1080', 'hd720'], 'hd1440'),
  'hd1440',
);
assert.equal(
  selectPreferredQuality(['hd1440', 'hd720', 'medium'], 'hd1080'),
  'hd720',
);
assert.equal(selectPreferredQuality(['hd2160', 'hd1080'], 'auto'), null);
assert.equal(selectPreferredQuality([], 'hd1080'), null);

console.log('playback preferences: 6 passed, 0 failed');
