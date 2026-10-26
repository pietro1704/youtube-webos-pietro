import { isSupportedSpeed } from './mse-hook.js';

const OPTIONS = 'ytlr-button[role="checkbox"], [role="menuitemradio"]';
const icons = new WeakMap();

function checkIcon(row) {
  return row && Array.from(row.children).find(child => child.tagName.toLowerCase() === 'yt-icon');
}

export function findNativeSpeedRow(rows, title) {
  return rows.find(row => {
    // The server's short row title can differ from VIDEO_SPEED (panel title).
    // Read only the component's semantic command, never its tracking payload.
    const item = row.closest('ytlr-menu-item');
    for (const node of [row, item]) {
      const props = node && node.__instance && node.__instance.props;
      const action = props && props.command && props.command.openClientOverlayAction;
      if (action && action.type === 'CLIENT_OVERLAY_TYPE_VIDEO_PLAYBACK_SPEED') return true;
    }
    const label = row.querySelector('yt-formatted-string');
    return !!title && label && label.textContent.trim() === title;
  }) || null;
}

function speedMenu(menu, title) {
  if (!menu || !title || !menu.isConnected) return false;
  const heading = menu.querySelector('ytlr-overlay-panel-header-renderer, [role="heading"]');
  return !!heading && heading.textContent.trim() === title;
}

function visibleMenu(menu) {
  const win = menu.ownerDocument.defaultView;
  for (let node = menu; node && node.nodeType === 1; node = node.parentElement) {
    const style = win.getComputedStyle(node);
    if (node.hidden || node.getAttribute('aria-hidden') === 'true' ||
        style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

function optionSpeed(row, normal) {
  const label = row.querySelector('yt-formatted-string');
  const text = (label ? label.textContent : row.textContent).trim();
  if (normal && text === normal) return 1;
  const match = text.match(/^(\d+(?:[.,]\d+)?)\s*[x×]$/);
  if (!match) return null;
  const rate = Number(match[1].replace(',', '.'));
  return isSupportedSpeed(rate) ? rate : null;
}

export function nativeSpeedSelection(node, title, normal) {
  if (!node || node.nodeType !== 1 || !node.isConnected) return null;
  let row = node.closest(OPTIONS);
  if (!row) {
    const item = node.closest('ytlr-menu-item');
    row = item && item.querySelector(OPTIONS);
  }
  const menu = row && row.closest('.AmQJbe');
  if (!row || !speedMenu(menu, title) || !visibleMenu(menu)) return null;
  return optionSpeed(row, normal);
}

export function paintNativeSpeedOptions(root, rate, title, normal) {
  for (const menu of root.querySelectorAll('.AmQJbe')) {
    if (!speedMenu(menu, title)) continue;
    const rows = Array.from(menu.querySelectorAll(OPTIONS));
    // Derive the checkmark classes from this menu's own renderer. YouTube
    // changes these names; never reuse a checkmark from a different dialog.
    if (!icons.has(menu)) {
      const checked = rows.find(row => row.getAttribute('aria-checked') === 'true');
      const unchecked = rows.find(row => row.getAttribute('aria-checked') !== 'true');
      const yes = checkIcon(checked);
      const no = checkIcon(unchecked);
      if (yes && no && yes.className !== no.className) icons.set(menu, { yes: yes.className, no: no.className });
    }
    for (const row of rows) {
      const speed = optionSpeed(row, normal);
      if (speed === null) continue;
      const selected = speed === rate;
      const expected = String(selected);
      if (row.getAttribute('aria-checked') !== expected) row.setAttribute('aria-checked', expected);
      const icon = checkIcon(row);
      const classes = icons.get(menu);
      if (icon && classes && icon.className !== classes[selected ? 'yes' : 'no']) {
        icon.className = classes[selected ? 'yes' : 'no'];
      }
    }
  }
}
