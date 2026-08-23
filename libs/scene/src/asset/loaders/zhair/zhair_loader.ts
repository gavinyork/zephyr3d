/**
 * Turns a parsed `.zhair` file into strand sources ready for the GPU.
 *
 * @remarks
 * The file stores hair at full authored density, which for a production groom is
 * around 69,000 strands of 30 control points. Drawing all of them is not always
 * wanted, so decimation happens here rather than at conversion time: the node
 * owning the hair exposes the knobs, and turning one re-runs this against the
 * same file. Going back to the source archive is never required.
 */
import type { Nullable } from '@zephyr3d/base';
import type { HairStrandSource } from '../../../material/hairstrand_data';
import type { ParsedZHair, ZHairStrandSetJSON } from './zhair_format';
import { readZHairFloats, readZHairUints } from './zhair_format';

/**
 * How much of a `.zhair` file to keep.
 *
 * @public
 */
export type ZHairLoadOptions = {
  /**
   * Keep one strand in every `strandStride`.
   *
   * @remarks
   * Decimating by a stride rather than by taking a leading slice keeps the kept
   * strands spread over the whole scalp; a slice would leave a bald patch,
   * because strands are stored in the order the groom generated them.
   * Defaults to 1, which keeps everything.
   */
  strandStride?: number;
  /**
   * Upper bound on the number of strands kept, across all sets.
   *
   * @remarks
   * Applied on top of `strandStride` by widening the stride further, so the
   * result stays evenly spread instead of stopping partway through the groom.
   */
  maxStrands?: number;
  /**
   * Scale applied to positions and widths alike.
   *
   * @remarks
   * Defaults to the file's own `unitScale`. Width is a length in the same unit
   * as position, so the two must convert together - leaving width unscaled makes
   * strands a hundred times too thick and they read as ribbons rather than hair.
   */
  scale?: number;
  /** Extra multiplier on width only, for art direction. Defaults to 1. */
  widthScale?: number;
};

/**
 * Decodes a `.zhair` file into strand sources.
 *
 * @param parsed - The opened file.
 * @param options - Decimation and scaling.
 * @returns One source per strand set, ready for `HairStrandData`.
 *
 * @public
 */
export function loadZHairStrandSources(parsed: ParsedZHair, options?: ZHairLoadOptions): HairStrandSource[] {
  const sets = parsed.content.strandSets;
  const scale = options?.scale ?? parsed.content.unitScale ?? 1;
  const widthScale = options?.widthScale ?? 1;
  const stride = resolveStride(sets, options);
  const sources: HairStrandSource[] = [];
  for (const set of sets) {
    const source = decodeStrandSet(parsed, set, stride, scale, widthScale);
    if (source) {
      sources.push(source);
    }
  }
  return sources;
}

/**
 * Merges strand sets into one source.
 *
 * @remarks
 * A `.zhair` file holds one set per source curve object, and an XGen archive
 * routinely exports several spline descriptions for a single hairstyle. They
 * share a material and differ only in which patch of scalp they grew from, so
 * merging lets the whole head draw in one call.
 *
 * @param sources - Sources to merge.
 * @returns A single source, or null when there is nothing to merge.
 *
 * @public
 */
export function mergeHairStrandSources(sources: HairStrandSource[]): Nullable<HairStrandSource> {
  if (sources.length === 0) {
    return null;
  }
  if (sources.length === 1) {
    return sources[0];
  }
  let strandCount = 0;
  let pointCount = 0;
  for (const source of sources) {
    strandCount += source.pointCounts.length;
    for (let i = 0; i < source.pointCounts.length; i++) {
      pointCount += source.pointCounts[i];
    }
  }
  const positions = new Float32Array(pointCount * 3);
  const pointCounts = new Uint32Array(strandCount);
  // A channel is only carried into the merge if every set has it: a partially
  // filled width or UV array would read as zero for the sets that lacked it,
  // which is worse than falling back to the defaults uniformly.
  const hasWidths = sources.every((s) => !!s.widths);
  const hasUV = sources.every((s) => !!s.uv);
  // Per-point width and UV are the general case; a per-strand array is expanded
  // rather than tracked, so the merged source has one layout to describe.
  const widths = hasWidths ? new Float32Array(pointCount) : null;
  const uv = hasUV ? new Float32Array(pointCount * 2) : null;
  let strandOffset = 0;
  let pointOffset = 0;
  for (const source of sources) {
    const counts = source.pointCounts;
    const scale = source.scale ?? 1;
    const sourceWidthScale = source.widthScale ?? 1;
    let sourcePoints = 0;
    for (let i = 0; i < counts.length; i++) {
      sourcePoints += counts[i];
    }
    // `HairStrandSource` carries no per-point UV flag; it is inferred from the
    // array length, and the inference has to match the one `HairStrandData`
    // makes or the merged UVs would be read against a different layout.
    const sourceUVPerPoint = !!source.uv && source.uv.length >= sourcePoints * 2;
    let localPoint = 0;
    for (let s = 0; s < counts.length; s++) {
      const count = counts[s];
      pointCounts[strandOffset + s] = count;
      for (let i = 0; i < count; i++) {
        const src = (localPoint + i) * 3;
        const dst = (pointOffset + i) * 3;
        // Per-source scale is baked in here, because the merged source carries a
        // single scale and the sets may have come from files with different units.
        positions[dst] = source.positions[src] * scale;
        positions[dst + 1] = source.positions[src + 1] * scale;
        positions[dst + 2] = source.positions[src + 2] * scale;
        if (widths) {
          const w = source.widthPerStrand ? source.widths![s] : source.widths![localPoint + i];
          widths[pointOffset + i] = w * scale * sourceWidthScale;
        }
        if (uv) {
          const uvSrc = source.uv!;
          // Expanding a per-strand UV to per-point costs a little memory and
          // removes a flag from everything downstream.
          const o = sourceUVPerPoint ? (localPoint + i) * 2 : s * 2;
          uv[(pointOffset + i) * 2] = uvSrc[o];
          uv[(pointOffset + i) * 2 + 1] = uvSrc[o + 1];
        }
      }
      localPoint += count;
      pointOffset += count;
    }
    strandOffset += counts.length;
  }
  return {
    positions,
    pointCounts,
    widths,
    widthPerStrand: false,
    uv,
    // Everything has been converted already, so the merged source must not be
    // scaled a second time.
    scale: 1,
    widthScale: 1,
    defaultWidth: sources[0].defaultWidth
  };
}

/**
 * Picks a stride that honours both `strandStride` and `maxStrands`.
 * @internal
 */
function resolveStride(sets: ZHairStrandSetJSON[], options?: ZHairLoadOptions): number {
  let stride = Math.max(1, Math.floor(options?.strandStride ?? 1));
  const maxStrands = options?.maxStrands ?? 0;
  if (maxStrands > 0) {
    let total = 0;
    for (const set of sets) {
      total += Math.ceil(set.strandCount / stride);
    }
    if (total > maxStrands) {
      let authored = 0;
      for (const set of sets) {
        authored += set.strandCount;
      }
      stride = Math.max(stride, Math.ceil(authored / maxStrands));
    }
  }
  return stride;
}

/**
 * Decodes one strand set, keeping one strand in every `stride`.
 * @internal
 */
function decodeStrandSet(
  parsed: ParsedZHair,
  set: ZHairStrandSetJSON,
  stride: number,
  scale: number,
  widthScale: number
): Nullable<HairStrandSource> {
  const allCounts = readZHairUints(parsed, set.pointCounts);
  const allPositions = readZHairFloats(parsed, set.positions)!;
  const allWidths = readZHairFloats(parsed, set.widths);
  const allUV = readZHairFloats(parsed, set.uv);
  const widthPerStrand = !!set.widthPerStrand;
  const uvPerPoint = !!set.uvPerPoint;

  if (stride <= 1) {
    return {
      positions: allPositions,
      pointCounts: allCounts,
      widths: allWidths,
      widthPerStrand,
      uv: allUV,
      scale,
      widthScale
    };
  }

  // Walking the whole count array is unavoidable even when most strands are
  // dropped, because a strand's first point index is the sum of all counts
  // before it and the file stores no index.
  const keptStrands: number[] = [];
  const firstPoints: number[] = [];
  let first = 0;
  let keptPoints = 0;
  for (let s = 0; s < allCounts.length; s++) {
    if (s % stride === 0) {
      keptStrands.push(s);
      firstPoints.push(first);
      keptPoints += allCounts[s];
    }
    first += allCounts[s];
  }
  if (keptStrands.length === 0 || keptPoints === 0) {
    return null;
  }

  const positions = new Float32Array(keptPoints * 3);
  const pointCounts = new Uint32Array(keptStrands.length);
  const widths = allWidths ? new Float32Array(widthPerStrand ? keptStrands.length : keptPoints) : null;
  const uv = allUV ? new Float32Array((uvPerPoint ? keptPoints : keptStrands.length) * 2) : null;
  let dstPoint = 0;
  for (let k = 0; k < keptStrands.length; k++) {
    const s = keptStrands[k];
    const count = allCounts[s];
    const srcFirst = firstPoints[k];
    pointCounts[k] = count;
    positions.set(allPositions.subarray(srcFirst * 3, (srcFirst + count) * 3), dstPoint * 3);
    if (widths) {
      if (widthPerStrand) {
        widths[k] = allWidths![s];
      } else {
        widths.set(allWidths!.subarray(srcFirst, srcFirst + count), dstPoint);
      }
    }
    if (uv) {
      if (uvPerPoint) {
        uv.set(allUV!.subarray(srcFirst * 2, (srcFirst + count) * 2), dstPoint * 2);
      } else {
        uv[k * 2] = allUV![s * 2];
        uv[k * 2 + 1] = allUV![s * 2 + 1];
      }
    }
    dstPoint += count;
  }
  return {
    positions,
    pointCounts,
    widths,
    widthPerStrand,
    uv,
    scale,
    widthScale
  };
}
