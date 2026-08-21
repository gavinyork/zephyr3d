/**
 * Importer for Alembic hair/fur curve archives, as exported by Maya XGen.
 *
 * @remarks
 * The archive stores strands as cubic B-spline control points. Turning those
 * into renderable ribbons is not specific to Alembic, so this file is only the
 * container half: it decodes the archive and hands the strand sets to the shared
 * tessellator in `../curves`, which is also what the `.hair` importer uses.
 */
import type { VFS } from '@zephyr3d/base';
import type { SharedModel } from '@zephyr3d/scene';
import { AbstractModelImporter } from '../importer';
import type { ResolvedStrandRibbonOptions, StrandRibbonOptions } from '../curves';
import { buildStrandModel, resolveStrandRibbonOptions } from '../curves';
import { parseAlembicCurves } from './parser';

/**
 * Options controlling how Alembic curves are turned into renderable geometry.
 *
 * @remarks
 * Alembic adds nothing of its own to the shared ribbon options; the alias exists
 * so callers can keep naming the format they are importing.
 * @public
 */
export type AlembicHairImportOptions = StrandRibbonOptions;

/**
 * Model importer for Alembic curve archives.
 *
 * @remarks
 * Only the Ogawa container and the curve schema are supported; mesh and point
 * archives are rejected. Register it for the `model/alembic` MIME type.
 * @public
 */
export class AlembicHairImporter extends AbstractModelImporter {
  /** @internal */
  private readonly _options: ResolvedStrandRibbonOptions;
  /**
   * Creates an importer.
   *
   * @param options - Tessellation and scaling options.
   */
  constructor(options?: AlembicHairImportOptions) {
    super();
    this._options = resolveStrandRibbonOptions(options);
  }
  // Curve archives are self-contained: there are no external textures or buffers
  // to resolve, so the base path and VFS are unused.
  async import(data: Blob, model: SharedModel, _basePath: string, _vfs?: VFS) {
    const buffer = await data.arrayBuffer();
    const archive = parseAlembicCurves(buffer);
    if (archive.curves.length === 0) {
      throw new Error('Alembic archive contains no curve objects');
    }
    buildStrandModel(archive.curves, model, this._options);
  }
}
