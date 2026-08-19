import { Vector3, Vector4 } from '@zephyr3d/base';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import {
  Application,
  BoundingBox,
  DirectionalLight,
  getDevice,
  getEngine,
  getInput,
  HairStrandData,
  HairStrandMaterial,
  Mesh,
  OrbitCameraController,
  PerspectiveCamera,
  Primitive,
  Scene
} from '@zephyr3d/scene';
import { parseAlembicCurves, type AlembicCurveObject } from '@zephyr3d/loaders';
import { ImGui, imGuiEndFrame, imGuiInit, imGuiInjectEvent, imGuiNewFrame } from '@zephyr3d/imgui';

/** Where the sample groom lives when no local file is supplied. */
const SAMPLE_URL = 'https://cdn.zephyr3d.org/misc/hair.abc';
/**
 * Maya authors in centimetres and the engine works in metres.
 *
 * @remarks
 * The sample archive puts the scalp around y=1.5 once scaled, which is where a
 * head would be if the character were standing on the origin.
 */
const CM_TO_M = 0.01;

const statusEl = document.querySelector<HTMLDivElement>('#status')!;
function setStatus(text: string, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

// Storage buffers in the vertex stage are WebGPU-only, so the strand path needs
// it; falling back to WebGL2 would compile-fail on the first frame rather than
// degrade, so the demo says so up front instead.
const webgpuOK = await backendWebGPU.supported();
const app = new Application({
  canvas: document.querySelector<HTMLCanvasElement>('#canvas')!,
  backend: webgpuOK ? backendWebGPU : backendWebGL2
});

await app.ready();
const device = getDevice();
await imGuiInit(device);
getInput().use(imGuiInjectEvent);

const scene = new Scene();
scene.env.sky.skyType = 'none';
scene.env.sky.fogType = 'none';
scene.env.light.type = 'constant';
scene.env.light.ambientColor = new Vector4(0.06, 0.07, 0.09, 1);

const camera = new PerspectiveCamera(scene, Math.PI / 5, 0.05, 50);
camera.position.setXYZ(0, 1.55, 0.75);
camera.controller = new OrbitCameraController({ center: new Vector3(0, 1.52, 0) });
scene.mainCamera = camera;
getInput().use(camera.handleEvent, camera);
getEngine().setRenderable(scene, 0);

// Three-point-ish rig: hair reads almost entirely through its specular lobes, so
// a single light leaves most of the head unlit and hides the anisotropy.
const key = new DirectionalLight(scene);
key.lookAt(new Vector3(2, 3.4, 2.6), new Vector3(0, 1.5, 0), Vector3.axisPY());
key.color = new Vector4(1, 0.97, 0.92, 1);
key.intensity = 3;

const fill = new DirectionalLight(scene);
fill.lookAt(new Vector3(-2.6, 1.8, 1.4), new Vector3(0, 1.5, 0), Vector3.axisPY());
fill.color = new Vector4(0.4, 0.48, 0.62, 1);
fill.intensity = 1.2;

const rim = new DirectionalLight(scene);
rim.lookAt(new Vector3(-0.6, 2.4, -2.6), new Vector3(0, 1.5, 0), Vector3.axisPY());
rim.color = new Vector4(0.8, 0.72, 0.6, 1);
rim.intensity = 2;

const material = new HairStrandMaterial();
material.albedoColor = new Vector4(0.09, 0.055, 0.038, 1);
material.specular1Color = new Vector3(0.28, 0.28, 0.28);
material.specular1Power = 180;
material.specular2Color = new Vector3(0.42, 0.3, 0.2);
material.specular2Power = 32;
material.transmissionColor = new Vector3(0.55, 0.26, 0.12);
material.transmissionIntensity = 0.35;
material.segmentsPerStrand = 8;
material.minPixelWidth = 1.3;
// A real strand is far thinner than a pixel, so the shader widens it to the
// pixel floor and scales alpha by how much it widened. That alpha only means
// something if the material actually blends: left opaque, every strand paints a
// full pixel and the groom reads as a solid shell rather than as hair.
material.blendMode = 'blend';

/** Everything the UI needs to know about the loaded groom. */
type LoadStats = {
  objects: number;
  strands: number;
  points: number;
  gpuBytes: number;
  parseMs: number;
  uploadMs: number;
  application: string;
};

let stats: LoadStats | null = null;
let strandData: HairStrandData | null = null;
let mesh: Mesh | null = null;
/** Fraction of strands kept, so a dense groom can be thinned for framerate. */
let strandFraction = 1;
let lastCurves: AlembicCurveObject[] | null = null;
/** Set once a local file is picked, so the in-flight sample download is dropped. */
let sampleSuperseded = false;

/**
 * Merges the archive's curve objects into one strand set.
 *
 * @remarks
 * XGen writes one object per spline description - hair, brows, lashes - and the
 * demo renders them as a single draw, because they share a material and nothing
 * here needs to address them separately. `keepFraction` drops whole strands
 * evenly rather than shortening them, since thinning a groom is what an LOD
 * would do and truncating strands is not.
 */
function mergeCurves(curves: AlembicCurveObject[], keepFraction: number) {
  const stride = keepFraction >= 1 ? 1 : Math.max(1, Math.round(1 / keepFraction));
  let strandTotal = 0;
  let pointTotal = 0;
  for (const c of curves) {
    for (let i = 0; i < c.numVertices.length; i += stride) {
      strandTotal++;
      pointTotal += c.numVertices[i];
    }
  }
  const positions = new Float32Array(pointTotal * 3);
  const widths = new Float32Array(pointTotal);
  const uv = new Float32Array(pointTotal * 2);
  const counts = new Int32Array(strandTotal);

  let strandCursor = 0;
  let pointCursor = 0;
  for (const c of curves) {
    // Running offset of each strand within this object's point array.
    let first = 0;
    const uvPerPoint = !!c.uv && c.uv.length >= c.totalPoints * 2;
    for (let i = 0; i < c.numVertices.length; i++) {
      const count = c.numVertices[i];
      if (i % stride === 0) {
        counts[strandCursor++] = count;
        for (let k = 0; k < count; k++) {
          const src = (first + k) * 3;
          const dst = (pointCursor + k) * 3;
          positions[dst] = c.positions[src];
          positions[dst + 1] = c.positions[src + 1];
          positions[dst + 2] = c.positions[src + 2];
          widths[pointCursor + k] = c.width ? c.width[c.widthPerCurve ? i : first + k] : 0.0001;
          if (c.uv) {
            const o = uvPerPoint ? (first + k) * 2 : i * 2;
            uv[(pointCursor + k) * 2] = c.uv[o];
            uv[(pointCursor + k) * 2 + 1] = c.uv[o + 1];
          }
        }
        pointCursor += count;
      }
      first += count;
    }
  }
  return { positions, pointCounts: counts, widths, uv };
}

/** World-space bounds of the strand set, padded by the widest strand. */
function boundsOf(positions: Float32Array, widths: Float32Array, scale: number) {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] * scale;
    const y = positions[i + 1] * scale;
    const z = positions[i + 2] * scale;
    if (x < min.x) {
      min.x = x;
    }
    if (y < min.y) {
      min.y = y;
    }
    if (z < min.z) {
      min.z = z;
    }
    if (x > max.x) {
      max.x = x;
    }
    if (y > max.y) {
      max.y = y;
    }
    if (z > max.z) {
      max.z = z;
    }
  }
  // Width shares the archive's linear unit with position, so it takes the same
  // conversion before being used as world-space padding.
  let pad = 0;
  for (let i = 0; i < widths.length; i++) {
    if (widths[i] > pad) {
      pad = widths[i];
    }
  }
  pad *= scale;
  min.setXYZ(min.x - pad, min.y - pad, min.z - pad);
  max.setXYZ(max.x + pad, max.y + pad, max.z + pad);
  return new BoundingBox(min, max);
}

/** Rebuilds the GPU buffers and the mesh from the currently loaded curves. */
function rebuildStrands() {
  if (!lastCurves) {
    return;
  }
  const t0 = performance.now();
  const merged = mergeCurves(lastCurves, strandFraction);
  strandData?.dispose();
  strandData = new HairStrandData({
    positions: merged.positions,
    pointCounts: merged.pointCounts,
    widths: merged.widths,
    uv: merged.uv,
    scale: CM_TO_M
  });
  material.strands = strandData;

  mesh?.remove();
  const primitive = new Primitive();
  // No attribute is read; the layout exists only so a draw can be issued.
  primitive.createAndSetVertexBuffer('position_f32x3', new Float32Array(3));
  primitive.indexCount = material.vertexCount;
  primitive.primitiveType = 'triangle-list';
  primitive.setBoundingVolume(boundsOf(merged.positions, merged.widths, CM_TO_M));
  mesh = new Mesh(scene, primitive, material);

  const uploadMs = performance.now() - t0;
  if (stats) {
    stats.strands = strandData.strandCount;
    stats.points = strandData.pointCount;
    stats.gpuBytes = strandData.byteLength;
    stats.uploadMs = uploadMs;
  }
  const centre = mesh.getWorldBoundingVolume()?.toAABB();
  if (centre) {
    const mid = centre.center;
    camera.controller = new OrbitCameraController({ center: new Vector3(mid.x, mid.y, mid.z) });
    getInput().use(camera.handleEvent, camera);
  }
  setStatus(describeStats());
}

function describeStats() {
  if (!stats) {
    return '';
  }
  const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
  return [
    `${stats.application || 'Alembic'} - ${stats.objects} curve object(s)`,
    `${stats.strands.toLocaleString()} strands, ${stats.points.toLocaleString()} control points`,
    `GPU ${mb(stats.gpuBytes)} - parse ${stats.parseMs.toFixed(0)} ms, upload ${stats.uploadMs.toFixed(0)} ms`,
    `Triangles ${(material.vertexCount / 3).toLocaleString()} at ${material.segmentsPerStrand} segments/strand`
  ].join('\n');
}

/** Parses an archive and swaps it in. */
function loadArchive(buffer: ArrayBuffer) {
  const t0 = performance.now();
  const archive = parseAlembicCurves(buffer);
  const parseMs = performance.now() - t0;
  if (archive.curves.length === 0) {
    setStatus('Archive contains no curve objects.', true);
    return;
  }
  lastCurves = archive.curves;
  stats = {
    objects: archive.curves.length,
    strands: 0,
    points: 0,
    gpuBytes: 0,
    parseMs,
    uploadMs: 0,
    application: archive.application
  };
  rebuildStrands();
}

async function loadSample() {
  if (!webgpuOK) {
    setStatus(
      'This demo needs WebGPU: the strand vertex shader reads storage buffers, which WebGL2 does not support.',
      true
    );
    return;
  }
  try {
    const res = await fetch(SAMPLE_URL);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    // The body is ~80 MB and can take minutes on a slow link, so it is read in
    // chunks and reported. Awaiting arrayBuffer() directly leaves the UI claiming
    // it is parsing while it is really still downloading, which reads as a hang.
    const total = Number(res.headers.get('content-length') ?? 0);
    const reader = res.body?.getReader();
    if (!reader) {
      setStatus('Parsing archive...');
      loadArchive(await res.arrayBuffer());
      return;
    }
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (sampleSuperseded) {
        await reader.cancel();
        return;
      }
      chunks.push(value);
      received += value.length;
      const mb = (received / 1048576).toFixed(1);
      setStatus(
        total
          ? `Downloading sample groom: ${mb} / ${(total / 1048576).toFixed(1)} MB (${((received / total) * 100).toFixed(0)}%)`
          : `Downloading sample groom: ${mb} MB`
      );
    }
    const buffer = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) {
      buffer.set(c, offset);
      offset += c.length;
    }
    setStatus('Parsing archive...');
    if (sampleSuperseded) {
      return;
    }
    loadArchive(buffer.buffer);
  } catch (err) {
    setStatus(`Failed to load sample: ${err instanceof Error ? err.message : String(err)}`, true);
  }
}

document.querySelector<HTMLInputElement>('#abc-file')!.addEventListener('change', async (ev) => {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (!file) {
    return;
  }
  // A local pick supersedes the sample: without this the CDN download would
  // finish minutes later and silently replace what the user just opened.
  sampleSuperseded = true;
  setStatus(`Parsing ${file.name}...`);
  try {
    loadArchive(await file.arrayBuffer());
  } catch (err) {
    setStatus(`Failed to parse: ${err instanceof Error ? err.message : String(err)}`, true);
  }
});

void loadSample();

// --- UI ---------------------------------------------------------------------

function slider(label: string, value: number, min: number, max: number, apply: (v: number) => void) {
  const ref: [number] = [value];
  if (ImGui.SliderFloat(label, ref, min, max)) {
    apply(ref[0]);
  }
}

function colorEdit(label: string, colour: Vector3, apply: (v: Vector3) => void) {
  const ref: [number, number, number] = [colour.x, colour.y, colour.z];
  if (ImGui.ColorEdit3(label, ref)) {
    apply(new Vector3(ref[0], ref[1], ref[2]));
  }
}

function drawUI() {
  imGuiNewFrame();
  ImGui.SetNextWindowPos(new ImGui.ImVec2(12, 12), ImGui.Cond.FirstUseEver);
  ImGui.SetNextWindowSize(new ImGui.ImVec2(320, 0), ImGui.Cond.FirstUseEver);
  ImGui.Begin('Hair strands');

  ImGui.Text(`${device.type} - ${(device.frameInfo.FPS ?? 0).toFixed(0)} fps`);
  ImGui.Separator();

  if (ImGui.CollapsingHeader('Geometry', ImGui.TreeNodeFlags.DefaultOpen)) {
    slider('Segments/strand', material.segmentsPerStrand, 1, 24, (v) => {
      material.segmentsPerStrand = Math.round(v);
      // The draw range is a function of the segment count, so it has to follow.
      if (mesh) {
        mesh.primitive!.indexCount = material.vertexCount;
      }
      setStatus(describeStats());
    });
    const pct: [number] = [strandFraction * 100];
    if (ImGui.SliderFloat('Strands kept (%)', pct, 1, 100)) {
      strandFraction = pct[0] / 100;
    }
    if (ImGui.Button('Apply density')) {
      rebuildStrands();
    }
    slider('Width scale', material.strandWidthScale, 0.1, 20, (v) => (material.strandWidthScale = v));
    slider('Min pixel width', material.minPixelWidth, 0, 4, (v) => (material.minPixelWidth = v));
    const blend: [boolean] = [material.blendMode === 'blend'];
    if (ImGui.Checkbox('Blend (use coverage alpha)', blend)) {
      material.blendMode = blend[0] ? 'blend' : 'none';
    }
  }

  if (ImGui.CollapsingHeader('Shading', ImGui.TreeNodeFlags.DefaultOpen)) {
    const albedo = material.albedoColor;
    const ref: [number, number, number] = [albedo.x, albedo.y, albedo.z];
    if (ImGui.ColorEdit3('Base colour', ref)) {
      material.albedoColor = new Vector4(ref[0], ref[1], ref[2], albedo.w);
    }
    colorEdit('Primary lobe', material.specular1Color, (v) => (material.specular1Color = v));
    slider('Primary power', material.specular1Power, 8, 400, (v) => (material.specular1Power = v));
    slider('Primary shift', material.specular1Shift, -0.5, 0.5, (v) => (material.specular1Shift = v));
    colorEdit('Secondary lobe', material.specular2Color, (v) => (material.specular2Color = v));
    slider('Secondary power', material.specular2Power, 4, 200, (v) => (material.specular2Power = v));
    slider('Secondary shift', material.specular2Shift, -0.5, 0.5, (v) => (material.specular2Shift = v));
    slider('Diffuse wrap', material.diffuseWrap, 0, 1, (v) => (material.diffuseWrap = v));
    colorEdit('Transmission', material.transmissionColor, (v) => (material.transmissionColor = v));
    slider('Transmission', material.transmissionIntensity, 0, 2, (v) => {
      material.transmissionIntensity = v;
    });
  }

  ImGui.Separator();
  ImGui.TextWrapped('Drag to orbit, wheel to zoom. Density changes need Apply.');
  ImGui.End();
  imGuiEndFrame();
}

// Registered as a layer rather than drawn from 'tick': Application.frame()
// dispatches 'tick' before engine.render(), so anything drawn there is painted
// over by the scene. Layer 1 runs after layer 0 and lands on top.
getEngine().setRenderable(drawUI, 1);

app.on('tick', () => {
  camera.updateController();
});

app.run();
