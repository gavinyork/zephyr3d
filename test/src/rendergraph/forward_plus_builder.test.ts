import {
  HistoryResourceManager,
  RenderGraph,
  RGHistoryResources,
  type RGTextureAllocator
} from '../../../libs/scene/src/render/rendergraph';
import {
  deriveForwardPlusOptions,
  buildForwardPlusGraph,
  type ForwardPlusOptions
} from '../../../libs/scene/src/render/rendergraph/forward_plus_builder';
import { AbstractPostEffect, PostEffectLayer } from '../../../libs/scene/src/posteffect/posteffect';
import { Compositor } from '../../../libs/scene/src/posteffect/compositor';

function getMockTextureFormatSize(format: string): number {
  switch (format) {
    case 'rgba16f':
      return 8;
    case 'rgba32f':
      return 16;
    default:
      return 4;
  }
}

function createMockDrawContext(overrides: Record<string, unknown> = {}) {
  const { camera: cameraOverrides, ...restOverrides } = overrides as {
    camera?: Record<string, unknown>;
  } & Record<string, unknown>;
  return {
    device: {
      type: 'webgpu',
      getDeviceCaps: () => ({
        framebufferCaps: {
          maxColorAttachmentBytesPerSample: 32
        },
        textureCaps: {
          supportHalfFloatColorBuffer: true,
          getTextureFormatInfo: (format: string) => ({
            size: getMockTextureFormatSize(format)
          })
        }
      })
    },
    SSRCalcThickness: false,
    depthFormat: 'd24s8',
    colorFormat: 'rgba8unorm',
    renderWidth: 1920,
    renderHeight: 1080,
    finalFramebuffer: null,
    camera: {
      sssStrength: 1,
      sssBlurScale: 1,
      sssTransmissionStrength: 1,
      ...cameraOverrides
    },
    ...restOverrides
  } as any;
}

interface MockRenderQueueOptions {
  needSceneColor: boolean;
  shadowedLights?: unknown[];
}

function createMockRenderQueue(options: MockRenderQueueOptions) {
  return {
    shadowedLights: options.shadowedLights ?? [],
    needSceneColor: () => options.needSceneColor
  } as any;
}

function createOptions(overrides: Partial<ForwardPlusOptions> = {}): ForwardPlusOptions {
  return {
    depthPrepass: true,
    motionVectors: false,
    hiZ: false,
    ssr: false,
    ssrCalcThickness: false,
    gpuPicking: false,
    needSceneColor: false,
    needSceneColorWithDepth: false,
    needsTransmissionDepthForSSR: false,
    sss: false,
    skinSSS: false,
    ...overrides
  };
}

function buildForwardPlusGraphForTest(
  options: ForwardPlusOptions,
  renderQueueOptions: Partial<MockRenderQueueOptions> = {},
  drawContextOverrides: Record<string, unknown> = {}
): { graph: RenderGraph; backbuffer: ReturnType<typeof buildForwardPlusGraph> } {
  const graph = new RenderGraph();
  const backbuffer = buildForwardPlusGraph(
    graph,
    createMockDrawContext(drawContextOverrides),
    createMockRenderQueue({
      needSceneColor: options.needSceneColor,
      ...renderQueueOptions
    }),
    options
  );
  return { graph, backbuffer };
}

function compileForwardPlusPassNames(
  options: ForwardPlusOptions,
  renderQueueOptions: Partial<MockRenderQueueOptions> = {}
): string[] {
  const { graph, backbuffer } = buildForwardPlusGraphForTest(options, renderQueueOptions);
  return graph.compile([backbuffer]).orderedPasses.map((pass) => pass.name);
}

describe('Forward+ render graph builder', () => {
  test('omits TransmissionDepth when scene color copy is not needed', () => {
    const passNames = compileForwardPlusPassNames(createOptions({ needSceneColor: false }));

    expect(passNames).toContain('LightPass');
    expect(passNames).toContain('Present');
    expect(passNames).not.toContain('TransmissionDepth');
    expect(passNames.indexOf('LightPass')).toBeLessThan(passNames.indexOf('Present'));
  });

  test('inserts TransmissionDepth between LightPass and Present when scene color copy is needed without SSR prepass', () => {
    const passNames = compileForwardPlusPassNames(createOptions({ needSceneColor: true }));

    expect(passNames).toContain('LightPass');
    expect(passNames).toContain('TransmissionDepth');
    expect(passNames).toContain('Present');
    expect(passNames.indexOf('LightPass')).toBeLessThan(passNames.indexOf('TransmissionDepth'));
    expect(passNames.indexOf('TransmissionDepth')).toBeLessThan(passNames.indexOf('Present'));
  });

  test('inserts SSR transmission depth before LightPass and omits late TransmissionDepth', () => {
    const passNames = compileForwardPlusPassNames(
      createOptions({
        hiZ: true,
        needSceneColor: true,
        ssr: true,
        needsTransmissionDepthForSSR: true
      })
    );

    expect(passNames).toContain('DepthPrepass');
    expect(passNames).toContain('TransmissionDepthForSSR');
    expect(passNames).toContain('HiZ');
    expect(passNames).toContain('LightPass');
    expect(passNames).not.toContain('TransmissionDepth');
    expect(passNames.indexOf('DepthPrepass')).toBeLessThan(passNames.indexOf('TransmissionDepthForSSR'));
    expect(passNames.indexOf('TransmissionDepthForSSR')).toBeLessThan(passNames.indexOf('HiZ'));
    expect(passNames.indexOf('HiZ')).toBeLessThan(passNames.indexOf('LightPass'));
    expect(passNames.indexOf('TransmissionDepthForSSR')).toBeLessThan(passNames.indexOf('LightPass'));
  });

  test('isolates scene color copy depth when SSR pre-inserts transmission depth', () => {
    const { graph } = buildForwardPlusGraphForTest(
      createOptions({
        needSceneColor: true,
        ssr: true,
        needsTransmissionDepthForSSR: true
      })
    );
    const resourceNames = [...graph.resources.values()].map((resource) => resource.name);

    expect(resourceNames).toContain('sceneColorCopy');
    expect(resourceNames).not.toContain('SceneColorCopyFramebuffer');
  });

  test('reuses scene color copy depth when no SSR transmission depth prepass is needed', () => {
    const { graph } = buildForwardPlusGraphForTest(
      createOptions({
        needSceneColor: true,
        needsTransmissionDepthForSSR: false
      })
    );
    const resourceNames = [...graph.resources.values()].map((resource) => resource.name);

    expect(resourceNames).toContain('sceneColorCopy');
    expect(resourceNames).toContain('SceneColorCopyFramebuffer');
  });

  test('keeps TransmissionDepth after LightPass when SSR scene-color materials also need depth', () => {
    const passNames = compileForwardPlusPassNames(
      createOptions({
        needSceneColor: true,
        needSceneColorWithDepth: true,
        ssr: true,
        needsTransmissionDepthForSSR: false
      })
    );

    expect(passNames).not.toContain('TransmissionDepthForSSR');
    expect(passNames).toContain('TransmissionDepth');
    expect(passNames.indexOf('LightPass')).toBeLessThan(passNames.indexOf('TransmissionDepth'));
    expect(passNames.indexOf('TransmissionDepth')).toBeLessThan(passNames.indexOf('Present'));
  });

  test('derives SSR transmission depth prepass only when scene-color materials do not need depth', () => {
    const scene = {
      env: {
        light: {
          envLight: {
            hasRadiance: () => true
          }
        }
      }
    };
    const camera = {
      SSR: true,
      SSS: false,
      skinSSS: false,
      TAA: false,
      motionBlur: false,
      ssrTemporal: false,
      ssrCalcThickness: false,
      HiZ: false,
      getPickResultResolveFunc: () => null
    };
    const baseRenderQueue = {
      needSceneColor: () => true,
      itemList: {
        opaque: { lit: [], unlit: [] }
      }
    };

    expect(
      deriveForwardPlusOptions(scene as any, camera as any, 'webgpu', {
        ...baseRenderQueue,
        needSceneColorWithDepth: () => false
      } as any).needsTransmissionDepthForSSR
    ).toBe(true);
    expect(
      deriveForwardPlusOptions(scene as any, camera as any, 'webgpu', {
        ...baseRenderQueue,
        needSceneColorWithDepth: () => true
      } as any).needsTransmissionDepthForSSR
    ).toBe(false);
  });

  test('does not enable SSS for non-opaque-only SSS materials', () => {
    const scene = {
      env: {
        light: {
          envLight: {
            hasRadiance: () => false
          }
        }
      }
    };
    const camera = {
      SSR: false,
      SSS: true,
      skinSSS: false,
      TAA: false,
      motionBlur: false,
      ssrTemporal: false,
      ssrCalcThickness: false,
      HiZ: false,
      getPickResultResolveFunc: () => null
    };
    const sssInfo = { materialList: new Set([{ subsurfaceProfile: {} }]) };
    const emptyBundle = { lit: [], unlit: [] };
    const renderQueue = {
      needSceneColor: () => false,
      needSceneColorWithDepth: () => false,
      itemList: {
        opaque: emptyBundle,
        transmission: { lit: [sssInfo], unlit: [] },
        transparent: emptyBundle,
        transmission_trans: emptyBundle
      }
    };

    expect(deriveForwardPlusOptions(scene as any, camera as any, 'webgpu', renderQueue as any).sss).toBe(
      false
    );
  });

  test('derives SkinSSS only from opaque skin materials', () => {
    const scene = {
      env: {
        light: {
          envLight: {
            hasRadiance: () => false
          }
        }
      }
    };
    const camera = {
      SSR: false,
      SSS: false,
      skinSSS: true,
      TAA: false,
      motionBlur: false,
      ssrTemporal: false,
      ssrCalcThickness: false,
      HiZ: false,
      getPickResultResolveFunc: () => null
    };
    const emptyBundle = { lit: [], unlit: [] };
    const renderQueue = {
      needSceneColor: () => false,
      needSceneColorWithDepth: () => false,
      itemList: {
        opaque: {
          lit: [{ materialList: new Set([{ skinSSS: true }]) }],
          unlit: []
        },
        transmission: emptyBundle,
        transparent: emptyBundle,
        transmission_trans: emptyBundle
      }
    };

    expect(
      deriveForwardPlusOptions(scene as any, camera as any, 'webgpu', renderQueue as any).skinSSS
    ).toBe(true);

    renderQueue.itemList.opaque = emptyBundle;
    renderQueue.itemList.transmission = {
      lit: [{ materialList: new Set([{ skinSSS: true }]) }],
      unlit: []
    };

    expect(
      deriveForwardPlusOptions(scene as any, camera as any, 'webgpu', renderQueue as any).skinSSS
    ).toBe(false);
  });

  test('omits HiZ when disabled', () => {
    const passNames = compileForwardPlusPassNames(createOptions({ hiZ: false }));

    expect(passNames).not.toContain('HiZ');
  });

  test('inserts HiZ before LightPass when enabled', () => {
    const passNames = compileForwardPlusPassNames(createOptions({ hiZ: true }));

    expect(passNames).toContain('HiZ');
    expect(passNames).toContain('LightPass');
    expect(passNames.indexOf('HiZ')).toBeLessThan(passNames.indexOf('LightPass'));
  });

  test('computes HiZ mip levels from render size', () => {
    const { graph } = buildForwardPlusGraphForTest(
      createOptions({ hiZ: true }),
      {},
      { renderWidth: 256, renderHeight: 128 }
    );
    const hiZResource = [...graph.resources.values()].find((resource) => resource.name === 'hiZ');

    expect(hiZResource?.desc).toMatchObject({ format: 'rg32f', mipLevels: 9 });
  });

  test('inserts SSSProfile before LightPass and declares SSS MRT resources when enabled', () => {
    const { graph, backbuffer } = buildForwardPlusGraphForTest(createOptions({ sss: true }));
    const passNames = graph.compile([backbuffer]).orderedPasses.map((pass) => pass.name);
    const lightPass = graph.passes.find((pass) => pass.name === 'LightPass');

    expect(passNames).toContain('SSSProfile');
    expect(passNames).toContain('LightPass');
    expect(passNames.indexOf('SSSProfile')).toBeLessThan(passNames.indexOf('LightPass'));
    expect(lightPass?.reads.map((resource) => resource.name)).toEqual(
      expect.arrayContaining(['sssProfile', 'sssParam', 'sssNormal'])
    );
    expect(lightPass?.writes.map((resource) => resource.name)).toEqual(
      expect.arrayContaining(['sssDiffuse', 'sssTransmission'])
    );
  });

  test('declares SkinSSS MRT resource when enabled', () => {
    const { graph, backbuffer } = buildForwardPlusGraphForTest(createOptions({ skinSSS: true }));
    const passNames = graph.compile([backbuffer]).orderedPasses.map((pass) => pass.name);
    const lightPassWrites = graph.passes
      .find((pass) => pass.name === 'LightPass')
      ?.writes.map((resource) => resource.name);

    expect(passNames).toContain('LightPass');
    expect(passNames).not.toContain('SSSProfile');
    expect(lightPassWrites).toContain('skinSSS');
  });

  test('keeps SSR surface MRT with scene-color materials and omits SSS transmission to reduce MRT count', () => {
    const { graph } = buildForwardPlusGraphForTest(
      createOptions({
        sss: true,
        ssr: true,
        needSceneColor: true,
        needSceneColorWithDepth: true
      }),
      {},
      {
        colorFormat: 'rgba16f',
        SSRRoughnessTexture: { format: 'rgba16f' },
        SSRNormalTexture: { format: 'rgba16f' }
      }
    );
    const lightPassWrites = graph.passes
      .find((pass) => pass.name === 'LightPass')
      ?.writes.map((resource) => resource.name);

    expect(lightPassWrites).toContain('sssDiffuse');
    expect(lightPassWrites).not.toContain('sssTransmission');
  });

  test('uses a single DepthPrepass subpass when motion vectors are disabled', () => {
    const { graph } = buildForwardPlusGraphForTest(createOptions({ motionVectors: false }));
    const depthPass = graph.passes.find((pass) => pass.name === 'DepthPrepass');

    expect(depthPass?.subpasses.map((subpass) => subpass.name)).toEqual(['SceneDepth']);
  });

  test('uses ordered DepthPrepass subpasses when motion vectors are enabled', () => {
    const { graph } = buildForwardPlusGraphForTest(createOptions({ motionVectors: true }));
    const depthPass = graph.passes.find((pass) => pass.name === 'DepthPrepass');

    expect(depthPass?.subpasses.map((subpass) => subpass.name)).toEqual(['SceneDepth', 'SkyMotionVectors']);
  });

  test('keeps GPUPicking side-effect pass before DepthPrepass when enabled', () => {
    const passNames = compileForwardPlusPassNames(createOptions({ gpuPicking: true }));

    expect(passNames).toContain('ClusterLights');
    expect(passNames).toContain('GPUPicking');
    expect(passNames).toContain('DepthPrepass');
    expect(passNames.indexOf('ClusterLights')).toBeLessThan(passNames.indexOf('GPUPicking'));
    expect(passNames.indexOf('GPUPicking')).toBeLessThan(passNames.indexOf('DepthPrepass'));
  });

  test('omits GPUPicking when disabled', () => {
    const passNames = compileForwardPlusPassNames(createOptions({ gpuPicking: false }));

    expect(passNames).not.toContain('GPUPicking');
  });

  test('inserts ShadowMaps before DepthPrepass when shadowed lights exist', () => {
    const passNames = compileForwardPlusPassNames(createOptions(), {
      shadowedLights: [{}]
    });

    expect(passNames).toContain('ClusterLights');
    expect(passNames).toContain('ShadowMaps');
    expect(passNames).toContain('DepthPrepass');
    expect(passNames.indexOf('ClusterLights')).toBeLessThan(passNames.indexOf('ShadowMaps'));
    expect(passNames.indexOf('ShadowMaps')).toBeLessThan(passNames.indexOf('DepthPrepass'));
  });

  test('omits ShadowMaps when there are no shadowed lights', () => {
    const passNames = compileForwardPlusPassNames(createOptions(), {
      shadowedLights: []
    });

    expect(passNames).not.toContain('ShadowMaps');
  });

  test('declares compatible SSR history imports as LightPass reads', () => {
    const allocator: RGTextureAllocator<any> = {
      allocate: (_desc, _size) => ({}),
      release: () => {}
    };
    const historyManager = new HistoryResourceManager(allocator);
    const size = { width: 1920, height: 1080 };
    historyManager.beginFrame();
    historyManager.queueCommit(
      RGHistoryResources.SSR_REFLECT,
      {
        format: 'rgba16f',
        sizeMode: 'absolute',
        width: 1920,
        height: 1080
      },
      size,
      { id: 'historySSRReflect' }
    );
    historyManager.queueCommit(
      RGHistoryResources.SSR_MOTION_VECTOR,
      {
        format: 'rgba16f',
        sizeMode: 'absolute',
        width: 1920,
        height: 1080
      },
      size,
      { id: 'historySSRMotionVector' }
    );
    historyManager.commitFrame();

    const { graph } = buildForwardPlusGraphForTest(
      createOptions({ ssr: true, motionVectors: true }),
      {},
      {
        camera: {
          TAA: false,
          ssrTemporal: true,
          getHistoryResourceManager: () => historyManager
        }
      }
    );

    const lightPass = graph.passes.find((pass) => pass.name === 'LightPass');
    expect(lightPass?.reads.map((resource) => resource.name)).toEqual(
      expect.arrayContaining([
        `history:${RGHistoryResources.SSR_REFLECT}:previous`,
        `history:${RGHistoryResources.SSR_MOTION_VECTOR}:previous`
      ])
    );
  });

  test('declares compatible TAA history imports as Present reads', () => {
    const allocator: RGTextureAllocator<any> = {
      allocate: (_desc, _size) => ({}),
      release: () => {}
    };
    const historyManager = new HistoryResourceManager(allocator);
    const size = { width: 1920, height: 1080 };
    historyManager.beginFrame();
    historyManager.queueCommit(
      RGHistoryResources.TAA_COLOR,
      {
        format: 'rgba8unorm',
        sizeMode: 'absolute',
        width: 1920,
        height: 1080
      },
      size,
      { id: 'historyColor' }
    );
    historyManager.queueCommit(
      RGHistoryResources.TAA_MOTION_VECTOR,
      {
        format: 'rgba16f',
        sizeMode: 'absolute',
        width: 1920,
        height: 1080
      },
      size,
      { id: 'historyMotionVector' }
    );
    historyManager.commitFrame();

    const { graph } = buildForwardPlusGraphForTest(
      createOptions({ motionVectors: true }),
      {},
      {
        camera: {
          TAA: true,
          getHistoryResourceManager: () => historyManager
        }
      }
    );

    const composite = graph.passes.find((pass) => pass.name === 'Present');
    expect(composite?.reads.map((resource) => resource.name)).toEqual(
      expect.arrayContaining([
        `history:${RGHistoryResources.TAA_COLOR}:previous`,
        `history:${RGHistoryResources.TAA_MOTION_VECTOR}:previous`
      ])
    );
  });

  test('does not declare stale TAA history reads when size is incompatible', () => {
    const allocator: RGTextureAllocator<any> = {
      allocate: (_desc, _size) => ({}),
      release: () => {}
    };
    const historyManager = new HistoryResourceManager(allocator);
    const size = { width: 1280, height: 720 };
    historyManager.beginFrame();
    historyManager.queueCommit(
      RGHistoryResources.TAA_COLOR,
      {
        format: 'rgba8unorm',
        sizeMode: 'absolute',
        width: 1280,
        height: 720
      },
      size,
      { id: 'historyColor' }
    );
    historyManager.queueCommit(
      RGHistoryResources.TAA_MOTION_VECTOR,
      {
        format: 'rgba16f',
        sizeMode: 'absolute',
        width: 1280,
        height: 720
      },
      size,
      { id: 'historyMotionVector' }
    );
    historyManager.commitFrame();

    const { graph } = buildForwardPlusGraphForTest(
      createOptions({ motionVectors: true }),
      {},
      {
        camera: {
          TAA: true,
          getHistoryResourceManager: () => historyManager
        }
      }
    );

    const composite = graph.passes.find((pass) => pass.name === 'Present');
    expect(composite?.reads.map((resource) => resource.name)).not.toEqual(
      expect.arrayContaining([
        `history:${RGHistoryResources.TAA_COLOR}:previous`,
        `history:${RGHistoryResources.TAA_MOTION_VECTOR}:previous`
      ])
    );
  });
});

describe('Forward+ end-layer post effect chain', () => {
  class EffectA extends AbstractPostEffect {}
  class EffectB extends AbstractPostEffect {}

  function createCompositor(effects: AbstractPostEffect[]): Compositor {
    const compositor = new Compositor();
    for (const effect of effects) {
      compositor.appendPostEffect(effect);
    }
    return compositor;
  }

  test('builds one pass per enabled end-layer effect, last one writing the backbuffer directly', () => {
    const { graph, backbuffer } = buildForwardPlusGraphForTest(
      createOptions(),
      {},
      { compositor: createCompositor([new EffectA(), new EffectB()]) }
    );
    const passNames = graph.compile([backbuffer]).orderedPasses.map((pass) => pass.name);

    expect(passNames).toContain('PostEffect:EffectA');
    expect(passNames).toContain('PostEffect:EffectB');
    expect(passNames).toContain('FrameCleanup');
    expect(passNames).not.toContain('Present');
    expect(passNames.indexOf('LightPass')).toBeLessThan(passNames.indexOf('PostEffect:EffectA'));
    expect(passNames.indexOf('PostEffect:EffectA')).toBeLessThan(passNames.indexOf('PostEffect:EffectB'));
    const lastEffectPass = graph.passes.find((pass) => pass.name === 'PostEffect:EffectB');
    expect(lastEffectPass?.writes.some((res) => res.name.startsWith('backbuffer@'))).toBe(true);
  });

  test('skips disabled end-layer effects', () => {
    const effectA = new EffectA();
    effectA.enabled = false;
    const { graph, backbuffer } = buildForwardPlusGraphForTest(
      createOptions(),
      {},
      { compositor: createCompositor([effectA, new EffectB()]) }
    );
    const passNames = graph.compile([backbuffer]).orderedPasses.map((pass) => pass.name);

    expect(passNames).not.toContain('PostEffect:EffectA');
    expect(passNames).toContain('PostEffect:EffectB');
  });

  test('ends the chain in an intermediate texture when a TAA history commit is pending', () => {
    const allocator: RGTextureAllocator<any> = {
      allocate: () => ({}),
      release: () => {}
    };
    const historyManager = new HistoryResourceManager(allocator);
    const { graph, backbuffer } = buildForwardPlusGraphForTest(
      createOptions({ motionVectors: true }),
      {},
      {
        compositor: createCompositor([new EffectA()]),
        camera: { TAA: true, getHistoryResourceManager: () => historyManager }
      }
    );
    const passNames = graph.compile([backbuffer]).orderedPasses.map((pass) => pass.name);

    expect(passNames).toContain('PostEffect:EffectA');
    expect(passNames).toContain('Present');
    const effectPass = graph.passes.find((pass) => pass.name === 'PostEffect:EffectA');
    expect(effectPass?.writes.some((res) => res.name.startsWith('backbuffer@'))).toBe(false);
    expect(passNames.indexOf('PostEffect:EffectA')).toBeLessThan(passNames.indexOf('Present'));
  });

  test('keeps the Present pass when no end-layer effect is enabled', () => {
    const effect = new EffectA();
    effect.enabled = false;
    const { graph, backbuffer } = buildForwardPlusGraphForTest(
      createOptions(),
      {},
      { compositor: createCompositor([effect]) }
    );
    const passNames = graph.compile([backbuffer]).orderedPasses.map((pass) => pass.name);

    expect(passNames).toContain('Present');
    expect(passNames).not.toContain('PostEffect:EffectA');
  });

  test('orders end-layer effect passes after TransmissionDepth', () => {
    const { graph, backbuffer } = buildForwardPlusGraphForTest(
      createOptions({ needSceneColor: true }),
      {},
      { compositor: createCompositor([new EffectA()]) }
    );
    const passNames = graph.compile([backbuffer]).orderedPasses.map((pass) => pass.name);

    expect(passNames).toContain('TransmissionDepth');
    expect(passNames.indexOf('TransmissionDepth')).toBeLessThan(passNames.indexOf('PostEffect:EffectA'));
  });
});

describe('Forward+ transparent-layer post effect chain', () => {
  class TransparentEffect extends AbstractPostEffect {
    constructor() {
      super();
      this._layer = PostEffectLayer.transparent;
    }
  }
  class EndEffect extends AbstractPostEffect {}

  function createCompositor(effects: AbstractPostEffect[]): Compositor {
    const compositor = new Compositor();
    for (const effect of effects) {
      compositor.appendPostEffect(effect);
    }
    return compositor;
  }

  test('builds transparent-layer effects between LightPass and TransmissionDepth', () => {
    const { graph, backbuffer } = buildForwardPlusGraphForTest(
      createOptions({ needSceneColor: true }),
      {},
      { compositor: createCompositor([new TransparentEffect(), new EndEffect()]) }
    );
    const passNames = graph.compile([backbuffer]).orderedPasses.map((pass) => pass.name);

    expect(passNames).toContain('PostEffect:TransparentEffect');
    expect(passNames).toContain('TransmissionDepth');
    expect(passNames).toContain('PostEffect:EndEffect');
    expect(passNames.indexOf('LightPass')).toBeLessThan(passNames.indexOf('PostEffect:TransparentEffect'));
    expect(passNames.indexOf('PostEffect:TransparentEffect')).toBeLessThan(
      passNames.indexOf('TransmissionDepth')
    );
    expect(passNames.indexOf('TransmissionDepth')).toBeLessThan(passNames.indexOf('PostEffect:EndEffect'));
  });

  test('gives the direct final write to the end layer when both layers have effects', () => {
    const { graph, backbuffer } = buildForwardPlusGraphForTest(
      createOptions(),
      {},
      { compositor: createCompositor([new TransparentEffect(), new EndEffect()]) }
    );
    graph.compile([backbuffer]);
    const transparentPass = graph.passes.find((pass) => pass.name === 'PostEffect:TransparentEffect');
    const endPass = graph.passes.find((pass) => pass.name === 'PostEffect:EndEffect');

    expect(transparentPass?.writes.some((res) => res.name.startsWith('backbuffer@'))).toBe(false);
    expect(endPass?.writes.some((res) => res.name.startsWith('backbuffer@'))).toBe(true);
  });

  test('gives the direct final write to the transparent layer when the end layer is empty', () => {
    const { graph, backbuffer } = buildForwardPlusGraphForTest(
      createOptions(),
      {},
      { compositor: createCompositor([new TransparentEffect()]) }
    );
    const passNames = graph.compile([backbuffer]).orderedPasses.map((pass) => pass.name);
    const transparentPass = graph.passes.find((pass) => pass.name === 'PostEffect:TransparentEffect');

    expect(transparentPass?.writes.some((res) => res.name.startsWith('backbuffer@'))).toBe(true);
    expect(passNames).toContain('FrameCleanup');
    expect(passNames).not.toContain('Present');
  });

  test('chains transparent output into the end layer input', () => {
    const { graph, backbuffer } = buildForwardPlusGraphForTest(
      createOptions(),
      {},
      { compositor: createCompositor([new TransparentEffect(), new EndEffect()]) }
    );
    graph.compile([backbuffer]);
    const transparentPass = graph.passes.find((pass) => pass.name === 'PostEffect:TransparentEffect');
    const endPass = graph.passes.find((pass) => pass.name === 'PostEffect:EndEffect');
    const transparentOutput = transparentPass?.writes.find((res) =>
      res.name.startsWith('PostEffect:TransparentEffect:out')
    );

    expect(transparentOutput).toBeDefined();
    expect(endPass?.reads).toContain(transparentOutput);
  });
});
