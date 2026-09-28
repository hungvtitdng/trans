'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatSrtTime, toSrt, toTxt } = require('../src/main/transcript');

test('định dạng giờ SRT', () => {
  assert.equal(formatSrtTime(0), '00:00:00,000');
  assert.equal(formatSrtTime(1234), '00:00:01,234');
  assert.equal(formatSrtTime(3723004), '01:02:03,004');
  assert.equal(formatSrtTime(-5), '00:00:00,000');
});

test('cue tính từ câu đầu tiên và không chồng lên nhau', () => {
  const t0 = 1_700_000_000_000;
  const entries = [
    { id: 1, time: t0, source: 'Hello.', translation: 'Xin chào.' },
    { id: 2, time: t0 + 2500, source: 'How are you?', translation: 'Bạn khoẻ không?' },
    { id: 3, time: t0 + 2500, source: 'Same time.' },
    { id: 4, time: t0 + 20000, source: 'Later.', translation: 'Sau đó.' },
  ];
  const srt = toSrt(entries);
  const times = [...srt.matchAll(/(\S+) --> (\S+)/g)].map((m) => [m[1], m[2]]);
  assert.equal(times[0][0], '00:00:00,000');
  assert.equal(times[0][1], '00:00:02,500');
  assert.equal(times[3][0], '00:00:20,000');
  // câu 3 kéo dài tối đa 7 giây, không tới câu 4
  assert.equal(times[2][1], '00:00:09,500');
  for (let i = 0; i + 1 < times.length; i++) {
    assert.ok(times[i][1] <= times[i + 1][0], `cue ${i + 1} chồng lên cue ${i + 2}`);
    assert.ok(times[i][0] <= times[i][1]);
  }
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:02,500\nXin chào\.\nHello\.\n/);
  assert.match(srt, /3\n00:00:02,500 --> 00:00:09,500\nSame time\.\n/);
  assert.equal(toSrt([]), '');
});

test('bản TXT đánh dấu dòng chưa dịch', () => {
  const txt = toTxt([
    { id: 1, time: Date.now(), source: 'Hello.', translation: 'Xin chào.' },
    { id: 2, time: Date.now(), source: 'Pending.' },
  ]);
  assert.match(txt, /^\[\d\d:\d\d:\d\d\] Hello\.\n→ Xin chào\./);
  assert.match(txt, /Pending\.\n→ \(chưa dịch\)$/);
});
