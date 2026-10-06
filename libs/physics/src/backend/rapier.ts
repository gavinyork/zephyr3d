import { Vector3 } from '@zephyr3d/base';
import type { Quaternion } from '@zephyr3d/base';
import type { RapierAPI } from '../rapier_loader';
import type {
  BackendBody,
  BackendCollider,
  BackendRayHit,
  BackendShapeHit,
  BackendWorld,
  BackendCharacter,
  BackendJoint,
  BodyDesc,
  CharacterMove,
  CharacterSettings,
  ColliderMaterialDesc,
  CollisionCallback,
  ContactInfo,
  JointDesc,
  JointKind,
  MotionType,
  MotorMode,
  QueryPredicate,
  ShapeDesc,
  BackendVehicle,
  VehicleWheelDesc,
  VehicleWheelState
} from './types';

type RWorld = InstanceType<RapierAPI['World']>;
type RBody = ReturnType<RWorld['createRigidBody']>;
type RCollider = ReturnType<RWorld['createCollider']>;
type RShape = InstanceType<RapierAPI['Shape']>;
type RJoint = ReturnType<RWorld['createImpulseJoint']>;
type RUnitJoint = InstanceType<RapierAPI['RevoluteImpulseJoint']>;
type RController = ReturnType<RWorld['createCharacterController']>;
type RVehicle = ReturnType<RWorld['createVehicleController']>;

/** Rapier's motors stop at this force by default: in effect unlimited. */
const UNLIMITED_FORCE = 3.4e38;
/** Joint axis numbers of Rapier's raw joint API. */
const ANG_X = 3;
const ANG_Y = 4;
const ANG_Z = 5;

function bodyType(R: RapierAPI, type: MotionType) {
  return type === 'dynamic'
    ? R.RigidBodyType.Dynamic
    : type === 'kinematic'
      ? R.RigidBodyType.KinematicPositionBased
      : R.RigidBodyType.Fixed;
}

function vec(v: Vector3) {
  return { x: v.x, y: v.y, z: v.z };
}

function quat(q: Quaternion) {
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

/**
 * Origins to cast a ray from so that it cannot slip between height field cells.
 *
 * @remarks
 * Rapier misses a height field with a ray lying exactly in one of the planes
 * between its cells, e.g. straight down from whole-number coordinates over a
 * terrain with whole-number spacing (dimforge/rapier#165, still open in 0.21).
 * A ray along such a plane is also cast moved off it on either side, by a
 * distance far below anything visible but large enough to survive Rapier's
 * single precision, and the nearest hit wins. Either side, because a ray along
 * the outer edge of a field only hits from the inside. Distances along the ray
 * are unaffected; hit points are worked out from the original origin.
 */
function rayOrigins(origin: Vector3, direction: Vector3) {
  const o = { x: origin.x, y: origin.y, z: origin.z };
  const alongX = Math.abs(direction.x) < 1e-6;
  const alongZ = Math.abs(direction.z) < 1e-6;
  if (!alongX && !alongZ) {
    return [o];
  }
  const ex = alongX ? Math.max(1e-5, Math.abs(o.x) * 4e-7) : 0;
  const ez = alongZ ? Math.max(1e-5, Math.abs(o.z) * 4e-7) : 0;
  return [o, { x: o.x + ex, y: o.y, z: o.z + ez }, { x: o.x - ex, y: o.y, z: o.z - ez }];
}

class RapierBody implements BackendBody {
  constructor(
    private readonly R: RapierAPI,
    readonly body: RBody
  ) {}
  setMotionType(type: MotionType) {
    this.body.setBodyType(bodyType(this.R, type), true);
  }
  setMass(mass: number) {
    // Colliders carry no density (see createCollider): the body's mass is set
    // here, and Rapier derives the inertia from the collider shapes.
    this.body.setAdditionalMass(Math.max(mass, 1e-6), true);
    // Otherwise only applied at the next step, after impulses queued for it.
    this.body.recomputeMassPropertiesFromColliders();
  }
  setDamping(linear: number, angular: number) {
    this.body.setLinearDamping(linear);
    this.body.setAngularDamping(angular);
  }
  setGravityScale(scale: number) {
    this.body.setGravityScale(scale, true);
  }
  setCcd(enabled: boolean) {
    this.body.enableCcd(enabled);
  }
  setCanSleep(enabled: boolean) {
    // Not settable after creation in Rapier; a body that may not sleep is kept awake.
    if (!enabled) {
      this.body.wakeUp();
    }
  }
  setEnabled(enabled: boolean) {
    this.body.setEnabled(enabled);
  }
  setEnabledAxes(translation: [boolean, boolean, boolean], rotation: [boolean, boolean, boolean]) {
    this.body.setEnabledTranslations(translation[0], translation[1], translation[2], true);
    this.body.setEnabledRotations(rotation[0], rotation[1], rotation[2], true);
  }
  setPose(position: Vector3, rotation: Quaternion) {
    this.body.setTranslation(vec(position), true);
    this.body.setRotation(quat(rotation), true);
  }
  setKinematicTarget(position: Vector3, rotation: Quaternion) {
    this.body.setNextKinematicTranslation(vec(position));
    this.body.setNextKinematicRotation(quat(rotation));
  }
  getPosition(out: Vector3) {
    const t = this.body.translation();
    return out.setXYZ(t.x, t.y, t.z);
  }
  getRotation(out: Quaternion) {
    const r = this.body.rotation();
    return out.setXYZW(r.x, r.y, r.z, r.w);
  }
  getLinearVelocity(out: Vector3) {
    const v = this.body.linvel();
    return out.setXYZ(v.x, v.y, v.z);
  }
  setLinearVelocity(v: Vector3) {
    this.body.setLinvel(vec(v), true);
  }
  getAngularVelocity(out: Vector3) {
    const v = this.body.angvel();
    return out.setXYZ(v.x, v.y, v.z);
  }
  setAngularVelocity(v: Vector3) {
    this.body.setAngvel(vec(v), true);
  }
  setForce(force: Vector3, torque: Vector3) {
    const wake =
      force.x !== 0 || force.y !== 0 || force.z !== 0 || torque.x !== 0 || torque.y !== 0 || torque.z !== 0;
    this.body.resetForces(false);
    this.body.resetTorques(false);
    if (wake) {
      this.body.addForce(vec(force), true);
      this.body.addTorque(vec(torque), true);
    }
  }
  applyImpulse(impulse: Vector3, torqueImpulse: Vector3) {
    this.body.applyImpulse(vec(impulse), true);
    this.body.applyTorqueImpulse(vec(torqueImpulse), true);
  }
  isSleeping() {
    return this.body.isSleeping();
  }
  wakeUp() {
    this.body.wakeUp();
  }
}

class RapierJoint implements BackendJoint {
  constructor(
    readonly joint: RJoint,
    private readonly _type: JointKind
  ) {}
  setContactsEnabled(enabled: boolean) {
    this.joint.setContactsEnabled(enabled);
  }
  setLimits(min: number, max: number) {
    if (this._type === 'hinge' || this._type === 'slider') {
      (this.joint as RUnitJoint).setLimits(min, max);
    }
  }
  setBallLimits(twist: number, swing: number) {
    if (this._type !== 'ball') {
      return;
    }
    // Not exposed on Rapier's spherical joint class, but supported per axis by
    // the joint underneath.
    const raw = (this.joint as unknown as { rawSet: { jointSetLimits: (...a: number[]) => void } }).rawSet;
    const handle = this.joint.handle;
    raw.jointSetLimits(handle, ANG_X, -twist, twist);
    raw.jointSetLimits(handle, ANG_Y, -swing, swing);
    raw.jointSetLimits(handle, ANG_Z, -swing, swing);
  }
  setMotor(mode: MotorMode, target: number, stiffness: number, damping: number, maxForce: number) {
    if (this._type !== 'hinge' && this._type !== 'slider') {
      return;
    }
    const joint = this.joint as RUnitJoint;
    switch (mode) {
      case 'velocity':
        joint.configureMotorVelocity(target, damping);
        break;
      case 'position':
        joint.configureMotorPosition(target, stiffness, damping);
        break;
      default:
        // Zero gains are not enough: with force to spare, Rapier holds the
        // axis rigidly in place. No force is what turns a motor off.
        joint.configureMotor(0, 0, 0, 0);
        joint.setMotorMaxForce(0);
        return;
    }
    joint.setMotorMaxForce(maxForce > 0 ? maxForce : UNLIMITED_FORCE);
  }
}

class RapierVehicle implements BackendVehicle {
  private readonly _controller: RVehicle;
  constructor(
    private readonly R: RapierAPI,
    private readonly _world: RWorld,
    chassis: RapierBody,
    forwardAxis: number,
    wheels: VehicleWheelDesc[]
  ) {
    const c = _world.createVehicleController(chassis.body);
    this._controller = c;
    c.indexUpAxis = 1;
    // The binding names this setter oddly; it sets the forward axis.
    c.setIndexForwardAxis = forwardAxis;
    wheels.forEach((w, i) => {
      c.addWheel(vec(w.connection), vec(w.direction), vec(w.axle), w.restLength, w.radius);
      c.setWheelSuspensionStiffness(i, w.stiffness);
      c.setWheelSuspensionCompression(i, w.compression);
      c.setWheelSuspensionRelaxation(i, w.relaxation);
      c.setWheelMaxSuspensionTravel(i, w.maxTravel);
      c.setWheelMaxSuspensionForce(i, w.maxForce);
      c.setWheelFrictionSlip(i, w.frictionSlip);
      c.setWheelSideFrictionStiffness(i, w.sideFriction);
    });
  }
  setWheelInput(index: number, engineForce: number, brakeImpulse: number, steering: number) {
    const c = this._controller;
    c.setWheelEngineForce(index, engineForce);
    c.setWheelBrake(index, brakeImpulse);
    c.setWheelSteering(index, steering);
  }
  update(dt: number, filter: QueryPredicate) {
    // Triggers are driven through, not over.
    this._controller.updateVehicle(dt, this.R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, (other) =>
      filter(other.handle)
    );
  }
  wheelState(index: number, out: VehicleWheelState) {
    const c = this._controller;
    out.suspensionLength = c.wheelSuspensionLength(index) ?? 0;
    out.rotation = c.wheelRotation(index) ?? 0;
    out.steering = c.wheelSteering(index) ?? 0;
    out.inContact = c.wheelIsInContact(index);
    const p = c.wheelContactPoint(index);
    const n = c.wheelContactNormal(index);
    out.contactPoint.setXYZ(p?.x ?? 0, p?.y ?? 0, p?.z ?? 0);
    out.contactNormal.setXYZ(n?.x ?? 0, n?.y ?? 0, n?.z ?? 0);
    out.groundKey = out.inContact ? (c.wheelGroundObject(index)?.handle ?? -1) : -1;
    out.suspensionForce = c.wheelSuspensionForce(index) ?? 0;
    return out;
  }
  dispose() {
    this._world.removeVehicleController(this._controller);
  }
}

class RapierCharacter implements BackendCharacter {
  private readonly _controller: RController;
  constructor(
    private readonly R: RapierAPI,
    private readonly _world: RWorld,
    settings: CharacterSettings
  ) {
    this._controller = _world.createCharacterController(settings.skinWidth);
    this._controller.setUp({ x: 0, y: 1, z: 0 });
    this._controller.setSlideEnabled(true);
    this.configure(settings);
  }
  configure(s: CharacterSettings) {
    const c = this._controller;
    c.setOffset(s.skinWidth);
    c.setMaxSlopeClimbAngle(s.slopeLimit);
    c.setMinSlopeSlideAngle(s.slideSlope);
    if (s.stepHeight > 0) {
      c.enableAutostep(s.stepHeight, s.stepMinWidth, false);
    } else {
      c.disableAutostep();
    }
    if (s.snapToGround > 0) {
      c.enableSnapToGround(s.snapToGround);
    } else {
      c.disableSnapToGround();
    }
    c.setApplyImpulsesToDynamicBodies(s.pushBodies);
    c.setCharacterMass(s.characterMass);
  }
  move(collider: BackendCollider, desired: Vector3, filter: QueryPredicate): CharacterMove {
    const c = this._controller;
    c.computeColliderMovement(
      collider as RCollider,
      vec(desired),
      // Triggers are walked through, not around.
      this.R.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      (other) => filter(other.handle)
    );
    const m = c.computedMovement();
    const hits = [];
    for (let i = 0; i < c.numComputedCollisions(); i++) {
      const hit = c.computedCollision(i);
      if (hit?.collider) {
        hits.push({
          key: hit.collider.handle,
          point: new Vector3(hit.witness1.x, hit.witness1.y, hit.witness1.z),
          normal: new Vector3(hit.normal1.x, hit.normal1.y, hit.normal1.z)
        });
      }
    }
    return { movement: new Vector3(m.x, m.y, m.z), grounded: c.computedGrounded(), hits };
  }
  dispose() {
    this._world.removeCharacterController(this._controller);
  }
}

/** @internal */
export class RapierWorld implements BackendWorld {
  private readonly _world: RWorld;
  private readonly _events: InstanceType<RapierAPI['EventQueue']>;
  constructor(private readonly R: RapierAPI) {
    this._world = new R.World({ x: 0, y: -9.81, z: 0 });
    // autoDrain: events left undrained are dropped at the next step.
    this._events = new R.EventQueue(true);
  }
  setGravity(gravity: Vector3) {
    this._world.gravity = vec(gravity);
  }
  createBody(desc: BodyDesc): BackendBody {
    const R = this.R;
    const d = new R.RigidBodyDesc(bodyType(R, desc.motionType))
      .setTranslation(desc.position.x, desc.position.y, desc.position.z)
      .setRotation(quat(desc.rotation))
      .setLinearDamping(desc.linearDamping)
      .setAngularDamping(desc.angularDamping)
      .setGravityScale(desc.gravityScale)
      .setCcdEnabled(desc.ccd)
      .setCanSleep(desc.canSleep);
    if (desc.motionType === 'dynamic') {
      d.setAdditionalMass(Math.max(desc.mass, 1e-6));
    }
    const body = new RapierBody(R, this._world.createRigidBody(d));
    const t = desc.translationAxes;
    const r = desc.rotationAxes;
    if (!t[0] || !t[1] || !t[2] || !r[0] || !r[1] || !r[2]) {
      body.setEnabledAxes(t, r);
    }
    return body;
  }
  removeBody(body: BackendBody) {
    this._world.removeRigidBody((body as RapierBody).body);
  }
  createCollider(
    body: BackendBody,
    shape: ShapeDesc,
    position: Vector3,
    rotation: Quaternion,
    material: ColliderMaterialDesc
  ): BackendCollider | null {
    const R = this.R;
    let d: InstanceType<RapierAPI['ColliderDesc']> | null;
    switch (shape.type) {
      case 'box':
        d = R.ColliderDesc.cuboid(shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z);
        break;
      case 'sphere':
        d = R.ColliderDesc.ball(shape.radius);
        break;
      case 'capsule':
        d = R.ColliderDesc.capsule(shape.halfHeight, shape.radius);
        break;
      case 'cylinder':
        d = R.ColliderDesc.cylinder(shape.halfHeight, shape.radius);
        break;
      case 'trimesh':
        d = R.ColliderDesc.trimesh(
          shape.vertices,
          shape.indices,
          R.TriMeshFlags.MERGE_DUPLICATE_VERTICES |
            R.TriMeshFlags.DELETE_DEGENERATE_TRIANGLES |
            R.TriMeshFlags.DELETE_DUPLICATE_TRIANGLES |
            // Without it, a body sliding over a flat mesh catches on the edges
            // between triangles and hops.
            R.TriMeshFlags.FIX_INTERNAL_EDGES
        );
        break;
      case 'convex':
        d = R.ColliderDesc.convexHull(shape.points);
        break;
      case 'heightfield':
        // Rapier counts cells, not samples.
        d = R.ColliderDesc.heightfield(
          shape.rows - 1,
          shape.cols - 1,
          shape.heights,
          vec(shape.scale),
          R.HeightFieldFlags.FIX_INTERNAL_EDGES
        );
        break;
    }
    if (!d) {
      return null;
    }
    d.setTranslation(position.x, position.y, position.z)
      .setRotation(quat(rotation))
      .setFriction(material.friction)
      .setRestitution(material.restitution)
      .setSensor(material.isTrigger)
      .setCollisionGroups(material.groups)
      .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
      // Mass lives on the body (RigidBody.mass), not in collider densities.
      .setDensity(0);
    if (material.isTrigger) {
      // A trigger with no rigid body is fixed; by default Rapier reports nothing
      // between fixed or kinematic colliders, so a trigger zone could not sense
      // a kinematic character.
      d.setActiveCollisionTypes(
        R.ActiveCollisionTypes.DEFAULT |
          R.ActiveCollisionTypes.KINEMATIC_FIXED |
          R.ActiveCollisionTypes.KINEMATIC_KINEMATIC
      );
    }
    return this._world.createCollider(d, (body as RapierBody).body);
  }
  removeCollider(collider: BackendCollider) {
    this._world.removeCollider(collider as RCollider, true);
  }
  createJoint(desc: JointDesc, body1: BackendBody, body2: BackendBody): BackendJoint {
    const R = this.R;
    const a1 = vec(desc.anchor1);
    const a2 = vec(desc.anchor2);
    const x = { x: 1, y: 0, z: 0 };
    let data: ReturnType<RapierAPI['JointData']['fixed']>;
    switch (desc.type) {
      case 'fixed':
        data = R.JointData.fixed(a1, quat(desc.frame1), a2, quat(desc.frame2));
        break;
      case 'hinge':
        data = R.JointData.revolute(a1, a2, x);
        break;
      case 'slider':
        data = R.JointData.prismatic(a1, a2, x);
        break;
      case 'ball':
        data = R.JointData.spherical(a1, a2);
        break;
      case 'rope':
        data = R.JointData.rope(desc.length, a1, a2);
        break;
      case 'spring':
        data = R.JointData.spring(desc.length, desc.stiffness, desc.damping, a1, a2);
        break;
    }
    const joint = this._world.createImpulseJoint(
      data,
      (body1 as RapierBody).body,
      (body2 as RapierBody).body,
      true
    );
    if (desc.type === 'hinge' || desc.type === 'slider' || desc.type === 'ball') {
      // Rapier derives these frames from the axis alone, separately for each
      // body, so the two seldom agree about where angle 0 is. Both are set from
      // the one world frame instead: the joint starts at 0 in the pose it was
      // placed in.
      joint.setLocalFrame1(a1, quat(desc.frame1));
      joint.setLocalFrame2(a2, quat(desc.frame2));
    }
    joint.setContactsEnabled(desc.collideConnected);
    return new RapierJoint(joint, desc.type);
  }
  removeJoint(joint: BackendJoint) {
    const j = (joint as RapierJoint).joint;
    // Removing either body has already taken the joint with it.
    if (j.isValid()) {
      this._world.removeImpulseJoint(j, true);
    }
  }
  createCharacter(settings: CharacterSettings): BackendCharacter {
    return new RapierCharacter(this.R, this._world, settings);
  }
  createVehicle(chassis: BackendBody, forwardAxis: number, wheels: VehicleWheelDesc[]): BackendVehicle {
    return new RapierVehicle(this.R, this._world, chassis as RapierBody, forwardAxis, wheels);
  }
  syncColliders() {
    this._world.propagateModifiedBodyPositionsToColliders();
  }
  colliderKey(collider: BackendCollider) {
    return (collider as RCollider).handle;
  }
  colliderTriangles(collider: BackendCollider) {
    const c = collider as RCollider;
    const type = c.shape.type;
    if (type !== this.R.ShapeType.TriMesh && type !== this.R.ShapeType.ConvexPolyhedron) {
      return null;
    }
    const indices = c.indices();
    return indices ? { vertices: c.vertices(), indices } : null;
  }
  setColliderGroups(collider: BackendCollider, groups: number) {
    (collider as RCollider).setCollisionGroups(groups);
  }
  step(dt: number, onCollision?: CollisionCallback) {
    this._world.timestep = dt;
    this._world.step(this._events);
    if (onCollision) {
      this._events.drainCollisionEvents(onCollision);
    }
  }
  contactInfo(c1: BackendCollider, c2: BackendCollider): ContactInfo | null {
    const normal = new Vector3();
    const points: Vector3[] = [];
    let impulse = 0;
    let found = false;
    this._world.contactPair(c1 as RCollider, c2 as RCollider, (manifold, flipped) => {
      // The first manifold sets the normal; compound shapes may have several.
      if (!found) {
        const n = manifold.normal();
        normal.setXYZ(n.x, n.y, n.z);
        if (flipped) {
          normal.scaleBy(-1);
        }
      }
      found = true;
      for (let i = 0; i < manifold.numSolverContacts(); i++) {
        const p = manifold.solverContactPoint(i);
        if (p) {
          points.push(new Vector3(p.x, p.y, p.z));
        }
      }
      for (let i = 0; i < manifold.numContacts(); i++) {
        impulse += manifold.contactImpulse(i);
      }
    });
    return found ? { normal, points, impulse } : null;
  }
  castRay(origin: Vector3, direction: Vector3, maxDistance: number, filter: QueryPredicate) {
    let best: BackendRayHit | null = null;
    for (const o of rayOrigins(origin, direction)) {
      const hit = this._world.castRayAndGetNormal(
        new this.R.Ray(o, vec(direction)),
        maxDistance,
        true,
        undefined,
        undefined,
        undefined,
        undefined,
        (c) => filter(c.handle)
      );
      if (hit && (!best || hit.timeOfImpact < best.distance)) {
        best = {
          key: hit.collider.handle,
          distance: hit.timeOfImpact,
          normal: new Vector3(hit.normal.x, hit.normal.y, hit.normal.z)
        };
      }
    }
    return best;
  }
  castRayAll(origin: Vector3, direction: Vector3, maxDistance: number, filter: QueryPredicate) {
    // Nearest hit per collider, over every origin cast from.
    const hits = new Map<number, BackendRayHit>();
    for (const o of rayOrigins(origin, direction)) {
      this._world.intersectionsWithRay(
        new this.R.Ray(o, vec(direction)),
        maxDistance,
        true,
        (hit) => {
          const key = hit.collider.handle;
          const prev = hits.get(key);
          if (!prev || hit.timeOfImpact < prev.distance) {
            hits.set(key, {
              key,
              distance: hit.timeOfImpact,
              normal: new Vector3(hit.normal.x, hit.normal.y, hit.normal.z)
            });
          }
          return true;
        },
        undefined,
        undefined,
        undefined,
        undefined,
        (c) => filter(c.handle)
      );
    }
    // Ties broken by key, so the order never depends on traversal order.
    return [...hits.values()].sort((a, b) => a.distance - b.distance || a.key - b.key);
  }
  castShape(
    shape: ShapeDesc,
    position: Vector3,
    rotation: Quaternion,
    direction: Vector3,
    maxDistance: number,
    filter: QueryPredicate
  ): BackendShapeHit | null {
    const hit = this._world.castShape(
      vec(position),
      quat(rotation),
      vec(direction),
      this._shape(shape),
      0,
      maxDistance,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      (c) => filter(c.handle)
    );
    return hit
      ? {
          key: hit.collider.handle,
          distance: hit.time_of_impact,
          point: new Vector3(hit.witness1.x, hit.witness1.y, hit.witness1.z),
          normal: new Vector3(hit.normal1.x, hit.normal1.y, hit.normal1.z)
        }
      : null;
  }
  overlapShape(shape: ShapeDesc, position: Vector3, rotation: Quaternion, filter: QueryPredicate) {
    const keys: number[] = [];
    this._world.intersectionsWithShape(
      vec(position),
      quat(rotation),
      this._shape(shape),
      (c) => {
        keys.push(c.handle);
        return true;
      },
      undefined,
      undefined,
      undefined,
      undefined,
      (c) => filter(c.handle)
    );
    return keys.sort((a, b) => a - b);
  }
  overlapPoint(point: Vector3, filter: QueryPredicate) {
    const keys: number[] = [];
    this._world.intersectionsWithPoint(
      vec(point),
      (c) => {
        keys.push(c.handle);
        return true;
      },
      undefined,
      undefined,
      undefined,
      undefined,
      (c) => filter(c.handle)
    );
    return keys.sort((a, b) => a - b);
  }
  dispose() {
    this._events.free();
    this._world.free();
  }
  private _shape(shape: ShapeDesc): RShape {
    const R = this.R;
    switch (shape.type) {
      case 'box':
        return new R.Cuboid(shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z);
      case 'sphere':
        return new R.Ball(shape.radius);
      case 'capsule':
        return new R.Capsule(shape.halfHeight, shape.radius);
      case 'cylinder':
        return new R.Cylinder(shape.halfHeight, shape.radius);
      default:
        throw new Error(`Shape type '${shape.type}' cannot be used in queries`);
    }
  }
}
