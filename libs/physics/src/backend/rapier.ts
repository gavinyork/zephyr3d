import { Vector3 } from '@zephyr3d/base';
import type { Quaternion } from '@zephyr3d/base';
import type { RapierAPI } from '../rapier_loader';
import type {
  BackendBody,
  BackendCollider,
  BackendRayHit,
  BackendShapeHit,
  BackendWorld,
  BodyDesc,
  ColliderMaterialDesc,
  CollisionCallback,
  ContactInfo,
  MotionType,
  QueryPredicate,
  ShapeDesc
} from './types';

type RWorld = InstanceType<RapierAPI['World']>;
type RBody = ReturnType<RWorld['createRigidBody']>;
type RCollider = ReturnType<RWorld['createCollider']>;
type RShape = InstanceType<RapierAPI['Shape']>;

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
  ): BackendCollider {
    const R = this.R;
    let d: InstanceType<RapierAPI['ColliderDesc']>;
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
  colliderKey(collider: BackendCollider) {
    return (collider as RCollider).handle;
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
    const hit = this._world.castRayAndGetNormal(
      new this.R.Ray(vec(origin), vec(direction)),
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
          distance: hit.timeOfImpact,
          normal: new Vector3(hit.normal.x, hit.normal.y, hit.normal.z)
        }
      : null;
  }
  castRayAll(origin: Vector3, direction: Vector3, maxDistance: number, filter: QueryPredicate) {
    const hits: BackendRayHit[] = [];
    this._world.intersectionsWithRay(
      new this.R.Ray(vec(origin), vec(direction)),
      maxDistance,
      true,
      (hit) => {
        hits.push({
          key: hit.collider.handle,
          distance: hit.timeOfImpact,
          normal: new Vector3(hit.normal.x, hit.normal.y, hit.normal.z)
        });
        return true;
      },
      undefined,
      undefined,
      undefined,
      undefined,
      (c) => filter(c.handle)
    );
    // Ties broken by key, so the order never depends on traversal order.
    return hits.sort((a, b) => a.distance - b.distance || a.key - b.key);
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
    }
  }
}
