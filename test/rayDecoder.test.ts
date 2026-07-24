import { describe, expect, test } from "bun:test";
import { buildShuffledSamplePositions, decodeFrameInto, type RaySample } from "../src/camera/rayDecoder.js";
import type { AppCameraRays } from "../src/generated/rustplus.js";

function makeFrame(sampleOffset: number, rayData: number[]): AppCameraRays {
  return {
    verticalFov: 0,
    sampleOffset,
    rayData: new Uint8Array(rayData),
    distance: 0,
    entities: [],
  };
}

describe("buildShuffledSamplePositions", () => {
  test("is deterministic for a fixed seed", () => {
    const a = buildShuffledSamplePositions(5, 4);
    const b = buildShuffledSamplePositions(5, 4);
    expect([...a]).toEqual([...b]);
  });

  test("is a valid permutation of every pixel coordinate", () => {
    const width = 6;
    const height = 5;
    const positions = buildShuffledSamplePositions(width, height);

    const seen = new Set<string>();
    for (let i = 0; i < width * height; i++) {
      const x = positions[2 * i]!;
      const y = positions[2 * i + 1]!;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(width);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(height);
      seen.add(`${x},${y}`);
    }
    expect(seen.size).toBe(width * height);
  });
});

describe("decodeFrameInto", () => {
  test("decodes full, repeat, delta and compact-full samples matching the wire format", () => {
    const width = 2;
    const height = 2;
    const positions = buildShuffledSamplePositions(width, height);
    const pixelAt = (slot: number) => {
      const x = positions[2 * slot]!;
      const y = positions[2 * slot + 1]!;
      return x + y * width;
    };

    // Sample A: extended full sample (tag 0xFF), distance=256, alignment=10, material=200.
    // Sample B: repeat, referencing A's cache slot (hash(256,10,200) & 63 === 62).
    // Sample C: small delta off the same cache slot (+2 distance, -3 alignment).
    // Sample D: distance-only delta off the same cache slot (+3 distance).
    // Sample E: compact full sample (tag top bits `11`), distance=100, alignment=20, material=45;
    //           wraps sampleOffset back around and overwrites A's pixel.
    const rayData = [
      0xff, 64, 10, 200, // A
      62, // B: repeat cache slot 62
      126, 136, // C: small delta, cache slot 62
      190, 130, // D: distance delta, cache slot 62
      237, 25, 20, // E: compact full sample, material 45
      0x00, // trailing pad byte (never read - mirrors upstream's `length - 1` guard)
    ];

    const output: (RaySample | undefined)[] = new Array(width * height);
    decodeFrameInto(makeFrame(0, rayData), output, positions, width, height);

    expect(output[pixelAt(0)]).toEqual({ distance: 100 / 1023, alignment: 20 / 63, material: 45 }); // E overwrote A
    expect(output[pixelAt(1)]).toEqual({ distance: 256 / 1023, alignment: 10 / 63, material: 200 }); // B
    expect(output[pixelAt(2)]).toEqual({ distance: 258 / 1023, alignment: 7 / 63, material: 200 }); // C
    expect(output[pixelAt(3)]).toEqual({ distance: 259 / 1023, alignment: 10 / 63, material: 200 }); // D
  });

  test("leaves pixels untouched when no sample targets them", () => {
    const width = 4;
    const height = 4;
    const positions = buildShuffledSamplePositions(width, height);
    const output: (RaySample | undefined)[] = new Array(width * height);

    decodeFrameInto(makeFrame(0, [0xff, 0, 0, 1]), output, positions, width, height);

    const definedCount = output.filter((sample) => sample !== undefined).length;
    expect(definedCount).toBe(1);
  });
});
