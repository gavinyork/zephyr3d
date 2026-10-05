import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { judgeCapture, type JudgeOptions } from './compare';
import { CI_PLATFORM, computeDigest } from './digest';
import { DigestFile, MAX_ACCEPTED_DIGESTS } from './digest_file';
import { ImageStore, type ImageSource } from './image_store';

const W = 8;
const H = 8;
const OTHER_PLATFORM = 'win32-x64';

/** A solid image with one pixel optionally changed. */
function image(base: number, tweak?: { index: number; value: number }): Buffer {
  const rgba = Buffer.alloc(W * H * 4, base);
  for (let i = 3; i < rgba.length; i += 4) {
    rgba[i] = 255;
  }
  if (tweak) {
    rgba.fill(tweak.value, tweak.index * 4, tweak.index * 4 + 3);
  }
  return rgba;
}

function png(rgba: Buffer, w = W, h = H): Buffer {
  const p = new PNG({ width: w, height: h });
  rgba.copy(p.data);
  return PNG.sync.write(p);
}

class MemorySource implements ImageSource {
  readonly images = new Map<string, Buffer>();
  fetched = 0;
  async get(digest: string) {
    this.fetched++;
    return this.images.get(digest) ?? null;
  }
}

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zvt-unit-'));
  const remote = new MemorySource();
  const digests = DigestFile.load(path.join(dir, 'digests', 'p.reverse.json'));
  const images = new ImageStore(path.join(dir, 'cache'), remote);
  const opts = (extra: Partial<JudgeOptions> = {}): JudgeOptions => ({
    scene: 's',
    platform: CI_PLATFORM,
    digests,
    images,
    update: false,
    artifactDir: path.join(dir, 'artifacts'),
    ...extra
  });
  /** Records `rgba` as accepted on `platform`, with its image published remotely. */
  const record = (rgba: Buffer, platform = CI_PLATFORM) => {
    const d = computeDigest(rgba, W, H);
    digests.accept('s', platform, d, W, 'replace');
    remote.images.set(d, png(rgba));
    return d;
  };
  return { dir, remote, digests, images, opts, record };
}

test.describe('digest', () => {
  test('depends on pixels and dimensions, not on encoding', () => {
    const a = image(10);
    expect(computeDigest(a, W, H)).toBe(computeDigest(Buffer.from(a), W, H));
    expect(computeDigest(a, W, H)).not.toBe(computeDigest(image(10, { index: 3, value: 11 }), W, H));
    // Same bytes, different shape.
    expect(computeDigest(a, W, H)).not.toBe(computeDigest(a, W * 2, H / 2));
    expect(computeDigest(a, W, H)).toMatch(/^[0-9a-f]{32}$/);
  });
});

test.describe('judgeCapture', () => {
  test('an accepted digest passes without reading any image', async () => {
    const { remote, opts, record } = setup();
    const a = image(10);
    record(a);
    const r = await judgeCapture(a, W, H, opts());
    expect(r.status).toBe('match');
    expect(remote.fetched).toBe(0);
    expect(r.digestsChanged).toBe(false);
  });

  test('any accepted digest of the platform passes, not only the primary', async () => {
    const { digests, opts, record } = setup();
    record(image(10));
    const b = image(10, { index: 0, value: 200 });
    digests.accept('s', CI_PLATFORM, computeDigest(b, W, H), W, 'append');
    expect((await judgeCapture(b, W, H, opts())).status).toBe('match');
  });

  test('a scene with no digest at all fails, and an update creates it', async () => {
    const { digests, images, opts } = setup();
    const a = image(10);
    const miss = await judgeCapture(a, W, H, opts());
    expect(miss.status).toBe('baseline-missing');
    expect(miss.artifacts.map((x) => x.name)).toEqual(['actual.png']);

    const upd = await judgeCapture(a, W, H, opts({ update: true }));
    expect(upd.status).toBe('baseline-written');
    expect(upd.digestsChanged).toBe(true);
    expect(digests.get('s')!.accepted[CI_PLATFORM]).toEqual([upd.digest]);
    expect(images.pending()).toEqual([upd.digest]);
    expect(fs.existsSync(images.cachePath(upd.digest))).toBe(true);
  });

  test('a digest miss within tolerance passes as a tolerant match and keeps the baseline', async () => {
    const { digests, opts, record } = setup();
    const d = record(image(10));
    // One pixel off by one level: within the default tolerance.
    const near = image(10, { index: 5, value: 11 });
    for (const update of [false, true]) {
      const r = await judgeCapture(near, W, H, opts({ update }));
      expect(r.status).toBe('tolerant-match');
      expect(r.reference).toEqual({ platform: CI_PLATFORM, digest: d });
    }
    // Within tolerance an update does not rewrite the platform's own baseline.
    expect(digests.get('s')!.accepted[CI_PLATFORM]).toEqual([d]);
  });

  test('a digest miss over tolerance fails with expected/actual/diff, and an update replaces it', async () => {
    const { digests, opts, record } = setup();
    record(image(10));
    const far = image(200);
    const r = await judgeCapture(far, W, H, opts());
    expect(r.status).toBe('mismatch');
    expect(r.artifacts.map((x) => x.name).sort()).toEqual(['actual.png', 'diff.png', 'expected.png']);

    const upd = await judgeCapture(far, W, H, opts({ update: true }));
    expect(upd.status).toBe('baseline-written');
    // Replaced, not appended.
    expect(digests.get('s')!.accepted[CI_PLATFORM]).toEqual([upd.digest]);
  });

  test('a per-scene tolerance decides between tolerant match and mismatch', async () => {
    const { opts, record } = setup();
    record(image(10));
    const changed = image(10, { index: 0, value: 250 });
    expect((await judgeCapture(changed, W, H, opts())).status).toBe('mismatch');
    const loose = await judgeCapture(changed, W, H, opts({ tolerance: { maxDiffPixelRatio: 0.05 } }));
    expect(loose.status).toBe('tolerant-match');
  });

  test('a platform without its own digest is compared against the CI platform', async () => {
    const { digests, opts, record } = setup();
    const ci = record(image(10));
    const r = await judgeCapture(image(10), W, H, opts({ platform: OTHER_PLATFORM }));
    // Identical pixels but nothing accepted on this platform: tolerant, not exact.
    expect(r.status).toBe('tolerant-match');
    expect(r.reference).toEqual({ platform: CI_PLATFORM, digest: ci });
    expect(r.message).toContain(`no ${OTHER_PLATFORM} digest`);

    // An update gives the platform a digest of its own; the CI entry is untouched.
    const upd = await judgeCapture(image(10), W, H, opts({ platform: OTHER_PLATFORM, update: true }));
    expect(upd.status).toBe('baseline-written');
    expect(digests.get('s')!.accepted[OTHER_PLATFORM]).toEqual([upd.digest]);
    expect(digests.get('s')!.accepted[CI_PLATFORM]).toEqual([ci]);
    expect((await judgeCapture(image(10), W, H, opts({ platform: OTHER_PLATFORM }))).status).toBe('match');
  });

  test('a platform with its own digest is compared against its own reference, not the CI one', async () => {
    const { opts, record } = setup();
    record(image(10));
    const own = record(image(100), OTHER_PLATFORM);
    const r = await judgeCapture(
      image(100, { index: 1, value: 101 }),
      W,
      H,
      opts({ platform: OTHER_PLATFORM })
    );
    expect(r.status).toBe('tolerant-match');
    expect(r.reference).toEqual({ platform: OTHER_PLATFORM, digest: own });
  });

  test('a missing reference image is reported as unavailable, not as a regression', async () => {
    const { remote, opts, record } = setup();
    const d = record(image(10));
    remote.images.delete(d);
    const r = await judgeCapture(image(10, { index: 2, value: 11 }), W, H, opts());
    expect(r.status).toBe('reference-unavailable');
    expect(r.message).toContain(d);
  });

  test('reference images are fetched once and then served from the cache', async () => {
    const { remote, opts, record } = setup();
    record(image(10));
    const near = image(10, { index: 4, value: 11 });
    await judgeCapture(near, W, H, opts());
    await judgeCapture(near, W, H, opts());
    expect(remote.fetched).toBe(1);
  });

  test('a capture size change fails, and an update resets every platform', async () => {
    const { digests, opts, record } = setup();
    record(image(10));
    record(image(10), OTHER_PLATFORM);
    const big = Buffer.alloc(W * 2 * H * 2 * 4, 10);
    expect((await judgeCapture(big, W * 2, H * 2, opts())).status).toBe('mismatch');
    const upd = await judgeCapture(big, W * 2, H * 2, opts({ update: true }));
    expect(upd.status).toBe('baseline-written');
    expect(digests.get('s')!.size).toBe(W * 2);
    expect(Object.keys(digests.get('s')!.accepted)).toEqual([CI_PLATFORM]);
  });

  test('a nondeterministic scene says so when it falls back to tolerance', async () => {
    const { opts, record } = setup();
    record(image(10));
    const r = await judgeCapture(image(10, { index: 7, value: 11 }), W, H, opts({ deterministic: false }));
    expect(r.status).toBe('tolerant-match');
    expect(r.message).toContain('nondeterministic');
  });
});

test.describe('DigestFile', () => {
  test('round-trips with sorted keys and keeps the primary first', () => {
    const { dir } = setup();
    const p = path.join(dir, 'digests', 'x.reverse.json');
    const f = DigestFile.load(p);
    f.accept('zeta', CI_PLATFORM, 'b'.repeat(32), 512, 'replace');
    f.accept('alpha', OTHER_PLATFORM, 'd'.repeat(32), 512, 'replace');
    f.accept('alpha', CI_PLATFORM, 'c'.repeat(32), 512, 'replace');
    f.accept('alpha', CI_PLATFORM, 'a'.repeat(32), 512, 'append');
    f.setEnvironment(CI_PLATFORM, { playwright: '1.62.1' });
    f.save();
    const text = fs.readFileSync(p, 'utf8');
    expect(text.indexOf('"alpha"')).toBeLessThan(text.indexOf('"zeta"'));
    expect(text.indexOf(`"${CI_PLATFORM}"`)).toBeLessThan(text.indexOf(`"${OTHER_PLATFORM}"`));
    const g = DigestFile.load(p);
    expect(g.get('alpha')!.accepted[CI_PLATFORM]).toEqual(['c'.repeat(32), 'a'.repeat(32)]);
    expect(g.environment(CI_PLATFORM)).toEqual({ playwright: '1.62.1' });
    expect(g.allDigests().size).toBe(4);
  });

  test('caps the number of accepted digests', () => {
    const { digests } = setup();
    for (let i = 0; i < MAX_ACCEPTED_DIGESTS; i++) {
      digests.accept('s', CI_PLATFORM, String(i).repeat(32), W, 'append');
    }
    expect(() => digests.accept('s', CI_PLATFORM, 'f'.repeat(32), W, 'append')).toThrow(/nondeterministic/);
  });

  test('rejects an unknown format', () => {
    const { dir } = setup();
    const p = path.join(dir, 'bad.json');
    fs.writeFileSync(p, JSON.stringify({ format: 2, scenes: {} }));
    expect(() => DigestFile.load(p)).toThrow(/format/);
  });
});
