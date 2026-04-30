import { describe, expect, it } from "vitest";
import {
  convertPcmToMulaw8k,
  mulawToPcm,
  pcmToMulaw,
  resamplePcm,
  resamplePcmTo8k,
} from "./audio-codec.js";

function pcmFromSamples(samples: number[]): Buffer {
  const buffer = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => buffer.writeInt16LE(sample, index * 2));
  return buffer;
}

describe("realtime voice audio codec", () => {
  it("resamples mono PCM by sample-rate ratio", () => {
    const input = pcmFromSamples([0, 1000, 2000, 3000, 4000, 5000]);

    const output = resamplePcm(
      input,
      { sampleRateHz: 24000, channels: 1 },
      { sampleRateHz: 8000, channels: 1 },
    );

    expect(output.length).toBe(4);
    expect(output.readInt16LE(0)).toBe(0);
    expect(output.readInt16LE(2)).toBe(3000);
  });

  it("resamples 24k PCM to 8k PCM", () => {
    const input = pcmFromSamples([0, 1000, 2000, 3000, 4000, 5000]);

    expect(resamplePcmTo8k(input).length).toBe(4);
  });

  it("encodes and decodes mu-law audio", () => {
    const pcm = pcmFromSamples([-12000, -1000, 0, 1000, 12000]);

    const encoded = pcmToMulaw(pcm);
    const decoded = mulawToPcm(encoded);

    expect(encoded.length).toBe(5);
    expect(decoded.length).toBe(pcm.length);
    expect(Math.abs(decoded.readInt16LE(4))).toBeLessThanOrEqual(132);
  });

  it("converts 24k PCM to 8k mu-law", () => {
    const pcm = pcmFromSamples([0, 1000, 2000, 3000, 4000, 5000]);

    expect(convertPcmToMulaw8k(pcm).length).toBe(2);
  });

  it("rejects malformed PCM buffers", () => {
    expect(() =>
      resamplePcm(
        Buffer.from([1]),
        { sampleRateHz: 24000, channels: 1 },
        { sampleRateHz: 8000, channels: 1 },
      ),
    ).toThrow("PCM buffer length must be divisible by 2");
  });
});
