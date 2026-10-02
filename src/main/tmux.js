'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// App mở từ Finder/Dock chỉ có PATH tối thiểu, nên tự thêm các thư mục cài đặt hay gặp.
function searchDirs() {
  const home = os.homedir();
  const extra = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.volta', 'bin'),
    '/usr/bin',
    '/bin',
  ];
  const fromEnv = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  return [...new Set([...fromEnv, ...extra])];
}

function envPath() {
  return searchDirs().join(path.delimiter);
}

// Đường dẫn tuyệt đối của một lệnh, hoặc null nếu không có.
function findBin(name) {
  for (const dir of searchDirs()) {
    const p = path.join(dir, name);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {
      // không có ở thư mục này
    }
  }
  return null;
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function run(args) {
  const bin = findBin('tmux');
  if (!bin) throw new Error('Chưa cài tmux. macOS: brew install tmux; Linux: sudo apt install tmux.');
  return execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

module.exports = { findBin, envPath, shellQuote, run };
