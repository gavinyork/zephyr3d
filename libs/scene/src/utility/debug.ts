import type { BaseTexture, FrameBuffer } from '@zephyr3d/device';
import { copyTexture, fetchSampler } from './misc';

const debugFrameBuffer: Record<string, FrameBuffer> = {};

export function debugTexture(tex: BaseTexture, label: string) {
  let fb = debugFrameBuffer[label];
  if (!fb || fb.getWidth() !== tex.width || fb.getHeight() !== tex.height) {
    fb?.getColorAttachments()[0]?.dispose();
    fb?.dispose();
    fb = tex.device.createFrameBuffer(
      [
        tex.device.createTexture2D(tex.format, tex.width, tex.height, {
          samplerOptions: {
            mipFilter: 'none'
          }
        })
      ],
      null
    );
    fb.getColorAttachments()[0].name = label ?? 'Debug';
    debugFrameBuffer[label] = fb;
  }
  copyTexture(tex, fb, fetchSampler('clamp_nearest_nomip'));
}
