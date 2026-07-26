import type { ColorRGBA, Nullable } from '@zephyr3d/base';
import { Vector2 } from '@zephyr3d/base';
import { ASSERT, Disposable, Matrix4x4, Vector3, Vector4 } from '@zephyr3d/base';
import {
  type BindGroup,
  type RenderStateSet,
  type AbstractDevice,
  type Texture2D,
  type GPUProgram,
  type TextureSampler,
  type VertexLayout,
  type VertexLayoutOptions
} from '@zephyr3d/device';

type PendingDrawCommand = {
  texture: Nullable<Texture2D>;
  scissor: [number, number, number, number];
  vertexByteOffset: number;
  indexOffset: number;
  indexCount: number;
};

export class Renderer extends Disposable {
  /** @internal */
  private static readonly VERTEX_BUFFER_SIZE = 65536;
  /** @internal */
  private static readonly INDEX_BUFFER_SIZE = 65536 * 3;
  /** @internal */
  private static readonly VERTEX_STRIDE = 20;
  /** @internal */
  private _device: AbstractDevice;
  /** @internal */
  private _primitiveBuffer: VertexLayout[];
  /** @internal */
  private _activeBuffer: number;
  /** @internal */
  private _drawPosition: number;
  /** @internal */
  private _indexPosition: number;
  /** @internal */
  private _mvpMatrix: Matrix4x4;
  /** @internal */
  private _deviceSize: Vector2;
  /** @internal */
  private _viewSize: Vector2;
  /** @internal */
  private readonly _program: GPUProgram;
  /** @internal */
  private readonly _textureSampler: TextureSampler;
  /** @internal */
  private readonly _programTexture: GPUProgram;
  /** @internal */
  private readonly _bindGroup: BindGroup;
  /** @internal */
  private _bindGroupTextures: WeakMap<Texture2D, [BindGroup, number]>;
  /** @internal */
  private readonly _renderStateSet: RenderStateSet;
  /** @internal */
  private _tag: number;
  /** @internal */
  private _vertexCache: Uint8Array<ArrayBuffer>;
  /** @internal */
  private readonly _indexCache: Uint16Array<ArrayBuffer>;
  /** @internal */
  private readonly _projectionMatrix: Matrix4x4;
  /** @internal */
  private _flipMatrix: Matrix4x4;
  /** @internal */
  private _clearBeforeRender: boolean;
  /** @internal */
  private _pendingDrawCommands: PendingDrawCommand[];
  /**
   * Creates a renderer instance
   * @param device - The render device
   */
  constructor(device: AbstractDevice) {
    super();
    this._device = device;
    this._projectionMatrix = new Matrix4x4();
    this._flipMatrix = new Matrix4x4();
    this._mvpMatrix = new Matrix4x4();
    this._deviceSize = new Vector2(-1, -1);
    this._viewSize = new Vector2(-1, -1);
    this._program = this.createProgram(false);
    this._programTexture = this.createProgram(true);
    this._tag = 0;
    this._bindGroup = this._device.createBindGroup(this._program.bindGroupLayouts[0]);
    this._bindGroupTextures = new WeakMap();
    this._textureSampler = this._device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipFilter: 'none'
    });
    this._renderStateSet = this.createStateSet();
    this._primitiveBuffer = [];
    this._activeBuffer = 0;
    this._vertexCache = new Uint8Array(Renderer.VERTEX_BUFFER_SIZE * 20);
    this._indexCache = new Uint16Array(Renderer.INDEX_BUFFER_SIZE);
    for (let i = 0; i < 2; i++) {
      const opt: VertexLayoutOptions = {
        vertexBuffers: [
          {
            buffer: this._device.createInterleavedVertexBuffer(
              ['position_f32x2', 'tex0_f32x2', 'diffuse_u8normx4'],
              this._vertexCache,
              { dynamic: true }
            )!
          }
        ],
        indexBuffer: this._device.createIndexBuffer(this._indexCache, { dynamic: true })
      };
      this._primitiveBuffer.push(this._device.createVertexLayout(opt));
    }
    this._drawPosition = 0;
    this._indexPosition = 0;
    this._clearBeforeRender = false;
    this._pendingDrawCommands = [];
  }
  /** Gets the render device */
  get device() {
    return this._device;
  }
  get clearBeforeRender() {
    return this._clearBeforeRender;
  }
  set clearBeforeRender(val) {
    this._clearBeforeRender = val;
  }
  /** @internal */
  getCanvas() {
    return this._device.canvas;
  }
  /** @internal */
  createTexture(width: number, height: number, color: ColorRGBA, linear: boolean) {
    const tex = this._device.createTexture2D(linear ? 'rgba8unorm' : 'rgba8unorm-srgb', width, height, {
      mipmapping: false
    })!;
    if (color) {
      this.clearTexture(tex, color);
    }
    return tex;
  }
  /** @internal */
  clearTexture(tex: Texture2D, color: ColorRGBA) {
    const pixels = new Uint8Array(tex.width * tex.height * 4);
    const r = Math.round(color.r * 255);
    const g = Math.round(color.g * 255);
    const b = Math.round(color.b * 255);
    const a = Math.round(color.a * 255);
    for (let i = 0; i < tex.width * tex.height; i++) {
      pixels[i * 4 + 0] = r;
      pixels[i * 4 + 1] = g;
      pixels[i * 4 + 2] = b;
      pixels[i * 4 + 3] = a;
    }
    tex.update(pixels, 0, 0, tex.width, tex.height);
  }
  /** @internal */
  updateTextureWithImage(texture: Texture2D, bitmap: ImageData, x: number, y: number) {
    const originValues = new Uint8Array(bitmap.data.buffer);
    ASSERT(texture.format === 'rgba8unorm');
    texture.update(originValues, x, y, bitmap.width, bitmap.height);
  }
  /** @internal */
  updateTextureWithCanvas(
    texture: Texture2D,
    ctx: CanvasRenderingContext2D,
    cvsOffsetX: number,
    cvsOffsetY: number,
    w: number,
    h: number,
    x: number,
    y: number
  ) {
    texture.updateFromElement(ctx.canvas, x, y, cvsOffsetX, cvsOffsetY, w, h);
  }
  /** @internal */
  getTextureWidth(texture: Texture2D) {
    return texture.width;
  }
  /** @internal */
  getTextureHeight(texture: Texture2D) {
    return texture.height;
  }
  /** @internal */
  disposeTexture(texture: Texture2D) {
    texture?.dispose();
  }
  /** @internal */
  setCursorStyle(style: string) {
    this.getCanvas().style.cursor = style;
  }
  /** @internal */
  getCursorStyle() {
    return this.getCanvas().style.cursor;
  }
  /** @internal */
  stream(
    vertexData: Uint8Array<ArrayBuffer>,
    indexData: Uint16Array<ArrayBuffer>,
    vertexOffset: number,
    indexOffset: number,
    indexCount: number,
    texture: Nullable<Texture2D>,
    scissor: number[]
  ) {
    let tex = texture || null;
    if (tex?.disposed) {
      tex = null;
    }
    let minIndex = Number.POSITIVE_INFINITY;
    let maxIndex = -1;
    for (let i = 0; i < indexCount; i++) {
      const index = vertexOffset + indexData[indexOffset + i];
      if (index < minIndex) {
        minIndex = index;
      }
      if (index > maxIndex) {
        maxIndex = index;
      }
    }
    const vertexStart = Number.isFinite(minIndex) ? minIndex : vertexOffset;
    const vertexEnd = maxIndex >= vertexStart ? maxIndex + 1 : vertexStart;
    const vertexCount = Math.max(0, vertexEnd - vertexStart);
    const sourceVertexByteOffset = vertexStart * Renderer.VERTEX_STRIDE;
    const vertexByteCount = vertexCount * Renderer.VERTEX_STRIDE;
    const alignedIndexCount = (indexCount + 1) & ~1;
    const overflow =
      this._drawPosition + vertexCount > Renderer.VERTEX_BUFFER_SIZE ||
      this._indexPosition + alignedIndexCount > Renderer.INDEX_BUFFER_SIZE;
    if (overflow) {
      this.flush();
      this._activeBuffer = 1 - this._activeBuffer;
    }

    const targetVertexByteOffset = this._drawPosition * Renderer.VERTEX_STRIDE;
    if (vertexByteCount > 0) {
      this._vertexCache.set(
        vertexData.subarray(sourceVertexByteOffset, sourceVertexByteOffset + vertexByteCount),
        targetVertexByteOffset
      );
    }
    for (let i = 0; i < indexCount; i++) {
      this._indexCache[this._indexPosition + i] = vertexOffset + indexData[indexOffset + i] - vertexStart;
    }
    if (alignedIndexCount > indexCount) {
      this._indexCache[this._indexPosition + indexCount] = 0;
    }
    this._pendingDrawCommands.push({
      texture: tex,
      scissor: [scissor[0], scissor[1], scissor[2], scissor[3]],
      vertexByteOffset: targetVertexByteOffset,
      indexOffset: this._indexPosition,
      indexCount
    });

    this._drawPosition += vertexCount;
    this._indexPosition += alignedIndexCount;
  }
  /** @internal */
  flush() {
    if (this._pendingDrawCommands.length === 0) {
      this._drawPosition = 0;
      this._indexPosition = 0;
      return;
    }
    const vertexLayout = this._primitiveBuffer[this._activeBuffer];
    const vertexBuffer = vertexLayout.getVertexBuffer('position')!;
    const indexBuffer = vertexLayout.getIndexBuffer()!;
    const vertexByteCount = this._drawPosition * Renderer.VERTEX_STRIDE;
    if (vertexByteCount > 0) {
      vertexBuffer.bufferSubData(0, this._vertexCache, 0, vertexByteCount);
    }
    if (this._indexPosition > 0) {
      indexBuffer.bufferSubData(0, this._indexCache, 0, this._indexPosition);
    }
    this._device.setRenderStates(this._renderStateSet);
    this._device.setVertexLayout(vertexLayout);
    let lastTexture: Nullable<Texture2D> | undefined = undefined;
    let lastScissor: [number, number, number, number] | null = null;
    for (const drawCommand of this._pendingDrawCommands) {
      if (drawCommand.texture !== lastTexture) {
        if (drawCommand.texture) {
          let info = this._bindGroupTextures.get(drawCommand.texture);
          if (!info) {
            info = [this._device.createBindGroup(this._programTexture.bindGroupLayouts[0]), -1];
            info[0].setTexture('tex', drawCommand.texture, this._textureSampler);
            this._bindGroupTextures.set(drawCommand.texture, info);
          }
          if (info[1] !== this._tag) {
            info[0].setValue('mvpMatrix', this._mvpMatrix);
            info[0].setValue('deviceSize', this._deviceSize);
            info[1] = this._tag;
          }
          this._device.setProgram(this._programTexture);
          this._device.setBindGroup(0, info[0]);
        } else {
          this._device.setProgram(this._program);
          this._device.setBindGroup(0, this._bindGroup);
        }
        lastTexture = drawCommand.texture;
      }
      if (
        !lastScissor ||
        lastScissor[0] !== drawCommand.scissor[0] ||
        lastScissor[1] !== drawCommand.scissor[1] ||
        lastScissor[2] !== drawCommand.scissor[2] ||
        lastScissor[3] !== drawCommand.scissor[3]
      ) {
        this._device.setScissor(drawCommand.scissor);
        lastScissor = drawCommand.scissor;
      }
      vertexLayout.setDrawOffset(vertexBuffer, drawCommand.vertexByteOffset);
      vertexLayout.draw('triangle-list', drawCommand.indexOffset, drawCommand.indexCount);
    }
    this._pendingDrawCommands.length = 0;
    this._drawPosition = 0;
    this._indexPosition = 0;
  }
  /** @internal */
  beginRender() {
    ASSERT(this._pendingDrawCommands.length === 0);
    const width = this._device.getDrawingBufferWidth();
    const height = this._device.getDrawingBufferHeight();
    const scaleX = this._device.getScaleX();
    const scaleY = this._device.getScaleY();
    if (
      width !== this._viewSize.x ||
      height !== this._viewSize.y ||
      scaleX !== this._deviceSize.x ||
      scaleY !== this._deviceSize.y
    ) {
      this._projectionMatrix.ortho(0, width, 0, height, -1, 1);
      this._flipMatrix = Matrix4x4.translation(new Vector3(0, height, 0)).scaleRight(new Vector3(1, -1, 1));
      Matrix4x4.multiply(this._projectionMatrix, this._flipMatrix, this._mvpMatrix);
      this._viewSize.setXY(width, height);
      this._deviceSize.setXY(scaleX, scaleY);
      this._bindGroup.setValue('mvpMatrix', this._mvpMatrix);
      this._bindGroup.setValue('deviceSize', this._deviceSize);
      this._tag++;
    }
    //this._device.setViewport();
    //this._device.setScissor();
    //this._bindGroupTexture.setValue('mvpMatrix', this._mvpMatrix);
    //this._bindGroupTexture.setValue('deviceSize', this._deviceSize);
    if (this._clearBeforeRender) {
      this._device.clearFrameBuffer(new Vector4(0, 0, 0, 1), 1, 0);
    }
  }
  /** @internal */
  endRender() {
    this.flush();
  }
  /** Disposes this renderer */
  protected onDispose() {
    super.onDispose();
    this._bindGroup?.dispose();
    this._bindGroupTextures = new WeakMap();
    this._primitiveBuffer?.forEach((vertexLayout) => vertexLayout.dispose());
    this._program?.dispose();
    this._programTexture?.dispose();
    this._textureSampler?.dispose();
  }
  /** @internal */
  private createStateSet() {
    const rs = this._device.createRenderStateSet();
    rs.useBlendingState().enable(true).setBlendFunc('one', 'inv-src-alpha');
    rs.useDepthState().enableTest(false).enableWrite(false);
    rs.useRasterizerState().setCullMode('none');
    return rs;
  }
  /** @internal */
  private createProgram(diffuseMap: boolean) {
    const program = this._device.buildRenderProgram({
      label: 'UI',
      vertex(pb) {
        this.$inputs.pos = pb.vec2().attrib('position');
        this.$inputs.uv = pb.vec2().attrib('texCoord0');
        this.$inputs.diffuse = pb.vec4().attrib('diffuse');
        this.$outputs.outDiffuse = pb.vec4();
        if (diffuseMap) {
          this.$outputs.outUV = pb.vec2();
        }
        this.mvpMatrix = pb.mat4().uniform(0);
        this.deviceSize = pb.vec2().uniform(0);
        pb.main(function () {
          this.$l.$builtins.position = pb.mul(
            this.mvpMatrix,
            pb.vec4(pb.mul(this.$inputs.pos, this.deviceSize), 0, 1)
          );
          this.$outputs.outDiffuse = this.$inputs.diffuse;
          if (diffuseMap) {
            this.$outputs.outUV = this.$inputs.uv;
          }
        });
      },
      fragment(pb) {
        this.$outputs.outColor = pb.vec4();
        if (diffuseMap) {
          this.tex = pb.tex2D().uniform(0).withSampler({
            minFilter: 'linear',
            magFilter: 'linear',
            mipFilter: 'none',
            addressU: 'clamp',
            addressV: 'clamp'
          });
        }
        pb.main(function () {
          if (diffuseMap) {
            this.$l.color = pb.mul(pb.textureSample(this.tex, this.$inputs.outUV), this.$inputs.outDiffuse);
          } else {
            this.$l.color = this.$inputs.outDiffuse;
          }
          this.$outputs.outColor = pb.vec4(pb.mul(this.color.rgb, this.color.a), this.color.a);
        });
      }
    })!;
    program.name = diffuseMap ? '@UI_withDiffuse' : '@UI_noDiffuse';
    return program;
  }
}
