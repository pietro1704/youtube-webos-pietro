// Compare the app's own active-identity data in memory only. Never log or persist it.
export function readAccountContext(win = window) {
  if (win.document.body && win.document.body.classList.contains('WEB_PAGE_TYPE_ACCOUNT_SELECTOR')) return { key: null, authenticated: false };
  try {
    const stored = win.localStorage.getItem('yt.leanback.default::last-identity-used');
    const wrapper = stored && win.JSON.parse(stored);
    const data = wrapper && (typeof wrapper.data === 'string' ? win.JSON.parse(wrapper.data) : wrapper.data);
    if (!data || typeof data !== 'object' || typeof data.identityType !== 'string') return { key: null, authenticated: false };
    return { key: win.JSON.stringify(data), authenticated: data.identityType.indexOf('AUTHENTICATED_IDENTITY_TYPE_') === 0 };
  } catch { return { key: null, authenticated: false }; }
}
