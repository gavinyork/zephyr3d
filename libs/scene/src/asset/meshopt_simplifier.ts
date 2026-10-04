import type { Nullable } from '@zephyr3d/base';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';
import type { MeshSimplifier } from './mesh_lod_builder';

let ready = false;

/**
 * meshoptimizer's simplifier once its WebAssembly module is ready, for generating levels of
 * detail (SharedModel.generateLods, shapes with LOD settings).
 *
 * Imported statically like the decoder (see getMeshoptDecoder): a lazy import() would force every
 * downstream single-file Rollup build to change its output options.
 * @public
 */
export async function getMeshoptSimplifier(): Promise<MeshSimplifier> {
  await MeshoptSimplifier.ready;
  ready = true;
  return MeshoptSimplifier as unknown as MeshSimplifier;
}

/**
 * meshoptimizer's simplifier if its WebAssembly module is ready, null otherwise; for code that
 * must generate levels of detail synchronously and can wait for {@link getMeshoptSimplifier}
 * the first time.
 * @public
 */
export function getMeshoptSimplifierIfReady(): Nullable<MeshSimplifier> {
  return ready ? (MeshoptSimplifier as unknown as MeshSimplifier) : null;
}
