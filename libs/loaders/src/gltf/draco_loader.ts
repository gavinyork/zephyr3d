import type * as draco3d from 'draco3d';
import { defaultDracoDecoderPath } from './draco_location';

let decoderPath: string | null = null;
let decoderPromise: Promise<draco3d.DecoderModule> | null = null;

/**
 * Directory URL holding draco_wasm_wrapper_gltf.js and draco_decoder_gltf.wasm,
 * null for the copy bundled with the loaders package.
 * @internal
 */
export function getDracoDecoderPath() {
  return decoderPath;
}

/** @internal */
export function setDracoDecoderPath(path: string | null) {
  if (path !== decoderPath) {
    decoderPath = path;
    decoderPromise = null;
  }
}

function instantiate(factory: draco3d.DracoDecoderModule, wasmBinary?: ArrayBuffer) {
  return new Promise<draco3d.DecoderModule>((resolve) => {
    factory({ wasmBinary, onModuleLoaded: (module: draco3d.DecoderModule) => resolve(module) } as never);
  });
}

function assertWasm(data: ArrayBuffer, url: string) {
  // A dev server or SPA host answering a missing file with index.html still
  // returns 200; catch that here instead of as an opaque CompileError
  const head = new Uint8Array(data, 0, Math.min(4, data.byteLength));
  if (head.length < 4 || head[0] !== 0x00 || head[1] !== 0x61 || head[2] !== 0x73 || head[3] !== 0x6d) {
    throw new Error(`${url} is not a WebAssembly file; is it deployed at that location?`);
  }
}

async function fetchDecoder(): Promise<draco3d.DecoderModule> {
  // A page that already provides the decoder keeps working as before
  const globalFactory = (globalThis as { DracoDecoderModule?: draco3d.DracoDecoderModule })
    .DracoDecoderModule;
  if (globalFactory) {
    return instantiate(globalFactory);
  }
  const base = decoderPath ?? defaultDracoDecoderPath();
  const dir = base.endsWith('/') ? base : `${base}/`;
  const [jsResponse, wasmResponse] = await Promise.all([
    fetch(`${dir}draco_wasm_wrapper_gltf.js`),
    fetch(`${dir}draco_decoder_gltf.wasm`)
  ]);
  if (!jsResponse.ok || !wasmResponse.ok) {
    throw new Error(
      `Failed to load the Draco decoder from ${dir} (HTTP ${jsResponse.status}/${wasmResponse.status}). ` +
        'Set GLTFImporter.dracoDecoderPath to the directory that holds draco_wasm_wrapper_gltf.js and draco_decoder_gltf.wasm.'
    );
  }
  const [source, wasm] = await Promise.all([jsResponse.text(), wasmResponse.arrayBuffer()]);
  assertWasm(wasm, `${dir}draco_decoder_gltf.wasm`);
  // The wrapper is a classic script that declares a DracoDecoderModule factory.
  // Evaluating it in a function scope returns the factory without leaking a global.
  const factory = new Function(`${source}\nreturn DracoDecoderModule;`)() as draco3d.DracoDecoderModule;
  return instantiate(factory, wasm);
}

/**
 * Loads the Draco decoder on first use and shares it afterwards.
 * @internal
 */
export function loadDracoDecoder() {
  if (!decoderPromise) {
    decoderPromise = fetchDecoder();
    decoderPromise.catch(() => {
      decoderPromise = null;
    });
  }
  return decoderPromise;
}
