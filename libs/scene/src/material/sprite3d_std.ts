import type { BindGroup, PBInsideFunctionScope, PBShaderExp, Texture2D } from '@zephyr3d/device';
import type { Clonable } from '@zephyr3d/base';
import { DRef } from '@zephyr3d/base';
import type { DrawContext } from '../render/drawable';
import { Sprite3DMaterial } from './sprite3d';
import { fetchSampler } from '../utility/misc';

/**
 * Standard Sprite3D material
 * @public
 */
export class StandardSprite3DMaterial extends Sprite3DMaterial implements Clonable<StandardSprite3DMaterial> {
  static FEATURE_SPRITE_TEXTURE = this.defineFeature();
  protected _texture: DRef<Texture2D>;
  /**
   * Creates a new instance of {@link StandardSprite3DMaterial}.
   *
   * @remarks
   * By default, no sprite texture is assigned and the material renders
   * as solid white until a texture is set.
   */
  constructor() {
    super();
    this._texture = new DRef();
  }
  /**
   * Gets the 2D texture used by this sprite material.
   *
   * @returns The current sprite texture, or `null` if no texture is assigned.
   */
  get spriteTexture(): Texture2D | null {
    return this._texture.get();
  }
  set spriteTexture(tex: Texture2D) {
    tex = tex ?? null;
    if (tex !== this._texture.get()) {
      this._texture.set(tex);
      this.useFeature(StandardSprite3DMaterial.FEATURE_SPRITE_TEXTURE, !!tex);
      this.uniformChanged();
    }
  }
  /**
   * Creates a deep copy of this material instance.
   *
   * @remarks
   * The new instance will copy all relevant state from this material,
   * including the assigned sprite texture reference.
   *
   * @returns A new {@link StandardSprite3DMaterial} instance with the same settings.
   */
  clone(): StandardSprite3DMaterial {
    const other = new StandardSprite3DMaterial();
    other.copyFrom(this);
    return other;
  }
  /**
   * Copies the state from another {@link StandardSprite3DMaterial} into this instance.
   *
   * @param other - The source material to copy from.
   */
  copyFrom(other: this): void {
    super.copyFrom(other);
    this.spriteTexture = other.spriteTexture;
  }
  /**
   * Applies runtime uniform values to the given bind group before drawing.
   *
   * @remarks
   * This method is called by the rendering pipeline to bind GPU resources
   * (such as textures and samplers) associated with this material.
   *
   * @param bindGroup - The bind group to which uniforms and resources are bound.
   * @param ctx - The current draw context providing rendering-state information.
   *
   */
  protected internalApplyUniforms(bindGroup: BindGroup, ctx: DrawContext): void {
    if (this.spriteTexture && this.needFragmentColor(ctx)) {
      bindGroup.setTexture('zSpriteTexture', this.spriteTexture, fetchSampler('clamp_linear'));
    }
  }
  /**
   * Declares and configures shader uniforms for this material in the current scope.
   *
   * @remarks
   * This is executed during shader construction. If the active shader stage
   * is a fragment shader, and the material requires fragment color and has
   * a sprite texture assigned, a 2D texture uniform named `zSpriteTexture`
   * is added to the program.
   *
   * @param scope - The current shader function scope used to build the program.
   */
  protected internalSetupUniforms(scope: PBInsideFunctionScope): void {
    const pb = scope.$builder;
    if (pb.shaderKind === 'fragment' && this.spriteTexture && this.needFragmentColor()) {
      scope.zSpriteTexture = pb.tex2D().uniform(2);
    }
  }
  /**
   * Computes the fragment color expression for this material within the shader.
   *
   * @remarks
   * - If a sprite texture is assigned, this samples the texture using
   *   the interpolated vertex UV coordinates (`zVertexUV`).
   * - If no texture is assigned, this returns a solid white color.
   *
   * @param scope - The current shader function scope providing inputs and uniforms.
   * @returns A shader expression representing the computed fragment color.
   */
  protected calcFragmentColor(scope: PBInsideFunctionScope): PBShaderExp {
    const pb = scope.$builder;
    return this.spriteTexture ? pb.textureSample(scope.zSpriteTexture, scope.$inputs.zVertexUV) : pb.vec4(1);
  }
  /**
   * Releases resources held by this material instance.
   *
   * @remarks
   * This is called when the material is disposed. It forwards the dispose
   * call to the internal texture reference so that the associated GPU
   * resource can be released.
   */
  protected onDispose(): void {
    super.onDispose();
    this._texture.dispose();
  }
}
