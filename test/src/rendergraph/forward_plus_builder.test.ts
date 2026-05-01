import {
  HistoryResourceManager,
  RenderGraph,
  RGHistoryResources,
  type RGTextureAllocator
} from '../../../libs/scene/src/render/rendergraph';
import {
  buildForwardPlusGraph,
  type ForwardPlusOptions
} from '../../../libs/scene/src/render/rendergraph/forward_plus_builder';

function createMockDrawContext(overrides: Record<string, unknown> = {}) {
  return {
    device: {
      type: 'webgpu'
    },
    SSRCalcThickness: false,
    depthFormat: 'd24s8',
    colorFormat: 'rgba8unorm',
    renderWidth: 1920,
    renderHeight: 1080,
    finalFramebuffer: null,
    ...overrides
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
    expect(passNames).toContain('Composite');
    expect(passNames).not.toContain('TransmissionDepth');
    expect(passNames.indexOf('LightPass')).toBeLessThan(passNames.indexOf('Composite'));
  });

  test('inserts TransmissionDepth between LightPass and Composite when scene color copy is needed', () => {
    const passNames = compileForwardPlusPassNames(createOptions({ needSceneColor: true }));

    expect(passNames).toContain('LightPass');
    expect(passNames).toContain('TransmissionDepth');
    expect(passNames).toContain('Composite');
    expect(passNames.indexOf('LightPass')).toBeLessThan(passNames.indexOf('TransmissionDepth'));
    expect(passNames.indexOf('TransmissionDepth')).toBeLessThan(passNames.indexOf('Composite'));
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

  test('declares compatible TAA history imports as Composite reads', () => {
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

    const composite = graph.passes.find((pass) => pass.name === 'Composite');
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

    const composite = graph.passes.find((pass) => pass.name === 'Composite');
    expect(composite?.reads.map((resource) => resource.name)).not.toEqual(
      expect.arrayContaining([
        `history:${RGHistoryResources.TAA_COLOR}:previous`,
        `history:${RGHistoryResources.TAA_MOTION_VECTOR}:previous`
      ])
    );
  });
});
