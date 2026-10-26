export const captionSizeModes = { native: 'Saved / native size', '-2': 'Smallest', '-1': 'Small', 0: 'Normal', 1: 'Large', 2: 'Larger', 3: 'Very large', 4: 'Largest' };
export const captionStyleModes = { saved: 'Saved / native appearance', white: 'White on black', yellow: 'Yellow on black', transparent: 'White, transparent background', bold: 'Bold white on black' };
const fields = ['background', 'backgroundOpacity', 'charEdgeStyle', 'color', 'fontFamily', 'fontSizeIncrement', 'fontStyle', 'textOpacity', 'windowColor', 'windowOpacity'];
export function sanitizeCaptionStyle(style) {
  const safe = {};
  if (!style || typeof style !== 'object') return safe;
  for (const key of fields) {
    const value = style[key];
    if ((typeof value === 'string' && value.length <= 64) || (typeof value === 'number' && isFinite(value))) safe[key] = value;
    if (typeof style[key + 'Override'] === 'boolean') safe[key + 'Override'] = style[key + 'Override'];
  }
  return safe;
}
export function captionAppearance(current, preferences) {
  const style = Object.assign({}, sanitizeCaptionStyle(current), sanitizeCaptionStyle(preferences.savedStyle));
  const size = Number(preferences.size);
  if (preferences.size !== 'native' && isFinite(size) && Number.isInteger(size) && size >= -2 && size <= 4) {
    style.fontSizeIncrement = size; style.fontSizeIncrementOverride = true;
  }
  if (['white', 'yellow', 'transparent', 'bold'].indexOf(preferences.style) !== -1) {
    Object.assign(style, { color: preferences.style === 'yellow' ? '#ffff00' : '#ffffff', colorOverride: true,
      background: '#000000', backgroundOverride: true, backgroundOpacity: preferences.style === 'transparent' ? 0 : 0.75,
      backgroundOpacityOverride: true, fontStyle: preferences.style === 'bold' ? 1 : 0, fontStyleOverride: true });
  }
  return style;
}
export function captionTracks(player) {
  if (!player || typeof player.getOption !== 'function') return [];
  try {
    const tracks = player.getOption('captions', 'tracklist', { includeAsr: true });
    return Array.isArray(tracks) ? tracks.filter(track => track && typeof track.languageCode === 'string' && /^[\w-]{2,35}$/.test(track.languageCode)) : [];
  } catch { return []; }
}
export function captionTranslations(player, tracks = captionTracks(player)) {
  if (!player || typeof player.getOption !== 'function' || !tracks.some(track => track.is_translateable === true)) return [];
  try {
    const list = player.getOption('captions', 'translationLanguages');
    return Array.isArray(list) ? list.filter(item => item && typeof item.languageCode === 'string' && /^[\w-]{2,35}$/.test(item.languageCode) &&
      tracks.some((track, index) => track.is_translateable === true && (!Array.isArray(item.translationSourceTrackIndices) || item.translationSourceTrackIndices.indexOf(index) !== -1))) : [];
  } catch { return []; }
}
export function selectCaptionTrack(player, language, translate) {
  const tracks = captionTracks(player);
  const direct = tracks.find(track => track.languageCode === language);
  if (direct) return { ...direct };
  if (!translate) return null;
  const target = captionTranslations(player, tracks).find(item => item.languageCode === language);
  if (!target) return null;
  const indices = target.translationSourceTrackIndices;
  const base = tracks.find((track, index) => track.is_translateable === true && (!Array.isArray(indices) || indices.indexOf(index) !== -1));
  return base ? { ...base, translationLanguage: { ...target } } : null;
}
