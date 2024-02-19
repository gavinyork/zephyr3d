import type {
  BindGroup,
  GPUProgram,
  PBFunctionScope,
  PBInsideFunctionScope,
  PBShaderExp
} from '@zephyr3d/device';
import { ProgramBuilder } from '@zephyr3d/device';
import { RENDER_PASS_TYPE_DEPTH_ONLY, RENDER_PASS_TYPE_FORWARD, RENDER_PASS_TYPE_SHADOWMAP } from '../values';
import { Material } from './material';
import type { DrawContext, ShadowMapPass } from '../render';
import {
  ShaderFramework,
  encodeColorOutput,
  encodeNormalizedFloatToRGBA,
  nonLinearDepthToLinearNormalized
} from '../shaders';
import { Application } from '../app';

export type BlendMode = 'none' | 'blend' | 'additive' | 'max' | 'min';

export type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void
  ? I
  : never;

export type ExtractMixinReturnType<M> = M extends (target: infer A) => infer R ? R : never;

export type ExtractMixinType<M> = M extends [infer First]
  ? ExtractMixinReturnType<First>
  : M extends [infer First, ...infer Rest]
  ? ExtractMixinReturnType<First> & ExtractMixinType<[...Rest]>
  : never;

export function applyMaterialMixins<M extends ((target: any) => any)[], T>(
  target: T,
  ...mixins: M
): ExtractMixinType<M> {
  let r: any = target;
  for (const m of mixins) {
    r = m(r);
  }
  return r;
}

export class MeshMaterial extends Material {
  static readonly FEATURE_ALPHATEST = 0;
  static readonly FEATURE_ALPHABLEND = 1;
  static readonly FEATURE_ALPHATOCOVERAGE = 2;
  static readonly NEXT_FEATURE_INDEX: number = 3;
  private _featureStates: unknown[];
  private _alphaCutoff: number;
  private _blendMode: BlendMode;
  private _opacity: number;
  private _ctx: DrawContext;
  private _materialPass: number;
  constructor(...args: any[]) {
    super();
    this._featureStates = [];
    this._alphaCutoff = 0;
    this._blendMode = 'none';
    this._opacity = 1;
    this._ctx = null;
    this._materialPass = -1;
  }
  /** Draw context for shader creation */
  get drawContext(): DrawContext {
    return this._ctx;
  }
  /** Current material pass */
  get pass(): number {
    return this._materialPass;
  }
  /** A value between 0 and 1, presents the cutoff for alpha testing */
  get alphaCutoff(): number {
    return this._alphaCutoff;
  }
  set alphaCutoff(val: number) {
    if (this._alphaCutoff !== val) {
      this.useFeature(MeshMaterial.FEATURE_ALPHATEST, val > 0);
      this._alphaCutoff = val;
      this.optionChanged(false);
    }
  }
  get alphaToCoverage(): boolean {
    return this.featureUsed(MeshMaterial.FEATURE_ALPHATOCOVERAGE);
  }
  set alphaToCoverage(val: boolean) {
    this.useFeature(MeshMaterial.FEATURE_ALPHATOCOVERAGE, !!val);
  }
  /** Blending mode */
  get blendMode(): BlendMode {
    return this._blendMode;
  }
  set blendMode(val: BlendMode) {
    if (this._blendMode !== val) {
      this._blendMode = val;
      this.useFeature(MeshMaterial.FEATURE_ALPHABLEND, this._blendMode !== 'none' || this._opacity < 1);
    }
  }
  /** A value between 0 and 1, presents the opacity */
  get opacity(): number {
    return this._opacity;
  }
  set opacity(val: number) {
    val = val < 0 ? 0 : val > 1 ? 1 : val;
    if (this._opacity !== val) {
      this._opacity = val;
      this.useFeature(MeshMaterial.FEATURE_ALPHABLEND, this._blendMode !== 'none' || this._opacity < 1);
      this.optionChanged(false);
    }
  }
  /** @internal */
  private updateBlendingState(ctx: DrawContext) {
    const blending = this.featureUsed<boolean>(MeshMaterial.FEATURE_ALPHABLEND);
    const a2c = this.featureUsed<boolean>(MeshMaterial.FEATURE_ALPHATOCOVERAGE);
    if (blending || a2c) {
      const blendingState = this.stateSet.useBlendingState();
      if (blending) {
        blendingState.enable(true);
        if (this._blendMode === 'additive') {
          blendingState.setBlendEquation('add', 'add');
          blendingState.setBlendFunc('one', 'one');
        } else if (this._blendMode === 'max') {
          blendingState.setBlendEquation('max', 'add');
          blendingState.setBlendFuncRGB('one', 'one');
          blendingState.setBlendFuncAlpha('zero', 'one');
        } else if (this._blendMode === 'min') {
          blendingState.setBlendEquation('min', 'add');
          blendingState.setBlendFuncRGB('one', 'one');
          blendingState.setBlendFuncAlpha('zero', 'one');
        } else {
          blendingState.setBlendEquation('add', 'add');
          blendingState.setBlendFunc('one', 'inv-src-alpha');
        }
      } else {
        blendingState.enable(false);
      }
      blendingState.enableAlphaToCoverage(a2c);
    } else if (this.stateSet.blendingState?.enabled && !blending) {
      this.stateSet.defaultBlendingState();
    }
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext): void {
    if (this.featureUsed(MeshMaterial.FEATURE_ALPHATEST)) {
      bindGroup.setValue('kkAlphaCutoff', this._alphaCutoff);
    }
    if (this.featureUsed(MeshMaterial.FEATURE_ALPHABLEND)) {
      bindGroup.setValue('kkOpacity', this._opacity);
    }
  }
  /** true if the material is transparency */
  isTransparent(): boolean {
    return this.featureUsed(MeshMaterial.FEATURE_ALPHABLEND);
  }
  beginDraw(ctx: DrawContext, pass: number): boolean {
    this.updateBlendingState(ctx);
    return super.beginDraw(ctx, pass);
  }
  /** @internal */
  protected createProgram(ctx: DrawContext, pass: number): GPUProgram {
    const pb = new ProgramBuilder(Application.instance.device);
    if (ctx.renderPass.type === RENDER_PASS_TYPE_SHADOWMAP) {
      const shadowMapParams = ctx.shadowMapInfo.get((ctx.renderPass as ShadowMapPass).light);
      pb.emulateDepthClamp = !!shadowMapParams.depthClampEnabled;
    }
    return this._createProgram(pb, ctx, pass);
  }
  /**
   * Check if a feature is in use for given render pass type.
   *
   * @param feature - The feature index
   * @returns true if the feature is in use, otherwise false.
   */
  featureUsed<T = unknown>(feature: number): T {
    return this._featureStates[feature] as T;
  }
  /**
   * Use or unuse a feature of the material, this will cause the shader to be rebuild.
   *
   * @param feature - Which feature will be used or unused
   * @param use - true if use the feature, otherwise false
   */
  useFeature(feature: number, use: unknown) {
    if (this._featureStates[feature] !== use) {
      this._featureStates[feature] = use;
      this.optionChanged(true);
    }
  }
  /**
   * {@inheritDoc Material._createHash}
   * @override
   */
  protected _createHash(renderPassType: number): string {
    return this._featureStates.map((val) => (val === undefined ? '' : val)).join('|');
  }
  /**
   * {@inheritDoc Material._applyUniforms}
   * @override
   */
  protected _applyUniforms(bindGroup: BindGroup, ctx: DrawContext): void {
    this.applyUniformValues(bindGroup, ctx);
  }
  /**
   * Check if the color should be computed in fragment shader, this is required for forward render pass or alpha test is in use or alpha to coverage is in use.
   *
   * @returns - true if the color should be computed in fragment shader, otherwise false.
   */
  needFragmentColor(ctx?: DrawContext): boolean {
    return (
      (ctx ?? this.drawContext).renderPass.type === RENDER_PASS_TYPE_FORWARD ||
      this._alphaCutoff > 0 ||
      this.alphaToCoverage
    );
  }
  /**
   * Transform vertex position to the clip space and calcuate the world position, world normal and tangent frame if needed
   *
   * @remarks
   * This function handles skin animation and geometry instancing if needed
   *
   * @param scope - Current shader scope
   */
  transformVertexAndNormal(scope: PBInsideFunctionScope) {
    const pb = scope.$builder;
    const funcName = 'kkTransformVertexAndNormal';
    const that = this;
    pb.func(funcName, [], function () {
      const viewProjMatrix = that.getViewProjectionMatrix(this);
      this.$l.worldMatrix = that.getWorldMatrix(this);
      this.$l.normalMatrix = that.getNormalMatrix(this);
      if (that.hasSkinning(this)) {
        this.$l.skinMatrix = that.calculateSkinMatrix(this);
      }
      const oPos = that.calculateObjectSpacePosition(
        this,
        this.$getVertexAttrib('position'),
        that.hasSkinning(this) ? this.skinMatrix : null
      );
      if (!oPos) {
        throw new Error(
          `MeshMaterial.transformVertexAndNormal(): calculateObjectSpacePosition() returns null`
        );
      }
      this.$l.oPos = oPos;
      this.$outputs.worldPosition = pb
        .mul(this.worldMatrix, pb.vec4(this.$l.oPos, 1))
        .tag(ShaderFramework.USAGE_WORLD_POSITION);
      that.setClipSpacePosition(this, pb.mul(viewProjMatrix, this.$outputs.worldPosition));

      const oNorm = that.calculateObjectSpaceNormal(
        this,
        this.$getVertexAttrib('normal'),
        that.hasSkinning(this) ? this.skinMatrix : null
      );
      if (oNorm) {
        this.$l.oNorm = oNorm;
        this.$outputs.worldNormal = pb
          .normalize(pb.mul(this.normalMatrix, pb.vec4(this.$l.oNorm, 0)).xyz)
          .tag(ShaderFramework.USAGE_WORLD_NORMAL);

        const oTangent = that.calculateObjectSpaceTangent(
          this,
          this.$getVertexAttrib('tangent'),
          that.hasSkinning(this) ? this.skinMatrix : null
        );
        if (oTangent) {
          this.$l.oTangent = oTangent;
          this.$outputs.worldTangent = pb
            .normalize(pb.mul(this.normalMatrix, pb.vec4(this.$l.oTangent.xyz, 0)).xyz)
            .tag(ShaderFramework.USAGE_WORLD_TANGENT);
          this.$outputs.worldBinormal = pb
            .normalize(
              pb.mul(pb.cross(this.$outputs.worldNormal, this.$outputs.worldTangent), this.$l.oTangent.w)
            )
            .tag(ShaderFramework.USAGE_WORLD_BINORMAL);
        }
      }
    });
    pb.getGlobalScope()[funcName]();
  }
  /**
   * Gets the uniform variable of type mat4 which transforms vertex position from object space to world space
   *
   * @remarks
   * This function must be called in vertex stage
   *
   * @param scope - Current shader scope
   *
   * @returns The world matrix
   */
  getWorldMatrix(scope: PBInsideFunctionScope) {
    if (scope.$builder.shaderKind !== 'vertex') {
      throw new Error(`MeshMaterial.getWorldMatrix(): must be called in vertex stage`);
    }
    return scope.$query(ShaderFramework.USAGE_WORLD_MATRIX);
  }
  /**
   * Gets the uniform variable of type mat4 which transforms vertex normal from object space to world space
   *
   * @remarks
   * This function must be called in vertex stage
   *
   * @param scope - Current shader scope
   *
   * @returns The normal matrix
   */
  getNormalMatrix(scope: PBInsideFunctionScope) {
    // TODO: should use inverse-transpose of the world matrix
    return this.getWorldMatrix(scope);
  }
  /**
   * Gets the uniform variable of type mat4 which holds the view-projection matrix of current camera
   *
   * @remarks
   * This function can be called in vertex stage and fragment stage
   *
   * @param scope - Current shader scope
   *
   * @returns The view-projection matrix variable
   */
  getViewProjectionMatrix(scope: PBInsideFunctionScope) {
    return ShaderFramework.getViewProjectionMatrix(scope);
  }
  /**
   * Gets the uniform variable of type mat4 which holds the view matrix of current camera
   *
   * @remarks
   * View matrix will transform points from world space to camera space
   * This function can be called in vertex stage and fragment stage
   *
   * @param scope - Current shader scope
   *
   * @returns The view matrix uniform variable
   */
  getViewMatrix(scope: PBInsideFunctionScope) {
    return ShaderFramework.getViewMatrix(scope);
  }
  /**
   * Gets the uniform variable of type mat4 which holds the rotation matrix of current camera
   *
   * @remarks
   * This function can be called in vertex stage and fragment stage
   *
   * @param scope - Current shader scope
   *
   * @returns The rotation matrix uniform variable
   */
  getRotationMatrix(scope: PBInsideFunctionScope) {
    return ShaderFramework.getCameraRotationMatrix(scope);
  }
  /**
   * Gets the uniform variable of type mat4 which holds the projection matrix of current camera
   *
   * @remarks
   * This function can be called in vertex stage and fragment stage
   *
   * @param scope - Current shader scope
   *
   * @returns The projection matrix uniform variable
   */
  getProjectionMatrix(scope: PBInsideFunctionScope) {
    return ShaderFramework.getProjectionMatrix(scope);
  }
  /**
   * Gets the uniform variable of type vec3 which holds the camera position
   *
   * @remarks
   * This function can be called in vertex stage and fragment stage
   *
   * @param scope - Current shader scope
   *
   * @returns The camera position uniform variable
   */
  getCameraPosition(scope: PBInsideFunctionScope): PBShaderExp {
    return ShaderFramework.getCameraPosition(scope);
  }
  /**
   * This function checks if the shader needs to process skeletal animation.
   *
   * @param scope - Current shader scope
   *
   * @returns true if the shader needs to process skeletal animation, otherwise false.
   */
  hasSkinning(scope: PBInsideFunctionScope): boolean {
    return !!scope.$query(ShaderFramework.USAGE_BONE_MATRICIES);
  }
  /**
   * Calculate skinning matrix for current vertex
   *
   * @param scope - Current shader scope
   *
   * @returns Skinning matrix for current vertex, or null if there is not skeletal animation
   */
  calculateSkinMatrix(scope: PBInsideFunctionScope): PBShaderExp {
    if (!this.hasSkinning(scope)) {
      return null;
    }
    const pb = scope.$builder;
    const funcNameGetBoneMatrixFromTexture = 'kkGetBoneMatrixFromTexture';
    pb.func(funcNameGetBoneMatrixFromTexture, [pb.int('boneIndex')], function () {
      const boneTexture = this.$query(ShaderFramework.USAGE_BONE_MATRICIES);
      this.$l.w = pb.float(this.$query(ShaderFramework.USAGE_BONE_TEXTURE_SIZE));
      this.$l.pixelIndex = pb.float(pb.mul(this.boneIndex, 4));
      this.$l.xIndex = pb.mod(this.pixelIndex, this.w);
      this.$l.yIndex = pb.floor(pb.div(this.pixelIndex, this.w));
      this.$l.u1 = pb.div(pb.add(this.xIndex, 0.5), this.w);
      this.$l.u2 = pb.div(pb.add(this.xIndex, 1.5), this.w);
      this.$l.u3 = pb.div(pb.add(this.xIndex, 2.5), this.w);
      this.$l.u4 = pb.div(pb.add(this.xIndex, 3.5), this.w);
      this.$l.v = pb.div(pb.add(this.yIndex, 0.5), this.w);
      if (Application.instance.device.type !== 'webgl') {
        this.$l.row1 = pb.textureSampleLevel(boneTexture, pb.vec2(this.u1, this.v), 0);
        this.$l.row2 = pb.textureSampleLevel(boneTexture, pb.vec2(this.u2, this.v), 0);
        this.$l.row3 = pb.textureSampleLevel(boneTexture, pb.vec2(this.u3, this.v), 0);
        this.$l.row4 = pb.textureSampleLevel(boneTexture, pb.vec2(this.u4, this.v), 0);
      } else {
        this.$l.row1 = pb.textureSample(boneTexture, pb.vec2(this.u1, this.v));
        this.$l.row2 = pb.textureSample(boneTexture, pb.vec2(this.u2, this.v));
        this.$l.row3 = pb.textureSample(boneTexture, pb.vec2(this.u3, this.v));
        this.$l.row4 = pb.textureSample(boneTexture, pb.vec2(this.u4, this.v));
      }
      this.$return(pb.mat4(this.row1, this.row2, this.row3, this.row4));
    });
    const funcNameGetSkinningMatrix = 'kkGetSkinningMatrix';
    pb.func(funcNameGetSkinningMatrix, [], function () {
      const invBindMatrix = this.$query(ShaderFramework.USAGE_INV_BIND_MATRIX);
      const blendIndices = scope.$getVertexAttrib('blendIndices');
      const blendWeights = scope.$getVertexAttrib('blendWeights');
      this.$l.m0 = scope.$g[funcNameGetBoneMatrixFromTexture](pb.int(blendIndices[0]));
      this.$l.m1 = scope.$g[funcNameGetBoneMatrixFromTexture](pb.int(blendIndices[1]));
      this.$l.m2 = scope.$g[funcNameGetBoneMatrixFromTexture](pb.int(blendIndices[2]));
      this.$l.m3 = scope.$g[funcNameGetBoneMatrixFromTexture](pb.int(blendIndices[3]));
      this.$l.m = pb.add(
        pb.mul(this.m0, blendWeights.x),
        pb.mul(this.m1, blendWeights.y),
        pb.mul(this.m2, blendWeights.z),
        pb.mul(this.m3, blendWeights.w)
      );
      this.$return(pb.mul(invBindMatrix, this.m));
    });
    return scope.$g[funcNameGetSkinningMatrix]();
  }
  /**
   * Calculates the vertex position of type vec3 in object space
   *
   * @param scope - Current shader scope
   * @param pos - Vertex position input, must be type of vec3, null if no vertex position input
   * @param skinMatrix - The skinning matrix if there is skeletal animation, otherwise null
   * @returns The calculated vertex position in object space, or null if pos is null
   */
  calculateObjectSpacePosition(
    scope: PBInsideFunctionScope,
    pos: PBShaderExp,
    skinMatrix: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    if (pb.shaderKind !== 'vertex') {
      throw new Error(`MeshMaterial.calculateObjectSpacePosition(): must be called in vertex stage`);
    }
    return pos ? (skinMatrix ? pb.mul(skinMatrix, pb.vec4(pos, 1)).xyz : pos) : null;
  }
  /**
   * Calculates the normal vector of type vec3 in object space
   *
   * @param scope - Current shader scope
   * @param normal - Vertex normal input, must be type of vec3, null if no vertex normal input
   * @param skinMatrix - The skinning matrix if there is skeletal animation, otherwise null
   * @returns The calculated normal vector in object space, or null if normal is null
   */
  calculateObjectSpaceNormal(
    scope: PBInsideFunctionScope,
    normal: PBShaderExp,
    skinMatrix: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    if (pb.shaderKind !== 'vertex') {
      throw new Error(`MeshMaterial.calculateObjectSpaceNormal(): must be called in vertex stage`);
    }
    return normal ? (skinMatrix ? pb.mul(skinMatrix, pb.vec4(normal, 0)).xyz : normal) : null;
  }
  /**
   * Calculates the tangent vector of type vec3 in object space
   *
   * @param scope - Current shader scope
   * @param tangent - Vertex tangent input, must be type of vec4, null if no vertex tangent input
   * @param skinMatrix - The skinning matrix if there is skeletal animation, otherwise null
   * @returns The calculated tangent vector of type vec4 in object space, or null if tangent is null
   */
  calculateObjectSpaceTangent(
    scope: PBInsideFunctionScope,
    tangent: PBShaderExp,
    skinMatrix: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    if (pb.shaderKind !== 'vertex') {
      throw new Error(`MeshMaterial.calculateObjectSpaceTangent(): must be called in vertex stage`);
    }
    return tangent
      ? skinMatrix
        ? pb.vec4(pb.mul(skinMatrix, pb.vec4(tangent.xyz, 0)).xyz, tangent.w)
        : tangent
      : null;
  }
  /**
   * Sets the clip space position in vertex shader
   *
   * @remarks
   * Use this function instead of using
   * <pre>
   * // Do not use this
   * this.$builtins.position = some_value;
   * // Use this
   * ShaderFramework.setClipSpacePosition(some_value);
   * </pre>,
   *
   * @param scope - Current shader scope
   * @param pos - The clip space position to be set
   */
  setClipSpacePosition(scope: PBInsideFunctionScope, pos: PBShaderExp): void {
    const pb = scope.$builder;
    const cameraParams = ShaderFramework.getCameraParams(scope);
    if (cameraParams) {
      scope.$builtins.position = pb.mul(pos, pb.vec4(1, cameraParams.z, 1, 1));
    } else {
      scope.$builtins.position = pos;
    }
  }
  /**
   * Vertex shader implementation of this material
   * @param scope - Shader scope
   */
  vertexShader(scope: PBFunctionScope): void {
    const pb = scope.$builder;
    ShaderFramework.prepareVertexShader(pb, this.drawContext);
    if (this.drawContext.target.getBoneMatrices()) {
      scope.$inputs.kkBlendIndices = pb.vec4().attrib('blendIndices');
      scope.$inputs.kkBlendWeights = pb.vec4().attrib('blendWeights');
    }
  }
  /**
   * Fragment shader implementation of this material
   * @param scope - Shader scope
   */
  fragmentShader(scope: PBFunctionScope): void {
    const pb = scope.$builder;
    ShaderFramework.prepareFragmentShader(pb, this.drawContext);
    if (this._alphaCutoff > 0) {
      scope.kkAlphaCutoff = pb.float().uniform(2);
    }
    if (this.drawContext.renderPass.type === RENDER_PASS_TYPE_FORWARD) {
      if (this.isTransparent()) {
        scope.kkOpacity = pb.float().uniform(2);
      }
    }
  }
  /**
   * {@inheritDoc Material._createProgram}
   * @override
   */
  protected _createProgram(pb: ProgramBuilder, ctx: DrawContext, pass: number): GPUProgram {
    const that = this;
    this._ctx = ctx;
    this._materialPass = pass;
    const program = pb.buildRenderProgram({
      vertex(pb) {
        pb.main(function () {
          that.vertexShader(this);
        });
      },
      fragment(pb) {
        this.$outputs.zFragmentOutput = pb.vec4();
        pb.main(function () {
          that.fragmentShader(this);
        });
      }
    });
    return program;
  }
  /**
   * Calculate final fragment color for output.
   *
   * @param scope - Shader scope
   * @param color - Lit fragment color
   *
   * @returns The final fragment color
   */
  outputFragmentColor(scope: PBInsideFunctionScope, color: PBShaderExp) {
    const pb = scope.$builder;
    const that = this;
    pb.func('zOutputFragmentColor', color ? [pb.vec4('color')] : [], function () {
      this.$l.outColor = color ? this.color : pb.vec4();
      if (that.drawContext.renderPass.type === RENDER_PASS_TYPE_FORWARD) {
        ShaderFramework.discardIfClipped(this);
        if (!that.isTransparent() && !this.kkAlphaCutoff && !that.alphaToCoverage) {
          this.outColor.a = 1;
        } else if (this.kkOpacity) {
          this.outColor.a = pb.mul(this.outColor.a, this.kkOpacity);
        }
        if (this.kkAlphaCutoff) {
          this.$if(pb.lessThan(this.outColor.a, this.kkAlphaCutoff), function () {
            pb.discard();
          });
        }
        if (that.isTransparent()) {
          this.outColor = pb.vec4(pb.mul(this.outColor.rgb, this.outColor.a), this.outColor.a);
        }
        ShaderFramework.applyFog(this, this.outColor, that.drawContext);
        this.$outputs.zFragmentOutput = encodeColorOutput(this, this.outColor);
      } else if (that.drawContext.renderPass.type === RENDER_PASS_TYPE_DEPTH_ONLY) {
        if (color) {
          this.$if(pb.lessThan(this.outColor.a, this.kkAlphaCutoff), function () {
            pb.discard();
          });
        }
        ShaderFramework.discardIfClipped(this);
        this.$l.kkDepth = nonLinearDepthToLinearNormalized(this, this.$builtins.fragCoord.z);
        if (Application.instance.device.type === 'webgl') {
          this.$outputs.zFragmentOutput = encodeNormalizedFloatToRGBA(this, this.kkDepth);
        } else {
          this.$outputs.zFragmentOutput = pb.vec4(this.kkDepth, 0, 0, 1);
        }
      } /*if (that.drawContext.renderPass.type === RENDER_PASS_TYPE_SHADOWMAP)*/ else {
        if (color) {
          this.$if(pb.lessThan(this.outColor.a, this.kkAlphaCutoff), function () {
            pb.discard();
          });
        }
        ShaderFramework.discardIfClipped(this);
        const shadowMapParams = that.drawContext.shadowMapInfo.get(
          (that.drawContext.renderPass as ShadowMapPass).light
        );
        this.$outputs.zFragmentOutput = shadowMapParams.impl.computeShadowMapDepth(shadowMapParams, this);
      }
    });
    color ? pb.getGlobalScope().zOutputFragmentColor(color) : pb.getGlobalScope().zOutputFragmentColor();
  }
}
