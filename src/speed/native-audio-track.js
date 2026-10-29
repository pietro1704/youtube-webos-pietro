import { silentAacBase64 } from './silent-aac.js';
import { parseBoxes, parseInitInfo, demuxFragments } from './containers.js';

const RATE = 48000;
const FRAME = 1024;
let asset;
function silence(win) {
  if (asset) return asset;
  const raw = win.atob(silentAacBase64);
  const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
  const moof = parseBoxes(bytes, 0, bytes.length).find(box => box.type === 'moof');
  const samples = demuxFragments(bytes, parseInitInfo(bytes)).samples;
  asset = { init: bytes.slice(0, moof.start), frame: samples[1].data.slice() };
  return asset;
}
function box(type, ...parts) {
  const length = 8 + parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(length), view = new DataView(bytes.buffer);
  view.setUint32(0, length);
  for (let i = 0; i < 4; i++) bytes[4 + i] = type.charCodeAt(i);
  let offset = 8;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}
function words(...values) {
  const bytes = new Uint8Array(values.length * 4), view = new DataView(bytes.buffer);
  values.forEach((value, i) => { view.setUint32(i * 4, value); });
  return bytes;
}
// AAC-LC always decodes 1024 samples per packet. Align consecutive appends to
// that grid so native A/V buffering has no gaps at the WSOLA chunk boundaries.
export function silentFragment(frame, firstSample, count, sequence = 1) {
  const run = new Uint8Array(12 + count * 8), view = new DataView(run.buffer);
  view.setUint32(0, 0x301); // data offset + sample duration + sample size
  view.setUint32(4, count);
  for (let i = 0; i < count; i++) {
    view.setUint32(12 + i * 8, FRAME);
    view.setUint32(16 + i * 8, frame.length);
  }
  const header = () => box('moof', box('mfhd', words(0, sequence)),
    box('traf', box('tfhd', words(0x20000, 1)),
      box('tfdt', words(0x1000000, Math.floor(firstSample / 4294967296), firstSample % 4294967296)), box('trun', run)));
  view.setUint32(8, header().length + 8);
  const payload = new Uint8Array(count * frame.length);
  for (let i = 0; i < count; i++) payload.set(frame, i * frame.length);
  const moof = header(), mdat = box('mdat', payload), result = new Uint8Array(moof.length + mdat.length);
  result.set(moof); result.set(mdat, moof.length);
  return result;
}

/** Keep native audio in the VIDEO's MediaSource, rather than opening a second
 * native player that races the video for webOS decoder/output initialization.
 * Actual sound is still supplied by the WSOLA PCM media-stream output.
 */
export function createNativeAudioTrack({ win, mediaSource, addSourceBuffer, speed, onError }) {
  const buffer = addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
  const data = silence(win), queue = [], waiters = [];
  let active = false, closed = false, failed = false, sequence = 0, needsInit = false;
  function settle(ok) { for (const resolve of waiters.splice(0)) resolve(ok); }
  function fail(event) {
    if (closed || failed) return;
    failed = true; queue.length = 0; active = false; settle(false);
    onError(event instanceof Error ? event : new Error('Native audio track failed'));
  }
  function pump() {
    if (closed || failed || active) return;
    const job = queue.shift();
    if (!job) { settle(true); return; }
    active = true;
    try {
      if (job.data) buffer.appendBuffer(job.data);
      else buffer.remove(job.start, job.end);
    } catch (error) { fail(error); }
  }
  function updated() { if (buffer.updating) return; active = false; pump(); }
  function cancel() {
    queue.length = 0; settle(false); active = false; needsInit = true;
    if (buffer.updating && mediaSource.readyState === 'open') {
      try { buffer.abort(); } catch { /* source was detached */ }
    }
  }
  function destroy() {
    if (closed) return;
    closed = true; cancel();
    buffer.removeEventListener('updateend', updated);
    buffer.removeEventListener('error', fail);
    mediaSource.removeEventListener('sourceclose', destroy);
  }
  buffer.addEventListener('updateend', updated);
  buffer.addEventListener('error', fail);
  mediaSource.addEventListener('sourceclose', destroy);
  queue.push({ data: data.init }); pump();
  return { buffer, destroy, cancel,
    append(start, end) {
      if (closed || failed) return;
      const first = Math.max(0, Math.floor(start / speed * RATE / FRAME));
      const last = Math.ceil(end / speed * RATE / FRAME);
      if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first || last - first > 30000) {
        fail(new Error('Invalid native audio range')); return;
      }
      if (needsInit) { queue.push({ data: data.init }); needsInit = false; }
      for (let position = first; position < last; position += 4096) {
        queue.push({ data: silentFragment(data.frame, position * FRAME, Math.min(4096, last - position), ++sequence) });
      }
      pump();
    },
    remove(start, end) {
      if (closed || failed) return;
      queue.push({ start: start / speed, end: end / speed }); pump();
    },
    whenIdle() {
      if (closed || failed) return Promise.resolve(false);
      if (!active && !queue.length) return Promise.resolve(true);
      return new Promise(resolve => waiters.push(resolve));
    }
  };
}
