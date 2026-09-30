import { AudioCapture, listInputDevices } from './audio.js';

const api = window.api;
const $ = (id) => document.getElementById(id);

const el = {
  pair: $('pair'),
  usage: $('usage'),
  status: $('status'),
  startBtn: $('startBtn'),
  settingsBtn: $('settingsBtn'),
  history: $('history'),
  sourceLine: $('sourceLine'),
  currentLine: $('currentLine'),
  meterFill: $('meterFill'),
  overlayBtn: $('overlayBtn'),
  errorBanner: $('errorBanner'),
  source: $('source'),
  device: $('device'),
  speakerLang: $('speakerLang'),
  targetLang: $('targetLang'),
  fontSize: $('fontSize'),
  list: $('transcriptList'),
  dialog: $('settingsDialog'),
  keySummary: $('keySummary'),
  apiKeyInput: $('apiKeyInput'),
  clearKeyBtn: $('clearKeyBtn'),
  toggleKeyBtn: $('toggleKeyBtn'),
  engine: $('engine'),
  whisperUrl: $('whisperUrl'),
  whisperStatus: $('whisperStatus'),
  model: $('model'),
  interimTranslate: $('interimTranslate'),
  speechPrice: $('speechPrice'),
  translatePrice: $('translatePrice'),
};

let platform = 'linux';
let running = false;
let busy = false;
let lastShownId = 0;
let shown = null; // câu dịch đang hiện ở trên cùng: { text, source }
const HISTORY_LIMIT = 200; // biên bản giữ đủ; ở đây chỉ để đọc lại gần
const rows = new Map();

const capture = new AudioCapture({
  onChunk: (pcm) => api.sendAudio(pcm),
  onLevel: (rms) => {
    el.meterFill.style.width = `${Math.min(100, Math.sqrt(rms) * 220)}%`;
  },
});

// ---------- Trạng thái chung ----------

function setStatus(state) {
  el.status.dataset.state = state;
  el.status.textContent = { idle: 'Sẵn sàng', listening: 'Đang nghe', error: 'Lỗi' }[state];
}

function showError(message) {
  el.errorBanner.textContent = message;
  el.errorBanner.hidden = false;
}

function hideError() {
  el.errorBanner.hidden = true;
}

function updatePair() {
  const from = el.speakerLang.value.startsWith('cmn') ? 'ZH' : el.speakerLang.value.split('-')[0].toUpperCase();
  const to = el.targetLang.value.split('-')[0].toUpperCase();
  el.pair.textContent = `${from} → ${to}`;
}

function setRunningUi(on) {
  running = on;
  el.startBtn.textContent = on ? 'Dừng' : 'Bắt đầu';
  el.startBtn.classList.toggle('running', on);
  for (const s of [el.source, el.device, el.speakerLang, el.targetLang]) s.disabled = on;
  if (!on) el.meterFill.style.width = '0';
}

const numberVi = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

async function refreshUsage() {
  const u = await api.getUsage();
  el.usage.textContent = `${numberVi.format(u.minutes)} phút · ≈ $${u.cost.toFixed(2)}`;
}

// ---------- Thiết bị ----------

async function refreshDevices(selected) {
  try {
    const devices = await listInputDevices();
    const current = selected ?? el.device.value;
    el.device.replaceChildren(new Option('Mặc định', ''));
    devices
      .filter((d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .forEach((d, i) => el.device.add(new Option(d.label || `Thiết bị ${i + 1}`, d.deviceId)));
    el.device.value = [...el.device.options].some((o) => o.value === current) ? current : '';
  } catch {
    // enumerateDevices lỗi: giữ "Mặc định"
  }
  updateDeviceEnabled();
}

function updateDeviceEnabled() {
  el.device.disabled = running || el.source.value === 'system';
}

// ---------- Bắt đầu / Dừng ----------

function clearExamples() {
  el.list.querySelectorAll('.example').forEach((li) => li.remove());
}

async function start() {
  hideError();
  const s = await api.getSettings();
  if (!s.summary.configured) {
    showError('Chưa có key Google Cloud. Hãy nhập key trong Cài đặt.');
    openSettings();
    return;
  }
  clearExamples();
  const res = await api.startSession({ speakerLang: el.speakerLang.value, targetLang: el.targetLang.value });
  if (res.error) {
    setStatus('error');
    showError(res.error);
    return;
  }
  setRunningUi(true);
  setStatus('listening');
  el.sourceLine.textContent = 'Đang nghe…';
  try {
    if (el.source.value !== 'system') await api.askMicAccess();
    await capture.start({ source: el.source.value, deviceId: el.device.value, platform });
    capture.onEnded(() => {
      if (running) stop('Thiết bị thu âm đã bị ngắt.');
    });
    if (el.source.value !== 'system') refreshDevices();
  } catch (err) {
    await stop(err.message);
  }
}

async function stop(errorMessage) {
  capture.stop();
  setRunningUi(false);
  updateDeviceEnabled();
  await api.stopSession();
  if (errorMessage) {
    setStatus('error');
    showError(errorMessage);
  } else {
    setStatus('idle');
  }
  refreshUsage();
}

el.startBtn.addEventListener('click', async () => {
  if (busy) return;
  busy = true;
  el.startBtn.disabled = true;
  try {
    if (running) await stop();
    else await start();
  } finally {
    busy = false;
    el.startBtn.disabled = false;
  }
});

// ---------- Phụ đề ----------

function addRow(id, time, text) {
  const li = document.createElement('li');
  const t = document.createElement('time');
  t.textContent = new Date(time).toLocaleTimeString('vi-VN', { hour12: false });
  const body = document.createElement('div');
  const src = document.createElement('p');
  src.className = 'src';
  src.textContent = text;
  const tr = document.createElement('p');
  tr.className = 'tr pending';
  tr.textContent = 'Đang dịch…';
  body.append(src, tr);
  li.append(t, body);
  el.list.append(li);
  rows.set(id, tr);
  const nearBottom = el.list.scrollHeight - el.list.scrollTop - el.list.clientHeight < 80;
  if (nearBottom) el.list.scrollTop = el.list.scrollHeight;
}

// Câu mới nhất ở trên. Khi đang cuộn xuống đọc câu cũ, trình duyệt tự giữ chỗ đang đọc (scroll anchoring).
function pushHistory({ text, source }) {
  const li = document.createElement('li');
  const tr = document.createElement('p');
  tr.className = 'tr';
  tr.textContent = text;
  const src = document.createElement('p');
  src.className = 'src';
  src.textContent = source;
  li.append(tr, src);
  el.history.prepend(li);
  while (el.history.children.length > HISTORY_LIMIT) el.history.lastElementChild.remove();
}

function commitShown() {
  if (shown) pushHistory(shown);
  shown = null;
}

api.onCaption((msg) => {
  switch (msg.type) {
    case 'interim':
      el.sourceLine.textContent = msg.text;
      break;
    case 'interimTranslation':
      // Câu mới bắt đầu thế chỗ dòng vàng: đẩy câu vừa xong xuống lịch sử ngay, không để nó biến mất.
      commitShown();
      el.currentLine.textContent = msg.text;
      el.currentLine.classList.add('interim');
      break;
    case 'final':
      el.sourceLine.textContent = msg.text;
      addRow(msg.id, msg.time, msg.text);
      break;
    case 'translated': {
      const tr = rows.get(msg.id);
      if (tr) {
        tr.className = 'tr';
        tr.textContent = msg.text;
      }
      if (msg.id > lastShownId) {
        lastShownId = msg.id;
        commitShown();
        shown = { text: msg.text, source: tr ? tr.previousElementSibling.textContent : '' };
        el.currentLine.textContent = msg.text;
        el.currentLine.classList.remove('interim');
      }
      break;
    }
    case 'translateError': {
      const tr = rows.get(msg.id);
      if (tr) {
        tr.className = 'tr failed';
        tr.textContent = `Không dịch được: ${msg.message}`;
      }
      break;
    }
    case 'error':
      if (running) stop(msg.message);
      else showError(msg.message);
      break;
    case 'status':
      if (!msg.running && running) stop();
      break;
  }
});

// ---------- Điều khiển ----------

function applyFontSize(px) {
  document.documentElement.style.setProperty('--text-size', `${px}px`);
}

el.source.addEventListener('change', () => {
  updateDeviceEnabled();
  api.setPrefs({ source: el.source.value });
});
el.device.addEventListener('change', () => api.setPrefs({ deviceId: el.device.value }));
el.speakerLang.addEventListener('change', () => {
  updatePair();
  api.setPrefs({ speakerLang: el.speakerLang.value });
});
el.targetLang.addEventListener('change', () => {
  updatePair();
  api.setPrefs({ targetLang: el.targetLang.value });
});
el.fontSize.addEventListener('input', () => applyFontSize(el.fontSize.value));
el.fontSize.addEventListener('change', () => api.setPrefs({ textSize: Number(el.fontSize.value) }));
navigator.mediaDevices.addEventListener('devicechange', () => refreshDevices());

el.overlayBtn.addEventListener('click', async () => {
  const open = await api.toggleOverlay();
  el.overlayBtn.setAttribute('aria-pressed', String(open));
});
api.onOverlayState((open) => el.overlayBtn.setAttribute('aria-pressed', String(open)));

// ---------- Biên bản ----------

function flash(button, text) {
  const old = button.textContent;
  button.textContent = text;
  setTimeout(() => (button.textContent = old), 1500);
}

$('copyBtn').addEventListener('click', async (e) => {
  const n = await api.copyTranscript();
  flash(e.currentTarget, n ? 'Đã chép' : 'Trống');
});
$('saveTxtBtn').addEventListener('click', () => api.saveTranscript('txt'));
$('saveSrtBtn').addEventListener('click', () => api.saveTranscript('srt'));
$('clearBtn').addEventListener('click', async () => {
  await api.clearTranscript();
  el.list.replaceChildren();
  rows.clear();
  el.history.replaceChildren();
  el.currentLine.textContent = '';
  shown = null;
});

// ---------- Cài đặt ----------

function renderSummary(summary, error) {
  const configured = summary && summary.configured;
  el.clearKeyBtn.hidden = !configured;
  el.apiKeyInput.placeholder = configured ? `${summary.label} (đã lưu) — dán key khác để thay` : 'Dán API key vào đây';
  el.keySummary.classList.toggle('warn', Boolean(error || (configured && !summary.encrypted)));
  if (error) el.keySummary.textContent = error;
  else if (!configured) el.keySummary.textContent = 'Chưa có key. Dán API key của Google Cloud vào ô dưới.';
  else if (summary.encrypted) el.keySummary.textContent = 'Key đã lưu, mã hoá bằng kho khoá của hệ điều hành.';
  else el.keySummary.textContent = 'Key đã lưu nhưng CHƯA mã hoá được vì hệ điều hành không có kho khoá (Linux: cài gnome-keyring hoặc kwallet).';
}

async function openSettings() {
  const s = await api.getSettings();
  renderSummary(s.summary);
  el.whisperStatus.textContent = s.whisperStatus;
  if (!el.dialog.open) el.dialog.showModal();
}

// Dán là lưu: chờ ngừng gõ một nhịp rồi lưu. Key vẫn nằm trong ô (ẩn) tới khi đóng app.
let saveKeyTimer;
async function saveApiKey() {
  clearTimeout(saveKeyTimer);
  const key = el.apiKeyInput.value.trim();
  if (!key) return;
  const res = await api.setApiKey(key);
  renderSummary(res.summary || (await api.getSettings()).summary, res.error);
}

el.settingsBtn.addEventListener('click', openSettings);
function setKeyVisible(visible) {
  el.apiKeyInput.type = visible ? 'text' : 'password';
  el.toggleKeyBtn.setAttribute('aria-pressed', String(visible));
  el.toggleKeyBtn.title = el.toggleKeyBtn.ariaLabel = visible ? 'Ẩn key' : 'Hiện key';
}
el.toggleKeyBtn.addEventListener('click', () => setKeyVisible(el.apiKeyInput.type === 'password'));
el.apiKeyInput.addEventListener('input', () => {
  el.toggleKeyBtn.hidden = !el.apiKeyInput.value;
  clearTimeout(saveKeyTimer);
  saveKeyTimer = setTimeout(saveApiKey, 400);
});
el.apiKeyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    saveApiKey();
  }
});
el.clearKeyBtn.addEventListener('click', async () => {
  el.apiKeyInput.value = '';
  el.toggleKeyBtn.hidden = true;
  setKeyVisible(false);
  renderSummary((await api.clearKey()).summary);
  el.apiKeyInput.focus();
});

function showEngineFields() {
  const whisper = el.engine.value === 'whisper';
  document.querySelectorAll('.whisper-only').forEach((n) => (n.hidden = !whisper));
  document.querySelectorAll('.google-only').forEach((n) => (n.hidden = whisper));
}

// Server cần vài giây để nạp model, nên đọc lại trạng thái sau một nhịp.
async function refreshWhisperStatus() {
  el.whisperStatus.textContent = (await api.getSettings()).whisperStatus;
  setTimeout(async () => (el.whisperStatus.textContent = (await api.getSettings()).whisperStatus), 1500);
}
el.engine.addEventListener('change', async () => {
  showEngineFields();
  await api.setPrefs({ engine: el.engine.value });
  refreshWhisperStatus();
});
el.whisperUrl.addEventListener('change', async () => {
  await api.setPrefs({ whisperUrl: el.whisperUrl.value.trim() || 'http://127.0.0.1:8080' });
  refreshWhisperStatus();
});
$('chooseWhisperModelBtn').addEventListener('click', async () => {
  await api.chooseWhisperModel();
  refreshWhisperStatus();
});
el.model.addEventListener('change', () => api.setPrefs({ model: el.model.value }));
el.interimTranslate.addEventListener('change', () => api.setPrefs({ interimTranslate: el.interimTranslate.checked }));
el.speechPrice.addEventListener('change', () => {
  const v = Number(el.speechPrice.value);
  if (Number.isFinite(v) && v >= 0) api.setPrefs({ speechPricePerMin: v });
});
el.translatePrice.addEventListener('change', () => {
  const v = Number(el.translatePrice.value);
  if (Number.isFinite(v) && v >= 0) api.setPrefs({ translatePricePerMillion: v });
});

document.querySelectorAll('a.ext-link').forEach((a) =>
  a.addEventListener('click', (e) => {
    e.preventDefault();
    api.openExternal(a.href);
  }),
);

// ---------- Khởi động ----------

async function init() {
  const s = await api.getSettings();
  platform = s.platform;
  const p = s.prefs;
  el.source.value = p.source;
  el.speakerLang.value = p.speakerLang;
  el.targetLang.value = p.targetLang;
  el.fontSize.value = p.textSize;
  applyFontSize(p.textSize);
  el.engine.value = p.engine;
  showEngineFields();
  el.whisperUrl.value = p.whisperUrl;
  el.model.value = p.model;
  el.interimTranslate.checked = p.interimTranslate;
  el.speechPrice.value = p.speechPricePerMin;
  el.translatePrice.value = p.translatePricePerMillion;
  updatePair();
  if (!s.summary.configured) openSettings();
  refreshUsage();
  setInterval(refreshUsage, 2000);
  await refreshDevices(p.deviceId);
}

init();
