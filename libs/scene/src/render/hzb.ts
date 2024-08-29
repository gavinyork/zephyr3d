import type {
  AbstractDevice,
  BindGroup,
  FrameBuffer,
  GPUProgram,
  Texture2D,
  TextureSampler
} from '@zephyr3d/device';
import { drawFullscreenQuad } from './fullscreenquad';
import { Application } from '../app';
import { CopyBlitter } from '../blitter';

let hzbProgram: GPUProgram = null;
let hzbBindGroup: BindGroup = null;
let hzbSampler: TextureSampler = null;
let blitter: CopyBlitter = null;
let srcSize: Int32Array = null;

/*
float2 cell(float2 ray, float2 cell_count, uint camera) {
 return floor(ray.xy * cell_count);
}

float2 cell_count(float level) {
 return input_texture2_size / (level == 0.0 ? 1.0 : exp2(level));
}

float3 intersect_cell_boundary(float3 pos, float3 dir, float2 cell_id, float2 cell_count, float2 cross_step, float2 cross_offset, uint camera) {
 float2 cell_size = 1.0 / cell_count;
 float2 planes = cell_id/cell_count + cell_size * cross_step;

 float2 solutions = (planes - pos)/dir.xy;
 float3 intersection_pos = pos + dir * min(solutions.x, solutions.y);

 intersection_pos.xy += (solutions.x < solutions.y) ? float2(cross_offset.x, 0.0) : float2(0.0, cross_offset.y);

 return intersection_pos;
}

bool crossed_cell_boundary(float2 cell_id_one, float2 cell_id_two) {
 return (int)cell_id_one.x != (int)cell_id_two.x || (int)cell_id_one.y != (int)cell_id_two.y;
}

float minimum_depth_plane(float2 ray, float level, float2 cell_count, uint camera) {
 return input_texture2.Load(int3(vr_stereo_to_mono(ray.xy, camera) * cell_count, level)).r;
}

float3 hi_z_trace(float3 p, float3 v, in uint camera, out uint iterations) {
 float level = HIZ_START_LEVEL;
 float3 v_z = v/v.z;
 float2 hi_z_size = cell_count(level);
 float3 ray = p;

 float2 cross_step = float2(v.x >= 0.0 ? 1.0 : -1.0, v.y >= 0.0 ? 1.0 : -1.0);
 float2 cross_offset = cross_step * 0.00001;
 cross_step = saturate(cross_step);

 float2 ray_cell = cell(ray.xy, hi_z_size.xy, camera);
 ray = intersect_cell_boundary(ray, v, ray_cell, hi_z_size, cross_step, cross_offset, camera);

 iterations = 0;
 while(level >= HIZ_STOP_LEVEL && iterations < MAX_ITERATIONS) {
  // get the cell number of the current ray
  float2 current_cell_count = cell_count(level);
  float2 old_cell_id = cell(ray.xy, current_cell_count, camera);

  // get the minimum depth plane in which the current ray resides
  float min_z = minimum_depth_plane(ray.xy, level, current_cell_count, camera);

  // intersect only if ray depth is below the minimum depth plane
  float3 tmp_ray = ray;
  if(v.z > 0) {
   float min_minus_ray = min_z - ray.z;
   tmp_ray = min_minus_ray > 0 ? ray + v_z*min_minus_ray : tmp_ray;
   float2 new_cell_id = cell(tmp_ray.xy, current_cell_count, camera);
   if(crossed_cell_boundary(old_cell_id, new_cell_id)) {
    tmp_ray = intersect_cell_boundary(ray, v, old_cell_id, current_cell_count, cross_step, cross_offset, camera);
    level = min(HIZ_MAX_LEVEL, level + 2.0f);
   }else{
    if(level == 1 && abs(min_minus_ray) > 0.0001) {
     tmp_ray = intersect_cell_boundary(ray, v, old_cell_id, current_cell_count, cross_step, cross_offset, camera);
     level = 2;
    }
   }
  } else if(ray.z < min_z) {
   tmp_ray = intersect_cell_boundary(ray, v, old_cell_id, current_cell_count, cross_step, cross_offset, camera);
   level = min(HIZ_MAX_LEVEL, level + 2.0f);
  }

  ray.xyz = tmp_ray.xyz;
  --level;

  ++iterations;
 }
 return ray;
}
*/

function buildHZBProgram(device: AbstractDevice): GPUProgram {
  return device.buildRenderProgram({
    label: 'HZBBuilder',
    vertex(pb) {
      this.$inputs.pos = pb.vec2().attrib('position');
      this.$outputs.uv = pb.vec2();
      pb.main(function () {
        this.$builtins.position = pb.vec4(this.$inputs.pos, 1, 1);
        this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
        if (device.type === 'webgpu') {
          this.$builtins.position.y = pb.neg(this.$builtins.position.y);
        }
      });
    },
    fragment(pb) {
      this.$outputs.color = pb.vec4();
      this.srcTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
      this.srcSize = pb.ivec2().uniform(0);
      if (device.type !== 'webgpu') {
        this.srcMipLevel = pb.int().uniform(0);
      }
      pb.main(function () {
        this.$l.coord = pb.mul(pb.ivec2(this.$builtins.fragCoord.xy), 2);
        this.$l.minCoord = pb.ivec2(0, 0);
        this.$l.maxCoord = pb.sub(this.srcSize, pb.ivec2(1, 1));
        for (let i = 0; i < 4; i++) {
          this.$l[`d${i}`] = pb.textureLoad(
            this.srcTex,
            pb.clamp(pb.add(this.coord, pb.ivec2(i >> 1, i & 1)), this.minCoord, this.maxCoord),
            device.type === 'webgpu' ? 0 : this.srcMipLevel
          ).r;
        }
        this.$l.d = pb.min(pb.min(this.d0, this.d1), pb.min(this.d2, this.d3));
        this.$outputs.color = pb.vec4(this.d, 0, 0, 1);
      });
    }
  });
}

function buildHiZLevel(
  device: AbstractDevice,
  miplevel: number,
  srcTexture: Texture2D,
  dstTexture: Texture2D
): void {
  const framebuffer = device.createFrameBuffer([dstTexture], null);
  framebuffer.setColorAttachmentMipLevel(0, miplevel + 1);
  framebuffer.setColorAttachmentGenerateMipmaps(0, false);
  srcSize[0] = Math.max(srcTexture.width >> miplevel, 1);
  srcSize[1] = Math.max(srcTexture.height >> miplevel, 1);
  hzbBindGroup.setValue('srcSize', srcSize);
  if (device.type === 'webgpu') {
    hzbBindGroup.setTextureView('srcTex', srcTexture, miplevel, 0, 1, hzbSampler);
  } else {
    hzbBindGroup.setTexture('srcTex', srcTexture, hzbSampler);
    hzbBindGroup.setValue('srcMipLevel', miplevel);
  }
  device.setProgram(hzbProgram);
  device.setBindGroup(0, hzbBindGroup);
  device.setFramebuffer(framebuffer);
  drawFullscreenQuad();
  if (srcTexture !== dstTexture) {
    device.copyFramebufferToTexture2D(framebuffer, 0, srcTexture, miplevel + 1);
  }
}

export function buildHiZ(sourceTex: Texture2D, HiZFrameBuffer: FrameBuffer) {
  const device = Application.instance.device;
  if (!hzbProgram) {
    hzbProgram = buildHZBProgram(device);
    hzbBindGroup = device.createBindGroup(hzbProgram.bindGroupLayouts[0]);
    hzbSampler = device.createSampler({
      addressU: 'clamp',
      addressV: 'clamp',
      magFilter: 'nearest',
      mipFilter: 'nearest',
      minFilter: 'nearest'
    });
    blitter = new CopyBlitter();
    srcSize = new Int32Array(2);
  }
  blitter.blit(sourceTex, HiZFrameBuffer, hzbSampler);
  device.pushDeviceStates();
  const srcTex = HiZFrameBuffer.getColorAttachments()[0] as Texture2D;
  if (device.type === 'webgpu') {
    for (let i = 0; i < srcTex.mipLevelCount - 1; i++) {
      buildHiZLevel(device, i, srcTex, srcTex);
    }
  } else {
    const tmpFramebuffer = device.pool.fetchTemporalFramebuffer(
      false,
      HiZFrameBuffer.getWidth(),
      HiZFrameBuffer.getHeight(),
      HiZFrameBuffer.getColorAttachments()[0].format,
      null,
      true
    );
    const dstTex = tmpFramebuffer.getColorAttachments()[0] as Texture2D;
    for (let i = 0; i < srcTex.mipLevelCount - 1; i++) {
      buildHiZLevel(device, i, srcTex, dstTex);
    }
    device.pool.releaseFrameBuffer(tmpFramebuffer);
  }
  device.popDeviceStates();
}
