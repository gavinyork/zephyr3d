import type { CubeFace } from '@zephyr3d/base';
import { Vector4 } from '@zephyr3d/base';
import type {
  RenderStateSet,
  BaseTexture,
  BindGroup,
  FrameBuffer,
  GPUProgram,
  Texture2D,
  Texture2DArray,
  TextureCube,
  TextureSampler,
  PBGlobalScope,
  PBInsideFunctionScope,
  PBShaderExp
} from '@zephyr3d/device';
import { Application } from '../app';
import { Primitive } from '../render/primitive';
import { linearToGamma } from '../shaders';

// TODO: multi-pass support for filter

/**
 * Blit type
 * @public
 */
export type BlitType = '2d' | '2d-array' | 'cube';

type BlitProgramInfo = { program: GPUProgram; bindGroup: BindGroup };

/**
 * Base class for any kind of blitters
 * @public
 */
export abstract class Blitter {
  /** @internal */
  protected _hash: string;
  /** @internal */
  protected _renderStates: RenderStateSet;
  /** @internal */
  protected _srgbOut: boolean;
  /** @internal */
  protected _flip: boolean;
  /** @internal */
  protected _viewport: number[];
  /** @internal */
  protected _scissor: number[];
  /** @internal */
  protected _destRect: number[];
  /** @internal */
  protected _offsetParams: Vector4;
  /**
   * Creates an instance of Blitter
   */
  constructor() {
    this._hash = null;
    this._renderStates = null;
    this._srgbOut = false;
    this._flip = false;
    this._viewport = null;
    this._scissor = null;
    this._destRect = null;
    this._offsetParams = new Vector4();
  }
  /** Viewport */
  get viewport(): number[] {
    return this._viewport;
  }
  set viewport(val: number[]) {
    this._viewport = val ?? null;
  }
  /** Scissor rect */
  get scissor(): number[] {
    return this._scissor;
  }
  set scissor(val: number[]) {
    this._scissor = val ?? null;
  }
  /** Destination rectangle */
  get destRect(): number[] {
    return this._destRect;
  }
  set destRect(val: number[]) {
    if (!!this._destRect !== !!val) {
      this.invalidateHash();
    }
    this._destRect = val ?? null;
  }
  /**
   * Whether output color value in gamma color space
   */
  get srgbOut(): boolean {
    return this._srgbOut;
  }
  set srgbOut(val: boolean) {
    if (this._srgbOut !== !!val) {
      this._srgbOut = !!val;
      this.invalidateHash();
    }
  }
  /**
   * Render states used to do the blitting
   */
  get renderStates(): RenderStateSet {
    return this._renderStates;
  }
  set renderStates(rs: RenderStateSet) {
    this._renderStates = rs;
  }
  /**
   * Program hash code
   */
  get hash(): string {
    if (!this._hash) {
      this._hash = `${this.constructor.name}:${this._srgbOut ? 1 : 0}:${this._flip ? 1 : 0}:${
        this._destRect ? 1 : 0
      }:${this.calcHash()}`;
    }
    return this._hash;
  }
  /**
   * Force the hash code to be regenerated
   */
  invalidateHash(): void {
    this._hash = null;
  }
  /**
   * Reads a texel from the source texture
   * @param scope - The shader scope
   * @param type - The blit type
   * @param srcTex - The source texture
   * @param uv - The texture coordinate from where the texel will be read
   * @param srcLayer - The layer of the source texture
   * @returns The read texel
   */
  readTexel(
    scope: PBInsideFunctionScope,
    type: BlitType,
    srcTex: PBShaderExp,
    uv: PBShaderExp,
    srcLayer: PBShaderExp,
    sampleType: 'float' | 'int' | 'uint'
  ): PBShaderExp {
    const pb = scope.$builder;
    if (sampleType === 'float') {
      switch (type) {
        case '2d':
        case 'cube':
          return Application.instance.device.getDeviceCaps().shaderCaps.supportShaderTextureLod
            ? pb.textureSampleLevel(srcTex, uv, 0)
            : pb.textureSample(srcTex, uv);
        case '2d-array':
          return pb.textureArraySampleLevel(srcTex, uv, srcLayer, 0);
        default:
          return null;
      }
    } else {
      switch (type) {
        case '2d':
          return pb.textureLoad(srcTex, pb.ivec2(pb.mul(pb.vec2(pb.textureDimensions(srcTex, 0)), uv)), 0);
        case 'cube':
          throw new Error('Integer format cube texture not supported');
        case '2d-array':
          return pb.textureArrayLoad(
            srcTex,
            pb.ivec2(pb.mul(pb.vec2(pb.textureDimensions(srcTex, 0)), uv)),
            srcLayer,
            0
          );
        default:
          return null;
      }
    }
  }
  /**
   * Writes a texel to destination texture
   * @param scope - The shader scope
   * @param type - The blit type
   * @param uv - The texture coordinate to where the texel will be written
   * @param texel - The texel to be written
   * @returns The written texel
   */
  writeTexel(scope: PBInsideFunctionScope, type: BlitType, uv: PBShaderExp, texel: PBShaderExp): PBShaderExp {
    return texel;
  }
  /**
   * Initialize uniforms of the blit program
   * @param scope - The shader scope
   * @param type - The blit type
   */
  setup(scope: PBGlobalScope, type: BlitType) {}
  /**
   * Update uniforms of the bind group
   * @param bindGroup - The bind group to be updated
   */
  setUniforms(bindGroup: BindGroup, sourceTex: BaseTexture) {}
  /**
   * Calculates the destination texel by the source texel
   * @param scope - The shader scope
   * @param type - The blit type
   * @param srcTex - The source texel
   * @param srcUV - The texture coordinate of the source texel
   * @param srcLayer - The layer of the source texture
   * @returns the destination texel
   */
  abstract filter(
    scope: PBInsideFunctionScope,
    type: BlitType,
    srcTex: PBShaderExp,
    srcUV: PBShaderExp,
    srcLayer: PBShaderExp,
    sampeType: 'float' | 'int' | 'uint'
  ): PBShaderExp;
  /**
   * Calculates the hash code
   * @returns the calculated hash code
   */
  protected abstract calcHash(): string;
  /** @internal */
  protected blit2D(source: Texture2D, dest: FrameBuffer, sampler?: TextureSampler): void {
    const device = Application.instance.device;
    const flip = !dest && device.type === 'webgpu';
    const bilinearFiltering = sampler
      ? sampler.magFilter === 'linear' || sampler.minFilter === 'linear' || sampler.mipFilter === 'linear'
      : source.isFilterable();
    const programInfo = getBlitProgram(
      '2d',
      this,
      bilinearFiltering,
      source.isIntegerFormat() ? (source.isSignedFormat() ? 'int' : 'uint') : 'float',
      flip
    );
    programInfo.bindGroup.setTexture('srcTex', source, sampler);
    if (this._destRect) {
      const destWidth = this._viewport?.[2] ?? dest?.getWidth() ?? device.getBackBufferWidth();
      const destHeight = this._viewport?.[3] ?? dest?.getHeight() ?? device.getBackBufferHeight();
      this._offsetParams.setXYZW(
        this._destRect[2] / destWidth,
        this._destRect[3] / destHeight,
        (this._destRect[2] + 2 * this._destRect[0]) / destWidth - 1,
        (this._destRect[3] + 2 * this._destRect[1]) / destHeight - 1
      );
      programInfo.bindGroup.setValue('scaleBias', this._offsetParams);
    }
    this.setUniforms(programInfo.bindGroup, source);
    device.setFramebuffer(dest ?? null);
    device.setViewport(this._viewport);
    device.setScissor(this._scissor);
    device.setProgram(programInfo.program);
    device.setBindGroup(0, programInfo.bindGroup);
    device.setRenderStates(this._renderStates ?? getBlitRenderStateSet());
    getBlitPrimitive2D().draw();
  }
  /** @internal */
  protected blit2DArray(
    source: Texture2DArray,
    dest: FrameBuffer,
    layer: number,
    sampler?: TextureSampler
  ): void {
    const device = Application.instance.device;
    const flip = !dest && device.type === 'webgpu';
    const bilinearFiltering = sampler
      ? sampler.magFilter === 'linear' || sampler.minFilter === 'linear' || sampler.mipFilter === 'linear'
      : source.isFilterable();
    const programInfo = getBlitProgram(
      '2d-array',
      this,
      bilinearFiltering,
      source.isIntegerFormat() ? (source.isSignedFormat() ? 'int' : 'uint') : 'float',
      flip
    );
    programInfo.bindGroup.setTexture('srcTex', source, sampler);
    programInfo.bindGroup.setValue('srcLayer', layer);
    this.setUniforms(programInfo.bindGroup, source);
    device.setFramebuffer(dest ?? null);
    device.setViewport(this._viewport);
    device.setScissor(this._scissor);
    device.setProgram(programInfo.program);
    device.setBindGroup(0, programInfo.bindGroup);
    device.setRenderStates(this._renderStates ?? getBlitRenderStateSet());
    getBlitPrimitive2D().draw();
  }
  /** @internal */
  protected blitCubeMap(
    source: TextureCube,
    dest: FrameBuffer,
    face: CubeFace,
    sampler?: TextureSampler
  ): void {
    const device = Application.instance.device;
    const flip = !dest && device.type === 'webgpu';
    const bilinearFiltering = sampler
      ? sampler.magFilter === 'linear' || sampler.minFilter === 'linear' || sampler.mipFilter === 'linear'
      : source.isFilterable();
    const programInfo = getBlitProgram(
      'cube',
      this,
      bilinearFiltering,
      source.isIntegerFormat() ? (source.isSignedFormat() ? 'int' : 'uint') : 'float',
      flip
    );
    programInfo.bindGroup.setTexture('srcTex', source, sampler);
    programInfo.bindGroup.setValue('texelSize', 1 / source.width);
    programInfo.bindGroup.setValue('cubeFace', face);
    this.setUniforms(programInfo.bindGroup, source);
    device.setFramebuffer(dest ?? null);
    device.setViewport(this._viewport);
    device.setScissor(this._scissor);
    device.setProgram(programInfo.program);
    device.setBindGroup(0, programInfo.bindGroup);
    device.setRenderStates(this._renderStates ?? getBlitRenderStateSet());
    getBlitPrimitive2D().draw();
  }
  /**
   * Blits a 2D texture to 2D texture or frame buffer
   * @param source - The source texture
   * @param dest - The destination texture or frame buffer
   * @param sampler - Sampler for source texture
   */
  blit(source: Texture2D, dest: Texture2D | FrameBuffer, sampler?: TextureSampler): void;
  /**
   * Blits a 2D texture to given layer of a 2D array texture
   * @param source - The source texture
   * @param dest - The destination texture
   * @param layer - The layer of the destination texture
   * @param sampler - Sampler for source texture
   */
  blit(source: Texture2D, dest: Texture2DArray, layer: number, sampler?: TextureSampler): void;
  /**
   * Blits a 2d array texture to another 2d array texture
   *
   * @remarks
   * All layers of the source texture will be copied to the destination texture
   *
   * @param source - The source texture
   * @param dest - The destination texture
   * @param sampler - Sampler for source texture
   */
  blit(source: Texture2DArray, dest: Texture2DArray, sampler?: TextureSampler): void;
  /**
   * Blits given layer of a 2d array texture to a 2d texture or frame buffer
   * @param source - The source texture
   * @param dest - The destination texture or frame buffer
   * @param layer - The layer to be copied
   * @param sampler - Sampler for source texture
   */
  blit(source: Texture2DArray, dest: Texture2D | FrameBuffer, layer: number, sampler?: TextureSampler): void;
  /**
   * Blits a cube texture to another cube texture
   *
   * @remarks
   * All faces of the source texture will be copied to the destination texture
   *
   * @param source - The source texture
   * @param dest - The destination texture
   * @param sampler - Sampler for source texture
   */
  blit(source: TextureCube, dest: TextureCube, sampler?: TextureSampler): void;
  /**
   * Blits given face of a cube texture to a 2d texture or frame buffer
   * @param source - The source texture
   * @param dest - The destination texture or frame buffer
   * @param face - The face to be copied
   * @param sampler - Sampler for source texture
   */
  blit(source: TextureCube, dest: Texture2D | FrameBuffer, face: number, sampler?: TextureSampler): void;
  blit(
    source: BaseTexture,
    dest: BaseTexture | FrameBuffer,
    layer?: number | TextureSampler,
    sampler?: TextureSampler
  ): void {
    const device = Application.instance.device;
    device.pushDeviceStates();
    if (!dest) {
      if (source.isTexture2D()) {
        this.blit2D(source, null, sampler);
      } else if (source.isTexture2DArray()) {
        this.blit2DArray(source, null, (layer as number) || 0, sampler);
      } else if (source.isTextureCube()) {
        this.blitCubeMap(source, null, (layer as number) || 0, sampler);
      } else {
        throw new Error('Blitter.blit() failed: invalid texture type');
      }
    } else {
      const framebuffer = dest.isFramebuffer() ? dest : device.pool.createTemporalFramebuffer(false, [dest], null);
      const destTexture = dest.isFramebuffer() ? dest.getColorAttachments()?.[0] : dest;
      if (source.isTexture2D()) {
        if (!destTexture?.isTexture2D() && !destTexture?.isTexture2DArray()) {
          throw new Error('Blitter.blit() failed: invalid destination texture type');
        }
        if (destTexture.isTexture2DArray()) {
          framebuffer.setColorAttachmentLayer(0, (layer as number) || 0);
        }
        this.blit2D(source, framebuffer, sampler);
      } else if (source.isTexture2DArray()) {
        if (!destTexture?.isTexture2D() && !destTexture.isTexture2DArray()) {
          throw new Error('Blitter.blit() failed: invalid destination texture type');
        }
        if (destTexture.isTexture2D()) {
          this.blit2DArray(source, framebuffer, (layer as number) || 0, sampler);
        } else {
          if (destTexture.depth !== source.depth) {
            throw new Error(
              'Blitter.blit() failed: can not blit between texture 2d arrays with different array size'
            );
          } else {
            for (let i = 0; i < source.depth; i++) {
              framebuffer.setColorAttachmentLayer(0, i);
              this.blit2DArray(source, framebuffer, i, layer as TextureSampler);
            }
          }
        }
      } else if (source.isTextureCube()) {
        if (!destTexture.isTextureCube() && !destTexture.isTexture2D()) {
          throw new Error('Blitter.blit() failed: invalid destination texture type');
        }
        if (destTexture.isTextureCube()) {
          for (let i = 0; i < 6; i++) {
            framebuffer.setColorAttachmentCubeFace(0, i);
            this.blitCubeMap(source, framebuffer, i, layer as TextureSampler);
          }
        } else {
          this.blitCubeMap(source, framebuffer, (layer as number) || 0, sampler);
        }
      } else {
        throw new Error('Blitter.blit() failed: invalid texture type');
      }
      if (framebuffer && framebuffer !== dest) {
        device.pool.releaseFrameBuffer(framebuffer);
      }
    }
    device.popDeviceStates();
  }
}

const blitProgramCache: {
  [hash: string]: BlitProgramInfo;
} = {};

let blitPrimitive2D: Primitive = null;
let blitRenderStates: RenderStateSet = null;

function getBlitPrimitive2D(): Primitive {
  if (!blitPrimitive2D) {
    blitPrimitive2D = new Primitive();
    const vb = Application.instance.device.createVertexBuffer(
      'position_f32x2',
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])
    );
    blitPrimitive2D.setVertexBuffer(vb);
    blitPrimitive2D.indexCount = 4;
    blitPrimitive2D.indexStart = 0;
    blitPrimitive2D.primitiveType = 'triangle-strip';
  }
  return blitPrimitive2D;
}

function getBlitRenderStateSet(): RenderStateSet {
  if (!blitRenderStates) {
    blitRenderStates = Application.instance.device.createRenderStateSet();
    blitRenderStates.useDepthState().enableTest(false).enableWrite(false);
    blitRenderStates.useRasterizerState().setCullMode('none');
  }
  return blitRenderStates;
}

function getBlitProgram(
  type: BlitType,
  filter: Blitter,
  bilinearFiltering: boolean,
  sampleType: 'int' | 'uint' | 'float',
  flip: boolean
): BlitProgramInfo {
  const hash = `${type}:${filter.hash}:${bilinearFiltering}:${sampleType}:${flip ? 1 : 0}`;
  let programInfo = blitProgramCache[hash];
  if (programInfo === undefined) {
    programInfo =
      createBlitProgram(type, filter, bilinearFiltering, sampleType, flip, !!filter.destRect) || null;
    blitProgramCache[hash] = programInfo;
  }
  return programInfo;
}

function createBlitProgram(
  type: BlitType,
  filter: Blitter,
  bilinearFiltering: boolean,
  st: 'int' | 'uint' | 'float',
  flip: boolean,
  scaleBias: boolean
): BlitProgramInfo {
  const program = Application.instance.device.buildRenderProgram({
    vertex(pb) {
      this.$inputs.pos = pb.vec2().attrib('position');
      this.$outputs.uv = pb.vec2();
      if (scaleBias) {
        this.scaleBias = pb.vec4().uniform(0);
      }
      filter.setup(this, type);
      pb.main(function () {
        this.$builtins.position = pb.vec4(this.$inputs.pos, 1, 1);
        this.$outputs.uv =
          type === 'cube'
            ? pb.mul(pb.vec2(1, -1), this.$inputs.pos.xy)
            : pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
        if (Application.instance.device.type === 'webgpu') {
          this.$builtins.position.y = pb.neg(this.$builtins.position.y);
        }
        if (scaleBias) {
          this.$l.xy = pb.add(pb.mul(this.$builtins.position.xy, this.scaleBias.xy), this.scaleBias.zw);
          this.$builtins.position = pb.vec4(this.xy, 1, 1);
        }
      });
    },
    fragment(pb) {
      switch (type) {
        case '2d':
          if (st === 'int') {
            this.srcTex = pb.itex2D().sampleType('sint').uniform(0);
          } else if (st === 'uint') {
            this.srcTex = pb.utex2D().sampleType('uint').uniform(0);
          } else {
            this.srcTex = pb
              .tex2D()
              .sampleType(bilinearFiltering ? 'float' : 'unfilterable-float')
              .uniform(0);
          }
          break;
        case '2d-array':
          if (st === 'int') {
            this.srcTex = pb.itex2DArray().sampleType('sint').uniform(0);
          } else if (st === 'uint') {
            this.srcTex = pb.utex2DArray().sampleType('uint').uniform(0);
          } else {
            this.srcTex = pb
              .tex2DArray()
              .sampleType(bilinearFiltering ? 'float' : 'unfilterable-float')
              .uniform(0);
          }
          this.srcLayer = pb.int().uniform(0);
          break;
        case 'cube':
          if (st === 'int') {
            this.srcTex = pb.itexCube().sampleType('sint').uniform(0);
          } else if (st === 'uint') {
            this.srcTex = pb.utexCube().sampleType('uint').uniform(0);
          } else {
            this.srcTex = pb
              .texCube()
              .sampleType(bilinearFiltering ? 'float' : 'unfilterable-float')
              .uniform(0);
          }
          this.texelSize = pb.float().uniform(0);
          this.cubeFace = pb.int().uniform(0);
          break;
        default:
          throw new Error(`invalid blit type: ${type}`);
      }
      this.$outputs.outColor = pb.vec4();
      filter.setup(this, type);
      pb.main(function () {
        if (type === 'cube') {
          this.uv = pb.vec3();
          this.$if(pb.equal(this.cubeFace, 0), function () {
            this.uv = pb.vec3(1, this.$inputs.uv.y, pb.neg(this.$inputs.uv.x));
          })
            .$elseif(pb.equal(this.cubeFace, 1), function () {
              this.uv = pb.vec3(-1, this.$inputs.uv.y, this.$inputs.uv.x);
            })
            .$elseif(pb.equal(this.cubeFace, 2), function () {
              this.uv = pb.vec3(this.$inputs.uv.x, 1, pb.neg(this.$inputs.uv.y));
            })
            .$elseif(pb.equal(this.cubeFace, 3), function () {
              this.uv = pb.vec3(this.$inputs.uv.x, -1, this.$inputs.uv.y);
            })
            .$elseif(pb.equal(this.cubeFace, 4), function () {
              this.uv = pb.vec3(this.$inputs.uv.x, this.$inputs.uv.y, 1);
            })
            .$else(function () {
              this.uv = pb.vec3(pb.neg(this.$inputs.uv.x), this.$inputs.uv.y, -1);
            });
        } else {
          this.uv = this.$inputs.uv;
        }
        if (flip) {
          this.uv.y = pb.sub(1, this.uv.y);
        }
        this.$l.outTexel = filter.filter(
          this,
          type,
          this.srcTex,
          this.uv,
          type === '2d' ? null : this.srcLayer,
          st
        );
        this.$outputs.outColor = filter.writeTexel(this, type, this.$inputs.uv, this.outTexel);
        if (filter.srgbOut) {
          this.$outputs.outColor = pb.vec4(
            linearToGamma(this, this.$outputs.outColor.rgb),
            this.$outputs.outColor.a
          );
        }
      });
    }
  });
  return program
    ? {
        program,
        bindGroup: Application.instance.device.createBindGroup(program.bindGroupLayouts[0])
      }
    : null;
}
