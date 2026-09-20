import { Quaternion, Vector3 } from '@zephyr3d/base';
import type { SceneNode } from '../scene/scene_node';

/** Standard gravity, in metres per second squared. @public */
export const STANDARD_GRAVITY = 9.81;
/**
 * Largest step of {@link FloatingBody}, in seconds.
 *
 * The buoyancy that holds a hull up is a hard spring - half a metre of sink
 * produces a force comparable to the hull's whole weight - so a frame that
 * arrives late would advance it far enough to overshoot and diverge. Steps are
 * capped at this and the remainder is carried. @internal
 */
const MAX_STEP = 1 / 120;
/** Ceiling on steps per frame, so a very late frame cannot stall the loop. @internal */
const MAX_STEPS_PER_FRAME = 8;

/**
 * Surface height above the still-water level at a world XZ, in metres.
 * @public
 */
export type WaveHeightFn = (x: number, z: number) => number;

/**
 * Options for {@link BuoyancyVolume}.
 * @public
 */
export interface BuoyancyVolumeOptions {
  /** Full extents of the hull in metres, in its local axes. */
  size: Vector3;
  /**
   * Mass in kilograms. Sets the lift the fully submerged hull produces; the
   * float height does not depend on it. Defaults to 1000.
   */
  mass?: number;
  /**
   * Share of the hull's height below the waterline at rest, which is its
   * density relative to water. Lower floats higher. Defaults to 0.5.
   */
  submergedFraction?: number;
  /** Probes across the local X axis. Defaults to 3. */
  probeColumns?: number;
  /** Probes across the local Z axis. Defaults to 3. */
  probeRows?: number;
  /** Probes up the local Y axis. Defaults to 3. */
  probeLayers?: number;
  /** Gravity in metres per second squared. Defaults to {@link STANDARD_GRAVITY}. */
  gravity?: number;
}

/**
 * The buoyancy a box-shaped hull gets from a water surface, as a force and a
 * torque, independent of what integrates them.
 *
 * Pair it with {@link FloatingBody} for a self-contained float, or feed the
 * force and torque to a rigid body in whatever physics library the
 * application uses.
 *
 * ## The model
 *
 * The hull is filled with a lattice of probes, each a block of hull carrying an
 * equal share of the lift the whole hull can produce, scaled by how much of the
 * block is under water. Summed, that is the buoyancy of whatever part of the
 * hull is submerged, acting at that part's centroid - which is the centre of
 * buoyancy, and the thing a righting moment is made of: the water pushes up
 * hardest on whichever side has more of its blocks under, which rolls a boat
 * back upright. There is no separate upright target.
 *
 * The lattice fills the box rather than sitting on the bottom face. Probes on
 * the bottom alone are exact for a level hull and wrong the moment it rolls:
 * the columns rise vertically through where the side wall used to be, and the
 * net moment pushes the roll further over instead of back.
 *
 * The lift a fully submerged hull produces is `mass * g / submergedFraction`:
 * the force that, once the configured share of the probes is under, balances
 * the weight. That makes `submergedFraction` the density ratio and the only
 * thing that sets the float height, and it makes the mass drop out of the
 * buoyant motion altogether - lift and inertia both scale with it. Tying lift
 * to mass rather than to geometry also means a heavy body cannot sink past
 * its deck, where the waterplane and the righting moment would vanish.
 *
 * ## What is not modelled
 *
 * No hull-volume integral, no added mass, no drag. A probe's contribution grows
 * linearly with depth up to its own height, which is accurate while a vessel
 * rides on its waterline and approximate for a fully submerged one.
 *
 * @public
 */
export class BuoyancyVolume {
  /** Full extents in metres, in local axes. */
  readonly size: Vector3;
  /** Mass in kilograms. */
  readonly mass: number;
  /** Share of the height under water at rest. */
  readonly submergedFraction: number;
  /** Gravity in metres per second squared. */
  readonly gravity: number;
  /** Lift of the fully submerged hull, in newtons. */
  readonly maxBuoyancy: number;
  /** Height of the waterline above the bottom face at rest, in metres. */
  readonly draft: number;
  /** Height of the hull's centre above the still-water level at rest, in metres. */
  readonly restHeight: number;
  /** Probe centres in local space. */
  readonly probes: Vector3[];
  /** Height of one probe's block, in metres. */
  readonly probeHeight: number;
  /** Share of the total lift each probe carries when fully under. */
  private readonly _probeShare: number;
  private readonly _probeWorld: Vector3;
  /**
   * Creates a buoyancy volume.
   */
  constructor(options: BuoyancyVolumeOptions) {
    this.size = options.size.clone();
    this.mass = Math.max(1e-3, options.mass ?? 1000);
    this.submergedFraction = Math.min(0.95, Math.max(0.05, options.submergedFraction ?? 0.5));
    this.gravity = options.gravity ?? STANDARD_GRAVITY;
    this.maxBuoyancy = (this.mass * this.gravity) / this.submergedFraction;
    this.draft = this.size.y * this.submergedFraction;
    this.restHeight = this.size.y / 2 - this.draft;
    const cols = Math.max(1, Math.floor(options.probeColumns ?? 3));
    const rows = Math.max(1, Math.floor(options.probeRows ?? 3));
    const layers = Math.max(1, Math.floor(options.probeLayers ?? 3));
    const sx = this.size.x;
    const sy = this.size.y;
    const sz = this.size.z;
    this.probeHeight = sy / layers;
    this.probes = [];
    const dx = sx / cols;
    const dy = sy / layers;
    const dz = sz / rows;
    for (let l = 0; l < layers; l++) {
      const y = -sy / 2 + (l + 0.5) * dy;
      for (let j = 0; j < rows; j++) {
        const z = -sz / 2 + (j + 0.5) * dz;
        for (let i = 0; i < cols; i++) {
          const x = -sx / 2 + (i + 0.5) * dx;
          this.probes.push(new Vector3(x, y, z));
        }
      }
    }
    this._probeShare = 1 / this.probes.length;
    this._probeWorld = new Vector3();
  }
  /** World Y the hull's centre rests at on a still surface at `waterLevel`. */
  restY(waterLevel: number) {
    return waterLevel + this.restHeight;
  }
  /**
   * Buoyant force and torque on the hull at a pose, in world space, about the
   * hull's centre. Gravity is not included.
   *
   * @param position - World position of the hull's centre.
   * @param rotation - World orientation of the hull.
   * @param waveHeight - Surface height above `waterLevel` at a world XZ.
   * @param waterLevel - World Y of the still-water level.
   * @param outForce - Receives the force in newtons.
   * @param outTorque - Receives the torque in newton-metres.
   * @returns How much of the hull is under water, 0 to 1. Useful for blending
   * drag between air and water.
   */
  computeForces(
    position: Vector3,
    rotation: Quaternion,
    waveHeight: WaveHeightFn,
    waterLevel: number,
    outForce: Vector3,
    outTorque: Vector3
  ) {
    outForce.setXYZ(0, 0, 0);
    outTorque.setXYZ(0, 0, 0);
    let submerged = 0;
    const pw = this._probeWorld;
    for (let i = 0; i < this.probes.length; i++) {
      rotation.transform(this.probes[i], pw);
      const worldX = position.x + pw.x;
      const worldY = position.y + pw.y;
      const worldZ = position.z + pw.z;
      // How much of this block is under: its centre's depth, offset by half
      // its height and clamped, so a block straddling the surface counts the
      // part below and a block wholly under counts all of itself and no more.
      const depth = waterLevel + waveHeight(worldX, worldZ) - worldY;
      const fraction = Math.min(1, Math.max(0, depth / this.probeHeight + 0.5));
      if (fraction <= 0) {
        continue;
      }
      submerged += this._probeShare * fraction;
      const magnitude = this.maxBuoyancy * this._probeShare * fraction;
      outForce.y += magnitude;
      // r x F for a straight-up force at lever arm r from the centre.
      outTorque.x -= pw.z * magnitude;
      outTorque.z += pw.x * magnitude;
    }
    return submerged;
  }
}

/**
 * Options for {@link FloatingBody}, on top of those of {@link BuoyancyVolume}.
 * @public
 */
export interface FloatingBodyOptions extends BuoyancyVolumeOptions {
  /** Node to drive, or null to read {@link FloatingBody.position} and {@link FloatingBody.rotation} directly. */
  node?: SceneNode | null;
  /** Fraction of linear velocity shed per second in water. Defaults to 2.5. */
  linearDamping?: number;
  /** Fraction of angular velocity shed per second in water. Defaults to 3. */
  angularDamping?: number;
  /** The same, clear of the water. Defaults to 0.05. */
  airLinearDamping?: number;
  /** The same, clear of the water. Defaults to 0.1. */
  airAngularDamping?: number;
}

/**
 * A rigid body that floats on a water surface, with its own integrator.
 *
 * For applications without a physics library. The motion is force driven: the
 * body owns a position, an orientation and their velocities, and the water
 * only ever applies the force and torque a {@link BuoyancyVolume} computes.
 * That is what makes a hull behave like a hull - it has mass, so it lags the
 * surface, overshoots into it and rolls back, instead of sliding along a
 * height field.
 *
 * Semi-implicit Euler at a fixed step, box inertia kept as a diagonal in body
 * axes, quaternion orientation renormalised every step. Water resistance is a
 * per-second fraction of velocity, blended between the air and water values by
 * how much of the body is under, so a body launched clear of the water keeps
 * its speed until it lands. No collision.
 *
 * @public
 */
export class FloatingBody {
  /** The hull's buoyancy. */
  readonly volume: BuoyancyVolume;
  /** Node driven by the body, if any. */
  node: SceneNode | null;
  /** Fraction of linear velocity shed per second in water. */
  linearDamping: number;
  /** Fraction of angular velocity shed per second in water. */
  angularDamping: number;
  /** Fraction of linear velocity shed per second in air. */
  airLinearDamping: number;
  /** Fraction of angular velocity shed per second in air. */
  airAngularDamping: number;
  /** World position of the hull's centre. */
  readonly position: Vector3;
  /** World orientation. */
  readonly rotation: Quaternion;
  /** Linear velocity in metres per second. */
  readonly velocity: Vector3;
  /** Angular velocity in radians per second, world axes. */
  readonly angularVelocity: Vector3;
  /** Extra force applied at the centre of mass on the next step, in newtons. Cleared after each frame. */
  readonly externalForce: Vector3;
  /** Extra torque applied on the next step, in newton-metres. Cleared after each frame. */
  readonly externalTorque: Vector3;
  private readonly _invInertiaBody: Vector3;
  private readonly _force: Vector3;
  private readonly _torque: Vector3;
  private readonly _tmp: Vector3;
  private readonly _torqueBody: Vector3;
  private readonly _conj: Quaternion;
  private readonly _wq: Quaternion;
  private _accumulator: number;
  /**
   * Creates a floating body.
   */
  constructor(options: FloatingBodyOptions) {
    this.volume = new BuoyancyVolume(options);
    this.node = options.node ?? null;
    // The defaults are tuned to the heave frequency a box like this bobs at,
    // sqrt(rho g A / m), which for a hull a metre or two across comes to a few
    // radians per second. Critical damping is roughly twice that; these sit
    // well under it, so a body dropped on the water bounces a couple of times
    // and settles within a second or two rather than ringing for ten.
    this.linearDamping = Math.max(0, options.linearDamping ?? 2.5);
    this.angularDamping = Math.max(0, options.angularDamping ?? 3);
    this.airLinearDamping = Math.max(0, options.airLinearDamping ?? 0.05);
    this.airAngularDamping = Math.max(0, options.airAngularDamping ?? 0.1);
    this.position = new Vector3();
    this.rotation = new Quaternion();
    this.velocity = new Vector3();
    this.angularVelocity = new Vector3();
    this.externalForce = new Vector3();
    this.externalTorque = new Vector3();
    // Inertia of a solid box about its centre. A box has no products of
    // inertia, so the world tensor is never formed: torques are rotated into
    // the body frame, divided there, and rotated back.
    const m = this.volume.mass;
    const { x: sx, y: sy, z: sz } = this.volume.size;
    this._invInertiaBody = new Vector3(
      12 / (m * (sy * sy + sz * sz)),
      12 / (m * (sx * sx + sz * sz)),
      12 / (m * (sx * sx + sy * sy))
    );
    this._force = new Vector3();
    this._torque = new Vector3();
    this._tmp = new Vector3();
    this._torqueBody = new Vector3();
    this._conj = new Quaternion();
    this._wq = new Quaternion();
    this._accumulator = 0;
  }
  /** Mass in kilograms. */
  get mass() {
    return this.volume.mass;
  }
  /**
   * Place the body at rest on a still surface and clear its velocities.
   * @param x - World X.
   * @param z - World Z.
   * @param waterLevel - Still-water level the body should float on.
   * @param yaw - Heading in radians about world Y.
   */
  reset(x: number, z: number, waterLevel = 0, yaw = 0) {
    this.position.setXYZ(x, this.volume.restY(waterLevel), z);
    Quaternion.fromEulerAngle(0, yaw, 0, 'ZYX', this.rotation);
    this.velocity.setXYZ(0, 0, 0);
    this.angularVelocity.setXYZ(0, 0, 0);
    this._accumulator = 0;
    this.applyToNode();
  }
  /**
   * Integrate one frame.
   * @param deltaSeconds - Frame delta in seconds.
   * @param waveHeight - Surface height above the still-water level at a world XZ.
   * @param waterLevel - World Y of the still-water level.
   */
  update(deltaSeconds: number, waveHeight: WaveHeightFn, waterLevel: number) {
    this._accumulator += Math.min(0.25, deltaSeconds);
    let steps = 0;
    while (this._accumulator >= MAX_STEP && steps < MAX_STEPS_PER_FRAME) {
      this.step(MAX_STEP, waveHeight, waterLevel);
      this._accumulator -= MAX_STEP;
      steps++;
    }
    // A frame so late that the backlog cannot be worked off drops it: carrying
    // it would make the next frame worse.
    if (this._accumulator > MAX_STEP) {
      this._accumulator = 0;
    }
    this.externalForce.setXYZ(0, 0, 0);
    this.externalTorque.setXYZ(0, 0, 0);
    this.applyToNode();
  }
  /**
   * Advance the body by one fixed step.
   * @param dt - Step in seconds.
   * @param waveHeight - Surface height above the still-water level at a world XZ.
   * @param waterLevel - World Y of the still-water level.
   */
  step(dt: number, waveHeight: WaveHeightFn, waterLevel: number) {
    const force = this._force;
    const torque = this._torque;
    const submerged = this.volume.computeForces(
      this.position,
      this.rotation,
      waveHeight,
      waterLevel,
      force,
      torque
    );
    // Gravity at the centre of mass, so it contributes no torque.
    force.y -= this.volume.mass * this.volume.gravity;
    force.addBy(this.externalForce);
    torque.addBy(this.externalTorque);
    // Resistance, blended between air and water by how much is under.
    const linear = this.airLinearDamping + (this.linearDamping - this.airLinearDamping) * submerged;
    const angular = this.airAngularDamping + (this.angularDamping - this.airAngularDamping) * submerged;
    this.velocity.scaleBy(Math.exp(-linear * dt));
    this.angularVelocity.scaleBy(Math.exp(-angular * dt));
    // Semi-implicit Euler: velocity first, then position. The ordering is what
    // keeps a stiff spring stable at this step size.
    Vector3.scale(force, dt / this.volume.mass, this._tmp);
    this.velocity.addBy(this._tmp);
    Vector3.scale(this.velocity, dt, this._tmp);
    this.position.addBy(this._tmp);
    // Angular motion in the body frame, where the inertia tensor is diagonal.
    this._conj.setXYZW(-this.rotation.x, -this.rotation.y, -this.rotation.z, this.rotation.w);
    this._conj.transform(torque, this._torqueBody);
    this._torqueBody.setXYZ(
      this._torqueBody.x * this._invInertiaBody.x,
      this._torqueBody.y * this._invInertiaBody.y,
      this._torqueBody.z * this._invInertiaBody.z
    );
    this.rotation.transform(this._torqueBody, this._tmp);
    this._tmp.scaleBy(dt);
    this.angularVelocity.addBy(this._tmp);
    // q += 0.5 * (omega as a pure quaternion) * q, then renormalise.
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
  /** Write the pose to the node, if there is one. */
  applyToNode() {
    if (this.node) {
      this.node.position.setXYZ(this.position.x, this.position.y, this.position.z);
      this.node.rotation = this.rotation;
    }
  }
}
