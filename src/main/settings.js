'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PREFS = {
  engine: 'google', // 'google' | 'whisper'
  whisperUrl: 'http://127.0.0.1:8080',
  whisperModel: '', // đường dẫn file ggml-*.bin; trống = người dùng tự chạy whisper-server
  model: 'latest_long',
  interimTranslate: true,
  speechPricePerMin: 0.016,
  translatePricePerMillion: 20,
  source: 'system',
  deviceId: '',
  speakerLang: 'en-US',
  targetLang: 'vi',
  textSize: 16, // cỡ chữ tiếng Anh (px); bản dịch to hơn 2px
};

// Lưu cài đặt vào settings.json (quyền 0600). Key được mã hoá bằng safeStorage;
// ra ngoài module này chỉ có bản tóm tắt, không bao giờ có key thật.
class SettingsStore {
  constructor(filePath, safeStorage) {
    this.filePath = filePath;
    this.safeStorage = safeStorage;
    this.data = { prefs: { ...DEFAULT_PREFS }, auth: null };
    try {
      const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      this.data.prefs = { ...DEFAULT_PREFS, ...saved.prefs };
      this.data.auth = saved.auth || null;
    } catch {
      // chưa có file hoặc file hỏng: dùng mặc định
    }
  }

  get prefs() {
    return { ...this.data.prefs };
  }

  setPrefs(partial) {
    for (const k of Object.keys(partial || {})) {
      if (k in DEFAULT_PREFS && typeof partial[k] === typeof DEFAULT_PREFS[k]) this.data.prefs[k] = partial[k];
    }
    this._save();
    return this.prefs;
  }

  setApiKey(apiKey) {
    apiKey = String(apiKey || '').trim();
    if (!apiKey) throw new Error('API key đang trống.');
    this._setAuth('apiKey', `API key …${apiKey.slice(-4)}`, { apiKey });
  }

  clearAuth() {
    this.data.auth = null;
    this._save();
  }

  // Chỉ main process dùng.
  getAuth() {
    const a = this.data.auth;
    if (!a) return null;
    const buf = Buffer.from(a.data, 'base64');
    const secret = JSON.parse(a.encrypted ? this.safeStorage.decryptString(buf) : buf.toString('utf8'));
    if (a.type === 'apiKey') return { apiKey: secret.apiKey };
    return {
      credentials: { client_email: secret.client_email, private_key: secret.private_key },
      projectId: secret.project_id || undefined,
    };
  }

  summary() {
    const a = this.data.auth;
    if (!a) return { configured: false };
    return { configured: true, type: a.type, label: a.label, encrypted: a.encrypted };
  }

  _setAuth(type, label, secret) {
    const json = JSON.stringify(secret);
    const encrypted = this.safeStorage.isEncryptionAvailable();
    const data = encrypted ? this.safeStorage.encryptString(json).toString('base64') : Buffer.from(json).toString('base64');
    this.data.auth = { type, label, encrypted, data };
    this._save();
  }

  _save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.chmodSync(this.filePath, 0o600);
  }
}

module.exports = { SettingsStore, DEFAULT_PREFS };
