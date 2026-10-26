const videoId = value => typeof value === 'string' && /^[\w-]{11}$/.test(value);
function card(item) {
  if (!item || typeof item !== 'object') return null;
  let depth = 0;
  while (item && item.richItemRenderer && depth++ < 4) item = item.richItemRenderer.content;
  if (!item || typeof item !== 'object' || item.richItemRenderer) return null;
  const renderer = item.tileRenderer || item.videoRenderer || item.compactVideoRenderer || item.lockupViewModel;
  return renderer && videoId(renderer.videoId || renderer.contentId) ? renderer : null;
}
export function nativeWatchProgress(item) {
  const renderer = card(item);
  if (!renderer) return null;
  const lists = [renderer.thumbnailOverlays, renderer.header && renderer.header.tileHeaderRenderer && renderer.header.tileHeaderRenderer.thumbnailOverlays,
    renderer.contentImage && renderer.contentImage.thumbnailViewModel && renderer.contentImage.thumbnailViewModel.overlays];
  const values = [];
  const add = value => { if (typeof value === 'number' && isFinite(value) && value >= 0 && value <= 100) values.push(value); };
  for (const overlays of lists) if (Array.isArray(overlays)) for (const overlay of overlays) {
    if (!overlay || typeof overlay !== 'object') continue;
    if (overlay.thumbnailOverlayResumePlaybackRenderer) add(overlay.thumbnailOverlayResumePlaybackRenderer.percentDurationWatched);
    const bottom = overlay.thumbnailBottomOverlayViewModel;
    const bar = bottom && bottom.progressBar && bottom.progressBar.thumbnailOverlayProgressBarViewModel;
    // Both fields are account-provided percent widths in the native TV UI.
    if (bar) add(bar.startPercent);
  }
  if (!values.length || values.some(value => value !== values[0])) return null;
  return { id: renderer.videoId || renderer.contentId, percent: values[0] };
}
export function filterWatchedVideos(data, threshold, maxNodes = 30000) {
  if (typeof threshold !== 'number' || !isFinite(threshold) || threshold < 1 || threshold > 100) return { removed: 0, tokens: [] };
  const queue = [data], seen = new WeakSet(), plans = [], tokens = [];
  let cursor = 0, removed = 0;
  while (cursor < queue.length) {
    if (cursor >= maxNodes) return { removed: 0, tokens: [], limited: true };
    const node = queue[cursor++];
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      const keep = node.filter(item => { const progress = nativeWatchProgress(item); return !progress || progress.percent < threshold; });
      if (keep.length !== node.length) { plans.push({ node, keep }); removed += node.length - keep.length; }
      for (const item of keep) if (item && typeof item === 'object') queue.push(item);
    } else {
      for (const key of ['continuationCommand', 'nextContinuationData', 'reloadContinuationData']) {
        const value = node[key]; const token = value && (value.token || value.continuation);
        if (typeof token === 'string' && token.length <= 4096 && tokens.length < 100) tokens.push(token);
      }
      for (const key of Object.keys(node)) { const value = node[key]; if (value && typeof value === 'object') queue.push(value); }
    }
    if (queue.length > maxNodes * 2) return { removed: 0, tokens: [], limited: true };
  }
  for (const { node, keep } of plans) { node.length = 0; for (const item of keep) node.push(item); }
  return { removed, tokens };
}
export function watchedPage(url, body) {
  if (/\/search$/.test(url.pathname)) return 'search';
  if (/\/(?:next|get_watch)$/.test(url.pathname)) return 'watch';
  const id = body && body.browseId;
  if (id === 'FEwhat_to_watch') return 'home';
  if (id === 'FEsubscriptions') return 'subscriptions';
  if (['FElibrary', 'FEhistory', 'FEmy_youtube'].indexOf(id) !== -1) return 'library';
  if (typeof id === 'string' && /^UC[\w-]+$/.test(id)) return 'channels';
  return null;
}
