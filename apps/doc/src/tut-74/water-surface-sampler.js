import { Vector3 } from '@zephyr3d/base';

/**
 * Height queries against an ocean surface, driven by the material's own
 * evaluation of it.
 *
 * Why this and not a CPU-side reconstruction of the spectrum: the displacement
 * the material draws with is produced on the GPU from a random field, and any
 * second implementation of it - re-deriving the spectrum, decoding the height
 * textures, or summing the dominant waves - is a different function that has to
 * be kept in step by hand. `Water.getSurfacePoint` asks the material instead, so
 * it is exact by construction. What it costs is one point-list draw and one
 * readback per batch, which is why queries here are batched and throttled rather
 * than issued per call.
 *
 * The queries are placed on a lattice at construction and never move. A frame
 * asks for the same small set of positions every time, so the whole set costs one
 * draw and one position readback - the same as a single query would - and the
 * answer is interpolated across the lattice on demand.
 *
 * ## The motion
 *
 * The reported height eases towards the newest measurement, exponentially, and
 * nothing else is done to it. That is deliberate. Compensating the query lag is
 * tempting - the measurement describes the surface a round trip before it can be
 * used - but every attempt at it here bought its smoothness back by other means:
 * predicting from a velocity needs that velocity smoothed, extrapolating a wave
 * diverges as the square of the distance, and rate limiting the result
 * reintroduces the stepping it was meant to remove. A plain ease has none of
 * those failure modes, and the lag it leaves is the lag a floating body has
 * anyway.
 *
 * The lag shows up as a hull lifting clear of a steep drop. That was chased for a
 * while and is not worth chasing: easing down faster than up does reduce it, and
 * clamping the reported height so it can never stand above the measurement
 * removes it outright, but the clamp has to be applied against a *continuous*
 * ceiling rather than against the measurement itself. Applied against the
 * measurement - which only changes when a batch lands - it pins the height to a
 * staircase and the descent becomes a series of steps, worse than the gap it was
 * fixing. A boat launching off the back of a swell is the honest reading of the
 * same motion, so the gap is left alone.
 *
 * `timeConstant` is in seconds rather than frames so that the behaviour does not
 * change with frame rate.
 *
 * Consequences a caller has to accept:
 * - Resolution is the lattice spacing. A grid at `h` metres resolves nothing
 *   shorter than about `2 * h`, so a sea whose shortest wave is `L` needs
 *   `h <= L / 2` before the height it reports stops being an average. Measured
 *   against exact queries at a 6 m spacing over a sea with a 16 m shortest
 *   cascade, the height is off by about 0.3 m rms against a wave amplitude of
 *   about 1 m rms.
 * - A probe outside the lattice is answered by the nearest cell rather than by a
 *   wrapped one; this is a window on the water, not a repeating field.
 * - Nothing is known until the first batch lands; until then queries return the
 *   still-water level.
 */
export class WaterSurfaceSampler {
  /**
   * @param {import('@zephyr3d/scene').Water} water - The water body to sample.
   * @param {object} [options] - Sampler options.
   * @param {number} [options.spacing] - Lattice cell size in world metres.
   * @param {number} [options.cols] - Lattice columns (X).
   * @param {number} [options.rows] - Lattice rows (Z).
   * @param {number} [options.updateHz] - Upper bound on the query rate in hertz. The
   *   achieved rate is the lower of this and what a batch costs.
   * @param {number} [options.timeConstant] - Seconds for the reported height to close most
   *   of the gap to a new measurement. Lower is tighter to the wave, higher is heavier.
   */
  constructor(water, options = {}) {
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

    // The lattice is anchored on the water's own origin and kept in world space,
    // because that is the space the queries are issued in.
    const ox = water ? water.worldMatrix.m03 : 0;
    const oz = water ? water.worldMatrix.m23 : 0;
    this._originX = ox - ((this._cols - 1) / 2) * this._spacing;
    this._originZ = oz - ((this._rows - 1) / 2) * this._spacing;

    const count = this._cols * this._rows;
    /** @type {Vector3[]} Query positions, reused every frame. */
    this._inputs = new Array(count);
    /** @type {Vector3[]} Scratch destinations for the batch, reused every frame. */
    this._outPos = new Array(count);
    for (let j = 0; j < this._rows; j++) {
      for (let i = 0; i < this._cols; i++) {
        const k = j * this._cols + i;
        this._inputs[k] = new Vector3(this._originX + i * this._spacing, 0, this._originZ + j * this._spacing);
        this._outPos[k] = new Vector3();
      }
    }
    /**
     * Additional world positions evaluated with each batch, on top of the lattice.
     *
     * The lattice is fixed. Anything that wants the surface at a moving position -
     * a body's own footprint, a cross-check dot - registers the position here and
     * it rides along in the same draw and the same readback. Making these a second
     * call to the water instead would put two feedback renders in one frame,
     * each swapping the framebuffer, and the second one landing mid-frame is what
     * shows as a black flash.
     *
     * @type {{inputs: Vector3[], outputs: Vector3[], onResult: (results: Vector3[], inputs: Vector3[]) => void}[]}
     */
    this._extraListeners = [];
    /** @type {Vector3[]} Lattice inputs followed by the extras, rebuilt when the extras change. */
    this._batchInputs = this._inputs;
    /** @type {Vector3[]} Matching outputs. */
    this._batchOutputs = this._outPos;
    this._extrasDirty = false;
    /** @type {Float32Array|null} Heights the queries read; null until the first batch. */
    this._height = null;
    /** @type {Float32Array|null} Where the newest measurement put the surface. */
    this._target = null;
  }

  /** Water clock of the newest accepted batch, in seconds. */
  get waveTime() {
    return this._waveTime;
  }

  /**
   * Upper bound on the query rate in hertz.
   *
   * A ceiling, not a schedule: a batch is issued as soon as the previous one has
   * landed if that is sooner. Raising it past what a batch costs changes nothing.
   */
  get updateHz() {
    return this._updateHz;
  }

  set updateHz(val) {
    this._updateHz = Math.max(0.1, val);
  }

  /**
   * Seconds for the reported height to close most of the gap to a new measurement.
   *
   * The knob for the motion's character. Short is tight to the wave and nervous,
   * long is heavy and slow. It is in seconds rather than per-frame so that the
   * behaviour does not change with frame rate.
   */
  get timeConstant() {
    return this._timeConstant;
  }

  set timeConstant(val) {
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

  /**
   * Register world positions to evaluate alongside the lattice, every batch.
   *
   * The array is held by reference and read when a batch is issued, so a caller
   * updates the vectors in place each frame and the next batch picks them up.
   * The listener receives the surface positions for those inputs when the batch
   * lands, in the same order.
   *
   * @param {Vector3[]} inputs - World positions; only X and Z are used.
   * @param {(results: Vector3[], inputs: Vector3[]) => void} onResult - Called per batch.
   * @returns {() => void} Unregister.
   */
  addExtraPoints(inputs, onResult) {
    const outputs = inputs.map(() => new Vector3());
    const entry = { inputs, outputs, onResult };
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

  /** @internal */
  _rebuildBatchArrays() {
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
   * Advance the sampler. Call once per frame with the frame's delta.
   *
   * @param {number} deltaSeconds - Frame delta in seconds.
   */
  update(deltaSeconds) {
    if (!this._water) {
      return;
    }
    this._framesSinceLastBatch++;
    // Easing happens here, once a frame, rather than inside the query, so that
    // every query in a frame sees the same value and asking for more points does
    // not advance the surface further.
    if (this._height && this._target) {
      // The exact exponential decay, not `1 - dt/tau` approximated per frame.
      // Stepping a linear lerp leaves the result dependent on the frame size -
      // a 30fps run converges measurably further in the same wall-clock time than
      // a 60fps one - and this form has no such error at any step size.
      //
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
    // Waiting for a fixed interval on top of the batch's own duration is pure
    // added lag when the batch is the slower of the two.
    if (this._elapsed >= 1 / this._updateHz) {
      this._elapsed = 0;
      this._pending = true;
      this._pendingSince = 0;
      this._rebuildBatchArrays();
      this._totalPoints = this._batchInputs.length;
      // Only positions: the normal attachment would double the readback, and a
      // height query does not need it.
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
   * Point the sampler at a batch that just landed.
   *
   * The measurement becomes the target the reported height eases towards; it is
   * not written into the reported height directly, because that is what turns
   * every batch boundary into a step.
   *
   * @internal
   */
  _acceptBatch() {
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
      // The first batch is adopted outright: there is no previous surface to ease
      // from, and starting from the still-water level would sink every object
      // into the water and lift it out again on load.
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
    // The extras' outputs were written in place by the same call, since they
    // are the tail of `_batchOutputs`; hand each listener its slice.
    for (const entry of this._extraListeners) {
      entry.onResult(entry.outputs, entry.inputs);
    }
  }

  /**
   * Surface world Y at a world XZ.
   *
   * Bilinear over the lattice, clamped at the edges rather than wrapped: this is
   * a window on the water, not a repeating field, so a query outside it is
   * answered by the nearest cell instead of by one from the far side.
   *
   * The table this reads is advanced once a frame by {@link update}, so this is a
   * pure lookup and can be called as often as a caller likes without the answer
   * depending on how often it does.
   *
   * @param {number} x - World X.
   * @param {number} z - World Z.
   * @returns {number} World Y of the surface, or the still-water level before the first batch.
   */
  sampleWorldY(x, z) {
    return this._sampleTable(this._height, x, z);
  }

  /**
   * Surface world Y at a world XZ, from the newest measurement with no easing.
   *
   * The eased table exists for a caller that puts an object directly at the
   * height it reads, and needs the height to move smoothly because the object
   * has no inertia of its own. A rigid body has inertia. Feeding it the eased
   * height adds a second lag on top of the one the query already carries - a
   * first-order ease with a quarter-second time constant sits about a quarter
   * of a second behind a one-radian-per-second swell - and a body a quarter
   * second behind a falling surface is a body in the air. So the physics reads
   * this instead.
   *
   * @param {number} x - World X.
   * @param {number} z - World Z.
   * @returns {number} World Y of the surface, or the still-water level before the first batch.
   */
  sampleWorldYRaw(x, z) {
    return this._sampleTable(this._target, x, z);
  }

  /** @internal */
  _sampleTable(table, x, z) {
    if (!table) {
      return this._water ? this._water.worldMatrix.m13 : 0;
    }
    const u = (x - this._originX) / this._spacing;
    const v = (z - this._originZ) / this._spacing;
    const cu = Math.min(this._cols - 1, Math.max(0, u));
    const cv = Math.min(this._rows - 1, Math.max(0, v));
    const i0 = Math.min(this._cols - 2, Math.max(0, Math.floor(cu)));
    const j0 = Math.min(this._rows - 2, Math.max(0, Math.floor(cv)));
    const fu = Math.min(1, Math.max(0, cu - i0));
    const fv = Math.min(1, Math.max(0, cv - j0));
    const wu0 = 1 - fu;
    const wu1 = fu;
    const wv0 = 1 - fv;
    const wv1 = fv;
    const r0 = j0 * this._cols;
    const r1 = (j0 + 1) * this._cols;
    const c0 = i0;
    const c1 = i0 + 1;
    return (
      (table[r0 + c0] * wu0 + table[r0 + c1] * wu1) * wv0 +
      (table[r1 + c0] * wu0 + table[r1 + c1] * wu1) * wv1
    );
  }

  /**
   * Surface normal from the sampled lattice, by central differences.
   *
   * @param {number} x - World X.
   * @param {number} z - World Z.
   * @param {Vector3} [out] - Destination, or a new vector.
   * @returns {Vector3} Unit normal, Y up.
   */
  sampleNormal(x, z, out) {
    const h = this._spacing;
    const dx = this.sampleWorldY(x + h, z) - this.sampleWorldY(x - h, z);
    const dz = this.sampleWorldY(x, z + h) - this.sampleWorldY(x, z - h);
    const nx = -dx / (2 * h);
    const nz = -dz / (2 * h);
    const len = Math.hypot(nx, 1, nz);
    return (out ?? new Vector3()).setXYZ(nx / len, 1 / len, nz / len);
  }
}
