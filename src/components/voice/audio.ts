export function pcm16(frames: Float32Array[], sampleRate: number) {
  const all = new Float32Array(frames.reduce((n, f) => n + f.length, 0));
  let at = 0;
  for (const f of frames) {
    all.set(f, at);
    at += f.length;
  }
  const step = sampleRate / 16000;
  const pcm = new Int16Array(Math.floor(all.length / step));
  for (let i = 0; i < pcm.length; i++) {
    let sum = 0,
      count = 0;
    for (
      let k = Math.floor(i * step);
      k < Math.min(all.length, Math.floor((i + 1) * step));
      k++
    ) {
      sum += all[k]!;
      count++;
    }
    pcm[i] = Math.round(
      Math.max(-1, Math.min(1, sum / Math.max(1, count))) * 32767,
    );
  }
  let binary = "";
  const bytes = new Uint8Array(pcm.buffer);
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export type MicCapture = { close: () => void; context: AudioContext };
export async function microphone(
  onFrame: (samples: Float32Array, rate: number) => void,
): Promise<MicCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });
  const context = new AudioContext();
  try {
    await context.resume();
    await context.audioWorklet.addModule("/voice/recorder.js");
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, "foreman-recorder");
    const silent = context.createGain();
    silent.gain.value = 0;
    node.port.onmessage = (e: MessageEvent<Float32Array>) =>
      onFrame(e.data, context.sampleRate);
    source.connect(node);
    node.connect(silent);
    silent.connect(context.destination);
    return {
      context,
      close: () => {
        node.port.onmessage = null;
        node.disconnect();
        source.disconnect();
        silent.disconnect();
        stream.getTracks().forEach((t) => t.stop());
        void context.close();
      },
    };
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    void context.close();
    throw e;
  }
}
