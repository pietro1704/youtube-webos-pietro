const TRUSTED_VOTE_FLOOR = 0;

function firstTrusted(items, valueKey) {
  if (!Array.isArray(items)) return null;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || item.original === true) continue;
    if (item.locked !== true && Number(item.votes) < TRUSTED_VOTE_FLOOR)
      continue;
    const value = item[valueKey];
    if (valueKey === 'title' && typeof value === 'string' && value.trim())
      return value.trim();
    if (
      valueKey === 'timestamp' &&
      typeof value === 'number' &&
      isFinite(value) &&
      value >= 0
    )
      return value;
  }
  return null;
}

export function selectBranding(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const title = firstTrusted(payload.titles, 'title');
  const thumbnailTimestamp = firstTrusted(payload.thumbnails, 'timestamp');
  if (title === null && thumbnailTimestamp === null) return null;
  return { title, thumbnailTimestamp };
}

export function createThumbnailUrl(videoId, timestamp) {
  return (
    'https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=' +
    encodeURIComponent(videoId) +
    '&time=' +
    encodeURIComponent(String(timestamp))
  );
}
