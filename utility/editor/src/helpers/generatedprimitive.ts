/**
 * Turning procedural model specs into `.zmsh` primitive assets.
 *
 * Tessellation runs in the `generated_model` worker, the same path the MCP `model_generate` tool
 * takes, so a large spec never blocks the editor UI.
 */
import { Vector3 } from '@zephyr3d/base';
import type { AssetPrimitiveInfo } from '@zephyr3d/scene';

export function isNumberArray(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every((item) => typeof item === 'number');
}

/** Converts a success message of the generated model worker into primitive data ready to write */
export function createGeneratedAssetPrimitive(message: any): AssetPrimitiveInfo {
  const primitive = message?.primitive;
  if (!primitive || typeof primitive !== 'object') {
    throw new Error('Generated model worker did not return primitive data');
  }
  const indices = primitive.indices;
  if (!(indices instanceof Uint16Array) && !(indices instanceof Uint32Array)) {
    throw new Error('Generated model worker returned invalid primitive indices');
  }
  const normalizedIndices =
    indices instanceof Uint16Array ? new Uint16Array(indices) : new Uint32Array(indices);
  const vertices: AssetPrimitiveInfo['vertices'] = {} as AssetPrimitiveInfo['vertices'];
  if (!primitive.vertices || typeof primitive.vertices !== 'object') {
    throw new Error('Generated model worker returned invalid primitive vertices');
  }
  for (const [semantic, vertex] of Object.entries(primitive.vertices as Record<string, any>)) {
    if (!vertex || typeof vertex.format !== 'string' || !ArrayBuffer.isView(vertex.data)) {
      throw new Error(`Generated model worker returned invalid vertex buffer: ${semantic}`);
    }
    vertices[semantic as keyof AssetPrimitiveInfo['vertices']] = {
      format: vertex.format,
      data: vertex.data
    } as AssetPrimitiveInfo['vertices'][keyof AssetPrimitiveInfo['vertices']];
  }
  const boxMin = Array.isArray(primitive.boxMin) ? primitive.boxMin : message.boxMin;
  const boxMax = Array.isArray(primitive.boxMax) ? primitive.boxMax : message.boxMax;
  if (!isNumberArray(boxMin, 3) || !isNumberArray(boxMax, 3)) {
    throw new Error('Generated model worker returned invalid primitive bounds');
  }
  return {
    vertices,
    indices: normalizedIndices,
    indexCount: Number(primitive.indexCount ?? normalizedIndices.length),
    type: primitive.type === 'triangle-list' ? 'triangle-list' : primitive.type,
    boxMin: new Vector3(boxMin),
    boxMax: new Vector3(boxMax)
  };
}

/**
 * Tessellates specs one after another on a single generated model worker.
 *
 * Call {@link GeneratedModelRunner.dispose} when done; it terminates the worker.
 */
export class GeneratedModelRunner {
  private _worker: Worker | null;
  private _pending: { resolve: (msg: any) => void; reject: (err: Error) => void } | null;
  constructor() {
    this._worker = null;
    this._pending = null;
  }
  /**
   * Tessellates one spec.
   * @param spec - Procedural model spec
   * @param timeoutMs - Wall-clock budget of this spec
   * @returns Primitive data ready for `SharedModel.writePrimitive`
   */
  async generate(spec: unknown, timeoutMs = 30000): Promise<AssetPrimitiveInfo> {
    if (this._pending) {
      throw new Error('GeneratedModelRunner.generate() is not reentrant');
    }
    const worker = this.ensureWorker();
    const message = await new Promise<any>((resolve, reject) => {
      this._pending = { resolve, reject };
      worker.postMessage({ type: 'generate', spec, deadlineAt: Date.now() + timeoutMs });
    });
    return createGeneratedAssetPrimitive(message);
  }
  dispose() {
    this._worker?.terminate();
    this._worker = null;
    this.settle(null, new Error('Generated model worker was disposed'));
  }
  private settle(message: any, err: Error | null) {
    const pending = this._pending;
    this._pending = null;
    if (pending) {
      if (err) {
        pending.reject(err);
      } else {
        pending.resolve(message);
      }
    }
  }
  private ensureWorker() {
    if (!this._worker) {
      const worker = new Worker(new URL('../workers/generated_model.ts', import.meta.url), {
        type: 'module'
      });
      worker.onmessage = (event: MessageEvent<any>) => {
        const message = event.data;
        if (message?.type === 'success') {
          this.settle(message, null);
        } else if (message?.type === 'error') {
          this.settle(null, new Error(String(message.error || 'Generated model worker failed')));
        }
      };
      worker.onerror = (event) => {
        // A crashed worker cannot take further jobs
        this._worker?.terminate();
        this._worker = null;
        this.settle(null, new Error(event.message || 'Generated model worker failed'));
      };
      worker.onmessageerror = () => {
        this.settle(null, new Error('Generated model worker returned an unserializable message'));
      };
      this._worker = worker;
    }
    return this._worker;
  }
}
