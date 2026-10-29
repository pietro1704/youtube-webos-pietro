import { configRead, configAddChangeListener } from './config.js';
import { SELECTORS, REMOTE_KEYS, isGuestMode, sendKey, invalidateGuestModeCache, SYNTHETIC_KEY_FLAG } from './utils';
import './auto-login.css';

const STORAGE_KEY = 'yt.leanback.default::recurring_actions';
const TARGET_ACTIONS = [
  'startup-screen-account-selector-with-guest',
  'whos_watching_fullscreen_zero_accounts',
  'startup-screen-signed-out-welcome-back'
];

const BYPASS_BODY_CLASS = 'ytaf-bypassing-login';
let hasBypassed = false;
let pageObserverAttached = false;

/**
 * Disables "Who's watching" by pushing the lastFired date 7 days into the future.
 * Credit: reisxd || https://github.com/reisxd/TizenTube/
 */
function disableWhosWatching(enable = true) {
  try {
    const storedData = localStorage.getItem(STORAGE_KEY);
    if (!storedData) return console.warn('Auto login: No recurring actions found');

    const json = JSON.parse(storedData);
    const actions = json.data?.data;

    if (!actions) return;

    // Use a future date if enabling, or Date.now() if disabling
    const targetDate = enable ? Date.now() + (7 * 24 * 60 * 60 * 1000) : Date.now();
    let isModified = false;

    for (const key of TARGET_ACTIONS) {
      if (actions[key]) {
        actions[key].lastFired = targetDate;
        isModified = true;
      }
    }

    if (isModified) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(json));
      console.info(`Auto login: "Who's watching" screens ${enable ? 'disabled' : 'enabled'}`);
    }
  } catch (error) {
    console.error('Auto login: Failed to update settings:', error);
  }
}

/**
 * Suppresses the Premium / Premium Lite upsell interstitial.
 *
 * Same trick as disableWhosWatching() above, against the app's own gate. The
 * leanback client records when it last showed the promo and how many times, and
 * consults both before showing it again:
 *
 *   yt.leanback.default::promo-coupon-shown-timestamp  {"data":0,...}
 *   yt.leanback.default::promo-coupon-shown-times      {"data":0,...}
 *
 * Dating the timestamp forward and raising the count means the app decides for
 * itself not to show the page - so there is no request to intercept, no empty
 * screen where the ad used to be, and nothing to go stale when YouTube moves
 * the endpoint or renames the page type.
 */
const PROMO_SUFFIXES = ['promo-coupon-shown-timestamp', 'promo-coupon-shown-times'];
const LEANBACK_PREFIX = 'yt.leanback.default::';
// Longer than the 7 days used for the account selector, which only has to
// survive until the next launch. A promo check can happen mid-session, and a TV
// app can stay open for weeks.
const PROMO_SUPPRESS_MS = 365 * 24 * 60 * 60 * 1000;
const PROMO_SHOWN_TIMES = 99;
// The app stamps these records to expire about 360 days out. An expired record
// reads back as absent, which would quietly hand the promo a clean slate, so
// the envelope's own TTL is refreshed alongside the value.
const PROMO_ENVELOPE_TTL_MS = 360 * 24 * 60 * 60 * 1000;

function promoValueFor(suffix) {
  return suffix === 'promo-coupon-shown-times'
    ? PROMO_SHOWN_TIMES
    : Date.now() + PROMO_SUPPRESS_MS;
}

function disablePromoUpsell(enable = true) {
  try {
    const targets = new Set();

    // Matched on the suffix rather than the full key: the namespace is not
    // always `default`, and a record written under a profile-specific one would
    // otherwise be missed while the promo kept firing.
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      for (const suffix of PROMO_SUFFIXES) {
        if (key.slice(-suffix.length) === suffix) targets.add(key);
      }
    }

    // On a fresh install neither record exists yet, so seed the default
    // namespace - otherwise the very first launch is the one that gets nagged.
    for (const suffix of PROMO_SUFFIXES) targets.add(LEANBACK_PREFIX + suffix);

    let count = 0;
    for (const key of targets) {
      let suffix = null;
      for (const candidate of PROMO_SUFFIXES) {
        if (key.slice(-candidate.length) === candidate) suffix = candidate;
      }
      if (!suffix) continue;

      let envelope = null;
      const existing = localStorage.getItem(key);
      if (existing) {
        try {
          envelope = JSON.parse(existing);
        } catch (_e) {
          envelope = null;
        }
      }
      if (!envelope || typeof envelope !== 'object') {
        envelope = { data: 0, creation: Date.now() };
      }

      // Only `data` is ours to decide; the rest of the record is left as the
      // app wrote it, apart from the refreshed expiry.
      envelope.data = enable ? promoValueFor(suffix) : 0;
      envelope.expiration = Date.now() + PROMO_ENVELOPE_TTL_MS;
      localStorage.setItem(key, JSON.stringify(envelope));
      count++;
    }

    if (count) console.info(`[Auto Login] Premium upsell ${enable ? 'suppressed' : 'restored'} (${count} records)`);
  } catch (error) {
    console.error('[Auto Login] Failed to update promo settings:', error);
  }
}

export function setInlinePlayback(mode) {
  if (mode === 'disabled') return;
  
  const isEnabled = mode === 'force_on';
  try {
    localStorage.setItem('yt.leanback.default::inline-playback-enabled', JSON.stringify({ data: isEnabled }));
    console.info(`[Auto Login] Inline playback (previews) forced to: ${isEnabled}`);
  } catch (error) {
    console.error('[Auto Login] Failed to update inline playback setting:', error);
  }
}

export function initPreviews() {
  const mode = configRead('forcePreviews');
  if (mode === 'disabled') return;

  // Delay by 2.5 seconds to ensure it applies after YouTube's initial load overrides
  setTimeout(() => {
    setInlinePlayback(mode);
  }, 2500); 
}

// Bypass actions belong to one selector, identity and launch generation.
let bypassGeneration = 0;
let bypassBody = null;
let startupTimer = null;
const bypassTimers = new Set();

function cancelActiveBypass() {
  bypassGeneration++;
  for (const timer of bypassTimers) clearTimeout(timer);
  bypassTimers.clear();
  if (bypassBody) bypassBody.classList.remove(BYPASS_BODY_CLASS);
  bypassBody = null;
}

function identityKey() {
  try {
    const raw = localStorage.getItem('yt.leanback.default::last-identity-used');
    const envelope = raw && JSON.parse(raw);
    const data = typeof envelope?.data === 'string' ? JSON.parse(envelope.data) : envelope?.data;
    // Compare identity only; never retain credentials in the pending operation.
    return JSON.stringify([data?.identityType, data?.effectiveObfuscatedGaiaId,
      data?.ownerObfuscatedGaiaId, data?.gaiaDelegationType]);
  } catch { return undefined; }
}

export function attemptActiveBypass(force = false) {
  const body = document.body;
  if (!configRead('enableAutoLogin') || !body?.classList.contains(SELECTORS.ACCOUNT_SELECTOR)) return;
  if (hasBypassed && !force) return;
  cancelActiveBypass();
  const identity = identityKey();
  if (identity === undefined) return;
  const generation = bypassGeneration, location = window.location.href;
  hasBypassed = true;
  bypassBody = body;
  body.classList.add(BYPASS_BODY_CLASS);
  const valid = () => generation === bypassGeneration && configRead('enableAutoLogin') &&
    document.body === body && body.classList.contains(SELECTORS.ACCOUNT_SELECTOR) &&
    window.location.href === location && identityKey() === identity;
  const continueIfValid = () => {
    if (valid()) return true;
    // A dispatched key can synchronously navigate or start another attempt.
    if (generation === bypassGeneration) cancelActiveBypass();
    return false;
  };
  const later = (fn, delay) => {
    const timer = setTimeout(() => {
      bypassTimers.delete(timer);
      if (generation !== bypassGeneration) return;
      if (!valid()) { cancelActiveBypass(); return; }
      fn();
    }, delay);
    bypassTimers.add(timer);
  };
  const enter = () => {
    sendKey(REMOTE_KEYS.ENTER);
    if (continueIfValid()) later(cancelActiveBypass, 2000);
  };
  later(() => {
    invalidateGuestModeCache();
    if (isGuestMode()) {
      sendKey(REMOTE_KEYS.DOWN);
      if (continueIfValid()) later(enter, 200);
    } else enter();
  }, 500);
}

export function resetActiveBypass() {
  cancelActiveBypass();
  if (startupTimer !== null) clearTimeout(startupTimer);
  startupTimer = null;
  hasBypassed = false;
  invalidateGuestModeCache();
}

function setupActiveBypassListener() {
  if (pageObserverAttached) return;
  window.addEventListener('ytaf-page-update', evt => {
    if (evt.detail?.isAccountSelector) attemptActiveBypass();
    else cancelActiveBypass();
  });
  window.addEventListener('keydown', evt => {
    if (!evt[SYNTHETIC_KEY_FLAG]) cancelActiveBypass();
  }, true);
  window.addEventListener('mousedown', cancelActiveBypass, true);
  window.addEventListener('hashchange', cancelActiveBypass);
  window.addEventListener('pagehide', cancelActiveBypass);
  pageObserverAttached = true;
}

export function initAutoLogin() {
  if (!configRead('enableAutoLogin')) return;
  disableWhosWatching();
  disablePromoUpsell();
  setupActiveBypassListener();
  if (startupTimer !== null) clearTimeout(startupTimer);
  startupTimer = setTimeout(() => {
    startupTimer = null;
    hasBypassed = true;
  }, 15000);
}

document.readyState === 'loading'
  ? document.addEventListener('DOMContentLoaded', () => { initAutoLogin(); initPreviews(); })
  : (initAutoLogin(), initPreviews());

configAddChangeListener('enableAutoLogin', ({ detail }) => {
  resetActiveBypass();
  if (detail.newValue) {
    console.info('Auto login setting enabled');
    initAutoLogin();
  } else {
    console.info('Auto login disabled');
    disableWhosWatching(false); // Reset local storage time value
    disablePromoUpsell(false);
  }
});

configAddChangeListener('forcePreviews', ({ detail }) => {
  setInlinePlayback(detail.newValue);
});