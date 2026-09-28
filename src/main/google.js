'use strict';

const CACHE_LIMIT = 500;

// auth: { apiKey } hoặc { credentials: { client_email, private_key }, projectId }
function speechOptions(auth) {
  if (auth.apiKey) return { apiKey: auth.apiKey };
  return { credentials: auth.credentials, projectId: auth.projectId };
}

function translateOptions(auth) {
  if (auth.apiKey) return { key: auth.apiKey };
  return { credentials: auth.credentials, projectId: auth.projectId };
}

function createSpeechClient(auth) {
  const { SpeechClient } = require('@google-cloud/speech');
  return new SpeechClient(speechOptions(auth));
}

// Mã ngôn ngữ nhận dạng (en-US, cmn-Hans-CN...) -> mã của Translation API.
function toTranslateLang(code) {
  if (code.startsWith('cmn')) return 'zh-CN';
  return code.split('-')[0];
}

// Trả về { translate(text, from, to), chars }; `client` truyền vào được để test.
function createTranslator(auth, client) {
  if (!client) {
    const { Translate } = require('@google-cloud/translate').v2;
    client = new Translate(translateOptions(auth));
  }
  const cache = new Map();
  const translator = {
    chars: 0,
    async translate(text, from, to) {
      if (from === to) return text;
      const key = `${from}|${to}|${text}`;
      if (cache.has(key)) return cache.get(key);
      const [result] = await client.translate(text, { from, to, format: 'text' });
      translator.chars += text.length;
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
      cache.set(key, result);
      return result;
    },
  };
  return translator;
}

function parseServiceAccount(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('File không phải JSON hợp lệ.');
  }
  if (!json || json.type !== 'service_account') {
    throw new Error('File JSON không phải khoá service account (thiếu "type": "service_account").');
  }
  if (!json.client_email || !json.private_key) {
    throw new Error('File service account thiếu client_email hoặc private_key.');
  }
  return { client_email: json.client_email, private_key: json.private_key, project_id: json.project_id || '' };
}

function errorText(err) {
  if (!err) return '';
  const parts = [err.message, err.details, err.reason, err.status, err.code];
  if (err.errors) parts.push(JSON.stringify(err.errors));
  if (err.response && err.response.data) parts.push(JSON.stringify(err.response.data));
  if (err.statusDetails) parts.push(JSON.stringify(err.statusDetails));
  return parts.filter((p) => p !== undefined && p !== null).join(' ');
}

// Chuyển lỗi của Google thành câu tiếng Việt dễ hiểu.
function friendlyError(err) {
  const t = errorText(err);
  const code = err && err.code;
  if (/API_KEY_INVALID|API key not valid|keyInvalid|invalid api key/i.test(t)) {
    return 'Key không hợp lệ. Kiểm tra lại API key đã sao chép đủ chưa.';
  }
  if (/BILLING_DISABLED|billing/i.test(t)) {
    return 'Project Google Cloud chưa gắn tài khoản thanh toán (Billing). Hãy bật Billing cho project rồi thử lại.';
  }
  if (/SERVICE_DISABLED|has not been used in project|is disabled|accessNotConfigured/i.test(t)) {
    return 'API chưa được bật. Vào Google Cloud Console bật "Cloud Speech-to-Text API" và "Cloud Translation API" cho project.';
  }
  if (/API_KEY_SERVICE_BLOCKED|API_KEY_HTTP_REFERRER_BLOCKED|API_KEY_IP_ADDRESS_BLOCKED|API_KEY_ANDROID_APP_BLOCKED|API_KEY_IOS_APP_BLOCKED|are blocked/i.test(t)) {
    return 'Key đang bị giới hạn không cho dùng API này. Trong phần giới hạn của key, hãy cho phép Speech-to-Text và Translation, và không đặt giới hạn theo website/IP.';
  }
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|getaddrinfo|network|No connection established/i.test(t) || code === 14) {
    return 'Không kết nối được tới Google. Kiểm tra mạng, proxy hoặc tường lửa.';
  }
  if (/PERMISSION_DENIED|forbidden|insufficient|IAM_PERMISSION/i.test(t) || code === 7 || code === 403) {
    return 'Tài khoản thiếu quyền. Với service account, cần role "Cloud Speech Client" và "Cloud Translation API User".';
  }
  if (/UNAUTHENTICATED|invalid_grant|invalid_client|unauthorized/i.test(t) || code === 16 || code === 401) {
    return 'Xác thực thất bại. Key hoặc file service account không còn hiệu lực.';
  }
  if (/RESOURCE_EXHAUSTED|quota|rateLimit/i.test(t) || code === 8 || code === 429) {
    return 'Đã vượt hạn mức (quota) của Google. Chờ một lúc hoặc tăng quota trong Console.';
  }
  const msg = (err && err.message) || String(err);
  return `Lỗi từ Google: ${msg}`;
}

// Gửi 0,3 giây im lặng qua recognize và dịch thử "Hello". Mỗi API có kết quả riêng.
async function testKey(auth) {
  const result = {};
  const speech = createSpeechClient(auth);
  try {
    await speech.recognize({
      config: { encoding: 'LINEAR16', sampleRateHertz: 16000, languageCode: 'en-US' },
      audio: { content: Buffer.alloc(9600).toString('base64') },
    });
    result.speech = { ok: true, message: 'Speech-to-Text hoạt động.' };
  } catch (err) {
    result.speech = { ok: false, message: friendlyError(err) };
  } finally {
    speech.close().catch(() => {});
  }
  try {
    const tr = await createTranslator(auth).translate('Hello', 'en', 'vi');
    result.translate = { ok: true, message: `Translation hoạt động ("Hello" → "${tr}").` };
  } catch (err) {
    result.translate = { ok: false, message: friendlyError(err) };
  }
  return result;
}

module.exports = {
  createSpeechClient,
  createTranslator,
  toTranslateLang,
  parseServiceAccount,
  friendlyError,
  testKey,
};
