import { FrameResources } from '@zephyr3d/scene';
import type { RenderModule, RGExecuteContext, RGHandle } from '@zephyr3d/scene';
import type { FrameBuffer, Texture2D } from '@zephyr3d/device';
import { NonLinearDepthBlitter } from './nonlinear-depth-blitter';

/**
 * A fully user-side {@link RenderModule} that replaces the final rendered image
 * with a grayscale visualization of the RAW, non-linear depth buffer.
 *
 * It mirrors the linear-depth demo's takeover mechanism (discard-write a new
 * `PresentedColor` version and register it as the sink), but differs in what it
 * samples:
 *
 * - It reads `FrameResources.SceneDepthAttachment` — the scene's actual
 *   depth-stencil texture — and displays its red channel (non-linear NDC depth)
 *   directly. No linearization and no re-derivation from the linear-depth
 *   texture.
 *
 * Graph-owned and external final-framebuffer depth textures are both published
 * as `SceneDepthAttachment`, so the module works in screen and render-to-texture
 * paths as long as the attachment is sampleable.
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
    clone: () => createNonLinearDepthModule(),
    // Order this module's setup after the depth attachment and current sink.
    reads: [
      { resource: FrameResources.SceneDepthAttachment, version: 'final' },
      { resource: FrameResources.PresentedColor, version: 'final' }
    ],
    writes: [FrameResources.PresentedColor],
    // enabled() runs before all module setup callbacks, so resource availability
    // must be checked in setup rather than by reading the blackboard here.
    enabled: () => true,
    setup({ graph, blackboard, finalFramebuffer }) {
      if (!blackboard.has(FrameResources.SceneDepthAttachment)) {
        return;
      }
      const depthHandle = blackboard.expect(FrameResources.SceneDepthAttachment);
      const prevPresented = blackboard.expect(FrameResources.PresentedColor);
      // Capture the final target while graph build runs with it still bound.
      const finalTarget: FrameBuffer | null = finalFramebuffer;

      const written = graph.addPass('NonLinearDepthVisualization', (builder) => {
        builder.read(depthHandle);
        const out: RGHandle = builder.write(prevPresented, { load: 'discard' });
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
