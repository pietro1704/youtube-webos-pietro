export function createSubscriptionStartup({ enabled, getAccount, isLanding, hasExternalLaunch, getDispatcher, report = () => {} }) {
  let generation = 0, pending = false, finished = false;
  let available = false;
  function cancel() { generation++; pending = false; finished = true; }
  async function consider(catalog) {
    if (catalog) available = catalog.some(item => item.id === 'FEsubscriptions');
    if (finished || pending || !enabled() || !available || !getAccount()) return false;
    if (hasExternalLaunch() || !isLanding()) { cancel(); return false; }
    const account = getAccount(), token = ++generation;
    pending = true;
    try {
      const dispatch = await getDispatcher();
      if (token !== generation || !enabled() || getAccount() !== account || !isLanding() || hasExternalLaunch()) return false;
      if (typeof dispatch !== 'function') throw new Error('Native navigation unavailable');
      await dispatch({ browseEndpoint: { browseId: 'FEsubscriptions' } });
      if (token !== generation) return false;
      finished = true; report('Requested Subscriptions'); return true;
    } catch { if (token === generation) { finished = true; report('Subscriptions could not be opened. Native startup preserved.'); } return false; }
    finally { if (token === generation) pending = false; }
  }
  return { consider, cancel, pending: () => pending };
}
export function isHomeLocation(location) {
  const hash = location.hash || '';
  if (['', '#/', '#/home'].indexOf(hash) !== -1) return true;
  if (hash.indexOf('#/browse?') !== 0) return false;
  const params = new URLSearchParams(hash.slice(9));
  return (params.get('c') || params.get('browseId')) === 'FEwhat_to_watch';
}

export function hasExternalTarget(params) {
  if (!params) return false;
  try {
    const data = typeof params === 'string' ? JSON.parse(params) : params;
    if (!data || typeof data !== 'object') return false;
    return ['contentTarget', 'target'].some(key => typeof data[key] === 'string' ? data[key].trim().length > 0 : !!data[key] && typeof data[key] === 'object') ||
      Object.keys(data).some(key => /cast|mdx|dial/i.test(key) && !!data[key]);
  } catch { return true; }
}
