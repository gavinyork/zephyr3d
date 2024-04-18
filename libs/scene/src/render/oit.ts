import type {
  BindGroup,
  PBGlobalScope,
  PBInsideFunctionScope,
  PBShaderExp,
  RenderStateSet
} from '@zephyr3d/device';
import type { DrawContext } from './drawable';

export abstract class OIT {
  abstract getType(): string;
  abstract supportDevice(deviceType: string): boolean;
  abstract begin(ctx: DrawContext): number;
  abstract end(ctx: DrawContext);
  abstract beginPass(ctx: DrawContext, pass: number): boolean;
  abstract endPass(ctx: DrawContext, pass: number);
  abstract setupFragmentOutput(scope: PBGlobalScope);
  abstract outputFragmentColor(scope: PBInsideFunctionScope, color: PBShaderExp): boolean;
  abstract applyUniforms(ctx: DrawContext, bindGroup: BindGroup);
  abstract calculateHash(): string;
  abstract setRenderStates(rs: RenderStateSet);
}
