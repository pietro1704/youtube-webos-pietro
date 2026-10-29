import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installMseHook, SpeedTimeMap } from '../src/speed/mse-hook.js';

class FakeSourceBuffer extends EventTarget {
  constructor() {
    super();
    this._timestampOffset = 0;
    this._appendWindowStart = 0;
    this._appendWindowEnd = Infinity;
    this._buffered = { length: 0, start: () => 0, end: () => 0 };
  }

  appendBuffer(data) {
    this.lastAppend = data;
    this.updating = true;
    Promise.resolve().then(() => { this.updating = false; this.dispatchEvent(new Event('updateend')); });
  }
  remove() {}

  get timestampOffset() {
    return this._timestampOffset;
  }
  set timestampOffset(value) {
    this._timestampOffset = value;
  }
  get appendWindowStart() {
    return this._appendWindowStart;
  }
  set appendWindowStart(value) {
    this._appendWindowStart = value;
  }
  get appendWindowEnd() {
    return this._appendWindowEnd;
  }
  set appendWindowEnd(value) {
    this._appendWindowEnd = value;
  }
  get buffered() {
    return this._buffered;
  }
}

class FakeMediaSource extends EventTarget {
  constructor() {
    super();
    this.readyState = 'open';
    this._buffers = [];
    this._duration = Number.NaN;
  }

  addSourceBuffer() {
    const buffer = new FakeSourceBuffer();
    this._buffers.push(buffer);
    return buffer;
  }

  get duration() {
    return this._duration;
  }
  set duration(value) {
    this._duration = value;
  }
  get sourceBuffers() {
    const buffers = this._buffers;
    return {
      length: buffers.length,
      item: (index) => buffers[index]
    };
  }
}

class FakeMediaElement extends EventTarget {
  constructor() {
    super();
    this._src = '';
    this._currentTime = 0;
    this._duration = 0;
    this._playbackRate = 1;
    this._buffered = { length: 0, start: () => 0, end: () => 0 };
    this._seekable = { length: 0, start: () => 0, end: () => 0 };
  }

  get src() {
    return this._src;
  }
  set src(value) {
    this._src = value;
  }
  get currentTime() {
    return this._currentTime;
  }
  set currentTime(value) {
    this._currentTime = value;
  }
  get duration() {
    return this._duration;
  }
  get playbackRate() {
    return this._playbackRate;
  }
  set playbackRate(value) {
    this._playbackRate = value;
  }
  get buffered() {
    return this._buffered;
  }
  get seekable() {
    return this._seekable;
  }
}

function makeWindow() {
  const urls = new Map();
  let nextUrl = 1;
  return {
    MediaSource: FakeMediaSource,
    HTMLMediaElement: FakeMediaElement,
    EventTarget,
    Event,
    atob,
    URL: {
      createObjectURL(object) {
        const url = `blob:test-${nextUrl++}`;
        urls.set(url, object);
        return url;
      }
    }
  };
}

function installAt(speed, rateRequests = []) {
  const win = makeWindow();
  const hook = installMseHook(win, {
    getSpeed: () => speed,
    createAudioSink: () => ({
      configure() {},
      push() {},
      discard() {},
      reset() {}
    }),
    onRateRequest: (rate) => rateRequests.push(rate),
    onError: (error) => {
      throw error;
    }
  });
  return { win, hook };
}

test('1.5x maps the hardware timeline while the physical rate stays 1x', () => {
  const rateRequests = [];
  const { win, hook } = installAt(1.5, rateRequests);
  const mediaSource = new win.MediaSource();
  const video = new win.HTMLMediaElement();
  video.src = win.URL.createObjectURL(mediaSource);
  mediaSource.addSourceBuffer('video/mp4; codecs="avc1.4d401f"');

  video._currentTime = 4;
  assert.equal(video.currentTime, 6);
  assert.equal(video.playbackRate, 1.5);
  assert.equal(video._playbackRate, 1);

  video.playbackRate = 2;
  assert.deepEqual(rateRequests, [2]);
  assert.equal(video._playbackRate, 1);
  hook.uninstall();
});

test('1x leaves the native media element and SourceBuffer untouched', () => {
  const { win, hook } = installAt(1);
  const mediaSource = new win.MediaSource();
  const video = new win.HTMLMediaElement();
  video.src = win.URL.createObjectURL(mediaSource);
  const buffer = mediaSource.addSourceBuffer('video/mp4; codecs="avc1"');

  assert.equal(Object.hasOwn(video, 'currentTime'), false);
  assert.equal(Object.hasOwn(video, 'playbackRate'), false);
  assert.equal(Object.getPrototypeOf(buffer), FakeSourceBuffer.prototype);
  hook.uninstall();
});

test('unsupported speeds fail before a broken timeline can be installed', () => {
  assert.throws(() => new SpeedTimeMap(3), /Unsupported speed/);
});

test('a reused video retains its shim when the next MediaSource is buffered before src assignment', () => {
  const { win, hook } = installAt(1.5);
  const video = new win.HTMLMediaElement();
  const first = new win.MediaSource();
  video.src = win.URL.createObjectURL(first);
  first.addSourceBuffer('video/mp4; codecs="avc1"');
  video._currentTime = 4;
  assert.equal(video.currentTime, 6);
  const second = new win.MediaSource();
  second.addSourceBuffer('video/mp4; codecs="avc1"');
  video.src = win.URL.createObjectURL(second);
  assert.equal(video.currentTime, 6);
  assert.equal(video.playbackRate, 1.5);
  hook.uninstall();
});

test('audio buffer events retain native EventTarget identity', async () => {
  const { win, hook } = installAt(1.5);
  const ms = new win.MediaSource();
  const buffer = ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
  assert.ok(buffer instanceof win.EventTarget);
  let target = null;
  buffer.addEventListener('updateend', event => { target = event.target; });
  buffer.appendBuffer(new Uint8Array());
  for (let i = 0; i < 4; i++) await Promise.resolve();
  assert.equal(target, buffer);
  assert.equal(buffer.updating, false);
  hook.uninstall();
});

test('accelerated native audio belongs to the video MediaSource without a second player', async () => {
  const win = makeWindow();
  let options, sinks = 0, releases = 0;
  const hook = installMseHook(win, {
    getSpeed: () => 2,
    createAudioSink(value) { options = value; sinks++; return { configure() {}, push() {}, reset() {}, discard() {} }; },
    onRateRequest() {}, onError(error) { throw error; }, onNativeAudio() { releases++; }
  });
  try {
    const ms = new win.MediaSource();
    const video = ms.addSourceBuffer('video/mp4; codecs="avc1.4d401f"');
    const audio = ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
    assert.equal(ms._buffers.length, 2, 'video and silent native audio must share one MediaSource');
    assert.equal(options.createNativeAudioSource, undefined, 'no competing native player');
    assert.equal(ms.sourceBuffers.length, 2, 'internal audio must not leak as a third player buffer');
    assert.equal(ms.sourceBuffers.item(0), video);
    assert.equal(ms.sourceBuffers.item(1), audio);
    assert.notEqual(ms.sourceBuffers.item(1), ms._buffers[1]);
    assert.equal(sinks, 1);
    assert.equal(releases, 0);
    await Promise.resolve();
  } finally { hook.uninstall(); }
});


test('an audio sink buffered before src assignment is bound to the actual video when attached', () => {
  const win = makeWindow(), attached = [];
  const hook = installMseHook(win, { getSpeed: () => 2, onRateRequest() {}, onError(error) { throw error; },
    createAudioSink: () => ({ configure() {}, push() {}, reset() {}, discard() {}, attachVideo(element) { attached.push(element); } }) });
  try {
    const ms = new win.MediaSource();
    ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
    assert.deepEqual(attached, []);
    const video = new win.HTMLMediaElement(); video.src = win.URL.createObjectURL(ms);
    assert.deepEqual(attached, [video], 'the decoding sink must not remain unbound during autoplay');
  } finally { hook.uninstall(); }
});

test('closing a source cancels pending updates and rejects later writes to its sink', async () => {
  const { win, hook } = installAt(2);
  try {
    const ms = new win.MediaSource();
    const buffer = ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
    buffer.appendBuffer(new Uint8Array());
    ms.dispatchEvent(new Event('sourceclose'));
    let late = 0;
    buffer.addEventListener('updateend', () => late++);
    await Promise.resolve(); await Promise.resolve();
    assert.equal(buffer.updating, false);
    assert.equal(late, 0);
    for (const write of [() => buffer.appendBuffer(new Uint8Array()), () => buffer.remove(0, 1), () => buffer.changeType('audio/webm')]) {
      assert.throws(write, { name: 'InvalidStateError' });
    }
  } finally { hook.uninstall(); }
});
