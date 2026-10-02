'use strict';

const path = require('node:path');
const google = require('./google');
const llm = require('./llm');
const tmux = require('./tmux');

// Các adapter dịch chọn được trong Cài đặt. Mỗi translator có dạng
// { translate(text, from, to), chars, interim, close?() }.
const TRANSLATORS = {
  google: {
    needsKey: true,
    create: ({ auth }) => Object.assign(google.createTranslator(auth), { interim: true }),
    friendlyError: google.friendlyError,
    status: () => '',
  },
  claude: llmEntry('claude', 'claudeModel'),
  codex: llmEntry('codex', 'codexModel'),
};

function llmEntry(kind, modelPref) {
  return {
    needsKey: false,
    create: ({ prefs, workDir }) =>
      llm.createTranslator(kind, { dir: path.join(workDir, kind), session: sessionName(kind), model: prefs[modelPref] }),
    friendlyError: (err) => (err && err.message) || String(err),
    status: () => llmStatus(kind),
  };
}

function sessionName(kind) {
  return `trans-llm-${kind}`;
}

function llmStatus(kind) {
  if (process.platform === 'win32') return 'tmux không chạy trên Windows. Hãy dùng Google Translate.';
  if (!tmux.findBin('tmux')) return 'Chưa cài tmux. macOS: brew install tmux; Linux: sudo apt install tmux.';
  const bin = tmux.findBin(kind);
  if (!bin) return `Không tìm thấy lệnh ${kind}. Hãy cài và đăng nhập ${kind} trước.`;
  return `Dùng ${bin} trong tmux. Xem trực tiếp: tmux attach -t ${sessionName(kind)}`;
}

function get(kind) {
  return TRANSLATORS[kind] || TRANSLATORS.google;
}

module.exports = { TRANSLATORS, get };
