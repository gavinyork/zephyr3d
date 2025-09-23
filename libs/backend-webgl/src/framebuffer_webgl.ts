import { CubeFace } from '@zephyr3d/base';
import type { BaseTexture, FrameBuffer, FrameBufferOptions } from '@zephyr3d/device';
import { hasStencilChannel } from '@zephyr3d/device';
import { WebGLGPUObject } from './gpuobject_webgl';
import { WebGLEnum } from './webgl_enum';
import { cubeMapFaceMap } from './constants_webgl';
import type { WebGLTextureCaps } from './capabilities_webgl';
import type { WebGLDevice } from './device_webgl';
import type { WebGLTexture2D } from './texture2d_webgl';
import type { WebGLTextureCube } from './texturecube_webgl';

type FrameBufferTextureAttachment = {
  texture: BaseTexture;
  face?: number;
  layer?: number;
  level?: number;
  generateMipmaps?: boolean;
};

type Options = {
  colorAttachments?: FrameBufferTextureAttachment[];
  depthAttachment?: FrameBufferTextureAttachment;
  sampleCount?: number;
  ignoreDepthStencil?: boolean;
};

const STATUS_UNCHECKED = 0;
const STATUS_OK = 1;
const STATUS_FAILED = 2;
export class WebGLFrameBuffer
  extends WebGLGPUObject<WebGLFramebuffer>
  implements FrameBuffer<WebGLFramebuffer>
{
  private readonly _options: Options;
  private _needBindBuffers: boolean;
  private _drawTags: number;
  private _lastDrawTag: number;
  private _status: number;
  private _statusAA: number;
  private readonly _width: number;
  private readonly _height: number;
  private readonly _isMRT: boolean;
  private _drawBuffers: number[];
  private readonly _hash: string;
  private _needGenerateMipmaps: boolean;
  private readonly _depthAttachmentTarget: number;
  private _colorAttachmentsAA: WebGLRenderbuffer[];
  private _depthAttachmentAA: WebGLRenderbuffer;
  private _intermediateAttachments: Map<
    BaseTexture,
    { texture: WebGLTexture; width: number; height: number }[]
  >;
  private _framebufferAA: WebGLFramebuffer;
  private _initialized: boolean;
  constructor(
    device: WebGLDevice,
    colorAttachments: BaseTexture[],
    depthAttachment: BaseTexture,
    opt?: FrameBufferOptions
  ) {
    super(device);
    if (colorAttachments.length > 0 && colorAttachments.findIndex((val) => !val) >= 0) {
      throw new Error('WebGLFramebuffer(): invalid color attachments');
    }
    this._object = null;
    this._framebufferAA = null;
    this._colorAttachmentsAA = null;
    this._depthAttachmentAA = null;
    this._intermediateAttachments = null;
    this._needBindBuffers = false;
    this._drawTags = 0;
    this._lastDrawTag = -1;
    this._status = STATUS_UNCHECKED;
    this._statusAA = STATUS_UNCHECKED;
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
      sampleCount: device.type === 'webgl' ? 1 : opt?.sampleCount ?? 1,
      ignoreDepthStencil: opt?.ignoreDepthStencil ?? false
    };
    if (!this._options.colorAttachments && !this._options.depthAttachment) {
      throw new Error('WebGLFramebuffer(): colorAttachments or depthAttachment must be specified');
    }
    this._width = this._options.colorAttachments
      ? this._options.colorAttachments[0].texture.width
      : this._options.depthAttachment.texture.width;
    this._height = this._options.colorAttachments
      ? this._options.colorAttachments[0].texture.height
      : this._options.depthAttachment.texture.height;
    if (
      (this._options.colorAttachments &&
        this._options.colorAttachments.findIndex(
          (val) => val.texture.width !== this._width || val.texture.height !== this._height
        ) >= 0) ||
      (this._options.depthAttachment &&
        (this._options.depthAttachment.texture.width !== this._width ||
          this._options.depthAttachment.texture.height !== this._height))
    ) {
      throw new Error('WebGLFramebuffer(): attachment textures must have same width and height');
    }
    this._drawBuffers =
      this._options.colorAttachments?.map((val, index) => WebGLEnum.COLOR_ATTACHMENT0 + index) ?? [];
    this._isMRT = this._drawBuffers.length > 1;
    if (this._options.depthAttachment) {
      const format = this._options.depthAttachment.texture.format;
      this._depthAttachmentTarget = hasStencilChannel(format)
        ? WebGLEnum.DEPTH_STENCIL_ATTACHMENT
        : WebGLEnum.DEPTH_ATTACHMENT;
    } else {
      this._depthAttachmentTarget = WebGLEnum.NONE;
    }
    const colorAttachmentHash =
      this._options.colorAttachments?.map((tex) => tex.texture.format).join(':') ?? '';
    const depthAttachmentHash = this._options.depthAttachment?.texture.format ?? '';
    this._hash = `${colorAttachmentHash}-${depthAttachmentHash}-${this._options.sampleCount ?? 1}`;
    this._needGenerateMipmaps = false;
    this._initialized = false;
  }
  tagDraw() {
    this._drawTags++;
  }
  isMRT(): boolean {
    return this._isMRT;
  }
  invalidateMipmaps() {
    this._needGenerateMipmaps = true;
  }
  getWidth(): number {
    const attachment = this._options.colorAttachments?.[0] ?? this._options.depthAttachment;
    return Math.max(attachment.texture.width >> attachment.level, 1);
  }
  getHeight(): number {
    const attachment = this._options.colorAttachments?.[0] ?? this._options.depthAttachment;
    return Math.max(attachment.texture.height >> attachment.level, 1);
  }
  getHash(): string {
    return this._hash;
  }
  restore() {
    if (!this._object && !this._device.isContextLost()) {
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
    }
    this._init();
  }
  destroy() {
    if (this._object) {
      this._device.context.deleteFramebuffer(this._object);
      this._object = null;
      if (this._colorAttachmentsAA) {
        for (const rb of this._colorAttachmentsAA) {
          this._device.context.deleteRenderbuffer(rb);
        }
        this._colorAttachmentsAA = null;
      }
      if (this._depthAttachmentAA) {
        this._device.context.deleteRenderbuffer(this._depthAttachmentAA);
        this._depthAttachmentAA = null;
      }
      if (this._framebufferAA) {
        this._device.context.deleteFramebuffer(this._framebufferAA);
        this._framebufferAA = null;
      }
      if (this._intermediateAttachments) {
        for (const entry of this._intermediateAttachments) {
          for (const rb of entry[1]) {
            if (rb) {
              this._device.context.deleteTexture(rb.texture);
              this._device.invalidateBindingTextures();
            }
          }
        }
        this._intermediateAttachments = null;
      }
    }
  }
  setColorAttachmentGenerateMipmaps(index: number, generateMipmaps: boolean): void {
    const k = this._options.colorAttachments?.[index];
    if (k) {
      k.generateMipmaps = !!generateMipmaps;
    }
  }
  getColorAttachmentGenerateMipmaps(index: number): boolean {
    return this._options.colorAttachments?.[index]?.generateMipmaps;
  }
  setColorAttachmentCubeFace(index: number, face: CubeFace) {
    const k = this._options.colorAttachments?.[index];
    if (k && k.face !== face) {
      this._needBindBuffers = true;
      if (this._device.context._currentFramebuffer === this) {
        this.unbind();
        k.face = face;
        this.bind();
      } else {
        k.face = face;
      }
    }
  }
  getColorAttachmentCubeFace(index: number): CubeFace {
    return this._options.colorAttachments?.[index]?.face;
  }
  setColorAttachmentMipLevel(index: number, level: number) {
    const k = this._options.colorAttachments?.[index];
    if (k && k.level !== level) {
      this._needBindBuffers = true;
      if (this._device.context._currentFramebuffer === this) {
        this.unbind();
        k.level = level;
        this.bind();
      } else {
        k.level = level;
      }
    }
  }
  getColorAttachmentMipLevel(index: number): number {
    return this._options.colorAttachments?.[index]?.level;
  }
  setColorAttachmentLayer(index: number, layer: number) {
    const k = this._options.colorAttachments?.[index];
    if (k && k.layer !== layer) {
      this._needBindBuffers = true;
      if (this._device.context._currentFramebuffer === this) {
        this.unbind();
        k.layer = layer;
        this.bind();
      } else {
        k.layer = layer;
      }
    }
  }
  getColorAttachmentLayer(index: number) {
    return this._options?.colorAttachments?.[index]?.layer;
  }
  setDepthAttachmentCubeFace(face: CubeFace): void {
    const k = this._options.depthAttachment;
    if (k && k.face !== face) {
      this._needBindBuffers = true;
      if (this._device.context._currentFramebuffer === this) {
        this.unbind();
        k.face = face;
        this.bind();
      } else {
        k.face = face;
      }
    }
  }
  getDepthAttachmentCubeFace(): CubeFace {
    return this._options.depthAttachment?.face;
  }
  setDepthAttachmentLayer(layer: number) {
    const k = this._options.depthAttachment;
    if (k && k.layer !== layer) {
      this._needBindBuffers = true;
      if (this._device.context._currentFramebuffer === this) {
        this.unbind();
        k.layer = layer;
        this.bind();
      } else {
        k.layer = layer;
      }
    }
  }
  getDepthAttachmentLayer() {
    return this._options.depthAttachment?.layer;
  }
  getDepthAttachment(): BaseTexture {
    return this._options?.depthAttachment?.texture || null;
  }
  getColorAttachments(): BaseTexture[] {
    return this._options.colorAttachments?.map((val) => val.texture || null) || [];
  }
  getColorAttachment<T extends BaseTexture>(index: number): T {
    return (this.getColorAttachments()[index] as unknown as T) ?? null;
  }
  bind(): boolean {
    if (!this._initialized) {
      this._init();
      this._initialized = true;
    }
    if (this._object) {
      this._device.context._currentFramebuffer = this;
      this._lastDrawTag = -1;
      if (this._needBindBuffers) {
        this._needBindBuffers = false;
        if (!this._bindBuffersAA() || !this._bindBuffers()) {
          this._device.context.bindFramebuffer(WebGLEnum.FRAMEBUFFER, null);
          this._device.context._currentFramebuffer = null;
          return false;
        }
      }
      this._device.context.bindFramebuffer(WebGLEnum.FRAMEBUFFER, this._framebufferAA || this._object);
      const drawBuffersExt = this._device.drawBuffersExt;
      if (drawBuffersExt) {
        drawBuffersExt.drawBuffers(this._drawBuffers);
      } else if (this._isMRT) {
        console.error('device does not support multiple framebuffer color attachments');
      }
      this._device.setViewport(null);
      this._device.setScissor(null);
      this._needGenerateMipmaps = false;
      return true;
    }
    return false;
  }
  unbind(): void {
    if (this._device.context._currentFramebuffer === this) {
      this._updateMSAABuffer();
      this._device.context.bindFramebuffer(WebGLEnum.FRAMEBUFFER, null);
      this._device.context._currentFramebuffer = null;
      this._device.setViewport();
      this._device.setScissor();
      const drawBuffersExt = this._device.drawBuffersExt;
      if (drawBuffersExt) {
        drawBuffersExt.drawBuffers([WebGLEnum.BACK]);
      }
      if (this._options.colorAttachments) {
        for (const attachment of this._options.colorAttachments) {
          const tex = attachment.texture;
          if (attachment.level > 0) {
            const texture = this._intermediateAttachments?.get(tex)?.[attachment.level];
            if (texture) {
              const tmpFramebuffer = this._device.context.createFramebuffer();
              this._device.context.bindFramebuffer(WebGLEnum.FRAMEBUFFER, tmpFramebuffer);
              this._device.context.framebufferTexture2D(
                WebGLEnum.FRAMEBUFFER,
                WebGLEnum.COLOR_ATTACHMENT0,
                WebGLEnum.TEXTURE_2D,
                texture.texture,
                0
              );
              if (tex.isTexture2D()) {
                this._device.bindTexture(WebGLEnum.TEXTURE_2D, 0, tex as WebGLTexture2D);
                //this._device.context.bindTexture(WebGLEnum.TEXTURE_2D, tex.object);
                this._device.context.copyTexSubImage2D(
                  WebGLEnum.TEXTURE_2D,
                  attachment.level,
                  0,
                  0,
                  0,
                  0,
                  texture.width,
                  texture.height
                );
              } else if (tex.isTextureCube()) {
                this._device.bindTexture(WebGLEnum.TEXTURE_CUBE_MAP, 0, tex as WebGLTextureCube);
                //this._device.context.bindTexture(WebGLEnum.TEXTURE_CUBE_MAP, tex.object);
                this._device.context.copyTexSubImage2D(
                  cubeMapFaceMap[attachment.face ?? CubeFace.PX],
                  attachment.level,
                  0,
                  0,
                  0,
                  0,
                  texture.width,
                  texture.height
                );
              }
              this._device.context.bindFramebuffer(WebGLEnum.FRAMEBUFFER, null);
              this._device.context.deleteFramebuffer(tmpFramebuffer);
            }
          }
          if (this._needGenerateMipmaps && attachment.generateMipmaps && tex.mipLevelCount > 1) {
            tex.generateMipmaps();
          }
        }
      }
    }
  }
  private _updateMSAABuffer() {
    if (this._options.sampleCount > 1 && this._lastDrawTag !== this._drawTags) {
      const gl = this._device.context as WebGL2RenderingContext;
      gl.bindFramebuffer(WebGLEnum.READ_FRAMEBUFFER, this._framebufferAA);
      gl.bindFramebuffer(WebGLEnum.DRAW_FRAMEBUFFER, this._object);
      let depthStencilMask = 0;
      if (!this._options.ignoreDepthStencil && this._depthAttachmentTarget !== WebGLEnum.NONE) {
        depthStencilMask =
          WebGLEnum.DEPTH_BUFFER_BIT |
          (this._depthAttachmentTarget === WebGLEnum.DEPTH_STENCIL_ATTACHMENT
            ? WebGLEnum.STENCIL_BUFFER_BIT
            : 0);
      }
      for (let i = 0; i < this._drawBuffers.length; i++) {
        for (let j = 0; j < this._drawBuffers.length; j++) {
          this._drawBuffers[j] = j === i ? WebGLEnum.COLOR_ATTACHMENT0 + i : WebGLEnum.NONE;
        }
        gl.readBuffer(this._drawBuffers[i]);
        gl.drawBuffers(this._drawBuffers);
        gl.blitFramebuffer(
          0,
          0,
          this._width,
          this._height,
          0,
          0,
          this._width,
          this._height,
          WebGLEnum.COLOR_BUFFER_BIT | depthStencilMask,
          WebGLEnum.NEAREST
        );
        depthStencilMask = 0;
      }
      if (depthStencilMask !== 0) {
        gl.blitFramebuffer(
          0,
          0,
          this._width,
          this._height,
          0,
          0,
          this._width,
          this._height,
          depthStencilMask,
          WebGLEnum.NEAREST
        );
      }
      for (let i = 0; i < this._drawBuffers.length; i++) {
        this._drawBuffers[i] = WebGLEnum.COLOR_ATTACHMENT0 + i;
      }
      gl.bindFramebuffer(WebGLEnum.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(WebGLEnum.DRAW_FRAMEBUFFER, null);
      this._lastDrawTag = this._drawTags;
    }
  }
  private _load(): void {
    if (this._device.isContextLost()) {
      return;
    }
    load: {
      if (this._options.sampleCount > 1) {
        this._framebufferAA = this._device.context.createFramebuffer();
        this._colorAttachmentsAA = [];
        this._depthAttachmentAA = null;
        if (!this._bindBuffersAA()) {
          this.dispose();
          break load;
        }
      }
      this._object = this._device.context.createFramebuffer();
      this._device.context.bindFramebuffer(WebGLEnum.FRAMEBUFFER, this._object);
      if (!this._bindBuffers()) {
        this.dispose();
      }
    }
    this._lastDrawTag = -1;
    this._device.context.bindFramebuffer(WebGLEnum.FRAMEBUFFER, null);
    this._device.context._currentFramebuffer = null;
  }
  private _bindAttachment(attachment: number, info: FrameBufferTextureAttachment): boolean {
    if (info.texture) {
      let intermediateTexture: WebGLTexture = null;
      if (
        this.device.type === 'webgl' &&
        !this.device.getDeviceCaps().framebufferCaps.supportRenderMipmap &&
        info.level > 0
      ) {
        if (!this._intermediateAttachments) {
          this._intermediateAttachments = new Map();
        }
        let intermediateAttachments = this._intermediateAttachments.get(info.texture);
        if (!intermediateAttachments) {
          intermediateAttachments = [];
          this._intermediateAttachments.set(info.texture, intermediateAttachments);
        }
        if (!intermediateAttachments[info.level]) {
          let width = info.texture.width;
          let height = info.texture.height;
          let level = info.level;
          while (level-- > 0) {
            width = Math.max(width >> 1, 1);
            height = Math.max(height >> 1, 1);
          }
          const formatInfo = (
            this.device.getDeviceCaps().textureCaps as WebGLTextureCaps
          ).getTextureFormatInfo(info.texture.format);
          intermediateTexture = this._device.context.createTexture();
          this._device.context.activeTexture(WebGLEnum.TEXTURE0);
          this._device.context.bindTexture(WebGLEnum.TEXTURE_2D, intermediateTexture);
          this._device.context.texImage2D(
            WebGLEnum.TEXTURE_2D,
            0,
            formatInfo.glInternalFormat,
            width,
            height,
            0,
            formatInfo.glFormat,
            formatInfo.glType[0],
            null
          );
          intermediateAttachments[info.level] = { texture: intermediateTexture, width, height };
          this._device.bindTexture(WebGLEnum.TEXTURE_2D, 0, null);
        } else {
          intermediateTexture = intermediateAttachments[info.level].texture;
        }
      }
      if (intermediateTexture) {
        this._device.context.framebufferTexture2D(
          WebGLEnum.FRAMEBUFFER,
          attachment,
          WebGLEnum.TEXTURE_2D,
          intermediateTexture,
          0
        );
      } else {
        if (info.texture.isTexture2D()) {
          this._device.context.framebufferTexture2D(
            WebGLEnum.FRAMEBUFFER,
            attachment,
            WebGLEnum.TEXTURE_2D,
            info.texture.object,
            info.level ?? 0
          );
        } else if (info.texture.isTextureCube()) {
          this._device.context.framebufferTexture2D(
            WebGLEnum.FRAMEBUFFER,
            attachment,
            cubeMapFaceMap[info.face ?? CubeFace.PX],
            info.texture.object,
            info.level ?? 0
          );
        } else if (info.texture.isTexture2DArray() || info.texture.isTexture3D()) {
          (this._device.context as WebGL2RenderingContext).framebufferTextureLayer(
            WebGLEnum.FRAMEBUFFER,
            attachment,
            info.texture.object,
            info.level ?? 0,
            info.layer ?? 0
          );
        } else {
          return false;
        }
      }
      return true;
    }
    return false;
  }
  private _bindBuffers(): boolean {
    if (!this._object) {
      return false;
    }
    this._device.context.bindFramebuffer(WebGLEnum.FRAMEBUFFER, this._object);
    if (this._depthAttachmentTarget !== WebGLEnum.NONE) {
      if (!this._bindAttachment(this._depthAttachmentTarget, this._options.depthAttachment)) {
        return false;
      }
    }
    if (this._options.colorAttachments) {
      for (let i = 0; i < this._options.colorAttachments.length; i++) {
        const opt = this._options.colorAttachments[i];
        if (opt.texture) {
          if (!this._bindAttachment(WebGLEnum.COLOR_ATTACHMENT0 + i, opt)) {
            return false;
          }
        }
      }
    }
    if (this._status === STATUS_UNCHECKED) {
      const status = this._device.context.checkFramebufferStatus(WebGLEnum.FRAMEBUFFER);
      if (status !== WebGLEnum.FRAMEBUFFER_COMPLETE) {
        console.error(`Framebuffer not complete: ${status}`);
        this._status = STATUS_FAILED;
      } else {
        this._status = STATUS_OK;
      }
    }
    return this._status === STATUS_OK;
  }
  private _createRenderbufferAA(texture: BaseTexture): WebGLRenderbuffer {
    const renderBuffer = this._device.context.createRenderbuffer();
    const formatInfo = (this.device.getDeviceCaps().textureCaps as WebGLTextureCaps).getTextureFormatInfo(
      texture.format
    );
    this._device.context.bindRenderbuffer(WebGLEnum.RENDERBUFFER, renderBuffer);
    (this._device.context as WebGL2RenderingContext).renderbufferStorageMultisample(
      WebGLEnum.RENDERBUFFER,
      this._options.sampleCount,
      formatInfo.glInternalFormat,
      this._options.depthAttachment.texture.width,
      this._options.depthAttachment.texture.height
    );
    return renderBuffer;
  }
  private _bindBuffersAA(): boolean {
    if (!this._framebufferAA) {
      return true;
    }
    this._device.context.bindFramebuffer(WebGLEnum.FRAMEBUFFER, this._framebufferAA);
    if (this._depthAttachmentTarget !== WebGLEnum.NONE) {
      if (!this._depthAttachmentAA) {
        this._depthAttachmentAA = this._createRenderbufferAA(this._options.depthAttachment.texture);
      }
      this._device.context.framebufferRenderbuffer(
        WebGLEnum.FRAMEBUFFER,
        this._depthAttachmentTarget,
        WebGLEnum.RENDERBUFFER,
        this._depthAttachmentAA
      );
    }
    if (this._options.colorAttachments) {
      for (let i = 0; i < this._options.colorAttachments.length; i++) {
        const opt = this._options.colorAttachments[i];
        if (opt.texture) {
          if (!this._colorAttachmentsAA[i]) {
            this._colorAttachmentsAA[i] = this._createRenderbufferAA(
              this._options.colorAttachments[i].texture
            );
          }
          this._device.context.framebufferRenderbuffer(
            WebGLEnum.FRAMEBUFFER,
            WebGLEnum.COLOR_ATTACHMENT0 + i,
            WebGLEnum.RENDERBUFFER,
            this._colorAttachmentsAA[i]
          );
        }
      }
    }
    if (this._statusAA === STATUS_UNCHECKED) {
      const status = this._device.context.checkFramebufferStatus(WebGLEnum.FRAMEBUFFER);
      if (status !== WebGLEnum.FRAMEBUFFER_COMPLETE) {
        console.error(`Framebuffer not complete: ${status}`);
        this._statusAA = STATUS_FAILED;
      } else {
        this._statusAA = STATUS_OK;
      }
    }
    return this._statusAA === STATUS_OK;
  }
  private _init(): void {
    if (this._options.sampleCount !== 1 && this._options.sampleCount !== 4) {
      throw new Error(`WebGLFramebuffer(): Sample should be 1 or 4, got ${this._options.sampleCount}`);
    }
    if (
      this._options.sampleCount > 1 &&
      !this._device.getDeviceCaps().framebufferCaps.supportMultisampledFramebuffer
    ) {
      throw new Error('WebGLFramebuffer(): Multisampled frame buffer not supported');
    }
    this._load();
  }
  isFramebuffer(): this is FrameBuffer {
    return true;
  }
  getSampleCount(): number {
    return this._options.sampleCount;
  }
}
