import { MeshMaterial } from './meshmaterial';
import type { BindGroup, PBFunctionScope, PBInsideFunctionScope } from '@zephyr3d/device';
import { ShaderHelper } from './shader/helper';
import { MaterialVaryingFlags } from '../values';
import type { Clonable, Immutable, Vector2 } from '@zephyr3d/base';
import { Vector4 } from '@zephyr3d/base';
import type { DrawContext } from '../render';

/**
 * Sprite material base class.
 *
 * @remarks
 * This material renders a camera-facing quad (billboard) in 3D space,
 * using UV information and an anchor point to control how the sprite
 * is positioned and textured.
 *
 * Derived classes can override {@link internalSetupUniforms},
 * {@link internalApplyUniforms} and
 * {@link calcFragmentColor} to provide custom
 * uniforms and shading logic (e.g. sampling a texture).
 *
 * @public
 */
export class SpriteMaterial extends MeshMaterial implements Clonable<SpriteMaterial> {
  static UVINFO = this.defineInstanceUniform('uvinfo', 'vec4');
  static ANCHOR_ROTATION = this.defineInstanceUniform('anchorRotation', 'vec4');
  private _uvinfo: Vector4;
  private _anchorRotation: Vector4;
  /**
   * Creates a new {@link SpriteMaterial} instance.
   *
   * @remarks
   * - Default UV rectangle is the full texture [0, 0, 1, 1].
   * - Default anchor is the center [0.5, 0.5].
   * - Face culling is disabled (`cullMode = 'none'`) so the sprite
   *   is visible from both sides.
   */
  constructor() {
    super();
    this._uvinfo = new Vector4(0, 0, 1, 1);
    this._anchorRotation = new Vector4(0.5, 0.5, 0, 0);
    this.cullMode = 'none';
  }
  /**
   * Gets the UV rectangle of the sprite in the texture.
   *
   * @returns A Vector4 storing \([u0, v0, u1, v1]\).
   */
  get uvinfo(): Immutable<Vector4> {
    return this._uvinfo;
  }
  set uvinfo(value: Immutable<Vector4>) {
    if (!value.equalsTo(this.uvinfo)) {
      this._uvinfo.set(value);
      this.uniformChanged();
    }
  }
  /**
   * Convenience method to set the UV rectangle via individual components.
   *
   * @param uvx0 - Left (U) coordinate.
   * @param uvy0 - Bottom (V) coordinate.
   * @param uvx1 - Right (U) coordinate.
   * @param uvy1 - Top (V) coordinate.
   */
  setUVInfo(uvx0: number, uvy0: number, uvx1: number, uvy1: number) {
    this.uvinfo = new Vector4(uvx0, uvy0, uvx1, uvy1);
  }
  /**
   * Gets the sprite anchor-rotation.
   *
   * @returns The current anchor-rotation.
   */
  get anchorRotation(): Immutable<Vector4> {
    return this._anchorRotation;
  }
  set anchorRotation(value: Immutable<Vector4>) {
    if (!value.equalsTo(this._anchorRotation)) {
      this._anchorRotation.set(value);
      this.uniformChanged();
    }
  }
  /**
   * Gets the sprite anchor point in normalized quad space.
   *
   * @returns The current anchor as a Vector2.
   */
  get anchor(): Immutable<Vector2> {
    return this._anchorRotation.xy();
  }
  set anchor(value: Immutable<Vector2>) {
    if (value.x !== this._anchorRotation.x || value.y !== this._anchorRotation.y) {
      this.anchorRotation = new Vector4(value.x, value.y, this._anchorRotation.z, this._anchorRotation.w);
    }
  }
  /**
   * Gets the sprite rotation around the Z axis.
   *
   * @returns The sprite rotation.
   */
  get rotation() {
    return this._anchorRotation.z;
  }
  set rotation(value) {
    if (value !== this._anchorRotation.z) {
      this.anchorRotation = new Vector4(
        this._anchorRotation.x,
        this._anchorRotation.y,
        value,
        this._anchorRotation.w
      );
    }
  }
  /**
   * Gets the X component of the sprite anchor.
   */
  get anchorX() {
    return this._anchorRotation.x;
  }
  set anchorX(value) {
    if (this._anchorRotation.x !== value) {
      this.anchorRotation = new Vector4(
        value,
        this._anchorRotation.y,
        this._anchorRotation.z,
        this._anchorRotation.w
      );
    }
  }
  /**
   * Gets the Y component of the sprite anchor.
   */
  get anchorY() {
    return this._anchorRotation.y;
  }
  set anchorY(value) {
    if (this._anchorRotation.y !== value) {
      this.anchorRotation = new Vector4(
        this._anchorRotation.x,
        value,
        this._anchorRotation.z,
        this._anchorRotation.w
      );
    }
  }
  /**
   * Convenience method to set both anchor components at once.
   *
   * @param anchorX - X coordinate of the anchor.
   * @param anchorY - Y coordinate of the anchor.
   */
  setAnchor(anchorX: number, anchorY: number) {
    if (this._anchorRotation.x !== anchorX || this._anchorRotation.y !== anchorY) {
      this.anchorRotation = new Vector4(anchorX, anchorY, this._anchorRotation.z, this._anchorRotation.w);
    }
  }
  /**
   * Creates a deep copy of this material.
   *
   * @returns A new {@link SpriteMaterial} instance with the same properties.
   */
  clone() {
    const other = new SpriteMaterial();
    other.copyFrom(this);
    return other;
  }
  /**
   * Copies all relevant state from another {@link SpriteMaterial}.
   *
   * @param other - The source material to copy from.
   */
  copyFrom(other: this) {
    super.copyFrom(other);
    this.uvinfo = other.uvinfo;
    this.anchorRotation = other.anchorRotation;
  }
  /**
   * Builds the vertex shader for this material.
   *
   * @remarks
   * This method:
   * - Calls the base implementation.
   * - Computes per-vertex positions for a camera-facing quad (billboard)
   *   based on the sprite's world transform, size, and anchor.
   * - Selects the correct UV coordinates for each quad corner using
   *   the `vertexId` attribute.
   * - Outputs world-space position (`zWorldPos`) and UVs (`zVertexUV`)
   *   for use in the fragment shader.
   *
   * @param scope - The current programmable builder function scope.
   */
  vertexShader(scope: PBFunctionScope) {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.$inputs.vertexId = pb.float().attrib('position');
    if (this.drawContext.materialFlags & MaterialVaryingFlags.INSTANCING) {
      scope.$l.uvinfo = this.getInstancedUniform(scope, SpriteMaterial.UVINFO);
      scope.$l.anchorRotation = this.getInstancedUniform(scope, SpriteMaterial.ANCHOR_ROTATION);
    } else {
      scope.uvinfo = pb.vec4().uniform(2);
      scope.anchorRotation = pb.vec4().uniform(2);
    }
    this.internalSetupUniforms(scope);
    scope.$l.worldPos = ShaderHelper.getWorldMatrix(scope)[3].xyz;
    scope.$l.width = pb.sqrt(
      pb.dot(ShaderHelper.getWorldMatrix(scope)[0].xyz, ShaderHelper.getWorldMatrix(scope)[0].xyz)
    );
    scope.$l.height = pb.sqrt(
      pb.dot(ShaderHelper.getWorldMatrix(scope)[1].xyz, ShaderHelper.getWorldMatrix(scope)[1].xyz)
    );
    const viewMatrix = ShaderHelper.getViewMatrix(scope);
    scope.$l.forward = pb.vec3(viewMatrix[0].z, viewMatrix[1].z, viewMatrix[2].z);
    scope.$l.axis = scope.$choice(
      pb.lessThan(pb.abs(scope.forward.y), 0.999),
      pb.vec3(0, 1, 0),
      pb.vec3(1, 0, 0)
    );
    scope.$l.right = pb.normalize(pb.cross(scope.axis, scope.forward));
    scope.$l.up = pb.normalize(pb.cross(scope.forward, scope.right));
    scope.$l.rotateAngle = scope.anchorRotation.z;
    scope.$l.c = pb.cos(scope.rotateAngle);
    scope.$l.s = pb.sin(scope.rotateAngle);
    scope.$l.rightRot = pb.add(pb.mul(scope.up, scope.s), pb.mul(scope.right, scope.c));
    scope.$l.upRot = pb.sub(pb.mul(scope.up, scope.c), pb.mul(scope.right, scope.s));
    scope.$l.v = pb.vec2();
    scope.$l.uv = pb.vec2();
    scope.$l.anchor = scope.anchorRotation.xy;
    scope
      .$if(pb.equal(scope.$inputs.vertexId, 0), function () {
        scope.v = pb.neg(scope.anchor);
        scope.uv = pb.vec2(scope.uvinfo.x, pb.sub(1, scope.uvinfo.y));
      })
      .$elseif(pb.equal(scope.$inputs.vertexId, 1), function () {
        scope.v = pb.sub(pb.vec2(1, 0), scope.anchor);
        scope.uv = pb.vec2(scope.uvinfo.z, pb.sub(1, scope.uvinfo.y));
      })
      .$elseif(pb.equal(scope.$inputs.vertexId, 2), function () {
        scope.v = pb.sub(pb.vec2(0, 1), scope.anchor);
        scope.uv = pb.vec2(scope.uvinfo.x, pb.sub(1, scope.uvinfo.w));
      })
      .$else(function () {
        scope.v = pb.sub(pb.vec2(1), scope.anchor);
        scope.uv = pb.vec2(scope.uvinfo.z, pb.sub(1, scope.uvinfo.w));
      });
    scope.v = pb.mul(scope.v, pb.vec2(scope.width, scope.height));
    scope.$outputs.zWorldPos = pb.add(
      scope.worldPos,
      pb.mul(scope.rightRot, scope.v.x),
      pb.mul(scope.upRot, scope.v.y)
    );
    scope.$outputs.zVertexUV = scope.uv;
    ShaderHelper.setClipSpacePosition(
      scope,
      pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.zWorldPos, 1))
    );
  }
  /**
   * Builds the fragment shader for this material.
   *
   * @remarks
   * This method:
   * - Calls the base implementation.
   * - Invokes {@link SpriteMaterial.internalSetupUniforms} for
   *   fragment-stage specific uniform declarations.
   * - Computes fragment color by calling {@link SpriteMaterial.calcFragmentColor}
   *   if fragment color is needed.
   * - Outputs the final fragment color via {@link MeshMaterial.outputFragmentColor}.
   *
   * @param scope - The current programmable builder function scope.
   */
  fragmentShader(scope: PBFunctionScope) {
    super.fragmentShader(scope);
    this.internalSetupUniforms(scope);
    if (this.needFragmentColor()) {
      scope.$l.color = this.calcFragmentColor(scope);
      this.outputFragmentColor(scope, scope.$inputs.zWorldPos, scope.color);
    } else {
      this.outputFragmentColor(scope, scope.$inputs.zWorldPos, null);
    }
  }
  /**
   * Applies runtime uniform values to the given bind group before drawing.
   *
   * @remarks
   * This binds:
   * - UV information (`uvinfo`)
   * - Anchor (`anchor`)
   *
   * for non-instanced rendering. For instanced rendering, these values
   * are expected to be provided as per-instance uniforms instead.
   *
   * It also calls {@link SpriteMaterial.internalApplyUniforms} to allow
   * derived classes to bind additional resources (e.g. textures).
   *
   * @param bindGroup - The bind group to which uniforms and resources are bound.
   * @param ctx - The current draw context providing rendering state.
   * @param pass - Index of the active render pass.
   */
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number) {
    super.applyUniformValues(bindGroup, ctx, pass);
    if (!(ctx.materialFlags & MaterialVaryingFlags.INSTANCING)) {
      bindGroup.setValue('uvinfo', this._uvinfo);
      bindGroup.setValue('anchorRotation', this._anchorRotation);
    }
    this.internalApplyUniforms(bindGroup, ctx, pass);
  }
  /**
   * Hook for derived classes to declare additional uniforms.
   *
   * @remarks
   * This is invoked in both the vertex and fragment shader construction
   * phases, allowing subclasses to register extra uniforms or resources
   * needed by their custom shading logic.
   *
   * The base implementation does nothing.
   *
   * @param _scope - The current shader function scope.
   */
  protected internalSetupUniforms(_scope: PBInsideFunctionScope) {}
  /**
   * Hook for derived classes to bind additional uniform values or resources.
   *
   * @remarks
   * This is called from {@link SpriteMaterial.applyUniformValues} and is
   * intended for subclasses to bind their own textures, samplers, or
   * other GPU resources.
   *
   * The base implementation does nothing.
   *
   * @param _bindGroup - The bind group used for binding uniforms and resources.
   * @param _ctx - The current draw context.
   * @param _pass - Index of the active render pass.
   */
  protected internalApplyUniforms(_bindGroup: BindGroup, _ctx: DrawContext, _pass: number) {}
  /**
   * Computes the fragment color expression for this material.
   *
   * @remarks
   * The default implementation simply outputs the interpolated UV
   * coordinates as color \([u, v, 0, 1]\), which is mainly useful
   * for debugging.
   *
   * Derived classes are expected to override this method to implement
   * actual shading, such as sampling a texture.
   *
   * @param scope - The current shader function scope.
   * @returns A shader expression representing the fragment color.

   */
  protected calcFragmentColor(scope: PBInsideFunctionScope) {
    return scope.$builder.vec4(scope.$inputs.zVertexUV, 0, 1);
  }
}
