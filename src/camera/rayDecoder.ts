import type { AppCameraRays } from "../generated/rustplus.js";

export interface RaySample {
  /** Normalized ray-marched distance, 0-1 */
  distance: number;
  /** Normalized surface alignment (how head-on the ray hit), 0-1 */
  alignment: number;
  /** Raw material index of the hit surface */
  material: number;
}

const LOOKBACK_SIZE = 64;

/**
 * Deterministic PRNG used to build the fixed pixel-shuffle order used by CCTV frame rendering.
 * This must stay a byte-for-byte port of the Rust+ companion app's own generator - the server's
 * `sampleOffset` values index into that exact same shuffle, so any "cleanup" here (even one that
 * looks like a bug fix, e.g. the asymmetric int32->uint32 conversion below) would desync the image.
 */
class SeededXorShift32 {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
    this.advance();
  }

  nextInt(exclusiveMax: number): number {
    let value = ((this.advance() * (exclusiveMax | 0)) / 4294967295) | 0;
    if (value < 0) {
      value = exclusiveMax + value - 1;
    }
    return value | 0;
  }

  /** Advances the xorshift32 state and returns the state from *before* this call. */
  private advance(): number {
    const previous = this.state;
    let state = this.state;
    state = (state ^ (state << 13)) | 0;
    state = (state ^ (state >>> 17)) | 0;
    state = (state ^ (state << 5)) | 0;
    this.state = state;
    return previous >= 0 ? previous : 4294967295 + previous - 1;
  }
}

/**
 * Builds the fixed pixel write-order used to interpret each ray sample's `sampleOffset`.
 * Raster-order (x, y) pairs, seeded-shuffled with SeededXorShift32(1337).
 */
export function buildShuffledSamplePositions(width: number, height: number): Int16Array {
  const positions = new Int16Array(width * height * 2);
  let cursor = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      positions[cursor++] = x;
      positions[cursor++] = y;
    }
  }

  const rng = new SeededXorShift32(1337);
  for (let i = width * height - 1; i >= 1; i--) {
    const a = 2 * i;
    const b = 2 * rng.nextInt(i + 1);
    const ax = positions[a]!;
    const ay = positions[a + 1]!;
    positions[a] = positions[b]!;
    positions[a + 1] = positions[b + 1]!;
    positions[b] = ax;
    positions[b + 1] = ay;
  }

  return positions;
}

/** Hashes a sample into a lookback cache slot, matching the encoder's own hash. */
function hashSample(distance: number, alignment: number, material: number): number {
  return (3 * ((distance / 128) | 0) + 5 * ((alignment / 16) | 0) + 7 * material) & 63;
}

/**
 * Decodes one frame's ray data stream into `output`, indexed by pixel (x + y * width).
 *
 * The wire format is an LZ-style stream of ray samples: each sample is stored either in full
 * (tag byte 0xFF for an 8-bit material, or any other tag byte with top bits `11` for a 6-bit
 * material packed into the tag itself) or as a reference/delta against one of 64 previously
 * seen samples, keyed by `hashSample`. This format isn't documented by Facepunch; it was
 * reverse engineered from the Rust+ companion app's own renderer and is ported here byte-for-byte.
 */
export function decodeFrameInto(
  frame: AppCameraRays,
  output: (RaySample | undefined)[],
  samplePositions: Int16Array,
  width: number,
  height: number,
): void {
  const rayData = frame.rayData;
  const lookback: [number, number, number][] = Array.from({ length: LOOKBACK_SIZE }, () => [0, 0, 0]);

  let sampleOffset = 2 * frame.sampleOffset;
  let pointer = 0;

  while (pointer < rayData.length - 1) {
    const tag = rayData[pointer++]!;
    let distance: number;
    let alignment: number;
    let material: number;

    if (tag === 0xff) {
      // Extended full sample: 8-bit material.
      const b0 = rayData[pointer++]!;
      const b1 = rayData[pointer++]!;
      const b2 = rayData[pointer++]!;
      distance = (b0 << 2) | (b1 >> 6);
      alignment = b1 & 63;
      material = b2;
      lookback[hashSample(distance, alignment, material)] = [distance, alignment, material];
    } else {
      const kind = tag & 192;

      if (kind === 0) {
        // Repeat a cached sample verbatim.
        [distance, alignment, material] = lookback[tag & 63]!;
      } else if (kind === 64) {
        // Small delta against a cached sample: 5 bits of distance delta, 3 bits of alignment delta.
        const cached = lookback[tag & 63]!;
        const delta = rayData[pointer++]!;
        distance = cached[0] + ((delta >> 3) - 15);
        alignment = cached[1] + ((delta & 7) - 3);
        material = cached[2];
      } else if (kind === 128) {
        // Distance-only delta against a cached sample.
        const cached = lookback[tag & 63]!;
        const delta = rayData[pointer++]!;
        distance = cached[0] + (delta - 127);
        alignment = cached[1];
        material = cached[2];
      } else {
        // Compact full sample: 6-bit material packed into the tag byte itself.
        const b0 = rayData[pointer++]!;
        const b1 = rayData[pointer++]!;
        distance = (b0 << 2) | (b1 >> 6);
        alignment = b1 & 63;
        material = tag & 63;
        lookback[hashSample(distance, alignment, material)] = [distance, alignment, material];
      }
    }

    sampleOffset %= 2 * width * height;
    const x = samplePositions[sampleOffset++]!;
    const y = samplePositions[sampleOffset++]!;
    output[x + y * width] = { distance: distance / 1023, alignment: alignment / 63, material };
  }
}
