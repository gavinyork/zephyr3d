import type { AbstractDevice, BindGroup, GPUProgram } from '@zephyr3d/device';
import { drawFullscreenQuad } from '../../render/fullscreenquad';
import { perlinNoise3D } from '../../shaders';

let gradientNoiseProgram: GPUProgram = null;
let gradientNoiseBindGroup: BindGroup = null;

/** @internal */
export function createGradientNoiseTexture(
  device: AbstractDevice,
  size: number,
  uvscale: number,
  mono = false,
  seed = 0
) {
  if (!gradientNoiseProgram) {
    gradientNoiseProgram = device.buildRenderProgram({
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
        this.uvScale = pb.float().uniform(0);
        this.seed = pb.float().uniform(0);
        this.mono = pb.int().uniform(0);
        pb.main(function () {
          this.$l.p = pb.vec3(pb.mul(this.$inputs.uv, this.uvScale), this.seed);
          this.$l.r = perlinNoise3D(this, this.p);
          //this.$l.r = gradient(this, this.p.xy, this.p.z).x;
          this.$if(pb.notEqual(this.mono, 0), function () {
            this.$outputs.color = pb.vec4(pb.vec3(this.r), 1);
          }).$else(function () {
            this.$l.g = perlinNoise3D(
              this,
              pb.vec3(pb.mul(this.$inputs.uv, this.uvScale), pb.add(this.seed, 1.9))
            );
            this.$l.b = perlinNoise3D(
              this,
              pb.vec3(pb.mul(this.$inputs.uv, this.uvScale), pb.add(this.seed, 2.3))
            );
            this.$outputs.color = pb.vec4(this.r, this.g, this.b, 1);
          });
        });
      }
    });
    gradientNoiseBindGroup = device.createBindGroup(gradientNoiseProgram.bindGroupLayouts[0]);
  }
  const tex = device.createTexture2D('rgba8unorm', size, size);
  const fb = device.createFrameBuffer([tex], null);
  gradientNoiseBindGroup.setValue('uvScale', uvscale);
  gradientNoiseBindGroup.setValue('seed', seed);
  gradientNoiseBindGroup.setValue('mono', mono ? 1 : 0);
  device.pushDeviceStates();
  device.setFramebuffer(fb);
  device.setProgram(gradientNoiseProgram);
  device.setBindGroup(0, gradientNoiseBindGroup);
  drawFullscreenQuad();
  device.popDeviceStates();
  fb.dispose();
  return tex;
}
