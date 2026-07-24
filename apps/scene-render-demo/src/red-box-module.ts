import { Vector4 } from '@zephyr3d/base';
import { UnlitMaterial, ProxyDrawable } from '@zephyr3d/scene';
import { createSceneRenderer, FrameResources, getDevice } from '@zephyr3d/scene';
import type { Mesh, ForwardPlusModuleContext, RenderModule, PersistentSceneQueue } from '@zephyr3d/scene';

export type RedBoxMode = 'transient' | 'persistent';

export function createRedBoxModule(
  redMeshes: Mesh[],
  getMode: () => RedBoxMode
): RenderModule<ForwardPlusModuleContext> {
  let persistentQueue: PersistentSceneQueue | null = null;
  let redMaterial: UnlitMaterial | null = null;
  let persistentProxies: ProxyDrawable[] = [];

  return {
    type: 'RedBoxPass',
    clone: () => createRedBoxModule(redMeshes, getMode),
    dispose() {
      persistentQueue?.dispose();
      persistentQueue = null;
      for (const proxy of persistentProxies) {
        proxy.dispose();
      }
      persistentProxies = [];
      redMaterial?.dispose();
      redMaterial = null;
    },
    // Order this module's setup after the Present module publishes PresentedColor,
    // so we render the red boxes on top of the finished frame.
    reads: [{ resource: FrameResources.PresentedColor, version: 'final' }],
    writes: [FrameResources.PresentedColor],
    enabled: () => true,
    setup(fg: ForwardPlusModuleContext) {
      if (!fg.blackboard.has(FrameResources.PresentedColor)) {
        return;
      }
      const prevPresented = fg.blackboard.expect(FrameResources.PresentedColor);
      const finalTarget = fg.finalFramebuffer;

      const written = fg.graph.addPass('RedBoxPass', (builder) => {
        // Reading the presented backbuffer orders this pass after Present; writing
        // a new version makes this pass the graph's final sink.
        builder.read(prevPresented);
        const out = builder.write(prevPresented);
        builder.setExecute((rgCtx) => {
          const device = getDevice();
          device.pushDeviceStates();
          try {
            device.setFramebuffer(finalTarget);
            const sr = createSceneRenderer(fg.ctx, rgCtx);
            const camera = fg.ctx.camera;
            if (getMode() === 'transient') {
              const qb = sr.createQueue();
              for (const mesh of redMeshes) {
                qb.add(mesh, camera);
              }
              // Do not clear: render on top of the presented frame, keep its depth.
              sr.renderOpaque(finalTarget, qb.finalize(camera));
            } else {
              if (!persistentQueue) {
                persistentQueue = sr.createPersistentQueue();
                redMaterial = new UnlitMaterial();
                redMaterial.albedoColor = new Vector4(1, 0, 0, 1);
                for (const mesh of redMeshes) {
                  const proxy = new ProxyDrawable(mesh, mesh, redMaterial);
                  persistentProxies.push(proxy);
                  persistentQueue.add(proxy, camera);
                }
                persistentQueue.finalize(camera, true);
                console.log('[RedBoxPass] persistent queue built');
              }
              sr.renderOpaque(finalTarget, persistentQueue.queue);
            }
          } finally {
            device.popDeviceStates();
          }
        });
        return out;
      });

      // Take over the final output sink.
      fg.blackboard.set(FrameResources.PresentedColor, written);
    }
  };
}
