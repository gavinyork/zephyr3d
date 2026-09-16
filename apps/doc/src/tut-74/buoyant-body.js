import { Quaternion, Vector3 } from '@zephyr3d/base';

/** Standard gravity, in metres per second squared. */
const GRAVITY = 9.81;
/**
 * Largest physics step, in seconds.
 *
 * The buoyancy that holds a hull up is a hard spring - half a metre of sink
 * produces a force comparable to the hull's whole weight - so a frame that
 * arrives late would advance it far enough to overshoot and diverge. Steps are
 * capped at this and the remainder is carried, which costs a little accuracy on a
 * stutter and keeps the simulation bounded.
 */
const MAX_STEP = 1 / 120;
/** Ceiling on steps per frame, so a very late frame cannot stall the loop. */
const MAX_STEPS_PER_FRAME = 8;

/**
 * Rotate `v` by `q` into `out`. The two-cross-product form, which is the usual
 * `q v q*` expanded so it needs no matrix.
 *
 * `scratchA` and `scratchB` are the caller's, not module-level, because this is
 * called twice within a step and the intermediates must not be shared between
 * those calls - a single pair of module temporaries is aliased by the second call
 * while the first is still using them.
 */
function rotateVector(q, v, out, scratchA, scratchB) {
  // t = 2 * (q.xyz x v)
  scratchA.setXYZ(q.x, q.y, q.z);
  Vector3.cross(scratchA, v, scratchB);
  scratchB.scaleBy(2);
  // out = v + q.w * t + q.xyz x t
  Vector3.cross(scratchA, scratchB, out);
  Vector3.scale(scratchB, q.w, scratchA);
  out.addBy(scratchA);
  out.addBy(v);
  return out;
}

/**
 * A rigid body that floats on a sampled water surface.
 *
 * The motion is force driven, not position driven: the body owns a position, an
 * orientation and their velocities, and the water only ever applies a force and a
 * torque to them. That is the difference that makes a hull behave like a hull -
 * it has mass, so it lags the surface, overshoots into it and rolls back, instead
 * of sliding along a height field.
 *
 * ## The forces
 *
 * Each probe is a block of the hull and carries an equal share of the lift the
 * body can produce, scaled by how much of the block is under. Probes spread
 * across a hull therefore produce a righting torque as well as lift: the water
 * pushes up hardest on whichever side has more of its blocks under, which rolls
 * a boat back upright. That is the whole of the attitude solve - there is no
 * separate upright target, only the distribution of lift.
 *
 * The lift a fully submerged body produces is `mass * g / submergedFraction`,
 * after the NaughtyWaterBuoyancy scheme: the float height is set by the
 * fraction alone and the mass cancels out of the buoyant motion entirely. See
 * the constructor for why that is a feature rather than a shortcut.
 *
 * ## What is not simulated
 *
 * No collision, no hull-volume integral, no added mass. A probe's contribution
 * grows linearly with depth up to the hull's own height, which is wrong for a
 * fully submerged hull but accurate while a vessel rides on its waterline, and it
 * is the waterline case this exists for.
 */
export class BuoyantBody {
  /**
   * @param {object} spec - Body specification.
   * @param {import('@zephyr3d/scene').SceneNode} spec.node - The node to drive.
   * @param {Vector3} spec.size - Full extents in metres, in local axes.
   * @param {number} [spec.mass] - Mass in kilograms. Sets how the body answers forces other
   *   than buoyancy and gravity; the float height and the buoyant motion do not depend on it.
   * @param {number} [spec.submergedFraction] - Share of the hull's height below the waterline
   *   at rest, which is the body's density relative to water. Lower floats higher.
   * @param {number} [spec.linearDamping] - Fraction of linear velocity shed per second in water.
   * @param {number} [spec.angularDamping] - Fraction of angular velocity shed per second in water.
   * @param {number} [spec.airLinearDamping] - The same, clear of the water.
   * @param {number} [spec.airAngularDamping] - The same, clear of the water.
   * @param {number} [spec.probeColumns] - Probes across the local X axis.
   * @param {number} [spec.probeRows] - Probes across the local Z axis.
   * @param {number} [spec.probeLayers] - Probes up the local Y axis.
   */
  constructor(spec) {
    const size = spec.size;
    this.node = spec.node;
    this.size = size.clone();
    this.submergedFraction = Math.min(0.95, Math.max(0.05, spec.submergedFraction ?? 0.5));
    // Damping, as a per-second fraction of velocity shed.
    //
    // The defaults are tuned to the heave frequency a box like this bobs at,
    // sqrt(rho g A / m), which for a hull a metre or two across comes to a few
    // radians per second. Critical damping is roughly twice that; the values
    // here sit well under it, so a body dropped on the water bounces a couple of
    // times and settles within a second or two rather than ringing for ten.
    this.linearDamping = Math.max(0, spec.linearDamping ?? 2.5);
    this.angularDamping = Math.max(0, spec.angularDamping ?? 3);
    // The same in air, much lower. A body launched clear of the water keeps its
    // spin and its speed until it lands, which the water damping applied in the
    // air would kill in a frame or two. Blended by how much of the body is
    // under, so a hull half out is half damped.
    this.airLinearDamping = Math.max(0, spec.airLinearDamping ?? 0.05);
    this.airAngularDamping = Math.max(0, spec.airAngularDamping ?? 0.1);
    this.position = new Vector3();
    this.rotation = new Quaternion();
    this.velocity = new Vector3();
    this.angularVelocity = new Vector3();
    this.force = new Vector3();
    this.torque = new Vector3();

    // Mass and buoyancy are tied together, the way Archimedes ties them.
    //
    // The buoyancy a body can produce when fully submerged is not read off its
    // geometry. It is `mass * g / submergedFraction`: the force that, once the
    // configured share of the probes is under, exactly balances the weight. That
    // makes `submergedFraction` the density ratio, and the only thing that sets
    // the float height, and it makes the mass drop out of the buoyancy dynamics
    // altogether - lift and inertia both scale with it, so the heave and roll a
    // body shows are the same whatever it weighs.
    //
    // That is the point, and it is what a mass-independent design buys. With the
    // lift fixed by geometry instead, a heavier body sinks to a deeper waterline,
    // and past the deck the waterplane vanishes and with it the righting moment:
    // the body has no preferred orientation left and turns with every ripple.
    // Tying lift to mass means that cannot happen - the waterline is where the
    // fraction says, always. Mass still matters for any force that is not
    // buoyancy or gravity; there is none here yet.
    this.mass = Math.max(1e-3, spec.mass ?? 1000);
    this.maxBuoyancy = (this.mass * GRAVITY) / this.submergedFraction;

    // The waterline sits `draft` above the bottom face, so the body's centre
    // rests half a height above that, minus the draft.
    this.draft = this.size.y * this.submergedFraction;
    this.restHeight = this.size.y / 2 - this.draft;

    // Inertia of a solid box about its centre, kept as the diagonal in body axes.
    // A box has no products of inertia, so the world tensor is never formed:
    // torques are rotated into the body frame, divided there, and rotated back.
    const m = this.mass;
    const sx = this.size.x;
    const sy = this.size.y;
    const sz = this.size.z;
    this.invInertiaBody = new Vector3(
      12 / (m * (sy * sy + sz * sz)),
      12 / (m * (sx * sx + sz * sz)),
      12 / (m * (sx * sx + sy * sy))
    );

    // Probe layout: volume elements filling the whole hull.
    //
    // Each probe is a small block of hull, not a point on its surface. It
    // contributes the buoyancy of its own volume, scaled by how much of it is
    // under water, applied at its own centre. Summed over a lattice that fills
    // the box, that is the buoyancy of whatever part of the box is submerged,
    // acting at that part's centroid - which is the centre of buoyancy, and the
    // thing a righting moment is made of.
    //
    // The lattice has to fill the box rather than sit on the bottom face. Probes
    // on the bottom alone, each standing for the column of water above it, are
    // exact for a level hull and wrong the moment it rolls: the columns rise
    // vertically through where the side wall used to be, so the shallow side is
    // over-counted, the wedge of hull under the deep side's wall is not counted at
    // all, and the net moment pushes the roll further over instead of back.
    const cols = Math.max(2, Math.floor(spec.probeColumns ?? 3));
    const rows = Math.max(2, Math.floor(spec.probeRows ?? 3));
    const layers = Math.max(2, Math.floor(spec.probeLayers ?? 3));
    /** @type {Vector3[]} Probe centres in body space. */
    this.probes = [];
    /** @type {number[]} Share of the total lift each probe carries when fully under. */
    this.probeShares = [];
    /** @type {number} Height of one probe's block, in metres. */
    this.probeHeight = sy / layers;
    const dx = sx / cols;
    const dy = sy / layers;
    const dz = sz / rows;
    const count = cols * rows * layers;
    for (let l = 0; l < layers; l++) {
      const y = -sy / 2 + (l + 0.5) * dy;
      for (let j = 0; j < rows; j++) {
        const z = -sz / 2 + (j + 0.5) * dz;
        for (let i = 0; i < cols; i++) {
          const x = -sx / 2 + (i + 0.5) * dx;
          this.probes.push(new Vector3(x, y, z));
          this.probeShares.push(1 / count);
        }
      }
    }

    this._accel = new Vector3();
    this._angularAccel = new Vector3();
    this._probeWorld = new Vector3();
    this._torqueBody = new Vector3();
    this._spin = new Vector3();
    this._wq = new Quaternion();
    // Per-body scratch for rotateVector. Rotations happen inside the probe loop,
    // so these are reused across iterations rather than allocated per call.
    this._rotA = new Vector3();
    this._rotB = new Vector3();
    this._rotIn = new Quaternion();
    /** @type {number} Leftover time from the last frame, carried into the next. */
    this._accumulator = 0;
  }

  /** World Y the body rests at for a given still-water level. */
  restY(waterLevel) {
    return waterLevel + this.restHeight;
  }

  /**
   * Place the body at rest and clear its velocities.
   *
   * @param {number} x - World X.
   * @param {number} z - World Z.
   * @param {number} [waterLevel] - Still-water level the body should float on.
   * @param {number} [yaw] - Heading in radians about world Y.
   */
  reset(x, z, waterLevel = 0, yaw = 0) {
    this.position.setXYZ(x, this.restY(waterLevel), z);
    Quaternion.fromEulerAngle(0, yaw, 0, 'ZYX', this.rotation);
    this.velocity.setXYZ(0, 0, 0);
    this.angularVelocity.setXYZ(0, 0, 0);
    this._accumulator = 0;
    this._applyToNode();
  }

  /**
   * Integrate one frame.
   *
   * @param {number} deltaSeconds - Frame delta in seconds.
   * @param {(x: number, z: number) => number} waveHeight - Surface height above the
   *   still-water level at a world XZ.
   * @param {number} waterLevel - World Y of the still-water level.
   */
  update(deltaSeconds, waveHeight, waterLevel) {
    this._accumulator += Math.min(0.25, deltaSeconds);
    let steps = 0;
    while (this._accumulator >= MAX_STEP && steps < MAX_STEPS_PER_FRAME) {
      this._step(MAX_STEP, waveHeight, waterLevel);
      this._accumulator -= MAX_STEP;
      steps++;
    }
    // A frame so late that the backlog cannot be worked off drops it rather than
    // carrying it: carrying would make the next frame worse, and this is meant to
    // look right rather than to be a record of real time.
    if (this._accumulator > MAX_STEP) {
      this._accumulator = 0;
    }
    this._applyToNode();
  }

  /** @internal */
  _step(dt, waveHeight, waterLevel) {
    const force = this.force;
    const torque = this.torque;
    force.setXYZ(0, 0, 0);
    torque.setXYZ(0, 0, 0);

    // Gravity at the centre of mass, so it contributes no torque.
    force.y -= this.mass * GRAVITY;

    // Buoyancy, probe by probe. `submerged` accumulates how much of the body is
    // under, for the damping blend below.
    let submerged = 0;
    for (let i = 0; i < this.probes.length; i++) {
      rotateVector(this.rotation, this.probes[i], this._probeWorld, this._rotA, this._rotB);
      const worldX = this.position.x + this._probeWorld.x;
      const worldY = this.position.y + this._probeWorld.y;
      const worldZ = this.position.z + this._probeWorld.z;
      // How much of this block is under water: its centre's depth, offset by
      // half its height and clamped, so a block straddling the surface counts
      // the part that is below and a block wholly under counts all of itself.
      // Saturating at one is also what keeps a body driven deep from producing
      // unbounded lift - a fully submerged block displaces its volume and no more.
      const depth = waterLevel + waveHeight(worldX, worldZ) - worldY;
      const fraction = Math.min(1, Math.max(0, depth / this.probeHeight + 0.5));
      if (fraction <= 0) {
        continue;
      }
      submerged += this.probeShares[i] * fraction;
      const magnitude = this.maxBuoyancy * this.probeShares[i] * fraction;
      force.y += magnitude;
      // The lever arm runs from the centre of mass, which is the body origin, and
      // the force is straight up: r x F with F = (0, m, 0) reduces to this.
      torque.x -= this._probeWorld.z * magnitude;
      torque.z += this._probeWorld.x * magnitude;
    }

    // Water resistance as a per-second fraction of velocity rather than as a
    // force. A real drag term would need a reference area and a coefficient per
    // axis; what this is for is settling, not fidelity. Blended between the air
    // and water values by how much of the body is under.
    const linear = this.airLinearDamping + (this.linearDamping - this.airLinearDamping) * submerged;
    const angular = this.airAngularDamping + (this.angularDamping - this.airAngularDamping) * submerged;
    const ld = Math.exp(-linear * dt);
    const ad = Math.exp(-angular * dt);
    this.velocity.scaleBy(ld);
    this.angularVelocity.scaleBy(ad);

    // Semi-implicit Euler - velocity first, then position. The ordering is what
    // keeps a stiff spring stable at this step size.
    Vector3.scale(force, 1 / this.mass, this._accel);
    // `Vector3.set` is inherited from Float32Array and returns nothing, so the
    // scratch vectors are filled by `setXYZ` and scaled in place instead of by
    // chaining off `set`.
    this._spin.setXYZ(this._accel.x, this._accel.y, this._accel.z).scaleBy(dt);
    this.velocity.addBy(this._spin);
    this._spin.setXYZ(this.velocity.x, this.velocity.y, this.velocity.z).scaleBy(dt);
    this.position.addBy(this._spin);

    // Angular motion in the body frame, where the inertia tensor is diagonal.
    // Rotating the torque in, dividing, and rotating back out is the whole of
    // what a 3x3 world tensor would do.
    // World torque into body space, by rotating with the conjugate.
    this._rotIn.setXYZW(-this.rotation.x, -this.rotation.y, -this.rotation.z, this.rotation.w);
    rotateVector(this._rotIn, torque, this._torqueBody, this._rotA, this._rotB);
    this._angularAccel.setXYZ(
      this._torqueBody.x * this.invInertiaBody.x,
      this._torqueBody.y * this.invInertiaBody.y,
      this._torqueBody.z * this.invInertiaBody.z
    );
    rotateVector(this.rotation, this._angularAccel, this._torqueBody, this._rotA, this._rotB);
    this._spin.setXYZ(this._torqueBody.x, this._torqueBody.y, this._torqueBody.z).scaleBy(dt);
    this.angularVelocity.addBy(this._spin);

    // q += 0.5 * (omega as a pure quaternion) * q, then renormalise. The half-omega
    // form is the derivative of a rotation about a changing axis; integrating it
    // keeps the quaternion on the unit sphere to first order, and the
    // normalisation removes the drift that would otherwise accumulate.
    const av = this.angularVelocity;
    this._wq.setXYZW(av.x * dt * 0.5, av.y * dt * 0.5, av.z * dt * 0.5, 0);
    Quaternion.multiply(this._wq, this.rotation, this._wq);
    this.rotation.setXYZW(
      this.rotation.x + this._wq.x,
      this.rotation.y + this._wq.y,
      this.rotation.z + this._wq.z,
      this.rotation.w + this._wq.w
    );
    Quaternion.normalize(this.rotation, this.rotation);
  }

  /** @internal */
  _applyToNode() {
    // Assignment, not `set`: `set` would copy the elements but the node stores
    // the vector by reference elsewhere, so keeping the same instance is what the
    // node's change tracking expects.
    this.node.position.setXYZ(this.position.x, this.position.y, this.position.z);
    this.node.rotation = this.rotation;
  }
}
