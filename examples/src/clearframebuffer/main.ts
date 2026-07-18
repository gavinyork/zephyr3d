import { Vector4 } from '@zephyr3d/base';
import { backendWebGL1, backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
import type { DeviceBackend, Texture2D } from '@zephyr3d/device';
import { DrawText } from '@zephyr3d/device';

const RENDER_TARGET_SIZE = 256;

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

  if (device.getDeviceCaps().framebufferCaps.maxDrawBuffers < 2) {
    device.runLoop((device) => {
      device.clearFrameBuffer(new Vector4(0.025, 0.025, 0.03, 1), 1, 0);
      DrawText.drawText(device, 'MRT clear requires at least 2 color attachments', '#ff8080', 30, 30);
      DrawText.drawText(device, `Device: ${device.type}`, '#ffffff', 30, 50);
      DrawText.drawText(device, 'Use WebGPU or a WebGL backend with draw buffers support', '#ffffff', 30, 70);
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

  const presentBindGroup = device.createBindGroup(presentProgram.bindGroupLayouts[0]);
  const presentRenderStates = device.createRenderStateSet();
  presentRenderStates.useRasterizerState().setCullMode('none');
  presentRenderStates.useDepthState().enableTest(false).enableWrite(false);

  const fullTarget0 = createRenderTarget('fullTarget0');
  const fullTarget1 = createRenderTarget('fullTarget1');
  const scissorTarget0 = createRenderTarget('scissorTarget0');
  const scissorTarget1 = createRenderTarget('scissorTarget1');
  const fullFramebuffer = device.createFrameBuffer([fullTarget0, fullTarget1], null);
  const scissorFramebuffer = device.createFrameBuffer([scissorTarget0, scissorTarget1], null);

  function createRenderTarget(name: string) {
    const texture = device.createTexture2D('rgba8unorm', RENDER_TARGET_SIZE, RENDER_TARGET_SIZE, {
      mipmapping: false
    });
    if (!texture) {
      throw new Error(`Failed to create ${name}`);
    }
    texture.name = name;
    return texture;
  }

  function clearTargets() {
    device.setFramebuffer(fullFramebuffer);
    device.clearFrameBuffer([new Vector4(0.95, 0.08, 0.04, 1), new Vector4(0.04, 0.75, 0.2, 1)], null, null);

    device.setFramebuffer(scissorFramebuffer);
    device.clearFrameBuffer(new Vector4(0.08, 0.08, 0.1, 1), null, null);
    device.setScissor([0, 0, RENDER_TARGET_SIZE / 2, RENDER_TARGET_SIZE]);
    device.clearFrameBuffer([new Vector4(0.08, 0.32, 1, 1), new Vector4(0.9, 0.08, 0.75, 1)], null, null);
    device.setScissor(null);
  }

  function drawTexture(texture: Texture2D, region: Vector4) {
    presentBindGroup.setTexture('tex', texture);
    presentBindGroup.setValue('region', region);
    device.setBindGroup(0, presentBindGroup);
    device.draw('triangle-strip', 0, 4);
  }

  device.runLoop((device) => {
    clearTargets();

    device.setFramebuffer(null);
    device.clearFrameBuffer(new Vector4(0.025, 0.025, 0.03, 1), 1, 0);
    device.setProgram(presentProgram);
    device.setVertexLayout(quadVertexLayout);
    device.setRenderStates(presentRenderStates);

    drawTexture(fullTarget0, new Vector4(-0.52, 0.34, 0.42, 0.3));
    drawTexture(fullTarget1, new Vector4(0.52, 0.34, 0.42, 0.3));
    drawTexture(scissorTarget0, new Vector4(-0.52, -0.42, 0.42, 0.3));
    drawTexture(scissorTarget1, new Vector4(0.52, -0.42, 0.42, 0.3));

    DrawText.drawText(device, 'clearFrameBuffer per-target clear', '#ffffff', 30, 30);
    DrawText.drawText(device, `Device: ${device.type}`, '#ffffff', 30, 50);
    DrawText.drawText(device, 'Top row: clearFrameBuffer([red, green])', '#ffffff', 30, 70);
    DrawText.drawText(device, 'Bottom row: scissored clearFrameBuffer([blue, magenta])', '#ffffff', 30, 90);
    DrawText.drawText(device, `FPS: ${device.frameInfo.FPS.toFixed(2)}`, '#ffff00', 30, 110);
  });
})();
