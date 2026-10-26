import {
  configAddChangeListener,
  configRead,
  configRemoveChangeListener,
} from '../config.js';
import { createDeArrowClient } from './network.js';
import { createDeArrowDomAdapter } from './dom.js';

let adapter = null;

export function initDeArrow() {
  if (adapter || !document.documentElement) return;
  const client = createDeArrowClient();
  adapter = createDeArrowDomAdapter({
    root:
      document.querySelector('ytlr-app') ||
      document.body ||
      document.documentElement,
    client,
    getMode: () => configRead('dearrowMode'),
  });
  const refresh = () => {
    if (configRead('dearrowMode') === 'off') client.clear();
    if (adapter) adapter.refresh();
  };
  configAddChangeListener('dearrowMode', refresh);
  window.addEventListener('ytaf-page-update', refresh);
  adapter.refresh();

  window.__ytafDeArrow = {
    refresh,
    destroy() {
      configRemoveChangeListener('dearrowMode', refresh);
      window.removeEventListener('ytaf-page-update', refresh);
      if (adapter) adapter.destroy();
      client.destroy();
      adapter = null;
    },
  };
}
