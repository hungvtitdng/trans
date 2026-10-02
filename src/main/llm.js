'use strict';

const fs = require('node:fs');
const path = require('node:path');
const tmux = require('./tmux');

const POLL_MS = 100;
const TIMEOUT_MS = 60000;
const CLOSE_GRACE_MS = 30000;
const CACHE_LIMIT = 500;

const live = new Set(); // các translator chưa tắt tmux session, để stopAll() dọn khi thoát app

const LANG_NAMES = {
  en: 'English',
  vi: 'Vietnamese',
  ja: 'Japanese',
  ko: 'Korean',
  'zh-CN': 'Simplified Chinese',
};

function langName(code) {
  return LANG_NAMES[code] || code;
}

function oneLine(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

const CLAUDE_SYSTEM_PROMPT =
  'You translate live meeting captions. Each message looks like "[Source -> Target] text". ' +
  'Reply with only the translation of that text into the target language: no quotes, notes or explanations. ' +
  'Keep names and technical terms as spoken. Use earlier messages only as context.';

// Mỗi adapter mô tả một CLI: lệnh chạy trong tmux, cách viết một yêu cầu thành một dòng vào stdin,
// và cách đọc một dòng JSON ra. parse() trả về { text?, error?, end? }; end = yêu cầu đầu hàng đợi đã xong.
const ADAPTERS = {
  // Một tiến trình claude chạy suốt phiên, nhận nhiều lượt qua stream-json nên câu sau có ngữ cảnh câu trước.
  claude: {
    bin: 'claude',
    command(bin, { model }) {
      return [
        tmux.shellQuote(bin),
        '-p --input-format stream-json --output-format stream-json --verbose',
        `--model ${tmux.shellQuote(model || 'haiku')}`,
        "--tools '' --strict-mcp-config --no-session-persistence",
        `--system-prompt ${tmux.shellQuote(CLAUDE_SYSTEM_PROMPT)}`,
      ].join(' ');
    },
    format(text, from, to) {
      const content = `[${langName(from)} -> ${langName(to)}] ${oneLine(text)}`;
      return JSON.stringify({ type: 'user', message: { role: 'user', content } });
    },
    parse(obj) {
      if (obj.type !== 'result') return null;
      if (obj.is_error || obj.subtype !== 'success') return { error: String(obj.result || obj.subtype), end: true };
      return { text: String(obj.result || ''), end: true };
    },
  },

  // codex exec chạy lại cho từng câu (chậm hơn). Sau mỗi lần in một dấu kết thúc để hàng đợi không lệch
  // nếu codex thoát mà không báo lỗi bằng JSON.
  codex: {
    bin: 'codex',
    command(bin, { model }) {
      const exec = [
        tmux.shellQuote(bin),
        'exec --json --skip-git-repo-check --ephemeral -s read-only',
        `-c ${tmux.shellQuote('model_reasoning_effort="low"')}`,
        model ? `-m ${tmux.shellQuote(model)}` : '',
        '"$line" </dev/null 2>&1',
      ]
        .filter(Boolean)
        .join(' ');
      return `while IFS= read -r line; do ${exec}; echo '{"type":"trans.end"}'; done`;
    },
    format(text, from, to) {
      return (
        `Translate this live meeting caption from ${langName(from)} to ${langName(to)}. ` +
        `Reply with only the translation, nothing else: ${oneLine(text)}`
      );
    },
    parse(obj) {
      if (obj.type === 'item.completed' && obj.item && obj.item.type === 'agent_message') return { text: String(obj.item.text || '') };
      if (obj.type === 'turn.failed') return { error: codexErrorMessage(obj.error && obj.error.message) };
      if (obj.type === 'trans.end') return { end: true };
      return null;
    },
  },
};

// Lỗi của codex thường là JSON lồng trong chuỗi.
function codexErrorMessage(msg) {
  try {
    const inner = JSON.parse(msg);
    return (inner.error && inner.error.message) || msg;
  } catch {
    return msg || 'codex báo lỗi.';
  }
}

// Dịch bằng một CLI chạy trong tmux session riêng. Ghi yêu cầu vào in.txt (tail -F đẩy vào stdin của CLI),
// đọc kết quả từ out.jsonl (tee từ stdout). Kết quả về theo đúng thứ tự gửi.
// Người dùng có thể xem trực tiếp: tmux attach -t <session>.
class TmuxCliTranslator {
  constructor(adapter, { dir, session, model = '', run = tmux.run, bin, pollMs = POLL_MS, timeoutMs = TIMEOUT_MS }) {
    this.adapter = adapter;
    this.dir = dir;
    this.session = session;
    this.model = model;
    this.run = run;
    this.bin = bin;
    this.pollMs = pollMs;
    this.timeoutMs = timeoutMs;
    this.chars = 0; // chạy bằng gói claude/codex của người dùng, không tính vào chi phí
    this.interim = false; // mỗi câu mất vài giây nên không dịch tạm
    this.inFile = path.join(dir, 'in.txt');
    this.outFile = path.join(dir, 'out.jsonl');
    this.pending = [];
    this.cache = new Map();
    this.offset = 0;
    this.rest = '';
    this.lastOutput = '';
    this.timer = null;
  }

  start() {
    const bin = this.bin || tmux.findBin(this.adapter.bin);
    if (!bin) throw new Error(`Không tìm thấy lệnh ${this.adapter.bin}. Hãy cài và đăng nhập ${this.adapter.bin} trước.`);
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.inFile, '');
    fs.writeFileSync(this.outFile, '');
    this._kill();
    const q = tmux.shellQuote;
    const cmd = `tail -n +1 -F ${q(this.inFile)} | ${this.adapter.command(bin, { model: this.model })} 2>&1 | tee -a ${q(this.outFile)}`;
    this.run(['new-session', '-d', '-s', this.session, '-x', '200', '-y', '50', '-c', this.dir, '-e', `PATH=${tmux.envPath()}`, cmd]);
    this.timer = setInterval(() => this._poll(), this.pollMs);
    live.add(this);
  }

  async translate(text, from, to) {
    if (from === to) return text;
    if (!this.timer) throw new Error('Phiên dịch đã dừng.');
    const key = `${from}|${to}|${text}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const result = await new Promise((resolve, reject) => {
      const req = { resolve, reject, settled: false, text: '', error: '' };
      // Hết giờ chỉ báo lỗi cho người gọi; yêu cầu vẫn nằm trong hàng đợi để kết quả đến muộn không bị gán nhầm câu.
      req.timeout = setTimeout(() => this._settle(req, new Error(this._why('Quá thời gian chờ bản dịch.'))), this.timeoutMs);
      this.pending.push(req);
      fs.appendFileSync(this.inFile, `${this.adapter.format(text, from, to)}\n`);
    });
    if (this.cache.size >= CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, result);
    return result;
  }

  // Dừng phiên: chờ các câu đang dịch xong (tối đa CLOSE_GRACE_MS) rồi tắt tmux session.
  close() {
    if (!this.timer || this.closing) return;
    this.closing = setTimeout(() => this.stop(), CLOSE_GRACE_MS);
    if (!this.pending.some((r) => !r.settled)) this.stop();
  }

  stop() {
    clearTimeout(this.closing);
    clearInterval(this.timer);
    this.timer = null;
    this._poll();
    for (const req of this.pending) this._settle(req, new Error('Đã dừng trước khi dịch xong.'));
    this.pending = [];
    this._kill();
    live.delete(this);
  }

  _kill() {
    try {
      this.run(['kill-session', '-t', this.session]);
    } catch {
      // session chưa có hoặc đã tắt
    }
  }

  _why(message) {
    return this.lastOutput ? `${message} ${this.adapter.bin}: ${this.lastOutput}` : message;
  }

  _settle(req, err, text) {
    if (req.settled) return;
    req.settled = true;
    clearTimeout(req.timeout);
    if (err) req.reject(err);
    else req.resolve(text);
  }

  _poll() {
    let chunk;
    try {
      const fd = fs.openSync(this.outFile, 'r');
      try {
        const size = fs.fstatSync(fd).size;
        if (size <= this.offset) return;
        const buf = Buffer.alloc(size - this.offset);
        fs.readSync(fd, buf, 0, buf.length, this.offset);
        this.offset = size;
        chunk = buf.toString('utf8');
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return;
    }
    const lines = (this.rest + chunk).split('\n');
    this.rest = lines.pop();
    for (const line of lines) this._line(line.trim());
    if (this.closing && !this.pending.some((r) => !r.settled)) this.stop();
  }

  _line(line) {
    if (!line) return;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      // lỗi dạng chữ, ví dụ chưa đăng nhập; bỏ dòng thông báo thường của codex
      if (!/^Reading additional input from stdin/.test(line)) this.lastOutput = line.slice(0, 200);
      return;
    }
    const r = this.adapter.parse(obj);
    if (!r) return;
    const head = this.pending[0];
    if (!head) return;
    if (r.text !== undefined) head.text = r.text;
    if (r.error) head.error = r.error;
    if (!r.end) return;
    this.pending.shift();
    const text = head.text.trim();
    if (text) this._settle(head, null, text);
    else this._settle(head, new Error(this._why(head.error || 'Không nhận được bản dịch.')));
  }
}

function createTranslator(kind, opts) {
  const adapter = ADAPTERS[kind];
  if (!adapter) throw new Error(`Không có adapter dịch "${kind}".`);
  const t = new TmuxCliTranslator(adapter, opts);
  t.start();
  return t;
}

function stopAll() {
  for (const t of [...live]) t.stop();
}

module.exports = { ADAPTERS, TmuxCliTranslator, createTranslator, stopAll, langName };
