import { createSceneRenderer, FrameResources, ProxyDrawable } from '@zephyr3d/scene';
import type { ForwardPlusModuleContext, Mesh, RenderModule } from '@zephyr3d/scene';
import type { FrameBuffer } from '@zephyr3d/device';
import { OutlineMaterial } from './outline-material';

/** Runtime controls shared by the demo UI and the render module. */
export interface OutlineSettings {
  enabled: boolean;
  width: number;
}

/**
 * Creates a custom pipeline module that draws an inverted-hull outline around one mesh.
 *
 * The module runs between SkyPass and CompositeTail. It draws an expanded,
 * front-face-culled proxy into the current scene color while reusing the scene depth attachment.
 */
export function createOutlineModule(
  target: Mesh,
  settings: OutlineSettings
): RenderModule<ForwardPlusModuleContext> {
  const outlineMaterial = new OutlineMaterial();
  const outlineProxy = new ProxyDrawable(target, target, outlineMaterial);

  return {
    type: 'ObjectOutline',
    reads: [
      { resource: FrameResources.SceneColor, version: 'current' },
      { resource: FrameResources.SceneDepthAttachment, version: 'current' }
    ],
    writes: [FrameResources.SceneColor],
    clone: () => createOutlineModule(target, settings),
    dispose() {
      outlineProxy.dispose();
      outlineMaterial.dispose();
    },
    prepare: () => ({ enabled: settings.enabled }),
    setup(fg) {
      const sceneColor = fg.blackboard.expect(FrameResources.SceneColor);
      const graphDepth = fg.blackboard.get(FrameResources.SceneDepthAttachment);
      const depthAttachment = graphDepth ?? fg.finalFramebuffer?.getDepthAttachment();
      if (!depthAttachment) {
        return;
      }

      const outlined = fg.graph.addPass('ObjectOutline', (builder) => {
        builder.read(sceneColor);
        if (graphDepth) {
          builder.read(graphDepth);
        }
        const output = builder.write(sceneColor);
        const framebuffer = builder.createFramebuffer<FrameBuffer>({
          label: 'ObjectOutlineFramebuffer',
          width: fg.ctx.renderWidth,
          height: fg.ctx.renderHeight,
          colorAttachments: output,
          depthAttachment,
          ignoreDepthStencil: false
        });
        builder.setExecute((rgCtx) => {
          const renderer = createSceneRenderer(fg.ctx, rgCtx);
          const camera = fg.ctx.camera;
          const outlineQueue = renderer.createQueue().add(outlineProxy, camera).finalize(camera);

          outlineMaterial.outlineWidth = settings.width;
          renderer.renderOpaque(rgCtx.getFramebuffer<FrameBuffer>(framebuffer), outlineQueue);
        });
        return output;
      });

      fg.blackboard.set(FrameResources.SceneColor, outlined);
    }
  };
}
