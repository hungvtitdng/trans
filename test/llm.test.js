'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ADAPTERS, TmuxCliTranslator } = require('../src/main/llm');
const translators = require('../src/main/translators');

// Translator với tmux giả: ghi lại lệnh tmux, test tự ghi kết quả vào out.jsonl.
function fakeTranslator(kind, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trans-llm-'));
  const calls = [];
  const t = new TmuxCliTranslator(ADAPTERS[kind], {
    dir,
    session: `test-${kind}`,
    bin: `/usr/bin/${kind}`,
    run: (args) => calls.push(args),
    pollMs: 5,
    ...opts,
  });
  t.start();
  const emit = (...objs) => fs.appendFileSync(t.outFile, objs.map((o) => (typeof o === 'string' ? o : JSON.stringify(o)) + '\n').join(''));
  const sent = () => fs.readFileSync(t.inFile, 'utf8').split('\n').filter(Boolean);
  return { t, calls, emit, sent };
}

test('claude: chạy một tiến trình trong tmux, kết quả về theo thứ tự', async () => {
  const { t, calls, emit, sent } = fakeTranslator('claude', { model: 'sonnet' });
  const newSession = calls.find((a) => a[0] === 'new-session');
  assert.ok(newSession.includes('test-claude'));
  assert.match(newSession.at(-1), /--input-format stream-json/);
  assert.match(newSession.at(-1), /--model 'sonnet'/);

  const a = t.translate('Good morning', 'en', 'vi');
  const b = t.translate('Next item', 'en', 'vi');
  const lines = sent().map((l) => JSON.parse(l));
  assert.equal(lines[0].message.content, '[English -> Vietnamese] Good morning');
  emit({ type: 'system', subtype: 'init' }, { type: 'result', subtype: 'success', result: 'Chào buổi sáng' });
  emit({ type: 'result', subtype: 'success', result: ' Mục tiếp theo \n' });
  assert.equal(await a, 'Chào buổi sáng');
  assert.equal(await b, 'Mục tiếp theo');
  assert.equal(t.chars, 0);
  assert.equal(t.interim, false);

  assert.equal(await t.translate('Good morning', 'en', 'vi'), 'Chào buổi sáng'); // cache
  assert.equal(sent().length, 2);
  t.stop();
  assert.deepEqual(calls.at(-1), ['kill-session', '-t', 'test-claude']);
});

test('claude: lỗi của CLI thành lỗi dịch, kèm dòng chữ cuối cùng', async () => {
  const { t, emit } = fakeTranslator('claude');
  const p = t.translate('Hello', 'en', 'vi');
  emit('Not logged in · Please run /login', { type: 'result', subtype: 'error_during_execution', is_error: true, result: '' });
  await assert.rejects(p, /Not logged in/);
  t.stop();
});

test('hết giờ không làm lệch thứ tự câu sau', async () => {
  const { t, emit } = fakeTranslator('claude', { timeoutMs: 20 });
  const slow = t.translate('one', 'en', 'vi');
  await assert.rejects(slow, /Quá thời gian/);
  const next = t.translate('two', 'en', 'vi');
  emit({ type: 'result', subtype: 'success', result: 'một (muộn)' }, { type: 'result', subtype: 'success', result: 'hai' });
  assert.equal(await next, 'hai');
  t.stop();
});

test('codex: mỗi câu một lần exec, dấu kết thúc chốt câu', async () => {
  const { t, calls, emit, sent } = fakeTranslator('codex');
  const cmd = calls.find((a) => a[0] === 'new-session').at(-1);
  assert.match(cmd, /while IFS= read -r line; do '\/usr\/bin\/codex' exec --json/);
  assert.match(cmd, /"\$line" <\/dev\/null/);
  assert.doesNotMatch(cmd, / -m /);

  const a = t.translate('Hello\nteam', 'en', 'vi');
  const b = t.translate('Bye', 'en', 'ja');
  assert.match(sent()[0], /from English to Vietnamese\. .*: Hello team$/);
  emit(
    { type: 'thread.started' },
    { type: 'item.completed', item: { type: 'error', message: 'Model metadata not found' } },
    { type: 'item.completed', item: { type: 'agent_message', text: 'Chào cả nhóm' } },
    { type: 'trans.end' },
  );
  emit({ type: 'turn.failed', error: { message: '{"error":{"message":"model not supported"}}' } }, { type: 'trans.end' });
  assert.equal(await a, 'Chào cả nhóm');
  await assert.rejects(b, /model not supported/);
  t.stop();
});

test('close() chờ câu đang dịch rồi mới tắt tmux', async () => {
  const { t, calls, emit } = fakeTranslator('claude');
  const p = t.translate('Hello', 'en', 'vi');
  t.close();
  assert.ok(!calls.some((a) => a[0] === 'kill-session' && calls.indexOf(a) > 0));
  emit({ type: 'result', subtype: 'success', result: 'Xin chào' });
  assert.equal(await p, 'Xin chào');
  assert.equal(t.timer, null);
  assert.deepEqual(calls.at(-1), ['kill-session', '-t', 'test-claude']);
});

test('registry: chỉ Google cần key, kind lạ quay về Google', () => {
  assert.equal(translators.get('google').needsKey, true);
  assert.equal(translators.get('claude').needsKey, false);
  assert.equal(translators.get('codex').needsKey, false);
  assert.equal(translators.get('nope'), translators.get('google'));
});
