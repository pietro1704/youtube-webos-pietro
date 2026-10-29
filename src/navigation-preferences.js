import { configRead, configWrite, configAddChangeListener } from './config.js';
import { ResolveCommandRegistry } from './app_api/index.ts';
import { readAccountContext } from './account-context.js';
import { guideCatalog, guideSections, customizeGuide } from './navigation/guide.js';
import { createSubscriptionStartup, isHomeLocation, hasExternalTarget } from './navigation/startup.js';
import { SYNTHETIC_KEY_FLAG } from './utils.js';

let initialized = false;
let catalog = [], catalogAccount = null;
let startupMessage = '';
const changed = () => window.dispatchEvent(new CustomEvent('ytaf-navigation-options'));
const list = key => { const value = configRead(key); return Array.isArray(value) ? value.filter(item => typeof item === 'string').slice(0, 100) : []; };

export function initNavigationPreferences() {
  if (initialized) return;
  initialized = true;
  const initialAccount = readAccountContext();
  let startupAccount = initialAccount.authenticated ? initialAccount.key : null;
  const currentAccount = () => {
    const state = readAccountContext();
    if (startupAccount && state.authenticated && state.key !== startupAccount) { startup.cancel(); return null; }
    if (!startupAccount && state.authenticated) startupAccount = state.key;
    return state.authenticated ? state.key : null;
  };
  const startup = createSubscriptionStartup({ enabled: () => configRead('startInSubscriptions'),
    getAccount: currentAccount,
    hasExternalLaunch: () => hasExternalTarget(window.launchParams),
    isLanding: () => {
      const panel = document.querySelector('.ytaf-ui-container');
      return isHomeLocation(window.location) && !/\bWEB_PAGE_TYPE_(?:WATCH|SHORTS|SEARCH|ACCOUNT_SELECTOR)\b/.test(document.body ? document.body.className : '') && !(panel && !panel.hidden && window.getComputedStyle(panel).display !== 'none');
    },
    getDispatcher: async () => { const registry = await ResolveCommandRegistry.getInstance(); return command => registry.dispatchCommand(command); },
    report(text) { startupMessage = text; changed(); } });
  let original = null, wrapped = null, installed = false, active = false;
  const configureHook = () => {
    active = !!(configRead('startInSubscriptions') || configRead('enableSidebarCustomization'));
    if (active && !installed) {
      original = window.JSON.parse;
      const previous = original;
      wrapped = function () {
        const result = previous.apply(this, arguments);
        if (!active || !guideSections(result).length) return result;
        catalog = guideCatalog(result); catalogAccount = readAccountContext().key;
        if (configRead('enableSidebarCustomization')) customizeGuide(result, { hidden: list('hiddenSidebarItems'), order: list('sidebarOrder'), hideChannels: configRead('hideSidebarChannels') });
        changed(); startup.consider(catalog);
        return result;
      };
      window.JSON.parse = wrapped; installed = true;
    } else if (!active && installed && window.JSON.parse === wrapped) {
      window.JSON.parse = original; installed = false;
    }
  };
  configureHook();
  configAddChangeListener('enableSidebarCustomization', () => { configureHook(); changed(); });
  configAddChangeListener('startInSubscriptions', () => { startup.cancel(); configureHook(); changed(); });
  for (const key of ['hiddenSidebarItems', 'sidebarOrder', 'hideSidebarChannels']) configAddChangeListener(key, changed);
  const navigation = () => {
    currentAccount();
    if (catalogAccount !== readAccountContext().key) { catalog = []; catalogAccount = null; changed(); }
  };
  window.addEventListener('ytaf-page-update', navigation);
  window.addEventListener('hashchange', () => startup.cancel());
  window.addEventListener('ytaf-settings-visibility', evt => { if (evt.detail?.visible) startup.cancel(); });
  const userInteraction = evt => { if (!evt[SYNTHETIC_KEY_FLAG]) startup.cancel(); };
  for (const type of ['keydown', 'mousedown', 'touchstart']) window.addEventListener(type, userInteraction, true);
  document.addEventListener('webOSRelaunch', () => startup.cancel(), true);
  window.addEventListener('pagehide', () => startup.cancel());
  if (configRead('startInSubscriptions')) {
    const deadline = Date.now() + 30000;
    const timer = window.setInterval(() => {
      if (Date.now() > deadline) { startup.cancel(); window.clearInterval(timer); return; }
      startup.consider();
    }, 1000);
  }
}
export function createNavigationControls() {
  initNavigationPreferences();
  const root = document.createElement('div'); root.id = 'ytaf-sidebar-controls';
  const status = document.createElement('div'); status.setAttribute('aria-live', 'polite');
  const rows = document.createElement('div');
  const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = 'Restore native sidebar'; reset.id = 'ytaf-sidebar-reset';
  reset.addEventListener('click', () => { configWrite('hiddenSidebarItems', []); configWrite('sidebarOrder', []); configWrite('hideSidebarChannels', false); });
  function ordered() {
    if (!configRead('enableSidebarCustomization') || catalogAccount !== readAccountContext().key) return [];
    const order = list('sidebarOrder');
    const rank = id => { const index = order.indexOf(id); return index === -1 ? order.length : index; };
    return catalog.map((entry, index) => ({ ...entry, index })).sort((a, b) => rank(a.id) - rank(b.id) || a.index - b.index);
  }
  function render() {
    const entries = ordered(), hidden = list('hiddenSidebarItems');
    const active = document.activeElement;
    const focusedId = active && active.getAttribute('data-guide-id'), focusedAction = active && active.getAttribute('data-guide-action');
    status.textContent = entries.length ? 'Visibility/order apply on the next native guide load. Reopen the app to apply them. At least one main link is preserved.' : 'Open the native sidebar to load its available links. Changes apply on the next guide load.';
    if (!configRead('enableSidebarCustomization')) status.textContent = 'Enable sidebar customization and reopen the app to load available links.';
    if (startupMessage) status.textContent += ' ' + startupMessage;
    while (rows.firstChild) rows.removeChild(rows.firstChild);
    for (const [index, entry] of entries.entries()) {
      const row = document.createElement('div');
      const label = document.createElement('span'); label.textContent = entry.title; row.appendChild(label);
      function button(action, text, callback, disabled = false) {
        const el = document.createElement('button'); el.type = 'button'; el.textContent = text; el.disabled = disabled;
        el.setAttribute('data-guide-id', entry.id); el.setAttribute('data-guide-action', action); el.addEventListener('click', callback); row.appendChild(el);
      }
      button('visible', hidden.indexOf(entry.id) === -1 ? 'Hide' : 'Show', () => {
        configWrite('hiddenSidebarItems', hidden.indexOf(entry.id) === -1 ? hidden.concat(entry.id) : hidden.filter(id => id !== entry.id));
      });
      const move = direction => {
        const ids = entries.map(item => item.id), destination = index + direction;
        if (destination < 0 || destination >= ids.length) return;
        ids.splice(index, 1); ids.splice(destination, 0, entry.id); configWrite('sidebarOrder', ids);
      };
      button('up', 'Move up', () => move(-1), index === 0);
      button('down', 'Move down', () => move(1), index === entries.length - 1);
      rows.appendChild(row);
    }
    if (focusedId) {
      const buttons = Array.from(rows.querySelectorAll('button'));
      const target = buttons.find(el => el.getAttribute('data-guide-id') === focusedId && el.getAttribute('data-guide-action') === focusedAction && !el.disabled) ||
        buttons.find(el => el.getAttribute('data-guide-id') === focusedId && !el.disabled);
      if (target) target.focus();
    }
  }
  root.appendChild(status); root.appendChild(rows); root.appendChild(reset);
  window.addEventListener('ytaf-navigation-options', render); render();
  return root;
}
