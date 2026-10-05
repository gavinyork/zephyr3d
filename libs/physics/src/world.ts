import { Disposable, Quaternion, Vector3 } from '@zephyr3d/base';
import type { Scene, SceneNode } from '@zephyr3d/scene';
import { getDevice } from '@zephyr3d/scene';
import type { BackendBody, BackendCollider, BackendWorld, ShapeDesc } from './backend/types';
import { RapierWorld } from './backend/rapier';
import { getRapier, isPhysicsReady } from './rapier_state';
import type { RigidBody } from './rigid_body';
import type { Collider } from './collider';

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
}

/** @internal */
interface ColliderEntry {
  component: Collider;
  owner: BodyEntry | null;
  /** A static body of its own, for a collider with no rigid body above it. */
  implicitBody: BackendBody | null;
  collider: BackendCollider;
  lastMatrix: Float32Array;
}

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
export class PhysicsWorld extends Disposable {
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
  /** Components that joined, left or changed since the last resolve. */
  private readonly _dirtyBodies: Set<RigidBody>;
  private readonly _dirtyColliders: Set<Collider>;
  private readonly _registeredBodies: Set<RigidBody>;
  private readonly _registeredColliders: Set<Collider>;

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
    this._dirtyBodies = new Set();
    this._dirtyColliders = new Set();
    this._registeredBodies = new Set();
    this._registeredColliders = new Set();
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
    this._resolve();
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
    this._syncFromNodes();
    if (steps > 0) {
      this._applyInputs();
      for (let i = 0; i < steps; i++) {
        this._setKinematicTargets((i + 1) / steps);
        this._backend!.step(fixed);
        this._captureDynamicPoses();
      }
      this._clearForces();
    }
    this._writeBack(this._interpolation ? this._accumulator / fixed : 1);
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
    for (const c of this._colliders.keys()) {
      if (this._colliders.get(c)!.owner?.component === component) {
        this._dirtyColliders.add(c);
      }
    }
  }
  /** A collider's settings changed. @internal */
  _markColliderDirty(component: Collider) {
    this._dirtyColliders.add(component);
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
        backend.removeBody(entry.body);
        this._bodies.delete(b);
      }
    }
    // Create in scene tree order, which does not depend on the order components
    // were attached or loaded in: part of keeping the simulation reproducible.
    const order: (RigidBody | Collider)[] = [];
    this._scene.rootNode.iterate((node) => {
      for (const component of node.components) {
        if (
          (this._dirtyBodies.has(component as RigidBody) &&
            this._registeredBodies.has(component as RigidBody)) ||
          (this._dirtyColliders.has(component as Collider) &&
            this._registeredColliders.has(component as Collider))
        ) {
          order.push(component as RigidBody | Collider);
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
      canSleep: component.canSleep
    });
    const entry: BodyEntry = {
      component,
      body,
      prev: pose,
      curr: { position: pose.position.clone(), rotation: pose.rotation.clone() },
      kinematicFrom: { position: pose.position.clone(), rotation: pose.rotation.clone() },
      lastMatrix: new Float32Array(16),
      settled: false
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
    const owner = this._findOwner(host);
    // The collider's world pose: its node, moved by its offset in node space.
    const colliderPose = readWorldPose(host, tmpPose, tmpScale);
    host.worldMatrix.transformPointAffine(component.offset, colliderPose.position);
    const scale = tmpVec.setXYZ(Math.abs(tmpScale.x), Math.abs(tmpScale.y), Math.abs(tmpScale.z));
    const shape = this._buildShape(component, scale);
    const material = {
      friction: component.friction,
      restitution: component.restitution,
      isTrigger: component.isTrigger
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
        canSleep: true
      });
      body = implicitBody;
      localPos = Vector3.zero();
      localRot = Quaternion.identity();
    }
    const collider = backend.createCollider(body, shape, localPos, localRot, material);
    const lastMatrix = new Float32Array(16);
    storeMatrix(lastMatrix, host);
    this._colliders.set(component, { component, owner, implicitBody, collider, lastMatrix });
    // A collider joining a body changes its inertia; wake it so it notices.
    owner?.body.wakeUp();
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
    this._colliders.delete(component);
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

  private _applyInputs() {
    for (const entry of this._bodies.values()) {
      entry.component._applyInputs(entry.body);
    }
  }

  private _clearForces() {
    for (const entry of this._bodies.values()) {
      entry.component._clearForces(entry.body);
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
    PhysicsWorld._worlds.delete(this._scene);
  }
}
