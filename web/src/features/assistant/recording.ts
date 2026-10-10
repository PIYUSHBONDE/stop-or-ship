/** Mono PCM capture. Audio remains in memory and is capped at fifteen seconds. */
export async function startRecording(onStop: (wav: string) => void) {
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext)
    throw new Error('Recording is unsupported in this browser. Type your question instead.');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  let context: AudioContext;
  try {
    context = new AudioContext();
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }
  const chunks: Float32Array[] = [];
  let count = 0;
  const maximum = context.sampleRate * 15;
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const mute = context.createGain();
  mute.gain.value = 0;
  processor.onaudioprocess = (event) => {
    const samples = event.inputBuffer.getChannelData(0).slice(0, maximum - count);
    if (samples.length) {
      chunks.push(samples);
      count += samples.length;
    }
  };
  source.connect(processor);
  processor.connect(mute);
  mute.connect(context.destination);
  try {
    await context.resume();
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    source.disconnect();
    processor.disconnect();
    mute.disconnect();
    void context.close();
    throw error;
  }
  let stopped = false;
  const stop = (discard = false) => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    stream.getTracks().forEach((track) => track.stop());
    source.disconnect();
    processor.disconnect();
    mute.disconnect();
    void context.close();
    if (discard) return;
    const input = new Float32Array(count);
    let offset = 0;
    for (const chunk of chunks) {
      input.set(chunk, offset);
      offset += chunk.length;
    }
    const length = Math.min(240000, Math.floor((count * 16000) / context.sampleRate));
    const bytes = new Uint8Array(44 + length * 2);
    const data = new DataView(bytes.buffer);
    const label = (at: number, text: string) =>
      [...text].forEach((char, i) => data.setUint8(at + i, char.charCodeAt(0)));
    label(0, 'RIFF');
    data.setUint32(4, bytes.length - 8, true);
    label(8, 'WAVE');
    label(12, 'fmt ');
    data.setUint32(16, 16, true);
    data.setUint16(20, 1, true);
    data.setUint16(22, 1, true);
    data.setUint32(24, 16000, true);
    data.setUint32(28, 32000, true);
    data.setUint16(32, 2, true);
    data.setUint16(34, 16, true);
    label(36, 'data');
    data.setUint32(40, length * 2, true);
    for (let i = 0; i < length; i++) {
      // Average each source interval to reduce aliasing when downsampling.
      const start = Math.floor((i * context.sampleRate) / 16000);
      const end = Math.max(start + 1, Math.floor(((i + 1) * context.sampleRate) / 16000));
      let sum = 0;
      for (let j = start; j < Math.min(end, count); j++) sum += input[j];
      const sample = Math.max(-1, Math.min(1, sum / (end - start)));
      data.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
    }
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    onStop(btoa(binary));
  };
  const timer = setTimeout(() => stop(), 15000);
  return stop;
}
