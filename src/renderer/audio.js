// Lấy âm thanh (máy tính / micro / cả hai) và phát PCM 16 kHz mono qua onChunk.

export class AudioError extends Error {}

function systemAudioHint(platform) {
  if (platform === 'darwin') {
    return 'Không lấy được âm thanh máy tính. Trên macOS 13 trở lên, hãy cấp quyền "Screen & System Audio Recording" (xem hướng dẫn bên dưới) rồi mở lại app. Nếu đang chạy bằng "npm start" từ Terminal, hãy dùng "npm run start:mac" (Terminal không xin được quyền thu âm thanh). Trên macOS cũ hơn, cài BlackHole, tạo "Multi-Output Device" rồi chọn nguồn "Micro / thiết bị thu" với thiết bị BlackHole.';
  }
  if (platform === 'win32') {
    return 'Không lấy được âm thanh máy tính. Hãy bật "Stereo Mix" trong Sound Settings hoặc cài VB-Cable, rồi chọn nguồn "Micro / thiết bị thu" với thiết bị đó.';
  }
  return 'Không lấy được âm thanh máy tính. Hãy chọn nguồn "Micro / thiết bị thu" và chọn thiết bị "Monitor of …" của loa đang dùng.';
}

const MAC_SCREEN_PERMISSION =
  'macOS chưa cho phép thu âm thanh hệ thống. Vào System Settings → Privacy & Security → Screen & System Audio Recording, bật "Translator", rồi thoát và mở lại app.';
const MAC_MIC_PERMISSION =
  'Micro đang bị chặn. Vào System Settings → Privacy & Security → Microphone, bật "Translator", rồi mở lại app.';

function friendlyMediaError(err, kind, platform) {
  const name = err && err.name;
  if (err instanceof AudioError) return err.message;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    if (kind === 'system') return platform === 'darwin' ? MAC_SCREEN_PERMISSION : 'Hệ điều hành đã chặn việc thu âm thanh máy tính.';
    return platform === 'darwin' ? MAC_MIC_PERMISSION : 'Micro đang bị chặn. Hãy cho phép ứng dụng dùng micro trong cài đặt quyền riêng tư của hệ điều hành.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return kind === 'system' ? systemAudioHint(platform) : 'Không tìm thấy thiết bị thu âm. Hãy cắm micro hoặc chọn thiết bị khác.';
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return kind === 'system' ? systemAudioHint(platform) : 'Thiết bị thu âm đang bận hoặc lỗi. Thử chọn thiết bị khác.';
  }
  return `Lỗi thu âm: ${(err && err.message) || err}`;
}

export async function listInputDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audioinput');
}

export class AudioCapture {
  constructor({ onChunk, onLevel }) {
    this.onChunk = onChunk;
    this.onLevel = onLevel;
    this.streams = [];
    this.ctx = null;
  }

  async start({ source, deviceId, platform }) {
    const streams = [];
    try {
      if (source === 'system' || source === 'both') {
        let display;
        try {
          display = await navigator.mediaDevices.getDisplayMedia({
            video: { width: 320, height: 180, frameRate: 1 },
            audio: true,
          });
        } catch (err) {
          throw new AudioError(friendlyMediaError(err, 'system', platform));
        }
        streams.push(display);
        display.getVideoTracks().forEach((t) => (t.enabled = false));
        // Thiếu quyền trên macOS 14.2+: track vẫn có nhưng đã 'ended' sẵn, không báo lỗi gì.
        const tracks = display.getAudioTracks();
        if (!tracks.length || tracks[0].readyState === 'ended') throw new AudioError(systemAudioHint(platform));
      }
      if (source === 'mic' || source === 'both') {
        try {
          streams.push(
            await navigator.mediaDevices.getUserMedia({
              audio: {
                deviceId: deviceId ? { exact: deviceId } : undefined,
                echoCancellation: false,
                noiseSuppression: true,
                autoGainControl: true,
              },
            }),
          );
        } catch (err) {
          throw new AudioError(friendlyMediaError(err, 'mic', platform));
        }
      }
      this.streams = streams;

      const ctx = new AudioContext({ sampleRate: 16000 });
      this.ctx = ctx;
      await ctx.audioWorklet.addModule('pcm-worklet.js');
      const node = new AudioWorkletNode(ctx, 'pcm-worklet', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
      node.port.onmessage = (e) => {
        this.onChunk(new Uint8Array(e.data.pcm));
        this.onLevel(e.data.rms);
      };
      for (const s of streams) {
        const audioOnly = new MediaStream(s.getAudioTracks());
        ctx.createMediaStreamSource(audioOnly).connect(node);
      }
      // Gain = 0 tới destination để graph luôn chạy mà không phát ra loa.
      const mute = ctx.createGain();
      mute.gain.value = 0;
      node.connect(mute).connect(ctx.destination);
      if (ctx.state === 'suspended') await ctx.resume();
    } catch (err) {
      streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      this.stop();
      throw err instanceof AudioError ? err : new AudioError(friendlyMediaError(err, source, platform));
    }
  }

  // Gọi khi một track bị hệ điều hành ngắt (ví dụ rút micro).
  onEnded(fn) {
    for (const s of this.streams) for (const t of s.getAudioTracks()) t.addEventListener('ended', fn, { once: true });
  }

  stop() {
    this.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    this.streams = [];
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null;
  }
}
