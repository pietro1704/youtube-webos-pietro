const assert = require('node:assert/strict');
const { boot } = require('./dependency-test.cjs');

const { win } = boot({ enableSponsorBlock: false });
try {
  const doc = win.document;
  const source = doc.createElement('button'); source.textContent = 'Native menu'; doc.body.appendChild(source);
  let hostBack = 0;
  const key = (code, target = doc.activeElement, repeat = false, type = 'keydown') => {
    const event = new win.KeyboardEvent(type, { bubbles: true, cancelable: true, keyCode: code, repeat });
    target.dispatchEvent(event); return event;
  };
  doc.addEventListener('keydown', event => { if ([27, 461].includes(event.keyCode)) hostBack++; });
  const panel = () => doc.querySelector('.ytaf-ui-container');
  const open = () => { source.focus(); win.ytaf_showOptionsPanel(true); assert.equal(panel().style.display, 'flex'); };
  const closed = () => {
    assert.equal(panel().style.display, 'none');
    assert.equal(doc.activeElement, source, 'focus returns to the native entry');
    assert.equal(doc.querySelector('.sb-segments-popup')?.classList.contains('visible'), false);
  };
  for (const code of [461, 27]) for (const tab of [0, 1, 2, 3]) for (const control of [false, true]) {
    open();
    const button = panel().querySelectorAll('.ytaf-tab-btn')[tab]; button.click(); button.focus();
    if (control) {
      const page = [...panel().querySelectorAll('.ytaf-settings-page')].find(el => el.style.display !== 'none');
      const target = page.querySelector('input:not(:disabled), .shortcut-control-row, button');
      assert.ok(target); target.focus();
    }
    assert.equal(key(code).defaultPrevented, true); closed();
    key(code, source, true); closed();
    assert.equal(hostBack, 0, 'dismiss key and held repeats cannot reach YouTube');
    key(code, source, false, 'keyup');
  }
  for (const code of [461, 27]) {
    open(); panel().querySelectorAll('.ytaf-tab-btn')[1].click();
    const popup = doc.querySelector('.sb-segments-popup'); popup.classList.add('visible');
    const row = doc.createElement('button'); popup.appendChild(row); row.focus();
    assert.equal(doc.activeElement, row, 'nested SponsorBlock popup participates in the focus trap');
    key(code); closed(); key(code, source, false, 'keyup');
    popup.removeChild(row);
  }
  // Explicit re-entry while open must preserve the original focus identity.
  open(); win.ytaf_showOptionsPanel(true); key(461); closed(); key(461, source, false, 'keyup');
  // The native entry can disappear while settings are open.
  open(); source.parentNode.removeChild(source); key(461);
  assert.equal(panel().style.display, 'none');
  assert.equal(panel().contains(doc.activeElement), false, 'no focus left in the hidden panel');
  assert.notEqual(doc.activeElement, source);
  key(461, doc.body, false, 'keyup');
  doc.body.appendChild(source);
  open(); source.disabled = true; key(27);
  assert.notEqual(doc.activeElement, source, 'disabled native entry is not restored');
  assert.equal(panel().contains(doc.activeElement), false);
  key(27, doc.body, false, 'keyup'); source.disabled = false;
  // A fresh press after dismissal belongs to YouTube again.
  key(461, doc.body); assert.equal(hostBack, 1);
  doc.body.appendChild(source); source.focus();
  let clock = win.Date.now(); win.Date.now = () => clock;
  for (const green of [404, 172]) {
    clock += 1000; key(green, source); assert.equal(panel().style.display, 'flex');
    clock += 1000; key(green); closed();
  }
  console.log('settings Back: LG/Escape across tabs and controls, nested popup, focus identity, repeats and green passed');
} finally { win.close(); }
