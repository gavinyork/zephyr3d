import { BindGroup, PBGlobalScope, PBInsideFunctionScope, PBShaderExp, RenderStateSet } from "@zephyr3d/device";
import { DrawContext } from "./drawable";

export abstract class OIT {
  abstract getType(): string;
  abstract getNumPasses(ctx: DrawContext): number;
  abstract begin(ctx: DrawContext, pass: number);
  abstract setupFragmentOutput(scope: PBGlobalScope);
  abstract outputFragmentColor(scope: PBInsideFunctionScope, color: PBShaderExp): boolean;
  abstract applyUniforms(ctx: DrawContext, bindGroup: BindGroup);
  abstract end(ctx: DrawContext, pass: number);
  abstract calculateHash(): string;
  abstract setRenderStates(rs: RenderStateSet);
}

