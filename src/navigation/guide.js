export function guideKey(item) {
  const entry = item && item.guideEntryRenderer;
  const endpoint = entry && entry.navigationEndpoint;
  const id = endpoint && endpoint.browseEndpoint && endpoint.browseEndpoint.browseId;
  if (typeof id === 'string' && /^FE[\w-]{1,100}$/.test(id)) return id;
  return endpoint && endpoint.searchEndpoint ? 'search' : null;
}
export function guideSections(data) {
  const items = data && (Array.isArray(data.items) ? data.items : data.guideRenderer && data.guideRenderer.items);
  return Array.isArray(items) ? items.map(item => item && item.guideSectionRenderer).filter(section => section && Array.isArray(section.items)) : [];
}
export function guideCatalog(data) {
  const catalog = [];
  for (const section of guideSections(data)) for (const item of section.items) {
    const id = guideKey(item);
    if (!id || catalog.some(entry => entry.id === id)) continue;
    const renderer = item.guideEntryRenderer;
    const title = renderer.formattedTitle || renderer.title || {};
    const label = title.simpleText || (Array.isArray(title.runs) ? title.runs.map(run => run.text || '').join('') : id);
    catalog.push({ id, title: String(label).slice(0, 150) });
  }
  return catalog;
}
export function customizeGuide(data, preferences) {
  const hidden = new Set(Array.isArray(preferences.hidden) ? preferences.hidden.filter(id => typeof id === 'string') : []);
  const order = Array.isArray(preferences.order) ? preferences.order.filter(id => typeof id === 'string').slice(0, 100) : [];
  if (!hidden.size && !order.length && !preferences.hideChannels) return false;
  let changed = false;
  for (const section of guideSections(data)) {
    const original = section.items;
    const ranked = original.filter(item => guideKey(item)).map((item, index) => ({ item, index }));
    const rank = id => { const index = order.indexOf(id); return index === -1 ? order.length : index; };
    ranked.sort((a, b) => rank(guideKey(a.item)) - rank(guideKey(b.item)) || a.index - b.index);
    let cursor = 0;
    let result = original.map(item => guideKey(item) ? ranked[cursor++].item : item).filter(item => {
      const key = guideKey(item);
      if (key && hidden.has(key)) return false;
      const entry = item && item.guideEntryRenderer;
      const id = entry && entry.navigationEndpoint && entry.navigationEndpoint.browseEndpoint && entry.navigationEndpoint.browseEndpoint.browseId;
      return !(preferences.hideChannels && typeof id === 'string' && id.indexOf('UC') === 0);
    });
    // Keep one real navigation entry if all main links were hidden. Unknown
    // profile-specific entries are never synthesized, renamed or discarded.
    if (!result.length && ranked.length) result = [ranked[0].item];
    if (result.length !== original.length || result.some((item, index) => item !== original[index])) { section.items = result; changed = true; }
  }
  return changed;
}
