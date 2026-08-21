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
  type HairShadingModel,
  Mesh,
  OrbitCameraController,
  PerspectiveCamera,
  Primitive,
  Scene
} from '@zephyr3d/scene';
import { parseAlembicCurves, parseHairFile, type StrandCurveSet } from '@zephyr3d/loaders';
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
/**
 * Largest extent a unit-less groom is scaled to, in metres.
 *
 * @remarks
 * Alembic comes out of Maya, so its unit is known. A HAIR file records none at
 * all, and the published models are authored at whatever size suited their
 * author - some span a couple of units, others a couple of hundred - so a fixed
 * conversion cannot work for them. Fitting the largest extent to a head-sized
 * box is not a unit conversion and does not pretend to be one; it just puts the
 * model in front of the camera.
 */
const UNITLESS_TARGET_EXTENT = 0.35;

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
/*
scene.env.sky.skyType = 'none';
scene.env.light.type = 'constant';
scene.env.light.ambientColor = new Vector4(0.06, 0.07, 0.09, 1);
*/
scene.env.sky.fogType = 'none';

const camera = new PerspectiveCamera(scene, Math.PI / 5, 0.05, 50);
camera.position.setXYZ(0, 1.55, 0.75);
camera.controller = new OrbitCameraController({ center: new Vector3(0, 1.52, 0) });
camera.TAA = true;
// Only consulted when the material is actually transparent: the opaque and
// dither blend modes put the hair in the opaque queue, which no OIT pass runs
// over. Set up front so switching to alpha-blend in the UI lands on peeling
// rather than on whatever happened to be default.
camera.oitMode = 'dual-depth';
camera.oitDualDepthPeels = 3;
scene.mainCamera = camera;
getInput().use(camera.handleEvent, camera);
getEngine().setRenderable(scene, 0);

// Three-point-ish rig: hair reads almost entirely through its specular lobes, so
// a single light leaves most of the head unlit and hides the anisotropy.
const key = new DirectionalLight(scene);
key.lookAt(new Vector3(2, 3.4, 2.6), new Vector3(0, 1.5, 0), Vector3.axisPY());
key.color = new Vector4(1, 0.97, 0.92, 1);
// Only the key casts. Hair self-shadowing is the thing being shown, and three
// shadow-casting lights would overlay three grooms' worth of it and make none of
// them readable - besides costing three shadow map renders of 70k strands.
key.castShadow = true;
key.shadow.shadowMapSize = 2048;
// The engine default is 2000, fitted over a groom about a third of a metre
// across. Every unit of that range is depth precision spent on empty space, and
// for the deep opacity map it is also what the layer span is measured against.
key.shadow.shadowDistance = 6;
key.shadow.numShadowCascades = 1;

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
// Without this the transparent queue never reaches the shadow pass, so switching
// the blend mode to alpha-blend would silently drop the groom out of its own
// shadow map. The deep opacity map ignores the cutoff - it integrates coverage
// rather than testing it - but a depth-based mode still needs one, and a low
// value keeps the sub-pixel strands that carry most of the transmittance.
material.transparentShadowCaster = true;
material.shadowAlphaCutoff = 0.01;

/**
 * Scattering models the demo can switch between.
 *
 * @remarks
 * Ordered so the array index doubles as the ImGui combo selection. The double
 * lobe is first because it is the material default.
 */
const SHADING_MODELS: HairShadingModel[] = ['kajiya-kay', 'marschner'];

/** How the demo resolves strand coverage into pixels. */
type BlendModeName = 'opaque' | 'alpha-dither' | 'alpha-blend';
const BLEND_MODES: BlendModeName[] = ['opaque', 'alpha-dither', 'alpha-blend'];
/** Which OIT algorithm resolves the transparent queue, for `alpha-blend`. */
type OitModeName = 'ddp' | 'weighted';
const OIT_MODES: OitModeName[] = ['ddp', 'weighted'];

/**
 * Kept outside the material so switching away from dithering and back does not
 * lose the value - the other two modes need the cutoff at zero.
 */
let ditherCutoff = 0.01;
let blendModeIndex = BLEND_MODES.indexOf('alpha-dither');
let oitModeIndex = OIT_MODES.indexOf('ddp');

/**
 * How the key light shadows the groom.
 *
 * @remarks
 * `dom` is a deep opacity map: it records how much hair the light crossed rather
 * than whether it was blocked, so the groom shades from lit at the surface to
 * dark in the middle. `pcf` is the ordinary depth-based filter, kept next to it
 * as the comparison - it can only answer blocked or not, which on hair means
 * everything behind the first strand is equally black. `off` isolates how much
 * of the shape is coming from the specular lobes alone.
 */
type ShadowModeName = 'off' | 'pcf' | 'dom';
const SHADOW_MODES: ShadowModeName[] = ['off', 'pcf', 'dom'];
// Deep opacity maps need storage the WebGL path never grew, matching the strand
// expansion itself; on a WebGL2 fallback the demo offers the other two.
const shadowModeChoices: ShadowModeName[] = webgpuOK ? SHADOW_MODES : ['off', 'pcf'];
let shadowModeIndex = shadowModeChoices.indexOf(webgpuOK ? 'dom' : 'pcf');

/**
 * Kernel widths the deep opacity map accepts, and how they read on screen.
 *
 * @remarks
 * Worth having as a control rather than a constant: this is the axis along which
 * the technique is *not* automatically better than a depth-based filter. Its own
 * gradation runs along the light, so a single tap leaves the silhouette of the
 * groom as hard as an unfiltered shadow map, and the difference between 1 and 5
 * here is the difference people notice first.
 */
const DOM_FILTERS = [1, 3, 5, 7];
const DOM_FILTER_LABELS = ['1 (hard)', '3', '5', '7 (soft)'];

function applyShadowMode(mode: ShadowModeName) {
  key.castShadow = mode !== 'off';
  if (mode !== 'off') {
    key.shadow.mode = mode;
  }
}

applyShadowMode(shadowModeChoices[shadowModeIndex]);

/**
 * Applies a coverage resolution strategy to the material.
 *
 * @remarks
 * A real strand is far thinner than a pixel, so the shader widens it to the
 * pixel floor and scales alpha by how much it widened. What happens to that
 * alpha is the whole choice here:
 *
 * - `opaque` discards it. Every strand paints a full pixel and the groom reads
 *   as a solid shell rather than as hair - useful mainly as a reference.
 * - `alpha-dither` spends it as a stochastic per-fragment discard, resolved
 *   over time by TAA. Stays in the opaque queue, so it keeps depth writes and
 *   early-Z and never runs an OIT pass.
 * - `alpha-blend` spends it as real transparency, which moves the hair into the
 *   transparent queue and hands ordering to whichever OIT mode is selected.
 */
function applyBlendMode(mode: BlendModeName) {
  material.blendMode = mode === 'alpha-blend' ? 'blend' : 'none';
  material.alphaDither = mode === 'alpha-dither';
  // Only dithering consumes a cutoff; the other two want every fragment kept.
  material.alphaCutoff = mode === 'alpha-dither' ? ditherCutoff : 0;
}

function applyOitMode(mode: OitModeName) {
  camera.oitMode = mode === 'ddp' ? 'dual-depth' : 'weighted';
}

applyBlendMode(BLEND_MODES[blendModeIndex]);

/** Everything the UI needs to know about the loaded groom. */
type LoadStats = {
  objects: number;
  strands: number;
  points: number;
  gpuBytes: number;
  parseMs: number;
  uploadMs: number;
  /** Format plus whatever the file says about its writer. */
  source: string;
  /** Set when the groom carried no unit and was fitted to the view instead. */
  autoScaled: boolean;
};

let stats: LoadStats | null = null;
let strandData: HairStrandData | null = null;
let mesh: Mesh | null = null;
/** Fraction of strands kept, so a dense groom can be thinned for framerate. */
/**
 * Fraction of the archive's strands actually built.
 *
 * @remarks
 * Seeded from `?strands=` so the demo can be opened at a density a weaker
 * machine can drive - the full sample is 69k strands and 1.1M triangles, which
 * software rasterisation cannot keep up with. Clamped to a whole strand.
 */
let strandFraction = (() => {
  const raw = Number(new URLSearchParams(location.search).get('strands'));
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 1;
})();
let lastCurves: StrandCurveSet[] | null = null;
/** Source-to-metre conversion for the groom currently loaded. */
let unitScale = CM_TO_M;
/** Set once a local file is picked, so the in-flight sample download is dropped. */
let sampleSuperseded = false;

/**
 * Merges the archive's curve objects into one strand set.
 *
 * @remarks
 * XGen writes one object per spline description - hair, brows, lashes - and the
 * demo renders them as a single draw, because they share a material and nothing
 * here needs to address them separately. A HAIR file is always a single set, so
 * for that format this is a copy with thinning. `keepFraction` drops whole
 * strands evenly rather than shortening them, since thinning a groom is what an
 * LOD would do and truncating strands is not.
 */
function mergeCurves(curves: StrandCurveSet[], keepFraction: number) {
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

/**
 * Rebuilds the GPU buffers and the mesh from the currently loaded curves.
 *
 * @param reframe - Point the camera at the result. Wanted for a newly loaded
 * groom, whose size and position are not known in advance, and not for a density
 * change, which leaves the groom where it was and should not throw away the view
 * the user had arranged.
 */
function rebuildStrands(reframe = false) {
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
    scale: unitScale
  });
  material.strands = strandData;

  mesh?.remove();
  const primitive = new Primitive();
  // No attribute is read; the layout exists only so a draw can be issued.
  primitive.createAndSetVertexBuffer('position_f32x3', new Float32Array(3));
  primitive.indexCount = material.vertexCount;
  primitive.primitiveType = 'triangle-list';
  primitive.setBoundingVolume(boundsOf(merged.positions, merged.widths, unitScale));
  mesh = new Mesh(scene, primitive, material);

  const uploadMs = performance.now() - t0;
  if (stats) {
    stats.strands = strandData.strandCount;
    stats.points = strandData.pointCount;
    stats.gpuBytes = strandData.byteLength;
    stats.uploadMs = uploadMs;
  }
  if (reframe) {
    frameCamera(mesh);
  }
  setStatus(describeStats());
}

/**
 * Points the orbit camera at the loaded groom.
 *
 * @remarks
 * Both the centre and the distance are taken from the mesh bounds. Recentring
 * alone is not enough once the groom's size is not known in advance: a HAIR
 * model fitted to {@link UNITLESS_TARGET_EXTENT} is a different size from the
 * XGen sample, and a camera left at the sample's distance would show it as a
 * speck or as a wall of strands.
 *
 * The viewing direction is kept, so loading a second groom shows it from the
 * angle the first one was left at rather than snapping back to a default.
 *
 * The controller reads the camera's position when it is attached, so the
 * position is set first and the controller rebuilt around it.
 */
function frameCamera(target: Mesh) {
  const bounds = target.getWorldBoundingVolume()?.toAABB();
  if (!bounds) {
    return;
  }
  const mid = bounds.center;
  const radius = Math.max(bounds.diagonalLength * 0.5, 1e-4);
  // Keep whichever direction the user is currently looking from, so reloading a
  // groom or changing density does not also swing the camera around.
  const offset = Vector3.sub(camera.position, mid);
  if (offset.magnitude < 1e-6) {
    offset.setXYZ(0, 0, 1);
  }
  offset.inplaceNormalize().scaleBy(radius * 2.6);
  camera.position.setXYZ(mid.x + offset.x, mid.y + offset.y, mid.z + offset.z);
  camera.controller = new OrbitCameraController({ center: new Vector3(mid.x, mid.y, mid.z) });
  getInput().use(camera.handleEvent, camera);
}

function describeStats() {
  if (!stats) {
    return '';
  }
  const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
  const scaleNote = stats.autoScaled ? `, auto-scaled x${unitScale.toPrecision(3)}` : '';
  return [
    `${stats.source} - ${stats.objects} curve object(s)${scaleNote}`,
    `${stats.strands.toLocaleString()} strands, ${stats.points.toLocaleString()} control points`,
    `GPU ${mb(stats.gpuBytes)} - parse ${stats.parseMs.toFixed(0)} ms, upload ${stats.uploadMs.toFixed(0)} ms`,
    `Triangles ${(material.vertexCount / 3).toLocaleString()} at ${material.segmentsPerStrand} segments/strand`
  ].join('\n');
}

/**
 * Identifies the groom format from its leading bytes.
 *
 * @remarks
 * Both formats are self-identifying, so the file name is never consulted: a
 * groom exported under the wrong extension still loads, and one that is neither
 * format fails with a specific message rather than deep inside a parser.
 */
function detectFormat(buffer: ArrayBuffer) {
  const magic = new Uint8Array(buffer, 0, Math.min(5, buffer.byteLength));
  let text = '';
  for (let i = 0; i < magic.length; i++) {
    text += String.fromCharCode(magic[i]);
  }
  if (text.startsWith('HAIR')) {
    return 'hair' as const;
  }
  if (text.startsWith('Ogawa')) {
    return 'alembic' as const;
  }
  return null;
}

/**
 * Scale that brings a unit-less groom to {@link UNITLESS_TARGET_EXTENT}.
 * @returns The scale, or 1 for a degenerate groom.
 */
function fitScale(positions: Float32Array) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const v = positions[i + axis];
      if (v < min[axis]) {
        min[axis] = v;
      }
      if (v > max[axis]) {
        max[axis] = v;
      }
    }
  }
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  return extent > 1e-6 ? UNITLESS_TARGET_EXTENT / extent : 1;
}

/** Parses a groom of either supported format and swaps it in. */
function loadGroom(buffer: ArrayBuffer) {
  const format = detectFormat(buffer);
  if (!format) {
    setStatus('Not a groom this demo can read: expected an Alembic (.abc) or HAIR (.hair) file.', true);
    return;
  }
  const t0 = performance.now();
  let curves: StrandCurveSet[];
  let source: string;
  let autoScaled: boolean;
  if (format === 'hair') {
    const hair = parseHairFile(buffer);
    curves = [hair];
    source = hair.header.info ? `HAIR - ${hair.header.info}` : 'HAIR';
    // The format states no unit, so the groom is fitted rather than converted.
    unitScale = fitScale(hair.positions);
    autoScaled = true;
  } else {
    const archive = parseAlembicCurves(buffer);
    if (archive.curves.length === 0) {
      setStatus('Archive contains no curve objects.', true);
      return;
    }
    curves = archive.curves;
    source = archive.application || 'Alembic';
    unitScale = CM_TO_M;
    autoScaled = false;
  }
  const parseMs = performance.now() - t0;
  lastCurves = curves;
  stats = {
    objects: curves.length,
    strands: 0,
    points: 0,
    gpuBytes: 0,
    parseMs,
    uploadMs: 0,
    source,
    autoScaled
  };
  rebuildStrands(true);
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
      loadGroom(await res.arrayBuffer());
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
    loadGroom(buffer.buffer);
  } catch (err) {
    setStatus(`Failed to load sample: ${err instanceof Error ? err.message : String(err)}`, true);
  }
}

document.querySelector<HTMLInputElement>('#groom-file')!.addEventListener('change', async (ev) => {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (!file) {
    return;
  }
  // A local pick supersedes the sample: without this the CDN download would
  // finish minutes later and silently replace what the user just opened.
  sampleSuperseded = true;
  setStatus(`Parsing ${file.name}...`);
  try {
    loadGroom(await file.arrayBuffer());
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
    const lod: [boolean] = [material.strandLOD];
    if (ImGui.Checkbox('Strand LOD (distance decimation)', lod)) {
      material.strandLOD = lod[0];
    }
    slider('LOD min ratio', material.minStrandLODRatio, 0, 1, (v) => (material.minStrandLODRatio = v));
  }

  if (ImGui.CollapsingHeader('Transparency', ImGui.TreeNodeFlags.DefaultOpen)) {
    const blendRef: [number] = [blendModeIndex];
    if (ImGui.Combo('Blend', blendRef, BLEND_MODES)) {
      blendModeIndex = blendRef[0];
      applyBlendMode(BLEND_MODES[blendModeIndex]);
    }
    const blendMode = BLEND_MODES[blendModeIndex];
    if (blendMode === 'alpha-dither') {
      const cutoff: [number] = [ditherCutoff];
      if (ImGui.InputFloat('Alpha cutoff', cutoff, 0.005, 0.05, '%.3f')) {
        ditherCutoff = Math.min(Math.max(cutoff[0], 0), 1);
        material.alphaCutoff = ditherCutoff;
      }
    }
    const taa: [boolean] = [camera.TAA];
    if (ImGui.Checkbox('TAA', taa)) {
      camera.TAA = taa[0];
    }
    // Dithering spends coverage as a per-fragment coin flip and leaves the
    // averaging to the temporal filter, so without one the groom is raw noise
    // rather than a slightly noisy groom. Worth saying out loud, because the
    // failure looks like the dither is broken rather than like a missing pass.
    if (blendMode === 'alpha-dither' && !camera.TAA) {
      ImGui.TextDisabled('alpha-dither needs TAA to resolve');
    }
    // OIT resolves the transparent queue, which the other two modes never reach.
    if (blendMode === 'alpha-blend') {
      const oitRef: [number] = [oitModeIndex];
      if (ImGui.Combo('OIT', oitRef, OIT_MODES)) {
        oitModeIndex = oitRef[0];
        applyOitMode(OIT_MODES[oitModeIndex]);
      }
      if (OIT_MODES[oitModeIndex] === 'ddp') {
        const peels: [number] = [camera.oitDualDepthPeels];
        if (ImGui.InputInt('DDP peels', peels)) {
          camera.oitDualDepthPeels = Math.min(Math.max(peels[0], 1), 16);
        }
      }
    } else {
      ImGui.TextDisabled('OIT applies to alpha-blend only');
    }
  }

  if (ImGui.CollapsingHeader('Shadows', ImGui.TreeNodeFlags.DefaultOpen)) {
    const shadowRef: [number] = [shadowModeIndex];
    if (ImGui.Combo('Mode', shadowRef, shadowModeChoices)) {
      shadowModeIndex = shadowRef[0];
      applyShadowMode(shadowModeChoices[shadowModeIndex]);
    }
    const shadowMode = shadowModeChoices[shadowModeIndex];
    if (shadowMode === 'dom') {
      slider('Layer span (m)', key.shadow.domLayerDistance, 0.01, 1.5, (v) => {
        key.shadow.domLayerDistance = v;
      });
      slider('Density', key.shadow.domDensity, 0, 4, (v) => (key.shadow.domDensity = v));
      // Only 1/3/5/7 are accepted; the kernel is unrolled into the shader, so a
      // change here rebuilds the receiver programs.
      const filterRef: [number] = [DOM_FILTERS.indexOf(key.shadow.domFilterSize)];
      if (ImGui.Combo('Filter', filterRef, DOM_FILTER_LABELS)) {
        key.shadow.domFilterSize = DOM_FILTERS[filterRef[0]];
      }
      // Both knobs fail in ways that look like the technique is broken rather
      // than mistuned, so name the symptoms next to the sliders.
      ImGui.TextDisabled('Span: roughly how deep the hair is.');
      ImGui.TextDisabled('Too small reads hard, too large reads unlit.');
      ImGui.TextDisabled('Density 1 matches alpha blending; above is taste.');
    } else if (shadowMode === 'pcf' && webgpuOK) {
      ImGui.TextDisabled('Binary test: no gradient through the groom.');
    }
    if (!webgpuOK) {
      ImGui.TextDisabled('dom needs WebGPU');
    }
    slider('Shadow strength', key.shadow.shadowStrength, 0, 1, (v) => {
      key.shadow.shadowStrength = v;
    });
  }

  if (ImGui.CollapsingHeader('Shading', ImGui.TreeNodeFlags.DefaultOpen)) {
    const albedo = material.albedoColor;
    const ref: [number, number, number] = [albedo.x, albedo.y, albedo.z];
    if (ImGui.ColorEdit3('Base colour', ref)) {
      material.albedoColor = new Vector4(ref[0], ref[1], ref[2], albedo.w);
    }
    const modelRef: [number] = [SHADING_MODELS.indexOf(material.shadingModel)];
    if (ImGui.Combo('Model', modelRef, SHADING_MODELS)) {
      material.shadingModel = SHADING_MODELS[modelRef[0]];
    }
    if (material.shadingModel === 'marschner') {
      slider('Shift', material.marschnerShift, -0.15, 0.15, (v) => (material.marschnerShift = v));
      slider('Roughness', material.marschnerRoughness, 0.02, 1, (v) => (material.marschnerRoughness = v));
      slider('IOR', material.marschnerIOR, 1.05, 2.2, (v) => (material.marschnerIOR = v));
      slider('Absorption', material.marschnerAbsorption, 0, 4, (v) => (material.marschnerAbsorption = v));
      const lobes = material.marschnerLobes;
      slider('R (surface)', lobes.x, 0, 3, (v) => {
        material.marschnerLobes = new Vector3(v, lobes.y, lobes.z);
      });
      slider('TT (through)', lobes.y, 0, 3, (v) => {
        material.marschnerLobes = new Vector3(lobes.x, v, lobes.z);
      });
      slider('TRT (internal)', lobes.z, 0, 3, (v) => {
        material.marschnerLobes = new Vector3(lobes.x, lobes.y, v);
      });
      ImGui.TextDisabled('Zero two lobes to see the third alone.');
      ImGui.TextDisabled('TT needs a light behind the hair.');
    } else {
      // At 0 the quad shades as the flat ribbon it is, which is what this
      // material did before the cylinder normal existed; the slider is the A/B
      // for it. Marschner integrates across the fibre itself, so it is only
      // offered here.
      slider('Roundness', material.strandRoundness, 0, 1, (v) => (material.strandRoundness = v));
      colorEdit('Primary lobe', material.specular1Color, (v) => (material.specular1Color = v));
      slider('Primary power', material.specular1Power, 8, 400, (v) => (material.specular1Power = v));
      slider('Primary shift', material.specular1Shift, -0.5, 0.5, (v) => (material.specular1Shift = v));
      colorEdit('Secondary lobe', material.specular2Color, (v) => (material.specular2Color = v));
      slider('Secondary power', material.specular2Power, 4, 200, (v) => (material.specular2Power = v));
      slider('Secondary shift', material.specular2Shift, -0.5, 0.5, (v) => (material.specular2Shift = v));
      colorEdit('Transmission', material.transmissionColor, (v) => (material.transmissionColor = v));
      // Hidden under Marschner: it fakes what the TT path computes, and running
      // both would count the same light twice.
      slider('Transmission', material.transmissionIntensity, 0, 2, (v) => {
        material.transmissionIntensity = v;
      });
    }
    slider('Diffuse wrap', material.diffuseWrap, 0, 1, (v) => (material.diffuseWrap = v));
  }

  if (ImGui.CollapsingHeader('Multiple scattering', ImGui.TreeNodeFlags.DefaultOpen)) {
    slider('Scatter', material.scatterIntensity, 0, 3, (v) => (material.scatterIntensity = v));
    colorEdit('Scatter tint', material.scatterColor, (v) => (material.scatterColor = v));
    slider('Local share', material.scatterLocal, 0, 1, (v) => (material.scatterLocal = v));
    slider('Spread', material.scatterWrap, 0, 3, (v) => (material.scatterWrap = v));
    // The term is multiplied by the hair's own colour, so on a near-black groom
    // it is doing its job and showing almost nothing. Say so rather than let it
    // read as a broken slider.
    ImGui.TextDisabled('Scales with base colour: pale hair shows it,');
    ImGui.TextDisabled('near-black hair barely can.');
    if (shadowModeChoices[shadowModeIndex] !== 'dom') {
      // Both terms are built from the shadow value, which only grades under a
      // deep opacity map; elsewhere they just follow a binary in/out.
      ImGui.TextDisabled('Graded only under dom shadows.');
    }
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
