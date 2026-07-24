import { createSceneRenderer, FrameResources, ProxyDrawable } from '@zephyr3d/scene';
import type { ForwardPlusModuleContext, Mesh, RenderModule } from '@zephyr3d/scene';
import { OutlineDepthMaterial, OutlineMaterial } from './outline-material';

/** Runtime controls shared by the demo UI and the render module. */
export interface OutlineSettings {
  enabled: boolean;
  width: number;
}

/**
 * Creates a custom pipeline module that draws an inverted-hull outline around one mesh.
 *
 * The module runs after the normal frame has been presented. It first rebuilds the selected
 * object's depth without touching color, then draws an expanded, front-face-culled proxy. This
 * makes the demo work for both the screen backbuffer and an offscreen final framebuffer.
 */
export function createOutlineModule(
  target: Mesh,
  settings: OutlineSettings
): RenderModule<ForwardPlusModuleContext> {
  const depthMaterial = new OutlineDepthMaterial();
  const outlineMaterial = new OutlineMaterial();
  const depthProxy = new ProxyDrawable(target, target, depthMaterial);
  const outlineProxy = new ProxyDrawable(target, target, outlineMaterial);

  return {
    type: 'ObjectOutline',
    reads: [FrameResources.PresentedColor],
    enabled: () => settings.enabled,
    setup(fg) {
      const previousPresented = fg.blackboard.expect(FrameResources.PresentedColor);
      const finalTarget = fg.finalFramebuffer;

      const outlined = fg.graph.addPass('ObjectOutline', (builder) => {
        // Reading and then writing PresentedColor orders this pass after the built-in Present pass
        // and makes the outlined version the graph's new output sink.
        builder.read(previousPresented);
        const output = builder.write(previousPresented);
        builder.setExecute((rgCtx) => {
          const renderer = createSceneRenderer(fg.ctx, rgCtx);
          const camera = fg.ctx.camera;

          const depthQueue = renderer.createQueue().add(depthProxy, camera).finalize(camera);
          const outlineQueue = renderer.createQueue().add(outlineProxy, camera).finalize(camera);

          outlineMaterial.outlineWidth = settings.width;
          renderer.renderOpaque(finalTarget, depthQueue, { clearDepth: 1 });
          renderer.renderOpaque(finalTarget, outlineQueue);
        });
        return output;
      });

      fg.blackboard.set(FrameResources.PresentedColor, outlined);
    }
  };
}
