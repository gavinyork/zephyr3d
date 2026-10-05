import { Disposable, makeObservable, Quaternion, Vector3 } from '@zephyr3d/base';
import type { Scene } from '@zephyr3d/scene';
import type { ClipmapTerrain } from '@zephyr3d/scene';
import { getDevice, SceneNode, tryGetApp } from '@zephyr3d/scene';
import type {
  BackendBody,
  BackendCollider,
  BackendRayHit,
  BackendWorld,
  QueryPredicate,
  ShapeDesc
} from './backend/types';
import { RapierWorld } from './backend/rapier';
import { getRapier, isPhysicsReady } from './rapier_state';
import type { RigidBody } from './rigid_body';
import type { Collider } from './collider';
import type { PhysicsComponent, PhysicsEventMap } from './component';
import { PhysicsContactEvent, PhysicsTriggerEvent, type PhysicsObject } from './events';
import type { ColliderGeometry, GeometrySource, MeshGeometry, TerrainGeometry } from './geometry';
import {
  fetchGeometry,
  geometryMatches,
  geometrySource,
  needsGeometry,
  sameSource,
  spansVolume
} from './geometry';

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

/** @internal */
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

/** @internal */
interface ColliderEntry {
  component: Collider;
  owner: BodyEntry | null;
  /** A static body of its own, for a collider with no rigid body above it. */
  implicitBody: BackendBody | null;
  collider: BackendCollider;
  key: number;
  lastMatrix: Float32Array;
}

/** Two physics objects in contact, through one pair of their colliders. */
interface ObjectPair {
  key: string;
  /** The object with the lower id; `colliderA` is one of its colliders. */
  a: PhysicsObject;
  b: PhysicsObject;
  colliderA: Collider;
  colliderB: Collider;
  trigger: boolean;
}

/**
 * A shape used by {@link PhysicsWorld} queries, in world units.
 *
 * Capsules and cylinders stand along the Y axis of the rotation they are
 * given; `height` is the total height, a capsule's rounded ends included.
 *
 * @public
 */
export type PhysicsShape =
  | { type: 'box'; size: Vector3 }
  | { type: 'sphere'; radius: number }
  | { type: 'capsule'; radius: number; height: number }
  | { type: 'cylinder'; radius: number; height: number };

/**
 * Narrows a {@link PhysicsWorld} query.
 *
 * @public
 */
export interface PhysicsQueryOptions {
  /** Bit `1 << layer` set for each collider layer to consider. Default: all layers. */
  layerMask?: number;
  /** Whether triggers can be hit. Default false. */
  includeTriggers?: boolean;
  /** An object to ignore, such as the one asking: a rigid body ignores all its colliders. */
  exclude?: PhysicsObject | null;
}

/**
 * What a query hit.
 *
 * @public
 */
export interface PhysicsQueryHit {
  collider: Collider;
  /** The rigid body the collider belongs to, if any. */
  body: RigidBody | null;
  /** The collider's node. */
  node: SceneNode;
  /** Where the hit is, in world space. */
  point: Vector3;
  /** Surface direction at the hit, in world space, pointing out of the collider. */
  normal: Vector3;
  /** How far along the ray or cast the hit is. */
  distance: number;
}

/**
 * Events of a {@link PhysicsWorld}.
 *
 * - `fixedupdate`: before each simulation step, with the step length in seconds.
 *   Forces applied from here act on that step only.
 *
 * @public
 */
export type PhysicsWorldEventMap = {
  fixedupdate: [fixedDeltaTime: number];
};

const LAYER_COUNT = 16;
const ALL_LAYERS = 0xffff;
const MAX_QUERY_DISTANCE = 1e9;
const CONVEX_HULL_ERROR =
  'Could not build a convex hull: it needs at least four points that are not all in one plane';

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
 * The physics simulation of one scene.
 *
 * @remarks
 * Created on demand by the first physics component whose node enters the scene,
 * and stepped once per frame on the scene's `afterupdate` event: after animation,
 * so kinematic bodies follow this frame's pose, and before rendering, so moved
 * nodes are drawn where the simulation put them.
 *
 * The simulation advances in fixed steps of {@link PhysicsWorld.fixedTimeStep},
 * at most {@link PhysicsWorld.maxSubSteps} per frame; time beyond that is
 * dropped rather than carried over, so a long frame slows the simulation down
 * instead of making the next frames catch up in a burst. Rendered poses of
 * dynamic bodies are interpolated between the last two steps.
 *
 * Only the fixed steps feed the simulation; frame rate and interpolation never
 * do, so the same inputs give the same result on any machine.
 *
 * @public
 */
export class PhysicsWorld extends makeObservable(Disposable)<PhysicsWorldEventMap>() {
  private static readonly _worlds = new WeakMap<Scene, PhysicsWorld>();
  private readonly _scene: Scene;
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
  private readonly _touching: Map<string, [Collider, Collider]>;
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
  /** @internal */
  _inFixedUpdate: boolean;

  /** The world of a scene, created if it does not exist yet. */
  static get(scene: Scene): PhysicsWorld {
    let world = PhysicsWorld._worlds.get(scene);
    if (!world || world.disposed) {
      world = new PhysicsWorld(scene);
      PhysicsWorld._worlds.set(scene, world);
    }
    return world;
  }
  /** The world of a scene, or null if none was created. */
  static find(scene: Scene): PhysicsWorld | null {
    const world = PhysicsWorld._worlds.get(scene);
    return world && !world.disposed ? world : null;
  }

  private constructor(scene: Scene) {
    super();
    this._scene = scene;
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
    this._inFixedUpdate = false;
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
  /** Whether the world steps on its own each frame. Default true. */
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
  get layerNames(): string[] {
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
   * Called automatically each frame while {@link PhysicsWorld.enabled}; call it
   * yourself with `enabled` off to drive the simulation manually. Does nothing
   * until {@link initPhysics} has completed.
   */
  update(dt: number) {
    if (this.disposed || !this._ensureBackend()) {
      return;
    }
    this._checkGeometry();
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
      this._backend!.step(fixed, this._onCollision);
      this._captureDynamicPoses();
    }
    if (steps > 0) {
      for (const entry of this._bodies.values()) {
        entry.component._clearForces(entry.body);
      }
    }
    this._writeBack(this._interpolation ? this._accumulator / fixed : 1);
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
  /** Every collider along a ray, nearest first. See {@link PhysicsWorld.raycast}. */
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
      body: entry.owner?.component ?? null,
      node: entry.component.host!,
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

  // ------------------------------------------------------------------ registration

  /** @internal */
  _registerBody(component: RigidBody) {
    this._registeredBodies.add(component);
    this._markBodyDirty(component);
  }
  /** @internal */
  _unregisterBody(component: RigidBody) {
    this._registeredBodies.delete(component);
    this._markBodyDirty(component);
  }
  /** @internal */
  _registerCollider(component: Collider) {
    this._registeredColliders.add(component);
    this._dirtyColliders.add(component);
  }
  /** @internal */
  _unregisterCollider(component: Collider) {
    this._registeredColliders.delete(component);
    this._dirtyColliders.add(component);
    this._pending.delete(component);
    this._failed.delete(component);
    this._enablementDirty = true;
    component._setStatus(false);
  }
  /** A body's settings changed; it is rebuilt on the next update. @internal */
  _markBodyDirty(component: RigidBody) {
    this._dirtyBodies.add(component);
    // Colliders below may now belong to a different body.
    component.host?.iterate((node) => {
      for (const c of this._registeredColliders) {
        if (c.host === node) {
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
  /** A collider's settings changed. @internal */
  _markColliderDirty(component: Collider) {
    this._dirtyColliders.add(component);
  }
  /** A collider's layer changed. @internal */
  _updateColliderGroups(component: Collider) {
    const entry = this._colliders.get(component);
    if (entry) {
      this._applyGroups(entry);
    }
  }
  /** @internal */
  _getBackendBody(component: RigidBody): BackendBody | null {
    return this._bodies.get(component)?.body ?? null;
  }

  // ------------------------------------------------------------------ internals

  private _ensureBackend() {
    if (!this._backend) {
      if (!isPhysicsReady()) {
        return false;
      }
      this._backend = new RapierWorld(getRapier());
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
    if (this._dirtyBodies.size === 0 && this._dirtyColliders.size === 0) {
      return;
    }
    const backend = this._backend!;
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
    // Create in scene tree order, which does not depend on the order components
    // were attached or loaded in: part of keeping the simulation reproducible.
    const order: PhysicsComponent[] = [];
    this._scene.rootNode.iterate((node) => {
      for (const component of node.components) {
        if (
          (this._dirtyBodies.has(component as RigidBody) &&
            this._registeredBodies.has(component as RigidBody)) ||
          (this._dirtyColliders.has(component as Collider) &&
            this._registeredColliders.has(component as Collider))
        ) {
          order.push(component as PhysicsComponent);
        }
      }
    });
    this._dirtyBodies.clear();
    this._dirtyColliders.clear();
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
    this._updateBodyEnablement();
  }

  private _createBody(component: RigidBody) {
    const host = component.host!;
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
      for (const component of n.components) {
        const entry = this._bodies.get(component as RigidBody);
        if (entry) {
          return entry;
        }
      }
    }
    return null;
  }

  private _createCollider(component: Collider) {
    const backend = this._backend!;
    const host = component.host!;
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
    // The collider's world pose: its node, moved by its offset in node space.
    const colliderPose = readWorldPose(host, tmpPose, tmpScale);
    host.worldMatrix.transformPointAffine(component.offset, colliderPose.position);
    let shape: ShapeDesc;
    if (geometry?.kind === 'terrain') {
      const built = this._terrainShape(
        host as ClipmapTerrain,
        geometry,
        component.terrainResolution,
        colliderPose
      );
      if (!built) {
        this._fail(component, null, 'The terrain height map is too small for a collider');
        return;
      }
      shape = built;
    } else if (geometry) {
      // Signed: a mirrored mesh stays mirrored.
      shape = this._meshShape(component, geometry, tmpScale);
      if (shape.type === 'trimesh' && shape.indices.length < 3) {
        this._fail(component, null, 'A mesh collider needs triangles');
        return;
      }
      if (shape.type === 'convex' && !spansVolume(shape.points)) {
        this._fail(component, null, CONVEX_HULL_ERROR);
        return;
      }
    } else {
      const scale = tmpVec.setXYZ(Math.abs(tmpScale.x), Math.abs(tmpScale.y), Math.abs(tmpScale.z));
      shape = this._buildShape(component, scale);
    }
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
      const bodyPose = readWorldPose(owner.component.host!, tmpPose2);
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

  private _buildShape(component: Collider, scale: Vector3): ShapeDesc {
    const radial = Math.max(scale.x, scale.z);
    switch (component.shape) {
      case 'sphere':
        return { type: 'sphere', radius: component.radius * Math.max(scale.x, scale.y, scale.z) };
      case 'capsule': {
        const radius = component.radius * radial;
        return {
          type: 'capsule',
          radius,
          halfHeight: Math.max(0, (component.height * scale.y) / 2 - radius)
        };
      }
      case 'cylinder':
        return {
          type: 'cylinder',
          radius: component.radius * radial,
          halfHeight: (component.height * scale.y) / 2
        };
      default:
        return {
          type: 'box',
          halfExtents: new Vector3(
            (component.size.x * scale.x) / 2,
            (component.size.y * scale.y) / 2,
            (component.size.z * scale.z) / 2
          )
        };
    }
  }

  /** Triangles or hull points, scaled along each axis, around the collider's origin. */
  private _meshShape(component: Collider, geometry: MeshGeometry, scale: Vector3): ShapeDesc {
    const src = geometry.positions;
    const points = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 3) {
      points[i] = src[i] * scale.x;
      points[i + 1] = src[i + 1] * scale.y;
      points[i + 2] = src[i + 2] * scale.z;
    }
    return component.shape === 'convex'
      ? { type: 'convex', points }
      : { type: 'trimesh', vertices: points, indices: geometry.indices };
  }

  /**
   * A height field matching how the terrain is drawn: it spans from the node's
   * position along +X and +Z, height samples sit at texel centres, and heights
   * are scaled by the node's Y scale on top of its world height. Rotation is
   * ignored, as by the terrain itself. Sets `pose` to the field's centre.
   */
  private _terrainShape(
    terrain: ClipmapTerrain,
    geometry: TerrainGeometry,
    resolution: number,
    pose: Pose
  ): ShapeDesc | null {
    const { width, height } = geometry;
    const cols = Math.floor((width - 1) / resolution) + 1;
    const rows = Math.floor((height - 1) / resolution) + 1;
    if (cols < 2 || rows < 2) {
      return null;
    }
    const heights = new Float32Array(rows * cols);
    for (let x = 0; x < cols; x++) {
      for (let z = 0; z < rows; z++) {
        heights[x * rows + z] = geometry.heights[z * resolution * width + x * resolution];
      }
    }
    // The same placement as ClipmapTerrain.updateRegion.
    const scale = terrain.scale;
    const cellX = (Math.abs(scale.x) * terrain.sizeX) / width;
    const cellZ = (Math.abs(scale.z) * terrain.sizeZ) / height;
    const px = terrain.position.x + (terrain.parent?.worldMatrix.m03 ?? 0);
    const pz = terrain.position.z + (terrain.parent?.worldMatrix.m23 ?? 0);
    const spanX = (cols - 1) * resolution * cellX;
    const spanZ = (rows - 1) * resolution * cellZ;
    pose.position.setXYZ(px + cellX * 0.5 + spanX / 2, terrain.worldMatrix.m13, pz + cellZ * 0.5 + spanZ / 2);
    pose.rotation.identity();
    return { type: 'heightfield', rows, cols, heights, scale: new Vector3(spanX, scale.y, spanZ) };
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
    if (geometryMatches(component._geometry, source)) {
      return component._geometry;
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
      console.error(`Collider on '${component.host?.name ?? ''}': ${message}`);
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
      } else if (source && geometryMatches(component._geometry, source)) {
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
      const owner = component.host ? this._findOwner(component.host) : null;
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
      const host = entry.component.host!;
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
      if (entry.implicitBody && !matrixEquals(entry.lastMatrix, entry.component.host!)) {
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
      const target = readWorldPose(entry.component.host!, tmpPose);
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
      const host = entry.component.host!;
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
    this._touching.set(pk, [e1.component, e2.component]);
    for (const key of [key1, key2]) {
      let set = this._touchingByKey.get(key);
      if (!set) {
        set = new Set();
        this._touchingByKey.set(key, set);
      }
      set.add(pk);
    }
    const pair = this._objectPair(e1.component, e2.component);
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

  /** The object a collider raises events on: its rigid body, or itself. */
  private _objectOf(collider: Collider): PhysicsObject {
    return this._colliders.get(collider)?.owner?.component ?? collider;
  }

  private _objectPair(c1: Collider, c2: Collider): ObjectPair | null {
    let a = this._objectOf(c1);
    let b = this._objectOf(c2);
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
    for (const [c1, c2] of this._touching.values()) {
      const pair = this._objectPair(c1, c2);
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
    self: PhysicsObject,
    other: PhysicsObject,
    collider: Collider,
    otherCollider: Collider,
    type: keyof PhysicsEventMap,
    withContacts: boolean,
    flip: boolean
  ) {
    // Objects that left the world get nothing: their side of the contact is gone.
    if (self.world !== this || !self._hasListeners(type)) {
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
        (!exclude || (exclude !== c && exclude !== entry.owner?.component))
      );
    };
  }

  private _rayHit(hit: BackendRayHit, origin: Vector3, dir: Vector3): PhysicsQueryHit {
    const entry = this._byKey.get(hit.key)!;
    return {
      collider: entry.component,
      body: entry.owner?.component ?? null,
      node: entry.component.host!,
      point: Vector3.combine(origin, dir, 1, hit.distance, new Vector3()),
      normal: hit.normal,
      distance: hit.distance
    };
  }

  private _onAfterUpdate() {
    if (this._enabled) {
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
    PhysicsWorld._worlds.delete(this._scene);
  }
}
