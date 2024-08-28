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
