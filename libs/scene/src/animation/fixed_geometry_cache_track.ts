import { AnimationTrack } from './animationtrack';
import type { Mesh } from '../scene';
import type { Nullable } from '@zephyr3d/base';
import {
  createGeometryCacheState,
  ensureGeometryCacheMeshBinding,
  mixGeometryCacheBoundingBox,
  type GeometryCacheFrame,
  type GeometryCacheMeshBinding,
  type GeometryCacheState
} from './geometry_cache_utils';

/** @public */
export type FixedGeometryCacheFrame = GeometryCacheFrame;
/** @public */
export type FixedGeometryCacheState = GeometryCacheState;

/**
 * Geometry cache track backed by explicit per-frame vertex data.
 *
 * @public
 */
export class FixedGeometryCacheTrack extends AnimationTrack<FixedGeometryCacheState> {
  private _times: Float32Array;
  private _frames: FixedGeometryCacheFrame[];
  private _state: Nullable<FixedGeometryCacheState>;
  private readonly _meshBindings: WeakMap<Mesh, GeometryCacheMeshBinding>;

  constructor(times?: Float32Array, frames?: FixedGeometryCacheFrame[], embedded?: boolean) {
    super(embedded);
    this._times = times ?? new Float32Array();
    this._frames = frames ?? [];
    this._state = this._frames.length > 0 ? createGeometryCacheState(this._frames[0]) : null;
    this._meshBindings = new WeakMap();
  }

  get times() {
    return this._times;
  }

  set times(value: Float32Array) {
    this._times = value ?? new Float32Array();
  }

  get frames() {
    return this._frames;
  }

  set frames(value: FixedGeometryCacheFrame[]) {
    this._frames = value ?? [];
    this._state = this._frames.length > 0 ? createGeometryCacheState(this._frames[0]) : null;
  }

  calculateState(_target: object, currentTime: number) {
    if (this._frames.length === 0) {
      throw new Error('FixedGeometryCacheTrack.calculateState(): no frames available');
    }
    if (this._frames.length === 1 || this._times.length <= 1) {
      return this.copyFrameToState(this._frames[0]);
    }
    if (currentTime <= this._times[0]) {
      return this.copyFrameToState(this._frames[0]);
    }
    const lastIndex = this._times.length - 1;
    if (currentTime >= this._times[lastIndex]) {
      return this.copyFrameToState(this._frames[lastIndex]);
    }
    let right = 1;
    while (right < this._times.length && this._times[right] < currentTime) {
      right++;
    }
    const left = Math.max(0, right - 1);
    const start = this._times[left];
    const end = this._times[right];
    const t = end > start ? (currentTime - start) / (end - start) : 0;
    return this.interpolateFrames(this._frames[left], this._frames[right], t);
  }

  applyState(target: object, state: FixedGeometryCacheState) {
    const mesh = target as Mesh;
    const binding = this.ensureMeshBinding(mesh, state);
    binding.positionBuffer.bufferSubData(0, state.positions as unknown as Float32Array<ArrayBuffer>);
    if (binding.normalBuffer && state.normals) {
      binding.normalBuffer.bufferSubData(0, state.normals as unknown as Float32Array<ArrayBuffer>);
    }
    mesh.setAnimatedBoundingBox(state.boundingBox);
  }

  mixState(a: FixedGeometryCacheState, b: FixedGeometryCacheState, t: number) {
    if (!this._state) {
      throw new Error('FixedGeometryCacheTrack.mixState(): invalid state');
    }
    const positions = new Float32Array(a.positions.length);
    for (let i = 0; i < positions.length; i++) {
      positions[i] = a.positions[i] + (b.positions[i] - a.positions[i]) * t;
    }
    let normals: Nullable<Float32Array> = null;
    if (a.normals && b.normals && a.normals.length === b.normals.length) {
      normals = new Float32Array(a.normals.length);
      for (let i = 0; i < normals.length; i++) {
        normals[i] = a.normals[i] + (b.normals[i] - a.normals[i]) * t;
      }
    }
    return {
      positions,
      normals,
      boundingBox: mixGeometryCacheBoundingBox(a.boundingBox, b.boundingBox, t)
    };
  }

  getBlendId() {
    return 'fixed-geometry-cache';
  }

  getDuration() {
    return this._times.length > 0 ? this._times[this._times.length - 1] : 0;
  }

  reset(target: object) {
    if (this._frames.length > 0) {
      this.applyState(target, this.copyFrameToState(this._frames[0]));
    }
  }

  private copyFrameToState(frame: FixedGeometryCacheFrame) {
    if (!this._state) {
      this._state = createGeometryCacheState(frame);
    }
    this._state.positions.set(frame.positions);
    if (frame.normals) {
      if (!this._state.normals || this._state.normals.length !== frame.normals.length) {
        this._state.normals = new Float32Array(frame.normals.length);
      }
      this._state.normals.set(frame.normals);
    } else {
      this._state.normals = null;
    }
    this._state.boundingBox.minPoint.set(frame.boundingBox.minPoint);
    this._state.boundingBox.maxPoint.set(frame.boundingBox.maxPoint);
    return this._state;
  }

  private interpolateFrames(a: FixedGeometryCacheFrame, b: FixedGeometryCacheFrame, t: number) {
    if (!this._state) {
      this._state = createGeometryCacheState(a);
    }
    for (let i = 0; i < this._state.positions.length; i++) {
      this._state.positions[i] = a.positions[i] + (b.positions[i] - a.positions[i]) * t;
    }
    if (a.normals && b.normals && a.normals.length === b.normals.length) {
      if (!this._state.normals || this._state.normals.length !== a.normals.length) {
        this._state.normals = new Float32Array(a.normals.length);
      }
      for (let i = 0; i < this._state.normals.length; i++) {
        this._state.normals[i] = a.normals[i] + (b.normals[i] - a.normals[i]) * t;
      }
    } else {
      this._state.normals = null;
    }
    this._state.boundingBox.minPoint.setXYZ(
      a.boundingBox.minPoint.x + (b.boundingBox.minPoint.x - a.boundingBox.minPoint.x) * t,
      a.boundingBox.minPoint.y + (b.boundingBox.minPoint.y - a.boundingBox.minPoint.y) * t,
      a.boundingBox.minPoint.z + (b.boundingBox.minPoint.z - a.boundingBox.minPoint.z) * t
    );
    this._state.boundingBox.maxPoint.setXYZ(
      a.boundingBox.maxPoint.x + (b.boundingBox.maxPoint.x - a.boundingBox.maxPoint.x) * t,
      a.boundingBox.maxPoint.y + (b.boundingBox.maxPoint.y - a.boundingBox.maxPoint.y) * t,
      a.boundingBox.maxPoint.z + (b.boundingBox.maxPoint.z - a.boundingBox.maxPoint.z) * t
    );
    return this._state;
  }

  private ensureMeshBinding(mesh: Mesh, state: FixedGeometryCacheState) {
    return ensureGeometryCacheMeshBinding(
      this._meshBindings,
      mesh,
      state,
      'FixedGeometryCacheTrack.applyState()'
    );
  }
}
