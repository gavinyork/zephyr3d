import { Quaternion, Vector3, Vector4 } from '@zephyr3d/base';
import { BoxShape, Mesh, PBRMetallicRoughnessMaterial, SphereShape } from '@zephyr3d/scene';
import type { Scene } from '@zephyr3d/scene';
import { Collider, initPhysics, RigidBody } from '@zephyr3d/physics';
import type { VisualScene } from '../types';
import { bareScene, keyLight, placeCamera } from './common';

function material(color: Vector4) {
  const m = new PBRMetallicRoughnessMaterial();
  m.albedoColor = color;
  m.metallic = 0;
  m.roughness = 0.6;
  return m;
}

function box(scene: Scene, color: Vector4, size: Vector3, position: Vector3, dynamic: boolean) {
  const mesh = new Mesh(scene, new BoxShape({ size: size.x, sizeY: size.y, sizeZ: size.z }), material(color));
  mesh.position.set(position);
  if (dynamic) {
    mesh.addComponent(new RigidBody());
  }
  const collider = new Collider();
  collider.size = size;
  mesh.addComponent(collider);
  return mesh;
}

function ball(scene: Scene, color: Vector4, radius: number, position: Vector3) {
  const mesh = new Mesh(scene, new SphereShape({ radius }), material(color));
  mesh.position.set(position);
  mesh.addComponent(new RigidBody());
  const collider = new Collider();
  collider.shape = 'sphere';
  collider.radius = radius;
  collider.restitution = 0.3;
  mesh.addComponent(collider);
  return mesh;
}

/**
 * Rigid bodies dropped onto a tilted slab and a floor, captured mid-motion.
 *
 * Pins the whole physics path end to end - WebAssembly loading from the
 * package's dist, component registration, fixed stepping driven by the
 * harness's fixed frame time, and pose write-back into the render - not the
 * solver's numbers, which the unit tests cover. Captured while bodies are still
 * moving so that render-pose interpolation is in the image too.
 *
 * Deterministic: the simulation only ever sees fixed steps, and Rapier gives
 * bit-identical results across platforms for identical inputs.
 */
export const physicsDrop: VisualScene = {
  name: 'physics-drop',
  description:
    'Boxes and balls falling onto a tilted slab and a floor. Regresses Rapier loading, stepping and pose write-back.',
  frames: 75,
  async setup({ scene, camera }) {
    await initPhysics();
    bareScene(scene);
    scene.env.light.type = 'constant';
    scene.env.light.ambientColor = new Vector4(0.15, 0.16, 0.2, 1);
    keyLight(scene);

    // Static: no rigid body, just colliders.
    box(scene, new Vector4(0.55, 0.55, 0.55, 1), new Vector3(12, 0.5, 12), new Vector3(0, -0.25, 0), false);
    const slab = box(
      scene,
      new Vector4(0.35, 0.4, 0.5, 1),
      new Vector3(4, 0.3, 3),
      new Vector3(-1.2, 1.2, 0),
      false
    );
    slab.rotation = Quaternion.fromAxisAngle(Vector3.axisPZ(), -0.35);

    const colors = [
      new Vector4(0.9, 0.35, 0.15, 1),
      new Vector4(0.15, 0.45, 0.9, 1),
      new Vector4(0.95, 0.8, 0.2, 1),
      new Vector4(0.3, 0.75, 0.35, 1)
    ];
    for (let i = 0; i < 6; i++) {
      const b = box(
        scene,
        colors[i % 4],
        new Vector3(0.6, 0.6, 0.6),
        new Vector3(-2 + (i % 3) * 0.7, 3 + Math.floor(i / 3) * 0.9, -0.4 + (i % 2) * 0.8),
        true
      );
      b.rotation = Quaternion.fromAxisAngle(new Vector3(1, 1, 0).inplaceNormalize(), i * 0.4);
    }
    for (let i = 0; i < 4; i++) {
      ball(scene, colors[(i + 2) % 4], 0.3, new Vector3(1.5 + (i % 2) * 0.5, 2.5 + i * 0.8, -0.5 + i * 0.35));
    }

    placeCamera(camera, new Vector3(0, 4.5, 9), new Vector3(0, 0.8, 0));
  }
};
