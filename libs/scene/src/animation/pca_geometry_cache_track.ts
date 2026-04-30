import { AnimationTrack } from './animationtrack';
import type { Mesh } from '../scene';
import { BoundingBox } from '../utility/bounding_volume';
import type { Nullable } from '@zephyr3d/base';
import { Vector3 } from '@zephyr3d/base';
import {
  createGeometryCacheState,
  ensureGeometryCacheMeshBinding,
  mixGeometryCacheBoundingBox,
  type GeometryCacheMeshBinding,
  type GeometryCacheState
} from './geometry_cache_utils';

/**
 * PCA-compressed geometry cache animation data.
 *
 * @public
 */
export type PCAGeometryCacheTrackData = {
  times: Float32Array;
  bounds: [number, number, number, number, number, number][];
  positionReference?: Nullable<Float32Array>;
  positionMean: Float32Array;
  positionBases: Float32Array[];
  positionCoefficients: Float32Array[];
  normalMean?: Nullable<Float32Array>;
  normalBases?: Nullable<Float32Array[]>;
  normalCoefficients?: Nullable<Float32Array[]>;
};

/** @public */
export type PCAGeometryCacheState = GeometryCacheState;

/**
 * Geometry cache track reconstructed from PCA bases and coefficients.
 *
 * @public
 */
export class PCAGeometryCacheTrack extends AnimationTrack<PCAGeometryCacheState> {
  private _times: Float32Array;
  private _bounds: [number, number, number, number, number, number][];
  private _positionReference: Nullable<Float32Array>;
  private _positionMean: Float32Array;
  private _positionBases: Float32Array[];
  private _positionCoefficients: Float32Array[];
  private _normalMean: Nullable<Float32Array>;
  private _normalBases: Nullable<Float32Array[]>;
  private _normalCoefficients: Nullable<Float32Array[]>;
  private _state: Nullable<PCAGeometryCacheState>;
  private readonly _meshBindings: WeakMap<Mesh, GeometryCacheMeshBinding>;

  constructor(data?: Partial<PCAGeometryCacheTrackData>, embedded?: boolean) {
    super(embedded);
    this._times = data?.times ?? new Float32Array();
    this._bounds = data?.bounds ?? [];
    this._positionReference = data?.positionReference ?? null;
    this._positionMean = data?.positionMean ?? new Float32Array();
    this._positionBases = data?.positionBases ?? [];
    this._positionCoefficients = data?.positionCoefficients ?? [];
    this._normalMean = data?.normalMean ?? null;
    this._normalBases = data?.normalBases ?? null;
    this._normalCoefficients = data?.normalCoefficients ?? null;
    this._state =
      this._positionMean.length > 0
        ? createGeometryCacheState({
            positions: this._positionMean,
            normals: this._normalMean
          })
        : null;
    this._meshBindings = new WeakMap();
  }

  get times() {
    return this._times;
  }

  set times(value: Float32Array) {
    this._times = value ?? new Float32Array();
  }

  get bounds() {
    return this._bounds;
  }

  set bounds(value: [number, number, number, number, number, number][]) {
    this._bounds = value ?? [];
  }

  get positionMean() {
    return this._positionMean;
  }

  get positionReference() {
    return this._positionReference;
  }

  set positionReference(value: Nullable<Float32Array>) {
    this._positionReference = value ?? null;
  }

  set positionMean(value: Float32Array) {
    this._positionMean = value ?? new Float32Array();
    this._state =
      this._positionMean.length > 0
        ? createGeometryCacheState({
            positions: this._positionMean,
            normals: this._normalMean
          })
        : null;
  }

  get positionBases() {
    return this._positionBases;
  }

  set positionBases(value: Float32Array[]) {
    this._positionBases = value ?? [];
  }

  get positionCoefficients() {
    return this._positionCoefficients;
  }

  set positionCoefficients(value: Float32Array[]) {
    this._positionCoefficients = value ?? [];
  }

  get normalMean() {
    return this._normalMean;
  }

  set normalMean(value: Nullable<Float32Array>) {
    this._normalMean = value ?? null;
  }

  get normalBases() {
    return this._normalBases;
  }

  set normalBases(value: Nullable<Float32Array[]>) {
    this._normalBases = value ?? null;
  }

  get normalCoefficients() {
    return this._normalCoefficients;
  }

  set normalCoefficients(value: Nullable<Float32Array[]>) {
    this._normalCoefficients = value ?? null;
  }

  calculateState(_target: object, currentTime: number) {
    if (!this._state || this._positionMean.length === 0) {
      throw new Error('PCAGeometryCacheTrack.calculateState(): no PCA data available');
    }
    if (this._times.length <= 1 || this._positionCoefficients.length <= 1) {
      return this.reconstructFrame(0, 0, 0);
    }
    if (currentTime <= this._times[0]) {
      return this.reconstructFrame(0, 0, 0);
    }
    const lastIndex = this._times.length - 1;
    if (currentTime >= this._times[lastIndex]) {
      return this.reconstructFrame(lastIndex, lastIndex, 0);
    }
    let right = 1;
    while (right < this._times.length && this._times[right] < currentTime) {
      right++;
    }
    const left = Math.max(0, right - 1);
    const start = this._times[left];
    const end = this._times[right];
    const t = end > start ? (currentTime - start) / (end - start) : 0;
    return this.reconstructFrame(left, right, t);
  }

  applyState(target: object, state: PCAGeometryCacheState) {
    const mesh = target as Mesh;
    const binding = ensureGeometryCacheMeshBinding(
      this._meshBindings,
      mesh,
      state,
      'PCAGeometryCacheTrack.applyState()'
    );
    binding.positionBuffer.bufferSubData(0, state.positions as unknown as Float32Array<ArrayBuffer>);
    if (binding.normalBuffer && state.normals) {
      binding.normalBuffer.bufferSubData(0, state.normals as unknown as Float32Array<ArrayBuffer>);
    }
    mesh.setAnimatedBoundingBox(state.boundingBox);
  }

  mixState(a: PCAGeometryCacheState, b: PCAGeometryCacheState, t: number) {
    if (!this._state) {
      throw new Error('PCAGeometryCacheTrack.mixState(): invalid state');
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
    if (this._positionMean.length > 0) {
      this.applyState(target, this.reconstructFrame(0, 0, 0));
    }
  }

  private reconstructFrame(leftIndex: number, rightIndex: number, t: number) {
    if (!this._state) {
      this._state = createGeometryCacheState({
        positions: this._positionMean,
        normals: this._normalMean
      });
    }
    this._state.positions.set(this._positionMean);
    const leftPositionCoefficients = this._positionCoefficients[leftIndex] ?? null;
    const rightPositionCoefficients = this._positionCoefficients[rightIndex] ?? leftPositionCoefficients;
    if (leftPositionCoefficients && rightPositionCoefficients) {
      for (let component = 0; component < this._positionBases.length; component++) {
        const basis = this._positionBases[component];
        const coefficient =
          leftPositionCoefficients[component] +
          ((rightPositionCoefficients[component] ?? leftPositionCoefficients[component]) -
            leftPositionCoefficients[component]) *
            t;
        if (coefficient === 0) {
          continue;
        }
        for (let i = 0; i < this._state.positions.length; i++) {
          this._state.positions[i] += basis[i] * coefficient;
        }
      }
    }
    if (this._normalMean && this._normalBases && this._normalCoefficients) {
      if (!this._state.normals || this._state.normals.length !== this._normalMean.length) {
        this._state.normals = new Float32Array(this._normalMean.length);
      }
      this._state.normals.set(this._normalMean);
      const leftNormalCoefficients = this._normalCoefficients[leftIndex] ?? null;
      const rightNormalCoefficients = this._normalCoefficients[rightIndex] ?? leftNormalCoefficients;
      if (leftNormalCoefficients && rightNormalCoefficients) {
        for (let component = 0; component < this._normalBases.length; component++) {
          const basis = this._normalBases[component];
          const coefficient =
            leftNormalCoefficients[component] +
            ((rightNormalCoefficients[component] ?? leftNormalCoefficients[component]) -
              leftNormalCoefficients[component]) *
              t;
          if (coefficient === 0) {
            continue;
          }
          for (let i = 0; i < this._state.normals.length; i++) {
            this._state.normals[i] += basis[i] * coefficient;
          }
        }
      }
    } else {
      this._state.normals = null;
    }
    const leftBox = this.getFrameBoundingBox(leftIndex);
    const rightBox = this.getFrameBoundingBox(rightIndex);
    this._state.boundingBox.minPoint.setXYZ(
      leftBox.minPoint.x + (rightBox.minPoint.x - leftBox.minPoint.x) * t,
      leftBox.minPoint.y + (rightBox.minPoint.y - leftBox.minPoint.y) * t,
      leftBox.minPoint.z + (rightBox.minPoint.z - leftBox.minPoint.z) * t
    );
    this._state.boundingBox.maxPoint.setXYZ(
      leftBox.maxPoint.x + (rightBox.maxPoint.x - leftBox.maxPoint.x) * t,
      leftBox.maxPoint.y + (rightBox.maxPoint.y - leftBox.maxPoint.y) * t,
      leftBox.maxPoint.z + (rightBox.maxPoint.z - leftBox.maxPoint.z) * t
    );
    return this._state;
  }

  private getFrameBoundingBox(index: number) {
    const values = this._bounds[index] ?? this._bounds[0] ?? [0, 0, 0, 0, 0, 0];
    return new BoundingBox(
      new Vector3(values[0], values[1], values[2]),
      new Vector3(values[3], values[4], values[5])
    );
  }
}
