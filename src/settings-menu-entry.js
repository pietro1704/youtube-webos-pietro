import { findDisabledRow } from './playback-speed.js';

const MENU_SELECTOR = '.AmQJbe';
const ROW_SELECTOR = 'ytlr-button[role="menuitem"]';
const ENTRY_FLAG = 'data-ytaf-settings-entry';
const ENTRY_TITLE = 'YouTube Extended';
const ENTRY_SUBTITLE = 'Adblock, velocidade, Shorts e mais';

function openExtendedSettings(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
  }
  if (typeof window.ytaf_showOptionsPanel === 'function') {
    window.ytaf_showOptionsPanel(true);
    return true;
  }
  return false;
}

function entryWrapper(row) {
  if (!row || !row.closest) return null;
  return (
    row.closest('ytlr-compact-link-renderer') ||
    row.closest('ytlr-menu-item')
  );
}

function configuredMessage(key) {
  const sources = [];
  try {
    if (window.ytcfg) {
      sources.push(window.ytcfg.msgs);
      if (typeof window.ytcfg.get === 'function') {
        sources.push(window.ytcfg.get('msgs'));
      }
    }
    if (window.yt) {
      sources.push(
        window.yt.msgs_,
        window.yt.msgs,
        window.yt.config_ && window.yt.config_.msgs
      );
    }
  } catch {
    return null;
  }
  for (let i = 0; i < sources.length; i++) {
    if (sources[i] && typeof sources[i][key] === 'string') {
      return sources[i][key];
    }
  }
  return null;
}

function rowTitle(row) {
  const labels = row.getElementsByTagName('yt-formatted-string');
  return labels.length ? (labels[0].textContent || '').trim() : '';
}

function findSpeedRow(rows) {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].hasAttribute('data-ytaf-speed-row')) return rows[i];
  }
  const disabled = findDisabledRow(rows);
  if (disabled) return disabled.row;

  // On TVs where the early capability hook unlocks YouTube's native Speed row,
  // it is no longer disabled. Match YouTube's own localized label in that case.
  const speedLabel = configuredMessage('VIDEO_SPEED');
  if (speedLabel) {
    for (let i = 0; i < rows.length; i++) {
      if (rowTitle(rows[i]) === speedLabel) return rows[i];
    }
  }
  return null;
}

function paintEntry(button) {
  button.setAttribute(ENTRY_FLAG, '1');
  button.setAttribute('aria-label', `${ENTRY_TITLE}. ${ENTRY_SUBTITLE}`);
  button.removeAttribute('aria-hidden');

  const keyed = button.querySelectorAll('[idomkey]');
  for (let i = 0; i < keyed.length; i++) keyed[i].removeAttribute('idomkey');
  button.removeAttribute('idomkey');

  const labels = button.getElementsByTagName('yt-formatted-string');
  if (labels.length > 0) labels[0].textContent = ENTRY_TITLE;
  if (labels.length > 1) labels[labels.length - 1].textContent = ENTRY_SUBTITLE;
}

function injectIntoMenu(menu) {
  if (!menu || menu.querySelector(`[${ENTRY_FLAG}]`)) return false;
  const rows = Array.prototype.slice.call(menu.querySelectorAll(ROW_SELECTOR));
  const speedRow = findSpeedRow(rows);
  if (!speedRow) return false;

  let source = null;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i] !== speedRow && entryWrapper(rows[i])) {
      source = rows[i];
      break;
    }
  }
  const sourceWrapper = entryWrapper(source);
  const speedWrapper = entryWrapper(speedRow);
  if (!sourceWrapper || !speedWrapper || !speedWrapper.parentNode) return false;

  const wrapper = sourceWrapper.cloneNode(true);
  const button = wrapper.querySelector(ROW_SELECTOR);
  if (!button) return false;
  paintEntry(button);

  button.addEventListener('click', openExtendedSettings, true);
  button.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Enter' || event.keyCode === 13) {
        openExtendedSettings(event);
      }
    },
    true
  );

  speedWrapper.parentNode.appendChild(wrapper);
  return true;
}

export function injectSettingsMenuEntries(root = document) {
  const menus = root.querySelectorAll(MENU_SELECTOR);
  let added = 0;
  for (let i = 0; i < menus.length; i++) {
    if (injectIntoMenu(menus[i])) added++;
  }
  return added;
}

export function initSettingsMenuEntry() {
  const root = document.querySelector('ytlr-app') || document.body;
  if (!root || root.__ytafSettingsEntryObserver) return;

  let scheduled = false;
  const scan = () => {
    scheduled = false;
    injectSettingsMenuEntries(document);
  };
  const scheduleScan = () => {
    if (scheduled) return;
    scheduled = true;
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(scan);
    else setTimeout(scan, 0);
  };

  const observer = new MutationObserver(scheduleScan);
  observer.observe(root, { childList: true, subtree: true });
  root.__ytafSettingsEntryObserver = observer;
  window.addEventListener('ytaf-page-update', scheduleScan);
  scan();
}

initSettingsMenuEntry();
