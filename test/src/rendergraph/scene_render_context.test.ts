import {
  _getSceneRenderPassesForTest,
  createSceneRenderer
} from '../../../libs/scene/src/render/rendergraph/scene_render_context';

function createContext() {
  const device = {
    pushDeviceStates: jest.fn(),
    popDeviceStates: jest.fn(),
    setFramebuffer: jest.fn(),
    setViewport: jest.fn(),
    setScissor: jest.fn()
  };
  const ctx = {
    device,
    camera: { id: 'camera' },
    renderPass: 'original-pass',
    renderPassHash: 'original-hash',
    shaderVariantHash: 'original-variant',
    flip: false,
    drawEnvLight: true,
    env: { id: 'original-env' },
    queue: 17,
    lightBlending: true,
    instanceData: { id: 'original-instance' },
    oit: { id: 'original-oit' },
    currentShadowLight: { id: 'original-shadow-light' },
    materialFlags: 0x7fffffff,
    shadowMaskClusterSample: true,
    compositor: { id: 'original-compositor' },
    depthPrepassAttachment: { id: 'original-depth' },
    sunLight: { id: 'original-sun' },
    primaryDirectionalLight: { id: 'original-directional' },
    primaryTransmissionLight: { id: 'original-transmission' }
  };
  return { ctx, device };
}

function createExecuteContext() {
  return {
    deferCleanup: jest.fn(),
    getTexture: jest.fn(),
    getFramebuffer: jest.fn(),
    createFramebuffer: jest.fn()
  };
}

describe('SceneRenderContext state isolation', () => {
  const passes = _getSceneRenderPassesForTest();
  let originalCull: typeof passes.light.cullScene;
  let originalRender: typeof passes.light.render;

  beforeEach(() => {
    originalCull = passes.light.cullScene;
    originalRender = passes.light.render;
  });

  afterEach(() => {
    passes.light.cullScene = originalCull;
    passes.light.render = originalRender;
  });

  test('cull returns queue lighting without leaking it into DrawContext', () => {
    const { ctx } = createContext();
    const originalLights = [ctx.sunLight, ctx.primaryDirectionalLight, ctx.primaryTransmissionLight];
    const queue = { dispose: jest.fn() };
    passes.light.cullScene = jest.fn((drawContext: any) => {
      drawContext.sunLight = { id: 'culled-sun' };
      drawContext.primaryDirectionalLight = { id: 'culled-directional' };
      drawContext.primaryTransmissionLight = { id: 'culled-transmission' };
      return queue as never;
    });

    const renderer = createSceneRenderer(ctx as never, createExecuteContext() as never);
    expect(renderer.cull()).toBe(queue);
    expect([ctx.sunLight, ctx.primaryDirectionalLight, ctx.primaryTransmissionLight]).toEqual(originalLights);
  });

  test('render restores all pass-mutated context state when drawing throws', () => {
    const { ctx, device } = createContext();
    const original = { ...ctx };
    passes.light.render = jest.fn((drawContext: any) => {
      Object.assign(drawContext, {
        renderPass: 'mutated',
        renderPassHash: 'mutated',
        shaderVariantHash: 'mutated',
        flip: true,
        drawEnvLight: false,
        env: null,
        queue: 0,
        lightBlending: false,
        instanceData: null,
        oit: null,
        currentShadowLight: null,
        materialFlags: 0,
        shadowMaskClusterSample: false
      });
      throw new Error('draw failed');
    });
    const queue = {
      sunLight: { id: 'queue-sun' },
      primaryDirectionalLight: { id: 'queue-directional' },
      primaryTransmissionLight: { id: 'queue-transmission' }
    };
    const renderer = createSceneRenderer(ctx as never, createExecuteContext() as never);

    expect(() => renderer.renderOpaque({} as never, queue as never)).toThrow('draw failed');
    for (const key of Object.keys(original)) {
      if (key !== 'device') {
        expect((ctx as any)[key]).toBe((original as any)[key]);
      }
    }
    expect(device.pushDeviceStates).toHaveBeenCalledTimes(1);
    expect(device.popDeviceStates).toHaveBeenCalledTimes(1);
  });
});
