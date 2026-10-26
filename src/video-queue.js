import { configRead, configAddChangeListener } from './config.js';
import { SELECTORS, getVideo, isWatchPage } from './utils.js';
import { ResolveCommandRegistry } from './app_api/index.ts';
import { readAccountContext } from './account-context.js';
import { showNotification } from './notifications.js';
import { createVideoQueue } from './queue/controller.js';

let feature = null;
let selection = null;
const player = () => document.getElementById(SELECTORS.PLAYER_ID);
function currentVideo() {
  try { const p = player(); return p && p.getVideoData && p.getVideoData(); } catch { return null; }
}
const account = () => readAccountContext().key;

export function captureQueueSelection(node) {
  selection = null;
  if (isWatchPage()) {
    const data = currentVideo();
    if (data) selection = { id: data.video_id, title: data.title, account: account() };
  } else if (node && node.closest) {
    const tile = node.closest('ytlr-tile-renderer, ytlr-compact-video-renderer, ytlr-video-renderer, [data-video-id], [video-id], a[href*="watch"]');
    if (!tile) return;
    const link = tile.matches('a[href]') ? tile : tile.querySelector('a[href*="watch"]');
    const image = tile.querySelector('img[src*="ytimg.com/vi"], ytlr-thumbnail-details');
    const source = image && (image.getAttribute('src') || image.style.backgroundImage);
    const match = (link && (link.getAttribute('href') || '').match(/[?&]v=([\w-]{11})(?:[^\w-]|$)/)) ||
      (source && source.match(/ytimg\.com\/vi(?:_webp)?\/([\w-]{11})\//));
    const id = tile.getAttribute('data-video-id') || tile.getAttribute('video-id') || (match && match[1]);
    const title = tile.querySelector('#video-title, [data-title], yt-formatted-string');
    selection = { id, title: title ? title.textContent : id, account: account() };
  }
}

export function initVideoQueue() {
  if (feature) return feature;
  const queue = createVideoQueue({ enabled: () => configRead('enableVideoQueue'), getIdentity: account,
    getVideoId: () => { const data = currentVideo(); return data && data.video_id; }, isWatching: isWatchPage,
    getDispatcher: async () => { const registry = await ResolveCommandRegistry.getInstance(); return command => registry.dispatchCommand(command); },
    notify: showNotification, changed: () => window.dispatchEvent(new CustomEvent('ytaf-queue-change')) });
  let video = null;
  const ended = () => { if (video && video.ended) queue.onEnded(); };
  const sync = () => {
    queue.observe();
    const next = configRead('enableVideoQueue') && isWatchPage() ? getVideo() : null;
    if (next === video) return;
    if (video) video.removeEventListener('ended', ended);
    video = next;
    if (video) video.addEventListener('ended', ended);
  };
  const navigation = () => {
    if (document.body && document.body.classList.contains(SELECTORS.ACCOUNT_SELECTOR)) { selection = null; queue.clear(); }
    sync();
  };
  const external = () => { selection = null; queue.externalLaunch(); };
  let timer = null;
  const configure = () => {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    sync();
    if (configRead('enableVideoQueue')) timer = window.setInterval(sync, 500);
  };
  configAddChangeListener('enableVideoQueue', configure);
  window.addEventListener('ytaf-page-update', navigation);
  document.addEventListener('webOSRelaunch', external, true);
  feature = queue;
  configure();
  return queue;
}

export function createQueueControls() {
  const queue = initVideoQueue();
  const root = document.createElement('div');
  root.id = 'ytaf-video-queue';
  const status = document.createElement('div');
  status.setAttribute('aria-live', 'polite');
  const actions = document.createElement('div');
  const list = document.createElement('div');
  function button(label, action, id) {
    const el = document.createElement('button'); el.type = 'button'; el.textContent = label; el.disabled = !configRead('enableVideoQueue');
    if (id) el.id = id;
    el.addEventListener('click', () => {
      if (!configRead('enableVideoQueue')) return;
      action();
    });
    return el;
  }
  const add = next => {
    if (!selection || selection.account !== account() || !queue.add(selection, next)) showNotification('Select a video before opening settings, or open settings during playback.');
  };
  actions.appendChild(button('Add selected/current video', () => add(false), 'ytaf-queue-add'));
  actions.appendChild(button('Play selected/current next', () => add(true), 'ytaf-queue-next'));
  actions.appendChild(button('Start queue', () => {
    queue.play().then(ok => { if (ok && window.ytaf_showOptionsPanel) window.ytaf_showOptionsPanel(false); });
  }, 'ytaf-queue-start'));
  actions.appendChild(button('Clear queue', () => queue.clear(), 'ytaf-queue-clear'));
  function render() {
    const enabled = configRead('enableVideoQueue');
    const entries = queue.list();
    status.textContent = enabled ? `Session queue: ${entries.length} video(s). Cleared when changing accounts or opening an external video.` : 'Enable the queue to add videos. Native playlists remain unchanged.';
    for (const el of Array.from(actions.querySelectorAll('button'))) el.disabled = !enabled;
    while (list.firstChild) list.removeChild(list.firstChild);
    for (const entry of entries) {
      const row = document.createElement('div');
      const title = document.createElement('span'); title.textContent = entry.title;
      row.appendChild(title);
      row.appendChild(button('Play next', () => queue.moveNext(entry.id)));
      row.appendChild(button('Remove', () => queue.remove(entry.id)));
      list.appendChild(row);
    }
  }
  window.addEventListener('ytaf-queue-change', render);
  configAddChangeListener('enableVideoQueue', render);
  root.appendChild(status); root.appendChild(actions); root.appendChild(list); render();
  return root;
}
