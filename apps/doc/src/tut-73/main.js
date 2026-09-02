import { Vector3, Vector4 } from '@zephyr3d/base';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import {
  Application,
  DirectionalLight,
  getEngine,
  Mesh,
  PBRMetallicRoughnessMaterial,
  PerspectiveCamera,
  Scene,
  SphereShape,
  BoxShape
} from '@zephyr3d/scene';

/** @type {HTMLCanvasElement} */
const canvas = document.querySelector('#my-canvas');
/** @type {HTMLDivElement} */
const status = document.querySelector('#status');

async function chooseBackend() {
  const requested = new URL(window.location.href).searchParams.get('dev');
  if (requested === 'webgpu') {
    if (await backendWebGPU.supported()) {
      return backendWebGPU;
    }
    throw new Error('WebGPU is not supported by this browser.');
  }
  if (requested === 'webgl2') {
    if (await backendWebGL2.supported()) {
      return backendWebGL2;
    }
    throw new Error('WebGL2 is not supported by this browser.');
  }
  if (await backendWebGL2.supported()) {
    return backendWebGL2;
  }
  if (await backendWebGPU.supported()) {
    return backendWebGPU;
  }
  throw new Error('Motion Blur requires WebGL2 or WebGPU.');
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.hidden = false;
  status.classList.toggle('error', isError);
}

(async function () {
  try {
    const app = new Application({
      backend: await chooseBackend(),
      canvas
    });
    await app.ready();

    const scene = new Scene();
    scene.env.sky.skyType = 'none';
    scene.env.sky.fogType = 'none';
    scene.env.light.type = 'constant';
    scene.env.light.ambientColor = new Vector4(0.06, 0.07, 0.1, 1);

    const key = new DirectionalLight(scene);
    key.lookAt(new Vector3(4, 7, 6), Vector3.zero(), Vector3.axisPY());
    key.color = new Vector4(1, 0.96, 0.9, 1);
    key.intensity = 1.8;

    // The box spins in place while the two spheres orbit it, which puts both
    // kinds of motion in one frame: the spheres translate, so every pixel of
    // one carries the same velocity, while the box's velocity turns across its
    // own surface. The second is the harder case for the filter to reconstruct
    // and the more interesting one to watch.
    const centerMaterial = new PBRMetallicRoughnessMaterial();
    centerMaterial.albedoColor = new Vector4(0.9, 0.8, 0.3, 1);
    centerMaterial.metallic = 0;
    centerMaterial.roughness = 0.84;
    const center = new Mesh(scene, new BoxShape({ size: 1.7 }), centerMaterial);
    center.position.setXYZ(0, 0.85, 0);

    const sphereShape = new SphereShape({ radius: 0.7, horizonalDetail: 32, verticalDetail: 24 });
    const redMaterial = new PBRMetallicRoughnessMaterial();
    redMaterial.albedoColor = new Vector4(0.95, 0.12, 0.08, 1);
    redMaterial.metallic = 0.25;
    redMaterial.roughness = 0.2;
    const cyanMaterial = new PBRMetallicRoughnessMaterial();
    cyanMaterial.albedoColor = new Vector4(0.08, 0.72, 0.95, 1);
    cyanMaterial.metallic = 0.25;
    cyanMaterial.roughness = 0.2;
    const redSphere = new Mesh(scene, sphereShape, redMaterial);
    const cyanSphere = new Mesh(scene, sphereShape, cyanMaterial);

    scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 0.1, 100);
    scene.mainCamera.position.setXYZ(0, 4.25, 10.5);
    scene.mainCamera.lookAt(new Vector3(0, 4.25, 10.5), new Vector3(0, 1, 0), Vector3.axisPY());
    scene.mainCamera.motionBlur = true;
    scene.mainCamera.motionBlurStrength = 1;

    const btnOff = document.querySelector('#btn-off');
    const btnOn = document.querySelector('#btn-on');

    function setMotionBlur(enabled) {
      scene.mainCamera.motionBlur = enabled;
      btnOff.classList.toggle('active', !enabled);
      btnOn.classList.toggle('active', enabled);
      btnOff.setAttribute('aria-pressed', String(!enabled));
      btnOn.setAttribute('aria-pressed', String(enabled));
    }

    btnOff.addEventListener('click', () => setMotionBlur(false));
    btnOn.addEventListener('click', () => setMotionBlur(true));
    setMotionBlur(true);

    setStatus(`Backend: ${app.device.type}`);
    getEngine().setRenderable(scene, 0);

    app.on('tick', () => {
      const seconds = app.device.frameInfo.elapsedOverall * 0.001;
      const angle = seconds * 8.2;
      const radius = 5;
      redSphere.position.setXYZ(Math.cos(angle) * radius, 1.55, Math.sin(angle) * radius);
      cyanSphere.position.setXYZ(
        Math.cos(angle + Math.PI) * radius,
        1.55,
        Math.sin(angle + Math.PI) * radius
      );
      center.rotation.fromEulerAngle(seconds * 5, seconds * 5, seconds * 5);
    });

    app.run();
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
})();
