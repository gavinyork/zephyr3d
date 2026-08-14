import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

/**
 * Default tolerance.
 *
 * Deliberately near-exact. The Step 0 spike showed a software rasteriser is
 * byte-reproducible run to run, so on the gating projects the honest default is
 * "no difference at all". `threshold: 0` still permits nothing; the small
 * non-zero value below only absorbs a single least-significant-bit wobble,
 * which is what a shader-compiler version bump tends to produce.
 *
 * Loosening these globally would defeat the harness. Scenes with genuine noise
 * override per-scene via `VisualScene.tolerance`, which documents itself in the
 * scene file.
 */
export const DEFAULT_TOLERANCE = {
  threshold: 0.02,
  maxDiffPixelRatio: 0.0005
};

export interface CompareOptions {
  threshold?: number;
  maxDiffPixelRatio?: number;
}

export interface CompareOutcome {
  status: 'match' | 'mismatch' | 'baseline-written' | 'baseline-missing' | 'size-mismatch';
  diffPixels: number;
  diffRatio: number;
  totalPixels: number;
  threshold: number;
  maxDiffPixelRatio: number;
  message: string;
  /** Paths of artefacts written for this comparison, for attaching to the report. */
  artifacts: { name: string; path: string }[];
}

function encodePng(rgba: Buffer, width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  rgba.copy(png.data);
  return PNG.sync.write(png);
}

/**
 * Writes just the capture, for failures that abort before any comparison.
 *
 * A scene that renders blank fails the uniformity guard rather than the pixel
 * comparison, and without this the author is told "near-uniform image" and given
 * nothing to look at - which is the least useful moment to withhold the image.
 */
export function writeActualOnly(
  rgba: Buffer,
  width: number,
  height: number,
  artifactDir: string
): { name: string; path: string }[] {
  const artifacts: { name: string; path: string }[] = [];
  writeArtifact(artifactDir, 'actual.png', encodePng(rgba, width, height), artifacts);
  return artifacts;
}

/**
 * Compares a capture against its committed baseline.
 *
 * A missing baseline is a failure unless UPDATE_BASELINES is set. Silently
 * writing one on first run is the failure mode that matters most here: a
 * forgotten `git add` would leave the scene permanently green against a
 * baseline regenerated from whatever the code currently does.
 */
export function compareToBaseline(
  rgba: Buffer,
  width: number,
  height: number,
  baselinePath: string,
  artifactDir: string,
  opts: CompareOptions = {}
): CompareOutcome {
  const threshold = opts.threshold ?? DEFAULT_TOLERANCE.threshold;
  const maxDiffPixelRatio = opts.maxDiffPixelRatio ?? DEFAULT_TOLERANCE.maxDiffPixelRatio;
  const totalPixels = width * height;
  const update = !!process.env.UPDATE_BASELINES;
  const artifacts: CompareOutcome['artifacts'] = [];

  const base = {
    diffPixels: 0,
    diffRatio: 0,
    totalPixels,
    threshold,
    maxDiffPixelRatio,
    artifacts
  };

  if (!fs.existsSync(baselinePath)) {
    if (update) {
      fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
      fs.writeFileSync(baselinePath, encodePng(rgba, width, height));
      return {
        ...base,
        status: 'baseline-written',
        message: `baseline created: ${baselinePath}`
      };
    }
    // Still emit the actual image - otherwise the author has nothing to inspect
    // before deciding whether the new baseline is even correct.
    const actualPath = writeArtifact(artifactDir, 'actual.png', encodePng(rgba, width, height), artifacts);
    return {
      ...base,
      status: 'baseline-missing',
      message:
        `no baseline at ${baselinePath}\n` +
        `Inspect ${actualPath}, then run with UPDATE_BASELINES=1 to accept it.`
    };
  }

  const expected = PNG.sync.read(fs.readFileSync(baselinePath));
  if (expected.width !== width || expected.height !== height) {
    return {
      ...base,
      status: 'size-mismatch',
      message: `baseline is ${expected.width}x${expected.height} but capture is ${width}x${height}; delete the baseline and re-accept it if the capture size changed on purpose`
    };
  }

  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(expected.data, rgba, diff.data, width, height, {
    threshold,
    includeAA: false
  });
  const diffRatio = diffPixels / totalPixels;

  if (diffRatio <= maxDiffPixelRatio) {
    return {
      ...base,
      status: 'match',
      diffPixels,
      diffRatio,
      message: `${diffPixels} px differ (${(diffRatio * 100).toFixed(4)}%), within ${(maxDiffPixelRatio * 100).toFixed(4)}%`
    };
  }

  if (update) {
    fs.writeFileSync(baselinePath, encodePng(rgba, width, height));
    return {
      ...base,
      status: 'baseline-written',
      diffPixels,
      diffRatio,
      message: `baseline updated (${diffPixels} px had differed): ${baselinePath}`
    };
  }

  writeArtifact(artifactDir, 'expected.png', fs.readFileSync(baselinePath), artifacts);
  writeArtifact(artifactDir, 'actual.png', encodePng(rgba, width, height), artifacts);
  writeArtifact(artifactDir, 'diff.png', PNG.sync.write(diff), artifacts);
  return {
    ...base,
    status: 'mismatch',
    diffPixels,
    diffRatio,
    message:
      `${diffPixels} px differ (${(diffRatio * 100).toFixed(4)}%), over the ${(maxDiffPixelRatio * 100).toFixed(4)}% budget\n` +
      `See the expected/actual/diff attachments on this test.`
  };
}

function writeArtifact(
  dir: string,
  name: string,
  data: Buffer,
  artifacts: CompareOutcome['artifacts']
): string {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, data);
  artifacts.push({ name, path: p });
  return p;
}
