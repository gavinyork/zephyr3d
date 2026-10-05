import fs from 'node:fs';
import path from 'node:path';

/** Public repository the reference images live in. */
export const BASELINE_IMAGES_REPO = 'gavinyork/zephyr3d-visual-baselines';
/** Orphan branch holding the images; its history may be squashed at any time. */
export const BASELINE_IMAGES_BRANCH = 'images';
export const DEFAULT_IMAGE_BASE_URL = `https://raw.githubusercontent.com/${BASELINE_IMAGES_REPO}/${BASELINE_IMAGES_BRANCH}`;

/** Content-addressed location of an image inside the store: `<first 2 hex>/<digest>.png`. */
export function imageRelativePath(digest: string): string {
  return `${digest.slice(0, 2)}/${digest}.png`;
}

/** Where reference images come from when they are not cached locally. */
export interface ImageSource {
  get(digest: string): Promise<Buffer | null>;
}

/** Reads images over HTTP. The repository is public, so no credentials are involved. */
export class HttpImageSource implements ImageSource {
  constructor(private readonly baseUrl = process.env.VISUAL_BASELINE_URL ?? DEFAULT_IMAGE_BASE_URL) {}
  async get(digest: string): Promise<Buffer | null> {
    try {
      const res = await fetch(`${this.baseUrl}/${imageRelativePath(digest)}`);
      return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    } catch {
      return null;
    }
  }
}

/**
 * Reference images by digest: a local cache in front of an optional remote.
 *
 * Images only matter for tolerant comparison and diagnostics; a decision made
 * on a digest hit never reads one. So an image that cannot be found is reported
 * as unavailable, never as the scene having failed.
 */
export class ImageStore {
  constructor(
    readonly cacheDir: string,
    private readonly remote: ImageSource | null
  ) {}

  cachePath(digest: string): string {
    return path.join(this.cacheDir, 'images', imageRelativePath(digest));
  }

  /** PNG bytes for `digest`, fetched into the cache on first use; null when unavailable. */
  async get(digest: string): Promise<Buffer | null> {
    const local = this.cachePath(digest);
    if (fs.existsSync(local)) {
      return fs.readFileSync(local);
    }
    const data = (await this.remote?.get(digest)) ?? null;
    if (data) {
      fs.mkdirSync(path.dirname(local), { recursive: true });
      fs.writeFileSync(local, data);
    }
    return data;
  }

  /**
   * Caches a newly accepted image and records it for upload.
   *
   * Accepting a baseline never touches the network; `baselines:push` publishes
   * whatever is listed as pending.
   */
  put(digest: string, png: Buffer): string {
    const local = this.cachePath(digest);
    fs.mkdirSync(path.dirname(local), { recursive: true });
    fs.writeFileSync(local, png);
    if (!this.pending().includes(digest)) {
      fs.appendFileSync(this.pendingPath(), `${digest}\n`);
    }
    return local;
  }

  pendingPath(): string {
    return path.join(this.cacheDir, 'pending-upload.txt');
  }

  /** Digests accepted locally and not yet published. */
  pending(): string[] {
    const p = this.pendingPath();
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
  }
}
