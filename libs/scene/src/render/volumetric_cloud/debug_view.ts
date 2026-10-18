import type { Nullable } from '@zephyr3d/base';
import { Vector4 } from '@zephyr3d/base';
import type { BindGroup, GPUProgram } from '@zephyr3d/device';
import { getDevice } from '../../app/api';
import { fetchSampler } from '../../utility/misc';
import { drawFullscreenQuad } from '../fullscreenquad';
import type { VolumetricCloudResources } from './resources';
import type { VolumetricCloudDebugView } from './volumetric_cloud';

let volumeProgram: Nullable<GPUProgram> = null;
let mapProgram: Nullable<GPUProgram> = null;
let volumeBindGroup: Nullable<BindGroup> = null;
let mapBindGroup: Nullable<BindGroup> = null;

function createProgram(volume: boolean) {
  const device = getDevice();
  return device.buildRenderProgram({
    label: volume ? 'CloudDebugVolume' : 'CloudDebugMap',
    vertex(pb) {
      this.flip = pb.int().uniform(0);
      this.$inputs.pos = pb.vec2().attrib('position');
      this.$outputs.uv = pb.vec2();
      pb.main(function () {
        this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
        this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
        this.$if(pb.notEqual(this.flip, 0), function () {
          this.$builtins.position.y = pb.neg(this.$builtins.position.y);
        });
      });
    },
    fragment(pb) {
      this.tex = volume ? pb.tex3D().uniform(0) : pb.tex2D().uniform(0);
      // (slice, channel, 0, 0)
      this.params = pb.vec4().uniform(0);
      this.$outputs.color = pb.vec4();
      pb.main(function () {
        this.$l.value = volume
          ? pb.textureSampleLevel(this.tex, pb.vec3(this.$inputs.uv, this.params.x), 0)
          : pb.textureSampleLevel(this.tex, this.$inputs.uv, 0);
        this.$l.channel = pb.int(this.params.y);
        this.$l.rgb = this.value.rgb;
        this.$if(pb.equal(this.channel, 1), function () {
          this.rgb = pb.vec3(this.value.r);
        })
          .$elseif(pb.equal(this.channel, 2), function () {
            this.rgb = pb.vec3(this.value.g);
          })
          .$elseif(pb.equal(this.channel, 3), function () {
            this.rgb = pb.vec3(this.value.b);
          })
          .$elseif(pb.equal(this.channel, 4), function () {
            this.rgb = pb.vec3(this.value.a);
          });
        this.$outputs.color = pb.vec4(this.rgb, 1);
      });
    }
  })!;
}

/**
 * Covers the current render target with a cloud resource: a slice of a noise volume or the
 * weather map. `channel` 0 shows RGB, 1-4 one channel as grey.
 * @internal
 */
export function drawVolumetricCloudDebug(
  resources: VolumetricCloudResources,
  view: VolumetricCloudDebugView,
  slice: number,
  channel: number
) {
  const tex =
    view === 'baseNoise'
      ? resources.baseNoise
      : view === 'detailNoise'
        ? resources.detailNoise
        : view === 'weather'
          ? resources.weatherMap
          : null;
  if (!tex) {
    return;
  }
  const device = getDevice();
  const volume = tex.isTexture3D();
  let program: GPUProgram;
  let bindGroup: BindGroup;
  if (volume) {
    volumeProgram = volumeProgram ?? createProgram(true);
    volumeBindGroup = volumeBindGroup ?? device.createBindGroup(volumeProgram.bindGroupLayouts[0]);
    program = volumeProgram;
    bindGroup = volumeBindGroup;
  } else {
    mapProgram = mapProgram ?? createProgram(false);
    mapBindGroup = mapBindGroup ?? device.createBindGroup(mapProgram.bindGroupLayouts[0]);
    program = mapProgram;
    bindGroup = mapBindGroup;
  }
  bindGroup.setTexture('tex', tex, fetchSampler('repeat_linear_nomip'));
  bindGroup.setValue('flip', device.type === 'webgpu' && device.getFramebuffer() ? 1 : 0);
  bindGroup.setValue('params', new Vector4(slice, channel, 0, 0));
  device.setProgram(program);
  device.setBindGroup(0, bindGroup);
  drawFullscreenQuad();
}
