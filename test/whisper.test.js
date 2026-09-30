'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WhisperSession, toWav, cleanText } = require('../src/main/whisper');

// 100 ms PCM 16 kHz: to (biên độ 0,1) hoặc im lặng.
const loud = () => {
  const b = Buffer.alloc(3200);
  for (let i = 0; i < 1600; i++) b.writeInt16LE(i % 2 ? 3277 : -3277, i * 2);
  return b;
};
const quiet = () => Buffer.alloc(3200);
const tick = () => new Promise((r) => setImmediate(r));

function setup(texts) {
  const calls = [];
  const s = new WhisperSession({
    url: 'http://x',
    language: 'en',
    transcribe: async (_url, wav, lang) => {
      calls.push({ bytes: wav.length, lang });
      const t = texts.shift();
      if (t instanceof Error) throw t;
      return t;
    },
  });
  const events = [];
  s.on('final', (t) => events.push(['final', t]));
  s.on('error', (e) => events.push(['error', e.message]));
  s.on('stopped', () => events.push(['stopped']));
  s.start();
  return { s, calls, events };
}

test('chốt câu sau 700 ms im lặng, bỏ im lặng lúc đầu và nhãn [BLANK_AUDIO]', async () => {
  const { s, calls, events } = setup([' Hello [BLANK_AUDIO] world. ']);
  for (let i = 0; i < 20; i++) s.write(quiet()); // chưa ai nói: không gửi gì
  for (let i = 0; i < 5; i++) s.write(loud());
  for (let i = 0; i < 6; i++) s.write(quiet());
  assert.equal(calls.length, 0);
  s.write(quiet()); // đủ 700 ms im lặng
  await tick();
  assert.deepEqual(calls, [{ bytes: 44 + 12 * 3200, lang: 'en' }]);
  assert.deepEqual(events, [['final', 'Hello world.']]);
  assert.equal(s.audioMs, 3200);
});

test('tiếng động ngắn bị bỏ, câu quá dài bị cắt ở 12 giây', async () => {
  const { s, calls } = setup(['a']);
  s.write(loud());
  s.write(loud());
  for (let i = 0; i < 7; i++) s.write(quiet());
  assert.equal(calls.length, 0); // 200 ms < MIN_SPEECH_MS
  for (let i = 0; i < 120; i++) s.write(loud());
  await tick();
  assert.equal(calls.length, 1);
});

test('dừng thì gửi nốt câu dở; lỗi server thì phát error và dừng', async () => {
  const a = setup(['last words']);
  for (let i = 0; i < 5; i++) a.s.write(loud());
  a.s.stop();
  await tick();
  assert.deepEqual(a.events, [['stopped'], ['final', 'last words']]);

  const b = setup([new Error('down')]);
  for (let i = 0; i < 5; i++) b.s.write(loud());
  for (let i = 0; i < 7; i++) b.s.write(quiet());
  await tick();
  assert.deepEqual(b.events, [['error', 'down'], ['stopped']]);
  assert.equal(b.s.running, false);
});

test('toWav và cleanText', () => {
  const wav = toWav(Buffer.alloc(320));
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt32LE(40), 320);
  assert.equal(cleanText('(music) *laughs* Hi  there'), 'Hi there');
});

test('startServer chạy whisper-server với model và cổng, báo lỗi khi server tự thoát', { skip: process.platform === 'win32' }, async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { startServer } = require('../src/main/whisper');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-'));
  const model = path.join(dir, 'm.bin');
  fs.writeFileSync(model, '');
  fs.writeFileSync(path.join(dir, 'whisper-server'), '#!/bin/sh\necho "$@" > "$(dirname "$0")/args"\necho "failed to load model" >&2\nexit 3\n', { mode: 0o755 });
  const oldPath = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${oldPath}`;
  try {
    assert.equal(startServer({ model, url: 'http://10.0.0.5:8080', onExit() {} }), null);
    assert.throws(() => startServer({ model: path.join(dir, 'nope.bin'), url: 'http://127.0.0.1:8080' }), /model/);
    const msg = await new Promise((resolve) => startServer({ model, url: 'http://127.0.0.1:8123', onExit: resolve }));
    assert.match(msg, /mã 3.*failed to load model/);
    assert.equal(fs.readFileSync(path.join(dir, 'args'), 'utf8').trim(), `-m ${model} --host 127.0.0.1 --port 8123`);
  } finally {
    process.env.PATH = oldPath;
  }
});
