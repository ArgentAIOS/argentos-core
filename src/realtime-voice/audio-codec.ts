export type PcmAudioFormat = {
  sampleRateHz: number;
  channels: 1;
};

export function resamplePcm(pcm: Buffer, from: PcmAudioFormat, to: PcmAudioFormat): Buffer {
  if (from.channels !== 1 || to.channels !== 1) {
    throw new Error("Only mono PCM audio is supported");
  }
  if (from.sampleRateHz <= 0 || to.sampleRateHz <= 0) {
    throw new Error("Sample rates must be positive");
  }
  if (pcm.length % 2 !== 0) {
    throw new Error("PCM buffer length must be divisible by 2");
  }
  if (from.sampleRateHz === to.sampleRateHz) {
    return Buffer.from(pcm);
  }

  const inputSamples = pcm.length / 2;
  if (inputSamples === 0) {
    return Buffer.alloc(0);
  }

  const outputSamples = Math.max(
    1,
    Math.round((inputSamples * to.sampleRateHz) / from.sampleRateHz),
  );
  const output = Buffer.alloc(outputSamples * 2);
  const ratio = from.sampleRateHz / to.sampleRateHz;

  for (let i = 0; i < outputSamples; i++) {
    const src = i * ratio;
    const srcIndex = Math.floor(src);
    const nextIndex = Math.min(srcIndex + 1, inputSamples - 1);
    const fraction = src - srcIndex;
    const a = pcm.readInt16LE(srcIndex * 2);
    const b = pcm.readInt16LE(nextIndex * 2);
    const sample = Math.round(a + (b - a) * fraction);
    output.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), i * 2);
  }

  return output;
}

export function resamplePcmTo8k(pcm: Buffer, fromSampleRateHz = 24000): Buffer {
  return resamplePcm(
    pcm,
    { sampleRateHz: fromSampleRateHz, channels: 1 },
    { sampleRateHz: 8000, channels: 1 },
  );
}

export function pcmToMulaw(pcm: Buffer): Buffer {
  if (pcm.length % 2 !== 0) {
    throw new Error("PCM buffer length must be divisible by 2");
  }
  const output = Buffer.alloc(pcm.length / 2);
  for (let i = 0; i < output.length; i++) {
    output[i] = linearToMulaw(pcm.readInt16LE(i * 2));
  }
  return output;
}

export function mulawToPcm(mulaw: Buffer): Buffer {
  const output = Buffer.alloc(mulaw.length * 2);
  for (let i = 0; i < mulaw.length; i++) {
    output.writeInt16LE(mulawToLinear(mulaw[i] ?? 0), i * 2);
  }
  return output;
}

export function convertPcmToMulaw8k(pcm: Buffer, fromSampleRateHz = 24000): Buffer {
  return pcmToMulaw(resamplePcmTo8k(pcm, fromSampleRateHz));
}

function linearToMulaw(sample: number): number {
  const BIAS = 0x84;
  const CLIP = 32635;
  let sign = (sample >> 8) & 0x80;
  if (sign !== 0) {
    sample = -sample;
  }
  if (sample > CLIP) {
    sample = CLIP;
  }
  sample += BIAS;

  let exponent = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; mask >>= 1) {
    exponent--;
  }
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

function mulawToLinear(byte: number): number {
  byte = ~byte & 0xff;
  const sign = byte & 0x80;
  const exponent = (byte >> 4) & 0x07;
  const mantissa = byte & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  return sign !== 0 ? -sample : sample;
}
