import type { Nullable } from '@zephyr3d/base';
import { CubeFace } from '@zephyr3d/base';
import type { BaseTexture, FrameBuffer, FrameBufferOptions } from '@zephyr3d/device';
import { NullGPUObject } from './gpuobject_null';
import type { NullDevice } from './device_null';

type NullFrameBufferAttachment = {
  texture: BaseTexture;
  face: number;
  layer: number;
  level: number;
  generateMipmaps: boolean;
};

type NullFrameBufferOptions = {
  colorAttachments: Nullable<NullFrameBufferAttachment[]>;
  depthAttachment: Nullable<NullFrameBufferAttachment>;
  sampleCount: number;
  ignoreDepthStencil: boolean;
};

/**
 * Frame buffer of a null device
 * @public
 */
export class NullFrameBuffer extends NullGPUObject<unknown> implements FrameBuffer<unknown> {
  /** @internal */
  private readonly _options: NullFrameBufferOptions;
  /** @internal */
  private readonly _width: number;
  /** @internal */
  private readonly _height: number;
  /** @internal */
  private readonly _hash: string;
  /** @internal */
  private _needGenerateMipmaps: boolean;
  constructor(
    device: NullDevice,
    colorAttachments: BaseTexture[],
    depthAttachment: Nullable<BaseTexture>,
    opt?: Nullable<FrameBufferOptions>
  ) {
    super(device);
    if (colorAttachments?.length > 0 && colorAttachments.findIndex((val) => !val) >= 0) {
      throw new Error('NullFrameBuffer(): invalid color attachments');
    }
    this._options = {
      colorAttachments:
        colorAttachments?.length > 0
          ? colorAttachments.map((texture) => ({
              texture,
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
      sampleCount: device.type === 'webgl' ? 1 : (opt?.sampleCount ?? 1),
      ignoreDepthStencil: opt?.ignoreDepthStencil ?? false
    };
    if (!this._options.colorAttachments && !this._options.depthAttachment) {
      throw new Error('NullFrameBuffer(): colorAttachments or depthAttachment must be specified');
    }
    const first = this._options.colorAttachments?.[0] ?? this._options.depthAttachment!;
    this._width = first.texture.width;
    this._height = first.texture.height;
    if (
      (this._options.colorAttachments &&
        this._options.colorAttachments.findIndex(
          (val) => val.texture.width !== this._width || val.texture.height !== this._height
        ) >= 0) ||
      (this._options.depthAttachment &&
        (this._options.depthAttachment.texture.width !== this._width ||
          this._options.depthAttachment.texture.height !== this._height))
    ) {
      throw new Error('NullFrameBuffer(): attachment textures must have same width and height');
    }
    if (this._options.sampleCount !== 1 && this._options.sampleCount !== 4) {
      throw new Error(`NullFrameBuffer(): Sample count should be 1 or 4, got ${this._options.sampleCount}`);
    }
    if (
      this._options.sampleCount > 1 &&
      !device.getDeviceCaps().framebufferCaps.supportMultisampledFramebuffer
    ) {
      throw new Error('NullFrameBuffer(): Multisampled frame buffer not supported');
    }
    const colorAttachmentHash =
      this._options.colorAttachments?.map((val) => val.texture.format).join(':') ?? '';
    const depthAttachmentHash = this._options.depthAttachment?.texture.format ?? '';
    this._hash = `${colorAttachmentHash}-${depthAttachmentHash}-${this._options.sampleCount}`;
    this._needGenerateMipmaps = false;
    this._object = this._createFakeObject();
  }
  getWidth() {
    const attachment = this._options.colorAttachments?.[0] ?? this._options.depthAttachment!;
    return Math.max(attachment.texture.width >> attachment.level, 1);
  }
  getHeight() {
    const attachment = this._options.colorAttachments?.[0] ?? this._options.depthAttachment!;
    return Math.max(attachment.texture.height >> attachment.level, 1);
  }
  getSampleCount() {
    return this._options.sampleCount;
  }
  getHash() {
    return this._hash;
  }
  /** Whether depth stencil resolve is skipped for a multisampled frame buffer */
  getIgnoreDepthStencil() {
    return this._options.ignoreDepthStencil;
  }
  setColorAttachmentCubeFace(index: number, face: CubeFace) {
    const k = this._options.colorAttachments?.[index];
    if (k) {
      k.face = face;
    }
  }
  getColorAttachmentCubeFace(index: number) {
    return (this._options.colorAttachments?.[index]?.face as CubeFace) ?? CubeFace.PX;
  }
  setColorAttachmentMipLevel(index: number, level: number) {
    const k = this._options.colorAttachments?.[index];
    if (k) {
      k.level = level;
    }
  }
  getColorAttachmentMipLevel(index: number) {
    return this._options.colorAttachments?.[index]?.level ?? 0;
  }
  setColorAttachmentLayer(index: number, layer: number) {
    const k = this._options.colorAttachments?.[index];
    if (k) {
      k.layer = layer;
    }
  }
  getColorAttachmentLayer(index: number) {
    return this._options.colorAttachments?.[index]?.layer ?? 0;
  }
  setColorAttachmentGenerateMipmaps(index: number, generateMipmaps: boolean) {
    const k = this._options.colorAttachments?.[index];
    if (k) {
      k.generateMipmaps = !!generateMipmaps;
    }
  }
  getColorAttachmentGenerateMipmaps(index: number) {
    return !!this._options.colorAttachments?.[index]?.generateMipmaps;
  }
  setDepthAttachmentCubeFace(face: CubeFace) {
    const k = this._options.depthAttachment;
    if (k) {
      k.face = face;
    }
  }
  getDepthAttachmentCubeFace() {
    return (this._options.depthAttachment?.face as CubeFace) ?? CubeFace.PX;
  }
  setDepthAttachmentLayer(layer: number) {
    const k = this._options.depthAttachment;
    if (k) {
      k.layer = layer;
    }
  }
  getDepthAttachmentLayer() {
    return this._options.depthAttachment?.layer ?? 0;
  }
  getColorAttachments() {
    return this._options.colorAttachments?.map((val) => val.texture) ?? [];
  }
  getDepthAttachment() {
    return this._options.depthAttachment?.texture ?? null;
  }
  getColorAttachment<T extends BaseTexture = BaseTexture>(index: number): T {
    return (this.getColorAttachments()[index] as unknown as T) ?? null;
  }
  isFramebuffer(): this is FrameBuffer {
    return true;
  }
  /** @internal */
  invalidateMipmaps() {
    this._needGenerateMipmaps = true;
  }
  bind() {
    if (!this._object) {
      return false;
    }
    // A real framebuffer becomes incomplete once an attachment is deleted, so
    // reject the bind instead of silently rendering into a dead attachment.
    for (const attachment of this.getAttachments()) {
      if (attachment.disposed || !attachment.object) {
        this._device.reportFramebufferError(
          `NullFrameBuffer.bind() failed: attachment '${attachment.name}' has been disposed`
        );
        return false;
      }
    }
    this._needGenerateMipmaps = false;
    return true;
  }
  /** All attachment textures, color attachments first */
  getAttachments(): BaseTexture[] {
    const attachments = this._options.colorAttachments?.map((val) => val.texture) ?? [];
    if (this._options.depthAttachment) {
      attachments.push(this._options.depthAttachment.texture);
    }
    return attachments;
  }
  unbind() {
    if (this._needGenerateMipmaps && this._options.colorAttachments) {
      for (const attachment of this._options.colorAttachments) {
        if (attachment.generateMipmaps && attachment.texture.mipLevelCount > 1) {
          attachment.texture.generateMipmaps();
        }
      }
    }
    this._needGenerateMipmaps = false;
  }
  destroy() {
    this._object = null;
  }
  restore() {
    this._object = this._createFakeObject();
  }
}
