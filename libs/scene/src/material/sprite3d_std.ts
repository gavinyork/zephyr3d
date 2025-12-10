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
  constructor() {
    super();
    this._texture = new DRef();
  }
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
  clone(): StandardSprite3DMaterial {
    const other = new StandardSprite3DMaterial();
    other.copyFrom(this);
    return other;
  }
  copyFrom(other: this): void {
    super.copyFrom(other);
    this.spriteTexture = other.spriteTexture;
  }
  protected internalApplyUniforms(_bindGroup: BindGroup, _ctx: DrawContext, _pass: number): void {
    if (this.spriteTexture && this.needFragmentColor(_ctx)) {
      _bindGroup.setTexture('zSpriteTexture', this.spriteTexture, fetchSampler('clamp_linear'));
    }
  }
  protected internalSetupUniforms(scope: PBInsideFunctionScope): void {
    const pb = scope.$builder;
    if (pb.shaderKind === 'fragment' && this.spriteTexture && this.needFragmentColor()) {
      scope.zSpriteTexture = pb.tex2D().uniform(2);
    }
  }
  protected calcFragmentColor(scope: PBInsideFunctionScope): PBShaderExp {
    const pb = scope.$builder;
    return this.spriteTexture ? pb.textureSample(scope.zSpriteTexture, scope.$inputs.zVertexUV) : pb.vec4(1);
  }
}
