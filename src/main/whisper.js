'use strict';

const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { splitSentences } = require('./stt');

const BYTES_PER_MS = 32; // 16000 mẫu/giây * 2 byte / 1000
// ponytail: VAD theo năng lượng, dễ nhầm khi nhạc nền to; nâng cấp bằng Silero VAD (tham số `vad` của whisper-server).
const SPEECH_RMS = 0.01;
const SILENCE_MS = 700; // im lặng bao lâu thì chốt câu
const MAX_MS = 12000; // câu dài quá thì cắt, tránh chờ lâu
const MIN_SPEECH_MS = 300; // ngắn hơn thì coi là tiếng động, bỏ

function rmsOf(pcm) {
  let sum = 0;
  const n = pcm.length >> 1;
  for (let i = 0; i < n; i++) {
    const v = pcm.readInt16LE(i * 2) / 32768;
    sum += v * v;
  }
  return n ? Math.sqrt(sum / n) : 0;
}

function toWav(pcm) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(16000, 24);
  h.writeUInt32LE(32000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

// Bỏ nhãn kiểu [BLANK_AUDIO], (music), *cười* mà Whisper hay sinh ra.
function cleanText(text) {
  return String(text || '')
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function httpTranscribe(url, wav, language) {
  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
  form.append('language', language);
  form.append('response_format', 'json');
  form.append('temperature', '0.0');
  form.append('suppress_nst', 'true');
  let res;
  try {
    res = await fetch(new URL('/inference', url), { method: 'POST', body: form });
  } catch {
    throw new Error(`Không kết nối được whisper-server tại ${url}. Hãy chạy whisper-server (xem docs/whisper.md) rồi thử lại.`);
  }
  if (!res.ok) throw new Error(`whisper-server báo lỗi ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).text;
}

// Cùng giao diện với SttSession: start/write/stop, audioMs, sự kiện final/error/stopped.
// Whisper không streaming: gom âm thanh tới khi người nói ngừng rồi gửi cả câu.
class WhisperSession extends EventEmitter {
  constructor({ url, language = 'en', transcribe = httpTranscribe }) {
    super();
    this.url = url;
    this.language = language;
    this.transcribe = transcribe;
    this.running = false;
    this.bytesSent = 0;
    this._reset();
    this.queue = Promise.resolve();
  }

  get audioMs() {
    return this.bytesSent / BYTES_PER_MS;
  }

  start() {
    this.running = true;
  }

  write(chunk) {
    if (!this.running) return;
    this.bytesSent += chunk.length;
    const ms = chunk.length / BYTES_PER_MS;
    const loud = rmsOf(chunk) >= SPEECH_RMS;
    if (!loud && !this.speechMs) return; // chưa ai nói: không giữ im lặng
    this.chunks.push(chunk);
    this.bufMs += ms;
    if (loud) {
      this.speechMs += ms;
      this.silentMs = 0;
    } else {
      this.silentMs += ms;
    }
    if (this.silentMs >= SILENCE_MS || this.bufMs >= MAX_MS) this._flush();
  }

  stop() {
    if (!this.running) return;
    this._flush();
    this.running = false;
    this.emit('stopped');
  }

  _reset() {
    this.chunks = [];
    this.bufMs = 0;
    this.speechMs = 0;
    this.silentMs = 0;
  }

  _flush() {
    const { chunks, speechMs } = this;
    this._reset();
    if (speechMs < MIN_SPEECH_MS) return;
    const wav = toWav(Buffer.concat(chunks));
    // Xếp hàng để câu ra đúng thứ tự.
    this.queue = this.queue.then(async () => {
      try {
        const text = cleanText(await this.transcribe(this.url, wav, this.language));
        for (const s of splitSentences(text)) this.emit('final', s);
      } catch (err) {
        if (!this.running) return;
        this.emit('error', err);
        this.stop();
      }
    });
  }
}

// App mở từ Finder không có PATH của shell, nên tìm thêm ở thư mục của Homebrew.
function findServerBin() {
  const name = process.platform === 'win32' ? 'whisper-server.exe' : 'whisper-server';
  const dirs = [...(process.env.PATH || '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin'];
  return dirs.map((d) => path.join(d, name)).find((f) => isFile(f));
}

function isFile(f) {
  try {
    return fs.statSync(f).isFile();
  } catch {
    return false;
  }
}

// Chạy whisper-server cho địa chỉ trên máy. Trả về null nếu địa chỉ là máy khác (người dùng tự chạy).
// onExit(message) được gọi khi server không chạy nổi hoặc tự thoát.
function startServer({ model, url, onExit }) {
  const u = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(u.hostname)) return null;
  const bin = findServerBin();
  if (!bin) throw new Error('Không tìm thấy whisper-server. Cài bằng "brew install whisper-cpp" (xem docs/whisper.md).');
  if (!isFile(model)) throw new Error(`Không thấy file model: ${model}`);
  const child = spawn(bin, ['-m', model, '--host', '127.0.0.1', '--port', u.port || '80'], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let tail = '';
  child.stderr.on('data', (d) => (tail = (tail + d).slice(-400)));
  child.on('error', (err) => onExit(`Không chạy được whisper-server: ${err.message}`));
  child.on('exit', (code) => {
    if (!child.killed) onExit(`whisper-server đã dừng (mã ${code}). ${tail.trim().split('\n').pop()}`);
  });
  return child;
}

module.exports = { WhisperSession, toWav, cleanText, startServer };
