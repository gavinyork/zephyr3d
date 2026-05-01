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

function createMockRenderQueue(needSceneColor: boolean) {
  return {
    shadowedLights: [],
    needSceneColor: () => needSceneColor
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

function compileForwardPlusPassNames(options: ForwardPlusOptions): string[] {
  const graph = new RenderGraph();
  const backbuffer = buildForwardPlusGraph(
    graph,
    createMockDrawContext(),
    createMockRenderQueue(options.needSceneColor),
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
});
