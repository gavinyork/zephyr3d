import { MeshoptDecoder } from 'meshoptimizer/decoder';
import type { MeshoptDecoderModule } from './zmsh_binary';

/**
 * meshoptimizer's decoder once its WebAssembly module is ready. Shared by the
 * engine's binary .zmsh reader and the glTF meshopt extensions in the loaders
 * package, so one copy serves both.
 *
 * Imported statically: the decoder is about 8 KB gzipped with the WebAssembly
 * embedded, and a lazy import() would force every downstream single-file Rollup
 * build to change its output options.
 * @public
 */
export async function getMeshoptDecoder(): Promise<MeshoptDecoderModule> {
  await MeshoptDecoder.ready;
  return MeshoptDecoder;
}
