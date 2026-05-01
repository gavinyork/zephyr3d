import { RenderGraph } from '../../../libs/scene/src/render/rendergraph';
import {
  buildForwardPlusGraph,
  type ForwardPlusOptions
} from '../../../libs/scene/src/render/rendergraph/forward_plus_builder';

function createMockDrawContext() {
  return {
    device: {
      type: 'webgpu'
    },
    SSRCalcThickness: false,
    depthFormat: 'd24s8',
    colorFormat: 'rgba8unorm',
    renderWidth: 1920,
    renderHeight: 1080,
    finalFramebuffer: null
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

function compileForwardPlusPassNames(
  options: ForwardPlusOptions,
  renderQueueOptions: Partial<MockRenderQueueOptions> = {}
): string[] {
  const graph = new RenderGraph();
  const backbuffer = buildForwardPlusGraph(
    graph,
    createMockDrawContext(),
    createMockRenderQueue({
      needSceneColor: options.needSceneColor,
      ...renderQueueOptions
    }),
    options
  );
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
});
