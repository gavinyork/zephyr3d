import type { RenderStateSet, VertexLayout } from "@zephyr3d/device";
import { Application } from "../app";

let quadVertexLayout: VertexLayout = null;
let quadRenderStateSet: RenderStateSet = null;

export function drawFullscreenQuad(renderStates?: RenderStateSet) {
  const device = Application.instance.device;
  if (!quadVertexLayout) {
    quadVertexLayout = device.createVertexLayout({
      vertexBuffers: [{ buffer: device.createVertexBuffer('position_f32x2', new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])) }]
    });
  }
  if (!quadRenderStateSet) {
    quadRenderStateSet = device.createRenderStateSet();
    quadRenderStateSet.useRasterizerState().setCullMode('none');
    quadRenderStateSet.useDepthState().enableTest(false).enableWrite(false);
  }
  const saveRenderStateSet = device.getRenderStates();
  device.setRenderStates(renderStates ?? quadRenderStateSet);
  device.setVertexLayout(quadVertexLayout);
  device.draw('triangle-strip', 0, 4);
  device.setRenderStates(saveRenderStateSet);
}
