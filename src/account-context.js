// Compare native YouTube TV identities in memory only; never copy credentials.
const accountTypes = ['CORE_ID', 'PERSONA_CHILD', 'UNICORN_LITE_PROFILE', 'FULL_UNICORN', 'SUPEX'];
const guestTypes = ['UNAUTHENTICATED_IDENTITY_TYPE_GUEST', 'UNAUTHENTICATED_IDENTITY_TYPE_GUEST_KID', 'UNAUTHENTICATED_IDENTITY_TYPE_INCOGNITO'];
export function readAccountContext(win = window) {
  const unknown = { key: null, authenticated: false };
  if (win.document.body && win.document.body.classList.contains('WEB_PAGE_TYPE_ACCOUNT_SELECTOR')) return unknown;
  try {
    const stored = win.localStorage.getItem('yt.leanback.default::last-identity-used');
    const wrapper = stored && win.JSON.parse(stored);
    const data = wrapper && (typeof wrapper.data === 'string' ? win.JSON.parse(wrapper.data) : wrapper.data);
    if (!data || typeof data !== 'object') return unknown;
    const type = data.identityType;
    if (guestTypes.indexOf(type) !== -1) return { key: win.JSON.stringify({ type }), authenticated: false };
    if (accountTypes.indexOf(type) === -1 || typeof data.effectiveObfuscatedGaiaId !== 'string' || !data.effectiveObfuscatedGaiaId) return unknown;
    // Matches the native client's credential-presence check. Tokens can rotate
    // without changing the active account; owner/delegation still isolate it.
    const authenticated = !!data.identityCredentials && typeof data.identityCredentials === 'object';
    const key = win.JSON.stringify({ type, effective: data.effectiveObfuscatedGaiaId,
      owner: data.ownerObfuscatedGaiaId, delegation: data.gaiaDelegationType, authenticated });
    return { key, authenticated };
  } catch { return unknown; }
}
