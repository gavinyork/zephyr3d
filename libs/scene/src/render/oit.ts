import { PBGlobalScope, PBInsideFunctionScope, PBShaderExp, RenderStateSet } from "@zephyr3d/device";
import { DrawContext } from "./drawable";

export abstract class OIT {
  abstract getType(): string;
  abstract getNumPasses(): number;
  abstract begin(ctx: DrawContext, pass: number);
  abstract setupFragmentOutput(scope: PBGlobalScope);
  abstract outputFragmentColor(scope: PBInsideFunctionScope, color: PBShaderExp);
  abstract end(ctx: DrawContext, pass: number);
  abstract calculateHash(): string;
  abstract setRenderStates(rs: RenderStateSet);
}

