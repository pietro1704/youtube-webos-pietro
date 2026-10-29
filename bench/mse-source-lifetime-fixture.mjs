// Separate process with exposed GC: assert reachability, without inspecting the
// hook's private maps or relying on browser memory accounting.
import assert from 'node:assert/strict';
import { installMseHook } from '../src/speed/mse-hook.js';

class MediaSource extends EventTarget { addSourceBuffer() {} }
class MediaElement { get src() { return this._src || ''; } set src(value) { this._src = value; } }
let sequence = 0;
const win = { MediaSource, HTMLMediaElement: MediaElement, EventTarget,
  URL: { createObjectURL: () => 'blob:' + ++sequence, revokeObjectURL() {} } };
const originalRevoke = win.URL.revokeObjectURL;
const hook = installMseHook(win, { getSpeed: () => 1 });
const references = [];
const persistentVideo = new MediaElement();
function retire(mode) {
  for (let i = 0; i < 100; i++) {
    const source = new MediaSource();
    references.push(new WeakRef(source));
    const url = win.URL.createObjectURL(source);
    persistentVideo.src = url;
    if (mode === 'revoke') win.URL.revokeObjectURL(url);
    if (mode === 'close') source.dispatchEvent(new Event('sourceclose'));
  }
}
async function collect() {
  for (let i = 0; i < 5; i++) {
    await new Promise(resolve => setImmediate(resolve));
    globalThis.gc();
  }
  assert.equal(references.filter(ref => ref.deref()).length, 0, 'retired MediaSources must be collectible');
  references.length = 0;
}
try {
  retire('revoke'); await collect();
  retire('close'); await collect();
  retire('uninstall'); hook.uninstall(); await collect();
  assert.equal(win.URL.revokeObjectURL, originalRevoke);
} finally { hook.uninstall(); }
