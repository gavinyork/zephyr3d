import type { FrameBuffer, PBInsideFunctionScope, PBShaderExp, Texture2D } from '@zephyr3d/device';
import { CopyBlitter } from '../blitter';
import { fetchSampler } from '../utility/misc';
import { RenderMipmap } from '../utility/rendermipmap';

class HiZRenderMipmap extends RenderMipmap {
  renderPixel(
    scope: PBInsideFunctionScope,
    leftTop: PBShaderExp,
    rightTop: PBShaderExp,
    leftBottom: PBShaderExp,
    rightBottom: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    scope.$l.minDepth = pb.min(pb.min(leftTop.r, rightTop.r), pb.min(leftBottom.r, rightBottom.r));
    return pb.vec4(scope.minDepth, 0, 0, 1);
  }
}

const hizRenderMipmap = new HiZRenderMipmap();

export function buildHiZ(sourceTex: Texture2D, HiZFrameBuffer: FrameBuffer) {
  new CopyBlitter().blit(sourceTex, HiZFrameBuffer, fetchSampler('clamp_nearest'));
  hizRenderMipmap.render(HiZFrameBuffer.getColorAttachments()[0] as Texture2D);
}
