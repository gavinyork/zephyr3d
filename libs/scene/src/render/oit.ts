import type {
  BindGroup,
  PBGlobalScope,
  PBInsideFunctionScope,
  PBShaderExp,
  RenderStateSet
} from '@zephyr3d/device';
import type { DrawContext } from './drawable';

/**
 * Abstract class for order-independent transparency renderers.
 *
 * Order-independent transparency (OIT) renderers allow for rendering
 * of transparent objects in any order, regardless of their depth.
 *
 * This abstract class defines the common interface for all OIT renderers.
 * Specific implementations of OIT renderers should extend this class and
 * provide concrete implementations for the abstract methods.
 *
 * @public
 */
export abstract class OIT {
  /**
   * Returns the type of the renderer.
   *
   * @returns The type of the renderer.
   */
  abstract getType(): string;
  /**
   * Checks whether the renderer supports the given device type.
   *
   * @param deviceType - The device type.
   * @returns True if the renderer supports the device type, false otherwise.
   */
  abstract supportDevice(deviceType: string): boolean;
  /**
   * Begins rendering the transparent objects.
   *
   * @param ctx - The draw context.
   * @returns The number of passes required for rendering.
   */
  abstract begin(ctx: DrawContext): number;
  /**
   * Ends rendering the transparent objects.
   *
   * @param ctx - The draw context.
   */
  abstract end(ctx: DrawContext);
  /**
   * Begins rendering for the given pass.
   *
   * @param ctx - The draw context.
   * @param pass - The pass number.
   * @returns True if the transparent objects should be rendered, false otherwise.
   */
  abstract beginPass(ctx: DrawContext, pass: number): boolean;
  /**
   * Ends rendering for the given pass.
   *
   * @param ctx - The draw context.
   * @param pass - The pass number.
   */
  abstract endPass(ctx: DrawContext, pass: number);
  /**
   * Sets up the fragment output.
   *
   * @remarks
   * This method declares necessary uniform variables for OIT rendering and injects it into the object's material.
   *
   * @param scope - The global shader scope.
   */
  abstract setupFragmentOutput(scope: PBGlobalScope);
  /**
   * Do the fragment color output.
   *
   * @remarks
   * This method outputs the calculated fragment color for OIT rendering and injects it into the object's material.
   *
   * @param scope - The global shader scope.
   * @param color - The calculated fragment color.
   */
  abstract outputFragmentColor(scope: PBInsideFunctionScope, color: PBShaderExp): boolean;
  /**
   * Applies the uniforms for the given draw context and bind group.
   *
   * This function will be called when ever the transparent material will upload uniform variables.
   *
   * @param ctx - The draw context.
   * @param bindGroup - The bind group.
   */
  abstract applyUniforms(ctx: DrawContext, bindGroup: BindGroup);
  /**
   * Calculates the hash of the renderer.
   *
   * @remarks
   * When this hash value was changed, material shader will be forced recreate.
   *
   * @returns The hash of the renderer.
   */
  abstract calculateHash(): string;
  /**
   * Sets the render states for the renderer.
   *
   * This function will be called when the transparent object will be rendered.
   *
   * @param rs - The render states.
   */
  abstract setRenderStates(rs: RenderStateSet);
  /**
   * Disposes the renderer.
   */
  abstract dispose(): void;
}
