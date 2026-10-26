import { WsolaStretcher } from './wsola.js';

const DRIFT_WINDOW = 30;

export class AudioEngine {
  constructor({
    win,
    speed,
    leadS = 0.4,
    chunkS = 0.1,
    audioOffsetMs = 0,
    onError,
    createStretcher
  }) {
    this.win = win;
    this.speed = speed;
    this.leadS = leadS;
    this.chunkS = chunkS;
    this.audioOffsetMs = isFinite(audioOffsetMs) ? Math.max(-500, Math.min(500, Number(audioOffsetMs))) : 0;
    this.outputLatencyS = 0;
    this.onError = onError;
    this.createStretcher =
      createStretcher ||
      (({ sampleRate, channels, speed: _speed }) =>
        new WsolaStretcher({
          sampleRate,
          channels,
          searchStep: 2,
          corrStep: 2
        }));

    this.ctx = new win.AudioContext();
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);

    this.chunks = [];
    this.pcm = [];

    this.video = null;
    this.decoder = null;
    this.cfg = null;
    this.configureId = 0;
    this.configPending = false;
    this.recoveryNeeded = false;
    this.recoveries = [];
    this.decodeGen = 0;
    this.sentToDecoder = new Set();
    this.failed = false;
    this.decodedFrames = 0;
    this.scheduledFrames = 0;
    this.lastPcmPeak = 0;

    this.stretcher = null;
    this.stretcherRate = null;
    this.stretcherChannels = null;

    this.nextWhen = 0;
    this.inPos = 0;

    this.sources = new Set();

    this.volume = 1;
    this.muted = false;

    this.lastVideoTime = -1;
    this.anchorPending = false;
    this.stalledTicks = 0;

    this.tickInterval = this.win.setInterval(() => this.tick(), 50);

    this.onPause = () => {
      // Pause must be silent at once: stop everything, including the buffer
      // that is playing right now, and re-anchor on the next real movement.
      this.stopFuture();
      this.stretcher = null;
      this.anchorPending = false;
      this.stalledTicks = 0;
    };
    this.onWaiting = () => {
      this.stopFuture();
      this.stretcher = null;
      this.anchorPending = true;
      this.stalledTicks = 0;
    };
    this.onSeeking = () => {
      this.stopFuture();
      this.stretcher = null;
      this.anchorPending = false;
      this.stalledTicks = 0;
      this.decodeGen++;
      this.sentToDecoder.clear();
      if (this.decoder && this.decoder.state === 'configured') {
        this.decoder.reset();
        this.decoder.configure(this.cfg);
      }
    };
    this.onPlaying = () => {
      this.lastVideoTime = this.video.currentTime;
      this.anchorPending = true;
      this.stalledTicks = 0;
    };
  }

  attachVideo(el) {
    this.video = el;
    this.video.addEventListener('pause', this.onPause);
    this.video.addEventListener('waiting', this.onWaiting);
    this.video.addEventListener('seeking', this.onSeeking);
    this.video.addEventListener('playing', this.onPlaying);
    this.lastVideoTime = this.video.currentTime;
    if (!this.video.paused) this.anchorPending = true;
  }

  setVolume(v, muted) {
    this.volume = v;
    this.muted = muted;
    this.gain.gain.value = muted ? 0 : v;
  }

  outputLatencySeconds() {
    let delay = (Number(this.ctx.baseLatency) || 0) + (Number(this.ctx.outputLatency) || 0);
    try {
      if (typeof this.ctx.getOutputTimestamp === 'function' && this.win.performance) {
        const stamp = this.ctx.getOutputTimestamp();
        const elapsed = (this.win.performance.now() - stamp.performanceTime) / 1000;
        const measured = this.ctx.currentTime - (stamp.contextTime + elapsed);
        if (stamp.contextTime > 0 && stamp.performanceTime > 0 && elapsed >= 0 && elapsed < 2 && isFinite(measured) && measured >= 0 && measured <= 1) delay = measured;
      }
    } catch { /* old webOS exposes the API but may not implement it */ }
    this.outputLatencyS = isFinite(delay) ? Math.max(0, Math.min(1, delay)) : 0;
    return this.outputLatencyS;
  }

  setAudioOffsetMs(value) {
    const next = isFinite(value) ? Math.max(-500, Math.min(500, Number(value))) : 0;
    if (next === this.audioOffsetMs) return false;
    this.audioOffsetMs = next;
    this.stopFuture();
    this.stretcher = null;
    this.anchorPending = true;
    this.drifts = [];
    return true;
  }

  configure(cfg) {
    if (this.destroyed || this.failed) return;
    if (this.cfg && this.isSameCfg(this.cfg, cfg) &&
        (this.configPending || (this.decoder && this.decoder.state === 'configured'))) {
      return;
    }
    this.cfg = cfg;
    const configureId = ++this.configureId;
    this.configPending = true;
    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
    this.decoder = null;
    this.win.AudioDecoder.isConfigSupported(cfg)
      .then((res) => {
        // A newer configure() may have arrived while this check was pending:
        // only the latest configuration gets a decoder.
        if (this.configureId !== configureId || this.destroyed || this.failed) return;
        this.configPending = false;
        if (!res.supported) {
          this.reportError(
            Object.assign(new Error('Not supported'), {
              name: 'NotSupportedError'
            })
          );
          return;
        }
        const decoder = new this.win.AudioDecoder({
          output: (data) => {
            if (this.decoder !== decoder || this.destroyed) data.close();
            else this.onAudioData(data);
          },
          error: (e) => this.onDecoderError(decoder, e)
        });
        this.decoder = decoder;
        this.decoder.configure(cfg);
        this.decodeGen++;
        this.sentToDecoder.clear();
        this.pumpDecoder();
      })
      .catch((e) => {
        if (this.configureId !== configureId || this.destroyed) return;
        this.configPending = false;
        this.reportError(e);
      });
  }

  onDecoderError(decoder, error) {
    if (!decoder || this.destroyed || this.failed || this.decoder !== decoder) return;
    // Chromium may close a perfectly valid decoder while the app is paused or
    // in the background. Recreate it from the retained encoded archive when
    // playback actually needs data, rather than permanently falling back to 1x.
    if (error && error.name === 'QuotaExceededError') {
      const now = Date.now();
      this.recoveries = this.recoveries.filter(time => now - time < 30000);
      if (this.recoveries.length < 3) {
        this.recoveries.push(now);
        if (decoder.state !== 'closed') decoder.close();
        this.decoder = null;
        this.recoveryNeeded = true;
        this.stopFuture();
        this.stretcher = null;
        this.pcm = [];
        this.anchorPending = true;
        return;
      }
    }
    this.reportError(error);
  }

  isSameCfg(c1, c2) {
    if (!c1 || !c2) return false;
    if (
      c1.codec !== c2.codec ||
      c1.sampleRate !== c2.sampleRate ||
      c1.numberOfChannels !== c2.numberOfChannels
    )
      return false;
    if (
      (c1.description && !c2.description) ||
      (!c1.description && c2.description)
    )
      return false;
    if (c1.description) {
      if (c1.description.byteLength !== c2.description.byteLength) return false;
      for (let i = 0; i < c1.description.byteLength; i++) {
        if (c1.description[i] !== c2.description[i]) return false;
      }
    }
    return true;
  }

  push(chunks) {
    if (this.failed || this.destroyed) return;
    for (const c of chunks) {
      const ptsUs = Math.round(c.pts * 1e6);
      const durUs = Math.round(c.duration * 1e6);
      const eac = new this.win.EncodedAudioChunk({
        type: c.key ? 'key' : 'delta',
        timestamp: ptsUs,
        duration: durUs,
        data: c.data
      });
      // Sorted insert with binary search: YouTube keeps minutes of audio in the
      // archive, and a linear search + full sort per append grows quadratically.
      const entry = { pts: ptsUs, chunk: eac, dur: durUs };
      const i = this.lowerBound(ptsUs);
      if (i < this.chunks.length && this.chunks[i].pts === ptsUs)
        this.chunks[i] = entry;
      else this.chunks.splice(i, 0, entry);
    }
    this.pumpDecoder();
  }

  lowerBound(ptsUs) {
    let lo = 0;
    let hi = this.chunks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.chunks[mid].pts < ptsUs) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  discard(a, b) {
    // Audio already queued for WebAudio may carry the discarded content: stop it
    // and re-anchor, the anchor then skips the hole.
    if (this.stretcher && !this.anchorPending) {
      const queuedFrom =
        this.outContent -
        Math.max(0, this.nextWhen - this.ctx.currentTime) * this.speed;
      if (a < this.outContent && b > queuedFrom) {
        this.stopFuture();
        this.stretcher = null;
        this.anchorPending = true;
      }
    }
    const aUs = Math.round(a * 1e6);
    const bUs = Math.round(b * 1e6);
    this.chunks = this.chunks.filter((c) => {
      const cEnd = c.pts + c.dur;
      return !(cEnd > aUs && c.pts < bUs);
    });
    this.pcm = this.pcm.flatMap((p) => {
      const pEnd = p.t + p.n / p.rate;
      if (p.t >= b || pEnd <= a) return [p];
      const pieces = [];
      if (p.t < a) {
        const nBefore = Math.floor((a - p.t) * p.rate);
        if (nBefore > 0) {
          const chBefore = p.ch.map((c) => c.slice(0, nBefore));
          pieces.push({ t: p.t, n: nBefore, rate: p.rate, ch: chBefore });
        }
      }
      if (pEnd > b) {
        const nAfter = Math.floor((pEnd - b) * p.rate);
        const startIdx = p.n - nAfter;
        if (nAfter > 0) {
          const chAfter = p.ch.map((c) => c.slice(startIdx));
          pieces.push({
            t: p.t + startIdx / p.rate,
            n: nAfter,
            rate: p.rate,
            ch: chAfter
          });
        }
      }
      return pieces;
    });
  }

  reset() {
    this.stopFuture();
    this.stretcher = null;
    this.anchorPending = !!this.video && !this.video.paused;
    this.chunks = [];
    this.pcm = [];
    this.sentToDecoder.clear();
    this.decodeGen++;
    if (this.decoder && this.decoder.state === 'configured') {
      this.decoder.reset();
      this.decoder.configure(this.cfg);
    }
  }

  destroy() {
    this.destroyed = true;
    this.win.clearInterval(this.tickInterval);
    if (this.video) {
      this.video.removeEventListener('pause', this.onPause);
      this.video.removeEventListener('waiting', this.onWaiting);
      this.video.removeEventListener('seeking', this.onSeeking);
      this.video.removeEventListener('playing', this.onPlaying);
    }
    this.stopFuture();
    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
    if (this.ctx.state !== 'closed') this.ctx.close();
  }

  reportError(e) {
    if (this.failed || this.destroyed) return;
    this.failed = true;
    if (this.onError) {
      this.onError(e);
    }
  }

  onAudioData(data) {
    if (this.failed || this.destroyed) {
      data.close();
      return;
    }
    const t = data.timestamp / 1e6;
    const rate = data.sampleRate;
    const n = data.numberOfFrames;
    const chs = [];
    for (let i = 0; i < data.numberOfChannels; i++) {
      const buf = new Float32Array(n);
      data.copyTo(buf, { planeIndex: i, format: 'f32-planar' });
      chs.push(buf);
    }
    data.close();
    this.decodedFrames += n;

    this.pcm.push({ t, n, rate, ch: chs });
    this.pcm.sort((a, b) => a.t - b.t);
  }

  pumpDecoder() {
    if (this.destroyed || this.failed || !this.video) return;
    if (this.recoveryNeeded && !this.video.paused && !this.configPending &&
        this.chunks.some(c => c.pts + c.dur >= this.video.currentTime * 1e6 &&
          c.pts <= (this.video.currentTime + 3) * 1e6)) {
      this.recoveryNeeded = false;
      this.configure(this.cfg);
    }
    if (!this.decoder || this.decoder.state !== 'configured' || this.failed)
      return;
    if (!this.video) return;

    const currT = this.video.currentTime;
    const outputLead = this.outputLatencySeconds() + Math.max(0, this.audioOffsetMs / 1000);
    const decodeAhead = Math.max(3, (outputLead + this.leadS + this.chunkS + 0.1) * Math.max(1, this.speed));
    const endT = currT + decodeAhead;

    const currUs = Math.round(currT * 1e6);
    const endUs = Math.round(endT * 1e6);

    for (
      let i = this.lowerBound(currUs - 100000);
      i < this.chunks.length;
      i++
    ) {
      const c = this.chunks[i];
      if (c.pts > endUs) break;
      const key = `${this.decodeGen}:${c.pts}`;
      if (!this.sentToDecoder.has(key)) {
        this.sentToDecoder.add(key);
        const decoder = this.decoder;
        try {
          decoder.decode(c.chunk);
        } catch (error) {
          this.onDecoderError(decoder, error);
          return;
        }
        if (this.decoder !== decoder || this.failed || this.destroyed) return;
      }
    }
  }

  stopFuture() {
    const nowCtx = this.ctx.currentTime;
    for (const s of this.sources) {
      try {
        s.node.stop(nowCtx);
      } catch {
        /* already stopped */
      }
    }
    this.sources.clear();
  }

  tick() {
    if (this.failed || this.destroyed || !this.video) return;
    this.prunePcm(
      Math.min(this.video.currentTime, this.stretcher ? this.inPos : Infinity) -
        2
    );
    this.pumpDecoder();

    const nowCtx = this.ctx.currentTime;
    const currT = this.video.currentTime;
    // currentTime describes the rendering clock, ahead of the sound arriving at
    // the output device. Select content for its audible presentation time.
    // Positive user offsets advance content to compensate external receiver lag.
    const advance = this.outputLatencySeconds() + this.audioOffsetMs / 1000;

    if (this.video.paused) {
      this.lastVideoTime = currT;
      this.stalledTicks = 0;
      return;
    }

    const delta = currT - this.lastVideoTime;
    // Only treat small forward advances as real frame movement; a large jump
    // (0 -> 120s during loadVideoById seek) is a seek, not frames moving yet.
    const moving = delta > 0 && delta < 0.5 * Math.max(1, this.speed);

    if (this.anchorPending && moving) {
      this.anchorPending = false;
      this.stalledTicks = 0;
      this.nextWhen = nowCtx + 0.03;
      this.outContent = currT + (this.nextWhen - nowCtx + advance) * this.speed;
      this.inPos = this.outContent;
      this.stretcher = null;
      this.drifts = [];
    }
    this.lastVideoTime = currT;

    if (this.anchorPending) return;

    // If the video clock is frozen (buffering/stalled without firing 'pause'),
    // stop queued audio and re-anchor once frames move again instead of letting
    // drift exceed 0.5s and looping the same ~0.5s audio snippet over and over.
    if (delta === 0) {
      this.stalledTicks = (this.stalledTicks || 0) + 1;
      if (this.stalledTicks >= 4) {
        this.stopFuture();
        this.stretcher = null;
        this.anchorPending = true;
        this.drifts = [];
        return;
      }
    } else {
      this.stalledTicks = 0;
    }

    const predictedT = currT + (this.nextWhen - nowCtx + advance) * this.speed;
    const drift = this.outContent - predictedT;
    const starving = this.nextWhen <= nowCtx;

    // The TV's audio clock advances in steps (measured on an LG OLED C4, webOS 24): a single
    // drift reading saw-tooths by ±60 ms (period ~200 ms, mean ~0) even when
    // audio and video are aligned. Reacting to single readings stopped and
    // restarted all queued audio about every 200 ms, and a short median still
    // made soft corrections chase the noise (+34/-34 ms back and forth). So:
    // - a real jump (seek without events, stall) is one reading beyond 500 ms, or
    //   two in a row beyond 250 ms on the same side (the noise stays under ~90 ms):
    //   hard resync;
    // - otherwise only the MEAN of ~1.5 s of readings counts, at most one soft
    //   correction every 1.5 s, and only 70% of it (damped, never oscillating).
    this.drifts = this.drifts || [];
    this.drifts.push(drift);
    if (this.drifts.length > DRIFT_WINDOW) this.drifts.shift();
    const last2 = this.drifts.slice(-2);
    const jumped =
      Math.abs(drift) > 0.5 ||
      (last2.length === 2 &&
        last2.every((d) => Math.abs(d) > 0.25) &&
        last2[0] * last2[1] > 0);

    if (jumped || starving) {
      this.stopFuture();
      this.sources.clear();
      this.nextWhen = nowCtx + 0.03;
      this.outContent = currT + (this.nextWhen - nowCtx + advance) * this.speed;
      this.inPos = this.outContent;
      this.stretcher = null;
      this.drifts = [];
      this.lastSoftFix = nowCtx;
    } else if (
      this.stretcher &&
      this.drifts.length >= DRIFT_WINDOW &&
      nowCtx - (this.lastSoftFix || 0) >= 1.5
    ) {
      const mean = this.drifts.reduce((a, b) => a + b, 0) / this.drifts.length;
      if (Math.abs(mean) > 0.045) {
        this.softCorrect(0.7 * mean);
        this.lastSoftFix = nowCtx;
        this.drifts = [];
      }
    }

    while (this.nextWhen < nowCtx + this.leadS) {
      if (!this.stretcher) {
        let blockIdx = this.pcm.findIndex(
          (p) =>
            p.t <= this.inPos + 0.002 && p.t + p.n / p.rate > this.inPos - 0.002
        );
        if (blockIdx === -1) {
          blockIdx = this.pcm.findIndex((p) => p.t > this.inPos);
          if (blockIdx === -1) break;
          const p = this.pcm[blockIdx];
          if (p.t - this.inPos > 0.1) break;
          this.inPos = p.t;
        }
        const b = this.pcm[blockIdx];
        this.stretcherRate = b.rate;
        this.stretcherChannels = b.ch.length;
        this.stretcher = this.createStretcher({
          sampleRate: b.rate,
          channels: b.ch.length,
          speed: this.speed
        });
        this.stretcher.setSpeed(this.speed);
      }

      const pcmToPush = this.extractPcm(this.inPos, this.chunkS * this.speed);
      if (!pcmToPush || pcmToPush.ch[0].length === 0) {
        break;
      }

      this.stretcher.push(pcmToPush.ch);
      this.inPos += pcmToPush.ch[0].length / this.stretcherRate;

      const avail = this.stretcher.available();
      if (avail > 0) {
        const toPull = Math.min(
          avail,
          Math.floor(this.chunkS * this.stretcherRate)
        );
        const pulled = this.stretcher.pull(toPull);
        if (pulled && pulled[0] && pulled[0].length > 0) {
          const len = pulled[0].length;
          const buf = this.ctx.createBuffer(
            this.stretcherChannels,
            len,
            this.stretcherRate
          );
          for (let c = 0; c < this.stretcherChannels; c++) {
            buf.copyToChannel(pulled[c], c);
          }
          this.scheduledFrames += len;
          this.lastPcmPeak = pulled.reduce((peak, channel) => {
            for (let i = 0; i < channel.length; i++) peak = Math.max(peak, Math.abs(channel[i]));
            return peak;
          }, 0);

          const node = this.ctx.createBufferSource();
          node.buffer = buf;
          node.connect(this.gain);
          node.start(this.nextWhen);

          const srcInfo = {
            node,
            when: this.nextWhen,
            dur: len / this.stretcherRate
          };
          this.sources.add(srcInfo);
          node.onended = () => this.sources.delete(srcInfo);

          this.nextWhen += len / this.stretcherRate;
          this.outContent += (len / this.stretcherRate) * this.speed;
        }
      }
    }
  }

  prunePcm(beforeT) {
    if (
      !this.pcm.length ||
      this.pcm[0].t + this.pcm[0].n / this.pcm[0].rate >= beforeT
    )
      return;
    this.pcm = this.pcm.filter((p) => p.t + p.n / p.rate >= beforeT);
    // Chunks whose audio was dropped must be decodable again if we come back.
    const cut = Math.round(beforeT * 1e6);
    for (const key of this.sentToDecoder) {
      const pts = Number(key.slice(key.indexOf(':') + 1));
      if (pts < cut) this.sentToDecoder.delete(key);
    }
  }

  softCorrect(drift) {
    if (drift > 0) {
      this.nextWhen += drift / this.speed;
      return;
    }
    const want = Math.round((-drift / this.speed) * this.stretcherRate);
    const n = Math.min(want, this.stretcher.available());
    if (n > 0) {
      this.stretcher.pull(n);
      this.outContent += (n / this.stretcherRate) * this.speed;
    }
    // Not enough output ready yet: skip the rest in the input instead.
    const rest = ((want - n) / this.stretcherRate) * this.speed;
    if (rest > 0) {
      this.inPos += rest;
      this.outContent += rest;
    }
  }

  extractPcm(startT, duration) {
    let requiredLen = Math.floor(duration * this.stretcherRate);
    let extracted = Array.from(
      { length: this.stretcherChannels },
      () => new Float32Array(requiredLen)
    );
    let written = 0;

    let currT = startT;
    for (const p of this.pcm) {
      if (written >= requiredLen) break;
      const pEndT = p.t + p.n / p.rate;
      if (pEndT < currT - 0.002) continue;
      if (p.t > currT + 0.002) {
        break;
      }
      const startIdx = Math.max(0, Math.round((currT - p.t) * p.rate));
      const rem = requiredLen - written;
      const toWrite = Math.min(rem, p.n - startIdx);
      if (toWrite <= 0) continue;

      for (let c = 0; c < this.stretcherChannels; c++) {
        extracted[c].set(
          p.ch[c].subarray(startIdx, startIdx + toWrite),
          written
        );
      }
      written += toWrite;
      currT += toWrite / p.rate;
    }

    if (written === 0) return null;
    if (written < requiredLen) {
      for (let c = 0; c < this.stretcherChannels; c++) {
        extracted[c] = extracted[c].subarray(0, written);
      }
    }
    return { ch: extracted };
  }
}
