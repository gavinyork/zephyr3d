import type { Immutable, Nullable } from '@zephyr3d/base';
import { Matrix4x4, parseColor, Vector3, Vector4 } from '@zephyr3d/base';
import { Font } from './font';
import { GlyphManager } from './glyphmanager';
import type { RenderStateSet } from '../render_states';
import type { AbstractDevice } from '../base_types';
import type { BindGroup, GPUProgram, StructuredBuffer, VertexLayout } from '../gpuobject';

const MAX_GLYPH_COUNT = 1024;

/**
 * Helper class to draw some text onto the screen
 * @public
 */
export class DrawText {
  /** @internal */
  private static readonly GLYPH_COUNT = MAX_GLYPH_COUNT;
  /** @internal */
  private static glyphManager: Nullable<GlyphManager> = null;
  /** @internal */
  private static prepared = false;
  /** @internal */
  private static textVertexBuffer: Nullable<StructuredBuffer> = null;
  /** @internal */
  private static textVertexLayout: Nullable<VertexLayout> = null;
  /** @internal */
  private static textProgram: Nullable<GPUProgram> = null;
  /** @internal */
  private static textBindGroup: Nullable<BindGroup> = null;
  /** @internal */
  private static textRenderStates: Nullable<RenderStateSet> = null;
  /** @internal */
  private static textOffset = 0;
  /** @internal */
  private static readonly textMatrix = new Matrix4x4();
  /** @internal */
  private static font: Nullable<Font> = null;
  /** @internal */
  private static vertexCache: Nullable<Float32Array<ArrayBuffer>> = null;
  /** @internal */
  private static readonly colorValue: Vector4 = new Vector4();
  /** @internal */
  private static calculateTextMatrix(
    device: AbstractDevice,
    matrix: Matrix4x4,
    viewport?: Immutable<number[]>
  ) {
    const viewportWidth = viewport ? viewport[2] : device.getViewport().width;
    const viewportHeight = viewport ? viewport[3] : device.getViewport().height;
    matrix.identity();
    const projectionMatrix = Matrix4x4.ortho(0, viewportWidth, 0, viewportHeight, 1, 100);
    const flipMatrix = Matrix4x4.translation(new Vector3(0, viewportHeight, 0)).scaleRight(
      new Vector3(1, -1, 1)
    );
    Matrix4x4.multiply(projectionMatrix, flipMatrix, matrix);
  }
  /**
   * Set the font that will be used to draw strings
   * @param device - The render device
   * @param name - The font name
   */
  static setFont(device: AbstractDevice, name: string) {
    const scale = device.getScaleY();
    this.font = Font.fetchFont(name, scale) || Font.fetchFont('12px arial', scale);
  }
  /**
   * Draw text onto the screen
   * @param device - The render device
   * @param text - The text to be drawn
   * @param color - The text color
   * @param x - X coordinate of the text
   * @param y - Y coordinate of the text
   */
  static drawText(
    device: AbstractDevice,
    text: string,
    color: string,
    x: number,
    y: number,
    viewport?: Immutable<number[]>
  ) {
    if (text.length > 0) {
      device.pushDeviceStates();
      this.prepareDrawText(device);
      this.calculateTextMatrix(device, this.textMatrix, viewport);
      const colorValue = parseColor(color);
      this.colorValue.x = colorValue.r;
      this.colorValue.y = colorValue.g;
      this.colorValue.z = colorValue.b;
      this.colorValue.w = colorValue.a;
      this.textBindGroup!.setValue('flip', device.type === 'webgpu' && device.getFramebuffer() ? 1 : 0);
      this.textBindGroup!.setValue('srgbOut', device.getFramebuffer() ? 0 : 1);
      this.textBindGroup!.setValue('textMatrix', this.textMatrix);
      this.textBindGroup!.setValue('textColor', this.colorValue);
      device.setProgram(this.textProgram!);
      device.setVertexLayout(this.textVertexLayout!);
      device.setRenderStates(this.textRenderStates!);
      device.setBindGroup(0, this.textBindGroup!);
      let drawn = 0;
      const total = text.length;
      while (drawn < total) {
        const count = Math.min(total - drawn, this.GLYPH_COUNT - this.textOffset);
        if (count > 0) {
          x = this.drawTextNoOverflow(device, text, drawn, count, x, y);
          drawn += count;
          this.textOffset += count;
        }
        if (this.GLYPH_COUNT === this.textOffset) {
          this.textOffset = 0;
          device.flush();
        }
      }
      device.popDeviceStates();
    }
  }
  /** @internal */
  private static drawTextNoOverflow(
    device: AbstractDevice,
    text: string,
    start: number,
    count: number,
    x: number,
    y: number
  ) {
    let drawn = 0;
    let atlasIndex = -1;
    let i = 0;
    const vertexCache = this.vertexCache!;
    for (; i < count; i++) {
      const glyph =
        this.glyphManager!.getGlyphInfo(text[i + start], this.font!) ||
        this.glyphManager!.getGlyphInfo('?', this.font!)!;
      if (atlasIndex >= 0 && glyph.atlasIndex !== atlasIndex) {
        this.textVertexBuffer!.bufferSubData(
          (this.textOffset + drawn) * 16 * 4,
          this.vertexCache!,
          (this.textOffset + drawn) * 16,
          (i - drawn) * 16
        );
        this.textBindGroup!.setTexture('tex', this.glyphManager!.getAtlasTexture(atlasIndex)!);
        device.draw('triangle-list', (this.textOffset + drawn) * 6, (i - drawn) * 6);
        drawn = i;
      }
      atlasIndex = glyph.atlasIndex;
      const base = (this.textOffset + i) * 16;
      vertexCache[base + 0] = x;
      vertexCache[base + 1] = y;
      vertexCache[base + 2] = glyph.uMin;
      vertexCache[base + 3] = glyph.vMin;
      vertexCache[base + 4] = x + glyph.width;
      vertexCache[base + 5] = y;
      vertexCache[base + 6] = glyph.uMax;
      vertexCache[base + 7] = glyph.vMin;
      vertexCache[base + 8] = x + glyph.width;
      vertexCache[base + 9] = y + glyph.height;
      vertexCache[base + 10] = glyph.uMax;
      vertexCache[base + 11] = glyph.vMax;
      vertexCache[base + 12] = x;
      vertexCache[base + 13] = y + glyph.height;
      vertexCache[base + 14] = glyph.uMin;
      vertexCache[base + 15] = glyph.vMax;
      x += glyph.width;
    }
    this.textVertexBuffer!.bufferSubData(
      (this.textOffset + drawn) * 16 * 4,
      vertexCache,
      (this.textOffset + drawn) * 16,
      (i - drawn) * 16
    );
    this.textBindGroup!.setTexture('tex', this.glyphManager!.getAtlasTexture(atlasIndex)!);
    device.draw('triangle-list', (this.textOffset + drawn) * 6, (i - drawn) * 6);
    return x;
  }
  /** @internal */
  private static prepareDrawText(device: AbstractDevice) {
    if (!this.prepared) {
      this.prepared = true;
      this.font = this.font || Font.fetchFont('16px arial', device.getScaleY());
      this.glyphManager = new GlyphManager(device, 1024, 1024, 1);
      this.vertexCache = new Float32Array(this.GLYPH_COUNT * 16);
      this.textVertexBuffer = device.createInterleavedVertexBuffer(
        ['position_f32x2', 'tex0_f32x2'],
        this.vertexCache,
        {
          dynamic: true
        }
      );
      const indices = new Uint16Array(this.GLYPH_COUNT * 6);
      for (let i = 0; i < this.GLYPH_COUNT; i++) {
        const base = i * 4;
        indices[i * 6 + 0] = base + 0;
        indices[i * 6 + 1] = base + 1;
        indices[i * 6 + 2] = base + 2;
        indices[i * 6 + 3] = base + 0;
        indices[i * 6 + 4] = base + 2;
        indices[i * 6 + 5] = base + 3;
      }
      const textIndexBuffer = device.createIndexBuffer(indices);
      this.textVertexLayout = device.createVertexLayout({
        vertexBuffers: [{ buffer: this.textVertexBuffer! }],
        indexBuffer: textIndexBuffer
      });
      this.textOffset = 0;
      this.textProgram = device.buildRenderProgram({
        vertex(pb) {
          this.$inputs.pos = pb.vec2().attrib('position');
          this.$inputs.uv = pb.vec2().attrib('texCoord0');
          this.$outputs.uv = pb.vec2();
          this.flip = pb.int(0).uniform(0);
          this.textMatrix = pb.mat4().uniform(0);
          pb.main(function () {
            this.$builtins.position = pb.mul(this.textMatrix, pb.vec4(this.$inputs.pos, -50, 1));
            this.$if(pb.notEqual(this.flip, 0), function () {
              this.$builtins.position.y = pb.neg(this.$builtins.position.y);
            });
            this.$outputs.uv = this.$inputs.uv;
          });
        },
        fragment(pb) {
          this.$outputs.color = pb.vec4();
          this.textColor = pb.vec4().uniform(0);
          this.tex = pb.tex2D().uniform(0);
          this.srgbOut = pb.int().uniform(0);
          pb.main(function () {
            this.alpha = pb.mul(pb.textureSample(this.tex, this.$inputs.uv).a, this.textColor.a);
            this.$if(pb.notEqual(this.srgbOut, 0), function () {
              this.$outputs.color = pb.vec4(
                pb.mul(pb.pow(this.textColor.rgb, pb.vec3(1 / 2.2)), this.alpha),
                this.alpha
              );
            }).$else(function () {
              this.$outputs.color = pb.vec4(pb.mul(this.textColor.rgb, this.alpha), this.alpha);
            });
          });
        }
      });
      this.textProgram!.name = '@DrawText';
      this.textBindGroup = device.createBindGroup(this.textProgram!.bindGroupLayouts[0]);
      this.textRenderStates = device.createRenderStateSet();
      this.textRenderStates
        .useBlendingState()
        .enable(true)
        .setBlendFuncRGB('one', 'inv-src-alpha')
        .setBlendFuncAlpha('zero', 'one');
      this.textRenderStates.useDepthState().enableTest(false).enableWrite(false);
      this.textRenderStates.useRasterizerState().setCullMode('none');
    }
  }
}
