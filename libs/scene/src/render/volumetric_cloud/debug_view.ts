import type { Nullable } from '@zephyr3d/base';
import type { Matrix4x4 } from '@zephyr3d/base';
import { Vector4 } from '@zephyr3d/base';
import type { BindGroup, GPUProgram } from '@zephyr3d/device';
import { getDevice } from '../../app/api';
import { fetchSampler } from '../../utility/misc';
import { drawFullscreenQuad } from '../fullscreenquad';
import type { VolumetricCloudResources } from './resources';
import type { VolumetricCloudDebugView } from './volumetric_cloud';
import { cloudSampleDensity, getCloudParamsStruct } from './cloud_common';

let volumeProgram: Nullable<GPUProgram> = null;
let mapProgram: Nullable<GPUProgram> = null;
let volumeBindGroup: Nullable<BindGroup> = null;
let mapBindGroup: Nullable<BindGroup> = null;
const densityPrograms = new Map<string, { program: GPUProgram; bindGroup: BindGroup }>();

function createProgram(volume: boolean, densityView?: string) {
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
      if (densityView) {
        this.cloud = getCloudParamsStruct(pb)().uniform(0);
        this.weatherMap = pb.tex2D().uniform(0);
        this.baseNoise = pb.tex3D().uniform(0);
        this.detailNoise = pb.tex3D().uniform(0);
      } else {
        this.tex = volume ? pb.tex3D().uniform(0) : pb.tex2D().uniform(0);
      }
      // (slice, channel, 0, 0)
      this.params = pb.vec4().uniform(0);
      this.$outputs.color = pb.vec4();
      pb.main(function () {
        if (densityView) {
          const xy = densityView.endsWith('XY');
          this.$l.uv = this.$inputs.uv;
          this.$l.h = xy ? this.uv.y : this.params.x;
          this.$l.xz = pb.div(xy ? pb.vec2(this.uv.x, this.params.x) : this.uv, this.cloud.scales.x);
          this.$l.r = pb.mix(this.cloud.layer.x, this.cloud.layer.y, this.h);
          // Planet-fixed XZ coordinates; the slice follows the spherical layer at each height.
          this.$l.planet = pb.vec3(
            this.xz.x,
            pb.sqrt(pb.max(pb.sub(pb.mul(this.r, this.r), pb.dot(this.xz, this.xz)), 0)),
            this.xz.y
          );
          this.$l.p = pb.mul(this.cloud.referential, pb.vec4(this.planet, 0)).xyz;
          this.$l.medium = cloudSampleDensity(
            this,
            this.cloud,
            this.p,
            this.weatherMap,
            this.baseNoise,
            this.detailNoise,
            densityView.startsWith('profile')
              ? 'profile'
              : densityView.startsWith('base')
                ? 'base'
                : 'density'
          );
          this.$l.value = pb.clamp(pb.div(this.medium.x, pb.max(this.cloud.density.y, 1e-6)), 0, 1);
          this.$outputs.color = pb.vec4(pb.vec3(this.value), 1);
          return;
        }
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
  channel: number,
  densityParams?: Nullable<Record<string, Vector4 | Matrix4x4>>
) {
  if (view.endsWith('XY') || view.endsWith('XZ')) {
    if (!densityParams || !resources.weatherMap || !resources.baseNoise || !resources.detailNoise) {
      return;
    }
    const device = getDevice();
    let entry = densityPrograms.get(view);
    if (!entry) {
      const program = createProgram(false, view);
      entry = { program, bindGroup: device.createBindGroup(program.bindGroupLayouts[0]) };
      densityPrograms.set(view, entry);
    }
    const { program, bindGroup } = entry;
    bindGroup.setValue('cloud', densityParams);
    bindGroup.setValue('params', new Vector4(slice, 0, 0, 0));
    bindGroup.setValue('flip', device.type === 'webgpu' && device.getFramebuffer() ? 1 : 0);
    bindGroup.setTexture('weatherMap', resources.weatherMap, fetchSampler('repeat_linear'));
    bindGroup.setTexture('baseNoise', resources.baseNoise);
    bindGroup.setTexture('detailNoise', resources.detailNoise);
    device.setProgram(program);
    device.setBindGroup(0, bindGroup);
    drawFullscreenQuad();
    return;
  }
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
