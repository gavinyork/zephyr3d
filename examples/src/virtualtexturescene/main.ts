import { Vector2, Vector3, Vector4 } from '@zephyr3d/base';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
import type {
  BindGroup,
  PBFunctionScope,
  PBInsideFunctionScope,
  PBShaderExp,
  Texture2D
} from '@zephyr3d/device';
import { DrawText } from '@zephyr3d/device';
import type { DrawContext, VirtualTextureClient, VirtualTextureValidation } from '@zephyr3d/scene';
import {
  Application,
  getEngine,
  Mesh,
  MeshMaterial,
  PerspectiveCamera,
  PlaneShape,
  Scene,
  ShaderHelper,
  VirtualTexture,
  virtualMipChain
} from '@zephyr3d/scene';

/**
 * Visual check of the virtual texture in the render pipeline (WebGPU only).
 *
 * The 65536^2 procedural virtual texture of the core example, now registered with a scene as a
 * VirtualTextureClient. Every camera marks the pages it needs from its own depth prepass in a
 * compute pass, then the VirtualTextureUpdate module maps and fills them before the light pass,
 * so a camera shades with the pages it asked for in the same frame. A second camera (picture in
 * picture, top right) orbits low over the plane and shares the pool.
 *
 * Controls: wheel zooms, drag pans the main camera, [ and ] pick the page table level shown
 * bottom right, P toggles the second camera, I invalidates everything.
 *
 * Expected:
 * - zooming in, finer levels appear two at a time (the prefetch), coarse to fine, never black
 *   and white stripes (no page mapped at all);
 * - both views converge and stay still: with the camera still, "allocated" drops to 0; turning
 *   the second camera on or off does not make the main view flicker (a page requested by one
 *   camera is in use for the other camera's update of the same frame);
 * - "check" counts all stay 0.
 */
const app = new Application({
  canvas: document.querySelector<HTMLCanvasElement>('#canvas')!,
  backend: backendWebGPU
});
await app.ready();
const device = app.device;

const vt = new VirtualTexture(device, {
  levels: virtualMipChain(65536, 128),
  pageSize: 128,
  border: 4,
  atlasSize: 2048,
  planes: [{ name: 'color', format: 'rgba8unorm' }],
  allocBudget: 16,
  maxPageAge: 120,
  residencyMipBias: true
});
const numLevels = vt.levels.length;

// ---- page content, same as the core example
const fillProgram = vt.createFillProgram('ProceduralPages', null, (scope, level, texel) => {
  const pb = scope.$builder;
  scope.$l.page = pb.floor(pb.div(texel, 128));
  scope.$l.shade = pb.fract(
    pb.mul(
      pb.sin(
        pb.dot(pb.add(scope.page, pb.mul(pb.vec2(17.1, 31.7), pb.float(level))), pb.vec2(12.9898, 78.233))
      ),
      43758.5453
    )
  );
  scope.$l.hue = pb.div(pb.float(level), numLevels);
  scope.$l.levelColor = pb.add(
    pb.vec3(0.5),
    pb.mul(pb.cos(pb.mul(pb.add(pb.vec3(scope.hue), pb.vec3(0, 0.33, 0.67)), 6.2831)), 0.5)
  );
  scope.$l.color = pb.mul(scope.levelColor, pb.add(0.55, pb.mul(scope.shade, 0.45)));
  scope.$l.grid = pb.fract(pb.div(texel, 16));
  scope.$if(pb.lessThan(pb.min(scope.grid.x, scope.grid.y), 1 / 16), function () {
    this.color = pb.mul(this.color, 0.6);
  });
  scope.$l.edge = pb.mul(pb.fract(pb.div(texel, 128)), 128);
  scope.$if(
    pb.or(
      pb.lessThan(pb.min(scope.edge.x, scope.edge.y), 2),
      pb.greaterThan(pb.max(scope.edge.x, scope.edge.y), 126)
    ),
    function () {
      this.color = pb.vec3(1);
    }
  );
  return [pb.vec4(scope.color, 1)];
});
const fillBindGroup = device.createBindGroup(fillProgram.bindGroupLayouts[0]);

// ---- depth driven marking: the plane covers x, z in [-1, 1] at y = 0, uv = (x, z) * 0.5 + 0.5
const markProgram = device.buildComputeProgram({
  label: 'VirtualTextureMark',
  workgroupSize: [8, 8, 1],
  compute(pb) {
    vt.declareBindings(this, 0);
    this.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
    this.invVP = pb.mat4().uniform(0);
    this.nearFar = pb.vec2().uniform(0);
    this.depthSize = pb.vec2().uniform(0);
    // (plane uv, 1) at a pixel, or z = 0 where the pixel is background or off the plane
    pb.func('planeUV', [pb.ivec2('p')], function () {
      this.$l.d = pb.textureLoad(this.depthTex, this.p, 0).r;
      this.$l.nonLinear = ShaderHelper.linearNormalizedToNonLinearDepth(this, this.d, this.nearFar);
      this.$l.uv = pb.div(pb.add(pb.vec2(this.p), pb.vec2(0.5)), this.depthSize);
      this.$l.clip = pb.vec4(
        pb.sub(pb.mul(this.uv, 2), pb.vec2(1)),
        ShaderHelper.deviceDepthToClipZ(this, pb.clamp(this.nonLinear, 0, 1)),
        1
      );
      this.$l.w = pb.mul(this.invVP, this.clip);
      this.$l.pos = pb.div(this.w.xyz, this.w.w);
      this.$l.onPlane = pb.and(
        pb.lessThan(this.d, 0.9999),
        pb.lessThanEqual(pb.max(pb.abs(this.pos.x), pb.abs(this.pos.z)), 1)
      );
      this.$return(pb.vec3(pb.add(pb.mul(this.pos.xz, 0.5), pb.vec2(0.5)), pb.float(this.onPlane)));
    });
    // Change of the plane uv to the next pixel along `step`, forward if that pixel is on the
    // plane, else backward: (duv, 1), or (0, 0, 0) when neither neighbour is. A neighbour off
    // the plane must not count as zero footprint: that is the finest level, on pages the edge of
    // the plane runs through by the hundred.
    pb.func('axisDelta', [pb.ivec2('p'), pb.ivec2('step'), pb.vec2('uv')], function () {
      this.$l.size = pb.ivec2(this.depthSize);
      this.$l.f = pb.add(this.p, this.step);
      this.$if(pb.and(pb.lessThan(this.f.x, this.size.x), pb.lessThan(this.f.y, this.size.y)), function () {
        this.$l.nf = this.planeUV(this.f);
        this.$if(pb.notEqual(this.nf.z, 0), function () {
          this.$return(pb.vec3(pb.sub(this.nf.xy, this.uv), 1));
        });
      });
      this.$l.b = pb.sub(this.p, this.step);
      this.$if(pb.and(pb.greaterThanEqual(this.b.x, 0), pb.greaterThanEqual(this.b.y, 0)), function () {
        this.$l.nb = this.planeUV(this.b);
        this.$if(pb.notEqual(this.nb.z, 0), function () {
          this.$return(pb.vec3(pb.sub(this.uv, this.nb.xy), 1));
        });
      });
      this.$return(pb.vec3(0));
    });
    pb.main(function () {
      this.$l.p = pb.ivec2(this.$builtins.globalInvocationId.xy);
      this.$l.size = pb.ivec2(this.depthSize);
      this.$if(
        pb.or(pb.greaterThanEqual(this.p.x, this.size.x), pb.greaterThanEqual(this.p.y, this.size.y)),
        function () {
          this.$return();
        }
      );
      this.$l.c = this.planeUV(this.p);
      this.$if(pb.equal(this.c.z, 0), function () {
        this.$return();
      });
      // pixel footprint from the neighbours on the plane; an axis without one uses the other
      // axis alone, a pixel without any is not marked (it resolves to a resident ancestor)
      this.$l.ax = this.axisDelta(this.p, pb.ivec2(1, 0), this.c.xy);
      this.$l.ay = this.axisDelta(this.p, pb.ivec2(0, 1), this.c.xy);
      this.$if(pb.equal(pb.add(this.ax.z, this.ay.z), 0), function () {
        this.$return();
      });
      this.$l.dx = pb.select(this.ay.xy, this.ax.xy, pb.notEqual(this.ax.z, 0));
      this.$l.dy = pb.select(this.ax.xy, this.ay.xy, pb.notEqual(this.ay.z, 0));
      this.$l.level = pb.uint(pb.floor(vt.levelFromFootprint(this, this.dx, this.dy)));
      vt.request(this as PBInsideFunctionScope, this.level as PBShaderExp, this.c.xy as PBShaderExp);
    });
  }
})!;
const markBindGroup = device.createBindGroup(markProgram.bindGroupLayouts[0]);
vt.applyBindings(markBindGroup);
// The depth is unfilterable float, so its binding needs a non-filtering sampler
const depthSampler = device.createSampler({
  addressU: 'clamp',
  addressV: 'clamp',
  magFilter: 'nearest',
  minFilter: 'nearest',
  mipFilter: 'none'
});

const client: VirtualTextureClient = {
  virtualTexture: vt,
  markFromDepth(ctx: DrawContext, linearDepth: Texture2D) {
    const camera = ctx.camera;
    markBindGroup.setTexture('depthTex', linearDepth, depthSampler);
    markBindGroup.setValue('invVP', camera.invViewProjectionMatrix);
    markBindGroup.setValue('nearFar', new Vector2(camera.getNearPlane(), camera.getFarPlane()));
    markBindGroup.setValue('depthSize', new Vector2(linearDepth.width, linearDepth.height));
    device.setProgram(markProgram);
    device.setBindGroup(0, markBindGroup);
    device.compute(Math.ceil(linearDepth.width / 8), Math.ceil(linearDepth.height / 8), 1);
  },
  fill() {
    vt.fill(fillProgram, fillBindGroup);
  }
};

// ---- plane material: one page table lookup per pixel, requests come from the depth
class VirtualTextureMaterial extends MeshMaterial {
  vertexShader(scope: PBFunctionScope) {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.$inputs.vtUV = pb.vec2().attrib('texCoord0');
    scope.$l.oPos = ShaderHelper.resolveVertexPosition(scope);
    scope.$outputs.worldPos = pb.mul(ShaderHelper.getWorldMatrix(scope), pb.vec4(scope.oPos, 1)).xyz;
    scope.$outputs.vtUV = scope.$inputs.vtUV;
    ShaderHelper.setClipSpacePosition(
      scope,
      pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1))
    );
  }
  fragmentShader(scope: PBFunctionScope) {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    if (!this.needFragmentColor()) {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
      return;
    }
    const globals = pb.getGlobalScope();
    vt.declareBindings(globals, 2, false);
    globals.zVTAtlas = pb.tex2D().uniform(2);
    scope.$l.vtLevel = pb.uint(pb.floor(vt.computeLevel(scope, scope.$inputs.vtUV)));
    scope.$l.vtLoc = vt.resolve(scope, scope.vtLevel, scope.$inputs.vtUV);
    scope.$l.vtColor = pb.vec4(pb.textureSampleLevel(globals.zVTAtlas, scope.vtLoc.xy, 0).rgb, 1);
    // Nothing mapped at all: black and white stripes, unlike any level colour
    scope.$if(pb.lessThan(scope.vtLoc.w, 0.5), function () {
      this.vtColor = pb.vec4(
        pb.vec3(
          pb.step(0.5, pb.fract(pb.mul(pb.add(this.$builtins.fragCoord.x, this.$builtins.fragCoord.y), 0.05)))
        ),
        1
      );
    });
    this.outputFragmentColor(scope, scope.$inputs.worldPos, scope.vtColor);
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number) {
    super.applyUniformValues(bindGroup, ctx, pass);
    if (this.needFragmentColor(ctx)) {
      vt.applyBindings(bindGroup, false);
      bindGroup.setTexture(
        'zVTAtlas',
        vt.getPlaneTexture('color')!,
        device.createSampler({
          addressU: 'clamp',
          addressV: 'clamp',
          magFilter: 'linear',
          minFilter: 'linear',
          mipFilter: 'none'
        })
      );
    }
  }
}

// ---- scene
const scene = new Scene();
scene.env.sky.skyType = 'none';
scene.env.sky.fogType = 'none';
scene.env.light.type = 'none';
scene.addVirtualTextureClient(client);
new Mesh(scene, new PlaneShape({ size: 2 }), new VirtualTextureMaterial());

const mainCamera = new PerspectiveCamera(scene, 1, 0.01, 100);
const pipCamera = new PerspectiveCamera(scene, 1, 0.001, 10);
for (const camera of [mainCamera, pipCamera]) {
  camera.HDR = false;
  camera.clearColor = new Vector4(0.1, 0.1, 0.12, 1);
}
scene.mainCamera = mainCamera;

// ---- page table overlay
const quadVB = device.createVertexBuffer(
  'position_f32x2',
  new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1])
);
const quadLayout = device.createVertexLayout({ vertexBuffers: [{ buffer: quadVB }] });
const overlayProgram = device.buildRenderProgram({
  label: 'VirtualTextureOverlay',
  vertex(pb) {
    this.rect = pb.vec4().uniform(0);
    this.$inputs.pos = pb.vec2().attrib('position');
    this.$outputs.uv = pb.vec2();
    pb.main(function () {
      this.$builtins.position = pb.vec4(pb.add(this.rect.xy, pb.mul(this.$inputs.pos, this.rect.zw)), 0, 1);
      this.$outputs.uv = pb.vec2(this.$inputs.pos.x, pb.sub(1, this.$inputs.pos.y));
    });
  },
  fragment(pb) {
    this.pageTable = pb.tex2D().uniform(0);
    this.$outputs.color = pb.vec4();
    pb.main(function () {
      this.$outputs.color = pb.textureSampleLevel(this.pageTable, this.$inputs.uv, 0);
    });
  }
})!;
const overlayBindGroup = device.createBindGroup(overlayProgram.bindGroupLayouts[0]);
const nearest = device.createSampler({
  addressU: 'clamp',
  addressV: 'clamp',
  magFilter: 'nearest',
  minFilter: 'nearest',
  mipFilter: 'none'
});
const overlayStates = device.createRenderStateSet();
overlayStates.useRasterizerState().setCullMode('none');
overlayStates.useDepthState().enableTest(false).enableWrite(false);

// ---- input
const canvas = device.canvas;
let cx = 0;
let cz = 0;
let height = 1.5;
let debugLevel = 0;
let showPip = true;
let dragging = false;
let lastX = 0;
let lastY = 0;
canvas.addEventListener('wheel', (e) => {
  height = Math.min(4, Math.max(0.0002, height * Math.exp(e.deltaY * 0.001)));
  e.preventDefault();
});
canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
});
window.addEventListener('pointerup', () => {
  dragging = false;
});
window.addEventListener('pointermove', (e) => {
  if (dragging) {
    const s = (height * 2) / canvas.clientHeight;
    cx = Math.min(1, Math.max(-1, cx - (e.clientX - lastX) * s));
    cz = Math.min(1, Math.max(-1, cz - (e.clientY - lastY) * s));
    lastX = e.clientX;
    lastY = e.clientY;
  }
});
window.addEventListener('keydown', (e) => {
  if (e.key === '[') {
    debugLevel = Math.max(0, debugLevel - 1);
  } else if (e.key === ']') {
    debugLevel = Math.min(numLevels - 1, debugLevel + 1);
  } else if (e.key === 'p' || e.key === 'P') {
    showPip = !showPip;
  } else if (e.key === 'i' || e.key === 'I') {
    vt.invalidate();
  }
});

// ---- frame
let validation: VirtualTextureValidation | null = null;
let validating = false;
getEngine().setRenderable(() => {
  const width = device.deviceXToScreen(device.getDrawingBufferWidth());
  const screenHeight = device.deviceYToScreen(device.getDrawingBufferHeight());
  const frame = device.frameInfo.frameCounter;

  mainCamera.aspect = width / screenHeight;
  mainCamera.near = Math.max(height * 0.02, 1e-5);
  mainCamera.far = height * 50;
  mainCamera.lookAt(new Vector3(cx, height, cz + height * 0.9), new Vector3(cx, 0, cz), Vector3.axisPY());
  mainCamera.render(scene);

  if (showPip) {
    const pw = Math.round(width * 0.35);
    const ph = Math.round(screenHeight * 0.35);
    pipCamera.viewport = [width - pw - 16, screenHeight - ph - 16, pw, ph];
    pipCamera.aspect = pw / ph;
    const t = frame * 0.002;
    pipCamera.lookAt(
      new Vector3(Math.cos(t) * 0.5, 0.08, Math.sin(t) * 0.5),
      new Vector3(Math.cos(t + 0.8) * 0.3, 0, Math.sin(t + 0.8) * 0.3),
      Vector3.axisPY()
    );
    pipCamera.render(scene);
  }

  // consistency check of the page management every second, after both cameras updated
  if (!validating && frame % 60 === 0) {
    validating = true;
    vt.validate()
      .then((v) => {
        validation = v;
      })
      .finally(() => {
        validating = false;
      });
  }

  const debugTexture = vt.renderDebugTexture(debugLevel);
  const aspect = device.getDrawingBufferWidth() / device.getDrawingBufferHeight();
  const size = 0.6;
  device.setViewport(null);
  device.setRenderStates(overlayStates);
  device.setProgram(overlayProgram);
  overlayBindGroup.setValue('rect', new Vector4(1 - size / aspect - 0.02, -0.98, size / aspect, size));
  overlayBindGroup.setTexture('pageTable', debugTexture, nearest);
  device.setBindGroup(0, overlayBindGroup);
  quadLayout.draw('triangle-list', 0, 6);

  const s = vt.stats;
  const lines = [
    `Device: ${device.type}  FPS: ${device.frameInfo.FPS.toFixed(1)}  cameras: ${showPip ? 2 : 1}`,
    `Virtual 65536^2, ${numLevels} levels, pool ${vt.physicalPageCount} pages, budget ${vt.allocBudget}/update, pinned from level ${vt.pinnedFromLevel}`,
    `Wheel: zoom  Drag: pan  [ ]: page table level (${debugLevel})  P: second camera  I: invalidate`,
    s
      ? `requested ${s.requested}  loads ${s.loads}  allocated ${s.allocated}  evicted ${s.evicted}  refilled ${s.refilled}  expired ${s.expired}  dropped ${s.dropped}  available ${s.available}  lru ${s.lruSize}  mip bias ${s.mipBias.toFixed(2)}`
      : 'stats pending',
    validation
      ? `check: lost ${validation.lostPages}  duplicate ${validation.duplicatePages}  wrong owner ${validation.wrongOwner}  shared ${validation.sharedPages}  pinned missing ${validation.pinnedMissing}  unmapped ${validation.unmapped}  (all must be 0)`
      : 'check pending'
  ];
  const bad = !!validation && Object.values(validation).some((v) => v !== 0);
  lines.forEach((line, i) =>
    DrawText.drawText(
      device,
      line,
      i === 3 ? '#ffff80' : i === 4 ? (bad ? '#ff6060' : '#80ff80') : '#ffffff',
      20,
      24 + i * 20
    )
  );
});
app.run();
