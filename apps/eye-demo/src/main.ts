import { Vector3, Vector4 } from '@zephyr3d/base';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import {
  Application,
  DirectionalLight,
  EyeMaterial,
  getDevice,
  getEngine,
  getInput,
  Mesh,
  OrbitCameraController,
  PerspectiveCamera,
  Scene
} from '@zephyr3d/scene';
import type { Texture2D } from '@zephyr3d/device';
import { ImGui, imGuiEndFrame, imGuiInit, imGuiInjectEvent, imGuiNewFrame } from '@zephyr3d/imgui';
import { createEyeballPrimitive } from './eyeball-mesh';
import {
  DEFAULT_IRIS,
  DEFAULT_SCLERA,
  generateIris,
  generateSclera,
  type IrisParams,
  type ScleraParams
} from './iris-texture';

const app = new Application({
  canvas: document.querySelector<HTMLCanvasElement>('#canvas')!,
  backend: backendWebGL2
});

await app.ready();
const device = getDevice();
await imGuiInit(device);
for (const ev of ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'keydown', 'keyup', 'keypress']) {
  device.canvas.addEventListener(ev, (e) => imGuiInjectEvent(e));
}

const scene = new Scene();
scene.env.sky.skyType = 'none';
scene.env.sky.fogType = 'none';
scene.env.light.type = 'constant';
scene.env.light.ambientColor = new Vector4(0.14, 0.15, 0.18, 1);

const camera = new PerspectiveCamera(scene, Math.PI / 5, 0.1, 50);
camera.position.setXYZ(0, 0, 4.2);
camera.controller = new OrbitCameraController({ center: Vector3.zero() });
scene.mainCamera = camera;
getInput().use(camera.handleEvent, camera);
getEngine().setRenderable(scene, 0);

const key = new DirectionalLight(scene);
key.lookAt(new Vector3(3, 4, 5), Vector3.zero(), Vector3.axisPY());
key.color = new Vector4(1, 0.98, 0.95, 1);

const fill = new DirectionalLight(scene);
fill.lookAt(new Vector3(-4, 1, 2), Vector3.zero(), Vector3.axisPY());
fill.color = new Vector4(0.35, 0.4, 0.5, 1);

const material = new EyeMaterial();
material.vertexTangent = true;
material.irisRadius = 0.16;
new Mesh(scene, createEyeballPrimitive(), material);

// --- procedural textures ----------------------------------------------------

const irisParams: IrisParams = { ...DEFAULT_IRIS };
const scleraParams: ScleraParams = { ...DEFAULT_SCLERA };
const TEX_SIZE = 512;
let irisTex: Texture2D | null = null;
let scleraTex: Texture2D | null = null;
let lastIrisData: Uint8Array<ArrayBuffer> | null = null;
let lastScleraData: Uint8Array<ArrayBuffer> | null = null;

function rebuildIris() {
  lastIrisData = generateIris(irisParams, TEX_SIZE);
  if (!irisTex) {
    irisTex = device.createTexture2D('rgba8unorm-srgb', TEX_SIZE, TEX_SIZE)!;
    material.irisTexture = irisTex;
  }
  irisTex.update(lastIrisData, 0, 0, TEX_SIZE, TEX_SIZE);
}

function rebuildSclera() {
  lastScleraData = generateSclera(scleraParams, TEX_SIZE);
  if (!scleraTex) {
    scleraTex = device.createTexture2D('rgba8unorm-srgb', TEX_SIZE, TEX_SIZE)!;
    material.scleraTexture = scleraTex;
  }
  scleraTex.update(lastScleraData, 0, 0, TEX_SIZE, TEX_SIZE);
}

/**
 * Writes a generated map out as a PNG.
 *
 * The point of the demo is to reach a look before production textures exist, so
 * whatever is on screen has to be handed to an artist as a starting layer -
 * otherwise the tuning has to be redone from scratch once real maps arrive.
 */
function downloadTexture(data: Uint8Array<ArrayBuffer> | null, filename: string) {
  if (!data) {
    return;
  }
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = TEX_SIZE;
  const ctx = cvs.getContext('2d')!;
  const img = ctx.createImageData(TEX_SIZE, TEX_SIZE);
  img.data.set(data);
  ctx.putImageData(img, 0, 0);
  cvs.toBlob((blob) => {
    if (!blob) {
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

/** Replaces a generated map with a real one, so production art can be dropped in. */
async function loadCustomTexture(file: File, target: 'iris' | 'sclera') {
  const bitmap = await createImageBitmap(file);
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = TEX_SIZE;
  const ctx = cvs.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, TEX_SIZE, TEX_SIZE);
  // Copy rather than alias the ImageData buffer: its type is ArrayBufferLike,
  // and the texture upload path requires a plain ArrayBuffer.
  const data = new Uint8Array(ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE).data);
  if (target === 'iris') {
    lastIrisData = data;
    irisTex!.update(data, 0, 0, TEX_SIZE, TEX_SIZE);
  } else {
    lastScleraData = data;
    scleraTex!.update(data, 0, 0, TEX_SIZE, TEX_SIZE);
  }
}

document.querySelector<HTMLInputElement>('#iris-file')!.addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) {
    void loadCustomTexture(f, 'iris');
  }
});
document.querySelector<HTMLInputElement>('#sclera-file')!.addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) {
    void loadCustomTexture(f, 'sclera');
  }
});

rebuildIris();
rebuildSclera();

// --- presets ----------------------------------------------------------------

/**
 * Starting points rather than finished looks. Twelve interacting parameters is
 * too many to tune from scratch, and the difference between the two is mostly
 * about how much the material is allowed to depart from physical values.
 */
const PRESETS: Record<string, () => void> = {
  Realistic: () => {
    material.irisDepth = 0.06;
    material.ior = 1.376;
    material.irisBrightness = 0.12;
    material.limbalRingWidth = 0.12;
    material.limbalRingStrength = 0.75;
    material.corneaSpecularStrength = 1;
    material.corneaRoughness = 0.05;
    material.scleraWrap = 0.35;
    material.irisColor = new Vector4(1, 1, 1, 1);
  },
  'Idol / stylised': () => {
    // Deeper chamber and a brighter iris read better at broadcast distance and
    // under stage lighting, at the cost of being slightly beyond physical.
    material.irisDepth = 0.085;
    material.ior = 1.45;
    material.irisBrightness = 0.35;
    material.limbalRingWidth = 0.18;
    material.limbalRingStrength = 0.95;
    material.corneaSpecularStrength = 1.8;
    material.corneaRoughness = 0.03;
    material.scleraWrap = 0.5;
    material.irisColor = new Vector4(1.25, 1.2, 1.15, 1);
  }
};

// --- UI ---------------------------------------------------------------------

function slider(label: string, value: number, min: number, max: number, apply: (v: number) => void) {
  const v = [value] as [number];
  if (ImGui.SliderFloat(label, v, min, max)) {
    apply(v[0]);
  }
}

function colorEdit(label: string, color: [number, number, number], apply: () => void) {
  const c = [color[0], color[1], color[2]] as [number, number, number];
  if (ImGui.ColorEdit3(label, c)) {
    color[0] = c[0];
    color[1] = c[1];
    color[2] = c[2];
    apply();
  }
}

function drawUI() {
  imGuiNewFrame();
  ImGui.SetNextWindowSize(new ImGui.ImVec2(340, 0), ImGui.Cond.FirstUseEver);
  ImGui.Begin('Eye material');

  if (ImGui.CollapsingHeader('Presets', ImGui.TreeNodeFlags.DefaultOpen)) {
    for (const name of Object.keys(PRESETS)) {
      if (ImGui.Button(name)) {
        PRESETS[name]();
      }
      ImGui.SameLine();
    }
    ImGui.NewLine();
  }

  if (ImGui.CollapsingHeader('Cornea & parallax', ImGui.TreeNodeFlags.DefaultOpen)) {
    slider('Iris depth', material.irisDepth, 0, 0.2, (v) => (material.irisDepth = v));
    slider('IOR', material.ior, 1, 1.8, (v) => (material.ior = v));
    slider('Iris radius', material.irisRadius, 0.05, 0.35, (v) => (material.irisRadius = v));
    slider('Specular', material.corneaSpecularStrength, 0, 4, (v) => (material.corneaSpecularStrength = v));
    slider('Roughness', material.corneaRoughness, 0.001, 0.3, (v) => (material.corneaRoughness = v));
  }

  if (ImGui.CollapsingHeader('Pupil', ImGui.TreeNodeFlags.DefaultOpen)) {
    slider('Dilation', material.pupilDilation, -1, 1, (v) => (material.pupilDilation = v));
  }

  if (ImGui.CollapsingHeader('Iris & limbus')) {
    slider('Brightness', material.irisBrightness, 0, 1, (v) => (material.irisBrightness = v));
    slider('Limbal width', material.limbalRingWidth, 0, 0.6, (v) => (material.limbalRingWidth = v));
    slider('Limbal strength', material.limbalRingStrength, 0, 1, (v) => (material.limbalRingStrength = v));
  }

  if (ImGui.CollapsingHeader('Sclera')) {
    slider('Wrap', material.scleraWrap, 0, 1.5, (v) => (material.scleraWrap = v));
    const t = material.scleraEdgeTint;
    slider('Vein tint strength', t.w, 0, 1, (v) => {
      material.scleraEdgeTint = new Vector4(t.x, t.y, t.z, v);
    });
  }

  if (ImGui.CollapsingHeader('Iris texture')) {
    colorEdit('Outer colour', irisParams.color, rebuildIris);
    colorEdit('Inner colour', irisParams.innerColor, rebuildIris);
    slider('Fibres', irisParams.fibreCount, 40, 500, (v) => {
      irisParams.fibreCount = Math.round(v);
      rebuildIris();
    });
    slider('Fibre contrast', irisParams.fibreContrast, 0, 1, (v) => {
      irisParams.fibreContrast = v;
      rebuildIris();
    });
    slider('Collarette', irisParams.collaretteRadius, 0.2, 0.7, (v) => {
      irisParams.collaretteRadius = v;
      rebuildIris();
    });
    slider('Crypts', irisParams.cryptAmount, 0, 1, (v) => {
      irisParams.cryptAmount = v;
      rebuildIris();
    });
    slider('Texture pupil', irisParams.pupilRadius, 0.1, 0.6, (v) => {
      irisParams.pupilRadius = v;
      rebuildIris();
    });
    slider('Limbus darkening', irisParams.limbusDarkening, 0, 1, (v) => {
      irisParams.limbusDarkening = v;
      rebuildIris();
    });
    if (ImGui.Button('Re-roll iris')) {
      irisParams.seed = (irisParams.seed * 1664525 + 1013904223) >>> 0;
      rebuildIris();
    }
    ImGui.SameLine();
    if (ImGui.Button('Export iris PNG')) {
      downloadTexture(lastIrisData, 'iris.png');
    }
  }

  if (ImGui.CollapsingHeader('Sclera texture')) {
    colorEdit('Base colour', scleraParams.color, rebuildSclera);
    slider('Vessels', scleraParams.vesselCount, 0, 40, (v) => {
      scleraParams.vesselCount = Math.round(v);
      rebuildSclera();
    });
    slider('Vessel strength', scleraParams.vesselStrength, 0, 1, (v) => {
      scleraParams.vesselStrength = v;
      rebuildSclera();
    });
    if (ImGui.Button('Re-roll sclera')) {
      scleraParams.seed = (scleraParams.seed * 1664525 + 1013904223) >>> 0;
      rebuildSclera();
    }
    ImGui.SameLine();
    if (ImGui.Button('Export sclera PNG')) {
      downloadTexture(lastScleraData, 'sclera.png');
    }
  }

  ImGui.Separator();
  ImGui.Text('Drag to orbit - parallax only reads off-axis');
  ImGui.End();
  imGuiEndFrame();
}

// The UI is registered as a render layer rather than drawn from the tick
// handler. Application.frame() dispatches 'tick' *before* engine.render(), so
// anything drawn there is immediately painted over by the scene; layer 1 runs
// after layer 0 and lands on top.
getEngine().setRenderable(drawUI, 1);

app.on('tick', () => {
  camera.updateController();
});

app.run();
