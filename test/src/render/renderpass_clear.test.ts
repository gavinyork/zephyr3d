/**
 * Regression test: RenderPass.clearFramebuffer() must decide whether to clear
 * by null-checking clearDepth/clearStencil, not by truthiness. Under the
 * reverse-Z convention the depth clear value is 0, which is falsy — a
 * truthiness check would silently skip clearing the depth buffer.
 */

import { RenderPass } from '../../../libs/scene/src/render/renderpass';

const clearFrameBuffer = jest.fn();

jest.mock('../../../libs/scene/src/app/api', () => ({
  getDevice: () => ({
    clearFrameBuffer
  })
}));

class TestRenderPass extends RenderPass {
  protected _getGlobalBindGroupHash(): string {
    return '';
  }
  protected renderItems(): void {}
  invokeClearFramebuffer(): void {
    (this as unknown as { clearFramebuffer(): void }).clearFramebuffer();
  }
}

describe('RenderPass.clearFramebuffer null semantics', () => {
  beforeEach(() => {
    clearFrameBuffer.mockClear();
  });

  test('clearDepth = 0 still triggers a framebuffer clear', () => {
    const pass = new TestRenderPass(0);
    pass.clearColor = null;
    pass.clearDepth = 0;
    pass.clearStencil = null;
    pass.invokeClearFramebuffer();
    expect(clearFrameBuffer).toHaveBeenCalledTimes(1);
    expect(clearFrameBuffer).toHaveBeenCalledWith(null, 0, null);
  });

  test('clearStencil = 0 still triggers a framebuffer clear', () => {
    const pass = new TestRenderPass(0);
    pass.clearColor = null;
    pass.clearDepth = null;
    pass.clearStencil = 0;
    pass.invokeClearFramebuffer();
    expect(clearFrameBuffer).toHaveBeenCalledTimes(1);
    expect(clearFrameBuffer).toHaveBeenCalledWith(null, null, 0);
  });

  test('all-null clear state skips the device call', () => {
    const pass = new TestRenderPass(0);
    pass.clearColor = null;
    pass.clearDepth = null;
    pass.clearStencil = null;
    pass.invokeClearFramebuffer();
    expect(clearFrameBuffer).not.toHaveBeenCalled();
  });
});
