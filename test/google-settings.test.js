'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTranslator, friendlyError, toTranslateLang } = require('../src/main/google');
const { SettingsStore } = require('../src/main/settings');

test('dịch có cache và đếm ký tự', async () => {
  let calls = 0;
  const client = {
    async translate(text, opts) {
      calls++;
      assert.equal(opts.format, 'text');
      return [`vi:${text}`];
    },
  };
  const tr = createTranslator({}, client);
  assert.equal(await tr.translate('Hello', 'en', 'vi'), 'vi:Hello');
  assert.equal(await tr.translate('Hello', 'en', 'vi'), 'vi:Hello');
  assert.equal(await tr.translate('Hello', 'en', 'en'), 'Hello');
  assert.equal(calls, 1);
  assert.equal(tr.chars, 5);
});

test('mã ngôn ngữ dịch', () => {
  assert.equal(toTranslateLang('en-US'), 'en');
  assert.equal(toTranslateLang('cmn-Hans-CN'), 'zh-CN');
  assert.equal(toTranslateLang('vi-VN'), 'vi');
});

test('lỗi Google được dịch sang tiếng Việt', () => {
  assert.match(friendlyError(new Error('API key not valid. Please pass a valid API key.')), /Key không hợp lệ/);
  assert.match(friendlyError({ code: 7, message: 'Cloud Speech-to-Text API has not been used in project 1 before or it is disabled.' }), /API chưa được bật/);
  assert.match(friendlyError({ code: 7, message: 'This API method requires billing to be enabled.' }), /thanh toán/);
  assert.match(friendlyError({ code: 7, message: 'Requests to this API speech.googleapis.com method are blocked.' }), /giới hạn/);
  assert.match(friendlyError({ code: 7, message: 'PERMISSION_DENIED: caller does not have permission' }), /thiếu quyền/);
  assert.match(friendlyError(new Error('getaddrinfo ENOTFOUND speech.googleapis.com')), /mạng/);
  assert.match(friendlyError(new Error('something odd')), /Lỗi từ Google: something odd/);
});

test('settings mã hoá key, quyền 0600, tóm tắt không lộ key', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'translator-'));
  const file = path.join(dir, 'settings.json');
  const fakeSafe = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`ENC(${s})`).map((b) => b ^ 0x5a),
    decryptString: (b) => Buffer.from(b.map((x) => x ^ 0x5a)).toString().slice(4, -1),
  };
  const store = new SettingsStore(file, fakeSafe);
  store.setApiKey('  AIzaSECRETx7Qk ');
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes('AIzaSECRET'));
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(store.summary(), { configured: true, type: 'apiKey', label: 'API key …x7Qk', encrypted: true });

  const reloaded = new SettingsStore(file, fakeSafe);
  assert.deepEqual(reloaded.getAuth(), { apiKey: 'AIzaSECRETx7Qk' });

  reloaded.setPrefs({ model: 'latest_short', textSize: 'x', bogus: 1 });
  assert.equal(reloaded.prefs.model, 'latest_short');
  assert.equal(reloaded.prefs.textSize, 16);
  assert.equal('bogus' in reloaded.prefs, false);

  reloaded.clearAuth();
  assert.deepEqual(reloaded.summary(), { configured: false });
  fs.rmSync(dir, { recursive: true, force: true });
});
