import { BlendingState, PBInsideFunctionScope, PBShaderExp, RenderStateSet } from "@zephyr3d/device";
import { DrawContext } from "./drawable";

export abstract class OIT {
  abstract getNumPasses(): number;
  abstract begin(ctx: DrawContext);
  abstract outputFragmentColor(scope: PBInsideFunctionScope, color: PBShaderExp, pass: number);
  abstract end(ctx: DrawContext);
  abstract setRenderStates(rs: RenderStateSet);
}

