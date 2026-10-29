// Real browser geometry is essential: jsdom cannot detect a clipped flex page.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');
const bundle = fs.readFileSync(process.argv[2] || 'dist/webOSUserScripts/userScript.js');
const chrome = [process.env.CHROME_BIN, '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(p => p && fs.existsSync(p));
assert.ok(chrome, 'Set CHROME_BIN to an installed Chromium/Chrome binary');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ytaf-scroll-'));
const fixture = `<!doctype html><html><body><ytlr-app><button id="native">Native control</button></ytlr-app>
<script>
window.launchParams = '{}';
window.fetch = () => Promise.reject(new Error('offline fixture'));
localStorage.setItem('ytaf-configuration', JSON.stringify({enableAdBlock:false,enableSponsorBlock:false,
  enableReturnYouTubeDislike:false,enableAutoLogin:false,enableLegacyEmojiFix:false,dearrowMode:'off'}));
</script><script src="/bundle.js"></script></body></html>`;
let browser, socket;
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/bundle.js' ? bundle : fixture);
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = spawn(chrome, ['--headless', '--no-sandbox', '--disable-gpu', '--no-first-run',
    '--disable-background-networking', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let startupError = '';
  browser.stderr.on('data', data => { startupError = (startupError + data.toString()).slice(-8000); });
  browser.once('error', error => { startupError = error.message; });
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let n = 0; !fs.existsSync(portFile) && n < 300 && browser.exitCode === null; n++) await wait(100);
  assert.ok(fs.existsSync(portFile), 'headless browser started: ' + startupError);
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  let sequence = 0;
  const pending = new Map();
  socket.on('message', raw => {
    const message = JSON.parse(raw);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timed out')); }, 10000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const key = async (code, name) => {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: name, windowsVirtualKeyCode: code });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: name, windowsVirtualKeyCode: code });
  };
  for (const [width, height] of [[1280, 720], [1920, 1080], [3840, 2160]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await call('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port });
    for (let n = 0; n < 50 && !await evaluate('typeof window.ytaf_showOptionsPanel === "function"'); n++) await wait(100);
    await wait(300);
    await evaluate('document.getElementById("native").focus(); window.ytaf_showOptionsPanel(true)');
    await wait(100);
    const geometry = await evaluate(`(() => {
      const panel = document.querySelector('.ytaf-ui-container');
      const page = document.getElementById('ytaf-page-main');
      const rect = page.getBoundingClientRect();
      return {display:getComputedStyle(panel).display, bottom:rect.bottom, height:page.clientHeight,
        content:page.scrollHeight, panelBottom:panel.getBoundingClientRect().bottom};
    })()`);
    assert.ok(geometry.bottom <= height && geometry.panelBottom <= height,
      'settings page must fit the viewport: ' + JSON.stringify(geometry));
    assert.ok(geometry.content > geometry.height, 'long Main page must have a real scroll viewport');
    const headingTop = await evaluate('document.querySelector(".ytaf-ui-container h1").getBoundingClientRect().top');
    await evaluate('document.querySelector(\'.ytaf-tab-btn.active\').focus()');
    let reachedLast = false;
    for (let step = 0; step < 160; step++) {
      await key(40, 'ArrowDown');
      const state = await evaluate(`(() => {
        const page = document.getElementById('ytaf-page-main');
        const active = document.activeElement;
        const all = Array.from(page.querySelectorAll('input:not(:disabled),button:not(:disabled),.shortcut-control-row'))
          .filter(el => el.tabIndex !== -1 && getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length);
        const row = active.closest('label,.shortcut-control-row') || active;
        const r = row.getBoundingClientRect(), p = page.getBoundingClientRect();
        return {last:active === all[all.length-1], visible:r.top >= p.top-1 && r.bottom <= p.bottom+1,
          inPage:page.contains(active), text:row.textContent, scroll:page.scrollTop};
      })()`);
      assert.ok(!state.inPage || state.visible, 'focused row must be fully visible: ' + JSON.stringify(state));
      if (state.last) { reachedLast = true; assert.ok(state.scroll > 0); break; }
    }
    assert.ok(reachedLast, 'Down must reach the final setting without looping at the scroll boundary');
    assert.equal(await evaluate('document.querySelector(".ytaf-ui-container h1").getBoundingClientRect().top'), headingTop,
      'heading must stay fixed while settings scroll');
    if (process.env.YTAF_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.YTAF_SCREENSHOT_DIR, { recursive: true });
      const shot = await call('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(process.env.YTAF_SCREENSHOT_DIR, width + '.png'), Buffer.from(shot.data, 'base64'));
    }
    await key(38, 'ArrowUp');
    assert.ok(await evaluate('document.getElementById("ytaf-page-main").contains(document.activeElement)'), 'Up returns to preceding setting');
    await key(27, 'Escape');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".ytaf-ui-container")).display'), 'none');
    await evaluate('window.ytaf_showOptionsPanel(true)');
    await wait(100);
    // Mouse wheel must work as well as remote focus navigation.
    const point = await evaluate(`(() => {const p=document.getElementById('ytaf-page-main');p.scrollTop=0;
      const r=p.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    await call('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY: 400 });
    await wait(150);
    assert.ok(await evaluate('document.getElementById("ytaf-page-main").scrollTop > 0'), 'mouse wheel scrolls settings');
    for (let tab = 1; tab < 4; tab++) {
      const visible = await evaluate(`(() => {
        document.querySelectorAll('.ytaf-tab-btn')[${tab}].click();
        const page = Array.from(document.querySelectorAll('.ytaf-settings-page')).find(p => getComputedStyle(p).display !== 'none');
        const controls = Array.from(page.querySelectorAll('input:not(:disabled),button:not(:disabled),.shortcut-control-row'))
          .filter(el => el.tabIndex !== -1 && getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length);
        const last = controls[controls.length-1];
        last.focus();
        const r = (last.closest('label,.shortcut-control-row') || last).getBoundingClientRect();
        const p = page.getBoundingClientRect();
        return r.top >= p.top-1 && r.bottom <= p.bottom+1 && p.bottom <= innerHeight;
      })()`);
      assert.ok(visible, 'last setting is readable on tab ' + tab);
    }
    console.log('PASS settings scroll, remote reachability, focus visibility, close/reopen and wheel at ' + width + '×' + height);
  }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (socket) socket.close();
  if (browser && browser.exitCode === null) {
    browser.kill();
    await new Promise(resolve => browser.once('exit', resolve));
  }
  server.close();
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
