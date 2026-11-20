import type { Clonable, Nullable } from '@zephyr3d/base';
import { DRef, Vector4 } from '@zephyr3d/base';
import type {
  BindGroup,
  PBFunctionScope,
  PBInsideFunctionScope,
  PBShaderExp,
  Texture2D
} from '@zephyr3d/device';
import { MeshMaterial } from './meshmaterial';
import { ShaderHelper } from './shader/helper';
import type { DrawContext } from '../render';
import { RENDER_PASS_TYPE_LIGHT } from '../values';

/**
 * How particle quads are turned
 * - `view`: parallel to the screen
 * - `velocity`: facing the camera, their height along the direction of motion
 * - `stretched`: like velocity, and lengthened by the speed (sparks, rain)
 * - `horizontal`: lying in the world XZ plane, facing up
 * - `vertical`: upright, turned about the world Y axis toward the camera
 * @public
 */
export type ParticleAlignment = 'view' | 'velocity' | 'stretched' | 'horizontal' | 'vertical';

/**
 * Which frame of a flipbook a particle shows
 * - `lifetime`: plays the frames over the particle's life, `cycles` times
 * - `random`: one frame picked per particle
 * @public
 */
export type ParticleFlipbookMode = 'lifetime' | 'random';

/**
 * Flipbook settings of a particle sprite material
 * @public
 */
export type ParticleFlipbook = {
  /** Columns of frames */
  tilesX: number;
  /** Rows of frames */
  tilesY: number;
  /** How frames are picked */
  mode: ParticleFlipbookMode;
  /** Times the frames play over the life, for the lifetime mode */
  cycles: number;
  /** Cross-fade between consecutive frames, for the lifetime mode */
  blend: boolean;
};

/**
 * Material of the quads of a {@link ParticleEmitter}.
 *
 * @remarks
 * Unlit. Each quad shows the texture (sRGB, alpha for coverage) times the particle's color; with
 * no texture it is a soft round dot. Blending comes from {@link MeshMaterial.blendMode} ('blend'
 * by default, 'additive' for glows); 'none' with an alpha cutoff gives cutout particles such as
 * leaves.
 *
 * The emitter supplies, per particle, the world position, size, rotation, normalized age, color
 * and velocity; the quads are built and turned in the vertex shader.
 * @public
 */
export class ParticleSpriteMaterial extends MeshMaterial implements Clonable<ParticleSpriteMaterial> {
  private static readonly FEATURE_TEXTURE = this.defineFeature();
  private static readonly FEATURE_ALPHA_FROM_RED = this.defineFeature();
  private static readonly FEATURE_ALIGNMENT = this.defineFeature();
  private static readonly FEATURE_FLIPBOOK = this.defineFeature();
  private static readonly FEATURE_FLIPBOOK_BLEND = this.defineFeature();
  private static readonly FEATURE_SOFT = this.defineFeature();
  private static readonly FEATURE_NEAR_FADE = this.defineFeature();
  private readonly _texture: DRef<Texture2D>;
  /** stretchSpeedScale, stretchLengthScale, flipbook tilesX, tilesY */
  private readonly _vertexParams: Vector4;
  /** flipbook cycles */
  private readonly _flipbookParams: Vector4;
  /** softDistance, nearFadeDistance */
  private readonly _fragmentParams: Vector4;
  private _alignment: ParticleAlignment;
  private _flipbookMode: ParticleFlipbookMode;
  private _flipbookBlend: boolean;
  constructor() {
    super();
    this.cullMode = 'none';
    this.blendMode = 'blend';
    this._texture = new DRef();
    this._vertexParams = new Vector4(0.1, 1, 1, 1);
    this._flipbookParams = new Vector4(1, 0, 0, 0);
    this._fragmentParams = new Vector4(0, 0, 0, 0);
    this._alignment = 'view';
    this._flipbookMode = 'lifetime';
    this._flipbookBlend = false;
    this.useFeature(ParticleSpriteMaterial.FEATURE_ALIGNMENT, this._alignment);
    this.updateFlipbookFeatures();
  }
  /** Creates a copy of this material */
  clone() {
    const other = new ParticleSpriteMaterial();
    other.copyFrom(this);
    return other;
  }
  /** Copies the settings of another particle sprite material */
  copyFrom(other: this) {
    super.copyFrom(other);
    this.texture = other.texture;
    this.alphaFromRed = other.alphaFromRed;
    this.alignment = other.alignment;
    this.stretchSpeedScale = other.stretchSpeedScale;
    this.stretchLengthScale = other.stretchLengthScale;
    this.flipbook = other.flipbook;
    this.softDistance = other.softDistance;
    this.nearFadeDistance = other.nearFadeDistance;
  }
  /** Per-particle data comes from the emitter's instance buffer, not material instancing */
  supportInstancing(): boolean {
    return false;
  }
  /** Color texture (sRGB), multiplied by the particle color; null for a soft round dot */
  get texture() {
    return this._texture.get();
  }
  set texture(tex: Nullable<Texture2D>) {
    if (tex !== this._texture.get()) {
      this._texture.set(tex);
      this.useFeature(ParticleSpriteMaterial.FEATURE_TEXTURE, !!tex);
      this.uniformChanged();
    }
  }
  /** Take the alpha from the red channel of the texture and use white for the color, for masks */
  get alphaFromRed() {
    return !!this.featureUsed(ParticleSpriteMaterial.FEATURE_ALPHA_FROM_RED);
  }
  set alphaFromRed(val: boolean) {
    this.useFeature(ParticleSpriteMaterial.FEATURE_ALPHA_FROM_RED, !!val);
  }
  /** How the quads are turned */
  get alignment() {
    return this._alignment;
  }
  set alignment(val: ParticleAlignment) {
    if (val !== this._alignment) {
      this._alignment = val;
      this.useFeature(ParticleSpriteMaterial.FEATURE_ALIGNMENT, val);
    }
  }
  /** Stretched quads: length added along the velocity per unit of speed */
  get stretchSpeedScale() {
    return this._vertexParams.x;
  }
  set stretchSpeedScale(val: number) {
    if (val !== this._vertexParams.x) {
      this._vertexParams.x = val;
      this.uniformChanged();
    }
  }
  /** Stretched quads: their length as a multiple of the particle size, before the speed is added */
  get stretchLengthScale() {
    return this._vertexParams.y;
  }
  set stretchLengthScale(val: number) {
    if (val !== this._vertexParams.y) {
      this._vertexParams.y = val;
      this.uniformChanged();
    }
  }
  /** Flipbook of the texture; tilesX = tilesY = 1 for none. Returns a copy. */
  get flipbook(): ParticleFlipbook {
    return {
      tilesX: this._vertexParams.z,
      tilesY: this._vertexParams.w,
      mode: this._flipbookMode,
      cycles: this._flipbookParams.x,
      blend: this._flipbookBlend
    };
  }
  set flipbook(val: Partial<ParticleFlipbook>) {
    const tilesX = Math.max(1, Math.round(val.tilesX ?? this._vertexParams.z));
    const tilesY = Math.max(1, Math.round(val.tilesY ?? this._vertexParams.w));
    const cycles = val.cycles ?? this._flipbookParams.x;
    if (
      tilesX !== this._vertexParams.z ||
      tilesY !== this._vertexParams.w ||
      cycles !== this._flipbookParams.x
    ) {
      this._vertexParams.z = tilesX;
      this._vertexParams.w = tilesY;
      this._flipbookParams.x = cycles;
      this.uniformChanged();
    }
    this._flipbookMode =
      val.mode === 'random' ? 'random' : val.mode === 'lifetime' ? 'lifetime' : this._flipbookMode;
    this._flipbookBlend = val.blend ?? this._flipbookBlend;
    this.updateFlipbookFeatures();
  }
  /**
   * Soft particles: distance in world units over which a quad fades out toward the scene behind
   * it, which hides where it cuts into the ground and walls; 0 turns it off. Reads the scene
   * depth.
   */
  get softDistance() {
    return this._fragmentParams.x;
  }
  set softDistance(val: number) {
    val = Math.max(0, val);
    if (val !== this._fragmentParams.x) {
      this._fragmentParams.x = val;
      this.useFeature(ParticleSpriteMaterial.FEATURE_SOFT, val > 0);
      this.uniformChanged();
    }
  }
  /**
   * Distance in world units from the near plane over which quads fade in, so that large ones do
   * not fill the screen when the camera passes through them; 0 turns it off
   */
  get nearFadeDistance() {
    return this._fragmentParams.y;
  }
  set nearFadeDistance(val: number) {
    val = Math.max(0, val);
    if (val !== this._fragmentParams.y) {
      this._fragmentParams.y = val;
      this.useFeature(ParticleSpriteMaterial.FEATURE_NEAR_FADE, val > 0);
      this.uniformChanged();
    }
  }
  /** {@inheritDoc Material.needSceneDepth} */
  needSceneDepth(): boolean {
    return this._fragmentParams.x > 0;
  }
  private updateFlipbookFeatures() {
    const on = this._vertexParams.z * this._vertexParams.w > 1;
    this.useFeature(ParticleSpriteMaterial.FEATURE_FLIPBOOK, on ? this._flipbookMode : '');
    this.useFeature(
      ParticleSpriteMaterial.FEATURE_FLIPBOOK_BLEND,
      on && this._flipbookMode === 'lifetime' && this._flipbookBlend
    );
  }
  private usesSoft(ctx: DrawContext) {
    return (
      this._fragmentParams.x > 0 &&
      ctx.renderPass!.type === RENDER_PASS_TYPE_LIGHT &&
      !!ctx.linearDepthTexture &&
      this.needFragmentColor(ctx)
    );
  }
  private usesNearFade(ctx: DrawContext) {
    return this._fragmentParams.y > 0 && this.needFragmentColor(ctx);
  }
  /** Texture coordinates of a flipbook frame: the corner's uv within the frame's tile */
  private flipbookUV(scope: PBInsideFunctionScope, frame: PBShaderExp, uv: PBShaderExp) {
    const pb = scope.$builder;
    const tiles = scope.zParticleVertex.zw;
    // Whole numbers held in floats; the half keeps the division from flooring to one less
    const row = pb.floor(pb.div(pb.add(frame, 0.5), tiles.x));
    const col = pb.sub(frame, pb.mul(row, tiles.x));
    return pb.div(pb.add(pb.vec2(col, row), uv), tiles);
  }
  /**
   * Builds the quad of the particle: its corners turned by the alignment and the rotation around
   * the particle's world position
   */
  vertexShader(scope: PBFunctionScope) {
    super.vertexShader(scope);
    const pb = scope.$builder;
    const alignment = this._alignment;
    // xy: corner in -0.5..0.5, zw: its texture coordinates
    scope.$inputs.zCorner = pb.vec4().attrib('position');
    // position, rotation
    scope.$inputs.zParticle0 = pb.vec4().attrib('texCoord0');
    // width, height, normalized age, random
    scope.$inputs.zParticle1 = pb.vec4().attrib('texCoord1');
    // color
    scope.$inputs.zParticle2 = pb.vec4().attrib('texCoord2');
    // velocity
    scope.$inputs.zParticle3 = pb.vec4().attrib('texCoord3');
    scope.zParticleVertex = pb.vec4().uniform(2);
    const flipbook = this.featureUsed<string>(ParticleSpriteMaterial.FEATURE_FLIPBOOK);
    if (flipbook) {
      scope.zParticleFlipbook = pb.vec4().uniform(2);
    }
    const viewMatrix = ShaderHelper.getViewMatrix(scope);
    scope.$l.camRight = pb.vec3(viewMatrix[0].x, viewMatrix[1].x, viewMatrix[2].x);
    scope.$l.camUp = pb.vec3(viewMatrix[0].y, viewMatrix[1].y, viewMatrix[2].y);
    // Toward the camera
    scope.$l.camBack = pb.vec3(viewMatrix[0].z, viewMatrix[1].z, viewMatrix[2].z);
    scope.$l.center = scope.$inputs.zParticle0.xyz;
    scope.$l.quadSize = scope.$inputs.zParticle1.xy;
    scope.$l.offset = pb.mul(scope.$inputs.zCorner.xy, scope.quadSize);
    if (alignment === 'velocity' || alignment === 'stretched') {
      scope.$l.velocity = scope.$inputs.zParticle3.xyz;
      scope.$l.speed = pb.length(scope.velocity);
      // Height along the motion, width across it as square to the view as can be; at rest or
      // moving straight along the view, the quad falls back to the screen axes
      scope.$l.axisUp = scope.$choice(
        pb.greaterThan(scope.speed, 1e-5),
        pb.div(scope.velocity, pb.max(scope.speed, 1e-5)),
        scope.camUp
      );
      scope.$l.axisRight = pb.cross(scope.axisUp, scope.camBack);
      scope.$l.rightLength = pb.length(scope.axisRight);
      scope.axisRight = scope.$choice(
        pb.greaterThan(scope.rightLength, 1e-4),
        pb.div(scope.axisRight, pb.max(scope.rightLength, 1e-4)),
        scope.camRight
      );
      scope.axisUp = scope.$choice(pb.greaterThan(scope.rightLength, 1e-4), scope.axisUp, scope.camUp);
      if (alignment === 'stretched') {
        // Head at the particle, the tail trailing behind by the speed's share of the length
        scope.$l.trail = pb.mul(scope.speed, scope.zParticleVertex.x);
        scope.$l.stretchLength = pb.add(pb.mul(scope.quadSize.y, scope.zParticleVertex.y), scope.trail);
        scope.offset = pb.vec2(
          scope.offset.x,
          pb.sub(pb.mul(scope.$inputs.zCorner.y, scope.stretchLength), pb.mul(scope.trail, 0.5))
        );
      }
    } else if (alignment === 'horizontal') {
      scope.$l.axisRight = pb.vec3(1, 0, 0);
      scope.$l.axisUp = pb.vec3(0, 0, -1);
    } else if (alignment === 'vertical') {
      scope.$l.axisUp = pb.vec3(0, 1, 0);
      scope.$l.axisRight = pb.cross(scope.axisUp, scope.camBack);
      scope.$l.rightLength = pb.length(scope.axisRight);
      // Looking straight up or down: the screen's right
      scope.axisRight = scope.$choice(
        pb.greaterThan(scope.rightLength, 1e-4),
        pb.div(scope.axisRight, pb.max(scope.rightLength, 1e-4)),
        scope.camRight
      );
    } else {
      scope.$l.axisRight = scope.camRight;
      scope.$l.axisUp = scope.camUp;
    }
    if (alignment !== 'stretched') {
      // Counterclockwise in the plane of the quad
      scope.$l.rotCos = pb.cos(scope.$inputs.zParticle0.w);
      scope.$l.rotSin = pb.sin(scope.$inputs.zParticle0.w);
      scope.offset = pb.vec2(
        pb.sub(pb.mul(scope.offset.x, scope.rotCos), pb.mul(scope.offset.y, scope.rotSin)),
        pb.add(pb.mul(scope.offset.x, scope.rotSin), pb.mul(scope.offset.y, scope.rotCos))
      );
    }
    scope.$l.quadPos = pb.add(
      scope.center,
      pb.mul(scope.axisRight, scope.offset.x),
      pb.mul(scope.axisUp, scope.offset.y)
    );
    scope.$outputs.worldPos = scope.quadPos;
    scope.$outputs.zParticleColor = scope.$inputs.zParticle2;
    scope.$outputs.zParticleCornerUV = scope.$inputs.zCorner.zw;
    if (flipbook) {
      scope.$l.numFrames = pb.mul(scope.zParticleVertex.z, scope.zParticleVertex.w);
      if (flipbook === 'random') {
        scope.$l.frame0 = pb.min(
          pb.floor(pb.mul(scope.$inputs.zParticle1.w, scope.numFrames)),
          pb.sub(scope.numFrames, 1)
        );
        scope.$outputs.zParticleUV0 = this.flipbookUV(scope, scope.frame0, scope.$inputs.zCorner.zw);
      } else {
        scope.$l.frameF = pb.mul(scope.$inputs.zParticle1.z, scope.zParticleFlipbook.x, scope.numFrames);
        scope.$l.frame0 = pb.floor(scope.frameF);
        scope.$l.frameBlend = pb.sub(scope.frameF, scope.frame0);
        scope.frame0 = pb.sub(
          scope.frame0,
          pb.mul(pb.floor(pb.div(pb.add(scope.frame0, 0.5), scope.numFrames)), scope.numFrames)
        );
        scope.$outputs.zParticleUV0 = this.flipbookUV(scope, scope.frame0, scope.$inputs.zCorner.zw);
        if (this.featureUsed(ParticleSpriteMaterial.FEATURE_FLIPBOOK_BLEND)) {
          scope.$l.frame1 = pb.add(scope.frame0, 1);
          scope.frame1 = scope.$choice(pb.lessThan(scope.frame1, scope.numFrames), scope.frame1, pb.float(0));
          scope.$outputs.zParticleUV1 = this.flipbookUV(scope, scope.frame1, scope.$inputs.zCorner.zw);
          scope.$outputs.zParticleFrameBlend = scope.frameBlend;
        }
      }
    } else {
      scope.$outputs.zParticleUV0 = scope.$inputs.zCorner.zw;
    }
    ShaderHelper.setClipSpacePosition(
      scope,
      pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.quadPos, 1))
    );
  }
  /** Texture or soft dot, times the particle color, faded by the scene depth and the near plane */
  fragmentShader(scope: PBFunctionScope) {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    const ctx = this.drawContext;
    if (!this.needFragmentColor()) {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
      return;
    }
    const soft = this.usesSoft(ctx);
    const nearFade = this.usesNearFade(ctx);
    if (soft || nearFade) {
      scope.zParticleFragment = pb.vec4().uniform(2);
    }
    if (this.texture) {
      scope.zParticleTexture = pb.tex2D().uniform(2);
      scope.$l.texel = pb.textureSample(scope.zParticleTexture, scope.$inputs.zParticleUV0);
      if (this.featureUsed(ParticleSpriteMaterial.FEATURE_FLIPBOOK_BLEND)) {
        scope.texel = pb.mix(
          scope.texel,
          pb.textureSample(scope.zParticleTexture, scope.$inputs.zParticleUV1),
          scope.$inputs.zParticleFrameBlend
        );
      }
      if (this.alphaFromRed) {
        scope.texel = pb.vec4(1, 1, 1, scope.texel.r);
      }
    } else {
      // A soft round dot
      scope.$l.dotDist = pb.length(pb.sub(pb.mul(scope.$inputs.zParticleCornerUV, 2), pb.vec2(1)));
      scope.$l.dotT = pb.clamp(pb.sub(1, scope.dotDist), 0, 1);
      scope.$l.texel = pb.vec4(1, 1, 1, pb.mul(scope.dotT, scope.dotT, pb.sub(3, pb.mul(scope.dotT, 2))));
    }
    scope.$l.color = pb.mul(scope.$inputs.zParticleColor, scope.texel);
    if (soft || nearFade) {
      scope.$l.cameraParams = ShaderHelper.getCameraParams(scope);
      // Distance along the view, in world units
      scope.$l.fragDepth = pb.mul(
        ShaderHelper.nonLinearDepthToLinearNormalized(scope, scope.$builtins.fragCoord.z),
        scope.cameraParams.y
      );
      if (soft) {
        scope.$l.screenUV = pb.div(pb.vec2(scope.$builtins.fragCoord.xy), ShaderHelper.getRenderSize(scope));
        scope.$l.sceneDepth = pb.mul(
          ShaderHelper.sampleLinearDepth(scope, ShaderHelper.getLinearDepthTexture(scope), scope.screenUV, 0),
          scope.cameraParams.y
        );
        scope.color.a = pb.mul(
          scope.color.a,
          pb.clamp(pb.div(pb.sub(scope.sceneDepth, scope.fragDepth), scope.zParticleFragment.x), 0, 1)
        );
      }
      if (nearFade) {
        scope.color.a = pb.mul(
          scope.color.a,
          pb.clamp(pb.div(pb.sub(scope.fragDepth, scope.cameraParams.x), scope.zParticleFragment.y), 0, 1)
        );
      }
    }
    this.outputFragmentColor(scope, scope.$inputs.worldPos, scope.color);
  }
  /** Sets the uniforms and texture declared for the pass */
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number) {
    super.applyUniformValues(bindGroup, ctx, pass);
    bindGroup.setValue('zParticleVertex', this._vertexParams);
    if (this.featureUsed(ParticleSpriteMaterial.FEATURE_FLIPBOOK)) {
      bindGroup.setValue('zParticleFlipbook', this._flipbookParams);
    }
    if (this.needFragmentColor(ctx)) {
      if (this.usesSoft(ctx) || this.usesNearFade(ctx)) {
        bindGroup.setValue('zParticleFragment', this._fragmentParams);
      }
      if (this.texture) {
        bindGroup.setTexture('zParticleTexture', this.texture);
      }
    }
  }
}
