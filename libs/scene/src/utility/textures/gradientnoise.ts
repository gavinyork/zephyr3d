import type { AbstractDevice, BindGroup, GPUProgram } from '@zephyr3d/device';
import { drawFullscreenQuad } from '../../render/helper';

let gradientNoiseProgram: GPUProgram = null;
let gradientNoiseBindGroup: BindGroup = null;

export function createGradientNoiseTexture(device: AbstractDevice, size: number, uvscale: number) {
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
        pb.func('grad', [pb.vec2('p')], function () {
          this.$l.x = pb.mul(pb.fract(pb.add(pb.mul(this.p, 0.3183099), 0.1)), 17);
          this.$l.a = pb.fract(pb.mul(this.x.x, this.x.y, pb.add(this.x.x, this.x.y)));
          this.a = pb.mul(this.a, Math.PI * 2);
          this.$return(pb.vec2(pb.sin(this.a), pb.cos(this.a)));
        });
        pb.func('noise', [pb.vec2('p')], function () {
          this.$l.i = pb.floor(this.p);
          this.$l.f = pb.fract(this.p);
          this.$l.u = pb.mul(this.f, this.f, pb.sub(3, pb.mul(this.f, 2)));
          this.$l.tl = pb.dot(this.grad(this.i), this.f);
          this.$l.tr = pb.dot(this.grad(pb.add(this.i, pb.vec2(1, 0))), pb.sub(this.f, pb.vec2(1, 0)));
          this.$l.bl = pb.dot(this.grad(pb.add(this.i, pb.vec2(0, 1))), pb.sub(this.f, pb.vec2(0, 1)));
          this.$l.br = pb.dot(this.grad(pb.add(this.i, pb.vec2(1, 1))), pb.sub(this.f, pb.vec2(1, 1)));
          this.$l.noise = pb.add(
            pb.mul(
              pb.mix(pb.mix(this.tl, this.tr, this.u.x), pb.mix(this.bl, this.br, this.u.x), this.u.y),
              0.5
            ),
            0.5
          );
          this.$return(this.noise);
        });
        this.$outputs.color = pb.vec4();
        this.uvScale = pb.float().uniform(0);
        pb.main(function () {
          this.$outputs.color = pb.vec4(pb.vec3(this.noise(pb.mul(this.$inputs.uv, this.uvScale))), 1);
        });
      }
    });
    gradientNoiseBindGroup = device.createBindGroup(gradientNoiseProgram.bindGroupLayouts[0]);
  }
  const tex = device.createTexture2D('rgba8unorm', size, size);
  const fb = device.createFrameBuffer([tex], null);
  gradientNoiseBindGroup.setValue('uvScale', uvscale);
  device.pushDeviceStates();
  device.setFramebuffer(fb);
  device.setProgram(gradientNoiseProgram);
  device.setBindGroup(0, gradientNoiseBindGroup);
  drawFullscreenQuad();
  device.popDeviceStates();
  fb.dispose();
  return tex;
}
