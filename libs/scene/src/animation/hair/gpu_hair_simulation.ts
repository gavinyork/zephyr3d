/**
 * GPU strand dynamics.
 *
 * @remarks
 * A groom is a very large number of very short, completely independent chains -
 * the sample XGen archive is 69,000 strands of 30 control points - and that
 * topology is what shapes the solver. Cloth needs a Jacobi gather because its
 * vertices share edges and a Gauss-Seidel sweep would need graph colouring; a
 * strand shares nothing with its neighbours, so one thread can walk a whole
 * strand root to tip and propagate corrections as it goes. That converges in a
 * single pass where cloth needs several iterations, and it needs no adjacency
 * buffer at all.
 *
 * Everything is solved in the node's **local space**, which is what keeps this
 * independent of the material: {@link HairStrandMaterial} puts control points
 * through the world matrix itself, so a solver writing world-space positions
 * would have the transform applied twice. Working locally also leaves the
 * bounding box in the space the scene graph expects.
 *
 * Solving locally still has to reproduce the swing a moving node gives its hair.
 * The trick is the frame-to-frame transform: a point that stood still in world
 * space has moved in local space by exactly `inverse(world) * prevWorld`, so
 * pushing the stored positions through that matrix before integrating keeps the
 * strand where it was in world space, and the root - pinned in local space -
 * then drags it along, which is the swing. Both the current and the previous
 * position go through the matrix: transforming only one of them would read the
 * node's own motion as strand velocity and throw the hair ahead of the movement
 * instead of trailing behind it. Gravity and colliders come the other way, from
 * world space into local, on the CPU.
 *
 * The node's motion is spread evenly over every substep of the frame by
 * interpolating between the two world transforms, rather than being applied
 * whole in the first substep. Under a steady frame rate the difference is
 * small, but real frame times jitter - and a hitch lumps several frames of
 * motion into what the solver treats as 1/120 s, yanking roots by more than a
 * segment length per substep. Each such yank feeds the constraint correction
 * into the Verlet history as velocity, and on jerky input the strands wind up
 * until the groom bursts. Distributed injection keeps the per-substep transport
 * no larger than it would be at a steady 60 Hz.
 *
 * WebGPU only, like the rendering path it feeds.
 */
import type { AbstractDevice, BindGroup, GPUDataBuffer, GPUProgram } from '@zephyr3d/device';
import type { Nullable } from '@zephyr3d/base';
import { Matrix4x4, Quaternion, Vector3, Disposable } from '@zephyr3d/base';
import { getDevice } from '../../app/api';
import type { HairStrandData, HairStrandSource } from '../../material/hairstrand_data';
import type {
  CapsuleCollider,
  PlaneCollider,
  SphereCollider,
  SpringCollider
} from '../spring/spring_collider';
import { updateColliderFromNode } from '../spring/spring_collider';

/** Simulation step, in seconds. @internal */
const FIXED_SIMULATION_TIME_STEP = 1 / 60;
/** Largest backlog the accumulator will carry, in seconds. @internal */
const MAX_ACCUMULATED_SIMULATION_TIME = 1 / 20;
/** Threads per workgroup; one thread owns one strand. @internal */
const DEFAULT_WORKGROUP_SIZE = 64;
/** Length below which a direction is treated as degenerate. @internal */
const MIN_DISTANCE = 1e-7;
/** Floats per collider entry, matching the layouts the shader indexes. @internal */
const SPHERE_STRIDE = 4;
const CAPSULE_STRIDE = 8;
const PLANE_STRIDE = 8;
/** Colliders of one kind the buffers make room for. @internal */
const MAX_COLLIDERS = 16;
/**
 * Solver defaults, taken from TressFXSimulationSettings so that a groom behaves
 * the way one authored against TressFX would.
 * @internal
 */
const DEFAULT_DAMPING = 0.08;
const DEFAULT_GLOBAL_STIFFNESS = 0;
const DEFAULT_GLOBAL_RANGE = 0;
const DEFAULT_LOCAL_STIFFNESS = 0.9;
const DEFAULT_LOCAL_ITERATIONS = 2;
const DEFAULT_FTL_DAMPING = 0.7;
const DEFAULT_VSP_COEFF = 0.8;
/**
 * TressFX compares a per-frame second difference against 1.4 in its own units;
 * expressed as an acceleration that is roughly five gravities, which is the form
 * that survives a change of scene units.
 * @internal
 */
const DEFAULT_VSP_ACCEL_THRESHOLD = 50;
/** Default per-substep speed ceiling, in segment lengths. @internal */
const DEFAULT_MAX_SPEED_FACTOR = 4;
/**
 * Node motion beyond this many strand lengths in one frame is treated as a
 * teleport and snaps the pose instead of swinging it.
 * @internal
 */
const TELEPORT_DISTANCE_FACTOR = 4;

/**
 * Tuning for {@link GPUHairSimulation}.
 *
 * @public
 */
export type GPUHairSimulationOptions = {
  /** World-space gravity. Defaults to earth gravity along -Y. */
  gravity?: Vector3;
  /**
   * Velocity lost per fixed 1/60 s step, in [0, 1]. 0 keeps full inertia.
   *
   * @remarks
   * Applied as an exponential decay, `exp(-damping * dt * 60)` per substep, so
   * the dial means the same thing whatever {@link GPUHairSimulationOptions.substeps}
   * is set to.
   */
  damping?: number;
  /**
   * How strongly a strand is pulled back to its authored pose, in [0, 1].
   *
   * @remarks
   * Off by default, as in TressFX, and worth understanding before turning it
   * on: it anchors a point to a fixed place rather than to its neighbours,
   * which is a spring, and a groom held by springs reads as one - a disturbance
   * rings around the authored pose instead of settling out of it. What holds a
   * groom's styling without that is
   * {@link GPUHairSimulationOptions.localStiffness}, which constrains the shape
   * a strand makes rather than where it sits.
   *
   * Useful where a groom genuinely should not move far from how it was
   * authored, and pairs with {@link GPUHairSimulationOptions.globalRange} to
   * confine the pull to the part of the strand nearest the scalp. The value is
   * the fraction of the remaining deviation removed per fixed 1/60 s step,
   * independent of the substep count.
   */
  globalStiffness?: number;
  /**
   * Fraction of each strand, from the root, that
   * {@link GPUHairSimulationOptions.globalStiffness} acts on, in [0, 1].
   *
   * @remarks
   * 0 disables the pull outright whatever the stiffness is - both have to be
   * non-zero for it to do anything. Confining it near the root is the usual
   * way to use it: the scalp end holds its styling while the length is left
   * free to swing.
   */
  globalRange?: number;
  /**
   * How strongly a strand keeps the shape it was authored with, in [0, 1].
   *
   * @remarks
   * The dial that decides whether a groom reads as hair or as loose chain, and
   * the one to reach for first. It holds the angle each segment makes with the
   * one before it, measured against the previous segment's current direction
   * rather than against a fixed pose - so a strand keeps its curl while being
   * free to hang, swing and settle anywhere, which is what real fibre does.
   *
   * It is also what damps a groom. A chain with no bending resistance carries a
   * disturbance up and down its length for seconds; give it bending resistance
   * and the disturbance dies within a swing or two.
   */
  localStiffness?: number;
  /**
   * Times the local shape constraint is applied per substep, in [1, 8].
   *
   * @remarks
   * The constraint moves both points it touches, so one pass leaves the strand
   * short of the shape it is aiming for. More passes converge on it, at
   * proportional cost.
   */
  localIterations?: number;
  /**
   * Share of a point's length correction fed back into its parent, in [0, 1].
   *
   * @remarks
   * The length constraint places each point at exactly its authored distance
   * from the one before it, which satisfies the segment by moving the child
   * alone and so leaves the momentum that correction represents unaccounted
   * for. Left unaccounted it accumulates: every root movement pumps energy into
   * the chain, and because the segments are coupled in series it collects at the
   * free end, so a groom whips instead of trailing. Handing the correction back
   * to the parent as reverse momentum - Mueller's FTL damping - is what keeps
   * the solver from gaining energy, and 0 reproduces the uncorrected behaviour.
   */
  ftlDamping?: number;
  /**
   * How much of the node's motion a strand is carried along by, in [0, 1].
   *
   * @remarks
   * Velocity shock propagation. 0 leaves a strand exactly where it was in the
   * world and lets the pinned root drag it along through the constraints alone,
   * which is what produces lag - but a root that moves fast enough outruns its
   * strand within a single step, and the length constraint then has to snap it
   * back. 1 carries the strand rigidly with the node, so it never lags at all.
   *
   * The default sits near the top of that range because most of a groom's
   * apparent motion should come from the head it is attached to, with the lag
   * as a garnish. Lower values give a livelier, floppier groom and need the
   * length constraint iterated harder to stay convincing.
   */
  vspCoeff?: number;
  /**
   * Node acceleration above which a strand is carried rigidly, in world units
   * per second squared.
   *
   * @remarks
   * A hard shove is where lag turns into over-stretching, so past this
   * threshold {@link GPUHairSimulationOptions.vspCoeff} is treated as 1 for
   * that step and the groom moves with the node instead. The default is around
   * five gravities, which ordinary animation does not reach.
   */
  vspAccelThreshold?: number;
  /** Integration substeps per fixed step, in [1, 8]. */
  substeps?: number;
  /** Colliders the strands are pushed out of. */
  colliders?: SpringCollider[];
  /** Friction applied to the tangential motion of a contact, in [0, 1]. */
  friction?: number;
  /**
   * Per-substep ceiling on how far a point may travel, in segment lengths.
   *
   * @remarks
   * A backstop rather than a dial: it bounds what a single substep can do when
   * something else has already gone wrong, and at the default it never engages
   * during ordinary motion. Measured in the strand's own segment length, so it
   * is independent of the units the groom is authored in.
   */
  maxSpeedFactor?: number;
};

/**
 * Whether GPU hair dynamics can run on a device.
 *
 * @remarks
 * WebGPU only: the solver is a compute pass, and the WebGL backends have no
 * compute stage at all. Strand rendering carries the same requirement, so there
 * is no configuration where the hair draws but cannot simulate.
 *
 * @param device - Device to test, or the current one when omitted.
 * @returns True when the simulation can run.
 *
 * @public
 */
export function isHairSimulationSupported(device?: Nullable<AbstractDevice>) {
  const resolved = device ?? getDevice();
  return resolved?.type === 'webgpu';
}

function clamp(value: number, min: number, max: number) {
  return value < min ? min : value > max ? max : value;
}

/** Exact element-wise matrix comparison, for skipping the interpolation. @internal */
function matrixEquals(a: Matrix4x4, b: Matrix4x4) {
  for (let i = 0; i < 16; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Follow-the-leader strand dynamics on the GPU.
 *
 * @remarks
 * Created by {@link HairNode} when simulation is switched on; it writes the
 * strand point buffer in place, so nothing about the draw call changes.
 *
 * @public
 */
export class GPUHairSimulation extends Disposable {
  /** @internal */
  private readonly _device: Nullable<AbstractDevice>;
  /** @internal */
  private _enabled: boolean;
  /** @internal */
  private _disabledReason: Nullable<string>;
  /** @internal */
  private _program: Nullable<GPUProgram>;
  /** @internal */
  private _bindGroup: Nullable<BindGroup>;
  /** @internal Live point positions; the same buffer the vertex shader reads. */
  private _pointBuffer: Nullable<GPUDataBuffer>;
  /** @internal Previous positions, for Verlet integration and motion vectors. */
  private _prevPointBuffer: Nullable<GPUDataBuffer>;
  /** @internal Authored positions, the target the stiffness term pulls toward. */
  private _restPointBuffer: Nullable<GPUDataBuffer>;
  /** @internal Authored distance between consecutive control points. */
  private _restLengthBuffer: Nullable<GPUDataBuffer>;
  /** @internal */
  private _sphereBuffer: Nullable<GPUDataBuffer>;
  /** @internal */
  private _capsuleBuffer: Nullable<GPUDataBuffer>;
  /** @internal */
  private _planeBuffer: Nullable<GPUDataBuffer>;
  /** @internal */
  private readonly _strandCount: number;
  /** @internal */
  private readonly _workgroupCount: number;
  /** @internal */
  private _gravity: Vector3;
  /** @internal */
  private _damping: number;
  /** @internal */
  private _globalStiffness: number;
  /** @internal */
  private _globalRange: number;
  /** @internal */
  private _localStiffness: number;
  /** @internal */
  private _localIterations: number;
  /** @internal */
  private _ftlDamping: number;
  /** @internal */
  private _vspCoeff: number;
  /** @internal */
  private _vspAccelThreshold: number;
  /** @internal */
  private _substeps: number;
  /** @internal */
  private _friction: number;
  /** @internal */
  private _maxSpeedFactor: number;
  /** @internal */
  private _colliders: SpringCollider[];
  /** @internal */
  private _timeAccumulator: number;
  /** @internal Scratch, so stepping allocates nothing. */
  private readonly _sphereData: Float32Array<ArrayBuffer>;
  private readonly _capsuleData: Float32Array<ArrayBuffer>;
  private readonly _planeData: Float32Array<ArrayBuffer>;
  private readonly _relativeTransform: Matrix4x4;
  private readonly _invWorldMatrix: Matrix4x4;
  private readonly _prevWorldMatrix: Matrix4x4;
  /** @internal Bound while the node stands still, so those frames upload nothing new. */
  private readonly _identity: Matrix4x4;
  private readonly _localGravity: Vector3;
  private readonly _scratchVec: Vector3;
  private readonly _scratchVec2: Vector3;
  /** @internal Endpoints and scratch of the per-substep transform interpolation. */
  private readonly _scaleFrom: Vector3;
  private readonly _scaleTo: Vector3;
  private readonly _translationFrom: Vector3;
  private readonly _translationTo: Vector3;
  private readonly _rotationFrom: Quaternion;
  private readonly _rotationTo: Quaternion;
  private readonly _rotationLerp: Quaternion;
  private readonly _stepFrom: Matrix4x4;
  private readonly _stepTo: Matrix4x4;
  /** @internal True until the first step has seen a world matrix. */
  private _hasPrevWorldMatrix: boolean;
  /** @internal Length of the longest strand, for the teleport threshold. */
  private _maxStrandLength: number;
  /** @internal Centre of the rest pose, whose world motion detects teleports. */
  private readonly _restCenter: Vector3;
  /**
   * @internal Where the rest centre stood in the world last frame, and how fast
   * it was moving, which is all the shock propagation threshold needs: the
   * roots are pinned in local space, so their acceleration is the node's.
   */
  private readonly _prevRootWorld: Vector3;
  private readonly _prevRootVelocity: Vector3;
  /** @internal Frames seen so far, capped at 2; acceleration needs three. */
  private _rootHistoryDepth: number;
  /**
   * Creates a simulation over an uploaded strand set.
   *
   * @param strands - GPU strand data; its point buffer is written in place.
   * @param source - The control points the strands were built from, used to
   *   derive rest lengths and the rest pose.
   * @param options - Tuning.
   */
  constructor(strands: HairStrandData, source: HairStrandSource, options?: GPUHairSimulationOptions) {
    super();
    this._device = getDevice();
    this._enabled = false;
    this._disabledReason = null;
    this._program = null;
    this._bindGroup = null;
    this._pointBuffer = null;
    this._prevPointBuffer = null;
    this._restPointBuffer = null;
    this._restLengthBuffer = null;
    this._sphereBuffer = null;
    this._capsuleBuffer = null;
    this._planeBuffer = null;
    this._strandCount = strands.strandCount;
    this._gravity = options?.gravity ? new Vector3(options.gravity) : new Vector3(0, -9.8, 0);
    this._damping = clamp(options?.damping ?? DEFAULT_DAMPING, 0, 1);
    this._globalStiffness = clamp(options?.globalStiffness ?? DEFAULT_GLOBAL_STIFFNESS, 0, 1);
    this._globalRange = clamp(options?.globalRange ?? DEFAULT_GLOBAL_RANGE, 0, 1);
    this._localStiffness = clamp(options?.localStiffness ?? DEFAULT_LOCAL_STIFFNESS, 0, 1);
    this._localIterations = clamp(options?.localIterations ?? DEFAULT_LOCAL_ITERATIONS, 1, 8) | 0;
    this._ftlDamping = clamp(options?.ftlDamping ?? DEFAULT_FTL_DAMPING, 0, 1);
    this._vspCoeff = clamp(options?.vspCoeff ?? DEFAULT_VSP_COEFF, 0, 1);
    this._vspAccelThreshold = Math.max(0, options?.vspAccelThreshold ?? DEFAULT_VSP_ACCEL_THRESHOLD);
    this._substeps = clamp(options?.substeps ?? 1, 1, 8) | 0;
    this._friction = clamp(options?.friction ?? 0.2, 0, 1);
    this._maxSpeedFactor = Math.max(0, options?.maxSpeedFactor ?? DEFAULT_MAX_SPEED_FACTOR);
    this._colliders = options?.colliders ? [...options.colliders] : [];
    this._timeAccumulator = 0;
    this._sphereData = new Float32Array(MAX_COLLIDERS * SPHERE_STRIDE);
    this._capsuleData = new Float32Array(MAX_COLLIDERS * CAPSULE_STRIDE);
    this._planeData = new Float32Array(MAX_COLLIDERS * PLANE_STRIDE);
    this._relativeTransform = Matrix4x4.identity();
    this._invWorldMatrix = Matrix4x4.identity();
    this._prevWorldMatrix = Matrix4x4.identity();
    this._identity = Matrix4x4.identity();
    this._localGravity = new Vector3();
    this._scratchVec = new Vector3();
    this._scratchVec2 = new Vector3();
    this._scaleFrom = new Vector3();
    this._scaleTo = new Vector3();
    this._translationFrom = new Vector3();
    this._translationTo = new Vector3();
    this._rotationFrom = new Quaternion();
    this._rotationTo = new Quaternion();
    this._rotationLerp = new Quaternion();
    this._stepFrom = Matrix4x4.identity();
    this._stepTo = Matrix4x4.identity();
    this._hasPrevWorldMatrix = false;
    this._maxStrandLength = 0;
    this._restCenter = new Vector3();
    this._prevRootWorld = new Vector3();
    this._prevRootVelocity = new Vector3();
    this._rootHistoryDepth = 0;
    this._workgroupCount = Math.ceil(this._strandCount / DEFAULT_WORKGROUP_SIZE);

    if (!isHairSimulationSupported(this._device)) {
      this._disabledReason = 'GPU hair simulation is disabled: current backend is not WebGPU.';
      return;
    }
    if (!strands.pointBuffer || !strands.headerBuffer) {
      this._disabledReason = 'GPU hair simulation is disabled: strand data has no GPU buffers.';
      return;
    }
    try {
      this._init(strands, source);
      this._enabled = true;
    } catch (err) {
      this._disabledReason = `GPU hair simulation is disabled: ${err}`;
      this._releaseResources();
    }
  }
  /** Whether the simulation is running. */
  get enabled() {
    return this._enabled;
  }
  /** Why the simulation is not running, when it is not. */
  get disabledReason() {
    return this._disabledReason;
  }
  /** World-space gravity. */
  get gravity() {
    return this._gravity;
  }
  set gravity(value: Vector3) {
    this._gravity = new Vector3(value);
  }
  /** Velocity lost per step, in [0, 1]. */
  get damping() {
    return this._damping;
  }
  set damping(value: number) {
    this._damping = clamp(value, 0, 1);
  }
  /** Per-substep ceiling on point travel, in segment lengths. */
  get maxSpeedFactor() {
    return this._maxSpeedFactor;
  }
  set maxSpeedFactor(value: number) {
    this._maxSpeedFactor = Math.max(0, value);
  }
  /** Pull back to the authored pose per fixed step, in [0, 1]. Off by default. */
  get globalStiffness() {
    return this._globalStiffness;
  }
  set globalStiffness(value: number) {
    this._globalStiffness = clamp(value, 0, 1);
  }
  /** Fraction of a strand, from the root, the pose pull acts on, in [0, 1]. */
  get globalRange() {
    return this._globalRange;
  }
  set globalRange(value: number) {
    this._globalRange = clamp(value, 0, 1);
  }
  /** How strongly a strand keeps its authored shape, in [0, 1]. */
  get localStiffness() {
    return this._localStiffness;
  }
  set localStiffness(value: number) {
    this._localStiffness = clamp(value, 0, 1);
  }
  /** Local shape constraint passes per substep. */
  get localIterations() {
    return this._localIterations;
  }
  set localIterations(value: number) {
    this._localIterations = clamp(value, 1, 8) | 0;
  }
  /** Share of a point's length correction fed back into its parent, in [0, 1]. */
  get ftlDamping() {
    return this._ftlDamping;
  }
  set ftlDamping(value: number) {
    this._ftlDamping = clamp(value, 0, 1);
  }
  /** How much of the node's motion a strand is carried along by, in [0, 1]. */
  get vspCoeff() {
    return this._vspCoeff;
  }
  set vspCoeff(value: number) {
    this._vspCoeff = clamp(value, 0, 1);
  }
  /** Node acceleration above which a strand is carried rigidly, in units/s². */
  get vspAccelThreshold() {
    return this._vspAccelThreshold;
  }
  set vspAccelThreshold(value: number) {
    this._vspAccelThreshold = Math.max(0, value);
  }
  /** Integration substeps per fixed step. */
  get substeps() {
    return this._substeps;
  }
  set substeps(value: number) {
    this._substeps = clamp(value, 1, 8) | 0;
  }
  /** Friction on tangential contact motion, in [0, 1]. */
  get friction() {
    return this._friction;
  }
  set friction(value: number) {
    this._friction = clamp(value, 0, 1);
  }
  /** Colliders the strands are pushed out of. */
  get colliders(): readonly SpringCollider[] {
    return this._colliders;
  }
  set colliders(value: readonly SpringCollider[]) {
    this._colliders = [...value];
  }
  /** Previous-frame positions, for motion vectors. */
  get prevPointBuffer() {
    return this._prevPointBuffer;
  }
  /**
   * Discards accumulated motion and returns every strand to its rest pose.
   *
   * @remarks
   * Wanted whenever a node is moved rather than animated - teleporting a
   * character would otherwise register as one enormous frame of inertia and fling
   * the hair. {@link GPUHairSimulation.update} calls this by itself when the
   * groom jumps farther in one frame than a few times its own strand length;
   * calling it directly remains useful for scripted scene changes that should
   * not leave the hair settling.
   */
  reset(worldMatrix: Matrix4x4) {
    if (!this._enabled) {
      return;
    }
    this._timeAccumulator = 0;
    this._prevWorldMatrix.set(worldMatrix);
    this._hasPrevWorldMatrix = true;
    this._rootHistoryDepth = 0;
    this._resetLivePoints();
  }
  /**
   * Advances the simulation.
   *
   * @param deltaTime - Seconds since the last update.
   * @param worldMatrix - The drawing node's current world matrix.
   */
  update(deltaTime: number, worldMatrix: Matrix4x4) {
    if (!this._enabled) {
      return;
    }
    if (!this._hasPrevWorldMatrix) {
      this._prevWorldMatrix.set(worldMatrix);
      this._hasPrevWorldMatrix = true;
    } else if (this._maxStrandLength > 0) {
      // A jump larger than a few times the hair itself is a teleport rather
      // than motion: fed to the solver it would register as one enormous frame
      // of inertia and fling the strands, so the pose snaps instead. The rest
      // centre stands in for the groom, so a rotation around a distant pivot
      // counts as the displacement it actually produces.
      this._prevWorldMatrix.transformPointAffine(this._restCenter, this._scratchVec);
      worldMatrix.transformPointAffine(this._restCenter, this._scratchVec2);
      const dx = this._scratchVec.x - this._scratchVec2.x;
      const dy = this._scratchVec.y - this._scratchVec2.y;
      const dz = this._scratchVec.z - this._scratchVec2.z;
      const threshold = this._maxStrandLength * TELEPORT_DISTANCE_FACTOR;
      if (dx * dx + dy * dy + dz * dz > threshold * threshold) {
        this.reset(worldMatrix);
        return;
      }
    }
    const frameDt = clamp(Number(deltaTime) || 0, 0, MAX_ACCUMULATED_SIMULATION_TIME);
    if (frameDt <= 0) {
      return;
    }
    this._timeAccumulator = Math.min(this._timeAccumulator + frameDt, MAX_ACCUMULATED_SIMULATION_TIME);
    const stepCount = Math.floor((this._timeAccumulator + 1e-8) / FIXED_SIMULATION_TIME_STEP);
    if (stepCount <= 0) {
      return;
    }
    this._timeAccumulator = Math.max(0, this._timeAccumulator - stepCount * FIXED_SIMULATION_TIME_STEP);

    // How hard the node is being shoved, which decides whether the strands are
    // allowed to lag at all this step. Taken from the world path of the rest
    // centre, because the roots are pinned in local space and so move exactly as
    // the node does. Real frame intervals rather than the fixed step, since the
    // second difference of a position over uneven intervals is not an
    // acceleration.
    const rigid = this._measureRootAcceleration(worldMatrix, frameDt);

    // Local space is where the solver works, so everything world-space has to
    // be brought in: gravity and colliders here, from the frame-end transform -
    // they change too slowly for the substep interpolation below to matter -
    // and the node's own motion per substep inside the loop.
    this._invWorldMatrix.set(worldMatrix);
    this._invWorldMatrix.inplaceInvert();
    this._invWorldMatrix.transformVectorAffine(this._gravity, this._localGravity);
    this._uploadColliders(this._invWorldMatrix);

    const bindGroup = this._bindGroup!;
    const substepTime = FIXED_SIMULATION_TIME_STEP / this._substeps;
    bindGroup.setValue('strandCount', this._strandCount);
    // Damping is an exponential decay rather than a linear scale, so that
    // halving the substep and applying it twice as often leaves the same amount
    // of velocity behind. A linear factor per substep would tie the dial to the
    // substep count and make it impossible to tune once and leave alone.
    bindGroup.setValue('dampingDecay', Math.exp(-this._damping * substepTime * 60));
    // The dial is the fraction removed per fixed step; the shader applies it
    // once per substep, so convert it to the per-substep fraction that
    // compounds back to the dialled value.
    bindGroup.setValue('globalStiffness', 1 - Math.pow(1 - this._globalStiffness, 1 / this._substeps));
    bindGroup.setValue('globalRange', this._globalRange);
    bindGroup.setValue('localStiffness', this._localStiffness);
    bindGroup.setValue('localIterations', this._localIterations);
    bindGroup.setValue('ftlDamping', this._ftlDamping);
    // A shove hard enough to over-stretch a strand suspends the lag for the
    // frame and carries the groom rigidly instead.
    bindGroup.setValue('vspCoeff', rigid ? 1 : this._vspCoeff);
    bindGroup.setValue('friction', this._friction);
    bindGroup.setValue('maxSpeedFactor', this._maxSpeedFactor);
    bindGroup.setValue('gravity', this._localGravity);
    bindGroup.setValue('minDistance', MIN_DISTANCE);
    bindGroup.setValue('deltaTime', substepTime);

    const totalSubsteps = stepCount * this._substeps;
    this._device!.pushDeviceStates();
    try {
      this._device!.setProgram(this._program!);
      this._device!.setBindGroup(0, bindGroup);
      if (matrixEquals(this._prevWorldMatrix, worldMatrix)) {
        // The node stood still; nothing to distribute.
        bindGroup.setValue('relativeTransform', this._identity);
        for (let i = 0; i < totalSubsteps; i++) {
          this._device!.compute(this._workgroupCount, 1, 1);
        }
      } else {
        // The node's frame motion, distributed evenly over every substep by
        // interpolating between the two world transforms. Lumping it into the
        // first substep instead would let a frame-time hitch move roots by more
        // than a segment length in what the solver treats as one substep, and
        // repeated hitches under jerky input wind the strands up until they
        // burst - see the class remarks.
        this._prevWorldMatrix.decompose(this._scaleFrom, this._rotationFrom, this._translationFrom);
        worldMatrix.decompose(this._scaleTo, this._rotationTo, this._translationTo);
        this._stepFrom.set(this._prevWorldMatrix);
        for (let i = 1; i <= totalSubsteps; i++) {
          if (i === totalSubsteps) {
            // The exact endpoint, so decompose round-tripping cannot leave the
            // solver's idea of the transform drifting from the node's.
            this._stepTo.set(worldMatrix);
          } else {
            const t = i / totalSubsteps;
            this._scratchVec.setXYZ(
              this._scaleFrom.x + (this._scaleTo.x - this._scaleFrom.x) * t,
              this._scaleFrom.y + (this._scaleTo.y - this._scaleFrom.y) * t,
              this._scaleFrom.z + (this._scaleTo.z - this._scaleFrom.z) * t
            );
            this._scratchVec2.setXYZ(
              this._translationFrom.x + (this._translationTo.x - this._translationFrom.x) * t,
              this._translationFrom.y + (this._translationTo.y - this._translationFrom.y) * t,
              this._translationFrom.z + (this._translationTo.z - this._translationFrom.z) * t
            );
            Quaternion.slerp(this._rotationFrom, this._rotationTo, t, this._rotationLerp);
            this._stepTo.compose(this._scratchVec, this._rotationLerp, this._scratchVec2);
          }
          this._invWorldMatrix.set(this._stepTo);
          this._invWorldMatrix.inplaceInvert();
          Matrix4x4.multiply(this._invWorldMatrix, this._stepFrom, this._relativeTransform);
          bindGroup.setValue('relativeTransform', this._relativeTransform);
          this._device!.compute(this._workgroupCount, 1, 1);
          this._stepFrom.set(this._stepTo);
        }
      }
    } finally {
      this._device!.popDeviceStates();
    }
    this._prevWorldMatrix.set(worldMatrix);
  }
  protected onDispose() {
    this._releaseResources();
  }
  /**
   * Whether the node is accelerating hard enough to suspend strand lag.
   *
   * @remarks
   * Tracks the rest centre through world space and differentiates twice. The
   * two differences are taken over the frame intervals they actually spanned
   * rather than over the fixed step, because a second difference of position
   * only is an acceleration when the samples are evenly spaced, and frame times
   * are not. The first two frames have nothing to differentiate and report
   * false.
   * @internal
   */
  private _measureRootAcceleration(worldMatrix: Matrix4x4, frameDt: number) {
    worldMatrix.transformPointAffine(this._restCenter, this._scratchVec);
    let rigid = false;
    if (this._rootHistoryDepth > 0) {
      const vx = (this._scratchVec.x - this._prevRootWorld.x) / frameDt;
      const vy = (this._scratchVec.y - this._prevRootWorld.y) / frameDt;
      const vz = (this._scratchVec.z - this._prevRootWorld.z) / frameDt;
      if (this._rootHistoryDepth > 1) {
        const ax = (vx - this._prevRootVelocity.x) / frameDt;
        const ay = (vy - this._prevRootVelocity.y) / frameDt;
        const az = (vz - this._prevRootVelocity.z) / frameDt;
        const threshold = this._vspAccelThreshold;
        rigid = ax * ax + ay * ay + az * az > threshold * threshold;
      }
      this._prevRootVelocity.setXYZ(vx, vy, vz);
    }
    this._prevRootWorld.set(this._scratchVec);
    if (this._rootHistoryDepth < 2) {
      this._rootHistoryDepth++;
    }
    return rigid;
  }
  /** Copies the rest pose over the live points. @internal */
  private _resetLivePoints() {
    // Rest points are xyz only while the live buffer interleaves width, so this
    // cannot be a straight buffer copy; the shader does it instead.
    this._bindGroup!.setValue('strandCount', this._strandCount);
    this._bindGroup!.setValue('resetPose', 1);
    this._device!.pushDeviceStates();
    try {
      this._device!.setProgram(this._program!);
      this._device!.setBindGroup(0, this._bindGroup!);
      this._device!.compute(this._workgroupCount, 1, 1);
    } finally {
      this._device!.popDeviceStates();
    }
    this._bindGroup!.setValue('resetPose', 0);
  }
  /** Builds buffers and the compute pipeline. @internal */
  private _init(strands: HairStrandData, source: HairStrandSource) {
    const device = this._device!;
    const pointCount = strands.pointCount;
    const scale = source.scale ?? 1;

    // Rest pose and rest lengths, derived from the same control points that were
    // uploaded, and in the same units - the strand data applies the scale on
    // upload, so this has to as well or every constraint would be wrong by it.
    // The same pass measures the longest strand and the centre of the rest
    // pose, which the teleport guard in update() works from.
    const restPoints = new Float32Array(pointCount * 3) as Float32Array<ArrayBuffer>;
    const restLengths = new Float32Array(pointCount) as Float32Array<ArrayBuffer>;
    const counts = source.pointCounts;
    let first = 0;
    let maxStrandLength = 0;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let s = 0; s < counts.length; s++) {
      const count = counts[s];
      let strandLength = 0;
      for (let i = 0; i < count; i++) {
        const src = (first + i) * 3;
        const dst = (first + i) * 3;
        const x = source.positions[src] * scale;
        const y = source.positions[src + 1] * scale;
        const z = source.positions[src + 2] * scale;
        restPoints[dst] = x;
        restPoints[dst + 1] = y;
        restPoints[dst + 2] = z;
        minX = x < minX ? x : minX;
        minY = y < minY ? y : minY;
        minZ = z < minZ ? z : minZ;
        maxX = x > maxX ? x : maxX;
        maxY = y > maxY ? y : maxY;
        maxZ = z > maxZ ? z : maxZ;
        if (i > 0) {
          const dx = x - restPoints[dst - 3];
          const dy = y - restPoints[dst - 2];
          const dz = z - restPoints[dst - 1];
          const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
          restLengths[first + i] = len;
          strandLength += len;
        }
      }
      if (strandLength > maxStrandLength) {
        maxStrandLength = strandLength;
      }
      first += count;
    }
    this._maxStrandLength = maxStrandLength;
    if (pointCount > 0) {
      this._restCenter.setXYZ((minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5);
    }

    this._pointBuffer = strands.pointBuffer;
    this._restPointBuffer = this._createStorage(restPoints);
    this._prevPointBuffer = this._createStorage(restPoints);
    this._restLengthBuffer = this._createStorage(restLengths);
    this._sphereBuffer = this._createStorage(this._sphereData);
    this._capsuleBuffer = this._createStorage(this._capsuleData);
    this._planeBuffer = this._createStorage(this._planeData);

    this._program = createHairSimulationProgram(device, DEFAULT_WORKGROUP_SIZE);
    if (!this._program) {
      throw new Error('failed to create the compute program');
    }
    this._bindGroup = device.createBindGroup(this._program.bindGroupLayouts[0]);
    this._bindGroup.setBuffer('points', this._pointBuffer!);
    this._bindGroup.setBuffer('prevPoints', this._prevPointBuffer);
    this._bindGroup.setBuffer('restPoints', this._restPointBuffer);
    this._bindGroup.setBuffer('restLengths', this._restLengthBuffer);
    this._bindGroup.setBuffer('headers', strands.headerBuffer!);
    this._bindGroup.setBuffer('sphereData', this._sphereBuffer);
    this._bindGroup.setBuffer('capsuleData', this._capsuleBuffer);
    this._bindGroup.setBuffer('planeData', this._planeBuffer);
    this._bindGroup.setValue('strandCount', this._strandCount);
    this._bindGroup.setValue('resetPose', 0);
    this._bindGroup.setValue('relativeTransform', Matrix4x4.identity());
    this._bindGroup.setValue('sphereCount', 0);
    this._bindGroup.setValue('capsuleCount', 0);
    this._bindGroup.setValue('planeCount', 0);
    this._bindGroup.setValue('minDistance', MIN_DISTANCE);
    this._bindGroup.setValue('maxSpeedFactor', this._maxSpeedFactor);
    this._bindGroup.setValue('globalStiffness', this._globalStiffness);
    this._bindGroup.setValue('globalRange', this._globalRange);
    this._bindGroup.setValue('localStiffness', this._localStiffness);
    this._bindGroup.setValue('localIterations', this._localIterations);
    this._bindGroup.setValue('ftlDamping', this._ftlDamping);
    this._bindGroup.setValue('vspCoeff', this._vspCoeff);
  }
  /** @internal */
  private _createStorage(data: Float32Array<ArrayBuffer>) {
    const buffer = this._device!.createBuffer(data.byteLength, {
      usage: 'uniform',
      storage: true,
      dynamic: false,
      managed: false
    });
    if (!buffer) {
      throw new Error('failed to allocate a simulation buffer');
    }
    buffer.bufferSubData(0, data);
    return buffer;
  }
  /**
   * Brings colliders into local space and uploads them.
   * @internal
   */
  private _uploadColliders(invWorldMatrix: Matrix4x4) {
    let spheres = 0;
    let capsules = 0;
    let planes = 0;
    for (const collider of this._colliders) {
      if (!collider.enabled) {
        continue;
      }
      // Colliders that track a node are world-space and refreshed here, the same
      // way the spring systems do it.
      updateColliderFromNode(collider);
      if (collider.type === 'sphere' && spheres < MAX_COLLIDERS) {
        const sphere = collider as SphereCollider;
        invWorldMatrix.transformPointAffine(sphere.center, this._scratchVec);
        const base = spheres * SPHERE_STRIDE;
        this._sphereData[base] = this._scratchVec.x;
        this._sphereData[base + 1] = this._scratchVec.y;
        this._sphereData[base + 2] = this._scratchVec.z;
        this._sphereData[base + 3] = sphere.radius * localRadiusScale(invWorldMatrix);
        spheres++;
      } else if (collider.type === 'capsule' && capsules < MAX_COLLIDERS) {
        const capsule = collider as CapsuleCollider;
        invWorldMatrix.transformPointAffine(capsule.start, this._scratchVec);
        invWorldMatrix.transformPointAffine(capsule.end, this._scratchVec2);
        const base = capsules * CAPSULE_STRIDE;
        this._capsuleData[base] = this._scratchVec.x;
        this._capsuleData[base + 1] = this._scratchVec.y;
        this._capsuleData[base + 2] = this._scratchVec.z;
        this._capsuleData[base + 3] = capsule.radius * localRadiusScale(invWorldMatrix);
        this._capsuleData[base + 4] = this._scratchVec2.x;
        this._capsuleData[base + 5] = this._scratchVec2.y;
        this._capsuleData[base + 6] = this._scratchVec2.z;
        this._capsuleData[base + 7] = 0;
        capsules++;
      } else if (collider.type === 'plane' && planes < MAX_COLLIDERS) {
        const plane = collider as PlaneCollider;
        invWorldMatrix.transformPointAffine(plane.point, this._scratchVec);
        // A normal transforms by the inverse transpose; the inverse world matrix
        // is already to hand, so transposing it is the whole of the work.
        transformNormal(invWorldMatrix, plane.normal, this._scratchVec2);
        const base = planes * PLANE_STRIDE;
        this._planeData[base] = this._scratchVec.x;
        this._planeData[base + 1] = this._scratchVec.y;
        this._planeData[base + 2] = this._scratchVec.z;
        this._planeData[base + 3] = 0;
        this._planeData[base + 4] = this._scratchVec2.x;
        this._planeData[base + 5] = this._scratchVec2.y;
        this._planeData[base + 6] = this._scratchVec2.z;
        this._planeData[base + 7] = 0;
        planes++;
      }
    }
    this._sphereBuffer!.bufferSubData(0, this._sphereData);
    this._capsuleBuffer!.bufferSubData(0, this._capsuleData);
    this._planeBuffer!.bufferSubData(0, this._planeData);
    this._bindGroup!.setValue('sphereCount', spheres);
    this._bindGroup!.setValue('capsuleCount', capsules);
    this._bindGroup!.setValue('planeCount', planes);
  }
  /** @internal */
  private _releaseResources() {
    this._enabled = false;
    this._bindGroup?.dispose();
    this._bindGroup = null;
    this._program?.dispose();
    this._program = null;
    // The point buffer belongs to the strand data, not here.
    this._pointBuffer = null;
    this._prevPointBuffer?.dispose();
    this._prevPointBuffer = null;
    this._restPointBuffer?.dispose();
    this._restPointBuffer = null;
    this._restLengthBuffer?.dispose();
    this._restLengthBuffer = null;
    this._sphereBuffer?.dispose();
    this._sphereBuffer = null;
    this._capsuleBuffer?.dispose();
    this._capsuleBuffer = null;
    this._planeBuffer?.dispose();
    this._planeBuffer = null;
  }
}

/** Mean axis scale of a matrix, for converting a radius. @internal */
function localRadiusScale(matrix: Matrix4x4) {
  const sx = Math.hypot(matrix.m00, matrix.m10, matrix.m20);
  const sy = Math.hypot(matrix.m01, matrix.m11, matrix.m21);
  const sz = Math.hypot(matrix.m02, matrix.m12, matrix.m22);
  return (sx + sy + sz) / 3;
}

/**
 * Transforms a normal by the transpose of a matrix.
 *
 * @remarks
 * Given the inverse world matrix, its transpose is the inverse-transpose of the
 * world matrix, which is what a normal needs.
 * @internal
 */
function transformNormal(invWorldMatrix: Matrix4x4, normal: Vector3, out: Vector3) {
  out.setXYZ(
    invWorldMatrix.m00 * normal.x + invWorldMatrix.m10 * normal.y + invWorldMatrix.m20 * normal.z,
    invWorldMatrix.m01 * normal.x + invWorldMatrix.m11 * normal.y + invWorldMatrix.m21 * normal.z,
    invWorldMatrix.m02 * normal.x + invWorldMatrix.m12 * normal.y + invWorldMatrix.m22 * normal.z
  );
  const len = out.magnitude;
  if (len > MIN_DISTANCE) {
    out.scaleBy(1 / len);
  } else {
    out.setXYZ(0, 1, 0);
  }
}

/**
 * Builds the solver pass.
 *
 * @remarks
 * TressFX's solver, reproduced pass for pass. TressFX dispatches five compute
 * shaders with a thread per vertex and group-shared memory; this runs the same
 * five stages back to back inside one kernel with a thread per strand, which
 * needs no barriers, no shared memory, and - the reason it matters here - no
 * fixed vertex count per strand, since a groom imported from an archive has
 * whatever point count each curve was authored with.
 *
 * The stages stay numerically equivalent under that rearrangement. Integration,
 * the global shape constraint and shock propagation are per-vertex with no
 * cross-vertex dependency. The local shape constraint is already a serial walk
 * over a strand in TressFX. The length constraint is Jacobi over alternating
 * even and odd segments, and within one of those sweeps the segments are
 * disjoint, so running them in order in a single thread lands on the same
 * answer a synchronised group would.
 *
 * Everything is solved in the node's local space rather than TressFX's world
 * space, which costs nothing and simplifies two stages: the skinning quaternion
 * that rotates the bind pose for the local shape constraint is the identity, and
 * shock propagation becomes a blend between two positions the solver already
 * has. See the class remarks for why local space, and
 * {@link GPUHairSimulationOptions.vspCoeff} for the shock propagation mapping.
 *
 * Exported for shader-generation tests only.
 * @internal
 */
export function createHairSimulationProgram(device: AbstractDevice, workgroupSize: number) {
  const program = device.buildComputeProgram({
    workgroupSize: [workgroupSize, 1, 1],
    compute(pb) {
      // Positions and widths interleave, four floats per point; the solver writes
      // xyz and leaves w alone, which is why they share one buffer.
      this.points = pb.float[0]().storageBuffer(0);
      this.prevPoints = pb.float[0]().storageBuffer(0);
      this.restPoints = pb.float[0]().storageBufferReadonly(0);
      this.restLengths = pb.float[0]().storageBufferReadonly(0);
      this.headers = pb.uint[0]().storageBufferReadonly(0);
      this.sphereData = pb.float[0]().storageBufferReadonly(0);
      this.capsuleData = pb.float[0]().storageBufferReadonly(0);
      this.planeData = pb.float[0]().storageBufferReadonly(0);
      this.strandCount = pb.uint().uniform(0);
      this.deltaTime = pb.float().uniform(0);
      this.dampingDecay = pb.float().uniform(0);
      this.globalStiffness = pb.float().uniform(0);
      this.globalRange = pb.float().uniform(0);
      this.localStiffness = pb.float().uniform(0);
      this.localIterations = pb.uint().uniform(0);
      this.ftlDamping = pb.float().uniform(0);
      this.vspCoeff = pb.float().uniform(0);
      this.friction = pb.float().uniform(0);
      this.maxSpeedFactor = pb.float().uniform(0);
      this.gravity = pb.vec3().uniform(0);
      this.relativeTransform = pb.mat4().uniform(0);
      this.sphereCount = pb.uint().uniform(0);
      this.capsuleCount = pb.uint().uniform(0);
      this.planeCount = pb.uint().uniform(0);
      this.minDistance = pb.float().uniform(0);
      this.resetPose = pb.uint().uniform(0);

      // Pushes a point out of every collider. The push is a position fix only -
      // friction, and carrying the history along so the push does not read as
      // velocity, are the caller's job, because both need the history the
      // caller is still assembling.
      pb.func('Z_hairResolveContacts', [pb.vec3('position')], function () {
        this.$l.result = this.position;
        this.$for(pb.uint('i'), 0, this.sphereCount, function () {
          this.$l.base = pb.mul(this.i, 4);
          this.$l.centre = pb.vec3(
            this.sphereData.at(this.base),
            this.sphereData.at(pb.add(this.base, 1)),
            this.sphereData.at(pb.add(this.base, 2))
          );
          this.$l.radius = this.sphereData.at(pb.add(this.base, 3));
          this.$l.delta = pb.sub(this.result, this.centre);
          this.$l.dist = pb.length(this.delta);
          this.$if(pb.lessThan(this.dist, this.radius), function () {
            this.$l.normal = pb.vec3(0, 1, 0);
            this.$if(pb.greaterThan(this.dist, this.minDistance), function () {
              this.normal = pb.div(this.delta, this.dist);
            });
            this.result = pb.add(this.centre, pb.mul(this.normal, this.radius));
          });
        });
        this.$for(pb.uint('j'), 0, this.capsuleCount, function () {
          this.$l.cbase = pb.mul(this.j, 8);
          this.$l.start = pb.vec3(
            this.capsuleData.at(this.cbase),
            this.capsuleData.at(pb.add(this.cbase, 1)),
            this.capsuleData.at(pb.add(this.cbase, 2))
          );
          this.$l.cradius = this.capsuleData.at(pb.add(this.cbase, 3));
          this.$l.end = pb.vec3(
            this.capsuleData.at(pb.add(this.cbase, 4)),
            this.capsuleData.at(pb.add(this.cbase, 5)),
            this.capsuleData.at(pb.add(this.cbase, 6))
          );
          this.$l.axis = pb.sub(this.end, this.start);
          this.$l.axisLenSq = pb.dot(this.axis, this.axis);
          this.$l.t = pb.float(0);
          this.$if(pb.greaterThan(this.axisLenSq, this.minDistance), function () {
            this.t = pb.clamp(
              pb.div(pb.dot(pb.sub(this.result, this.start), this.axis), this.axisLenSq),
              0,
              1
            );
          });
          this.$l.closest = pb.add(this.start, pb.mul(this.axis, this.t));
          this.$l.cdelta = pb.sub(this.result, this.closest);
          this.$l.cdist = pb.length(this.cdelta);
          this.$if(pb.lessThan(this.cdist, this.cradius), function () {
            this.$l.cnormal = pb.vec3(0, 1, 0);
            this.$if(pb.greaterThan(this.cdist, this.minDistance), function () {
              this.cnormal = pb.div(this.cdelta, this.cdist);
            });
            this.result = pb.add(this.closest, pb.mul(this.cnormal, this.cradius));
          });
        });
        this.$for(pb.uint('k'), 0, this.planeCount, function () {
          this.$l.pbase = pb.mul(this.k, 8);
          this.$l.point = pb.vec3(
            this.planeData.at(this.pbase),
            this.planeData.at(pb.add(this.pbase, 1)),
            this.planeData.at(pb.add(this.pbase, 2))
          );
          this.$l.pnormal = pb.vec3(
            this.planeData.at(pb.add(this.pbase, 4)),
            this.planeData.at(pb.add(this.pbase, 5)),
            this.planeData.at(pb.add(this.pbase, 6))
          );
          this.$l.signedDist = pb.dot(pb.sub(this.result, this.point), this.pnormal);
          this.$if(pb.lessThan(this.signedDist, 0), function () {
            this.result = pb.sub(this.result, pb.mul(this.pnormal, this.signedDist));
          });
        });
        this.$return(this.result);
      });

      // Reads and writes of the interleaved point buffer, which every stage
      // below does often enough that spelling out the three components each time
      // buries what the stage is actually doing.
      pb.func('Z_hairGetPoint', [pb.uint('index')], function () {
        this.$l.base = pb.mul(this.index, 4);
        this.$return(
          pb.vec3(
            this.points.at(this.base),
            this.points.at(pb.add(this.base, 1)),
            this.points.at(pb.add(this.base, 2))
          )
        );
      });
      pb.func('Z_hairSetPoint', [pb.uint('index'), pb.vec3('value')], function () {
        this.$l.base = pb.mul(this.index, 4);
        this.points.setAt(this.base, this.value.x);
        this.points.setAt(pb.add(this.base, 1), this.value.y);
        this.points.setAt(pb.add(this.base, 2), this.value.z);
        this.$return(pb.float(0));
      });
      pb.func('Z_hairGetRest', [pb.uint('index')], function () {
        this.$l.base = pb.mul(this.index, 3);
        this.$return(
          pb.vec3(
            this.restPoints.at(this.base),
            this.restPoints.at(pb.add(this.base, 1)),
            this.restPoints.at(pb.add(this.base, 2))
          )
        );
      });
      pb.func('Z_hairGetHistory', [pb.uint('index')], function () {
        this.$l.base = pb.mul(this.index, 3);
        this.$return(
          pb.vec3(
            this.prevPoints.at(this.base),
            this.prevPoints.at(pb.add(this.base, 1)),
            this.prevPoints.at(pb.add(this.base, 2))
          )
        );
      });
      pb.func('Z_hairSetHistory', [pb.uint('index'), pb.vec3('value')], function () {
        this.$l.base = pb.mul(this.index, 3);
        this.prevPoints.setAt(this.base, this.value.x);
        this.prevPoints.setAt(pb.add(this.base, 1), this.value.y);
        this.prevPoints.setAt(pb.add(this.base, 2), this.value.z);
        this.$return(pb.float(0));
      });

      // Rotates a vector by a quaternion, the usual two-cross-product form.
      pb.func('Z_hairQuatRotate', [pb.vec4('q'), pb.vec3('v')], function () {
        this.$l.uv = pb.cross(this.q.xyz, this.v);
        this.$l.uuv = pb.cross(this.q.xyz, this.uv);
        this.$return(pb.add(this.v, pb.mul(this.uv, pb.mul(this.q.w, 2)), pb.mul(this.uuv, 2)));
      });

      // The shortest-arc rotation taking unit u onto unit v. Antiparallel inputs
      // leave the axis undefined, so one perpendicular to u is picked - any of
      // them is as good as another for a half turn.
      pb.func('Z_hairQuatFromUnitVectors', [pb.vec3('u'), pb.vec3('v')], function () {
        this.$l.r = pb.add(1, pb.dot(this.u, this.v));
        this.$l.axis = pb.cross(this.u, this.v);
        this.$if(pb.lessThan(this.r, 1e-7), function () {
          this.r = pb.float(0);
          this.axis = this.$choice(
            pb.greaterThan(pb.abs(this.u.x), pb.abs(this.u.z)),
            pb.vec3(pb.neg(this.u.y), this.u.x, 0),
            pb.vec3(0, pb.neg(this.u.z), this.u.y)
          );
        });
        this.$l.q = pb.vec4(this.axis, this.r);
        this.$l.lengthSq = pb.dot(this.q, this.q);
        this.$l.result = pb.vec4(0, 0, 0, 1);
        this.$if(pb.greaterThan(this.lengthSq, 1e-10), function () {
          this.result = pb.mul(this.q, pb.inverseSqrt(this.lengthSq));
        });
        this.$return(this.result);
      });

      // Bounds the velocity a stored history implies. Nothing in ordinary motion
      // reaches the ceiling; it exists so that a single bad substep - a collider
      // teleporting through a strand, a degenerate segment - cannot hand the
      // next step a velocity that no amount of damping will bring back.
      pb.func('Z_hairClampHistory', [pb.uint('index'), pb.vec3('position'), pb.vec3('history')], function () {
        this.$l.result = this.history;
        this.$l.delta = pb.sub(this.position, this.result);
        this.$l.speed = pb.length(this.delta);
        this.$l.limit = pb.mul(this.restLengths.at(this.index), this.maxSpeedFactor);
        this.$if(pb.greaterThan(this.speed, this.limit), function () {
          this.result = pb.sub(this.position, pb.mul(this.delta, pb.div(this.limit, this.speed)));
        });
        this.$return(this.result);
      });

      pb.main(function () {
        this.$l.strand = this.$builtins.globalInvocationId.x;
        this.$if(pb.lessThan(this.strand, this.strandCount), function () {
          this.$l.hbase = pb.mul(this.strand, 4);
          this.$l.firstPoint = this.headers.at(this.hbase);
          this.$l.pointCount = this.headers.at(pb.add(this.hbase, 1));

          this.$if(pb.notEqual(this.resetPose, 0), function () {
            // Restoring the authored pose: copy rest into both the live points and
            // the previous ones, which leaves the strand still as well as in place.
            this.$for(pb.uint('i'), 0, this.pointCount, function () {
              this.$l.idx = pb.add(this.firstPoint, this.i);
              this.$l.rest = this.Z_hairGetRest(this.idx);
              this.Z_hairSetPoint(this.idx, this.rest);
              this.Z_hairSetHistory(this.idx, this.rest);
            });
          }).$else(function () {
            // The first two points are pinned to their authored positions. Two,
            // not one: a single pinned point fixes where a strand hangs from but
            // leaves the direction it leaves the scalp in free, so the root end
            // flops and can invert. The second point is what gives every strand
            // a root frame, and the local shape constraint below is defined
            // relative to that frame. In local space "pinned" means unchanged,
            // because the node's motion is carried by the transform rather than
            // by moving the roots.
            this.$l.rootRest = this.Z_hairGetRest(this.firstPoint);
            this.Z_hairSetPoint(this.firstPoint, this.rootRest);
            this.Z_hairSetHistory(this.firstPoint, this.rootRest);
            this.$if(pb.greaterThan(this.pointCount, 1), function () {
              this.$l.nextIdx = pb.add(this.firstPoint, 1);
              this.$l.nextRest = this.Z_hairGetRest(this.nextIdx);
              this.Z_hairSetPoint(this.nextIdx, this.nextRest);
              this.Z_hairSetHistory(this.nextIdx, this.nextRest);
            });

            this.$l.dt2 = pb.mul(this.deltaTime, this.deltaTime);
            this.$l.rangeLimit = pb.mul(this.globalRange, pb.float(this.pointCount));

            //
            // Stage 1 - integration, shock propagation and the global shape
            // constraint. Per-vertex, no dependency between points.
            //
            this.$for(pb.uint('i'), 2, this.pointCount, function () {
              this.$l.idx = pb.add(this.firstPoint, this.i);
              this.$l.current = this.Z_hairGetPoint(this.idx);
              this.$l.previous = this.Z_hairGetHistory(this.idx);
              // The node's frame-to-frame motion, expressed in local space: a
              // point that stood still in the world has moved by exactly this.
              // Carrying both stored positions through it leaves the strand
              // where it was in the world, so the pinned root drags it along.
              // Transforming only one of the two would read the node's own
              // motion as strand velocity and throw the hair ahead of the
              // movement instead of trailing behind it.
              this.$l.lagged = pb.mul(this.relativeTransform, pb.vec4(this.current, 1)).xyz;
              this.$l.laggedPrev = pb.mul(this.relativeTransform, pb.vec4(this.previous, 1)).xyz;
              // Velocity shock propagation. TressFX drags each point part of the
              // way along the rigid motion its root just underwent; in local
              // space the two ends of that blend are already to hand, because
              // leaving a point untransformed *is* carrying it rigidly with the
              // node. So the coefficient interpolates between the two: 0 leaves
              // the strand behind entirely, 1 makes it follow the head as if
              // welded. What it buys is that a fast-moving root cannot outrun
              // the strand far enough in one step for the length constraint to
              // have to snap it back.
              this.current = pb.mix(this.lagged, this.current, this.vspCoeff);
              this.previous = pb.mix(this.laggedPrev, this.previous, this.vspCoeff);
              this.$l.velocity = pb.mul(pb.sub(this.current, this.previous), this.dampingDecay);
              this.$l.next = pb.add(this.current, this.velocity, pb.mul(this.gravity, this.dt2));
              // Pull toward the authored pose, over the fraction of the strand
              // the range covers. Off by default: it anchors a point to a fixed
              // place rather than to its neighbours, which is a spring, and the
              // local shape constraint below holds a groom's styling without
              // that. It stays available for grooms that want to be pinned.
              this.$if(
                pb.and(
                  pb.greaterThan(this.globalStiffness, 0),
                  pb.lessThan(pb.float(this.i), this.rangeLimit)
                ),
                function () {
                  this.$l.rest = this.Z_hairGetRest(this.idx);
                  this.next = pb.add(this.next, pb.mul(pb.sub(this.rest, this.next), this.globalStiffness));
                }
              );
              this.Z_hairSetHistory(this.idx, this.current);
              this.Z_hairSetPoint(this.idx, this.next);
            });

            //
            // Stage 2 - local shape constraint. This is what makes a groom read
            // as hair rather than as a chain: it holds the angle each segment
            // makes with the one before it, measured in the frame the previous
            // segment currently occupies rather than against a fixed pose. A
            // strand can therefore hang, swing and settle anywhere while keeping
            // the curl it was authored with, and it resists bending the way a
            // fibre does - which is also what stops a disturbance ringing up and
            // down the strand for seconds.
            //
            // Stiffness is halved and capped below 1, as in TressFX: the
            // constraint moves both of the points it touches, so a full-strength
            // correction applied at both ends overshoots.
            //
            this.$l.localStrength = pb.mul(pb.min(this.localStiffness, 0.95), 0.5);
            this.$if(pb.greaterThan(this.pointCount, 2), function () {
              this.$for(pb.uint('iter'), 0, this.localIterations, function () {
                this.$for(pb.uint('i'), 1, pb.sub(this.pointCount, 1), function () {
                  this.$l.idx = pb.add(this.firstPoint, this.i);
                  this.$l.pos = this.Z_hairGetPoint(this.idx);
                  this.$l.posPlus = this.Z_hairGetPoint(pb.add(this.idx, 1));
                  this.$l.posMinus = this.Z_hairGetPoint(pb.sub(this.idx, 1));
                  this.$l.bind = this.Z_hairGetRest(this.idx);
                  this.$l.bindPlus = this.Z_hairGetRest(pb.add(this.idx, 1));
                  this.$l.bindMinus = this.Z_hairGetRest(pb.sub(this.idx, 1));
                  // Where the next point would sit if the bend it makes with the
                  // previous segment still matched the bind pose, carried into
                  // whatever direction that previous segment points in now.
                  this.$l.lastVec = pb.sub(this.pos, this.posMinus);
                  this.$l.bindVec = pb.sub(this.bindPlus, this.bind);
                  this.$l.lastBindVec = pb.sub(this.bind, this.bindMinus);
                  this.$l.rotation = this.Z_hairQuatFromUnitVectors(
                    pb.normalize(this.lastBindVec),
                    pb.normalize(this.lastVec)
                  );
                  this.$l.bendTarget = pb.add(this.Z_hairQuatRotate(this.rotation, this.bindVec), this.pos);
                  this.$l.del = pb.mul(pb.sub(this.bendTarget, this.posPlus), this.localStrength);
                  // The correction is shared between the two ends, except where
                  // one of them is a pinned root and cannot take its half.
                  this.$if(pb.greaterThan(this.i, 1), function () {
                    this.Z_hairSetPoint(this.idx, pb.sub(this.pos, this.del));
                  });
                  this.Z_hairSetPoint(pb.add(this.idx, 1), pb.add(this.posPlus, this.del));
                });
              });
            });

            //
            // Stage 3 - length constraints, root to tip. Each point is placed at
            // exactly its authored distance from the one before it, which is
            // already final, so one pass leaves the strand inextensible - no
            // iteration count to tune and nothing left over.
            //
            // This is the one place the port leaves TressFX, which sweeps
            // alternating even and odd segments Jacobi-style instead. It has to:
            // a thread there owns one vertex, so a serial walk down a strand is
            // not available to it. Jacobi transports tension one segment per
            // sweep, and a hanging strand needs it transported from tip to root,
            // so the strand stretches until the residual balances - on a 24-point
            // strand under earth gravity that is 22% at TressFX's two sweeps and
            // still 4.5% at sixteen. TressFX does not see this because its own
            // default gravity is zero.
            //
            // Moving the child alone leaves the momentum that correction
            // represents unaccounted for, and unaccounted it accumulates: every
            // root movement pumps the chain, and since the segments are coupled
            // in series it collects at the free end and the groom whips. Handing
            // the correction back to the parent as reverse momentum - Mueller's
            // FTL damping - is what keeps that from happening.
            //
            this.$if(pb.greaterThan(this.pointCount, 2), function () {
              this.$for(pb.uint('j'), 1, pb.sub(this.pointCount, 1), function () {
                this.$l.parentIdx = pb.add(this.firstPoint, this.j);
                this.$l.childIdx = pb.add(this.parentIdx, 1);
                this.$l.parent = this.Z_hairGetPoint(this.parentIdx);
                this.$l.predicted = this.Z_hairGetPoint(this.childIdx);
                // Rest lengths are indexed by the far end of a segment.
                this.$l.restLength = this.restLengths.at(this.childIdx);
                this.$l.offset = pb.sub(this.predicted, this.parent);
                this.$l.dist = pb.length(this.offset);
                // Coincident with the parent leaves the direction undefined; any
                // offset of the right length will do, and the next step's gravity
                // pulls it back into a sensible one.
                this.$l.projected = pb.add(this.parent, pb.vec3(0, this.restLength, 0));
                this.$if(pb.greaterThan(this.dist, this.minDistance), function () {
                  this.projected = pb.add(
                    this.parent,
                    pb.mul(pb.div(this.offset, this.dist), this.restLength)
                  );
                });
                this.Z_hairSetPoint(this.childIdx, this.projected);
                // The parent takes the reverse momentum, unless it is one of the
                // pinned roots and has none to take.
                this.$if(pb.greaterThan(this.j, 1), function () {
                  this.$l.correction = pb.sub(this.projected, this.predicted);
                  this.Z_hairSetHistory(
                    this.parentIdx,
                    pb.add(this.Z_hairGetHistory(this.parentIdx), pb.mul(this.correction, this.ftlDamping))
                  );
                });
              });
            });

            //
            // Stage 4 - contacts, and the ceiling on how far a point may have
            // travelled this substep.
            //
            this.$for(pb.uint('i'), 2, this.pointCount, function () {
              this.$l.idx = pb.add(this.firstPoint, this.i);
              this.$l.position = this.Z_hairGetPoint(this.idx);
              this.$l.history = this.Z_hairGetHistory(this.idx);
              this.$l.resolved = this.Z_hairResolveContacts(this.position);
              // Being pushed out of a collider is a position fix, not a shove:
              // the history follows the push so the point leaves the surface
              // with the velocity it arrived with, and friction then takes its
              // share of the part of that velocity along the surface.
              this.$l.push = pb.sub(this.resolved, this.position);
              this.$l.pushDist = pb.length(this.push);
              this.history = pb.add(this.history, this.push);
              this.$if(pb.greaterThan(this.pushDist, this.minDistance), function () {
                this.$l.normalDir = pb.div(this.push, this.pushDist);
                this.$l.contactVelocity = pb.sub(this.resolved, this.history);
                this.$l.tangential = pb.sub(
                  this.contactVelocity,
                  pb.mul(this.normalDir, pb.dot(this.contactVelocity, this.normalDir))
                );
                this.history = pb.add(this.history, pb.mul(this.tangential, this.friction));
              });
              this.Z_hairSetHistory(this.idx, this.Z_hairClampHistory(this.idx, this.resolved, this.history));
              this.Z_hairSetPoint(this.idx, this.resolved);
            });
          });
        });
      });
    }
  });
  if (program) {
    program.name = '@GPUHair_Simulate';
  }
  return program;
}
