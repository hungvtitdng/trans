'use strict';

const { EventEmitter } = require('node:events');

// Google ngắt luồng streaming sau ~305 giây, nên chủ động mở luồng mới trước đó.
const DEFAULT_STREAM_LIMIT_MS = 4.5 * 60 * 1000;
// 4 = DEADLINE_EXCEEDED, 11 = OUT_OF_RANGE (hết thời lượng luồng), 14 = UNAVAILABLE.
const RECONNECT_CODES = new Set([4, 11, 14]);
const MAX_RECONNECTS_WITHOUT_DATA = 5;
const BYTES_PER_MS = 32; // 16000 mẫu/giây * 2 byte / 1000

class SttSession extends EventEmitter {
  constructor({ createClient, languageCode = 'en-US', model = 'latest_long', streamLimitMs = DEFAULT_STREAM_LIMIT_MS }) {
    super();
    this.createClient = createClient;
    this.languageCode = languageCode;
    this.model = model;
    this.streamLimitMs = streamLimitMs;
    this.running = false;
    this.generation = 0;
    this.stream = null;
    this.timer = null;
    this.interim = '';
    this.bytesSent = 0;
    this.reconnects = 0;
  }

  get audioMs() {
    return this.bytesSent / BYTES_PER_MS;
  }

  start() {
    if (this.running) return;
    this.client = this.createClient();
    this.running = true;
    this._open();
  }

  write(chunk) {
    if (!this.running || !this.stream) return;
    this.bytesSent += chunk.length;
    try {
      this.stream.write(chunk);
    } catch {
      // Luồng vừa đóng; gói tiếp theo sẽ vào luồng mới.
    }
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    this._flushInterim();
    this._closeCurrent();
    if (this.client && typeof this.client.close === 'function') {
      Promise.resolve(this.client.close()).catch(() => {});
    }
    this.emit('stopped');
  }

  _open() {
    const gen = ++this.generation;
    const stream = this.client.streamingRecognize({
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz: 16000,
        audioChannelCount: 1,
        languageCode: this.languageCode,
        enableAutomaticPunctuation: true,
        model: this.model,
      },
      interimResults: true,
    });
    stream.on('data', (data) => {
      if (gen === this.generation) this._onData(data);
    });
    stream.on('error', (err) => {
      if (gen === this.generation) this._onError(err);
    });
    this.stream = stream;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this._restart(), this.streamLimitMs);
  }

  _closeCurrent() {
    clearTimeout(this.timer);
    this.timer = null;
    const old = this.stream;
    this.stream = null;
    this.generation++; // bỏ qua mọi dữ liệu đến trễ từ luồng cũ
    if (old) {
      try {
        old.end();
      } catch {
        // đã đóng
      }
    }
  }

  _restart() {
    if (!this.running) return;
    this._flushInterim();
    this._closeCurrent();
    this._open();
    this.emit('restart');
  }

  _flushInterim() {
    const text = this.interim.trim();
    this.interim = '';
    if (text) this.emit('final', text);
  }

  _onData(data) {
    this.reconnects = 0;
    const results = (data && data.results) || [];
    if (!results.length) return;
    if (results[0].isFinal) {
      this.interim = '';
      const text = ((results[0].alternatives || [])[0] || {}).transcript || '';
      if (text.trim()) this.emit('final', text.trim());
      return;
    }
    const text = results.map((r) => ((r.alternatives || [])[0] || {}).transcript || '').join('');
    this.interim = text;
    if (text.trim()) this.emit('interim', text.trim());
  }

  _onError(err) {
    if (!this.running) return;
    if (RECONNECT_CODES.has(err && err.code) && this.reconnects < MAX_RECONNECTS_WITHOUT_DATA) {
      this.reconnects++;
      this._restart();
      return;
    }
    this.emit('error', err);
    this.stop();
  }
}

module.exports = { SttSession, DEFAULT_STREAM_LIMIT_MS };
