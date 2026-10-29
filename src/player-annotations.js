// YouTube.js PlayerAnnotationsExpanded (fd4a35697ee985e269bc3e15fb7dc8f835975175)
// identifies featuredChannel.watermark as a timed player annotation.
// This is separate from endscreen cards, captions and logos baked into video.
export function prunePlayerAnnotations(data) {
  if (!data || typeof data !== 'object') return false;
  let changed = false;
  for (const player of [data, data.playerResponse]) {
    if (!player || !Array.isArray(player.annotations)) continue;
    const annotations = player.annotations;
    for (let i = annotations.length - 1; i >= 0; i--) {
      const entry = annotations[i];
      if (entry && (entry.playerAnnotationsExpandedRenderer || entry.playerAnnotationsRenderer)) {
        annotations.splice(i, 1); changed = true;
      }
    }
    if (!annotations.length) delete player.annotations;
  }
  return changed;
}

export function syncAnnotationVisibility(doc, hidden) {
  const id = 'ytaf-annotation-style';
  let style = doc.getElementById(id);
  if (!style) {
    style = doc.createElement('style');
    style.id = id;
    style.textContent = '.ytaf-hide-annotations .ytp-iv-video-watermark,' +
      '.ytaf-hide-annotations .html5-video-player .ytp-annotation { display: none !important; }';
    (doc.head || doc.documentElement).appendChild(style);
  }
  doc.documentElement.classList.toggle('ytaf-hide-annotations', !!hidden);
}
