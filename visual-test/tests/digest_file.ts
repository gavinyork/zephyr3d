import fs from 'node:fs';
import path from 'node:path';

/** Upper bound on accepted digests per scene and platform; see {@link DigestFile.accept}. */
export const MAX_ACCEPTED_DIGESTS = 4;

/** Environment a platform's digests were generated in. Diagnostic only. */
export interface DigestEnvironment {
  playwright?: string;
  chromium?: string;
  adapter?: string;
}

export interface SceneDigests {
  /** Capture edge length the digests were taken at. */
  size: number;
  /** Platform key -> accepted digests; the first is the platform's primary. */
  accepted: Record<string, string[]>;
}

interface DigestFileData {
  format: 1;
  environments: Record<string, DigestEnvironment>;
  scenes: Record<string, SceneDigests>;
}

/**
 * The committed record of what each scene is allowed to look like, for one
 * project and depth convention.
 *
 * It is the only thing a pass/fail decision depends on; images are looked up
 * by the digests it lists. Written with every level of keys sorted so diffs
 * stay minimal and merges rarely conflict.
 *
 * Not safe for concurrent writers. Each Playwright project runs its single spec
 * file serially in one worker, and each project has its own file, so a file has
 * exactly one writer.
 */
export class DigestFile {
  readonly path: string;
  private readonly _data: DigestFileData;

  private constructor(filePath: string, data: DigestFileData) {
    this.path = filePath;
    this._data = data;
  }

  static pathFor(root: string, project: string, convention: string): string {
    return path.join(root, 'digests', `${project}.${convention}.json`);
  }

  /** Loads the file, or starts an empty one if it does not exist yet. */
  static load(filePath: string): DigestFile {
    if (!fs.existsSync(filePath)) {
      return new DigestFile(filePath, { format: 1, environments: {}, scenes: {} });
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as DigestFileData;
    if (data.format !== 1) {
      throw new Error(`${filePath}: unsupported digest file format ${String(data.format)}`);
    }
    data.environments ??= {};
    data.scenes ??= {};
    return new DigestFile(filePath, data);
  }

  get(scene: string): SceneDigests | undefined {
    return this._data.scenes[scene];
  }

  environment(platform: string): DigestEnvironment | undefined {
    return this._data.environments[platform];
  }

  /** Every digest the file references, across scenes and platforms. */
  allDigests(): Set<string> {
    const out = new Set<string>();
    for (const s of Object.values(this._data.scenes)) {
      for (const list of Object.values(s.accepted)) {
        list.forEach((d) => out.add(d));
      }
    }
    return out;
  }

  /**
   * Accepts `digest` for a scene on a platform.
   *
   * `replace` makes it the only accepted digest, which is what accepting a new
   * baseline means. `append` adds a further positive; that is only legitimate
   * for a scene with several genuinely valid outputs, hence the hard cap: a long
   * list means the scene is nondeterministic and should be fixed instead.
   */
  accept(scene: string, platform: string, digest: string, size: number, mode: 'replace' | 'append'): void {
    const entry = (this._data.scenes[scene] ??= { size, accepted: {} });
    if (entry.size !== size) {
      // A size change invalidates every platform's digests, not just this one.
      entry.size = size;
      entry.accepted = {};
    }
    const list = entry.accepted[platform] ?? [];
    if (mode === 'replace') {
      entry.accepted[platform] = [digest];
    } else if (!list.includes(digest)) {
      if (list.length >= MAX_ACCEPTED_DIGESTS) {
        throw new Error(
          `${scene} (${platform}) already has ${MAX_ACCEPTED_DIGESTS} accepted digests; ` +
            `a scene with that many valid outputs is nondeterministic and should be fixed`
        );
      }
      entry.accepted[platform] = [...list, digest];
    }
  }

  setEnvironment(platform: string, env: DigestEnvironment): void {
    this._data.environments[platform] = env;
  }

  save(): void {
    fs.mkdirSync(path.dirname(this.path), { recursive: true });
    fs.writeFileSync(this.path, JSON.stringify(sortKeys(this._data), null, 2) + '\n');
  }
}

/** Recursively sorts object keys; arrays keep their order, since the primary digest is first. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}
