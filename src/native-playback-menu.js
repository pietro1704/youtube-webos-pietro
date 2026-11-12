export function configuredMessage(key) {
  let messages;
  try {
    messages = window.ytcfg && typeof window.ytcfg.get === 'function' && window.ytcfg.get('msgs');
  } catch { /* YouTube may replace its config provider during navigation. */ }
  const sources = [window.ytcfg && window.ytcfg.msgs, messages,
    window.yt && window.yt.msgs_, window.yt && window.yt.msgs,
    window.yt && window.yt.config_ && window.yt.config_.msgs];
  for (const source of sources) {
    if (source && typeof source[key] === 'string') return source[key];
  }
  return null;
}

const OPTIONS = 'ytlr-button[role="checkbox"], [role="menuitemradio"]';

function visibleMenu(menu) {
  const win = menu.ownerDocument.defaultView;
  for (let node = menu; node && node.nodeType === 1; node = node.parentElement) {
    const style = win.getComputedStyle(node);
    if (node.hidden || node.getAttribute('aria-hidden') === 'true' ||
        style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

export function nativeMenuOption(node, titles) {
  if (!node || node.nodeType !== 1 || !node.isConnected) return null;
  const row = node.closest(OPTIONS) || node.closest('ytlr-menu-item')?.querySelector(OPTIONS);
  const menu = row?.closest('.AmQJbe');
  const heading = menu?.querySelector('ytlr-overlay-panel-header-renderer, [role="heading"]');
  return heading && titles.includes(heading.textContent.trim()) && visibleMenu(row) ? row : null;
}

export function nativeOptionFromEvent(evt, titles) {
  let row = nativeMenuOption(evt.target, titles);
  if (row || evt.type !== 'keydown') return row;
  const doc = evt.target.ownerDocument || evt.target;
  const active = doc.activeElement;
  const scope = evt.target.closest?.('.AmQJbe, [role="dialog"]') ||
    active?.closest('.AmQJbe, [role="dialog"]');
  if (!scope) return null;
  if (scope.contains(active)) row = nativeMenuOption(active, titles);
  return row || nativeMenuOption(scope.querySelector(
    'ytlr-button[role="checkbox"].zylon-focus, [role="menuitemradio"].zylon-focus'), titles);
}
