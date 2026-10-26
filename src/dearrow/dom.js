import { createThumbnailUrl } from './branding.js';

const TILE_SELECTOR = [
  'ytlr-tile-renderer',
  'ytlr-compact-video-renderer',
  'ytlr-video-renderer',
  '[data-video-id]',
  '[video-id]',
].join(',');

function videoIdFrom(root) {
  const direct =
    root.getAttribute('data-video-id') ||
    root.getAttribute('video-id') ||
    root.getAttribute('data-context-item-id') ||
    root.getAttribute('data-content-id');
  if (direct && /^[\w-]{11}$/.test(direct)) return direct;
  const link = root.matches('a[href]')
    ? root
    : root.querySelector('a[href*="watch"]');
  const href = link && link.getAttribute('href');
  const match = href && href.match(/[?&]v=([\w-]{11})/);
  if (match) return match[1];

  const thumbs = root.querySelectorAll(
    'img[src*="ytimg.com/vi"],ytlr-thumbnail-details,thumbnail image',
  );
  for (let i = 0; i < thumbs.length; i++) {
    const source =
      (thumbs[i].getAttribute && thumbs[i].getAttribute('src')) ||
      (thumbs[i].style && thumbs[i].style.backgroundImage) ||
      '';
    const thumbMatch = source.match(/ytimg\.com\/vi(?:_webp)?\/([\w-]{11})\//);
    if (thumbMatch) return thumbMatch[1];
  }
  return null;
}

function findTile(candidate) {
  if (candidate.matches && candidate.matches(TILE_SELECTOR)) return candidate;
  return candidate.closest ? candidate.closest(TILE_SELECTOR) : null;
}

function collectTiles(root) {
  const found = [];
  const seen = new Set();
  const candidates = root.querySelectorAll(
    TILE_SELECTOR + ',a[href*="watch?v="]',
  );
  for (let i = 0; i < candidates.length; i++) {
    const tile = findTile(candidates[i]) || candidates[i];
    if (!seen.has(tile) && videoIdFrom(tile)) {
      seen.add(tile);
      found.push(tile);
    }
  }
  return found;
}

function titleNode(tile) {
  return tile.querySelector('#video-title,[data-title],yt-formatted-string');
}

function thumbnailTarget(tile) {
  const images = tile.querySelectorAll('img');
  for (let i = 0; i < images.length; i++) {
    const src = images[i].getAttribute('src') || '';
    if (/ytimg\.com|youtube\.com/.test(src)) {
      return { node: images[i], kind: 'src' };
    }
  }
  const backgrounds = tile.querySelectorAll(
    'ytlr-thumbnail-details,ytlr-surface-page,thumbnail image',
  );
  for (let i = 0; i < backgrounds.length; i++) {
    const value = backgrounds[i].style.backgroundImage || '';
    if (/ytimg\.com|youtube\.com/.test(value)) {
      return { node: backgrounds[i], kind: 'background' };
    }
  }
  return null;
}

function thumbnailValue(target) {
  if (!target) return '';
  return target.kind === 'src'
    ? target.node.getAttribute('src') || ''
    : target.node.style.backgroundImage || '';
}

function setThumbnailValue(target, value) {
  if (target.kind === 'src') target.node.setAttribute('src', value);
  else target.node.style.backgroundImage = value;
}

function restore(state) {
  if (!state) return;
  if (
    state.title &&
    state.title.isConnected &&
    state.appliedTitle !== null &&
    state.title.textContent === state.appliedTitle
  ) {
    state.title.textContent = state.originalTitle;
  }
  if (state.image && state.image.node.isConnected) {
    const currentSrc = thumbnailValue(state.image);
    if (state.appliedSrc !== null && currentSrc === state.appliedSrc) {
      setThumbnailValue(state.image, state.originalSrc);
      if (state.image.kind === 'src') {
        if (state.originalSrcset === null)
          state.image.node.removeAttribute('srcset');
        else state.image.node.setAttribute('srcset', state.originalSrcset);
      }
    }
  }
}

export function createDeArrowDomAdapter({ root, client, getMode }) {
  const states = new Map();
  let observer = null;
  let refreshTimer = null;
  let destroyed = false;

  function stateFor(tile, videoId) {
    let state = states.get(tile);
    if (state && state.videoId !== videoId) {
      restore(state);
      states.delete(tile);
      state = null;
    }
    if (!state) {
      const title = titleNode(tile);
      const image = thumbnailTarget(tile);
      state = {
        videoId,
        title,
        image,
        originalTitle: title ? title.textContent : '',
        originalSrc: thumbnailValue(image),
        originalSrcset:
          image && image.kind === 'src'
            ? image.node.getAttribute('srcset')
            : null,
        appliedTitle: null,
        appliedSrc: null,
      };
      states.set(tile, state);
    }
    return state;
  }

  function apply(tile, state, branding, mode) {
    if (
      destroyed ||
      !root.contains(tile) ||
      states.get(tile) !== state ||
      videoIdFrom(tile) !== state.videoId ||
      !branding
    )
      return;
    if (
      (mode === 'titles' || mode === 'titles_thumbnails') &&
      branding.title &&
      state.title
    ) {
      if (state.title.textContent !== branding.title)
        state.title.textContent = branding.title;
      state.appliedTitle = branding.title;
    }
    if (
      mode === 'titles_thumbnails' &&
      typeof branding.thumbnailTimestamp === 'number' &&
      state.image
    ) {
      const url = createThumbnailUrl(
        state.videoId,
        branding.thumbnailTimestamp,
      );
      state.appliedSrc = state.image.kind === 'src' ? url : `url("${url}")`;
      if (thumbnailValue(state.image) !== state.appliedSrc)
        setThumbnailValue(state.image, state.appliedSrc);
      if (state.image.kind === 'src' && state.image.node.hasAttribute('srcset'))
        state.image.node.removeAttribute('srcset');
    } else if (
      state.image &&
      state.appliedSrc !== null &&
      thumbnailValue(state.image) === state.appliedSrc
    ) {
      setThumbnailValue(state.image, state.originalSrc);
      if (state.image.kind === 'src' && state.originalSrcset !== null)
        state.image.node.setAttribute('srcset', state.originalSrcset);
      state.appliedSrc = null;
    }
  }

  function refresh() {
    if (destroyed) return;
    states.forEach((state, tile) => {
      if (!root.contains(tile)) {
        restore(state);
        states.delete(tile);
      }
    });
    const mode = getMode();
    if (mode === 'off') {
      states.forEach(restore);
      states.clear();
      return;
    }
    const tiles = collectTiles(root);
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      const videoId = videoIdFrom(tile);
      const state = stateFor(tile, videoId);
      client
        .get(videoId)
        .then((branding) => apply(tile, state, branding, getMode()));
    }
  }

  function scheduleRefresh() {
    if (refreshTimer !== null) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refresh();
    }, 100);
  }

  if (typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(scheduleRefresh);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'href',
        'src',
        'style',
        'data-video-id',
        'video-id',
        'data-context-item-id',
        'data-content-id',
      ],
    });
  }

  return {
    refresh,
    destroy() {
      destroyed = true;
      if (observer) observer.disconnect();
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      states.forEach(restore);
      states.clear();
    },
  };
}
