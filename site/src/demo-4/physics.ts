import { BoxShape, Mesh, Scene, SphereShape, TorusShape } from "@zephyr3d/scene";
import AmmoType from '../../types/ammo-wasm';

declare global {
  var Ammo: typeof AmmoType;
}

export type MeshPhysicsParams = {
  mass: number;

}
export class PhysicsWorld {
  private _ammo: typeof AmmoType;
  private _tmpTransform: AmmoType.btTransform;
  private _tmpVector3: AmmoType.btVector3;
  private _tmpQuaternion: AmmoType.btQuaternion;
  private _bodyMap: Map<Mesh, AmmoType.btRigidBody>;
  private _world: AmmoType.btDiscreteDynamicsWorld;
  private _lastTime: number;
  private _frameRate: number;
  constructor(frameRate = 60) {
    this._tmpTransform = null;
    this._frameRate = frameRate;
    this._tmpTransform = null;
    this._tmpVector3 = null;
    this._tmpQuaternion = null;
    this._lastTime = 0;
    this._bodyMap = new Map();
    this._world = null;
  }
  async initWithScene(scene: Scene, params: Map<Mesh, MeshPhysicsParams>) {
    this._ammo = await Ammo();
    const collisionConfiguration = new this._ammo.btDefaultCollisionConfiguration();
    const dispatcher = new this._ammo.btCollisionDispatcher( collisionConfiguration );
    const broadphase = new this._ammo.btDbvtBroadphase();
    const solver = new this._ammo.btSequentialImpulseConstraintSolver();
    this._world = new this._ammo.btDiscreteDynamicsWorld( dispatcher, broadphase, solver, collisionConfiguration );
    this._world.setGravity( new this._ammo.btVector3( 0, -9.8, 0 ) );
    this._tmpTransform = new this._ammo.btTransform();
    this._tmpVector3 = new this._ammo.btVector3();
    this._tmpQuaternion = new this._ammo.btQuaternion(0, 0, 0, 1);
    scene.rootNode.iterate(node => {
      if (node.isMesh()) {
        const shape = this.createShapeFromMesh(node);
        if (shape) {
          const physic = params.get(node);
          const mass = physic.mass ?? 0;
          const position = node.position;
          const rotation = node.rotation;
          this._tmpVector3.setValue(position.x, position.y, position.z);
          this._tmpQuaternion.setValue(rotation.x, rotation.y, rotation.z, rotation.w);
          this._tmpTransform.setIdentity();
          this._tmpTransform.setOrigin(this._tmpVector3);
          this._tmpTransform.setRotation(this._tmpQuaternion);
          const motionState = new this._ammo.btDefaultMotionState(this._tmpTransform);
          this._tmpVector3.setValue(0, 0, 0);
          shape.calculateLocalInertia(mass, this._tmpVector3);
          const rbInfo = new this._ammo.btRigidBodyConstructionInfo(mass, motionState, shape, this._tmpVector3);
          const body = new this._ammo.btRigidBody(rbInfo);
          this._world.addRigidBody(body);
          this._bodyMap.set(node, body);
        }
      }
    });
  }
  step(){
    const time = performance.now();
    if (this._lastTime > 0) {
      const delta = (time - this._lastTime) / 1000;
      this._world.stepSimulation(delta, 10);
      this._bodyMap.forEach((body, mesh) => {
        const motionState = body.getMotionState();
        motionState.getWorldTransform(this._tmpTransform);
        const position = this._tmpTransform.getOrigin();
        const rotation = this._tmpTransform.getRotation();
        mesh.position.setXYZ(position.x(), position.y(), position.z());
        mesh.rotation.setXYZW(rotation.x(), rotation.y(), rotation.z(), rotation.w());
      });
    } else {
      this._lastTime = time;
    }
  }
  start() {
    setInterval(() => {
      this.step();
    }, 1000/this._frameRate);
  }
  private createShapeFromMesh(mesh: Mesh) {
    const primitive = mesh.primitive;
    if (!primitive) {
      return null;
    }
    if (primitive instanceof BoxShape) {
      const x = primitive.width / 2;
      const y = primitive.height / 2;
      const z = primitive.depth / 2;
      this._tmpVector3.setValue(x, y, z);
      const shape = new this._ammo.btBoxShape(this._tmpVector3);
      shape.setMargin(0.05);
      return shape;
    } else if (primitive instanceof SphereShape) {
      const radius = primitive.radius;
      const shape = new this._ammo.btSphereShape(radius);
      shape.setMargin(0.05);
      return shape;
    } else {
      return null;
    }
  }
}
