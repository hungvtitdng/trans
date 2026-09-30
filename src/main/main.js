'use strict';

const path = require('node:path');
const fs = require('node:fs');
const {
  app,
  BrowserWindow,
  Menu,
  clipboard,
  desktopCapturer,
  dialog,
  ipcMain,
  safeStorage,
  screen,
  session,
  shell,
  systemPreferences,
} = require('electron');
const { SttSession } = require('./stt');
const whisper = require('./whisper');
const { WhisperSession } = whisper;
const google = require('./google');
const { SettingsStore } = require('./settings');
const transcript = require('./transcript');

const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');
const INTERIM_MIN_WORDS = 4;
const INTERIM_MIN_GAP_MS = 1200;

let settings;
let mainWindow = null;
let overlayWindow = null;

// Trạng thái phiên
let stt = null;
let translator = null;
let langs = { from: 'en', to: 'vi' };
let finalId = 0;
let lastInterimTranslateAt = 0;
let entries = [];
let usedAudioMs = 0; // của các phiên đã kết thúc
let usedChars = 0;

// whisper-server do app tự chạy
let whisperProc = null;
let whisperError = '';

function broadcast(msg) {
  for (const win of [mainWindow, overlayWindow]) {
    if (win && !win.isDestroyed()) win.webContents.send('caption', msg);
  }
}

function openExternalSafe(url) {
  try {
    if (new URL(url).protocol === 'https:') shell.openExternal(url);
  } catch {
    // URL không hợp lệ
  }
}

function hardenWindow(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    e.preventDefault();
    openExternalSafe(url);
  });
}

const webPreferences = {
  preload: PRELOAD,
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
};

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 420,
    minHeight: 480,
    title: 'Phụ đề họp',
    backgroundColor: '#111317',
    webPreferences,
  });
  hardenWindow(mainWindow);
  mainWindow.loadFile(path.join(RENDERER, 'index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
    stopSession();
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
  });
}

function toggleOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
    return false;
  }
  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.min(960, area.width - 40);
  const height = 170;
  overlayWindow = new BrowserWindow({
    width,
    height,
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + area.height - height - 40),
    minWidth: 300,
    minHeight: 80,
    frame: false,
    transparent: true,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    title: 'Phụ đề nổi',
    webPreferences,
  });
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  hardenWindow(overlayWindow);
  overlayWindow.loadFile(path.join(RENDERER, 'overlay.html'));
  overlayWindow.on('closed', () => {
    overlayWindow = null;
    if (mainWindow) mainWindow.webContents.send('overlay-state', false);
  });
  return true;
}

// Chạy/dừng whisper-server cho khớp với Cài đặt.
function syncWhisperServer() {
  const p = settings.prefs;
  const want = p.engine === 'whisper' && p.whisperModel;
  if (whisperProc && (!want || whisperProc.model !== p.whisperModel || whisperProc.url !== p.whisperUrl)) {
    whisperProc.kill();
    whisperProc = null;
  }
  if (!want || whisperProc) return;
  whisperError = '';
  try {
    const child = whisper.startServer({
      model: p.whisperModel,
      url: p.whisperUrl,
      onExit: (msg) => {
        whisperError = msg;
        if (whisperProc === child) whisperProc = null;
      },
    });
    if (child) whisperProc = Object.assign(child, { model: p.whisperModel, url: p.whisperUrl });
  } catch (err) {
    whisperError = err.message;
  }
}

function whisperStatus() {
  const p = settings.prefs;
  if (p.engine !== 'whisper') return '';
  if (whisperError) return whisperError;
  if (whisperProc) return `whisper-server đang chạy với model ${path.basename(p.whisperModel)}.`;
  if (!p.whisperModel) return 'Chưa chọn file model. Bấm "Chọn file model…".';
  return `Dùng whisper-server có sẵn tại ${p.whisperUrl}.`;
}

function interimLongEnough(text) {
  // Tiếng Nhật/Trung không có dấu cách: tính theo số ký tự.
  return /\s/.test(text) ? text.split(/\s+/).length >= INTERIM_MIN_WORDS : text.length >= 8;
}

function startSession({ speakerLang, targetLang }) {
  stopSession();
  let auth;
  try {
    auth = settings.getAuth();
  } catch {
    return { error: 'Không giải mã được key đã lưu. Hãy nhập lại key trong Cài đặt.' };
  }
  if (!auth) return { error: 'Chưa có key Google Cloud. Mở Cài đặt để nhập key.' };

  const prefs = settings.prefs;
  langs = { from: google.toTranslateLang(speakerLang), to: targetLang };
  translator = google.createTranslator(auth);
  const tr = translator;
  const s =
    prefs.engine === 'whisper'
      ? new WhisperSession({ url: prefs.whisperUrl, language: langs.from.split('-')[0] })
      : new SttSession({
          createClient: () => google.createSpeechClient(auth),
          languageCode: speakerLang,
          model: prefs.model,
        });

  s.on('interim', (text) => {
    broadcast({ type: 'interim', text });
    if (!prefs.interimTranslate || !interimLongEnough(text)) return;
    const now = Date.now();
    if (now - lastInterimTranslateAt < INTERIM_MIN_GAP_MS) return;
    lastInterimTranslateAt = now;
    const idAtRequest = finalId;
    tr.translate(text, langs.from, langs.to)
      .then((t) => {
        // Bỏ kết quả nếu trong lúc chờ đã có câu chốt mới.
        if (stt === s && finalId === idAtRequest) broadcast({ type: 'interimTranslation', text: t });
      })
      .catch(() => {});
  });

  s.on('final', (text) => {
    const entry = { id: ++finalId, time: Date.now(), source: text };
    entries.push(entry);
    broadcast({ type: 'final', id: entry.id, time: entry.time, text });
    tr.translate(text, langs.from, langs.to)
      .then((t) => {
        entry.translation = t;
        broadcast({ type: 'translated', id: entry.id, text: t });
      })
      .catch((err) => broadcast({ type: 'translateError', id: entry.id, message: google.friendlyError(err) }));
  });

  s.on('error', (err) => {
    const message = s instanceof WhisperSession ? [err.message, whisperError].filter(Boolean).join(' ') : google.friendlyError(err);
    broadcast({ type: 'error', message });
  });

  s.on('stopped', () => {
    if (s instanceof SttSession) usedAudioMs += s.audioMs; // Whisper chạy trên máy, không tính phí
    usedChars += tr.chars;
    if (stt === s) {
      stt = null;
      translator = null;
    }
    broadcast({ type: 'status', running: false });
  });

  try {
    s.start();
  } catch (err) {
    return { error: google.friendlyError(err) };
  }
  stt = s;
  broadcast({ type: 'status', running: true });
  return { ok: true };
}

function stopSession() {
  if (stt) stt.stop();
}

function usage() {
  const prefs = settings.prefs;
  const minutes = (usedAudioMs + (stt instanceof SttSession ? stt.audioMs : 0)) / 60000;
  const chars = usedChars + (translator ? translator.chars : 0);
  const cost = minutes * prefs.speechPricePerMin + (chars / 1e6) * prefs.translatePricePerMillion;
  return { minutes, chars, cost };
}

function registerIpc() {
  ipcMain.handle('settings:get', () => ({
    summary: settings.summary(),
    prefs: settings.prefs,
    platform: process.platform,
    whisperStatus: whisperStatus(),
  }));
  ipcMain.handle('settings:setPrefs', (_e, partial) => {
    const prefs = settings.setPrefs(partial);
    syncWhisperServer();
    return prefs;
  });
  ipcMain.handle('settings:chooseWhisperModel', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn file model whisper (.bin)',
      filters: [{ name: 'Model whisper.cpp', extensions: ['bin'] }],
      properties: ['openFile'],
    });
    if (!res.canceled && res.filePaths.length) {
      settings.setPrefs({ whisperModel: res.filePaths[0] });
      syncWhisperServer();
    }
    return { prefs: settings.prefs, whisperStatus: whisperStatus() };
  });
  ipcMain.handle('settings:setApiKey', (_e, key) => {
    try {
      settings.setApiKey(key);
      return { summary: settings.summary() };
    } catch (err) {
      return { error: err.message };
    }
  });
  ipcMain.handle('settings:clearKey', () => {
    settings.clearAuth();
    return { summary: settings.summary() };
  });

  ipcMain.handle('session:start', (_e, opts) => startSession(opts || {}));
  ipcMain.handle('session:stop', () => stopSession());
  ipcMain.on('audio:chunk', (_e, chunk) => {
    if (stt && chunk) stt.write(Buffer.from(chunk.buffer || chunk, chunk.byteOffset || 0, chunk.byteLength));
  });
  ipcMain.handle('usage:get', () => usage());
  ipcMain.handle('mic:access', async () => {
    if (process.platform !== 'darwin') return true;
    return systemPreferences.askForMediaAccess('microphone');
  });

  ipcMain.handle('overlay:toggle', () => toggleOverlay());
  ipcMain.on('overlay:close', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
  });

  ipcMain.handle('transcript:copy', () => {
    clipboard.writeText(transcript.toTxt(entries));
    return entries.length;
  });
  ipcMain.handle('transcript:save', async (_e, format) => {
    const ext = format === 'srt' ? 'srt' : 'txt';
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const res = await dialog.showSaveDialog(mainWindow, {
      title: ext === 'srt' ? 'Lưu phụ đề .srt' : 'Lưu biên bản .txt',
      defaultPath: `bien-ban-${stamp}.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    const text = ext === 'srt' ? transcript.toSrt(entries) : transcript.toTxt(entries);
    fs.writeFileSync(res.filePath, text, 'utf8');
    return { ok: true };
  });
  ipcMain.handle('transcript:clear', () => {
    entries = [];
  });
  ipcMain.on('open-external', (_e, url) => openExternalSafe(url));
}

function setupMedia() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media' || permission === 'display-capture' || permission === 'clipboard-sanitized-write');
  });
  // Âm thanh máy tính: lấy màn hình đầu tiên + audio loopback; renderer chỉ dùng track âm thanh.
  ses.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => {
        if (!sources.length) return callback({});
        callback({ video: sources[0], audio: 'loopback' });
      })
      .catch(() => callback({}));
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  settings = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'), safeStorage);
  setupMedia();
  registerIpc();
  syncWhisperServer();
  createMainWindow();
  app.on('activate', () => {
    if (!mainWindow) createMainWindow();
  });
});

app.on('will-quit', () => {
  if (whisperProc) whisperProc.kill();
});

app.on('window-all-closed', () => {
  stopSession();
  if (process.platform !== 'darwin') app.quit();
});
