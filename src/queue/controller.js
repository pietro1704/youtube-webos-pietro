const validId = id => typeof id === 'string' && /^[\w-]{11}$/.test(id);

export function createVideoQueue({ enabled, getIdentity, getVideoId, isWatching, getDispatcher, changed = () => {}, notify = () => {}, now = Date.now }) {
  let items = [];
  let identity = getIdentity();
  let generation = 0;
  let pending = null;
  let armedVideo = null;
  let endedVideo = null;
  let destroyed = false;

  function cancel() { generation++; pending = null; endedVideo = null; }
  function clear() { cancel(); items = []; armedVideo = null; changed(); }
  function observe() {
    const current = getIdentity();
    if (current !== identity) { identity = current; clear(); return; }
    if (!enabled()) { if (pending || armedVideo) { cancel(); armedVideo = null; } return; }
    if (!isWatching() && !(pending && pending.allowBrowse)) { if (pending || armedVideo) { cancel(); armedVideo = null; } return; }
    const id = getVideoId();
    if (pending && pending.dispatched && isWatching() && id === pending.id) {
      items = items.filter(item => item.id !== id);
      pending = null;
      armedVideo = id;
      endedVideo = null;
      changed();
    } else if (pending && now() > pending.deadline) {
      cancel(); armedVideo = null; notify('The queued video did not start. Queue kept for retry.'); changed();
    } else if (!pending && armedVideo && id !== armedVideo) { cancel(); armedVideo = null; }
  }
  function add(item, next = false) {
    observe();
    if (destroyed || !enabled() || !item || !validId(item.id)) return false;
    const existing = items.findIndex(entry => entry.id === item.id);
    if (existing !== -1 && !next) return false;
    if (existing === -1 && items.length >= 200) { notify('Queue is full'); return false; }
    cancel();
    if (existing !== -1) items.splice(existing, 1);
    const entry = { id: item.id, title: String(item.title || item.id).slice(0, 200) };
    if (next) items.unshift(entry); else items.push(entry);
    armedVideo = isWatching() ? getVideoId() : null;
    changed(); return true;
  }
  function remove(id) { cancel(); items = items.filter(item => item.id !== id); changed(); }
  function moveNext(id) {
    const item = items.find(entry => entry.id === id);
    return !!item && add(item, true);
  }
  async function play(fromEnd = false) {
    observe();
    if (destroyed || !enabled() || pending || !items.length) return false;
    const origin = getVideoId();
    if (fromEnd && (!isWatching() || origin !== armedVideo || endedVideo === origin)) return false;
    const token = ++generation;
    const account = identity;
    const entry = items[0];
    pending = { id: entry.id, deadline: now() + 10000, dispatched: false, allowBrowse: !isWatching() };
    changed();
    try {
      const dispatch = await getDispatcher();
      if (destroyed || token !== generation || !enabled() || getIdentity() !== account ||
          (fromEnd && (!isWatching() || getVideoId() !== origin))) return false;
      if (typeof dispatch !== 'function') throw new Error('Native commands unavailable');
      pending.dispatched = true;
      if (fromEnd) endedVideo = origin;
      await dispatch({ watchEndpoint: { videoId: entry.id } });
      return token === generation && !destroyed && enabled() && getIdentity() === account;
    } catch {
      if (token === generation && !destroyed) { cancel(); armedVideo = null; notify('Unable to open queued video. Queue kept for retry.'); changed(); }
      return false;
    } finally {
      if (token === generation && pending && !pending.dispatched) { pending = null; changed(); }
    }
  }
  return { add, remove, moveNext, clear, observe, play, onEnded: () => play(true),
    list: () => items.map(item => ({ ...item })),
    externalLaunch() { clear(); },
    destroy() { destroyed = true; clear(); }
  };
}
