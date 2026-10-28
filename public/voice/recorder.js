// @ts-nocheck -- AudioWorklet globals are provided by the browser worklet scope.
// Captures small frames in an AudioWorklet so UI rendering cannot stall the mic.
class ForemanRecorder extends AudioWorkletProcessor {
  process(inputs) {
    const samples = inputs[0]?.[0];
    if (samples) this.port.postMessage(samples.slice());
    return true;
  }
}
registerProcessor("foreman-recorder", ForemanRecorder);
