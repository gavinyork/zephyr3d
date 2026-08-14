import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  BoxShape,
  DirectionalLight,
  getDevice,
  LambertMaterial,
  Mesh,
  PBRMetallicRoughnessMaterial,
  PlaneShape,
  SphereShape,
  TorusShape
} from '@zephyr3d/scene';
import type { PerspectiveCamera, Scene, ShadowMode } from '@zephyr3d/scene';
import type { Texture2D } from '@zephyr3d/device';

/**
 * Turns off everything a scene did not explicitly ask for.
 *
 * Scenes in this harness are meant to isolate one feature, which only works if
 * the baseline for "PCSS shadows" is not also silently pinning the atmosphere
 * model and the environment light. Every scene starts from nothing and opts in.
 */
export function bareScene(scene: Scene) {
  scene.env.sky.skyType = 'none';
  scene.env.sky.fogType = 'none';
  scene.env.light.type = 'none';
}

/** Fixed camera placement, so a scene never pins an accidental framing. */
export function placeCamera(camera: PerspectiveCamera, eye: Vector3, target = Vector3.zero()) {
  camera.position.set(eye);
  camera.lookAt(eye, target, Vector3.axisPY());
}

/** A single directional light aimed from the upper front-left. Deterministic by construction. */
export function keyLight(scene: Scene, castShadow = false) {
  const light = new DirectionalLight(scene);
  light.lookAt(new Vector3(4, 6, 5), Vector3.zero(), Vector3.axisPY());
  light.color = new Vector4(1, 0.98, 0.94, 1);
  light.castShadow = castShadow;
  return light;
}

/**
 * Shadow-casting key light for the shadow scenes, plus the shadow configuration
 * they share.
 *
 * Three choices here, each of which the first version of these scenes got wrong
 * badly enough to make the baselines useless:
 *
 * 1. **Light from the side, high** (~37 deg off vertical). Angle is the dominant
 *    factor in ground acne - the original 47 deg striped the entire floor. Going
 *    fully overhead cleans it up but shortens the shadows to almost nothing,
 *    which defeats the point, and lighting from the front throws the shadows
 *    behind the solids where they cannot be seen. Side-on puts them across the
 *    floor roughly perpendicular to the view, which is where they read best.
 *
 * 2. **The engine's own `character-small` preset** rather than hand-tuned bias
 *    numbers. It is what a user with a scene this size would actually reach for
 *    (2048 map, shadowDistance 120, depthBias 0.005, normalBias 0.3), it is
 *    self-documenting, and it means these baselines pin the preset as well as
 *    the filters. It also happens to be what makes ESM work: at the engine
 *    default of a 1024 map with shadowDistance 2000 over a 16-unit stage, ESM's
 *    exponential saturates and the result is a smeared mess with cloudy
 *    artefacts on the casters - ESM was never broken, just starved of texels.
 *
 * 3. **A little constant ambient**, so the unlit halves of the solids do not
 *    collapse to black. Shadowed floor is then ambient-only rather than pure
 *    black, which is what makes the difference between filters legible.
 */
export function shadowKeyLight(scene: Scene, mode: ShadowMode, cascades = 1, usePreset = true) {
  scene.env.light.type = 'constant';
  scene.env.light.ambientColor = new Vector4(0.11, 0.12, 0.15, 1);

  const light = new DirectionalLight(scene);
  light.lookAt(new Vector3(-6, 8, 1.5), Vector3.zero(), Vector3.axisPY());
  light.color = new Vector4(1, 0.98, 0.94, 1);
  light.castShadow = true;
  if (usePreset) {
    // applyQualityPreset forces mode to 'pcf', so the real mode goes on after it.
    light.shadow.applyQualityPreset('character-small');
  }
  // With usePreset false the shadow keeps the constructor defaults (1024 map,
  // shadowDistance 2000, depthBias 0.003, normalBias 0.2) - there is no reset
  // method, "default" simply means not calling the preset. See `shadowDefaults`
  // in shadows.ts for why one scene deliberately stays on them.
  light.shadow.mode = mode;
  light.shadow.numShadowCascades = cascades;
  return light;
}

export function pbr(albedo: Vector4, metallic: number, roughness: number) {
  const m = new PBRMetallicRoughnessMaterial();
  m.albedoColor = albedo;
  m.metallic = metallic;
  m.roughness = roughness;
  return m;
}

export function lambert(albedo: Vector4) {
  const m = new LambertMaterial();
  m.albedoColor = albedo;
  return m;
}

/**
 * Ground plane plus three distinct solids at fixed positions.
 *
 * Shared by the shadow scenes so that what differs between their baselines is
 * the shadow filter and nothing else. The shapes are deliberately unalike -
 * sphere, box, torus - because each stresses shadow silhouettes differently: a
 * smooth terminator, hard edges, and a hole that self-shadows.
 *
 * The ground is sized to the solids rather than generously: a directional
 * shadow map is fitted to the scene bounds, so every unit of unused floor is
 * texels spent on empty space. The original 16-unit plane cost roughly half the
 * shadow-map density for nothing and was a large part of why these scenes were
 * covered in acne.
 */
export function shadowStage(scene: Scene, groundSize = 9) {
  // PlaneShape is an XZ plane at y=0 with a +Y normal, and the default anchor of
  // 0.5 already centres it on the origin - so it needs no translation. Offsetting
  // it by half its size (the obvious-looking `-size/2`) pushes the whole ground
  // off to one side, where it reads as a back wall rather than a floor.
  const ground = new Mesh(
    scene,
    new PlaneShape({ size: groundSize }),
    lambert(new Vector4(0.62, 0.63, 0.66, 1))
  );

  const sphere = new Mesh(scene, new SphereShape({ radius: 1 }), lambert(new Vector4(0.85, 0.3, 0.28, 1)));
  sphere.position.setXYZ(-2.1, 1.15, 0.4);

  const box = new Mesh(scene, new BoxShape({ size: 1.7 }), lambert(new Vector4(0.3, 0.55, 0.85, 1)));
  box.position.setXYZ(0.9, 0.9, -1.3);

  const torus = new Mesh(
    scene,
    new TorusShape({ outerRadius: 1, innerRadius: 0.32 }),
    lambert(new Vector4(0.9, 0.78, 0.3, 1))
  );
  torus.position.setXYZ(2.6, 1.4, 1.2);
  torus.rotation.fromEulerAngle(1.1, 0.4, 0, 'ZYX');

  return { ground, sphere, box, torus };
}

/**
 * Procedural checker + gradient texture, built on the CPU from a fixed formula.
 *
 * Generated rather than loaded so the harness needs no binary fixtures, and so
 * the texture itself can never be the reason a baseline moves. The checker
 * exercises minification/filtering while the gradient makes channel swaps and
 * sRGB mistakes visible.
 */
export function proceduralTexture(size = 64): Texture2D {
  const data = new Uint8Array(size * size * 4);
  const cell = size >> 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const checker = ((x / cell) | 0) + ((y / cell) | 0);
      const dark = (checker & 1) === 1;
      data[i] = dark ? 40 : 230;
      data[i + 1] = Math.round((x / (size - 1)) * 255);
      data[i + 2] = Math.round((y / (size - 1)) * 255);
      data[i + 3] = 255;
    }
  }
  const tex = getDevice().createTexture2D('rgba8unorm', size, size);
  if (!tex) {
    throw new Error('proceduralTexture: texture creation failed');
  }
  tex.update(data, 0, 0, size, size);
  return tex;
}
