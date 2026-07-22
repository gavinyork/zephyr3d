import { FrameResources, getDevice } from '@zephyr3d/scene';
import type { RenderModule, RGExecuteContext, RGHandle } from '@zephyr3d/scene';
import type { FrameBuffer, Texture2D } from '@zephyr3d/device';
import { DepthGrayscaleBlitter } from './depth-grayscale-blitter';

/**
 * A fully user-side {@link RenderModule} that replaces the final rendered image
 * with a grayscale visualization of the scene's depth buffer.
 *
 * This is the whole point of the demo: it is authored against the engine's
 * PUBLIC render-pipeline API only, yet it takes over the pipeline's final
 * output. It relies on two pieces of the architecture:
 *
 * 1. `reads: [FrameResources.LinearDepth]` — the pipeline auto-orders this
 *    module's setup after whatever produced the linear-depth resource, so the
 *    module can simply be `append`ed with no explicit anchor.
 *
 * 2. `FrameResources.PresentedColor` — the tail (Present) module registers the
 *    backbuffer version it presents under this key, and the graph's output sink
 *    is resolved from it (last registration wins). By reading the previous
 *    presented version (which orders our pass AFTER Present), writing a new
 *    backbuffer version, and re-registering it, this module becomes the graph's
 *    final sink. The render graph keeps our pass alive and culls nothing.
 *
 * The blit target is the pipeline's final framebuffer, captured at build time
 * from `getDevice().getFramebuffer()` — this is exactly what the engine records
 * as `finalFramebuffer` (see renderer.ts). It is `null` when rendering to the
 * screen and the bound framebuffer object when rendering to an offscreen target,
 * so this module works uniformly for both without touching `DrawContext`.
 *
 * No engine internals, no `DrawContext`, no patching of built-in modules.
 */
export function createDepthVisualizationModule(): RenderModule {
  const blitter = new DepthGrayscaleBlitter();

  return {
    type: 'DepthVisualization',
    // Declarative ordering: place this module's setup after the linear-depth
    // producer. We do not care where in the authored list it sits.
    reads: [FrameResources.LinearDepth, FrameResources.PresentedColor],
    // Only meaningful when linear depth was actually produced this frame.
    enabled: ({ blackboard }) => blackboard.has(FrameResources.LinearDepth),
    setup({ graph, blackboard }) {
      const depthHandle = blackboard.expect(FrameResources.LinearDepth);
      const prevPresented = blackboard.expect(FrameResources.PresentedColor);
      // Capture the final target now, while graph build runs with the final
      // framebuffer still bound. null = screen, otherwise the offscreen FBO.
      const finalTarget: FrameBuffer | null = getDevice().getFramebuffer();

      const written = graph.addPass('DepthVisualization', (builder) => {
        builder.read(depthHandle);
        // Reading the previously-presented backbuffer version orders this pass
        // after the built-in Present pass (it renders the normal frame first).
        builder.read(prevPresented);
        // Produce a new backbuffer version so we become the latest sink.
        const out: RGHandle = builder.write(prevPresented);
        builder.setExecute((rgCtx: RGExecuteContext) => {
          const depthTex = rgCtx.getTexture<Texture2D>(depthHandle);
          // The stored depth is normalized (near/z); the window + gamma control
          // contrast (see DepthGrayscaleBlitter).
          blitter.windowNear = 0;
          blitter.windowFar = 1;
          blitter.gamma = 1;
          // Blit into the pipeline's final target — screen (null) or offscreen.
          blitter.blit(depthTex, finalTarget);
        });
        return out;
      });

      // Take over the final output: the graph sink now follows this handle.
      blackboard.set(FrameResources.PresentedColor, written);
    }
  };
}
