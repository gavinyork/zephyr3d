import { createHash } from 'node:crypto';

/**
 * Pixel digest of a capture.
 *
 * Hashes the row-normalized RGBA buffer, not an encoded PNG: PNG bytes depend on
 * the encoder and its settings, so identical pixels can encode differently. The
 * format tag and the dimensions are part of the input, so a size change can never
 * collide with an old digest and a future change of the hashed input invalidates
 * every digest at once instead of silently matching. Truncated to 128 bits.
 */
export function computeDigest(rgba: Uint8Array, width: number, height: number): string {
  const header = Buffer.alloc(12);
  header.write('zvt1', 0, 'ascii');
  header.writeUInt32LE(width, 4);
  header.writeUInt32LE(height, 8);
  return createHash('sha256').update(header).update(rgba).digest('hex').slice(0, 32);
}

/**
 * Platform whose digests are authoritative: the one CI runs on. A platform with
 * no digest of its own for a scene falls back to this one's reference image.
 */
export const CI_PLATFORM = 'linux-x64';

/** Platform key digests are recorded under, e.g. `linux-x64`. */
export function platformKey(): string {
  return `${process.platform}-${process.arch}`;
}
