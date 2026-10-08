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

/**
 * Where reference images come from when they are not cached locally.
 *
 * `get` resolves to null only when the source positively has no such image;
 * when it cannot tell (network failure, server error, rate limit) it throws,
 * so that an unreachable store is never mistaken for a missing image.
 */
export interface ImageSource {
  get(digest: string): Promise<Buffer | null>;
}

/** Short reason for a failed request: the socket error code when there is one. */
export function describeFetchError(err: unknown): string {
  const e = err as { message?: string; cause?: { code?: string; message?: string } };
  return e?.cause?.code ?? e?.cause?.message ?? e?.message ?? String(err);
}

/** Reads images over HTTP. The repository is public, so no credentials are involved. */
export class HttpImageSource implements ImageSource {
  constructor(private readonly baseUrl = process.env.VISUAL_BASELINE_URL ?? DEFAULT_IMAGE_BASE_URL) {}
  async get(digest: string): Promise<Buffer | null> {
    const url = `${this.baseUrl}/${imageRelativePath(digest)}`;
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      throw new Error(`${url}: ${describeFetchError(err)}`);
    }
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw new Error(`${url}: HTTP ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
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

  /**
   * PNG bytes for `digest`, fetched into the cache on first use; null when
   * neither the cache nor the remote has it. Throws when the remote cannot be
   * reached, see `ImageSource`.
   */
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
