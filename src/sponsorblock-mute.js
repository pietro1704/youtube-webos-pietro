// Own only mute changes made for SponsorBlock. The native video volumechange
// contract also drives the accelerated audio engine, so both output routes agree.
export function createSegmentMuter() {
  let segments = [], video = null, inRegion = false, overridden = false, owned = false;
  const accepted = new Set();

  function release() {
    const restore = owned && video?.muted;
    owned = false;
    if (restore) video.muted = false;
  }
  function volumeChanged() {
    if (inRegion && video && !video.muted) {
      // An explicit user unmute wins for the whole overlapping region.
      overridden = true;
      owned = false;
    }
  }
  function bind(next) {
    if (video === next) return;
    inRegion = false;
    release();
    video?.removeEventListener('volumechange', volumeChanged);
    video = next;
    overridden = false;
    accepted.clear();
    video?.addEventListener('volumechange', volumeChanged);
  }
  function active() {
    if (!video) return [];
    const time = video.currentTime;
    return segments.filter(s => time >= s.start && time < s.end);
  }
  function update(next) {
    bind(next);
    const current = active();
    for (const index of accepted) {
      if (!current.some(s => s.originalIndex === index && s.mode === 'manual_skip')) accepted.delete(index);
    }
    if (!current.length) {
      inRegion = false;
      overridden = false;
      release();
      return null;
    }
    inRegion = true;
    const shouldMute = current.some(s => s.mode === 'auto_skip' || accepted.has(s.originalIndex));
    if (shouldMute && !overridden) {
      if (!video.muted) {
        owned = true;
        video.muted = true;
      }
    } else release();
    return current.find(s => s.mode === 'manual_skip' && !accepted.has(s.originalIndex)) || null;
  }
  return {
    setSegments(next) { segments = next; },
    update,
    hasUpcoming(next) { return !!next && segments.some(s => s.end > next.currentTime); },
    activateManual(segment) {
      if (!segment || segment.mode !== 'manual_skip' || !active().includes(segment)) return false;
      accepted.add(segment.originalIndex);
      overridden = false;
      update(video);
      return true;
    },
    destroy() {
      bind(null);
      segments = [];
    }
  };
}
