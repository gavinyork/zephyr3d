import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  OrbitCameraController,
  PerspectiveCamera,
  Mesh,
  BoxShape,
  DirectionalLight,
  PointLight,
  PlaneShape,
  SphereShape,
  TorusShape,
  PBRMetallicRoughnessMaterial,
  getInput,
  getEngine
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

// Emissive strength of each sphere in the row: each emits twice the previous one, so the
// row spans a factor of 32. Bloom only picks up what is brighter than the threshold, so a
// ramp straddling it is what makes the effect legible - the left spheres stay matte, the
// right ones bleed light into their surroundings.
//
// The ramp stays monotone all the way to the top because Bloom runs before tone mapping
// and therefore works on scene-linear radiance. Pushed much further the halos simply grow
// into each other and the row stops reading as separate spheres, which is a framing limit
// rather than the saturation ceiling this example used to hit.
const EMISSIVE_RAMP = [0.5, 1, 2, 4, 8, 16];
const EMISSIVE_TINT = new Vector3(1, 0.92, 0.78);

myApp.ready().then(function () {
  const scene = new Scene();

  // A dark interior. Bloom is about bright spots standing apart from what surrounds
  // them, so a lit outdoor sky would leave nothing for it to do.
  scene.env.sky.skyType = 'none';
  scene.env.sky.fogType = 'none';
  scene.env.light.type = 'constant';
  scene.env.light.ambientColor = new Vector4(0.03, 0.033, 0.042, 1);

  // Dim fill light, only so the unlit geometry still reads as solid objects
  const fill = new DirectionalLight(scene);
  fill.lookAt(new Vector3(2, 6, 8), Vector3.zero(), Vector3.axisPY());
  fill.color = new Vector4(0.55, 0.6, 0.75, 1);
  fill.intensity = 0.5;

  // Glossy floor, so every emitter also appears as a stretched reflection
  const floorMaterial = new PBRMetallicRoughnessMaterial();
  floorMaterial.albedoColor = new Vector4(0.05, 0.05, 0.06, 1);
  floorMaterial.metallic = 0.85;
  floorMaterial.roughness = 0.22;
  new Mesh(scene, new PlaneShape({ size: 90 }), floorMaterial);

  // Matte back wall: the surface the glow spills onto, which is what makes the
  // effect obvious rather than something you have to look for.
  const wallMaterial = new PBRMetallicRoughnessMaterial();
  wallMaterial.albedoColor = new Vector4(0.1, 0.1, 0.115, 1);
  wallMaterial.metallic = 0;
  wallMaterial.roughness = 0.9;
  const wall = new Mesh(scene, new BoxShape({ sizeX: 70, sizeY: 30, sizeZ: 0.5 }), wallMaterial);
  wall.position.setXYZ(0, 15, -16);

  // A row of identical spheres whose only difference is how brightly they emit
  const sphereShape = new SphereShape({ radius: 0.95, horizonalDetail: 32, verticalDetail: 24 });
  EMISSIVE_RAMP.forEach((strength, index) => {
    const material = new PBRMetallicRoughnessMaterial();
    material.albedoColor = new Vector4(0.06, 0.06, 0.07, 1);
    material.metallic = 0;
    material.roughness = 0.45;
    material.emissiveColor = EMISSIVE_TINT;
    material.emissiveStrength = strength;
    const sphere = new Mesh(scene, sphereShape, material);
    sphere.position.setXYZ(index * 5 - 12.5, 1.3, 0);
    // Emitters also cast light, so they read as real sources instead of stickers.
    // An emissive material never illuminates anything on its own.
    //
    // The light is kept deliberately mild and only mildly tied to the ramp: matching a
    // 100x emissive range with a 100x light would wash the floor out completely, and the
    // point here is the glow, not the illumination.
    if (strength >= 1) {
      const light = new PointLight(scene);
      light.color = new Vector4(EMISSIVE_TINT.x, EMISSIVE_TINT.y, EMISSIVE_TINT.z, 1);
      light.intensity = 2 + Math.log10(strength) * 1.5;
      light.range = 16;
      light.position.setXYZ(index * 5 - 12.5, 1.3, 0);
    }
  });

  // Two saturated rings, to show that bloom carries the color of whatever glows
  const torusShape = new TorusShape({ outerRadius: 2.6, innerRadius: 0.3, numSlices: 64 });
  const rings = [
    { color: new Vector3(0.15, 0.8, 1), position: new Vector3(-7, 7, -9) },
    { color: new Vector3(1, 0.25, 0.65), position: new Vector3(7, 7, -9) }
  ].map((desc) => {
    const material = new PBRMetallicRoughnessMaterial();
    material.albedoColor = new Vector4(0.05, 0.05, 0.06, 1);
    material.metallic = 0;
    material.roughness = 0.4;
    material.emissiveColor = desc.color;
    material.emissiveStrength = 2.5;
    const ring = new Mesh(scene, torusShape, material);
    ring.position.set(desc.position);
    const light = new PointLight(scene);
    light.color = new Vector4(desc.color.x, desc.color.y, desc.color.z, 1);
    light.intensity = 4;
    light.range = 20;
    light.position.set(desc.position);
    return ring;
  });

  // Create camera
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 200);
  scene.mainCamera.lookAt(new Vector3(0, 6, 23), new Vector3(0, 4, -2), Vector3.axisPY());
  scene.mainCamera.controller = new OrbitCameraController({ center: new Vector3(0, 4, -2) });
  scene.mainCamera.bloomThreshold = 0.9;
  // A soft knee keeps the ramp a gradient instead of a hard on/off at one sphere
  scene.mainCamera.bloomThresholdKnee = 0.5;
  // Modest, because Bloom now composes in linear light before the ACES curve: the glow
  // is added to unclamped radiance, so a little goes much further than it used to.
  scene.mainCamera.bloomIntensity = 0.35;

  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  // Toggle Bloom through the UI buttons
  const btnOff = document.querySelector('#btn-off');
  const btnOn = document.querySelector('#btn-on');

  function setBloom(enabled) {
    scene.mainCamera.bloom = enabled;
    btnOff.classList.toggle('active', !enabled);
    btnOn.classList.toggle('active', enabled);
    btnOff.setAttribute('aria-pressed', String(!enabled));
    btnOn.setAttribute('aria-pressed', String(enabled));
  }

  btnOff.addEventListener('click', () => setBloom(false));
  btnOn.addEventListener('click', () => setBloom(true));
  setBloom(true);

  // Threshold and intensity are the two parameters worth feeling directly
  /** @type {HTMLInputElement} */
  const thresholdInput = document.querySelector('#threshold');
  /** @type {HTMLInputElement} */
  const intensityInput = document.querySelector('#intensity');
  const thresholdValue = document.querySelector('#threshold-value');
  const intensityValue = document.querySelector('#intensity-value');

  function syncThreshold() {
    const value = Number(thresholdInput.value);
    scene.mainCamera.bloomThreshold = value;
    thresholdValue.textContent = value.toFixed(2);
  }

  function syncIntensity() {
    const value = Number(intensityInput.value);
    scene.mainCamera.bloomIntensity = value;
    intensityValue.textContent = value.toFixed(2);
  }

  thresholdInput.value = String(scene.mainCamera.bloomThreshold);
  intensityInput.value = String(scene.mainCamera.bloomIntensity);
  thresholdInput.addEventListener('input', syncThreshold);
  intensityInput.addEventListener('input', syncIntensity);
  syncThreshold();
  syncIntensity();

  getEngine().setRenderable(scene, 0);

  myApp.on('tick', function () {
    const t = myApp.device.frameInfo.elapsedOverall * 0.0004;
    rings[0].rotation.fromEulerAngle(t, t * 0.7, 0);
    rings[1].rotation.fromEulerAngle(-t * 0.8, -t, 0);
  });

  myApp.run();
});
