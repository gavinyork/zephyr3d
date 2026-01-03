import type { Immutable, Nullable } from '@zephyr3d/base';
import { CubeFace } from '@zephyr3d/base';
import type { FrameBuffer, FrameBufferOptions, BaseTexture } from '@zephyr3d/device';
import { WebGPUObject } from './gpuobject_webgpu';
import type { WebGPUDevice } from './device';
import type { WebGPUBaseTexture } from './basetexture_webgpu';

type FrameBufferTextureAttachment = {
  texture: BaseTexture;
  face?: number;
  layer?: number;
  level?: number;
  generateMipmaps?: boolean;
};

type WebGPUFrameBufferOptions = {
  colorAttachments?: Nullable<FrameBufferTextureAttachment[]>;
  depthAttachment?: Nullable<FrameBufferTextureAttachment>;
  sampleCount?: number;
  ignoreDepthStencil?: boolean;
};

export class WebGPUFrameBuffer extends WebGPUObject<unknown> implements FrameBuffer<unknown> {
  private readonly _options: WebGPUFrameBufferOptions;
  private readonly _width: number;
  private readonly _height: number;
  private _bindFlag: number;
  private readonly _hash: string;
  private _msaaColorTextures: Nullable<GPUTexture[]>;
  private _msaaDepthTexture: Nullable<GPUTexture>;
  constructor(
    device: WebGPUDevice,
    colorAttachments: BaseTexture[],
    depthAttachment: BaseTexture,
    opt?: FrameBufferOptions
  ) {
    super(device);
    if (colorAttachments.length > 0 && colorAttachments.findIndex((val) => !val) >= 0) {
      throw new Error('WebGPUFramebuffer(): invalid color attachments');
    }
    this._object = null;
    this._options = {
      colorAttachments:
        colorAttachments?.length > 0
          ? colorAttachments.map((value) => ({
              texture: value,
              face: 0,
              layer: 0,
              level: 0,
              generateMipmaps: true
            }))
          : null,
      depthAttachment: depthAttachment
        ? {
            texture: depthAttachment,
            face: 0,
            layer: 0,
            level: 0,
            generateMipmaps: false
          }
        : null,
      sampleCount: opt?.sampleCount ?? 1,
      ignoreDepthStencil: opt?.ignoreDepthStencil ?? false
    };
    if (!this._options.colorAttachments && !this._options.depthAttachment) {
      throw new Error('WebGPUFramebuffer(): colorAttachments or depthAttachment must be specified');
    }
    this._width = this._options.colorAttachments
      ? this._options.colorAttachments[0].texture.width
      : this._options.depthAttachment!.texture.width;
    this._height = this._options.colorAttachments
      ? this._options.colorAttachments[0].texture.height
      : this._options.depthAttachment!.texture.height;
    if (
      (this._options.colorAttachments &&
        this._options.colorAttachments.findIndex(
          (val) => val.texture.width !== this._width || val.texture.height !== this._height
        ) >= 0) ||
      (this._options.depthAttachment &&
        (this._options.depthAttachment.texture.width !== this._width ||
          this._options.depthAttachment.texture.height !== this._height))
    ) {
      throw new Error('WebGPUFramebuffer(): attachment textures must have same width and height');
    }
    this._bindFlag = 0;
    this._msaaColorTextures = null;
    this._msaaDepthTexture = null;
    const colorAttachmentHash =
      this._options.colorAttachments?.map((tex) => tex.texture.format).join(':') ?? '';
    const depthAttachmentHash = this._options.depthAttachment?.texture.format ?? '';
    this._hash = `${colorAttachmentHash}-${depthAttachmentHash}-${this._options.sampleCount ?? 1}`;
    this._init();
  }
  getOptions(): Immutable<WebGPUFrameBufferOptions> {
    return this._options;
  }
  get bindFlag() {
    return this._bindFlag;
  }
  getHash() {
    return this._hash;
  }
  getWidth() {
    const attachment = this._options.colorAttachments?.[0] ?? this._options.depthAttachment;
    return attachment ? Math.max(attachment.texture.width >> attachment.level!, 1) : 0;
  }
  getHeight() {
    const attachment = this._options.colorAttachments?.[0] ?? this._options.depthAttachment;
    return attachment ? Math.max(attachment.texture.height >> attachment.level!, 1) : 0;
  }
  restore() {
    if (this._options?.depthAttachment?.texture?.disposed) {
      this._options.depthAttachment.texture.reload();
    }
    if (this._options?.colorAttachments) {
      for (const k of this._options.colorAttachments) {
        if (k?.texture?.disposed) {
          k.texture.reload();
        }
      }
    }
    if (!this._device.isContextLost()) {
      this._init();
    }
  }
  destroy() {
    this._object = null;
    if (this._msaaColorTextures) {
      for (const tex of this._msaaColorTextures) {
        tex.destroy();
      }
      this._msaaColorTextures = null;
    }
    if (this._msaaDepthTexture) {
      this._msaaDepthTexture.destroy();
      this._msaaDepthTexture = null;
    }
  }
  setColorAttachmentGenerateMipmaps(index: number, generateMipmaps: boolean) {
    const k = this._options.colorAttachments?.[index];
    if (k) {
      k.generateMipmaps = !!generateMipmaps;
    }
  }
  getColorAttachmentGenerateMipmaps(index: number) {
    return this._options.colorAttachments?.[index]?.generateMipmaps ?? false;
  }
  setColorAttachmentCubeFace(index: number, face: CubeFace) {
    const k = this._options.colorAttachments?.[index];
    if (k && k.face !== face) {
      k.face = face;
      this._bindFlag++;
    }
  }
  getColorAttachmentCubeFace(index: number) {
    return (this._options.colorAttachments?.[index].face as CubeFace) ?? CubeFace.PX;
  }
  setColorAttachmentMipLevel(index: number, level: number) {
    const k = this._options.colorAttachments?.[index];
    if (k && k.level !== level) {
      k.level = level;
      this._bindFlag++;
    }
  }
  getColorAttachmentMipLevel(index: number) {
    return this._options.colorAttachments?.[index].level ?? 0;
  }
  setColorAttachmentLayer(index: number, layer: number) {
    const k = this._options.colorAttachments?.[index];
    if (k && k.layer !== layer) {
      k.layer = layer;
      this._bindFlag++;
    }
  }
  getColorAttachmentLayer(index: number) {
    return this._options.colorAttachments?.[index].layer ?? 0;
  }
  setDepthAttachmentCubeFace(face: CubeFace) {
    const k = this._options.depthAttachment;
    if (k && k.face !== face) {
      k.face = face;
      this._bindFlag++;
    }
  }
  getDepthAttachmentCubeFace() {
    return (this._options.depthAttachment?.face as CubeFace) ?? CubeFace.PX;
  }
  setDepthAttachmentLayer(layer: number) {
    const k = this._options.depthAttachment;
    if (k && k.layer !== layer) {
      k.layer = layer;
      this._bindFlag++;
    }
  }
  getDepthAttachmentLayer() {
    return this._options.depthAttachment?.layer ?? 0;
  }
  getDepthAttachment() {
    return this._options?.depthAttachment?.texture || null;
  }
  getColorAttachments() {
    return this._options?.colorAttachments?.map((val) => val?.texture || null) || [];
  }
  getColorAttachment<T extends BaseTexture>(index: number): T {
    return (this.getColorAttachments()[index] as unknown as T) ?? null;
  }
  getMSAADepthAttachment() {
    return this._msaaDepthTexture;
  }
  getMSAAColorAttacments() {
    return this._msaaColorTextures;
  }
  getColorFormats() {
    return (
      this._options?.colorAttachments?.map((val) => (val.texture as WebGPUBaseTexture).gpuFormat!) ?? null
    );
  }
  getDepthFormat() {
    return (this._options.depthAttachment?.texture as WebGPUBaseTexture)?.gpuFormat ?? null;
  }
  bind() {
    return true;
  }
  unbind() {}
  private _init() {
    if (this._options.sampleCount! > 1) {
      this._msaaColorTextures = [];
      for (const colorAttachment of this._options.colorAttachments!) {
        const msaaTexture = (this.device as WebGPUDevice).gpuCreateTexture({
          size: {
            width: this._width,
            height: this._height,
            depthOrArrayLayers: 1
          },
          format: (colorAttachment.texture as WebGPUBaseTexture).gpuFormat!,
          mipLevelCount: 1,
          sampleCount: this._options.sampleCount,
          dimension: '2d',
          usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT
        });
        this._msaaColorTextures.push(msaaTexture);
      }
      if (this._options.depthAttachment) {
        const msaaDepthTexture = (this.device as WebGPUDevice).gpuCreateTexture({
          size: {
            width: this._width,
            height: this._height,
            depthOrArrayLayers: 1
          },
          format: (this._options.depthAttachment.texture as WebGPUBaseTexture).gpuFormat!,
          mipLevelCount: 1,
          sampleCount: this._options.sampleCount,
          dimension: '2d',
          usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT
        });
        this._msaaDepthTexture = msaaDepthTexture;
      }
    }
    this._object = {};
  }
  isFramebuffer(): this is FrameBuffer {
    return true;
  }
  getSampleCount() {
    return this._options.sampleCount!;
  }
}
