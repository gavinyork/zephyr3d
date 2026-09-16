import type { Nullable } from '@zephyr3d/base';
import { Vector3 } from '@zephyr3d/base';

/**
 * What {@link WaterSurfaceSampler} needs from a body of water: where its rest
 * plane is, what time its surface is at, and a way to evaluate the displaced
 * surface at a set of positions. {@link Water} provides all three.
 * @public
 */
export interface WaterSurfaceSource {
  /** World matrix; only the translation is read. */
  readonly worldMatrix: { readonly m03: number; readonly m13: number; readonly m23: number };
  /** Wave clock of the surface, in seconds. */
  readonly waveTime: number;
  /** Evaluate the displaced surface over world XZ positions. */
  getSurfacePoint(points: Vector3[], outPos?: Vector3[], outNorm?: Vector3[]): Promise<void>;
}

/**
 * Options for {@link WaterSurfaceSampler}.
 * @public
 */
export interface WaterSurfaceSamplerOptions {
  /** Lattice cell size in world metres. Defaults to 6. */
  spacing?: number;
  /** Lattice columns, along X. Defaults to 24. */
  cols?: number;
  /** Lattice rows, along Z. Defaults to 24. */
  rows?: number;
  /**
   * Upper bound on the query rate in hertz. The achieved rate is the lower of
   * this and what a batch costs. Defaults to 30.
   */
  updateHz?: number;
  /**
   * Seconds for the reported height to close most of the gap to a new
   * measurement. Lower is tighter to the wave, higher is heavier. Defaults to
   * 0.25.
   */
  timeConstant?: number;
}

/** A set of moving positions evaluated alongside the lattice. @internal */
interface ExtraPoints {
  inputs: Vector3[];
  outputs: Vector3[];
  onResult: (results: Vector3[], inputs: Vector3[]) => void;
}

/**
 * Height queries against a water surface, driven by the material's own
 * evaluation of it.
 *
 * Why this and not a CPU-side reconstruction of the waves: the displacement the
 * material draws with is produced on the GPU, and any second implementation of
 * it - re-deriving the spectrum, decoding the height textures, summing the
 * dominant waves - is a different function that has to be kept in step by
 * hand. {@link Water.getSurfacePoint} asks the material instead, so it is exact
 * by construction, and it includes whatever else displaces the surface, such as
 * a {@link WaterInteraction} field. What it costs is one point-list draw and one
 * readback per batch, which is why queries here are batched and throttled
 * rather than issued per call.
 *
 * The queries are placed on a lattice at construction and never move. A frame
 * asks for the same small set of positions every time, so the whole set costs
 * one draw and one readback - the same as a single query would - and the answer
 * is interpolated across the lattice on demand. Positions that move (a hull's
 * own footprint, say) ride along through {@link addExtraPoints}.
 *
 * ## The motion
 *
 * The reported height eases towards the newest measurement, exponentially, and
 * nothing else is done to it. Compensating the query lag is tempting - the
 * measurement describes the surface a round trip before it can be used - but
 * every attempt at it bought its smoothness back by other means: predicting
 * from a velocity needs that velocity smoothed, extrapolating a wave diverges
 * as the square of the distance, and rate limiting the result reintroduces the
 * stepping it was meant to remove. A plain ease has none of those failure
 * modes, and the lag it leaves is the lag a floating body has anyway. A rigid
 * body should read {@link sampleWorldYRaw} instead and supply its own inertia.
 *
 * Consequences a caller has to accept:
 * - Resolution is the lattice spacing. A grid at `h` metres resolves nothing
 *   shorter than about `2 * h`.
 * - A probe outside the lattice is answered by the nearest cell rather than by
 *   a wrapped one; this is a window on the water, not a repeating field.
 * - Nothing is known until the first batch lands; until then queries return
 *   the still-water level.
 *
 * @public
 */
export class WaterSurfaceSampler {
  private readonly _water: WaterSurfaceSource;
  private readonly _spacing: number;
  private readonly _cols: number;
  private readonly _rows: number;
  private _updateHz: number;
  private _timeConstant: number;
  private _pending: boolean;
  private _elapsed: number;
  private _waveTime: number;
  private _readCount: number;
  private _failCount: number;
  private _totalPoints: number;
  private _pendingSince: number;
  private _lastLatency: number;
  private _batchFrames: number;
  private _framesSinceLastBatch: number;
  private readonly _originX: number;
  private readonly _originZ: number;
  private readonly _inputs: Vector3[];
  private readonly _outPos: Vector3[];
  private readonly _extraListeners: ExtraPoints[];
  private _batchInputs: Vector3[];
  private _batchOutputs: Vector3[];
  private _extrasDirty: boolean;
  /** Heights the queries read; null until the first batch. */
  private _height: Nullable<Float32Array>;
  /** Where the newest measurement put the surface. */
  private _target: Nullable<Float32Array>;
  /**
   * Creates a sampler over a body of water.
   * @param water - The water to sample.
   * @param options - Lattice and rate options.
   */
  constructor(water: WaterSurfaceSource, options: WaterSurfaceSamplerOptions = {}) {
    this._water = water;
    this._spacing = Math.max(0.01, options.spacing ?? 6);
    this._cols = Math.max(2, Math.floor(options.cols ?? 24));
    this._rows = Math.max(2, Math.floor(options.rows ?? 24));
    this._updateHz = Math.max(0.1, options.updateHz ?? 30);
    this._timeConstant = Math.max(0.001, options.timeConstant ?? 0.25);
    this._pending = false;
    this._elapsed = 0;
    this._waveTime = 0;
    this._readCount = 0;
    this._failCount = 0;
    this._totalPoints = 0;
    this._pendingSince = 0;
    this._lastLatency = 0;
    this._batchFrames = 0;
    this._framesSinceLastBatch = 0;
    // The lattice is anchored on the water's own origin and kept in world
    // space, because that is the space the queries are issued in.
    const ox = water.worldMatrix.m03;
    const oz = water.worldMatrix.m23;
    this._originX = ox - ((this._cols - 1) / 2) * this._spacing;
    this._originZ = oz - ((this._rows - 1) / 2) * this._spacing;
    const count = this._cols * this._rows;
    this._inputs = new Array(count);
    this._outPos = new Array(count);
    for (let j = 0; j < this._rows; j++) {
      for (let i = 0; i < this._cols; i++) {
        const k = j * this._cols + i;
        this._inputs[k] = new Vector3(
          this._originX + i * this._spacing,
          0,
          this._originZ + j * this._spacing
        );
        this._outPos[k] = new Vector3();
      }
    }
    this._extraListeners = [];
    this._batchInputs = this._inputs;
    this._batchOutputs = this._outPos;
    this._extrasDirty = false;
    this._height = null;
    this._target = null;
  }
  /** Water clock of the newest accepted batch, in seconds. */
  get waveTime() {
    return this._waveTime;
  }
  /**
   * Upper bound on the query rate in hertz.
   *
   * A ceiling, not a schedule: a batch is issued as soon as the previous one
   * has landed if that is sooner. Raising it past what a batch costs changes
   * nothing.
   */
  get updateHz() {
    return this._updateHz;
  }
  set updateHz(val: number) {
    this._updateHz = Math.max(0.1, val);
  }
  /**
   * Seconds for the reported height to close most of the gap to a new
   * measurement. In seconds rather than per frame so that the behaviour does
   * not change with frame rate.
   */
  get timeConstant() {
    return this._timeConstant;
  }
  set timeConstant(val: number) {
    this._timeConstant = Math.max(0.001, val);
  }
  /** Batches completed since construction. */
  get readCount() {
    return this._readCount;
  }
  /** Batches that failed. */
  get failCount() {
    return this._failCount;
  }
  /** True while a batch is in flight. */
  get pending() {
    return this._pending;
  }
  /** Seconds the batch in flight has been outstanding, or 0 when none is. */
  get pendingSeconds() {
    return this._pending ? this._pendingSince : 0;
  }
  /** Batch latency in seconds, as of the last one that landed. */
  get lastLatency() {
    return this._lastLatency;
  }
  /** Frames the newest batch took to come back. */
  get batchFrames() {
    return this._batchFrames;
  }
  /** Points evaluated per batch, the cost driver of this sampler. */
  get batchSize() {
    return this._totalPoints;
  }
  /** True once a batch has landed and queries return surface heights. */
  get ready() {
    return !!this._height;
  }
  /** World metres between lattice samples. */
  get spacing() {
    return this._spacing;
  }
  /** World Y of the still-water level. */
  get waterLevel() {
    return this._water.worldMatrix.m13;
  }
  /**
   * Register world positions to evaluate alongside the lattice, every batch.
   *
   * The array is held by reference and read when a batch is issued, so a
   * caller updates the vectors in place each frame and the next batch picks
   * them up. The listener receives the surface positions for those inputs when
   * the batch lands, in the same order. Making these a second call to the
   * water instead would put two feedback renders in one frame.
   *
   * @param inputs - World positions; only X and Z are used.
   * @param onResult - Called per batch with the surface positions.
   * @returns A function that unregisters the points.
   */
  addExtraPoints(inputs: Vector3[], onResult: (results: Vector3[], inputs: Vector3[]) => void) {
    const outputs = inputs.map(() => new Vector3());
    const entry: ExtraPoints = { inputs, outputs, onResult };
    this._extraListeners.push(entry);
    this._extrasDirty = true;
    return () => {
      const i = this._extraListeners.indexOf(entry);
      if (i >= 0) {
        this._extraListeners.splice(i, 1);
        this._extrasDirty = true;
      }
    };
  }
  /**
   * Advance the sampler. Call once per frame with the frame's delta.
   * @param deltaSeconds - Frame delta in seconds.
   */
  update(deltaSeconds: number) {
    this._framesSinceLastBatch++;
    // Easing happens here, once a frame, rather than inside the query, so that
    // every query in a frame sees the same value and asking for more points
    // does not advance the surface further. The exact exponential decay, not
    // `1 - dt/tau` approximated per frame, so the result does not depend on
    // the frame size.
    if (this._height && this._target) {
      const k = 1 - Math.exp(-deltaSeconds / this._timeConstant);
      const height = this._height;
      const target = this._target;
      for (let i = 0; i < height.length; i++) {
        height[i] += (target[i] - height[i]) * k;
      }
    }
    if (this._pending) {
      this._pendingSince += deltaSeconds;
      return;
    }
    this._elapsed += deltaSeconds;
    // Fire as soon as the previous batch has landed, capped at `updateHz`.
    if (this._elapsed >= 1 / this._updateHz) {
      this._elapsed = 0;
      this._pending = true;
      this._pendingSince = 0;
      this._rebuildBatchArrays();
      this._totalPoints = this._batchInputs.length;
      // Only positions: the normal attachment would double the readback.
      this._water
        .getSurfacePoint(this._batchInputs, this._batchOutputs)
        .then(() => this._acceptBatch())
        .catch((err) => {
          this._pending = false;
          this._pendingSince = 0;
          this._failCount++;
          console.error('WaterSurfaceSampler: surface query failed', err);
        });
    }
  }
  /**
   * Surface world Y at a world XZ, eased.
   *
   * Bilinear over the lattice, clamped at the edges rather than wrapped. The
   * table this reads is advanced once a frame by {@link update}, so this is a
   * pure lookup and can be called as often as a caller likes.
   *
   * For something placed directly at the height it reads, which has no
   * inertia of its own and needs the height to move smoothly.
   */
  sampleWorldY(x: number, z: number) {
    return this._sampleTable(this._height, x, z);
  }
  /**
   * Surface world Y at a world XZ, from the newest measurement with no easing.
   *
   * For a rigid body. Feeding it the eased height adds a second lag on top of
   * the one the query already carries, and a body a quarter second behind a
   * falling surface is a body in the air.
   */
  sampleWorldYRaw(x: number, z: number) {
    return this._sampleTable(this._target, x, z);
  }
  /**
   * Surface normal from the eased lattice, by central differences one cell
   * apart.
   * @param out - Destination, or a new vector.
   * @returns Unit normal, Y up.
   */
  sampleNormal(x: number, z: number, out?: Vector3) {
    const h = this._spacing;
    const dx = this.sampleWorldY(x + h, z) - this.sampleWorldY(x - h, z);
    const dz = this.sampleWorldY(x, z + h) - this.sampleWorldY(x, z - h);
    const nx = -dx / (2 * h);
    const nz = -dz / (2 * h);
    const len = Math.hypot(nx, 1, nz);
    return (out ?? new Vector3()).setXYZ(nx / len, 1 / len, nz / len);
  }
  /** @internal */
  private _rebuildBatchArrays() {
    if (!this._extrasDirty) {
      return;
    }
    this._extrasDirty = false;
    if (this._extraListeners.length === 0) {
      this._batchInputs = this._inputs;
      this._batchOutputs = this._outPos;
      return;
    }
    const inputs = this._inputs.slice();
    const outputs = this._outPos.slice();
    for (const entry of this._extraListeners) {
      for (let i = 0; i < entry.inputs.length; i++) {
        inputs.push(entry.inputs[i]);
        outputs.push(entry.outputs[i]);
      }
    }
    this._batchInputs = inputs;
    this._batchOutputs = outputs;
  }
  /**
   * Point the sampler at a batch that just landed. The measurement becomes the
   * target the reported height eases towards; the first batch is adopted
   * outright, since there is no previous surface to ease from.
   * @internal
   */
  private _acceptBatch() {
    this._pending = false;
    this._lastLatency = this._pendingSince;
    this._pendingSince = 0;
    this._elapsed = 0;
    const count = this._outPos.length;
    if (!this._target) {
      this._target = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        this._target[i] = this._outPos[i].y;
      }
      this._height = this._target.slice();
    } else {
      for (let i = 0; i < count; i++) {
        this._target[i] = this._outPos[i].y;
      }
    }
    this._batchFrames = this._framesSinceLastBatch;
    this._framesSinceLastBatch = 0;
    this._readCount++;
    this._waveTime = this._water.waveTime;
    for (const entry of this._extraListeners) {
      entry.onResult(entry.outputs, entry.inputs);
    }
  }
  /** @internal */
  private _sampleTable(table: Nullable<Float32Array>, x: number, z: number) {
    if (!table) {
      return this._water.worldMatrix.m13;
    }
    const u = (x - this._originX) / this._spacing;
    const v = (z - this._originZ) / this._spacing;
    const cu = Math.min(this._cols - 1, Math.max(0, u));
    const cv = Math.min(this._rows - 1, Math.max(0, v));
    const i0 = Math.min(this._cols - 2, Math.max(0, Math.floor(cu)));
    const j0 = Math.min(this._rows - 2, Math.max(0, Math.floor(cv)));
    const fu = Math.min(1, Math.max(0, cu - i0));
    const fv = Math.min(1, Math.max(0, cv - j0));
    const r0 = j0 * this._cols;
    const r1 = (j0 + 1) * this._cols;
    return (
      (table[r0 + i0] * (1 - fu) + table[r0 + i0 + 1] * fu) * (1 - fv) +
      (table[r1 + i0] * (1 - fu) + table[r1 + i0 + 1] * fu) * fv
    );
  }
}
