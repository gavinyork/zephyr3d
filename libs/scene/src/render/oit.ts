/*
function mix(t) {
  let c_dst = t[0].c * t[0].a;
  let a_dst = 1 - t[0].a;
  for (let i = 1; i < t.length; i++) {
    let c_src = t[i].c;
    let a_src = t[i].a;
    c_dst = c_src * a_src * a_dst + c_dst;
    a_dst = a_dst * (1 - a_src);
  }
  return { c: c_dst, a: a_dst };
}

function under(t, d) {
  const x = mix(t);
  return x.a * d + x.c;
}

function over(t, d) {
  let c = d;
  for (let i = t.length - 1; i >= 0; i--) {
    const s = t[i];
    c = s.c * s.a + c * (1 - s.a);
  }
  return c;
}
*/
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

