const { applyChrome38Downgrade, UA, setUserAgent } = require('./chrome38-env.cjs');

function applyBundleEnvironment(win) {
  if (process.argv[3] === 'modern') {
    setUserAgent(win, UA.webos23);
    return [];
  }
  return applyChrome38Downgrade(win);
}

module.exports = { applyBundleEnvironment, UA, setUserAgent };
