import UPNG from 'upng-js';
import type { ImpostorBakeSettings, ImpostorInfo } from '@zephyr3d/scene';
import {
  defaultImpostorBakeSettings,
  FoliageSystem,
  getEngine,
  getImpostorFiles,
  IMPOSTOR_VERSION,
  ImpostorBaker,
  loadImpostorParts,
  Scene
} from '@zephyr3d/scene';
import { ProjectService } from './project';

/** Bumped whenever the baker's output changes, so every impostor is rebaked */
const IMPOSTOR_BAKER_VERSION = 2;

/** Files whose text is searched for the assets they refer to */
const TEXT_ASSET = /\.(zprefab|zmtl|zbpt|zmf|json|zscn)$/i;
/** An asset path quoted in a text asset */
const ASSET_REF = /"(\/assets\/[^"]+)"/g;

/** Outcome of baking the impostor of one asset */
export interface ImpostorBakeServiceResult {
  asset: string;
  /** Directory the atlases and impostor.json were written to */
  dir: string;
  /** True when an up-to-date impostor was already there */
  skipped: boolean;
  milliseconds?: number;
  /** Material classes whose meshes were captured by colour only */
  uncapturedMaterials?: string[];
  /** Skinned or morphed meshes left out */
  skippedMeshes?: string[];
  err?: string;
}

async function sha1Hex(data: ArrayBuffer | string) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Bakes octahedral impostors of prefabs and models into IMPOSTOR_DIR: three PNG atlases (base
 * colour, normal and depth, occlusion-roughness-metallic) and an impostor.json. A bake is skipped
 * while the hash of the asset, of every file it refers to and of the settings still matches, so
 * changing a material or texture of the asset brings a rebake.
 */
export class ImpostorBakeService {
  /** Bakes the impostor of an asset unless it is up to date */
  static async bake(
    asset: string,
    settings?: Partial<ImpostorBakeSettings>,
    force = false
  ): Promise<ImpostorBakeServiceResult> {
    const vfs = ProjectService.VFS;
    const s: ImpostorBakeSettings = { ...defaultImpostorBakeSettings(), ...(settings ?? {}) };
    const files = getImpostorFiles(asset, s.lod);
    const start = performance.now();
    let scene: Scene | null = null;
    let release: (() => void) | null = null;
    let baker: ImpostorBaker | null = null;
    try {
      const hash = await this.hash(asset, s);
      if (!force && (await this.isUpToDate(asset, s.lod, hash))) {
        return { asset, dir: files.dir, skipped: true };
      }
      scene = new Scene();
      const loaded = await loadImpostorParts(scene, asset);
      release = loaded.dispose;
      if (loaded.parts.length === 0) {
        throw new Error(`${asset} has no mesh to bake`);
      }
      baker = new ImpostorBaker(scene);
      const result = await baker.bake(loaded.parts, s);
      if (!result) {
        throw new Error(`${asset} has no bounds`);
      }
      if (!(await vfs.exists(files.dir))) {
        await vfs.makeDirectory(files.dir, true);
      }
      const size = result.settings.atlasSize;
      const encode = (data: Uint8Array, edge: number) =>
        UPNG.encode([new Uint8Array(data).buffer], edge, edge, 0);
      await vfs.writeFile(files.base, encode(result.base, size), { encoding: 'binary', create: true });
      await vfs.writeFile(files.normalDepth, encode(result.normalDepth, result.detailSize), {
        encoding: 'binary',
        create: true
      });
      await vfs.writeFile(files.orm, encode(result.orm, result.detailSize), {
        encoding: 'binary',
        create: true
      });
      const info: ImpostorInfo = {
        version: IMPOSTOR_VERSION,
        asset,
        hash,
        settings: result.settings,
        center: result.center,
        radius: result.radius,
        detailSize: result.detailSize
      };
      await vfs.writeFile(files.info, JSON.stringify(info, null, 2), { encoding: 'utf8', create: true });
      // Atlases already loaded from an earlier bake are read again
      const assetManager = getEngine().resourceManager.assetManager;
      for (const path of [files.base, files.normalDepth, files.orm, files.info]) {
        assetManager.invalidateAsset(path);
      }
      return {
        asset,
        dir: files.dir,
        skipped: false,
        milliseconds: Math.round(performance.now() - start),
        uncapturedMaterials: result.uncapturedMaterials,
        skippedMeshes: loaded.skipped
      };
    } catch (err) {
      return { asset, dir: files.dir, skipped: false, err: err instanceof Error ? err.message : String(err) };
    } finally {
      baker?.dispose();
      release?.();
      scene?.dispose();
    }
  }

  /** Whether the impostor of an asset was baked from what the asset and its files are now */
  static async isUpToDate(asset: string, lod: number, hash: string) {
    try {
      const files = getImpostorFiles(asset, lod);
      const vfs = ProjectService.VFS;
      for (const path of [files.info, files.base, files.normalDepth, files.orm]) {
        if (!(await vfs.exists(path))) {
          return false;
        }
      }
      const info = JSON.parse(
        (await vfs.readFile(files.info, { encoding: 'utf8' })) as string
      ) as ImpostorInfo;
      return info.version === IMPOSTOR_VERSION && info.hash === hash;
    } catch {
      return false;
    }
  }

  /**
   * Hash of an asset, of every asset it refers to (prefabs, materials, meshes, textures, followed
   * through the text assets) and of the settings
   */
  static async hash(asset: string, settings: ImpostorBakeSettings) {
    const seen = new Map<string, string>();
    const visit = async (path: string) => {
      if (seen.has(path)) {
        return;
      }
      seen.set(path, '');
      // Built-in assets may not be readable as files; they never change within a version
      const vfs = path.startsWith('/assets/@builtins/') ? getEngine().VFS : ProjectService.VFS;
      let data: ArrayBuffer;
      try {
        data = (await vfs.readFile(path, { encoding: 'binary' })) as ArrayBuffer;
      } catch {
        seen.set(path, 'missing');
        return;
      }
      seen.set(path, await sha1Hex(data));
      if (TEXT_ASSET.test(path)) {
        const text = new TextDecoder().decode(data);
        for (const m of text.matchAll(ASSET_REF)) {
          await visit(m[1]);
        }
      }
    };
    await visit(asset);
    const entries = [...seen.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const key = JSON.stringify([
      entries,
      settings.frames,
      settings.atlasSize,
      settings.detailDivider,
      settings.hemisphere,
      settings.lod,
      IMPOSTOR_BAKER_VERSION
    ]);
    return sha1Hex(key);
  }
}

// Foliage layers drawing impostors have theirs baked, or rebaked once the asset changed, before
// they load them
FoliageSystem.onImpostorNeeded = async (asset: string, lod: number) => {
  if (ProjectService.VFS.readOnly) {
    return;
  }
  const r = await ImpostorBakeService.bake(asset, { lod });
  if (r.err) {
    console.error(`Bake impostor of ${asset} failed: ${r.err}`);
  } else if (!r.skipped) {
    console.info(`Impostor of ${asset} baked into ${r.dir} in ${r.milliseconds} ms`);
  }
};
