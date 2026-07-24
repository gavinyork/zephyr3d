import {
  _getScenePassForTest,
  renderOpaqueScenePass,
  renderSkyScenePass,
  renderTransparentScenePass
} from '../../../libs/scene/src/render/rendergraph/forward_plus_builder';

// ─── _scenePass state-contract test ──────────────────────────────────
//
// The graph topology test (forward_plus_builder.test.ts) never runs the pass
// execute callbacks, so it cannot see the shared `_scenePass` singleton's
// render-control fields. Those seven fields (transmission / clearColor /
// clearDepth / clearStencil / renderOpaque / renderTransparent / renderSky) are mutated in
// place by the opaque and transparent scene passes and are only correct because
// each pass sets every field it needs before `render()` (rather than inheriting
// leftover state) and restores the shared flags afterwards. Module extraction
// must preserve that contract; this test locks it by intercepting `render()` and
// snapshotting the fields at call time.

interface RenderSnapshot {
  transmission: unknown;
  clearColor: unknown;
  clearDepth: unknown;
  clearStencil: unknown;
  renderOpaque: unknown;
  renderTransparent: unknown;
  renderSky: unknown;
}

function snapshotScenePass(): RenderSnapshot {
  const p = _getScenePassForTest() as unknown as RenderSnapshot;
  return {
    transmission: p.transmission,
    clearColor: p.clearColor,
    clearDepth: p.clearDepth,
    clearStencil: p.clearStencil,
    renderOpaque: p.renderOpaque,
    renderTransparent: p.renderTransparent,
    renderSky: p.renderSky
  };
}

function createMockDevice() {
  return {
    pushDeviceStates: jest.fn(),
    popDeviceStates: jest.fn(),
    setFramebuffer: jest.fn(),
    setViewport: jest.fn(),
    setScissor: jest.fn()
  };
}

function createMockFrame(needSceneColor: boolean, device: ReturnType<typeof createMockDevice>) {
  const ctx = {
    device,
    materialFlags: 0,
    SSR: false,
    SSS: false,
    SkinSSSTexture: null,
    SSSDiffuseTexture: null,
    SSSTransmissionTexture: null,
    finalFramebuffer: null,
    intermediateFramebuffer: null,
    sceneColorTexture: null
  };
  const renderQueue = { needSceneColor: () => needSceneColor };
  const frame = {
    ctx,
    renderQueue,
    // A truthy depth attachment: opaque pass keeps clearDepth/clearStencil null.
    depthFramebuffer: { getDepthAttachment: () => ({ id: 'depth' }) }
  };
  return { ctx, renderQueue, frame };
}

function createMockRgCtx() {
  return {
    getFramebuffer: () => ({ id: 'fb' }),
    createFramebuffer: () => ({ id: 'fb-created' }),
    getTexture: () => ({ width: 4, height: 4 }),
    deferCleanup: () => {}
  };
}

describe('Forward+ _scenePass execute state contract', () => {
  const scenePass = _getScenePassForTest() as unknown as RenderSnapshot & {
    render: (...args: unknown[]) => void;
  };
  let originalRender: (...args: unknown[]) => void;
  let renderCalls: RenderSnapshot[];

  beforeEach(() => {
    renderCalls = [];
    originalRender = scenePass.render;
    // Replace render with a snapshotting stub so no GPU work runs.
    scenePass.render = jest.fn(() => {
      renderCalls.push(snapshotScenePass());
    });
    // Seed the shared flags with sentinels so we can prove which fields each
    // pass explicitly sets versus leaves untouched.
    scenePass.transmission = 'SEED' as unknown as boolean;
    scenePass.clearColor = 'SEED';
    scenePass.clearDepth = 'SEED';
    scenePass.clearStencil = 'SEED';
    scenePass.renderOpaque = 'SEED' as unknown as boolean;
    scenePass.renderTransparent = 'SEED' as unknown as boolean;
    scenePass.renderSky = 'SEED' as unknown as boolean;
  });

  afterEach(() => {
    scenePass.render = originalRender;
  });

  test('opaque pass sets transmission/clear/render flags before render and restores after', () => {
    const device = createMockDevice();
    const { frame } = createMockFrame(false, device);
    const rgCtx = createMockRgCtx();

    renderOpaqueScenePass(
      frame as never,
      { width: 1920, height: 1080 } as never,
      null,
      rgCtx as never,
      { name: 'sceneColorFb' } as never
    );

    expect(renderCalls).toHaveLength(1);
    // Depth attachment present → no depth/stencil clear; opaque, non-transmission.
    expect(renderCalls[0]).toMatchObject({
      transmission: false,
      clearDepth: null,
      clearStencil: null,
      renderOpaque: true,
      renderTransparent: false,
      renderSky: false
    });
    // The shared flags are restored so nothing leaks to the next pass.
    expect(scenePass.transmission).toBe(false);
    expect(scenePass.renderTransparent).toBe(true);
    expect(scenePass.renderSky).toBe(true);
    // Device state is saved/restored around the pass.
    expect(device.pushDeviceStates).toHaveBeenCalledTimes(1);
    expect(device.popDeviceStates).toHaveBeenCalledTimes(1);
  });

  test('transparent pass derives transmission from needSceneColor and never clears', () => {
    const device = createMockDevice();
    const { frame } = createMockFrame(false, device);
    const rgCtx = createMockRgCtx();

    renderTransparentScenePass(frame as never, rgCtx as never, null, { name: 'sceneColorFb' } as never);

    expect(renderCalls).toHaveLength(1);
    expect(renderCalls[0]).toEqual({
      transmission: false, // needSceneColor() === false
      clearColor: null,
      clearDepth: null,
      clearStencil: null,
      renderOpaque: false,
      renderTransparent: true,
      renderSky: false
    });
    // renderOpaque restored to true after the transparent draw.
    expect(scenePass.renderOpaque).toBe(true);
    expect(scenePass.renderSky).toBe(true);
    expect(device.pushDeviceStates).toHaveBeenCalledTimes(1);
    expect(device.popDeviceStates).toHaveBeenCalledTimes(1);
  });

  test('transparent pass enables transmission when scene color is needed', () => {
    const device = createMockDevice();
    const { frame } = createMockFrame(true, device);
    const rgCtx = createMockRgCtx();

    renderTransparentScenePass(frame as never, rgCtx as never, null, { name: 'sceneColorFb' } as never);

    expect(renderCalls).toHaveLength(1);
    expect(renderCalls[0]).toMatchObject({
      transmission: true, // needSceneColor() === true
      renderOpaque: false,
      renderTransparent: true,
      renderSky: false
    });
  });

  test('sky pass renders sky and fog directly into the scene target', () => {
    const device = createMockDevice();
    const sky = {
      fogPresents: true,
      renderSky: jest.fn(),
      renderFog: jest.fn()
    };
    const ctx = {
      device,
      camera: { id: 'camera' },
      finalFramebuffer: null,
      scene: { env: { sky } }
    };
    const frame = { ctx };
    const framebuffer = { id: 'scene-color-fb' };
    const rgCtx = {
      ...createMockRgCtx(),
      getFramebuffer: jest.fn(() => framebuffer)
    };

    renderSkyScenePass(frame as never, rgCtx as never, { name: 'sceneColorFb' } as never);

    expect(device.setFramebuffer).toHaveBeenCalledWith(framebuffer);
    expect(device.setViewport).toHaveBeenCalledWith(null);
    expect(device.setScissor).toHaveBeenCalledWith(null);
    expect(sky.renderSky).toHaveBeenCalledWith(ctx);
    expect(sky.renderFog).toHaveBeenCalledWith(ctx.camera);
    expect(renderCalls).toHaveLength(0);
    expect(device.pushDeviceStates).toHaveBeenCalledTimes(1);
    expect(device.popDeviceStates).toHaveBeenCalledTimes(1);
  });
});
