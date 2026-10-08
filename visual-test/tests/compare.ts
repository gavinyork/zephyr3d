import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { CI_PLATFORM, computeDigest } from './digest';
import type { DigestFile } from './digest_file';
import { describeFetchError, type ImageStore } from './image_store';

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
 * Compares a capture against its per-machine PNG baseline (the real-GPU projects).
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

  const { diff, diffPixels, diffRatio } = diffImages(expected.data, rgba, width, height, threshold);

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

/** A capture that missed its digest, kept for later acceptance. */
export interface CaptureRecord {
  project: string;
  convention: string;
  scene: string;
  platform: string;
  digest: string;
  size: number;
  status: string;
  /** False for a scene marked nondeterministic; `update-from-ci` skips those. */
  deterministic?: boolean;
  /** Environment the capture was rendered in, recorded with an accepted digest. */
  environment?: { playwright?: string; chromium?: string; adapter?: string };
  png: Buffer;
}

export function encodeCapturePng(rgba: Buffer, width: number, height: number): Buffer {
  return encodePng(rgba, width, height);
}

/**
 * Writes `<dir>/<project>.<convention>/<scene>.{json,png}`, overwriting any
 * earlier capture of the scene. Read by tools/baselines.mjs (`accept`,
 * `update-from-ci`); the JSON fields are that tool's input format.
 */
export function recordCapture(dir: string, record: CaptureRecord): void {
  const sub = path.join(dir, `${record.project}.${record.convention}`);
  fs.mkdirSync(sub, { recursive: true });
  const { png, ...meta } = record;
  fs.writeFileSync(path.join(sub, `${record.scene}.png`), png);
  fs.writeFileSync(path.join(sub, `${record.scene}.json`), JSON.stringify(meta, null, 2) + '\n');
}

function diffImages(expected: Buffer, actual: Buffer, width: number, height: number, threshold: number) {
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(expected, actual, diff.data, width, height, {
    threshold,
    includeAA: false
  });
  return { diff, diffPixels, diffRatio: diffPixels / (width * height) };
}

export type JudgeStatus =
  | 'match'
  | 'tolerant-match'
  | 'mismatch'
  | 'baseline-missing'
  | 'reference-unavailable'
  | 'baseline-written';

export interface JudgeOptions {
  scene: string;
  /** Platform key the capture was taken on, see `platformKey()`. */
  platform: string;
  digests: DigestFile;
  images: ImageStore;
  tolerance?: CompareOptions;
  /** False for a scene known to vary run to run; a digest miss is then expected. */
  deterministic?: boolean;
  /** UPDATE_BASELINES: accept the capture instead of failing. */
  update: boolean;
  artifactDir: string;
}

export interface JudgeOutcome {
  status: JudgeStatus;
  digest: string;
  /** Image the capture was compared against, when a comparison happened. */
  reference: { platform: string; digest: string } | null;
  diffPixels: number;
  diffRatio: number;
  message: string;
  /** True when the digest file was changed and needs saving. */
  digestsChanged: boolean;
  artifacts: { name: string; path: string }[];
}

/**
 * Judges a capture against the committed digests.
 *
 * A digest the platform has accepted passes without reading any image. On a
 * miss the capture is compared by tolerance against a reference image: the
 * platform's own primary, or the CI platform's when this platform has none yet.
 * That second tier keeps the semantics of the PNG baselines it replaces -
 * anything within tolerance of the reference passed before and still passes -
 * while a hit costs nothing. The image store is only consulted on a miss, and
 * an image that cannot be found is reported as unavailable, not as a regression.
 */
export async function judgeCapture(
  rgba: Buffer,
  width: number,
  height: number,
  opts: JudgeOptions
): Promise<JudgeOutcome> {
  const threshold = opts.tolerance?.threshold ?? DEFAULT_TOLERANCE.threshold;
  const maxDiffPixelRatio = opts.tolerance?.maxDiffPixelRatio ?? DEFAULT_TOLERANCE.maxDiffPixelRatio;
  const digest = computeDigest(rgba, width, height);
  const artifacts: JudgeOutcome['artifacts'] = [];
  const outcome = (
    status: JudgeStatus,
    message: string,
    extra: Partial<JudgeOutcome> = {}
  ): JudgeOutcome => ({
    status,
    digest,
    reference: null,
    diffPixels: 0,
    diffRatio: 0,
    message,
    digestsChanged: false,
    artifacts,
    ...extra
  });
  const accept = (message: string, extra: Partial<JudgeOutcome> = {}) => {
    opts.digests.accept(opts.scene, opts.platform, digest, width, 'replace');
    const imagePath = opts.images.put(digest, encodePng(rgba, width, height));
    return outcome('baseline-written', `${message}\nimage: ${imagePath}`, { ...extra, digestsChanged: true });
  };
  const writeActual = () =>
    writeArtifact(opts.artifactDir, 'actual.png', encodePng(rgba, width, height), artifacts);

  const entry = opts.digests.get(opts.scene);
  const own = entry && entry.size === width ? (entry.accepted[opts.platform] ?? []) : [];
  if (own.includes(digest)) {
    return outcome('match', `digest ${digest} accepted on ${opts.platform}`);
  }

  // Reference: this platform's primary, else the CI platform's, else any.
  let reference: JudgeOutcome['reference'] = null;
  if (entry) {
    for (const platform of [opts.platform, CI_PLATFORM, ...Object.keys(entry.accepted).sort()]) {
      const list = entry.accepted[platform];
      if (list?.length) {
        reference = { platform, digest: list[0] };
        break;
      }
    }
  }
  if (!reference) {
    if (opts.update) {
      return accept(`baseline created for ${opts.scene} on ${opts.platform}`);
    }
    const actualPath = writeActual();
    return outcome(
      'baseline-missing',
      `no digest recorded for ${opts.scene}\nInspect ${actualPath}, then run with UPDATE_BASELINES=1 to accept it.`
    );
  }

  let refPng: Buffer | null;
  try {
    refPng = await opts.images.get(reference.digest);
  } catch (err) {
    // The image may well exist: never accept over it, or a network hiccup
    // during an update would silently replace the baseline.
    writeActual();
    return outcome(
      'reference-unavailable',
      `digest ${digest} is not accepted, and reference image ${reference.digest} (${reference.platform}) ` +
        `is not cached and the image store could not be reached (${describeFetchError(err)}); ` +
        'check the network and rerun, or run "npm run baselines:fetch" once it is reachable',
      { reference }
    );
  }
  if (!refPng) {
    if (opts.update) {
      return accept(`baseline replaced for ${opts.scene} on ${opts.platform} (reference image unavailable)`, {
        reference
      });
    }
    writeActual();
    return outcome(
      'reference-unavailable',
      `digest ${digest} is not accepted, and reference image ${reference.digest} (${reference.platform}) ` +
        'is neither cached nor in the image store: it was never pushed, or was garbage-collected; ' +
        'run "npm run baselines:push" on the machine that accepted it',
      { reference }
    );
  }

  const expected = PNG.sync.read(refPng);
  if (expected.width !== width || expected.height !== height) {
    if (opts.update) {
      return accept(`baseline replaced for ${opts.scene}: capture size changed`, { reference });
    }
    writeActual();
    return outcome(
      'mismatch',
      `reference is ${expected.width}x${expected.height} but capture is ${width}x${height}`,
      { reference }
    );
  }

  const { diff, diffPixels, diffRatio } = diffImages(expected.data, rgba, width, height, threshold);
  const stats = { reference, diffPixels, diffRatio };
  const summary = `${diffPixels} px differ (${(diffRatio * 100).toFixed(4)}%)`;
  if (diffRatio <= maxDiffPixelRatio) {
    // This platform has nothing of its own yet: an update records one, so later
    // runs hit the digest instead of comparing every time.
    if (opts.update && own.length === 0) {
      return accept(`digest recorded for ${opts.scene} on ${opts.platform}`, stats);
    }
    const why =
      opts.deterministic === false
        ? 'scene is marked nondeterministic'
        : own.length === 0
          ? `no ${opts.platform} digest, compared against ${reference.platform}`
          : 'digest not accepted';
    return outcome(
      'tolerant-match',
      `${summary}, within ${(maxDiffPixelRatio * 100).toFixed(4)}% (${why})`,
      stats
    );
  }
  if (opts.update) {
    return accept(`baseline replaced for ${opts.scene} on ${opts.platform} (${summary})`, stats);
  }
  writeArtifact(opts.artifactDir, 'expected.png', refPng, artifacts);
  writeActual();
  writeArtifact(opts.artifactDir, 'diff.png', PNG.sync.write(diff), artifacts);
  return outcome(
    'mismatch',
    `${summary}, over the ${(maxDiffPixelRatio * 100).toFixed(4)}% budget, against the ` +
      `${reference.platform} reference ${reference.digest}\nSee the expected/actual/diff attachments on this test.`,
    stats
  );
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
