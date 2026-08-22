/**
 * Importer for HAIR model files (Cem Yuksel's `cyHairFile`).
 *
 * @remarks
 * The container work is trivial next to Alembic's - one header and a handful of
 * flat arrays - so this file is mostly the bridge between {@link parseHairFile}
 * and the shared ribbon tessellator in `../curves`, which the Alembic importer
 * uses as well. The two importers therefore produce the same attribute layout
 * and answer to the same options.
 */
import type { VFS } from '@zephyr3d/base';
import type { SharedModel } from '@zephyr3d/scene';
import { AbstractModelImporter } from '../importer';
import type { ResolvedStrandRibbonOptions, StrandRibbonOptions, StrandUpAxis } from '../curves';
import { buildStrandModel, resolveStrandRibbonOptions } from '../curves';
import { parseHairFile } from './parser';

/**
 * Options controlling how a HAIR file is turned into renderable geometry.
 *
 * @remarks
 * The Alembic importer's options plus an up axis, which Alembic does not need:
 * an XGen archive is Y-up already, while a HAIR file is Z-up by convention.
 *
 * Note that `scale` usually wants to stay at 1 here. Unlike an XGen archive,
 * which is reliably authored in Maya centimetres, a HAIR file records no unit at
 * all, and the published models are modelled at whatever size suited their
 * author.
 * @public
 */
export type HairFileImportOptions = StrandRibbonOptions & {
  /**
   * Up axis of the file's control points. Defaults to `z`, the format's
   * convention; see {@link ParseHairFileOptions.upAxis}.
   */
  upAxis?: StrandUpAxis;
};

/**
 * Model importer for HAIR files.
 *
 * @remarks
 * Register it for the `model/hair` MIME type.
 * @public
 */
export class HairFileImporter extends AbstractModelImporter {
  /** @internal */
  private readonly _options: ResolvedStrandRibbonOptions;
  /** @internal */
  private readonly _upAxis: StrandUpAxis;
  /**
   * Creates an importer.
   *
   * @param options - Tessellation, scaling and coordinate-system options.
   */
  constructor(options?: HairFileImportOptions) {
    super();
    this._options = resolveStrandRibbonOptions(options);
    this._upAxis = options?.upAxis ?? 'z';
  }
  // A HAIR file is self-contained: there are no external textures or buffers to
  // resolve, so the base path and VFS are unused.
  async import(data: Blob, model: SharedModel, _basePath: string, _vfs?: VFS) {
    const buffer = await data.arrayBuffer();
    // The format carries no object names, so the strand set borrows the node
    // name rather than inventing one.
    const hair = parseHairFile(buffer, { name: this._options.nodeName, upAxis: this._upAxis });
    buildStrandModel([hair], model, this._options);
  }
}
