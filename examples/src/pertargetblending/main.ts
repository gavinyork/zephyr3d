import { DEPTH_CLEAR_VALUE, Vector4 } from '@zephyr3d/base';
import { backendWebGL1, backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
import type { DeviceBackend, Texture2D } from '@zephyr3d/device';
import { DrawText } from '@zephyr3d/device';

const RENDER_TARGET_SIZE = 512;

(async function () {
  const backendsMap: Record<string, DeviceBackend> = {
    webgl: backendWebGL1,
    webgl2: backendWebGL2,
    webgpu: backendWebGPU
  };
  const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
  const type = new URL(location.href).searchParams.get('dev') || 'webgl';
  const backend = backendsMap[type];
  if (!backend) {
    throw new Error(`Invalid backend: ${type}`);
  }
  const device = await backend.createDevice(canvas);
  if (!device) {
    throw new Error(`Failed to create device: ${type}`);
  }

  const framebufferCaps = device.getDeviceCaps().framebufferCaps;
  if (!framebufferCaps.supportPerTargetBlending || framebufferCaps.maxDrawBuffers < 2) {
    device.runLoop((device) => {
      device.clearFrameBuffer(new Vector4(0.025, 0.025, 0.03, 1), DEPTH_CLEAR_VALUE, 0);
      DrawText.drawText(
        device,
        'Per-target blending is not supported by this backend/device',
        '#ff8080',
        30,
        30
      );
      DrawText.drawText(device, `Device: ${device.type}`, '#ffffff', 30, 50);
      DrawText.drawText(device, 'Use WebGPU or WebGL2 with OES_draw_buffers_indexed', '#ffffff', 30, 70);
    });
    return;
  }

  const quadVertexLayout = device.createVertexLayout({
    vertexBuffers: [
      {
        buffer: device.createVertexBuffer('position_f32x2', new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]))
      }
    ]
  });

  const mrtProgram = device.buildRenderProgram({
    vertex(pb) {
      this.shape = pb.vec4().uniform(0);
      this.$inputs.position = pb.vec2().attrib('position');
      this.$outputs.local = pb.vec2();
      pb.main(function () {
        this.$outputs.local = this.$inputs.position;
        this.clipPos = pb.add(this.shape.xy, pb.mul(this.$inputs.position, this.shape.zw));
        this.$builtins.position = pb.vec4(this.clipPos, 0, 1);
      });
    },
    fragment(pb) {
      this.additiveColor = pb.vec4().uniform(0);
      this.maskedColor = pb.vec4().uniform(0);
      this.$outputs.additiveTarget = pb.vec4();
      this.$outputs.maskedAlphaTarget = pb.vec4();
      pb.main(function () {
        this.radius = pb.dot(this.$inputs.local, this.$inputs.local);
        this.coverage = pb.sub(1, pb.smoothStep(0.24, 1, this.radius));
        this.additiveAlpha = pb.mul(this.coverage, this.additiveColor.a);
        this.maskedAlpha = pb.mul(this.coverage, this.maskedColor.a);
        this.$outputs.additiveTarget = pb.vec4(
          pb.mul(this.additiveColor.rgb, this.additiveAlpha),
          this.additiveAlpha
        );
        this.$outputs.maskedAlphaTarget = pb.vec4(this.maskedColor.rgb, this.maskedAlpha);
      });
    }
  });

  const presentProgram = device.buildRenderProgram({
    vertex(pb) {
      this.region = pb.vec4().uniform(0);
      this.$inputs.position = pb.vec2().attrib('position');
      this.$outputs.uv = pb.vec2();
      pb.main(function () {
        this.clipPos = pb.add(this.region.xy, pb.mul(this.$inputs.position, this.region.zw));
        this.$builtins.position = pb.vec4(this.clipPos, 0, 1);
        this.$outputs.uv = pb.add(pb.mul(this.$inputs.position, 0.5), pb.vec2(0.5));
      });
    },
    fragment(pb) {
      this.tex = pb.tex2D().uniform(0);
      this.$outputs.color = pb.vec4();
      pb.main(function () {
        this.$outputs.color = pb.textureSample(this.tex, this.$inputs.uv);
      });
    }
  });

  const mrtBindGroup = device.createBindGroup(mrtProgram.bindGroupLayouts[0]);
  const presentBindGroup = device.createBindGroup(presentProgram.bindGroupLayouts[0]);

  const additiveTarget = device.createTexture2D('rgba8unorm', RENDER_TARGET_SIZE, RENDER_TARGET_SIZE, {
    mipmapping: false
  });
  const maskedAlphaTarget = device.createTexture2D('rgba8unorm', RENDER_TARGET_SIZE, RENDER_TARGET_SIZE, {
    mipmapping: false
  });
  if (!additiveTarget || !maskedAlphaTarget) {
    throw new Error('Failed to create MRT target textures');
  }

  const mrtFramebuffer = device.createFrameBuffer([additiveTarget, maskedAlphaTarget], null);
  const mrtRenderStates = device.createRenderStateSet();
  mrtRenderStates.useRasterizerState().setCullMode('none');
  mrtRenderStates.useDepthState().enableTest(false).enableWrite(false);
  mrtRenderStates
    .useTargetBlendingState(0)
    .enable(true)
    .setBlendFuncRGB('one', 'one')
    .setBlendFuncAlpha('one', 'one');
  mrtRenderStates.useTargetColorState(0).setColorMask(true, true, true, true);
  mrtRenderStates
    .useTargetBlendingState(1)
    .enable(true)
    .setBlendFuncRGB('src-alpha', 'inv-src-alpha')
    .setBlendFuncAlpha('one', 'inv-src-alpha');
  mrtRenderStates.useTargetColorState(1).setColorMask(false, true, true, true);

  const presentRenderStates = device.createRenderStateSet();
  presentRenderStates.useRasterizerState().setCullMode('none');
  presentRenderStates.useDepthState().enableTest(false).enableWrite(false);

  const shapes = [
    {
      center: new Vector4(-0.32, -0.18, 0.48, 0.48),
      additiveColor: new Vector4(1, 0.18, 0.04, 0.58),
      maskedColor: new Vector4(1, 0.24, 0.08, 0.62)
    },
    {
      center: new Vector4(0.18, -0.03, 0.52, 0.52),
      additiveColor: new Vector4(0.08, 0.6, 1, 0.48),
      maskedColor: new Vector4(0.08, 0.62, 1, 0.54)
    },
    {
      center: new Vector4(-0.03, 0.3, 0.42, 0.42),
      additiveColor: new Vector4(0.95, 0.08, 0.72, 0.46),
      maskedColor: new Vector4(0.95, 0.16, 0.72, 0.5)
    }
  ];

  function drawMRT(elapsedMs: number) {
    const t = elapsedMs * 0.001;
    device.setFramebuffer(mrtFramebuffer);
    device.clearFrameBuffer(new Vector4(0.01, 0.01, 0.012, 1), DEPTH_CLEAR_VALUE, 0);
    device.setProgram(mrtProgram);
    device.setVertexLayout(quadVertexLayout);
    device.setBindGroup(0, mrtBindGroup);
    device.setRenderStates(mrtRenderStates);
    for (let i = 0; i < shapes.length; i++) {
      const item = shapes[i];
      const orbit = 0.05 * Math.sin(t * (0.7 + i * 0.22) + i * 1.9);
      mrtBindGroup.setValue(
        'shape',
        new Vector4(item.center.x + orbit, item.center.y, item.center.z, item.center.w)
      );
      mrtBindGroup.setValue('additiveColor', item.additiveColor);
      mrtBindGroup.setValue('maskedColor', item.maskedColor);
      device.draw('triangle-strip', 0, 4);
    }
  }

  function drawTexture(texture: Texture2D, region: Vector4) {
    presentBindGroup.setTexture('tex', texture);
    presentBindGroup.setValue('region', region);
    device.setBindGroup(0, presentBindGroup);
    device.draw('triangle-strip', 0, 4);
  }

  device.runLoop((device) => {
    drawMRT(device.frameInfo.elapsedOverall);

    device.setFramebuffer(null);
    device.clearFrameBuffer(new Vector4(0.025, 0.025, 0.03, 1), DEPTH_CLEAR_VALUE, 0);
    device.setProgram(presentProgram);
    device.setVertexLayout(quadVertexLayout);
    device.setRenderStates(presentRenderStates);
    drawTexture(additiveTarget, new Vector4(-0.52, 0, 0.42, 0.75));
    drawTexture(maskedAlphaTarget, new Vector4(0.52, 0, 0.42, 0.75));

    DrawText.drawText(device, 'PerTargetBlending MRT test', '#ffffff', 30, 30);
    DrawText.drawText(device, `Device: ${device.type}`, '#ffffff', 30, 50);
    DrawText.drawText(device, 'Left: target 0 additive blending', '#ffcc66', 30, 70);
    DrawText.drawText(device, 'Right: target 1 alpha blending, red channel masked', '#66ddff', 30, 90);
    DrawText.drawText(device, `FPS: ${device.frameInfo.FPS.toFixed(2)}`, '#ffff00', 30, 110);
  });
})();
