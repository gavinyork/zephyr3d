import { DEPTH_CLEAR_VALUE, Matrix4x4, Vector3, Vector4 } from '@zephyr3d/base';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
import type { PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { DrawText } from '@zephyr3d/device';
import type { VirtualTextureValidation } from '@zephyr3d/scene';
import { VirtualTexture, virtualMipChain } from '@zephyr3d/scene';

/**
 * Visual check of the sparse virtual texture core (WebGPU only).
 *
 * A 65536^2 procedural virtual texture (512x512 pages of 128 texels, 10 levels) on a plane, with
 * a deliberately tiny physical pool (49 pages) to force eviction and the per update budget.
 * Every page shows its level's colour, a per page shade, a 16 texel grid and a white page edge.
 *
 * Controls: wheel zooms, drag pans, [ and ] pick the page table level shown bottom right,
 * L tints pixels by how many levels coarser than wanted they are, I invalidates everything.
 *
 * The "check" line re-reads the page table and page lists every second; every count must be 0.
 */
(async function () {
  const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
  const device = await backendWebGPU.createDevice(canvas);
  if (!device) {
    throw new Error('WebGPU is not available');
  }
  const vt = new VirtualTexture(device, {
    levels: virtualMipChain(65536, 128),
    pageSize: 128,
    border: 4,
    atlasSize: 1024,
    planes: [{ name: 'color', format: 'rgba8unorm' }],
    allocBudget: 8,
    maxPageAge: 120,
    residencyMipBias: true
  });
  const numLevels = vt.levels.length;

  // ---- page content
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
    // 16 texel grid
    scope.$l.grid = pb.fract(pb.div(texel, 16));
    scope.$if(pb.lessThan(pb.min(scope.grid.x, scope.grid.y), 1 / 16), function () {
      this.color = pb.mul(this.color, 0.6);
    });
    // page edges, computed in the level's texel space so neighbouring pages agree on borders
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

  // ---- plane
  const planeVB = device.createVertexBuffer(
    'position_f32x2',
    new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1])
  );
  const planeLayout = device.createVertexLayout({ vertexBuffers: [{ buffer: planeVB }] });
  const planeProgram = device.buildRenderProgram({
    label: 'VirtualTexturePlane',
    vertex(pb) {
      this.vp = pb.mat4().uniform(0);
      this.$inputs.pos = pb.vec2().attrib('position');
      this.$outputs.uv = pb.vec2();
      pb.main(function () {
        this.$builtins.position = pb.mul(this.vp, pb.vec4(this.$inputs.pos.x, 0, this.$inputs.pos.y, 1));
        this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos, 0.5), pb.vec2(0.5));
      });
    },
    fragment(pb) {
      vt.declareBindings(this, 0);
      this.atlas = pb.tex2D().uniform(0);
      this.frame = pb.uint().uniform(0);
      this.showLevel = pb.uint().uniform(0);
      this.$outputs.color = pb.vec4();
      pb.main(function () {
        this.$l.uv = this.$inputs.uv;
        // derivatives first, in uniform control flow
        this.$l.level = pb.uint(pb.floor(vt.computeLevel(this, this.uv)));
        // mark from one pixel in 16, rotating every frame
        this.$l.p = pb.uvec2(this.$builtins.fragCoord.xy);
        this.$l.key = pb.add(pb.add(this.p.x, pb.mul(this.p.y, 7)), this.frame);
        this.$if(pb.equal(pb.compAnd(this.key, 15), 0), function () {
          vt.request(this as PBInsideFunctionScope, this.level as PBShaderExp, this.uv as PBShaderExp);
        });
        this.$l.loc = vt.resolve(this, this.level, this.uv);
        this.$l.color = pb.textureSampleLevel(this.atlas, this.loc.xy, 0).rgb;
        this.$if(pb.notEqual(this.showLevel, 0), function () {
          this.color = pb.mix(
            this.color,
            pb.vec3(1, 0, 0),
            pb.clamp(pb.mul(pb.sub(this.loc.z, pb.float(this.level)), 0.25), 0, 1)
          );
        });
        // Nothing mapped at all: black and white stripes, unlike any level colour
        this.$if(pb.lessThan(this.loc.w, 0.5), function () {
          this.color = pb.vec3(
            pb.step(
              0.5,
              pb.fract(pb.mul(pb.add(this.$builtins.fragCoord.x, this.$builtins.fragCoord.y), 0.05))
            )
          );
        });
        this.$outputs.color = pb.vec4(this.color, 1);
      });
    }
  });
  const planeBindGroup = device.createBindGroup(planeProgram.bindGroupLayouts[0]);
  vt.applyBindings(planeBindGroup);
  planeBindGroup.setTexture(
    'atlas',
    vt.getPlaneTexture('color')!,
    device.createSampler({
      addressU: 'clamp',
      addressV: 'clamp',
      magFilter: 'linear',
      minFilter: 'linear',
      mipFilter: 'none'
    })
  );

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
  });
  const overlayBindGroup = device.createBindGroup(overlayProgram.bindGroupLayouts[0]);
  const nearest = device.createSampler({
    addressU: 'clamp',
    addressV: 'clamp',
    magFilter: 'nearest',
    minFilter: 'nearest',
    mipFilter: 'none'
  });

  const renderStates = device.createRenderStateSet();
  renderStates.useRasterizerState().setCullMode('none');
  renderStates.useDepthState().enableTest(false).enableWrite(false);

  // ---- camera and input
  let cx = 0;
  let cz = 0;
  let height = 1.5;
  let debugLevel = 0;
  let showLevel = false;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  canvas!.addEventListener('wheel', (e) => {
    height = Math.min(4, Math.max(0.0002, height * Math.exp(e.deltaY * 0.001)));
    e.preventDefault();
  });
  canvas!.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener('pointerup', () => {
    dragging = false;
  });
  window.addEventListener('pointermove', (e) => {
    if (dragging) {
      const s = (height * 2) / canvas!.clientHeight;
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
    } else if (e.key === 'l' || e.key === 'L') {
      showLevel = !showLevel;
    } else if (e.key === 'i' || e.key === 'I') {
      vt.invalidate();
    }
  });

  let stamp = 0;
  let validation: VirtualTextureValidation | null = null;
  let validating = false;
  device.runLoop((device) => {
    stamp++;
    // requests marked while drawing the previous frame are mapped and filled here
    vt.update(stamp);
    vt.fill(fillProgram, fillBindGroup);
    // consistency check of the page management every second, right after an update
    if (!validating && stamp % 60 === 0) {
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
    const eye = new Vector3(cx, height, cz + height * 0.9);
    const view = Matrix4x4.invertAffine(Matrix4x4.lookAt(eye, new Vector3(cx, 0, cz), Vector3.axisPY()));
    const proj = Matrix4x4.perspective(1, aspect, Math.max(height * 0.02, 1e-5), 100);

    device.clearFrameBuffer(new Vector4(0.1, 0.1, 0.12, 1), DEPTH_CLEAR_VALUE, 0);
    device.setRenderStates(renderStates);
    device.setProgram(planeProgram);
    planeBindGroup.setValue('vp', Matrix4x4.multiply(proj, view));
    planeBindGroup.setValue('frame', stamp);
    planeBindGroup.setValue('showLevel', showLevel ? 1 : 0);
    device.setBindGroup(0, planeBindGroup);
    planeLayout.draw('triangle-list', 0, 6);

    device.setProgram(overlayProgram);
    const size = 0.6;
    overlayBindGroup.setValue('rect', new Vector4(1 - size / aspect - 0.02, -0.98, size / aspect, size));
    overlayBindGroup.setTexture('pageTable', debugTexture, nearest);
    device.setBindGroup(0, overlayBindGroup);
    quadLayout.draw('triangle-list', 0, 6);

    const s = vt.stats;
    const lines = [
      `Device: ${device.type}  FPS: ${device.frameInfo.FPS.toFixed(1)}`,
      `Virtual 65536^2, ${numLevels} levels, pool ${vt.physicalPageCount} pages, budget ${vt.allocBudget}/update, pinned from level ${vt.pinnedFromLevel}`,
      `Wheel: zoom  Drag: pan  [ ]: page table level (${debugLevel})  L: level tint (${showLevel ? 'on' : 'off'})  I: invalidate`,
      s
        ? `requested ${s.requested}  loads ${s.loads}  allocated ${s.allocated}  evicted ${s.evicted}  refilled ${s.refilled}  expired ${s.expired}  dropped ${s.dropped}  available ${s.available}  lru ${s.lruSize}  mip bias ${s.mipBias.toFixed(2)}`
        : 'stats pending',
      validation
        ? `check: lost ${validation.lostPages}  duplicate ${validation.duplicatePages}  wrong owner ${validation.wrongOwner}  shared ${validation.sharedPages}  pinned missing ${validation.pinnedMissing}  unmapped ${validation.unmapped}  (all must be 0)`
        : 'check pending',
      'Page table: bright green = resident & requested, dim green = resident, cyan = pinned, blue = ancestor fallback, black = none'
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
})();
