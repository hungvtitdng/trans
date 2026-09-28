'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { SttSession } = require('../src/main/stt');

class MockStream extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.writes = [];
    this.ended = false;
  }
  write(chunk) {
    this.writes.push(chunk);
  }
  end() {
    this.ended = true;
  }
}

function mockClient() {
  const client = {
    streams: [],
    closed: false,
    streamingRecognize(config) {
      const s = new MockStream(config);
      client.streams.push(s);
      return s;
    },
    close() {
      client.closed = true;
      return Promise.resolve();
    },
  };
  return client;
}

const interim = (text) => ({ results: [{ isFinal: false, alternatives: [{ transcript: text }] }] });
const final = (text) => ({ results: [{ isFinal: true, alternatives: [{ transcript: text }] }] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setup(opts = {}) {
  const client = mockClient();
  const session = new SttSession({ createClient: () => client, ...opts });
  const events = [];
  for (const type of ['interim', 'final', 'error', 'restart']) {
    session.on(type, (v) => events.push([type, type === 'error' ? v.code : v]));
  }
  session.start();
  return { client, session, events };
}

test('gửi đúng config và phát câu tạm, câu chốt', () => {
  const { client, session, events } = setup({ languageCode: 'en-GB', model: 'latest_short' });
  const cfg = client.streams[0].config;
  assert.equal(cfg.interimResults, true);
  assert.equal(cfg.config.encoding, 'LINEAR16');
  assert.equal(cfg.config.sampleRateHertz, 16000);
  assert.equal(cfg.config.enableAutomaticPunctuation, true);
  assert.equal(cfg.config.languageCode, 'en-GB');
  assert.equal(cfg.config.model, 'latest_short');

  client.streams[0].emit('data', interim('hello'));
  client.streams[0].emit('data', final('Hello world.'));
  assert.deepEqual(events, [
    ['interim', 'hello'],
    ['final', 'Hello world.'],
  ]);
  session.stop();
});

test('đếm thời lượng âm thanh: 3200 byte = 100 ms', () => {
  const { session } = setup();
  session.write(Buffer.alloc(3200));
  assert.equal(session.audioMs, 100);
  session.write(Buffer.alloc(3200 * 9));
  assert.equal(session.audioMs, 1000);
  session.stop();
});

test('tự đổi luồng khi hết thời gian, giữ câu tạm thành câu chốt, bỏ dữ liệu luồng cũ', async () => {
  const { client, session, events } = setup({ streamLimitMs: 30 });
  const first = client.streams[0];
  first.emit('data', interim('unfinished sentence'));
  await sleep(50);

  assert.equal(client.streams.length, 2);
  assert.equal(first.ended, true);
  assert.deepEqual(events, [
    ['interim', 'unfinished sentence'],
    ['final', 'unfinished sentence'],
    ['restart', undefined],
  ]);

  // Dữ liệu đến trễ từ luồng cũ bị bỏ qua.
  first.emit('data', final('late data'));
  first.emit('error', Object.assign(new Error('late'), { code: 3 }));
  assert.equal(events.length, 3);
  assert.equal(session.running, true);

  // Âm thanh ghi vào luồng mới nhất.
  const chunk = Buffer.alloc(3200);
  session.write(chunk);
  assert.equal(client.streams[1].writes.at(-1), chunk);
  assert.equal(first.writes.length, 0);
  session.stop();
});

test('lỗi mã 11 thì kết nối lại', () => {
  const { client, session, events } = setup();
  client.streams[0].emit('data', interim('keep me'));
  client.streams[0].emit('error', Object.assign(new Error('Exceeded maximum allowed stream duration'), { code: 11 }));
  assert.equal(client.streams.length, 2);
  assert.equal(session.running, true);
  assert.deepEqual(events, [
    ['interim', 'keep me'],
    ['final', 'keep me'],
    ['restart', undefined],
  ]);
  session.stop();
});

test('lỗi khác thì phát error và dừng', () => {
  const { client, session, events } = setup();
  client.streams[0].emit('error', Object.assign(new Error('bad key'), { code: 3 }));
  assert.equal(session.running, false);
  assert.equal(client.streams.length, 1);
  assert.equal(client.closed, true);
  assert.deepEqual(events, [['error', 3]]);
  session.write(Buffer.alloc(3200));
  assert.equal(session.audioMs, 0);
});
