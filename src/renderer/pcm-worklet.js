// Chạy trong AudioWorkletGlobalScope (AudioContext 16000 Hz).
// Chuyển Float32 -> Int16 PCM, gom thành gói 100 ms (1600 mẫu), kèm mức RMS.
const CHUNK = 1600;

class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Int16Array(CHUNK);
    this.pos = 0;
    this.sumSq = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels || !channels.length) return true;
    const frames = channels[0].length;
    for (let i = 0; i < frames; i++) {
      // Trộn về mono (các nguồn nối vào đã được cộng sẵn ở đầu vào).
      let v = 0;
      for (let c = 0; c < channels.length; c++) v += channels[c][i];
      v /= channels.length;
      if (v > 1) v = 1;
      else if (v < -1) v = -1;
      this.sumSq += v * v;
      this.buf[this.pos++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      if (this.pos === CHUNK) {
        const rms = Math.sqrt(this.sumSq / CHUNK);
        this.port.postMessage({ pcm: this.buf.buffer, rms }, [this.buf.buffer]);
        this.buf = new Int16Array(CHUNK);
        this.pos = 0;
        this.sumSq = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-worklet', PcmWorklet);
