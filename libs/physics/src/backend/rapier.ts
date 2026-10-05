import type { Quaternion, Vector3 } from '@zephyr3d/base';
import type { RapierAPI } from '../rapier_loader';
import type {
  BackendBody,
  BackendCollider,
  BackendWorld,
  BodyDesc,
  ColliderMaterialDesc,
  MotionType,
  ShapeDesc
} from './types';

type RWorld = InstanceType<RapierAPI['World']>;
type RBody = ReturnType<RWorld['createRigidBody']>;
type RCollider = ReturnType<RWorld['createCollider']>;

function bodyType(R: RapierAPI, type: MotionType) {
  return type === 'dynamic'
    ? R.RigidBodyType.Dynamic
    : type === 'kinematic'
      ? R.RigidBodyType.KinematicPositionBased
      : R.RigidBodyType.Fixed;
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
  setPose(position: Vector3, rotation: Quaternion) {
    this.body.setTranslation(position, true);
    this.body.setRotation(rotation, true);
  }
  setKinematicTarget(position: Vector3, rotation: Quaternion) {
    this.body.setNextKinematicTranslation(position);
    this.body.setNextKinematicRotation(rotation);
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
    this.body.setLinvel(v, true);
  }
  getAngularVelocity(out: Vector3) {
    const v = this.body.angvel();
    return out.setXYZ(v.x, v.y, v.z);
  }
  setAngularVelocity(v: Vector3) {
    this.body.setAngvel(v, true);
  }
  setForce(force: Vector3, torque: Vector3) {
    const wake =
      force.x !== 0 || force.y !== 0 || force.z !== 0 || torque.x !== 0 || torque.y !== 0 || torque.z !== 0;
    this.body.resetForces(false);
    this.body.resetTorques(false);
    if (wake) {
      this.body.addForce(force, true);
      this.body.addTorque(torque, true);
    }
  }
  applyImpulse(impulse: Vector3, torqueImpulse: Vector3) {
    this.body.applyImpulse(impulse, true);
    this.body.applyTorqueImpulse(torqueImpulse, true);
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
  constructor(private readonly R: RapierAPI) {
    this._world = new R.World({ x: 0, y: -9.81, z: 0 });
  }
  setGravity(gravity: Vector3) {
    this._world.gravity = { x: gravity.x, y: gravity.y, z: gravity.z };
  }
  createBody(desc: BodyDesc): BackendBody {
    const R = this.R;
    const d = new R.RigidBodyDesc(bodyType(R, desc.motionType))
      .setTranslation(desc.position.x, desc.position.y, desc.position.z)
      .setRotation({ x: desc.rotation.x, y: desc.rotation.y, z: desc.rotation.z, w: desc.rotation.w })
      .setLinearDamping(desc.linearDamping)
      .setAngularDamping(desc.angularDamping)
      .setGravityScale(desc.gravityScale)
      .setCcdEnabled(desc.ccd)
      .setCanSleep(desc.canSleep);
    if (desc.motionType === 'dynamic') {
      d.setAdditionalMass(Math.max(desc.mass, 1e-6));
    }
    return new RapierBody(R, this._world.createRigidBody(d));
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
      .setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w })
      .setFriction(material.friction)
      .setRestitution(material.restitution)
      .setSensor(material.isTrigger)
      // Mass lives on the body (RigidBody.mass), not in collider densities.
      .setDensity(0);
    return this._world.createCollider(d, (body as RapierBody).body);
  }
  removeCollider(collider: BackendCollider) {
    this._world.removeCollider(collider as RCollider, true);
  }
  step(dt: number) {
    this._world.timestep = dt;
    this._world.step();
  }
  dispose() {
    this._world.free();
  }
}
