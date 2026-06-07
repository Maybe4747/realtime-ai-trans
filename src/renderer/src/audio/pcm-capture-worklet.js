const TARGET_SAMPLE_RATE = 16000
const FRAME_SIZE = 1600

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.cursor = 0
    this.samples = []
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0]
    const output = outputs[0]?.[0]

    if (output) {
      output.fill(0)
    }

    if (!input) {
      return true
    }

    const ratio = sampleRate / TARGET_SAMPLE_RATE
    let cursor = this.cursor

    while (cursor < input.length) {
      const sample = Math.max(-1, Math.min(1, input[Math.floor(cursor)]))
      this.samples.push(sample < 0 ? sample * 0x8000 : sample * 0x7fff)
      cursor += ratio
    }

    this.cursor = cursor - input.length

    while (this.samples.length >= FRAME_SIZE) {
      const frame = this.samples.splice(0, FRAME_SIZE)
      const pcm = new Int16Array(frame.length)

      for (let index = 0; index < frame.length; index += 1) {
        pcm[index] = frame[index]
      }

      this.port.postMessage(pcm.buffer, [pcm.buffer])
    }

    return true
  }
}

registerProcessor('pcm-capture-processor', PcmCaptureProcessor)
