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
 * pushing the previous position through that matrix before integrating leaves
 * the strand lagging behind its root, which is the drag. Gravity and colliders
 * come the other way, from world space into local, on the CPU.
 *
 * WebGPU only, like the rendering path it feeds.
 */
import type { AbstractDevice, BindGroup, GPUDataBuffer, GPUProgram } from '@zephyr3d/device';
import type { Nullable } from '@zephyr3d/base';
import { Matrix4x4, Vector3, Disposable } from '@zephyr3d/base';
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
 * Tuning for {@link GPUHairSimulation}.
 *
 * @public
 */
export type GPUHairSimulationOptions = {
  /** World-space gravity. Defaults to earth gravity along -Y. */
  gravity?: Vector3;
  /** Velocity lost each step, in [0, 1]. 0 keeps full inertia. */
  damping?: number;
  /**
   * How strongly a strand returns to its authored shape, in [0, 1].
   *
   * @remarks
   * The dial that decides whether a groom reads as hair or as string. At 0 the
   * strands only fall; a styled groom needs enough of this to hold its shape and
   * merely move within it.
   */
  stiffness?: number;
  /** Integration substeps per fixed step, in [1, 8]. */
  substeps?: number;
  /** Colliders the strands are pushed out of. */
  colliders?: SpringCollider[];
  /** Friction applied to the tangential motion of a contact, in [0, 1]. */
  friction?: number;
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
  private _stiffness: number;
  /** @internal */
  private _substeps: number;
  /** @internal */
  private _friction: number;
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
  /** @internal Reused for the steps that must not re-apply node motion. */
  private readonly _identity: Matrix4x4;
  private readonly _localGravity: Vector3;
  private readonly _scratchVec: Vector3;
  private readonly _scratchVec2: Vector3;
  /** @internal True until the first step has seen a world matrix. */
  private _hasPrevWorldMatrix: boolean;
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
    this._damping = clamp(options?.damping ?? 0.05, 0, 1);
    this._stiffness = clamp(options?.stiffness ?? 0.35, 0, 1);
    this._substeps = clamp(options?.substeps ?? 2, 1, 8) | 0;
    this._friction = clamp(options?.friction ?? 0.2, 0, 1);
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
    this._hasPrevWorldMatrix = false;
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
  /** How strongly strands return to their authored shape, in [0, 1]. */
  get stiffness() {
    return this._stiffness;
  }
  set stiffness(value: number) {
    this._stiffness = clamp(value, 0, 1);
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
   * the hair.
   */
  reset(worldMatrix: Matrix4x4) {
    if (!this._enabled) {
      return;
    }
    this._timeAccumulator = 0;
    this._prevWorldMatrix.set(worldMatrix);
    this._hasPrevWorldMatrix = true;
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

    // Local space is where the solver works, so everything world-space has to be
    // brought in: the frame-to-frame motion of the node, gravity, and colliders.
    this._invWorldMatrix.set(worldMatrix);
    this._invWorldMatrix.inplaceInvert();
    Matrix4x4.multiply(this._invWorldMatrix, this._prevWorldMatrix, this._relativeTransform);
    this._invWorldMatrix.transformVectorAffine(this._gravity, this._localGravity);
    this._uploadColliders(this._invWorldMatrix);

    const bindGroup = this._bindGroup!;
    bindGroup.setValue('strandCount', this._strandCount);
    bindGroup.setValue('damping', this._damping);
    bindGroup.setValue('stiffness', this._stiffness);
    bindGroup.setValue('friction', this._friction);
    bindGroup.setValue('gravity', this._localGravity);
    bindGroup.setValue('minDistance', MIN_DISTANCE);

    this._device!.pushDeviceStates();
    try {
      for (let step = 0; step < stepCount; step++) {
        // Only the first step of a frame carries the node's motion; replaying it
        // per step would multiply the inertia by the step count.
        bindGroup.setValue('relativeTransform', step === 0 ? this._relativeTransform : this._identity);
        this._runStep();
      }
    } finally {
      this._device!.popDeviceStates();
    }
    this._prevWorldMatrix.set(worldMatrix);
  }
  protected onDispose() {
    this._releaseResources();
  }
  /** Runs the substeps of one fixed step. @internal */
  private _runStep() {
    const bindGroup = this._bindGroup!;
    const substepDt = FIXED_SIMULATION_TIME_STEP / this._substeps;
    bindGroup.setValue('deltaTime', substepDt);
    this._device!.setProgram(this._program!);
    this._device!.setBindGroup(0, bindGroup);
    for (let i = 0; i < this._substeps; i++) {
      this._device!.compute(this._workgroupCount, 1, 1);
      if (i === 0) {
        // The node's motion has been consumed by the first substep.
        bindGroup.setValue('relativeTransform', this._identity);
      }
    }
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
    const restPoints = new Float32Array(pointCount * 3) as Float32Array<ArrayBuffer>;
    const restLengths = new Float32Array(pointCount) as Float32Array<ArrayBuffer>;
    const counts = source.pointCounts;
    let first = 0;
    for (let s = 0; s < counts.length; s++) {
      const count = counts[s];
      for (let i = 0; i < count; i++) {
        const src = (first + i) * 3;
        const dst = (first + i) * 3;
        restPoints[dst] = source.positions[src] * scale;
        restPoints[dst + 1] = source.positions[src + 1] * scale;
        restPoints[dst + 2] = source.positions[src + 2] * scale;
        if (i > 0) {
          const dx = restPoints[dst] - restPoints[dst - 3];
          const dy = restPoints[dst + 1] - restPoints[dst - 2];
          const dz = restPoints[dst + 2] - restPoints[dst - 1];
          restLengths[first + i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
      }
      first += count;
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
 * One thread per strand. It reads the strand's header to find its slice of the
 * point buffer, then walks the strand root to tip: integrate, constrain against
 * the point already settled behind it, resolve contacts. Because the previous
 * point is final by the time the next one is reached, corrections propagate down
 * the strand within the pass - Gauss-Seidel, without the graph colouring that
 * would need on shared topology.
 * @internal
 */
function createHairSimulationProgram(device: AbstractDevice, workgroupSize: number) {
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
      this.damping = pb.float().uniform(0);
      this.stiffness = pb.float().uniform(0);
      this.friction = pb.float().uniform(0);
      this.gravity = pb.vec3().uniform(0);
      this.relativeTransform = pb.mat4().uniform(0);
      this.sphereCount = pb.uint().uniform(0);
      this.capsuleCount = pb.uint().uniform(0);
      this.planeCount = pb.uint().uniform(0);
      this.minDistance = pb.float().uniform(0);
      this.resetPose = pb.uint().uniform(0);

      // Pushes a point out of every collider, and rubs off tangential motion.
      pb.func('Z_hairResolveContacts', [pb.vec3('position'), pb.vec3('previous')], function () {
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
        // Friction removes part of the motion along the contact surface. Applied
        // once for all contacts rather than per collider, so overlapping
        // colliders do not multiply the effect.
        this.$l.moved = pb.sub(this.result, this.position);
        this.$if(pb.greaterThan(pb.length(this.moved), this.minDistance), function () {
          this.$l.step = pb.sub(this.position, this.previous);
          this.$l.normalDir = pb.normalize(this.moved);
          this.$l.tangential = pb.sub(this.step, pb.mul(this.normalDir, pb.dot(this.step, this.normalDir)));
          this.result = pb.sub(this.result, pb.mul(this.tangential, this.friction));
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
              this.$l.rbase = pb.mul(this.idx, 3);
              this.$l.wbase = pb.mul(this.idx, 4);
              this.points.setAt(this.wbase, this.restPoints.at(this.rbase));
              this.points.setAt(pb.add(this.wbase, 1), this.restPoints.at(pb.add(this.rbase, 1)));
              this.points.setAt(pb.add(this.wbase, 2), this.restPoints.at(pb.add(this.rbase, 2)));
              this.prevPoints.setAt(this.rbase, this.restPoints.at(this.rbase));
              this.prevPoints.setAt(pb.add(this.rbase, 1), this.restPoints.at(pb.add(this.rbase, 1)));
              this.prevPoints.setAt(pb.add(this.rbase, 2), this.restPoints.at(pb.add(this.rbase, 2)));
            });
          }).$else(function () {
            // The root is pinned to its authored position. It is the strand's
            // anchor to the scalp, and it moves only because the node does - which
            // in local space means it does not move at all.
            this.$l.rootWrite = pb.mul(this.firstPoint, 4);
            this.$l.rootRest = pb.mul(this.firstPoint, 3);
            this.points.setAt(this.rootWrite, this.restPoints.at(this.rootRest));
            this.points.setAt(pb.add(this.rootWrite, 1), this.restPoints.at(pb.add(this.rootRest, 1)));
            this.points.setAt(pb.add(this.rootWrite, 2), this.restPoints.at(pb.add(this.rootRest, 2)));
            this.prevPoints.setAt(this.rootRest, this.restPoints.at(this.rootRest));
            this.prevPoints.setAt(pb.add(this.rootRest, 1), this.restPoints.at(pb.add(this.rootRest, 1)));
            this.prevPoints.setAt(pb.add(this.rootRest, 2), this.restPoints.at(pb.add(this.rootRest, 2)));

            this.$l.dt2 = pb.mul(this.deltaTime, this.deltaTime);
            this.$l.anchor = pb.vec3(
              this.restPoints.at(this.rootRest),
              this.restPoints.at(pb.add(this.rootRest, 1)),
              this.restPoints.at(pb.add(this.rootRest, 2))
            );
            // Walking root to tip: each point is constrained against the one
            // before it, which has already been finalised this pass.
            this.$for(pb.uint('i'), 1, this.pointCount, function () {
              this.$l.idx = pb.add(this.firstPoint, this.i);
              this.$l.wbase = pb.mul(this.idx, 4);
              this.$l.rbase = pb.mul(this.idx, 3);
              this.$l.current = pb.vec3(
                this.points.at(this.wbase),
                this.points.at(pb.add(this.wbase, 1)),
                this.points.at(pb.add(this.wbase, 2))
              );
              this.$l.previous = pb.vec3(
                this.prevPoints.at(this.rbase),
                this.prevPoints.at(pb.add(this.rbase, 1)),
                this.prevPoints.at(pb.add(this.rbase, 2))
              );
              this.$l.rest = pb.vec3(
                this.restPoints.at(this.rbase),
                this.restPoints.at(pb.add(this.rbase, 1)),
                this.restPoints.at(pb.add(this.rbase, 2))
              );
              // The node's frame-to-frame motion, expressed in local space. A
              // point that stood still in the world has moved by exactly this, so
              // carrying the previous position through it leaves the strand
              // trailing behind its root - which is the swing.
              this.previous = pb.mul(this.relativeTransform, pb.vec4(this.previous, 1)).xyz;
              this.$l.velocity = pb.mul(pb.sub(this.current, this.previous), pb.sub(1, this.damping));
              this.$l.next = pb.add(this.current, this.velocity, pb.mul(this.gravity, this.dt2));
              // Pull back toward the authored shape. Without this a groom falls
              // into a curtain and never recovers its styling.
              this.next = pb.add(this.next, pb.mul(pb.sub(this.rest, this.next), this.stiffness));
              // Follow the leader: hold the authored spacing from the previous
              // point, which is already final.
              this.$l.restLength = this.restLengths.at(this.idx);
              this.$l.toPrev = pb.sub(this.next, this.anchor);
              this.$l.dist = pb.length(this.toPrev);
              this.$if(pb.greaterThan(this.dist, this.minDistance), function () {
                this.next = pb.add(this.anchor, pb.mul(pb.div(this.toPrev, this.dist), this.restLength));
              }).$else(function () {
                // Coincident with the previous point leaves the direction
                // undefined; any offset of the right length will do, and the next
                // step's gravity will pull it back into a sensible one.
                this.next = pb.add(this.anchor, pb.vec3(0, this.restLength, 0));
              });
              this.next = this.Z_hairResolveContacts(this.next, this.current);
              this.prevPoints.setAt(this.rbase, this.current.x);
              this.prevPoints.setAt(pb.add(this.rbase, 1), this.current.y);
              this.prevPoints.setAt(pb.add(this.rbase, 2), this.current.z);
              this.points.setAt(this.wbase, this.next.x);
              this.points.setAt(pb.add(this.wbase, 1), this.next.y);
              this.points.setAt(pb.add(this.wbase, 2), this.next.z);
              this.anchor = this.next;
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
