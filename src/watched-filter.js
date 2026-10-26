import { configRead, configAddChangeListener } from './config.js';
import { readAccountContext } from './account-context.js';
import { watchedPageNames, watchedConfigKeys } from './watched/preferences.js';
import { installWatchedNetworkFilter } from './watched/network.js';

let filter = null, last = null, lastAccount = null;
const changed = () => window.dispatchEvent(new CustomEvent('ytaf-watched-update'));
function identity() { const current = readAccountContext(); return current.authenticated ? current.key : null; }
export function initWatchedFilter() {
  if (filter) return;
  filter = installWatchedNetworkFilter(window, { enabled: () => configRead('enableWatchedFilter'), identity,
    preferences: () => ({ threshold: Number(configRead('watchedThreshold')), pages: Object.keys(watchedPageNames).filter(page => configRead('watchedOn_' + page)) }),
    report(result) { last = result; changed(); } });
  const invalidate = () => { filter.invalidate(); last = null; changed(); };
  for (const key of watchedConfigKeys) configAddChangeListener(key, invalidate);
  window.addEventListener('ytaf-page-update', () => {
    const account = identity();
    if (account !== lastAccount || (document.body && document.body.classList.contains('WEB_PAGE_TYPE_ACCOUNT_SELECTOR'))) { lastAccount = account; invalidate(); }
  });
  document.addEventListener('webOSRelaunch', invalidate, true);
  window.addEventListener('pagehide', invalidate);
  lastAccount = identity();
}
export function createWatchedStatus() {
  initWatchedFilter();
  const root = document.createElement('div'); root.id = 'ytaf-watched-status'; root.setAttribute('aria-live', 'polite');
  const render = () => {
    let text = 'Changes apply when the page refreshes. Videos with unknown progress remain visible.';
    if (!configRead('enableWatchedFilter')) text = 'Watched-video filtering is disabled. ' + text;
    else if (!identity()) text = 'Waiting for a confirmed active account; videos remain visible. ' + text;
    else if (last) text = `Last refresh (${watchedPageNames[last.page]}): ${last.removed} watched video(s) hidden. ` + text;
    else text = 'Using progress supplied by YouTube for the active account. ' + text;
    root.textContent = text;
  };
  window.addEventListener('ytaf-watched-update', render); render(); return root;
}
