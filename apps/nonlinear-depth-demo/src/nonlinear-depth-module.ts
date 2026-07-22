import { FrameResources, getDevice } from '@zephyr3d/scene';
import type { RenderModule, RGExecuteContext, RGHandle } from '@zephyr3d/scene';
import type { FrameBuffer, Texture2D } from '@zephyr3d/device';
import { NonLinearDepthBlitter } from './nonlinear-depth-blitter';

/**
 * A fully user-side {@link RenderModule} that replaces the final rendered image
 * with a grayscale visualization of the RAW, non-linear depth buffer.
 *
 * It mirrors the linear-depth demo's takeover mechanism (read the previous
 * `PresentedColor` to order after Present, write a new backbuffer version,
 * re-register it as the sink), but differs in what it samples:
 *
 * - It reads `FrameResources.SceneDepthAttachment` — the scene's actual
 *   depth-stencil texture — and displays its red channel (non-linear NDC depth)
 *   directly. No linearization and no re-derivation from the linear-depth
 *   texture.
 *
 * Availability caveat: the engine only registers `SceneDepthAttachment` when
 * the graph owns the depth attachment (i.e. the final framebuffer does not
 * supply its own depth texture — see forward_plus_builder.ts). When an external
 * depth attachment is used, the resource is absent; this module gates on that
 * via `enabled` and simply does nothing, leaving the normal frame on screen.
 *
 * Backend note: sampling a depth texture's red channel as non-linear NDC depth
 * is the WebGL2 path this demo targets.
 *
 * No engine internals, no `DrawContext`, no patching of built-in modules.
 */
export function createNonLinearDepthModule(): RenderModule {
  const blitter = new NonLinearDepthBlitter();

  return {
    type: 'NonLinearDepthVisualization',
    // Order this module's setup after the depth attachment and current sink.
    reads: [FrameResources.SceneDepthAttachment, FrameResources.PresentedColor],
    // Only run when the graph actually owns a sampleable depth attachment.
    enabled: ({ blackboard }) => blackboard.has(FrameResources.SceneDepthAttachment),
    setup({ graph, blackboard }) {
      const depthHandle = blackboard.expect(FrameResources.SceneDepthAttachment);
      const prevPresented = blackboard.expect(FrameResources.PresentedColor);
      // Capture the final target while graph build runs with it still bound.
      const finalTarget: FrameBuffer | null = getDevice().getFramebuffer();

      const written = graph.addPass('NonLinearDepthVisualization', (builder) => {
        builder.read(depthHandle);
        // Order after the built-in Present pass.
        builder.read(prevPresented);
        const out: RGHandle = builder.write(prevPresented);
        builder.setExecute((rgCtx: RGExecuteContext) => {
          const depthTex = rgCtx.getTexture<Texture2D>(depthHandle);
          // The hyperbolic z distribution crushes everything toward 1, so a
          // near-1 window with a gamma curve is what makes the gradient visible.
          blitter.windowNear = 0.9;
          blitter.windowFar = 1;
          blitter.gamma = 1;
          blitter.blit(depthTex, finalTarget);
        });
        return out;
      });

      blackboard.set(FrameResources.PresentedColor, written);
    }
  };
}
