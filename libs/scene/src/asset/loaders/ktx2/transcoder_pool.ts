import type { TextureFormat } from '@zephyr3d/device';
import type { KTX2TranscodeTargets } from './ktx2_targets';
import { defaultBasisTranscoderPath } from './basis_location';

/**
 * Result of transcoding one KTX2 file. `images` is ordered slice-major: every
 * mip level of face/layer 0, then every level of face/layer 1, and so on.
 * @internal
 */
export interface KTX2TranscodeResult {
  width: number;
  height: number;
  levels: number;
  faces: number;
  /** Raw KTX2 layer count, 0 when the texture is not an array */
  layers: number;
  textureFormat: TextureFormat;
  compressed: boolean;
  images: Uint8Array<ArrayBuffer>[];
  levelWidths: number[];
  levelHeights: number[];
}

// Runs inside each worker, appended after basis_transcoder.js which defines the
// BASIS module factory. Kept as plain source text so the bundler cannot rewrite
// it into something that depends on helpers living in the main bundle.
//
// The transcode loop follows three.js KTX2Loader (r180): startTranscoding() once,
// then getImageTranscodedSizeInBytes() + transcodeImage() per level/layer/face.
const WORKER_SOURCE = `
(function () {
  var ready = null;
  function transcode(module, buffer, targets) {
    var file = new module.KTX2File(new Uint8Array(buffer));
    try {
      if (!file.isValid()) {
        throw new Error('Invalid KTX2 file, or not Basis Universal encoded');
      }
      if (file.isHDR()) {
        throw new Error('HDR KTX2 textures are not supported yet');
      }
      var width = file.getWidth();
      var height = file.getHeight();
      var levels = Math.max(1, file.getLevels());
      var faces = file.getFaces();
      var layers = file.getLayers();
      var hasAlpha = !!file.getHasAlpha();
      var group = file.isETC1S() ? targets.etc1s : targets.uastc;
      var target = hasAlpha ? group.alpha : group.opaque;
      if (target.compressed && (width % 4 !== 0 || height % 4 !== 0)) {
        target = targets.fallback;
      }
      if (!file.startTranscoding()) {
        throw new Error('startTranscoding() failed');
      }
      var images = [];
      var levelWidths = [];
      var levelHeights = [];
      var slices = faces * Math.max(1, layers);
      for (var slice = 0; slice < slices; slice++) {
        var face = slice % faces;
        var layer = Math.floor(slice / faces);
        for (var level = 0; level < levels; level++) {
          var info = file.getImageLevelInfo(level, layer, face);
          var dst = new Uint8Array(file.getImageTranscodedSizeInBytes(level, layer, face, target.transcoderFormat));
          if (!file.transcodeImage(dst, level, layer, face, target.transcoderFormat, 0, -1, -1)) {
            throw new Error('transcodeImage() failed at level ' + level + ', layer ' + layer + ', face ' + face);
          }
          images.push(dst);
          if (slice === 0) {
            levelWidths.push(info.origWidth);
            levelHeights.push(info.origHeight);
          }
        }
      }
      return {
        width: width,
        height: height,
        levels: levels,
        faces: faces,
        layers: layers,
        textureFormat: target.textureFormat,
        compressed: target.compressed,
        images: images,
        levelWidths: levelWidths,
        levelHeights: levelHeights
      };
    } finally {
      file.close();
      file.delete();
    }
  }
  self.onmessage = function (e) {
    var msg = e.data;
    if (msg.type === 'init') {
      ready = BASIS({ wasmBinary: msg.wasm }).then(function (module) {
        module.initializeBasis();
        return module;
      });
    } else if (msg.type === 'transcode') {
      ready
        .then(function (module) {
          var result = transcode(module, msg.buffer, msg.targets);
          self.postMessage(
            { type: 'result', id: msg.id, result: result },
            result.images.map(function (img) { return img.buffer; })
          );
        })
        .catch(function (err) {
          self.postMessage({ type: 'error', id: msg.id, message: String((err && err.message) || err) });
        });
    }
  };
})();
`;

interface PendingRequest {
  resolve: (result: KTX2TranscodeResult) => void;
  reject: (err: Error) => void;
}

interface TranscoderWorker {
  worker: Worker;
  pending: number;
  /** Blob URL of the worker script, shared by the pool and revoked with it */
  scriptUrl: string;
}

function assertWasm(data: ArrayBuffer, url: string) {
  // A dev server or SPA host answering a missing file with index.html still
  // returns 200; catch that here instead of as an opaque CompileError
  const head = new Uint8Array(data, 0, Math.min(4, data.byteLength));
  if (head.length < 4 || head[0] !== 0x00 || head[1] !== 0x61 || head[2] !== 0x73 || head[3] !== 0x6d) {
    throw new Error(`${url} is not a WebAssembly file; is it deployed at that location?`);
  }
}

/**
 * Pool of web workers running the Basis Universal transcoder.
 *
 * Nothing is downloaded or spawned until the first transcode request, so pages
 * that never load a KTX2 texture pay nothing for it.
 *
 * @internal
 */
export class BasisTranscoder {
  private static _instance: BasisTranscoder | null = null;
  private static _path: string | null = null;
  private static _workerCount = 0;
  private _workers: Promise<TranscoderWorker[]> | null;
  private readonly _requests: Map<number, PendingRequest>;
  private _nextId: number;
  private constructor() {
    this._workers = null;
    this._requests = new Map();
    this._nextId = 1;
  }
  /** Directory URL holding basis_transcoder.js and basis_transcoder.wasm, null for the bundled copy */
  static get path() {
    return this._path;
  }
  static set path(url: string | null) {
    if (url !== this._path) {
      this._path = url;
      this.reset();
    }
  }
  /** Number of workers, 0 picks one from the hardware concurrency */
  static get workerCount() {
    return this._workerCount;
  }
  static set workerCount(n: number) {
    if (n !== this._workerCount) {
      this._workerCount = Math.max(0, n >>> 0);
      this.reset();
    }
  }
  static get instance() {
    if (!this._instance) {
      this._instance = new BasisTranscoder();
    }
    return this._instance;
  }
  /** Terminates the workers; they are recreated with the current settings on next use */
  static reset() {
    if (this._instance) {
      this._instance.dispose();
      this._instance = null;
    }
  }
  transcode(data: Uint8Array<ArrayBuffer>, targets: KTX2TranscodeTargets): Promise<KTX2TranscodeResult> {
    return this.getWorkers().then(
      (workers) =>
        new Promise<KTX2TranscodeResult>((resolve, reject) => {
          const entry = workers.reduce((a, b) => (b.pending < a.pending ? b : a));
          const id = this._nextId++;
          entry.pending++;
          this._requests.set(id, {
            resolve: (result) => {
              entry.pending--;
              resolve(result);
            },
            reject: (err) => {
              entry.pending--;
              reject(err);
            }
          });
          // Copy so the caller keeps its data and a view into a larger buffer (a .glb
          // chunk) does not ship the whole buffer to the worker
          const buffer = data.slice().buffer;
          entry.worker.postMessage({ type: 'transcode', id, buffer, targets }, [buffer]);
        })
    );
  }
  private dispose() {
    const workers = this._workers;
    this._workers = null;
    workers?.then(
      (list) => {
        list.forEach((w) => w.worker.terminate());
        if (list.length > 0) {
          URL.revokeObjectURL(list[0].scriptUrl);
        }
      },
      () => {}
    );
    for (const req of this._requests.values()) {
      req.reject(new Error('Basis transcoder was reset'));
    }
    this._requests.clear();
  }
  private getWorkers() {
    if (!this._workers) {
      this._workers = this.createWorkers();
      // Allow a retry after a failed download instead of caching the failure forever
      this._workers.catch(() => {
        this._workers = null;
      });
    }
    return this._workers;
  }
  private async createWorkers(): Promise<TranscoderWorker[]> {
    const base = BasisTranscoder._path ?? defaultBasisTranscoderPath();
    const dir = base.endsWith('/') ? base : `${base}/`;
    const [jsResponse, wasmResponse] = await Promise.all([
      fetch(`${dir}basis_transcoder.js`),
      fetch(`${dir}basis_transcoder.wasm`)
    ]);
    if (!jsResponse.ok || !wasmResponse.ok) {
      throw new Error(
        `Failed to load the Basis transcoder from ${dir} (HTTP ${jsResponse.status}/${wasmResponse.status}). ` +
          'Set KTX2Loader.transcoderPath to the directory that holds basis_transcoder.js and basis_transcoder.wasm.'
      );
    }
    const [jsSource, wasm] = await Promise.all([jsResponse.text(), wasmResponse.arrayBuffer()]);
    assertWasm(wasm, `${dir}basis_transcoder.wasm`);
    const blobUrl = URL.createObjectURL(
      new Blob([jsSource, WORKER_SOURCE], { type: 'application/javascript' })
    );
    const count =
      BasisTranscoder._workerCount ||
      Math.max(1, Math.min(4, (globalThis.navigator?.hardwareConcurrency ?? 4) - 1));
    const workers: TranscoderWorker[] = [];
    for (let i = 0; i < count; i++) {
      const worker = new Worker(blobUrl);
      worker.onmessage = (e: MessageEvent) => this.onMessage(e.data);
      worker.onerror = (e: ErrorEvent) => console.error(`Basis transcoder worker error: ${e.message}`);
      // Each worker gets its own copy, a transferred buffer could only go to one
      worker.postMessage({ type: 'init', wasm: wasm.slice(0) });
      workers.push({ worker, pending: 0, scriptUrl: blobUrl });
    }
    return workers;
  }
  private onMessage(msg: { type: string; id: number; result?: KTX2TranscodeResult; message?: string }) {
    const req = this._requests.get(msg.id);
    if (!req) {
      return;
    }
    this._requests.delete(msg.id);
    if (msg.type === 'result') {
      req.resolve(msg.result!);
    } else {
      req.reject(new Error(`KTX2 transcode failed: ${msg.message}`));
    }
  }
}
