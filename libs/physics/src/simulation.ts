import { Disposable, makeObservable, Quaternion, Vector3 } from '@zephyr3d/base';
import type {
  CharacterController,
  CharacterMoveResult,
  Collider,
  ColliderOutline,
  Joint,
  NodePhysics,
  PhysicsEventMap,
  PhysicsQueryHit,
  PhysicsQueryOptions,
  PhysicsShape,
  PhysicsWorld,
  PhysicsWorldEventMap,
  RigidBody,
  Scene,
  Vehicle,
  Wheel
} from '@zephyr3d/scene';
import {
  getDevice,
  PhysicsContactEvent,
  PhysicsTriggerEvent,
  SceneNode,
  ScenePhysicsSettings,
  tryGetApp
} from '@zephyr3d/scene';
import type {
  BackendBody,
  BackendCharacter,
  BackendCollider,
  BackendJoint,
  BackendRayHit,
  BackendVehicle,
  BackendWorld,
  PhysicsBackend,
  QueryPredicate,
  ShapeDesc
} from './backend';
import type { ColliderGeometry, GeometrySource } from './geometry';
import { buildColliderShape, CONVEX_HULL_ERROR } from './shapes';
import { fetchGeometry, geometryMatches, geometrySource, needsGeometry, sameSource } from './geometry';
import { getColliderOutline, getColliderOutlineKey } from './outline';

/** A vehicle in the backend, and how its wheel nodes are placed. */
interface VehicleEntry {
  component: Vehicle;
  owner: BodyEntry;
  vehicle: BackendVehicle;
  wheels: Wheel[];
  /** Per wheel, chassis space: suspension attachment, and rotation of the node at rest. */
  hardPoints: Vector3[];
  restRotations: Quaternion[];
  /** Front, and the axis wheels roll about going forwards (up × front), chassis space. */
  forward: Vector3;
  spinAxis: Vector3;
}

/** World pose of a node, scale dropped. */
interface Pose {
  position: Vector3;
  rotation: Quaternion;
}

function newPose(): Pose {
  return { position: new Vector3(), rotation: new Quaternion() };
}

function copyPose(dst: Pose, src: Pose) {
  dst.position.set(src.position);
  dst.rotation.set(src.rotation);
}

/** */
interface BodyEntry {
  component: RigidBody;
  body: BackendBody;
  /** Last two simulated poses, interpolated between for rendering. */
  prev: Pose;
  curr: Pose;
  /** Where a kinematic body was told to be at the end of the last frame. */
  kinematicFrom: Pose;
  /** World matrix the node had after the last write-back or read, to spot teleports. */
  lastMatrix: Float32Array;
  /** A sleeping body has had its resting pose written and needs no more writes. */
  settled: boolean;
  /** Left out of the simulation while one of its colliders waits for geometry. */
  disabled: boolean;
}

/** */
interface ColliderEntry {
  component: Collider;
  owner: BodyEntry | null;
  /** A static body of its own, for a collider with no rigid body above it. */
  implicitBody: BackendBody | null;
  collider: BackendCollider;
  key: number;
  lastMatrix: Float32Array;
}

/** */
interface JointEntry {
  component: Joint;
  joint: BackendJoint;
  /** The body the joint's node belongs to. */
  owner: BodyEntry;
  /** The connected body; null when connected to the world. */
  other: BodyEntry | null;
  /** Joint frame and anchor in each body's local space, for reading values back. */
  ownerFrame: Quaternion;
  otherFrame: Quaternion;
  ownerAnchor: Vector3;
  otherAnchor: Vector3;
}

/**
 * A joint's frames, kept from its first creation so that rebuilding it (after
 * a property change of one of its bodies, say) does not move its zero.
 */
interface JointFrames {
  owner: RigidBody;
  other: RigidBody | null;
  ownerAnchor: Vector3;
  ownerFrame: Quaternion;
  otherAnchor: Vector3;
  otherFrame: Quaternion;
}

/** Two physics objects in contact, through one pair of their colliders. */
interface ObjectPair {
  key: string;
  /** The object with the lower id; `colliderA` is one of its colliders. */
  a: NodePhysics;
  b: NodePhysics;
  colliderA: Collider;
  colliderB: Collider;
  trigger: boolean;
}

const LAYER_COUNT = 16;
const ALL_LAYERS = 0xffff;
const MAX_QUERY_DISTANCE = 1e9;

const tmpPose = newPose();
const tmpPose2 = newPose();
const tmpScale = new Vector3();
const tmpVec = new Vector3();
const tmpQuat = new Quaternion();

function readWorldPose(node: SceneNode, out: Pose, scale?: Vector3) {
  node.worldMatrix.decompose(scale ?? tmpScale, out.rotation, out.position);
  return out;
}

function matrixEquals(m: Float32Array, node: SceneNode) {
  const w = node.worldMatrix;
  for (let i = 0; i < 16; i++) {
    if (Math.abs(m[i] - w[i]) > 1e-6) {
      return false;
    }
  }
  return true;
}

function storeMatrix(m: Float32Array, node: SceneNode) {
  m.set(node.worldMatrix);
}

/** Whether `node` is `root` or below it. */
function isUnder(node: SceneNode | null, root: SceneNode) {
  for (let n = node; n; n = n.parent) {
    if (n === root) {
      return true;
    }
  }
  return false;
}

/** Character controllers, told apart without importing the class. */
function isCharacter(part: unknown): part is CharacterController {
  return !!part && (part as CharacterController)._ownedBody !== undefined;
}

/** The rigid body standing for a node's body: a character's own body for a character. */
function rigidBodyOf(physics: NodePhysics | null | undefined): RigidBody | null {
  return physics?.body ?? physics?.character?._ownedBody ?? null;
}

/** The parts of a node's physics in creation order; a character brings its body and capsule. */
function partsOf(physics: NodePhysics) {
  const parts: unknown[] = [];
  for (const part of physics.parts) {
    if (isCharacter(part)) {
      parts.push(part._ownedBody, part._ownedCollider);
    } else {
      parts.push(part);
    }
  }
  return parts;
}

function queryShapeDesc(shape: PhysicsShape): ShapeDesc {
  switch (shape.type) {
    case 'sphere':
      return { type: 'sphere', radius: shape.radius };
    case 'capsule':
      return {
        type: 'capsule',
        radius: shape.radius,
        halfHeight: Math.max(0, shape.height / 2 - shape.radius)
      };
    case 'cylinder':
      return { type: 'cylinder', radius: shape.radius, halfHeight: shape.height / 2 };
    default:
      return {
        type: 'box',
        halfExtents: new Vector3(shape.size.x / 2, shape.size.y / 2, shape.size.z / 2)
      };
  }
}

/**
 * The physics simulation of one scene: the {@link PhysicsWorld} that
 * {@link initPhysics} gives scenes, as `scene.physicsWorld`.
 *
 * @remarks
 * Created on demand by the scene, and stepped once per frame on the scene's `afterupdate` event: after animation,
 * so kinematic bodies follow this frame's pose, and before rendering, so moved
 * nodes are drawn where the simulation put them.
 *
 * The simulation advances in fixed steps of {@link PhysicsSimulation.fixedTimeStep},
 * at most {@link PhysicsSimulation.maxSubSteps} per frame; time beyond that is
 * dropped rather than carried over, so a long frame slows the simulation down
 * instead of making the next frames catch up in a burst. Rendered poses of
 * dynamic bodies are interpolated between the last two steps.
 *
 * Only the fixed steps feed the simulation; frame rate and interpolation never
 * do, so the same inputs give the same result on any machine.
 *
 * @public
 */
export class PhysicsSimulation
  extends makeObservable(Disposable)<PhysicsWorldEventMap>()
  implements PhysicsWorld
{
  private static _simulationEnabled = true;
  private readonly _scene: Scene;
  private readonly _engine: PhysicsBackend;
  private _backend: BackendWorld | null;
  private readonly _gravity: Vector3;
  private _fixedTimeStep: number;
  private _maxSubSteps: number;
  private _interpolation: boolean;
  private _enabled: boolean;
  private _accumulator: number;
  private readonly _bodies: Map<RigidBody, BodyEntry>;
  private readonly _colliders: Map<Collider, ColliderEntry>;
  private readonly _byKey: Map<number, ColliderEntry>;
  /** Components that joined, left or changed since the last resolve. */
  private readonly _dirtyBodies: Set<RigidBody>;
  private readonly _dirtyColliders: Set<Collider>;
  private readonly _registeredBodies: Set<RigidBody>;
  private readonly _registeredColliders: Set<Collider>;
  private readonly _layerMasks: number[];
  private readonly _layerNames: string[];
  /** Collider pairs touching now, by collider keys; the backend's view. */
  private readonly _touching: Map<string, [ColliderEntry, ColliderEntry]>;
  private readonly _touchingByKey: Map<number, Set<string>>;
  /** Object pairs that started touching during this frame's steps. */
  private readonly _startedThisFrame: Map<string, ObjectPair>;
  /** Object pairs touching at the end of the last frame that took a step. */
  private _lastPairs: Map<string, ObjectPair>;
  /** Colliders waiting for their geometry, and which request is the latest. */
  private readonly _pending: Map<Collider, { source: GeometrySource; generation: number }>;
  private readonly _pendingPromises: Set<Promise<void>>;
  /** Colliders whose geometry failed, and for which source, so it is not retried every frame. */
  private readonly _failed: Map<Collider, GeometrySource | null>;
  private _geometryGeneration: number;
  private _enablementDirty: boolean;
  private _waitForCollidersOnStart: boolean;
  /** Whether a step has been taken; see waitForCollidersOnStart. */
  private _started: boolean;
  private readonly _registeredJoints: Set<Joint>;
  private readonly _dirtyJoints: Set<Joint>;
  private readonly _joints: Map<Joint, JointEntry>;
  private readonly _jointFrames: WeakMap<Joint, JointFrames>;
  /** Joints that could not be created for a reason that may go away: retried every update. */
  private readonly _retryJoints: Set<Joint>;
  /** The static body joints connected to the world hang from. */
  private _worldAnchor: BackendBody | null;
  private readonly _characters: Map<CharacterController, BackendCharacter | null>;
  /** The scene settings last applied, and their version then. */
  private _appliedSettings: ScenePhysicsSettings | null;
  private _appliedSettingsVersion: number;
  private readonly _registeredVehicles: Set<Vehicle>;
  private readonly _registeredWheels: Set<Wheel>;
  private readonly _vehicles: Map<Vehicle, VehicleEntry>;
  private _vehiclesDirty: boolean;
  /** Whether a fixed update is running, so forces act on one step only. */
  _inFixedUpdate: boolean;

  /**
   * Whether worlds step on their own each frame. Default true.
   *
   * @remarks
   * Turned off by tools that show scenes without running them, such as the
   * editor. Worlds keep tracking their physics data meanwhile; calling
   * {@link PhysicsSimulation.update} directly still steps.
   */
  static get simulationEnabled() {
    return PhysicsSimulation._simulationEnabled;
  }
  static set simulationEnabled(value: boolean) {
    PhysicsSimulation._simulationEnabled = !!value;
  }
  /**
   * @param scene - The scene to simulate.
   * @param engine - The physics engine, loaded already.
   */
  constructor(scene: Scene, engine: PhysicsBackend) {
    super();
    this._scene = scene;
    this._engine = engine;
    this._backend = null;
    this._gravity = new Vector3(0, -9.81, 0);
    this._fixedTimeStep = 1 / 60;
    this._maxSubSteps = 4;
    this._interpolation = true;
    this._enabled = true;
    this._accumulator = 0;
    this._bodies = new Map();
    this._colliders = new Map();
    this._byKey = new Map();
    this._dirtyBodies = new Set();
    this._dirtyColliders = new Set();
    this._registeredBodies = new Set();
    this._registeredColliders = new Set();
    this._layerMasks = new Array<number>(LAYER_COUNT).fill(ALL_LAYERS);
    this._layerNames = Array.from({ length: LAYER_COUNT }, (_, i) => (i === 0 ? 'Default' : `Layer ${i}`));
    this._touching = new Map();
    this._touchingByKey = new Map();
    this._startedThisFrame = new Map();
    this._lastPairs = new Map();
    this._pending = new Map();
    this._pendingPromises = new Set();
    this._failed = new Map();
    this._geometryGeneration = 0;
    this._enablementDirty = false;
    this._waitForCollidersOnStart = true;
    this._started = false;
    this._registeredJoints = new Set();
    this._dirtyJoints = new Set();
    this._joints = new Map();
    this._jointFrames = new WeakMap();
    this._retryJoints = new Set();
    this._worldAnchor = null;
    this._characters = new Map();
    this._inFixedUpdate = false;
    this._registeredVehicles = new Set();
    this._registeredWheels = new Set();
    this._vehicles = new Map();
    this._vehiclesDirty = false;
    this._appliedSettings = null;
    this._appliedSettingsVersion = -1;
    this._applySceneSettings();
    scene.on('afterupdate', this._onAfterUpdate, this);
    scene.on('dispose', this._onSceneDispose, this);
  }

  /** The scene this world simulates. */
  get scene() {
    return this._scene;
  }
  /** Gravity in m/s². Default (0, -9.81, 0). */
  get gravity(): Vector3 {
    return this._gravity;
  }
  set gravity(value: Vector3) {
    this._gravity.set(value);
    this._backend?.setGravity(this._gravity);
  }
  /** Length of one simulation step, in seconds. Default 1/60. */
  get fixedTimeStep() {
    return this._fixedTimeStep;
  }
  set fixedTimeStep(value: number) {
    this._fixedTimeStep = Math.max(1e-4, value);
  }
  /** Most simulation steps taken in one frame. Default 4. */
  get maxSubSteps() {
    return this._maxSubSteps;
  }
  set maxSubSteps(value: number) {
    this._maxSubSteps = Math.max(1, Math.floor(value));
  }
  /**
   * Whether dynamic bodies are drawn between their last two simulated poses.
   * Smooths motion when the frame rate differs from the step rate; turn off for
   * frame-exact capture. Default true.
   */
  get interpolation() {
    return this._interpolation;
  }
  set interpolation(value: boolean) {
    this._interpolation = !!value;
  }
  /** Whether this world steps on its own each frame; see also {@link PhysicsSimulation.simulationEnabled}. Default true. */
  get enabled() {
    return this._enabled;
  }
  set enabled(value: boolean) {
    this._enabled = !!value;
  }

  /**
   * Whether the simulation waits to start until every collider has its
   * geometry. Default true.
   *
   * @remarks
   * `mesh`, `convex` and `terrain` colliders may have to read their geometry
   * back from the GPU, which takes a few frames - how many depends on the
   * machine. Starting without them would let things fall before the ground is
   * there, differently on every run. With this on, the world takes no steps
   * until the colliders present when it first had anything to simulate are all
   * in; time does not run meanwhile. Colliders added after the simulation has
   * started only hold back their own rigid body.
   */
  get waitForCollidersOnStart() {
    return this._waitForCollidersOnStart;
  }
  set waitForCollidersOnStart(value: boolean) {
    this._waitForCollidersOnStart = !!value;
  }
  /**
   * Resolves once every collider waiting for its geometry has it (or failed to
   * get it). Starts reading geometry for colliders added since the last update.
   */
  async whenReady(): Promise<void> {
    for (;;) {
      if (this.disposed || !this._ensureBackend()) {
        return;
      }
      this._resolve();
      if (this._pendingPromises.size === 0) {
        return;
      }
      await Promise.allSettled([...this._pendingPromises]);
    }
  }

  // ------------------------------------------------------------------ layers

  /** Display names of the 16 collider layers, for tools. */
  get layerNames(): readonly string[] {
    return this._layerNames;
  }
  /** Whether colliders on layers `a` and `b` collide. All layers collide by default. */
  getLayerCollision(a: number, b: number) {
    return !!(this._layerMasks[this._layer(a)] & (1 << this._layer(b)));
  }
  /** Sets whether colliders on layers `a` and `b` collide; applies to both orders. */
  setLayerCollision(a: number, b: number, enabled: boolean) {
    a = this._layer(a);
    b = this._layer(b);
    if (this.getLayerCollision(a, b) === !!enabled) {
      return;
    }
    if (enabled) {
      this._layerMasks[a] |= 1 << b;
      this._layerMasks[b] |= 1 << a;
    } else {
      this._layerMasks[a] &= ~(1 << b);
      this._layerMasks[b] &= ~(1 << a);
    }
    for (const entry of this._colliders.values()) {
      const layer = entry.component.layer;
      if (layer === a || layer === b) {
        this._applyGroups(entry);
      }
    }
  }

  // ------------------------------------------------------------------ stepping

  /**
   * Advances the simulation by `dt` seconds of frame time.
   *
   * @remarks
   * Called automatically each frame while {@link PhysicsSimulation.enabled};
   * call it yourself with `enabled` off to drive the simulation manually.
   */
  update(dt: number) {
    if (this.disposed) {
      return;
    }
    this._applySceneSettings();
    if (!this._ensureBackend()) {
      return;
    }
    this._checkGeometry();
    for (const joint of this._retryJoints) {
      this._dirtyJoints.add(joint);
    }
    this._resolve();
    this._syncFromNodes();
    if (this._enablementDirty) {
      this._updateBodyEnablement();
    }
    if (!this._started && this._waitForCollidersOnStart && this._pending.size > 0) {
      // Time stands still until the starting colliders are in.
      return;
    }
    const fixed = this._fixedTimeStep;
    this._accumulator += Math.max(0, dt);
    let steps = Math.floor(this._accumulator / fixed + 1e-9);
    if (steps > this._maxSubSteps) {
      steps = this._maxSubSteps;
    }
    this._accumulator -= steps * fixed;
    // Time beyond maxSubSteps is dropped, not carried into later frames.
    if (this._accumulator >= fixed) {
      this._accumulator %= fixed;
    }
    if (steps > 0) {
      this._started = true;
    }
    for (let i = 0; i < steps; i++) {
      this._setKinematicTargets((i + 1) / steps);
      this._fixedUpdate(fixed);
      for (const entry of this._bodies.values()) {
        entry.component._applyStepInputs(entry.body);
      }
      this._updateVehicles(fixed);
      this._backend!.step(fixed, this._onCollision);
      this._captureDynamicPoses();
    }
    if (steps > 0) {
      for (const entry of this._bodies.values()) {
        entry.component._clearForces(entry.body);
      }
    }
    this._writeBack(this._interpolation ? this._accumulator / fixed : 1);
    this._writeWheels();
    // A frame without steps changes no contacts; diffing it would only see the
    // colliders rebuilt at its start as having let go.
    if (steps > 0) {
      this._dispatchContactEvents();
    }
  }

  // ------------------------------------------------------------------ queries

  /**
   * The nearest collider along a ray.
   *
   * @remarks
   * Like every query, sees the world as the last simulation step left it:
   * colliders added since, and nodes moved by scripts since, show up after the
   * next step. Querying never changes the simulation. A ray starting inside a
   * collider hits it at distance 0.
   *
   * @param origin - Start of the ray, world space.
   * @param direction - Direction of the ray; need not be normalized.
   * @param maxDistance - How far to look. Default: unlimited.
   */
  raycast(
    origin: Vector3,
    direction: Vector3,
    maxDistance = Infinity,
    options?: PhysicsQueryOptions
  ): PhysicsQueryHit | null {
    const dir = this._queryDirection(direction);
    if (!dir || !this._prepareQuery()) {
      return null;
    }
    const hit = this._backend!.castRay(
      origin,
      dir,
      this._queryDistance(maxDistance),
      this._queryFilter(options)
    );
    return hit ? this._rayHit(hit, origin, dir) : null;
  }
  /** Every collider along a ray, nearest first. See {@link PhysicsSimulation.raycast}. */
  raycastAll(
    origin: Vector3,
    direction: Vector3,
    maxDistance = Infinity,
    options?: PhysicsQueryOptions
  ): PhysicsQueryHit[] {
    const dir = this._queryDirection(direction);
    if (!dir || !this._prepareQuery()) {
      return [];
    }
    return this._backend!.castRayAll(
      origin,
      dir,
      this._queryDistance(maxDistance),
      this._queryFilter(options)
    ).map((hit) => this._rayHit(hit, origin, dir));
  }
  /**
   * Moves a shape along a direction and returns the first collider it would
   * touch, e.g. to see whether a character fits through a gap.
   *
   * @param shape - The shape, in world units.
   * @param position - Where the shape starts, world space.
   * @param rotation - The shape's orientation.
   * @param direction - Direction of travel; need not be normalized.
   * @param maxDistance - How far it travels. Default: unlimited.
   */
  shapeCast(
    shape: PhysicsShape,
    position: Vector3,
    rotation: Quaternion,
    direction: Vector3,
    maxDistance = Infinity,
    options?: PhysicsQueryOptions
  ): PhysicsQueryHit | null {
    const dir = this._queryDirection(direction);
    if (!dir || !this._prepareQuery()) {
      return null;
    }
    const hit = this._backend!.castShape(
      queryShapeDesc(shape),
      position,
      rotation,
      dir,
      this._queryDistance(maxDistance),
      this._queryFilter(options)
    );
    if (!hit) {
      return null;
    }
    const entry = this._byKey.get(hit.key)!;
    return {
      collider: entry.component,
      body: this._publicBody(entry),
      object: this._objectOf(entry),
      node: entry.component.node!,
      point: hit.point,
      normal: hit.normal,
      distance: hit.distance
    };
  }
  /** The colliders overlapping a shape placed in the world. */
  overlap(
    shape: PhysicsShape,
    position: Vector3,
    rotation: Quaternion,
    options?: PhysicsQueryOptions
  ): Collider[] {
    if (!this._prepareQuery()) {
      return [];
    }
    return this._backend!.overlapShape(
      queryShapeDesc(shape),
      position,
      rotation,
      this._queryFilter(options)
    ).map((key) => this._byKey.get(key)!.component);
  }
  /** The colliders containing a point. */
  overlapPoint(point: Vector3, options?: PhysicsQueryOptions): Collider[] {
    if (!this._prepareQuery()) {
      return [];
    }
    return this._backend!.overlapPoint(point, this._queryFilter(options)).map(
      (key) => this._byKey.get(key)!.component
    );
  }

  /** See {@link PhysicsWorld.getColliderOutline}. */
  getColliderOutline(target: Collider | CharacterController): Promise<ColliderOutline | null> {
    return getColliderOutline(target, () => this._engine.createWorld());
  }
  /** See {@link PhysicsWorld.getColliderOutlineKey}. */
  getColliderOutlineKey(target: Collider | CharacterController): string {
    return getColliderOutlineKey(target);
  }

  // ------------------------------------------------------------------ registration

  _registerBody(component: RigidBody) {
    this._registeredBodies.add(component);
    this._markBodyDirty(component);
  }
  _unregisterBody(component: RigidBody) {
    this._registeredBodies.delete(component);
    this._markBodyDirty(component);
  }
  _registerCollider(component: Collider) {
    this._registeredColliders.add(component);
    this._dirtyColliders.add(component);
  }
  _unregisterCollider(component: Collider) {
    this._registeredColliders.delete(component);
    this._dirtyColliders.add(component);
    this._pending.delete(component);
    this._failed.delete(component);
    this._enablementDirty = true;
    component._setStatus(false);
  }
  _registerJoint(component: Joint) {
    this._registeredJoints.add(component);
    this._dirtyJoints.add(component);
  }
  _unregisterJoint(component: Joint) {
    this._registeredJoints.delete(component);
    this._dirtyJoints.add(component);
    this._retryJoints.delete(component);
  }
  /** A joint's settings changed; it is rebuilt from scratch on the next update. */
  _markJointDirty(component: Joint) {
    this._jointFrames.delete(component);
    this._dirtyJoints.add(component);
  }
  _getJointHandle(component: Joint) {
    return this._joints.get(component)?.joint ?? null;
  }
  _applyJointLimits(component: Joint) {
    const joint = this._getJointHandle(component);
    if (!joint || !component.limitsEnabled) {
      return;
    }
    const toRad = Math.PI / 180;
    if (component.type === 'hinge') {
      joint.setLimits(component.lowerLimit * toRad, component.upperLimit * toRad);
    } else if (component.type === 'slider') {
      joint.setLimits(component.lowerLimit, component.upperLimit);
    } else if (component.type === 'ball') {
      joint.setBallLimits(component.twistLimit * toRad, component.swingLimit * toRad);
    }
  }
  _applyJointMotor(component: Joint) {
    const joint = this._getJointHandle(component);
    if (!joint) {
      return;
    }
    // Hinges take degrees; Rapier radians.
    const scale = component.type === 'hinge' ? Math.PI / 180 : 1;
    joint.setMotor(
      component.motorMode,
      component.motorTarget * scale,
      component.motorStiffness,
      component.motorDamping,
      component.motorMaxForce
    );
    this._joints.get(component)!.owner.body.wakeUp();
    this._joints.get(component)!.other?.body.wakeUp();
  }
  /** A hinge's angle in degrees or a slider's position in metres, from the bodies' poses. */
  _jointValue(component: Joint) {
    const entry = this._joints.get(component);
    if (!entry) {
      return 0;
    }
    // Measured like Rapier does: the owner's frame (second body) seen from the other's (first).
    const q1 = entry.other ? entry.other.curr.rotation : Quaternion.identity();
    const p1 = entry.other ? entry.other.curr.position : Vector3.zero();
    const q2 = entry.owner.curr.rotation;
    const p2 = entry.owner.curr.position;
    const w1 = Quaternion.multiply(q1, entry.otherFrame, new Quaternion());
    if (component.type === 'hinge') {
      const w2 = Quaternion.multiply(q2, entry.ownerFrame, new Quaternion());
      // A turn about X, twist only.
      const rel = Quaternion.multiply(Quaternion.inverse(w1, new Quaternion()), w2, new Quaternion());
      let angle = 2 * Math.atan2(rel.x, rel.w);
      if (angle > Math.PI) {
        angle -= 2 * Math.PI;
      } else if (angle < -Math.PI) {
        angle += 2 * Math.PI;
      }
      return (angle * 180) / Math.PI;
    }
    if (component.type === 'slider') {
      const a1 = Vector3.add(p1, q1.transform(entry.otherAnchor, new Vector3()), new Vector3());
      const a2 = Vector3.add(p2, q2.transform(entry.ownerAnchor, new Vector3()), new Vector3());
      const axis = w1.transform(Vector3.axisPX(), new Vector3());
      return Vector3.dot(Vector3.sub(a2, a1, new Vector3()), axis);
    }
    return 0;
  }
  _registerCharacter(component: CharacterController) {
    if (!this._characters.has(component)) {
      this._characters.set(component, null);
    }
  }
  _unregisterCharacter(component: CharacterController) {
    this._characters.get(component)?.dispose();
    this._characters.delete(component);
  }
  _configureCharacter(component: CharacterController) {
    this._characters.get(component)?.configure(component._settings());
  }
  /**
   * Moves a character as far as it can go towards `displacement`, and moves
   * its node there. Null when it is not simulated yet.
   */
  _moveCharacter(component: CharacterController, displacement: Vector3): CharacterMoveResult | null {
    if (this.disposed || !this._ensureBackend() || !this._characters.has(component)) {
      return null;
    }
    this._resolve();
    const bodyEntry = this._bodies.get(component._ownedBody);
    const colliderEntry = this._colliders.get(component._ownedCollider);
    if (!bodyEntry || !colliderEntry) {
      return null;
    }
    let controller = this._characters.get(component)!;
    if (!controller) {
      controller = this._backend!.createCharacter(component._settings());
      this._characters.set(component, controller);
    }
    const host = component.node!;
    const pose = readWorldPose(host, newPose());
    if (!matrixEquals(bodyEntry.lastMatrix, host)) {
      // Moved by something else since: start from where the node is.
      this._teleport(bodyEntry, pose);
    }
    const ownKey = colliderEntry.key;
    const layer = component.layer;
    const result = controller.move(colliderEntry.collider, displacement, (key) => {
      const entry = this._byKey.get(key);
      return (
        !!entry &&
        key !== ownKey &&
        entry.owner !== bodyEntry &&
        this.getLayerCollision(layer, entry.component.layer)
      );
    });
    pose.position.addBy(result.movement);
    host.setWorldPose(pose.position, pose.rotation);
    this._teleport(bodyEntry, pose);
    let groundNormal: Vector3 | null = null;
    const collisions = [];
    for (const hit of result.hits) {
      const entry = this._byKey.get(hit.key);
      if (!entry) {
        continue;
      }
      collisions.push({
        collider: entry.component,
        node: entry.component.node!,
        point: hit.point,
        normal: hit.normal
      });
      if (result.grounded && (!groundNormal || hit.normal.y > groundNormal.y)) {
        groundNormal = hit.normal;
      }
    }
    if (result.grounded && !groundNormal) {
      groundNormal = Vector3.axisPY();
    }
    return { movement: result.movement, grounded: result.grounded, groundNormal, collisions };
  }
  _registerVehicle(component: Vehicle) {
    this._registeredVehicles.add(component);
    this._vehiclesDirty = true;
  }
  _unregisterVehicle(component: Vehicle) {
    this._registeredVehicles.delete(component);
    this._vehiclesDirty = true;
  }
  _registerWheel(component: Wheel) {
    this._registeredWheels.add(component);
    this._vehiclesDirty = true;
  }
  _unregisterWheel(component: Wheel) {
    this._registeredWheels.delete(component);
    this._restoreWheel(component);
    this._vehiclesDirty = true;
  }
  /** A vehicle or wheel setting changed; vehicles are rebuilt on the next update. */
  _markVehiclesDirty() {
    this._vehiclesDirty = true;
  }
  _vehicleSpeed(component: Vehicle) {
    const entry = this._vehicles.get(component);
    if (!entry) {
      return 0;
    }
    const v = entry.owner.body.getLinearVelocity(new Vector3());
    const front = entry.owner.body.getRotation(new Quaternion()).transform(entry.forward, new Vector3());
    return Vector3.dot(v, front);
  }
  _vehicleWheels(component: Vehicle): readonly Wheel[] {
    return this._vehicles.get(component)?.wheels ?? [];
  }
  _colliderNodeByKey(key: number) {
    return key < 0 ? null : (this._byKey.get(key)?.component.node ?? null);
  }

  /** A body's settings changed; it is rebuilt on the next update. */
  _markBodyDirty(component: RigidBody) {
    this._dirtyBodies.add(component);
    // Vehicles hold their chassis body.
    this._vehiclesDirty = true;
    // Joints on it, or whose ends may now resolve to a different body.
    const root = component.node;
    for (const joint of this._registeredJoints) {
      const entry = this._joints.get(joint);
      if (
        entry?.owner.component === component ||
        entry?.other?.component === component ||
        (root && isUnder(joint.node, root)) ||
        (root && isUnder(joint.connectedBody, root))
      ) {
        this._dirtyJoints.add(joint);
      }
    }
    // Colliders below may now belong to a different body.
    component.node?.iterate((node) => {
      for (const c of this._registeredColliders) {
        if (c.node === node) {
          this._dirtyColliders.add(c);
        }
      }
    });
    for (const entry of this._colliders.values()) {
      if (entry.owner?.component === component) {
        this._dirtyColliders.add(entry.component);
      }
    }
  }
  /** A collider's settings changed. */
  _markColliderDirty(component: Collider) {
    this._dirtyColliders.add(component);
  }
  /** A collider's layer changed. */
  _updateColliderGroups(component: Collider) {
    const entry = this._colliders.get(component);
    if (entry) {
      this._applyGroups(entry);
    }
  }
  _getBodyHandle(component: RigidBody): BackendBody | null {
    return this._bodies.get(component)?.body ?? null;
  }

  // ------------------------------------------------------------------ internals

  private _ensureBackend() {
    if (!this._backend) {
      if (!this._engine.ready) {
        return false;
      }
      this._backend = this._engine.createWorld();
      this._backend.setGravity(this._gravity);
    }
    return true;
  }

  private _layer(layer: number) {
    return Math.min(LAYER_COUNT - 1, Math.max(0, Math.floor(layer)));
  }

  /** Rapier's packed groups: membership in the high 16 bits, filter in the low 16. */
  private _groups(layer: number) {
    return (((1 << layer) << 16) | this._layerMasks[layer]) >>> 0;
  }

  private _applyGroups(entry: ColliderEntry) {
    this._backend!.setColliderGroups(entry.collider, this._groups(entry.component.layer));
    // Bodies resting on something they may now pass through would otherwise
    // sleep on, held up by a contact that no longer counts.
    entry.owner?.body.wakeUp();
  }

  /** Brings backend bodies and colliders in line with the components, in scene order. */
  private _resolve() {
    if (
      this._dirtyBodies.size === 0 &&
      this._dirtyColliders.size === 0 &&
      this._dirtyJoints.size === 0 &&
      !this._vehiclesDirty
    ) {
      return;
    }
    const backend = this._backend!;
    const rebuildVehicles = this._vehiclesDirty;
    if (rebuildVehicles) {
      // Before their chassis bodies may go.
      for (const entry of this._vehicles.values()) {
        entry.vehicle.dispose();
      }
      this._vehicles.clear();
      this._vehiclesDirty = false;
    }
    // Joints go first, while both their bodies still exist.
    for (const j of this._dirtyJoints) {
      const entry = this._joints.get(j);
      if (entry) {
        backend.removeJoint(entry.joint);
        this._joints.delete(j);
      }
    }
    // Colliders first leave their bodies, so removing a body never takes a
    // collider that is about to be rebuilt with it.
    for (const c of this._dirtyColliders) {
      this._removeCollider(c);
    }
    for (const b of this._dirtyBodies) {
      const entry = this._bodies.get(b);
      if (entry) {
        // Its colliders were all marked dirty with it, and are gone by now.
        backend.removeBody(entry.body);
        this._bodies.delete(b);
      }
    }
    // Create in scene tree order, and in a fixed order on each node, which does
    // not depend on the order parts were added or loaded in: part of keeping
    // the simulation reproducible.
    const order: unknown[] = [];
    this._scene.rootNode.iterate((node) => {
      if (node.physics) {
        for (const part of partsOf(node.physics)) {
          if (
            (this._dirtyBodies.has(part as RigidBody) && this._registeredBodies.has(part as RigidBody)) ||
            (this._dirtyColliders.has(part as Collider) && this._registeredColliders.has(part as Collider)) ||
            (this._dirtyJoints.has(part as Joint) && this._registeredJoints.has(part as Joint))
          ) {
            order.push(part);
          }
        }
      }
    });
    this._dirtyBodies.clear();
    this._dirtyColliders.clear();
    this._dirtyJoints.clear();
    for (const component of order) {
      if (this._registeredBodies.has(component as RigidBody)) {
        this._createBody(component as RigidBody);
      }
    }
    for (const component of order) {
      if (this._registeredColliders.has(component as Collider)) {
        this._createCollider(component as Collider);
      }
    }
    for (const component of order) {
      if (this._registeredJoints.has(component as Joint)) {
        this._createJoint(component as Joint);
      }
    }
    if (rebuildVehicles) {
      this._createVehicles();
    }
    this._updateBodyEnablement();
  }

  /** Builds every vehicle, in scene order, with the wheels below it. */
  private _createVehicles() {
    const claimed = new Set<Wheel>();
    const vehicles: Vehicle[] = [];
    this._scene.rootNode.iterate((node) => {
      const vehicle = node.physics?.vehicle;
      if (vehicle && this._registeredVehicles.has(vehicle)) {
        vehicles.push(vehicle);
      }
    });
    for (const vehicle of vehicles) {
      this._createVehicle(vehicle, claimed);
    }
    for (const wheel of this._registeredWheels) {
      if (!claimed.has(wheel)) {
        wheel._setError('A wheel needs a Vehicle on a node above it, with no other rigid body in between');
        this._restoreWheel(wheel);
      }
    }
  }

  private _createVehicle(component: Vehicle, claimed: Set<Wheel>) {
    const host = component.node!;
    const body = host.physics?.body;
    const owner = body ? (this._bodies.get(body) ?? null) : null;
    if (!owner || owner.component.motionType !== 'dynamic') {
      component._setError('A vehicle needs a dynamic RigidBody on its node');
      return;
    }
    // Its wheels: below it, owned by its body, and not under a nearer vehicle.
    const wheels: Wheel[] = [];
    host.iterate((node) => {
      if (node === host) {
        return false;
      }
      const wheel = node.physics?.wheel;
      if (
        wheel &&
        this._registeredWheels.has(wheel) &&
        !claimed.has(wheel) &&
        this._findOwner(node) === owner
      ) {
        wheels.push(wheel);
      }
      return false;
    });
    if (wheels.length === 0) {
      component._setError('A vehicle needs wheels on nodes below it');
      return;
    }
    const bodyPose = readWorldPose(host, newPose());
    const invBody = Quaternion.inverse(bodyPose.rotation, new Quaternion());
    const up = Vector3.axisPY();
    const forward = component._forwardVector();
    const axle = Vector3.cross(forward, up, new Vector3());
    const spinAxis = Vector3.cross(up, forward, new Vector3());
    const down = new Vector3(0, -1, 0);
    const hardPoints: Vector3[] = [];
    const restRotations: Quaternion[] = [];
    const descs = wheels.map((wheel) => {
      claimed.add(wheel);
      wheel._setError('');
      const node = wheel.node!;
      if (!wheel._rest || wheel._restNode !== node) {
        wheel._rest = { position: node.position.clone(), rotation: node.rotation.clone() };
        wheel._restNode = node;
      }
      // The wheel's rest pose in world space, then in the chassis body's space.
      const parent = node.parent;
      const center = parent
        ? parent.worldMatrix.transformPointAffine(wheel._rest.position, new Vector3())
        : wheel._rest.position.clone();
      const parentRot = new Quaternion();
      parent?.worldMatrix.decompose(null, parentRot, null);
      const worldRot = Quaternion.multiply(parentRot, wheel._rest.rotation, new Quaternion());
      const centerCs = invBody.transform(Vector3.sub(center, bodyPose.position), new Vector3());
      const hard = new Vector3(centerCs.x, centerCs.y + wheel.suspensionRestLength, centerCs.z);
      hardPoints.push(hard);
      restRotations.push(Quaternion.multiply(invBody, worldRot, new Quaternion()));
      wheel._state.suspensionLength = wheel.suspensionRestLength;
      wheel._state.rotation = 0;
      wheel._state.steering = 0;
      wheel._state.inContact = false;
      wheel._state.groundKey = -1;
      return {
        connection: hard,
        direction: down,
        axle,
        restLength: wheel.suspensionRestLength,
        radius: wheel.radius,
        stiffness: wheel.suspensionStiffness,
        compression: wheel.suspensionCompression,
        relaxation: wheel.suspensionRelaxation,
        maxTravel: wheel.maxSuspensionTravel,
        maxForce: wheel.maxSuspensionForce,
        frictionSlip: wheel.frictionSlip,
        sideFriction: wheel.sideFriction
      };
    });
    const forwardAxis = forward.x !== 0 ? 0 : 2;
    const vehicle = this._backend!.createVehicle(owner.body, forwardAxis, descs);
    component._setError('');
    this._vehicles.set(component, {
      component,
      owner,
      vehicle,
      wheels,
      hardPoints,
      restRotations,
      forward,
      spinAxis
    });
  }

  /** Gives a wheel node back the pose it had before a vehicle moved it. */
  private _restoreWheel(wheel: Wheel) {
    const node = wheel._restNode;
    if (wheel._rest && node && node === wheel.node) {
      node.position.set(wheel._rest.position);
      node.rotation.set(wheel._rest.rotation);
    }
    wheel._rest = null;
    wheel._restNode = null;
  }

  /** Hands the inputs to the wheels and lets them push the chassis, before a step. */
  private _updateVehicles(dt: number) {
    const toRad = Math.PI / 180;
    for (const entry of this._vehicles.values()) {
      if (entry.owner.disabled) {
        continue;
      }
      const v = entry.component;
      let active = v._hasInput();
      entry.wheels.forEach((wheel, i) => {
        const engine = v.throttle * v.maxEngineForce * wheel.drive + wheel.engineForce;
        const brake =
          v.brake * v.maxBrakeForce * wheel.brake +
          (v.handbrake ? v.maxHandbrakeForce * wheel.handbrake : 0) +
          wheel.brakeForce;
        const steer = (v.steering * v.maxSteerAngle * wheel.steer + wheel.steerAngle) * toRad;
        active ||= wheel.engineForce !== 0 || wheel.brakeForce !== 0 || wheel.steerAngle !== 0;
        // Rapier takes the brake as the most impulse per step.
        entry.vehicle.setWheelInput(i, engine, Math.max(0, brake) * dt, steer);
      });
      if (active) {
        entry.owner.body.wakeUp();
      } else if (entry.owner.body.isSleeping()) {
        // A resting car stays as it was. Updating would push a body that does
        // not move: the pushes pile up as velocity it never takes, which the
        // dampers then read as motion and the suspension lets go.
        continue;
      }
      const layer = v.layer;
      entry.vehicle.update(dt, (key) => {
        const c = this._byKey.get(key)?.component;
        return !!c && !c.isTrigger && this.getLayerCollision(layer, c.layer);
      });
      entry.wheels.forEach((wheel, i) => entry.vehicle.wheelState(i, wheel._state));
    }
  }

  /** Places the wheel nodes on the drawn chassis: suspension, steering and roll. */
  private _writeWheels() {
    const pose = newPose();
    const up = Vector3.axisPY();
    const steer = new Quaternion();
    const spin = new Quaternion();
    const rot = new Quaternion();
    const center = new Vector3();
    for (const entry of this._vehicles.values()) {
      readWorldPose(entry.component.node!, pose);
      entry.wheels.forEach((wheel, i) => {
        const s = wheel._state;
        const hard = entry.hardPoints[i];
        center.setXYZ(hard.x, hard.y - s.suspensionLength, hard.z);
        Quaternion.fromAxisAngle(up, s.steering, steer);
        Quaternion.fromAxisAngle(entry.spinAxis, s.rotation, spin);
        Quaternion.multiply(steer, spin, rot).multiplyRight(entry.restRotations[i]);
        const worldPos = Vector3.add(
          pose.position,
          pose.rotation.transform(center, new Vector3()),
          new Vector3()
        );
        const worldRot = Quaternion.multiply(pose.rotation, rot, new Quaternion());
        wheel.node!.setWorldPose(worldPos, worldRot);
      });
    }
  }

  private _createJoint(component: Joint) {
    this._retryJoints.delete(component);
    const host = component.node!;
    const owner = this._findOwner(host);
    if (!owner) {
      this._failJoint(component, 'A joint needs a rigid body on its node or on a node above it', true);
      return;
    }
    let other: BodyEntry | null = null;
    if (component.connectedBodyId) {
      const node = component.connectedBody;
      if (!node) {
        this._failJoint(component, 'The connected node is not in the scene', true);
        return;
      }
      other = this._findOwner(node);
      if (!other) {
        this._failJoint(component, 'The connected node has no rigid body on it or above it', true);
        return;
      }
      if (other === owner) {
        this._failJoint(component, 'Both ends of the joint are the same rigid body', false);
        return;
      }
    }
    let frames = this._jointFrames.get(component);
    if (!frames || frames.owner !== owner.component || frames.other !== (other?.component ?? null)) {
      frames = this._computeJointFrames(component, owner, other);
      this._jointFrames.set(component, frames);
    }
    if (!other && !this._worldAnchor) {
      this._worldAnchor = this._backend!.createBody({
        motionType: 'static',
        position: Vector3.zero(),
        rotation: Quaternion.identity(),
        mass: 0,
        linearDamping: 0,
        angularDamping: 0,
        gravityScale: 1,
        ccd: false,
        canSleep: true,
        translationAxes: [true, true, true],
        rotationAxes: [true, true, true]
      });
    }
    // Rapier measures the second body relative to the first, so the joint's own
    // body goes second: its angle is how it turned relative to the other end.
    const joint = this._backend!.createJoint(
      {
        type: component.type,
        anchor1: frames.otherAnchor,
        frame1: frames.otherFrame,
        anchor2: frames.ownerAnchor,
        frame2: frames.ownerFrame,
        length: component.length,
        stiffness: component.stiffness,
        damping: component.damping,
        collideConnected: component.collideConnected
      },
      other ? other.body : this._worldAnchor!,
      owner.body
    );
    this._joints.set(component, {
      component,
      joint,
      owner,
      other,
      ownerFrame: frames.ownerFrame,
      otherFrame: frames.otherFrame,
      ownerAnchor: frames.ownerAnchor,
      otherAnchor: frames.otherAnchor
    });
    component._setError('');
    this._applyJointLimits(component);
    this._applyJointMotor(component);
  }

  /**
   * The joint's frame - pivot at its node's origin moved by the anchor, X axis
   * along its axis - in each body's local space, from where they all are now.
   * A rope or spring is tied to the other body at the connected anchor instead.
   */
  private _computeJointFrames(component: Joint, owner: BodyEntry, other: BodyEntry | null): JointFrames {
    const host = component.node!;
    const nodePose = readWorldPose(host, newPose());
    const pivot = host.worldMatrix.transformPointAffine(component.anchor, new Vector3());
    const axis = component.axis.magnitude > 1e-9 ? Vector3.normalize(component.axis) : Vector3.axisPY();
    const q = Quaternion.multiply(
      nodePose.rotation,
      Quaternion.unitVectorToUnitVector(Vector3.axisPX(), axis),
      new Quaternion()
    );
    const twoPoint = component.type === 'rope' || component.type === 'spring';
    const otherNode = other ? other.component.node! : null;
    const otherPoint = !twoPoint
      ? pivot
      : otherNode
        ? otherNode.worldMatrix.transformPointAffine(component.connectedAnchor, new Vector3())
        : component.connectedAnchor.clone();
    const local = (bodyPose: Pose | null, point: Vector3) => {
      if (!bodyPose) {
        // The world anchor sits at the origin, unrotated.
        return { anchor: point.clone(), frame: q.clone() };
      }
      const inv = Quaternion.inverse(bodyPose.rotation, new Quaternion());
      return {
        anchor: inv.transform(Vector3.sub(point, bodyPose.position, new Vector3()), new Vector3()),
        frame: Quaternion.multiply(inv, q, new Quaternion())
      };
    };
    const lo = local(readWorldPose(owner.component.node!, newPose()), pivot);
    const lt = local(other ? readWorldPose(other.component.node!, newPose()) : null, otherPoint);
    return {
      owner: owner.component,
      other: other?.component ?? null,
      ownerAnchor: lo.anchor,
      ownerFrame: lo.frame,
      otherAnchor: lt.anchor,
      otherFrame: lt.frame
    };
  }

  private _failJoint(component: Joint, message: string, retry: boolean) {
    if (component.error !== message) {
      console.error(`Joint on '${component.node?.name ?? ''}': ${message}`);
    }
    component._setError(message);
    if (retry) {
      this._retryJoints.add(component);
    }
  }

  /** Puts a body where `pose` says, at once, with nothing interpolated or swept. */
  private _teleport(entry: BodyEntry, pose: Pose) {
    entry.body.setPose(pose.position, pose.rotation);
    copyPose(entry.curr, pose);
    copyPose(entry.prev, pose);
    copyPose(entry.kinematicFrom, pose);
    storeMatrix(entry.lastMatrix, entry.component.node!);
    this._backend!.syncColliders();
  }

  private _createBody(component: RigidBody) {
    const host = component.node!;
    const pose = readWorldPose(host, newPose());
    const body = this._backend!.createBody({
      motionType: component.motionType,
      position: pose.position,
      rotation: pose.rotation,
      mass: component.mass,
      linearDamping: component.linearDamping,
      angularDamping: component.angularDamping,
      gravityScale: component.gravityScale,
      ccd: component.ccd,
      canSleep: component.canSleep,
      translationAxes: component._translationAxes(),
      rotationAxes: component._rotationAxes()
    });
    const entry: BodyEntry = {
      component,
      body,
      prev: pose,
      curr: { position: pose.position.clone(), rotation: pose.rotation.clone() },
      kinematicFrom: { position: pose.position.clone(), rotation: pose.rotation.clone() },
      lastMatrix: new Float32Array(16),
      settled: false,
      disabled: false
    };
    storeMatrix(entry.lastMatrix, host);
    component._applyPendingVelocities(body);
    this._bodies.set(component, entry);
  }

  /** The nearest registered rigid body at or above `node`. */
  private _findOwner(node: SceneNode): BodyEntry | null {
    for (let n: SceneNode | null = node; n; n = n.parent) {
      const body = rigidBodyOf(n.physics);
      const entry = body ? this._bodies.get(body) : undefined;
      if (entry) {
        return entry;
      }
    }
    return null;
  }

  private _createCollider(component: Collider) {
    const backend = this._backend!;
    const host = component.node!;
    let geometry: ColliderGeometry | null = null;
    if (needsGeometry(component)) {
      geometry = this._geometryFor(component);
      if (!geometry) {
        return;
      }
    }
    const owner = this._findOwner(host);
    if (component.shape === 'terrain' && owner) {
      this._fail(component, null, 'A terrain collider cannot belong to a rigid body');
      return;
    }
    if (
      component.shape === 'mesh' &&
      owner?.component.motionType === 'dynamic' &&
      !component._warnedDynamicMesh
    ) {
      component._warnedDynamicMesh = true;
      console.warn(
        `Collider on '${host.name}': a mesh collider on a dynamic rigid body has no volume and gets pushed into things; use 'convex' instead.`
      );
    }
    const built = buildColliderShape(component, geometry);
    if ('error' in built) {
      this._fail(component, null, built.error);
      return;
    }
    const { shape } = built;
    const colliderPose: Pose = { position: built.position, rotation: built.rotation };
    const material = {
      friction: component.friction,
      restitution: component.restitution,
      isTrigger: component.isTrigger,
      groups: this._groups(component.layer)
    };
    let implicitBody: BackendBody | null = null;
    let body: BackendBody;
    let localPos: Vector3;
    let localRot: Quaternion;
    if (owner) {
      // Relative to the owner's node: rotate the offset into the body's frame.
      const bodyPose = readWorldPose(owner.component.node!, tmpPose2);
      const inv = Quaternion.inverse(bodyPose.rotation, tmpQuat);
      localPos = inv.transform(Vector3.sub(colliderPose.position, bodyPose.position), new Vector3());
      localRot = Quaternion.multiply(inv, colliderPose.rotation, new Quaternion());
      body = owner.body;
    } else {
      implicitBody = backend.createBody({
        motionType: 'static',
        position: colliderPose.position,
        rotation: colliderPose.rotation,
        mass: 0,
        linearDamping: 0,
        angularDamping: 0,
        gravityScale: 1,
        ccd: false,
        canSleep: true,
        translationAxes: [true, true, true],
        rotationAxes: [true, true, true]
      });
      body = implicitBody;
      localPos = Vector3.zero();
      localRot = Quaternion.identity();
    }
    const collider = backend.createCollider(body, shape, localPos, localRot, material);
    if (!collider) {
      if (implicitBody) {
        backend.removeBody(implicitBody);
      }
      this._fail(component, null, CONVEX_HULL_ERROR);
      return;
    }
    const lastMatrix = new Float32Array(16);
    storeMatrix(lastMatrix, host);
    const entry: ColliderEntry = {
      component,
      owner,
      implicitBody,
      collider,
      key: backend.colliderKey(collider),
      lastMatrix
    };
    this._colliders.set(component, entry);
    this._byKey.set(entry.key, entry);
    this._failed.delete(component);
    // A collider joining a body changes its inertia; wake it so it notices.
    owner?.body.wakeUp();
    component._setStatus(true);
  }

  /**
   * The geometry a collider should be built from, or null while it is being
   * read or if it cannot be had.
   */
  private _geometryFor(component: Collider): ColliderGeometry | null {
    let source: GeometrySource;
    try {
      source = geometrySource(component);
    } catch (err) {
      this._fail(component, null, err);
      return null;
    }
    if (geometryMatches(component._geometry as ColliderGeometry | null, source)) {
      return component._geometry as ColliderGeometry;
    }
    const pending = this._pending.get(component);
    if (pending && sameSource(pending.source, source)) {
      return null;
    }
    let result: ColliderGeometry | Promise<ColliderGeometry>;
    try {
      result = fetchGeometry(component, source);
    } catch (err) {
      this._fail(component, source, err);
      return null;
    }
    if (!(result instanceof Promise)) {
      this._pending.delete(component);
      component._geometry = result;
      return result;
    }
    const generation = ++this._geometryGeneration;
    this._pending.set(component, { source, generation });
    component._setStatus(false);
    const latest = () => this._pending.get(component)?.generation === generation;
    const promise: Promise<void> = result
      .then(
        (geometry) => {
          if (latest()) {
            this._pending.delete(component);
            component._geometry = geometry;
            if (!this.disposed && component.world === this) {
              this._dirtyColliders.add(component);
            }
          }
        },
        (err) => {
          if (latest()) {
            this._pending.delete(component);
            this._fail(component, source, err);
          }
        }
      )
      .finally(() => {
        this._pendingPromises.delete(promise);
      });
    this._pendingPromises.add(promise);
    return null;
  }

  private _fail(component: Collider, source: GeometrySource | null, err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (component.error !== message) {
      console.error(`Collider on '${component.node?.name ?? ''}': ${message}`);
    }
    component._geometry = null;
    component._setStatus(false, message);
    this._failed.set(component, source);
    this._enablementDirty = true;
  }

  /** Rebuilds colliders whose mesh or terrain changed since they were built. */
  private _checkGeometry() {
    for (const component of this._registeredColliders) {
      if (!needsGeometry(component) || this._pending.has(component) || this._dirtyColliders.has(component)) {
        continue;
      }
      let source: GeometrySource | null;
      try {
        source = geometrySource(component);
      } catch {
        source = null;
      }
      if (this._failed.has(component)) {
        const failed = this._failed.get(component)!;
        if (source === null || failed === null || sameSource(failed, source)) {
          // Still failing for the same reason; a property change retries it.
          continue;
        }
      } else if (source && geometryMatches(component._geometry as ColliderGeometry | null, source)) {
        continue;
      }
      this._dirtyColliders.add(component);
    }
  }

  /** Keeps rigid bodies out of the simulation while any of their colliders waits. */
  private _updateBodyEnablement() {
    this._enablementDirty = false;
    const blocked = new Set<BodyEntry>();
    for (const component of this._pending.keys()) {
      const owner = component.node ? this._findOwner(component.node) : null;
      if (owner) {
        blocked.add(owner);
      }
    }
    for (const entry of this._bodies.values()) {
      const disabled = blocked.has(entry);
      if (disabled !== entry.disabled) {
        entry.disabled = disabled;
        entry.body.setEnabled(!disabled);
      }
    }
  }

  private _removeCollider(component: Collider) {
    const entry = this._colliders.get(component);
    if (!entry) {
      return;
    }
    if (entry.implicitBody) {
      // Removing the body removes its collider with it.
      this._backend!.removeBody(entry.implicitBody);
    } else if (this._bodies.get(entry.owner!.component) === entry.owner) {
      this._backend!.removeCollider(entry.collider);
    }
    // Its contacts end here. The backend reports them ending too, but under a
    // key that no longer maps to anything; if the collider is rebuilt, the
    // contacts start again in the next step and the frame diff sees no change.
    const pairs = this._touchingByKey.get(entry.key);
    if (pairs) {
      for (const pk of pairs) {
        this._forgetPair(pk);
      }
    }
    this._colliders.delete(component);
    this._byKey.delete(entry.key);
  }

  /** Picks up nodes moved by anything other than the simulation. */
  private _syncFromNodes() {
    for (const entry of this._bodies.values()) {
      const host = entry.component.node!;
      if (entry.component.motionType === 'kinematic') {
        // Followed every step: see _setKinematicTargets.
        continue;
      }
      if (!matrixEquals(entry.lastMatrix, host)) {
        readWorldPose(host, entry.curr);
        entry.body.setPose(entry.curr.position, entry.curr.rotation);
        copyPose(entry.prev, entry.curr);
        entry.settled = false;
        storeMatrix(entry.lastMatrix, host);
      }
    }
    for (const entry of this._colliders.values()) {
      if (entry.implicitBody && !matrixEquals(entry.lastMatrix, entry.component.node!)) {
        // A moved static collider: rebuild it, its scale may have changed too.
        this._dirtyColliders.add(entry.component);
      }
    }
    if (this._dirtyColliders.size > 0) {
      this._resolve();
    }
  }

  /** Raises `fixedupdate` and calls the scripts' `onFixedUpdate` before a step. */
  private _fixedUpdate(dt: number) {
    this._inFixedUpdate = true;
    try {
      this.dispatchEvent('fixedupdate', dt);
      const scene = this._scene;
      tryGetApp()?.engine?.fixedUpdate(
        dt,
        (host) => host === scene || (host instanceof SceneNode && host.scene === scene)
      );
    } finally {
      this._inFixedUpdate = false;
    }
  }

  /** Moves kinematic bodies a fraction `t` of the way to their node's pose. */
  private _setKinematicTargets(t: number) {
    for (const entry of this._bodies.values()) {
      if (entry.component.motionType !== 'kinematic') {
        continue;
      }
      const target = readWorldPose(entry.component.node!, tmpPose);
      const from = entry.kinematicFrom;
      const p = Vector3.combine(from.position, target.position, 1 - t, t, tmpVec);
      const q = Quaternion.slerp(from.rotation, target.rotation, t, tmpQuat);
      entry.body.setKinematicTarget(p, q);
      if (t >= 1) {
        copyPose(from, target);
      }
    }
  }

  private _captureDynamicPoses() {
    for (const entry of this._bodies.values()) {
      if (entry.component.motionType !== 'dynamic') {
        continue;
      }
      copyPose(entry.prev, entry.curr);
      entry.body.getPosition(entry.curr.position);
      entry.body.getRotation(entry.curr.rotation);
    }
  }

  /** Writes dynamic bodies back to their nodes, `alpha` of the way from the previous step. */
  private _writeBack(alpha: number) {
    for (const entry of this._bodies.values()) {
      if (entry.component.motionType !== 'dynamic') {
        continue;
      }
      const sleeping = entry.body.isSleeping();
      if (sleeping && entry.settled) {
        continue;
      }
      const host = entry.component.node!;
      if (sleeping) {
        host.setWorldPose(entry.curr.position, entry.curr.rotation);
        entry.settled = true;
      } else {
        const p = Vector3.combine(entry.prev.position, entry.curr.position, 1 - alpha, alpha, tmpVec);
        const q = Quaternion.slerp(entry.prev.rotation, entry.curr.rotation, alpha, tmpQuat);
        host.setWorldPose(p, q);
        entry.settled = false;
      }
      storeMatrix(entry.lastMatrix, host);
    }
  }

  // ------------------------------------------------------------------ contacts

  /** Collider pairs starting or stopping, reported by the backend after each step. */
  private readonly _onCollision = (key1: number, key2: number, started: boolean) => {
    const e1 = this._byKey.get(key1);
    const e2 = this._byKey.get(key2);
    if (!e1 || !e2) {
      // A collider removed since: its pairs were already forgotten.
      return;
    }
    const pk = key1 < key2 ? `${key1}|${key2}` : `${key2}|${key1}`;
    if (!started) {
      this._forgetPair(pk);
      return;
    }
    this._touching.set(pk, [e1, e2]);
    for (const key of [key1, key2]) {
      let set = this._touchingByKey.get(key);
      if (!set) {
        set = new Set();
        this._touchingByKey.set(key, set);
      }
      set.add(pk);
    }
    const pair = this._objectPair(e1, e2);
    if (pair && !this._startedThisFrame.has(pair.key)) {
      this._startedThisFrame.set(pair.key, pair);
    }
  };

  private _forgetPair(pk: string) {
    if (!this._touching.delete(pk)) {
      return;
    }
    const sep = pk.indexOf('|');
    for (const key of [Number(pk.slice(0, sep)), Number(pk.slice(sep + 1))]) {
      const set = this._touchingByKey.get(key);
      if (set) {
        set.delete(pk);
        if (set.size === 0) {
          this._touchingByKey.delete(key);
        }
      }
    }
  }

  /**
   * The object a collider raises events on: the physics data of its rigid
   * body's node (a character's node for its capsule), or of its own node.
   */
  private _objectOf(entry: ColliderEntry): NodePhysics {
    return (entry.owner ? entry.owner.component.node : entry.component.node)!.physics!;
  }

  /** The rigid body a user sees a collider belonging to: not a character's own. */
  private _publicBody(entry: ColliderEntry): RigidBody | null {
    const owner = entry.owner?.component ?? null;
    return owner?.owner ? owner : null;
  }

  private _objectPair(e1: ColliderEntry, e2: ColliderEntry): ObjectPair | null {
    const c1 = e1.component;
    const c2 = e2.component;
    let a = this._objectOf(e1);
    let b = this._objectOf(e2);
    if (a === b) {
      return null;
    }
    let colliderA = c1;
    let colliderB = c2;
    if (a._physicsId > b._physicsId) {
      [a, b, colliderA, colliderB] = [b, a, c2, c1];
    }
    const trigger = c1.isTrigger || c2.isTrigger;
    return {
      key: `${a._physicsId}|${b._physicsId}|${trigger ? 't' : 'c'}`,
      a,
      b,
      colliderA,
      colliderB,
      trigger
    };
  }

  /** Compares this frame's touching objects with the last frame's and raises events. */
  private _dispatchContactEvents() {
    const current = new Map<string, ObjectPair>();
    for (const [e1, e2] of this._touching.values()) {
      const pair = this._objectPair(e1, e2);
      if (pair && !current.has(pair.key)) {
        current.set(pair.key, pair);
      }
    }
    const enters: ObjectPair[] = [];
    const stays: ObjectPair[] = [];
    const exits: ObjectPair[] = [];
    for (const [key, pair] of current) {
      (this._lastPairs.has(key) ? stays : enters).push(pair);
    }
    // Touched and let go within this frame's steps: still worth an enter and exit.
    for (const [key, pair] of this._startedThisFrame) {
      if (!current.has(key) && !this._lastPairs.has(key)) {
        enters.push(pair);
        exits.push(pair);
      }
    }
    for (const [key, pair] of this._lastPairs) {
      if (!current.has(key)) {
        exits.push(pair);
      }
    }
    this._lastPairs = current;
    this._startedThisFrame.clear();
    for (const pair of enters) {
      this._dispatchPair(pair, pair.trigger ? 'triggerenter' : 'collisionenter', true);
    }
    for (const pair of stays) {
      if (!pair.trigger) {
        this._dispatchPair(pair, 'collisionstay', true);
      }
    }
    for (const pair of exits) {
      this._dispatchPair(pair, pair.trigger ? 'triggerexit' : 'collisionexit', false);
    }
  }

  private _dispatchPair(pair: ObjectPair, type: keyof PhysicsEventMap, withContacts: boolean) {
    this._dispatchTo(pair.a, pair.b, pair.colliderA, pair.colliderB, type, withContacts, false);
    this._dispatchTo(pair.b, pair.a, pair.colliderB, pair.colliderA, type, withContacts, true);
  }

  private _dispatchTo(
    self: NodePhysics,
    other: NodePhysics,
    collider: Collider,
    otherCollider: Collider,
    type: keyof PhysicsEventMap,
    withContacts: boolean,
    flip: boolean
  ) {
    // Objects that left the world get nothing: their side of the contact is gone.
    if (
      self.disposed ||
      self.node?.scene !== this._scene ||
      !self.node.attached ||
      !self._hasListeners(type)
    ) {
      return;
    }
    if (type === 'triggerenter' || type === 'triggerexit') {
      self.dispatchEvent(type, new PhysicsTriggerEvent(other, collider, otherCollider));
      return;
    }
    // Always resolved from the pair's own order and flipped for the second
    // object, so both see the same contact.
    const first = flip ? otherCollider : collider;
    const second = flip ? collider : otherCollider;
    const resolve = withContacts
      ? () => {
          const c1 = this._colliders.get(first)?.collider;
          const c2 = this._colliders.get(second)?.collider;
          return c1 && c2 ? this._backend!.contactInfo(c1, c2) : null;
        }
      : null;
    const event = new PhysicsContactEvent(other, collider, otherCollider, resolve, flip);
    self.dispatchEvent(type as 'collisionenter', event);
    event._expire();
  }

  // ------------------------------------------------------------------ query helpers

  /**
   * Queries see the world as the last step left it. Rapier only refreshes its
   * query structures while stepping, and refreshing them some other way (a
   * zero-length step) would make results depend on whether anything queried.
   */
  private _prepareQuery() {
    return !this.disposed && !!this._backend;
  }

  private _queryDirection(direction: Vector3) {
    const len = direction.magnitude;
    return len > 1e-12 ? Vector3.scale(direction, 1 / len, new Vector3()) : null;
  }

  private _queryDistance(maxDistance: number) {
    return Math.min(Math.max(0, maxDistance), MAX_QUERY_DISTANCE);
  }

  private _queryFilter(options?: PhysicsQueryOptions): QueryPredicate {
    const mask = options?.layerMask ?? ALL_LAYERS;
    const triggers = !!options?.includeTriggers;
    const exclude = options?.exclude ?? null;
    return (key) => {
      const entry = this._byKey.get(key);
      if (!entry) {
        return false;
      }
      const c = entry.component;
      return (
        !!(mask & (1 << c.layer)) &&
        (triggers || !c.isTrigger) &&
        (!exclude || exclude !== this._objectOf(entry))
      );
    };
  }

  private _rayHit(hit: BackendRayHit, origin: Vector3, dir: Vector3): PhysicsQueryHit {
    const entry = this._byKey.get(hit.key)!;
    return {
      collider: entry.component,
      body: this._publicBody(entry),
      object: this._objectOf(entry),
      node: entry.component.node!,
      point: Vector3.combine(origin, dir, 1, hit.distance, new Vector3()),
      normal: hit.normal,
      distance: hit.distance
    };
  }

  /**
   * Applies {@link Scene.physicsSettings} when they are set, replaced or
   * changed; going back to none restores the defaults. Changes made to the world
   * directly last until the scene settings change.
   */
  private _applySceneSettings() {
    const settings = this._scene.physicsSettings;
    if (
      settings === this._appliedSettings &&
      (!settings || settings.version === this._appliedSettingsVersion)
    ) {
      return;
    }
    this._appliedSettings = settings;
    this._appliedSettingsVersion = settings?.version ?? -1;
    const source = settings ?? new ScenePhysicsSettings();
    this.gravity = source.gravity;
    this.fixedTimeStep = source.fixedTimeStep;
    this.maxSubSteps = source.maxSubSteps;
    this.interpolation = source.interpolation;
    this.waitForCollidersOnStart = source.waitForCollidersOnStart;
    for (let a = 0; a < LAYER_COUNT; a++) {
      this._layerNames[a] = source.getLayerName(a);
      for (let b = a; b < LAYER_COUNT; b++) {
        this.setLayerCollision(a, b, source.getLayerCollision(a, b));
      }
    }
  }

  private _onAfterUpdate() {
    if (this._enabled && PhysicsSimulation._simulationEnabled) {
      this.update(getDevice().frameInfo.elapsedFrame * 0.001);
    }
  }

  private _onSceneDispose() {
    this.dispose();
  }

  protected onDispose() {
    super.onDispose();
    this._scene.off('afterupdate', this._onAfterUpdate, this);
    this._scene.off('dispose', this._onSceneDispose, this);
    this._backend?.dispose();
    this._backend = null;
    this._bodies.clear();
    this._colliders.clear();
    this._byKey.clear();
    this._touching.clear();
    this._touchingByKey.clear();
    this._startedThisFrame.clear();
    this._lastPairs.clear();
    this._pending.clear();
    this._failed.clear();
    this._joints.clear();
    this._retryJoints.clear();
    this._characters.clear();
    for (const wheel of this._registeredWheels) {
      this._restoreWheel(wheel);
    }
    this._vehicles.clear();
    this._worldAnchor = null;
  }
}
