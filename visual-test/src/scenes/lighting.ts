import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  BlinnMaterial,
  BoxShape,
  Mesh,
  PBRBluePrintMaterial,
  PlaneShape,
  PointLight,
  RectLight,
  SSSMaterial,
  SphereShape,
  SpotLight
} from '@zephyr3d/scene';
import type { Scene, ShadowMode } from '@zephyr3d/scene';
import type { VisualScene } from '../types';
import { bareScene, lambert, pbr, placeCamera } from './common';

/**
 * Many small point lights over a plane, laid out on a fixed lattice.
 *
 * This is the clustered forward path's actual job: light-to-cluster assignment.
 * A handful of lights would all land in the same few clusters and pass even with
 * the binning badly wrong, so the lattice is sized and spaced to straddle cluster
 * boundaries, and the lights are given short ranges so each one's footprint has a
 * visible edge where a misassignment shows up as a hard discontinuity.
 */
export const clusterManyLights: VisualScene = {
  name: 'cluster-many-lights',
  description: '24 short-range point lights on a lattice. Pins clustered-forward light assignment.',
  setup({ scene, camera }) {
    bareScene(scene);

    new Mesh(scene, new PlaneShape({ size: 24 }), lambert(new Vector4(0.5, 0.52, 0.55, 1)));

    // A few solids so the lights also have vertical surfaces to fall on.
    for (let i = 0; i < 5; i++) {
      const sphere = new Mesh(
        scene,
        new SphereShape({ radius: 0.6 }),
        pbr(new Vector4(0.8, 0.8, 0.82, 1), 0, 0.4)
      );
      sphere.position.setXYZ((i - 2) * 2.2, 0.6, -1.5);
    }

    const COLS = 6;
    const ROWS = 4;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const light = new PointLight(scene);
        light.position.setXYZ((c - (COLS - 1) / 2) * 2.1, 1.1, (r - (ROWS - 1) / 2) * 2.4);
        light.range = 2.6;
        light.intensity = 6;
        // Deterministic colour cycle - no randomness anywhere in this harness.
        const t = (r * COLS + c) / (ROWS * COLS);
        light.color = new Vector4(
          0.5 + 0.5 * Math.sin(t * 6.283),
          0.5 + 0.5 * Math.sin(t * 6.283 + 2.09),
          0.5 + 0.5 * Math.sin(t * 6.283 + 4.19),
          1
        );
      }
    }

    placeCamera(camera, new Vector3(0, 6.5, 9.5), new Vector3(0, 0.5, 0));
  }
};

/**
 * A spot light's cone edge and its shadow, which exercise a different projection
 * and a different shadow-map layout from the directional cases in shadows.ts.
 */
export const spotShadow: VisualScene = {
  name: 'spot-shadow',
  description: 'Shadow-casting spot light. Pins perspective shadow projection and cone falloff.',
  setup({ scene, camera }) {
    bareScene(scene);
    // Same reasoning as the directional shadow scenes: a little ambient so the
    // unlit surfaces stay readable, and a ground plane sized to the subject
    // rather than generously, since the shadow map is fitted to the bounds.
    scene.env.light.type = 'constant';
    scene.env.light.ambientColor = new Vector4(0.11, 0.12, 0.15, 1);
    new Mesh(scene, new PlaneShape({ size: 9 }), lambert(new Vector4(0.6, 0.61, 0.64, 1)));
    const sphere = new Mesh(scene, new SphereShape({ radius: 1 }), lambert(new Vector4(0.85, 0.4, 0.3, 1)));
    sphere.position.setXYZ(0, 1.4, 0);

    const light = new SpotLight(scene);
    light.lookAt(new Vector3(-4, 6, 2), Vector3.zero(), Vector3.axisPY());
    light.range = 22;
    light.intensity = 14;
    light.castShadow = true;
    light.shadow.applyQualityPreset('character-small');
    light.shadow.mode = 'pcf';

    placeCamera(camera, new Vector3(0.5, 4.2, 8), new Vector3(0, 0.8, 0));
    camera.far = 40;
  }
};

/**
 * A 2 x 1 rect light hanging level over the stage, emitting straight down.
 *
 * Aimed with an up vector along -Z so the rect's width runs along world X, which
 * keeps the light's footprint and its reflections axis-aligned in the frame.
 */
function overheadRectLight(scene: Scene, intensity: number) {
  const light = new RectLight(scene);
  light.lookAt(new Vector3(0, 2.2, -0.4), new Vector3(0, 0, -0.4), Vector3.axisNZ());
  light.width = 2;
  light.height = 1;
  light.range = 12;
  light.intensity = intensity;
  light.color = new Vector4(1, 0.97, 0.92, 1);
  return light;
}

/**
 * Rough dielectrics under a rect light: the diffuse form factor.
 *
 * The LTC integral already returns the form factor, so a white Lambertian
 * surface under the light reads `intensity * albedo * formFactor` and nothing
 * else. Pins that normalization, the one-sided emission (nothing behind the
 * light's plane may be lit - the upper back of the room stays black) and the
 * horizon clipping on the spheres' terminators.
 */
export const rectLightDiffuse: VisualScene = {
  name: 'rect-light-diffuse',
  description: 'Rect light over rough surfaces. Pins the LTC diffuse form factor and one-sided emission.',
  setup({ scene, camera }) {
    bareScene(scene);
    new Mesh(scene, new PlaneShape({ size: 10 }), pbr(new Vector4(0.6, 0.6, 0.6, 1), 0, 0.9));
    for (let i = 0; i < 3; i++) {
      const sphere = new Mesh(
        scene,
        new SphereShape({ radius: 0.6 }),
        pbr(new Vector4(0.75, 0.75, 0.75, 1), 0, 0.9)
      );
      sphere.position.setXYZ((i - 1) * 2, 0.6, 0);
    }
    overheadRectLight(scene, 8);
    placeCamera(camera, new Vector3(0, 3.2, 6.5), new Vector3(0, 0.6, 0));
  }
};

/**
 * Glossy surfaces under a rect light: the LTC specular lobe.
 *
 * The floor mirrors the light as a sharp-cornered rectangle and the metal
 * spheres blur it from a perfect mirror to roughness 0.6. The mirror is the
 * regime an 8-bit LUT destroyed - it quantized the inverse matrix's z scale to
 * zero and the reflection vanished - so the left sphere pins the float LUT and
 * the 0.02 roughness floor as much as the lobe shape.
 */
export const rectLightGlossy: VisualScene = {
  name: 'rect-light-glossy',
  description:
    'Rect light over a glossy floor and metal spheres of rising roughness. Pins the LTC specular lobe.',
  setup({ scene, camera }) {
    bareScene(scene);
    new Mesh(scene, new PlaneShape({ size: 10 }), pbr(new Vector4(0.08, 0.08, 0.09, 1), 0, 0.08));
    const roughness = [0, 0.25, 0.6];
    for (let i = 0; i < 3; i++) {
      const sphere = new Mesh(
        scene,
        new SphereShape({ radius: 0.6 }),
        pbr(new Vector4(0.95, 0.93, 0.88, 1), 1, roughness[i])
      );
      sphere.position.setXYZ((i - 1) * 2, 0.6, 0);
    }
    overheadRectLight(scene, 3);
    placeCamera(camera, new Vector3(0, 3.2, 6.5), new Vector3(0, 0.6, 0));
  }
};

/**
 * The rect light under physical lighting, in real units.
 *
 * A 2000 cd/m² softbox (the same 2 x 1 panel as the legacy scenes) seen through
 * an interior exposure of f/2.8, 1/30 s, ISO 100. Physical mode reads the light's
 * `luminance` rather than its unitless `intensity` and scales the result by the
 * camera exposure, so this pins that path end to end: a white Lambertian floor
 * right under the panel reads `luminance * albedo * formFactor` before exposure,
 * about 150 cd/m² here, which this exposure maps to roughly mid-grey. A
 * normalization off by 2*pi - the bug this scene was added with - drops the
 * whole frame to near black.
 *
 * Rough dielectric, glossy metal and mirror spheres share the frame, so diffuse
 * and specular are pinned against each other as well as against the exposure.
 */
export const rectLightPhysical: VisualScene = {
  name: 'rect-light-physical',
  description:
    'Rect light in physical units under a real exposure. Pins luminance and the LTC normalization.',
  setup({ scene, camera }) {
    bareScene(scene);
    scene.lightingMode = 'physical';
    camera.aperture = 2.8;
    camera.shutterSpeed = 1 / 30;
    camera.ISO = 100;
    new Mesh(scene, new PlaneShape({ size: 10 }), pbr(new Vector4(0.6, 0.6, 0.6, 1), 0, 0.6));
    const materials = [
      pbr(new Vector4(0.75, 0.75, 0.75, 1), 0, 0.9),
      pbr(new Vector4(0.95, 0.93, 0.88, 1), 1, 0.25),
      pbr(new Vector4(0.95, 0.93, 0.88, 1), 1, 0)
    ];
    for (let i = 0; i < 3; i++) {
      const sphere = new Mesh(scene, new SphereShape({ radius: 0.6 }), materials[i]);
      sphere.position.setXYZ((i - 1) * 2, 0.6, 0);
    }
    overheadRectLight(scene, 1).luminance = 2000;
    placeCamera(camera, new Vector3(0, 3.2, 6.5), new Vector3(0, 0.6, 0));
  }
};

/**
 * A shadow-casting rect light, with casters placed where an area light's
 * shadows are hardest to get right.
 *
 * The panel is small and high, and both solids stand well outside the prism
 * straight below it. A rect light lights a whole hemisphere, so its shadow map
 * has to be a cube from the light's centre (UE5 renders the point light's cube
 * for it): the shadows must then fall away from the light, radially, and lengthen
 * with the offset. The earlier orthographic map covered only the panel's own
 * footprint - these casters threw no shadow at all under it, and anything inside
 * it was projected straight down.
 */
/**
 * The off-axis shadow stage shared by the rect-light shadow scenes, lit by a
 * rect or point light at the same spot in the given shadow mode.
 */
function offAxisShadowStage(kind: 'rect' | 'point', mode: ShadowMode): VisualScene['setup'] {
  return ({ scene, camera }) => {
    bareScene(scene);
    scene.env.light.type = 'constant';
    scene.env.light.ambientColor = new Vector4(0.02, 0.02, 0.025, 1);
    new Mesh(scene, new PlaneShape({ size: 12 }), pbr(new Vector4(0.6, 0.6, 0.6, 1), 0, 0.8));
    const sphere = new Mesh(
      scene,
      new SphereShape({ radius: 0.5 }),
      pbr(new Vector4(0.8, 0.35, 0.25, 1), 0, 0.6)
    );
    sphere.position.setXYZ(1.7, 0.5, 0.3);
    const box = new Mesh(scene, new BoxShape({ size: 0.8 }), pbr(new Vector4(0.3, 0.5, 0.8, 1), 0, 0.6));
    box.position.setXYZ(-1.6, 0.4, -0.6);

    let light: RectLight | PointLight;
    if (kind === 'rect') {
      const rect = new RectLight(scene);
      rect.lookAt(new Vector3(0, 2.6, 0), new Vector3(0, 0, 0), Vector3.axisNZ());
      rect.width = 1;
      rect.height = 0.5;
      rect.intensity = 30;
      light = rect;
    } else {
      const point = new PointLight(scene);
      point.position.setXYZ(0, 2.6, 0);
      point.intensity = 15;
      light = point;
    }
    light.range = 12;
    light.castShadow = true;
    light.shadow.applyQualityPreset('character-small');
    light.shadow.mode = mode;

    placeCamera(camera, new Vector3(0, 4.5, 6.5), new Vector3(0, 0.3, 0));
  };
}

export const rectLightShadow: VisualScene = {
  name: 'rect-light-shadow',
  description: 'Shadow-casting rect light with casters off its axis. Pins the cube shadow projection.',
  setup: offAxisShadowStage('rect', 'pcf')
};

/**
 * Deep opacity map shadows from a rect light, and from a point light below.
 *
 * Both render cube maps, which the deep opacity map could neither build nor
 * read: its layers went into a 2D target while the shadow mapper selected cube
 * faces on a framebuffer it never drew to, and the receiver projected through a
 * 2D shadow coordinate. The casters are solid, so the shadows must come out as
 * dark as the other modes' - which is also the check that the layers are
 * measured from the right end of a radial depth that reverse-Z does not flip.
 */
export const rectLightShadowDom: VisualScene = {
  name: 'rect-light-shadow-dom',
  description: 'Rect light casting deep opacity map shadows. Pins the cube-map DOM caster and receiver.',
  supports: (backend) => backend === 'webgpu',
  setup: offAxisShadowStage('rect', 'dom')
};

export const pointLightShadowDom: VisualScene = {
  name: 'point-light-shadow-dom',
  description: 'Point light casting deep opacity map shadows. Pins the cube-map DOM caster and receiver.',
  supports: (backend) => backend === 'webgpu',
  setup: offAxisShadowStage('point', 'dom')
};

/**
 * The rect light on the materials that have no area-light integration of their
 * own: Lambert, Blinn-Phong and skin, left to right.
 *
 * They light a rect through its vector form factor - one direction and an
 * attenuation of pi times the form factor, which gives the rect's exact
 * irradiance while it is above the surface's horizon. Before that they treated
 * it as a point light at its centre: inverse-square falloff, luminance read as
 * candela, and light in every direction. The sphere floating above the panel
 * pins the last of those - rect lights are one-sided, so it must stay at the
 * ambient level rather than light up from below.
 */
export const rectLightMaterials: VisualScene = {
  name: 'rect-light-materials',
  description:
    'Rect light over Lambert, Blinn and skin spheres, with one sphere above the panel. Pins the form-factor path and one-sided emission.',
  setup({ scene, camera }) {
    bareScene(scene);
    scene.env.light.type = 'constant';
    scene.env.light.ambientColor = new Vector4(0.04, 0.04, 0.05, 1);
    new Mesh(scene, new PlaneShape({ size: 10 }), lambert(new Vector4(0.6, 0.6, 0.6, 1)));
    const blinn = new BlinnMaterial();
    blinn.albedoColor = new Vector4(0.75, 0.75, 0.75, 1);
    const skin = new SSSMaterial();
    skin.albedoColor = new Vector4(0.85, 0.66, 0.58, 1);
    const materials = [lambert(new Vector4(0.75, 0.75, 0.75, 1)), blinn, skin];
    for (let i = 0; i < 3; i++) {
      const sphere = new Mesh(scene, new SphereShape({ radius: 0.6 }), materials[i]);
      sphere.position.setXYZ((i - 1) * 2, 0.6, 0);
    }
    const above = new Mesh(
      scene,
      new SphereShape({ radius: 0.35 }),
      lambert(new Vector4(0.75, 0.75, 0.75, 1))
    );
    above.position.setXYZ(2.4, 2.9, -0.4);
    overheadRectLight(scene, 8);
    placeCamera(camera, new Vector3(0, 3.2, 6.5), new Vector3(0, 0.9, 0));
  }
};

/**
 * Blueprint PBR beside the metallic-roughness model under the same rect light.
 *
 * Both integrate the rect with the same LTC now, so the default blueprint -
 * white metal at roughness 1 - must read like the metallic-roughness sphere
 * next to it. It used to approximate the rect with four point lights at the
 * corners of a 2x2 grid, which put a cluster of four highlights where the
 * reflection of one panel belongs and missed its energy near the light.
 */
export const rectLightBlueprint: VisualScene = {
  name: 'rect-light-blueprint',
  description:
    'Default blueprint PBR beside a matching metallic-roughness sphere under one rect light. Pins that both use the LTC integration.',
  setup({ scene, camera }) {
    bareScene(scene);
    new Mesh(scene, new PlaneShape({ size: 10 }), lambert(new Vector4(0.5, 0.5, 0.5, 1)));
    const materials = [new PBRBluePrintMaterial(), pbr(new Vector4(1, 1, 1, 1), 1, 1)];
    for (let i = 0; i < 2; i++) {
      const sphere = new Mesh(scene, new SphereShape({ radius: 0.6 }), materials[i]);
      sphere.position.setXYZ((i - 0.5) * 2, 0.6, 0);
    }
    overheadRectLight(scene, 8);
    placeCamera(camera, new Vector3(0, 3.2, 6.5), new Vector3(0, 0.6, 0));
  }
};

/**
 * PCSS under a small and a large rect light, which must soften differently.
 *
 * The penumbra is derived from the panel's own size - the radius of the disc of
 * equal area - and the receiver's distance, so the large panel's shadows spread
 * much wider and both harden towards the contact points. The PCSS light radius
 * used to be one fixed size in texels whatever the light was.
 */
function rectLightPcssScene(width: number, height: number): VisualScene['setup'] {
  return ({ scene, camera }) => {
    bareScene(scene);
    scene.env.light.type = 'constant';
    scene.env.light.ambientColor = new Vector4(0.02, 0.02, 0.025, 1);
    new Mesh(scene, new PlaneShape({ size: 12 }), pbr(new Vector4(0.6, 0.6, 0.6, 1), 0, 0.8));
    const box = new Mesh(scene, new BoxShape({ size: 0.5 }), pbr(new Vector4(0.3, 0.5, 0.8, 1), 0, 0.6));
    box.position.setXYZ(-0.9, 0.85, 0);
    const post = new Mesh(
      scene,
      new BoxShape({ sizeX: 0.12, sizeY: 1.4, sizeZ: 0.12 }),
      pbr(new Vector4(0.8, 0.35, 0.25, 1), 0, 0.6)
    );
    post.position.setXYZ(1, 0.7, 0);
    const light = new RectLight(scene);
    light.lookAt(new Vector3(0, 2.6, 0), new Vector3(0, 0, 0), Vector3.axisNZ());
    light.width = width;
    light.height = height;
    light.range = 12;
    light.intensity = (30 * 0.5) / (width * height);
    light.castShadow = true;
    light.shadow.applyQualityPreset('character-small');
    light.shadow.mode = 'pcss';
    light.shadow.pcssTemporalJitter = false;
    // Room for the large panel's penumbra: the default 32-texel budget clamps
    // both panels to the same width and hides the difference this pins.
    light.shadow.pcssMaxFilterRadius = 160;
    // And the most taps the filter allows, so a wide penumbra is a gradient
    // rather than a stack of offset copies of the shadow.
    light.shadow.pcssFilterSampleCount = 64;
    light.shadow.pcssBlockerSampleCount = 64;
    placeCamera(camera, new Vector3(0, 4.5, 6.5), new Vector3(0, 0.3, 0));
  };
}

export const rectLightPcssSmall: VisualScene = {
  name: 'rect-light-pcss-small',
  description: 'PCSS under a 0.25 x 0.25 rect light. Pairs with rect-light-pcss-large: tight penumbrae.',
  setup: rectLightPcssScene(0.25, 0.25)
};

export const rectLightPcssLarge: VisualScene = {
  name: 'rect-light-pcss-large',
  description:
    'PCSS under a 1.5 x 1 rect light. Pairs with rect-light-pcss-small: wide penumbrae that harden at contact.',
  setup: rectLightPcssScene(1.5, 1)
};
/**
 * A head-sized sphere casting onto a wall behind it, under a rect light with
 * the default PCSS settings.
 *
 * The penumbra must fade out smoothly into the lit wall. The cube-map PCSS
 * compared every tap with the receiver's depth at the kernel's centre, and a
 * cube stores distance from the light, which across a wide kernel varies over
 * the wall itself - so the wall shadowed itself on one side of every kernel.
 * The penumbra flattened into a plateau of false shadow that cut to fully lit,
 * along a hard outline, wherever the blocker search stopped finding the
 * sphere. Taps are now compared against the receiver's plane.
 */
export const rectLightPcssWall: VisualScene = {
  name: 'rect-light-pcss-wall',
  description:
    'Sphere shadowing a wall under a rect light with default PCSS. Pins the receiver-plane depth that keeps the penumbra edge soft.',
  setup({ scene, camera }) {
    bareScene(scene);
    scene.env.light.type = 'constant';
    scene.env.light.ambientColor = new Vector4(0.02, 0.02, 0.025, 1);
    const wall = new Mesh(
      scene,
      new BoxShape({ sizeX: 3, sizeY: 3, sizeZ: 0.05 }),
      pbr(new Vector4(0.6, 0.6, 0.6, 1), 0, 0.8)
    );
    wall.position.setXYZ(0, 1.5, -0.6);
    const head = new Mesh(
      scene,
      new SphereShape({ radius: 0.12 }),
      pbr(new Vector4(0.8, 0.6, 0.5, 1), 0, 0.6)
    );
    head.position.setXYZ(0, 1.5, 0);
    const light = new RectLight(scene);
    light.lookAt(new Vector3(0, 1.5, 1.2), new Vector3(0, 1.5, 0), Vector3.axisPY());
    light.width = 0.6;
    light.height = 0.6;
    light.range = 8;
    light.intensity = 20;
    light.castShadow = true;
    light.shadow.mode = 'pcss';
    placeCamera(camera, new Vector3(0.9, 1.6, 1.6), new Vector3(0, 1.4, -0.6));
  }
};

/**
 * A shadow-casting rect light left at range 0.
 *
 * 0 is the automatic range, as for point lights: derived from the light's
 * output and never shorter than its diagonal. The shader used to read 0 as "no
 * falloff" while the light's bounds collapsed to a point and its shadow camera's
 * far plane to 0, so the light was culled and cast nothing - this scene rendered
 * black.
 */
export const rectLightAutoRange: VisualScene = {
  name: 'rect-light-auto-range',
  description:
    'Shadow-casting rect light at range 0. Pins the automatic range for lighting, culling and shadows.',
  setup({ scene, camera }) {
    bareScene(scene);
    new Mesh(scene, new PlaneShape({ size: 10 }), pbr(new Vector4(0.6, 0.6, 0.6, 1), 0, 0.8));
    const sphere = new Mesh(
      scene,
      new SphereShape({ radius: 0.5 }),
      pbr(new Vector4(0.8, 0.35, 0.25, 1), 0, 0.6)
    );
    sphere.position.setXYZ(0.8, 0.5, 0.3);
    const light = overheadRectLight(scene, 8);
    light.range = 0;
    light.castShadow = true;
    light.shadow.applyQualityPreset('character-small');
    light.shadow.mode = 'pcf';
    placeCamera(camera, new Vector3(0, 3.2, 6.5), new Vector3(0, 0.6, 0));
  }
};
