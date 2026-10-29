// Premium upsell path: uAssets annoyances-others.txt at
// e34d9c929ced768ae94648765ba3f9673a8b75ce (also applies to tv.youtube.com).
// TV masthead/ad-slot structures are shared with reisxd/TizenTube.
// Generic banners/nudges require an explicit YouTube Premium destination;
// visible text is never sufficient to classify a video or reminder as an ad.
const adRenderers = new Set([
  'adSlotRenderer', 'tvMastheadRenderer', 'displayAdRenderer',
  'promotedSparklesWebRenderer', 'promotedSparklesTextSearchRenderer',
  'upsellDialogRenderer', 'mealbarPromoRenderer'
]);
const bannerRenderers = new Set(['feedNudgeRenderer', 'statementBannerRenderer', 'bannerPromoRenderer']);

function premiumDestination(value) {
  const pending = [value], seen = new Set();
  while (pending.length && seen.size < 1000) {
    const node = pending.pop();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    const raw = node.urlEndpoint && node.urlEndpoint.url;
    if (typeof raw === 'string') {
      try {
        const url = new URL(raw, 'https://www.youtube.com');
        if (/(?:^|\.)youtube\.com$/.test(url.hostname) &&
            /^\/premium(?:lite|_lite)?\/?$/.test(url.pathname)) return true;
      } catch { /* malformed destinations are left alone */ }
    }
    for (const key of Object.keys(node)) pending.push(node[key]);
  }
  return false;
}

function promotion(node) {
  if (!node || typeof node !== 'object') return false;
  return Object.keys(node).some(key => adRenderers.has(key) ||
    (bannerRenderers.has(key) && premiumDestination(node[key])));
}

export function prunePromotions(data) {
  const pending = [data], seen = new Set();
  let changed = false;
  while (pending.length && seen.size < 50000) {
    const node = pending.pop();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) {
        if (promotion(node[i])) { node.splice(i, 1); changed = true; }
        else pending.push(node[i]);
      }
    } else {
      for (const key of Object.keys(node)) {
        if (adRenderers.has(key) || (bannerRenderers.has(key) && premiumDestination(node[key]))) {
          delete node[key]; changed = true;
        } else pending.push(node[key]);
      }
    }
  }
  return changed;
}
