import type { AbstractDevice, GPUProgram } from '@zephyr3d/device';
import { drawFullscreenQuad } from '../../render/helper';

let randomNoiseProgram: GPUProgram = null;

export function createRandomNoiseTexture(device: AbstractDevice, size: number) {
  if (!randomNoiseProgram) {
    randomNoiseProgram = device.buildRenderProgram({
      vertex(pb) {
        this.$inputs.pos = pb.vec2().attrib('position');
        this.$outputs.uv = pb.vec2();
        pb.main(function () {
          this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
          this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
          if (device.type === 'webgpu') {
            this.$builtins.position.y = pb.neg(this.$builtins.position.y);
          }
        });
      },
      fragment(pb) {
        this.$outputs.color = pb.vec4();
        pb.main(function () {
          this.$l.noise = pb.fract(
            pb.mul(pb.sin(pb.dot(this.$inputs.uv, pb.vec2(12.9898, 78.233))), 43758.5453)
          );
          this.$outputs.color = pb.vec4(pb.vec3(this.noise), 1);
        });
      }
    });
  }
  const tex = device.createTexture2D('rgba8unorm', size, size);
  const fb = device.createFrameBuffer([tex], null);
  device.pushDeviceStates();
  device.setFramebuffer(fb);
  device.setProgram(randomNoiseProgram);
  drawFullscreenQuad();
  device.popDeviceStates();
  fb.dispose();
  return tex;
}
