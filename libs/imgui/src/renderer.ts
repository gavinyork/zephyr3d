import type { ColorRGBA } from '@zephyr3d/base';
import { ASSERT, Matrix4x4, Vector3, Vector4 } from '@zephyr3d/base';
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

export class Renderer {
  /** @internal */
  private static readonly VERTEX_BUFFER_SIZE = 65536;
  /** @internal */
  private static readonly INDEX_BUFFER_SIZE = 65536 * 3;
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
  private readonly _program: GPUProgram;
  /** @internal */
  private readonly _textureSampler: TextureSampler;
  /** @internal */
  private readonly _programTexture: GPUProgram;
  /** @internal */
  private readonly _bindGroup: BindGroup;
  /** @internal */
  private readonly _bindGroupTexture: BindGroup;
  /** @internal */
  private readonly _renderStateSet: RenderStateSet;
  /** @internal */
  private _vertexCache: Uint8Array;
  /** @internal */
  private readonly _indexCache: Uint16Array;
  /** @internal */
  private readonly _projectionMatrix: Matrix4x4;
  /** @internal */
  private _flipMatrix: Matrix4x4;
  /** @internal */
  private _clearBeforeRender: boolean;
  /**
   * Creates a renderer instance
   * @param device - The render device
   */
  constructor(device: AbstractDevice) {
    this._device = device;
    this._projectionMatrix = new Matrix4x4();
    this._flipMatrix = new Matrix4x4();
    this._program = this.createProgram(false);
    this._programTexture = this.createProgram(true);
    this._bindGroup = this._device.createBindGroup(this._program.bindGroupLayouts[0]);
    this._bindGroupTexture = this._device.createBindGroup(this._programTexture.bindGroupLayouts[0]);
    this._textureSampler = this._device.createSampler({
      magFilter: 'nearest',
      minFilter: 'nearest',
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
            )
          }
        ],
        indexBuffer: this._device.createIndexBuffer(this._indexCache, { dynamic: true })
      };
      this._primitiveBuffer.push(this._device.createVertexLayout(opt));
    }
    this._drawPosition = 0;
    this._indexPosition = 0;
    this._clearBeforeRender = false;
  }
  /** Gets the render device */
  get device() {
    return this._device;
  }
  get clearBeforeRender(): boolean {
    return this._clearBeforeRender;
  }
  set clearBeforeRender(val: boolean) {
    this._clearBeforeRender = val;
  }
  /** Disposes this renderer */
  dispose() {
    this._primitiveBuffer = null;
    this._vertexCache = null;
    this._device = null;
  }
  /** @internal */
  getCanvas(): HTMLCanvasElement {
    return this._device.canvas;
  }
  /** @internal */
  getDrawingBufferWidth(): number {
    return this._device.deviceToScreen(this._device.getDrawingBufferWidth());
  }
  /** @internal */
  getDrawingBufferHeight(): number {
    return this._device.deviceToScreen(this._device.getDrawingBufferHeight());
  }
  /** @internal */
  screenToDevice(val: number): number {
    return this._device.screenToDevice(val);
  }
  /** @internal */
  deviceToScreen(val: number): number {
    return this._device.deviceToScreen(val);
  }
  /** @internal */
  createTexture(width: number, height: number, color: ColorRGBA, linear: boolean): Texture2D {
    const tex = this._device.createTexture2D(linear ? 'rgba8unorm' : 'rgba8unorm-srgb', width, height, {
      samplerOptions: { mipFilter: 'none' }
    });
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
  updateTextureWithImage(texture: Texture2D, bitmap: ImageData, x: number, y: number): void {
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
  ): void {
    texture.updateFromElement(ctx.canvas, x, y, cvsOffsetX, cvsOffsetY, w, h);
  }
  /** @internal */
  getTextureWidth(texture: Texture2D): number {
    return texture.width;
  }
  /** @internal */
  getTextureHeight(texture: Texture2D): number {
    return texture.height;
  }
  /** @internal */
  disposeTexture(texture: Texture2D): void {
    texture?.dispose();
  }
  /** @internal */
  setCursorStyle(style: string): void {
    this.getCanvas().style.cursor = style;
  }
  /** @internal */
  getCursorStyle(): string {
    return this.getCanvas().style.cursor;
  }
  /** @internal */
  stream(
    vertexData: Uint8Array,
    indexData: Uint16Array,
    indexOffset: number,
    indexCount: number,
    texture: Texture2D,
    scissor: number[]
  ) {
    let tex = texture || null;
    if (tex?.disposed) {
      tex = null;
    }
    const vertexCount = vertexData.length / 20;
    const overflow =
      this._drawPosition + vertexCount > Renderer.VERTEX_BUFFER_SIZE ||
      this._indexPosition + indexCount > Renderer.INDEX_BUFFER_SIZE;
    if (overflow) {
      this._drawPosition = 0;
      this._indexPosition = 0;
      this._activeBuffer = 1 - this._activeBuffer;
    }

    const vertexLayout = this._primitiveBuffer[this._activeBuffer];
    const alignedIndexCount = (indexCount + 1) & ~1;
    if (indexData.length < indexOffset + alignedIndexCount) {
      const alignedIndexData = new Uint16Array(alignedIndexCount);
      alignedIndexData.set(indexData.subarray(indexOffset));
      indexData = alignedIndexData;
      indexOffset = 0;
    }
    const vertexBuffer = vertexLayout.getVertexBuffer('position');
    vertexBuffer.bufferSubData(this._drawPosition * 20, vertexData, 0, vertexCount * 20);
    vertexLayout
      .getIndexBuffer()
      .bufferSubData(this._indexPosition * 2, indexData, indexOffset, alignedIndexCount);
    vertexLayout.setDrawOffset(vertexBuffer, this._drawPosition * 20);
    if (texture) {
      this._device.setProgram(this._programTexture);
      this._bindGroupTexture.setTexture('tex', texture, this._textureSampler);
      this._device.setBindGroup(0, this._bindGroupTexture);
    } else {
      this._device.setProgram(this._program);
      this._device.setBindGroup(0, this._bindGroup);
    }
    this._device.setRenderStates(this._renderStateSet);
    this._device.setVertexLayout(vertexLayout);
    this._device.setScissor(scissor);
    vertexLayout.draw('triangle-list', this._indexPosition, indexCount);

    this._drawPosition += vertexCount;
    this._indexPosition += alignedIndexCount;
  }
  /** @internal */
  beginRender() {
    const vp = this._device.getViewport();
    //this._device.setViewport();
    //this._device.setScissor();
    this._projectionMatrix.ortho(0, vp.width, 0, vp.height, -1, 1);
    this._flipMatrix = Matrix4x4.translation(new Vector3(0, vp.height, 0)).scaleRight(new Vector3(1, -1, 1));
    const mvpMatrix = Matrix4x4.multiply(this._projectionMatrix, this._flipMatrix);
    this._bindGroup.setValue('mvpMatrix', mvpMatrix);
    this._bindGroupTexture.setValue('mvpMatrix', mvpMatrix);
    if (this._clearBeforeRender) {
      this._device.clearFrameBuffer(new Vector4(0, 0, 0, 1), 1, 0);
    }
  }
  /** @internal */
  endRender() {}
  /** @internal */
  private createStateSet(): RenderStateSet {
    const rs = this._device.createRenderStateSet();
    rs.useBlendingState().enable(true).setBlendFunc('one', 'inv-src-alpha');
    rs.useDepthState().enableTest(false).enableWrite(false);
    rs.useRasterizerState().setCullMode('none');
    return rs;
  }
  /** @internal */
  private createProgram(diffuseMap: boolean): GPUProgram {
    return this._device.buildRenderProgram({
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
        pb.main(function () {
          this.$builtins.position = pb.mul(this.mvpMatrix, pb.vec4(this.$inputs.pos, 0, 1));
          this.$outputs.outDiffuse = this.$inputs.diffuse;
          if (diffuseMap) {
            this.$outputs.outUV = this.$inputs.uv;
          }
        });
      },
      fragment(pb) {
        this.$outputs.outColor = pb.vec4();
        if (diffuseMap) {
          this.tex = pb.tex2D().uniform(0);
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
    });
  }
}
