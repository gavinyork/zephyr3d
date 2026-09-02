import {
  HistoryResourceManager,
  RenderGraph,
  RGHistoryResources,
  FrameResources,
  type RGTextureAllocator,
  type RenderModule
} from '../../../libs/scene/src/render/rendergraph';
import {
  deriveForwardPlusOptions,
  buildForwardPlusGraph,
  createForwardPlusPipeline,
  type ForwardPlusOptions
} from '../../../libs/scene/src/render/rendergraph/forward_plus_builder';
import { AbstractPostEffect, PostEffectLayer } from '../../../libs/scene/src/posteffect/posteffect';
import { Compositor } from '../../../libs/scene/src/posteffect/compositor';
import { SSR } from '../../../libs/scene/src/posteffect/ssr';
import { SSGI } from '../../../libs/scene/src/posteffect/ssgi';

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
  const {
    camera: cameraOverrides,
    device: deviceOverrides,
    ...restOverrides
  } = overrides as {
    camera?: Record<string, unknown>;
    device?: Record<string, unknown>;
  } & Record<string, unknown>;
  return {
    device: {
      type: 'webgpu',
      getDeviceCaps: () => ({
        framebufferCaps: {
          maxDrawBuffers: 8,
          maxColorAttachmentBytesPerSample: 32,
          supportPerTargetBlending: true
        },
        textureCaps: {
          supportHalfFloatColorBuffer: true,
          getTextureFormatInfo: (format: string) => ({
            size: getMockTextureFormatSize(format)
          })
        }
      }),
      ...deviceOverrides
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
  waters?: unknown[];
}

function createMockRenderQueue(options: MockRenderQueueOptions) {
  return {
    shadowedLights: options.shadowedLights ?? [],
    // Culled water surfaces; the WaterCaustics module reads this to decide
    // whether it has anything to build a map from.
    waters: options.waters ?? [],
    needSceneColor: () => options.needSceneColor
  } as any;
}

function createOptions(overrides: Partial<ForwardPlusOptions> = {}): ForwardPlusOptions {
  return {
    depthPrepass: true,
    motionVectors: false,
    hiZ: false,
    sceneNormal: false,
    sceneRoughness: false,
    shadowMask: false,
    ssr: false,
    ssgi: false,
    ssrCalcThickness: false,
    gpuPicking: false,
    needSceneColor: false,
    needSceneColorWithDepth: false,
    needsTransmissionDepthForSSR: false,
    sss: false,
    skinSSS: false,
    fogPresents: false,
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
  test('removing DepthPrepass from the pipeline fails with a clear error', () => {
    const pipeline = createForwardPlusPipeline().remove('DepthPrepass');
    const graph = new RenderGraph();

    expect(() =>
      buildForwardPlusGraph(
        graph,
        createMockDrawContext({ camera: { renderPipeline: pipeline } }),
        createMockRenderQueue({ needSceneColor: false }),
        createOptions()
      )
    ).toThrow(/requires module "DepthPrepass"/);
  });

  test('omits TransmissionDepth when scene color copy is not needed', () => {
    const passNames = compileForwardPlusPassNames(createOptions({ needSceneColor: false }));

    expect(passNames).toContain('LightPass');
    expect(passNames).toContain('Blit');
    expect(passNames).not.toContain('TransmissionDepth');
    expect(passNames.indexOf('LightPass')).toBeLessThan(passNames.indexOf('Blit'));
  });

  test('inserts TransmissionDepth between LightPass and Blit when scene color copy is needed without SSR prepass', () => {
    const passNames = compileForwardPlusPassNames(createOptions({ needSceneColor: true }));

    expect(passNames).toContain('LightPass');
    expect(passNames).toContain('TransmissionDepth');
    expect(passNames).toContain('Blit');
    expect(passNames.indexOf('LightPass')).toBeLessThan(passNames.indexOf('TransmissionDepth'));
    expect(passNames.indexOf('TransmissionDepth')).toBeLessThan(passNames.indexOf('Blit'));
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
    expect(passNames.indexOf('TransmissionDepth')).toBeLessThan(passNames.indexOf('Blit'));
  });

  test('models TransmissionDepth as a versioned write of the linear depth texture', () => {
    const { graph, backbuffer } = buildForwardPlusGraphForTest(
      createOptions({
        needSceneColor: true,
        needsTransmissionDepthForSSR: false
      })
    );
    graph.compile([backbuffer]);

    const transmissionPass = graph.passes.find((pass) => pass.name === 'TransmissionDepth')!;
    expect(transmissionPass).toBeDefined();
    // The pass reads the prepass linear depth and writes a new version of it.
    const depthRead = transmissionPass.reads.find((res) => res.name === 'linearDepth');
    expect(depthRead).toBeDefined();
    const depthWrite = transmissionPass.writes.find((res) => res.physicalId === depthRead!.physicalId);
    expect(depthWrite).toBeDefined();
    expect(depthWrite!.id).not.toBe(depthRead!.id);
  });

  test('models TransmissionDepthForSSR as a versioned write consumed by later depth readers', () => {
    const { graph, backbuffer } = buildForwardPlusGraphForTest(
      createOptions({
        needSceneColor: true,
        ssr: true,
        hiZ: true,
        needsTransmissionDepthForSSR: true
      })
    );
    graph.compile([backbuffer]);

    const transmissionPass = graph.passes.find((pass) => pass.name === 'TransmissionDepthForSSR')!;
    expect(transmissionPass).toBeDefined();
    const depthRead = transmissionPass.reads.find((res) => res.name === 'linearDepth');
    expect(depthRead).toBeDefined();
    const depthWrite = transmissionPass.writes.find((res) => res.physicalId === depthRead!.physicalId);
    expect(depthWrite).toBeDefined();
    // Later depth readers consume the post-transmission version, giving them a
    // real data dependency instead of relying on the ordering token.
    for (const passName of ['HiZ', 'LightPass']) {
      const pass = graph.passes.find((p) => p.name === passName)!;
      expect(pass.reads).toContain(depthWrite);
      expect(pass.reads).not.toContain(depthRead);
    }
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

    expect(deriveForwardPlusOptions(scene as any, camera as any, 'webgpu', renderQueue as any).skinSSS).toBe(
      true
    );

    renderQueue.itemList.opaque = emptyBundle;
    renderQueue.itemList.transmission = {
      lit: [{ materialList: new Set([{ skinSSS: true }]) }],
      unlit: []
    };

    expect(deriveForwardPlusOptions(scene as any, camera as any, 'webgpu', renderQueue as any).skinSSS).toBe(
      false
    );
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

  test('inserts SSSProfile before LightPass and declares SSS MRT resources when enabled', () => {
    const { graph, backbuffer } = buildForwardPlusGraphForTest(
      createOptions({ sss: true, sceneNormal: true })
    );
    const passNames = graph.compile([backbuffer]).orderedPasses.map((pass) => pass.name);
    const lightPass = graph.passes.find((pass) => pass.name === 'LightPass');

    expect(passNames).toContain('SSSProfile');
    expect(passNames).toContain('LightPass');
    expect(passNames.indexOf('SSSProfile')).toBeLessThan(passNames.indexOf('LightPass'));
    expect(lightPass?.reads.map((resource) => resource.name)).toEqual(
      expect.arrayContaining(['sssProfile', 'sssParam'])
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
        sceneNormal: true,
        sceneRoughness: true,
        needSceneColor: true,
        needSceneColorWithDepth: true
      }),
      {},
      {
        colorFormat: 'rgba16f',
        SceneRoughnessTexture: { format: 'rgba16f' },
        SceneNormalTexture: { format: 'rgba16f' }
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

    // The order is the point, not just the membership. The sky writes at the far
    // plane across everything the opaque pass left empty, so a blended surface
    // in front of background has to come after it to replace what it wrote -
    // reversed, the sky would erase the velocity of every blended pixel that has
    // nothing opaque behind it.
    expect(depthPass?.subpasses.map((subpass) => subpass.name)).toEqual([
      'SceneDepth',
      'SkyMotionVectors',
      'TransparentMotionVectors'
    ]);
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

  test('declares compatible SSGI irradiance and surface history as LightPass reads', () => {
    const allocator: RGTextureAllocator<any> = {
      allocate: (_desc, _size) => ({}),
      release: () => {}
    };
    const historyManager = new HistoryResourceManager(allocator);
    const size = { width: 1920, height: 1080 };
    historyManager.beginFrame();
    for (const name of [RGHistoryResources.SSGI_IRRADIANCE, RGHistoryResources.SSGI_SURFACE]) {
      historyManager.queueCommit(
        name,
        {
          format: 'rgba16f',
          sizeMode: 'absolute',
          width: size.width,
          height: size.height
        },
        size,
        { id: name }
      );
    }
    historyManager.commitFrame();

    const { graph } = buildForwardPlusGraphForTest(
      createOptions({ ssgi: true }),
      {},
      {
        camera: {
          ssgiResolvedSettings: {
            halfRes: false,
            raysPerPixel: 2,
            maxSteps: 64,
            denoisePasses: 3
          },
          getHistoryResourceManager: () => historyManager
        }
      }
    );

    const lightPass = graph.passes.find((pass) => pass.name === 'LightPass');
    expect(lightPass?.reads.map((resource) => resource.name)).toEqual(
      expect.arrayContaining([
        `history:${RGHistoryResources.SSGI_IRRADIANCE}:previous`,
        `history:${RGHistoryResources.SSGI_SURFACE}:previous`
      ])
    );
  });

  test('derives SSGI only when both camera and IBL opt in', () => {
    const envLight = {
      hasRadiance: () => true,
      hasIrradiance: () => true
    };
    const scene = {
      env: {
        light: {
          type: 'ibl',
          envLight
        }
      }
    };
    const camera = {
      SSGI: true,
      HDR: true,
      ssgiIntensity: 0.7,
      SSR: false,
      SSS: false,
      skinSSS: false,
      ssrCalcThickness: false,
      getPickResultResolveFunc: () => null
    };
    const renderQueue = {
      needSceneColor: () => false,
      needSceneColorWithDepth: () => false,
      itemList: { opaque: { lit: [], unlit: [] } }
    };

    expect(deriveForwardPlusOptions(scene as any, camera as any, 'webgpu', renderQueue as any).ssgi).toBe(
      true
    );
    camera.HDR = false;
    expect(deriveForwardPlusOptions(scene as any, camera as any, 'webgpu', renderQueue as any).ssgi).toBe(
      false
    );
    camera.HDR = true;
    camera.ssgiIntensity = 0;
    expect(deriveForwardPlusOptions(scene as any, camera as any, 'webgpu', renderQueue as any).ssgi).toBe(
      false
    );
  });

  test('builds SSGI trace, temporal, a-trous and commit before transparent rendering', () => {
    const allocator: RGTextureAllocator<any> = {
      allocate: (_desc, _size) => ({}),
      release: () => {},
      retain: () => {}
    };
    const historyManager = new HistoryResourceManager(allocator);
    const compositor = new Compositor();
    compositor.appendPostEffect(new SSGI());

    const { graph, backbuffer } = buildForwardPlusGraphForTest(
      createOptions({ ssgi: true, motionVectors: true, hiZ: true, sceneNormal: true }),
      {},
      {
        compositor,
        camera: {
          HDR: true,
          ssgiTemporal: true,
          ssgiResolvedSettings: {
            halfRes: false,
            raysPerPixel: 2,
            maxSteps: 64,
            denoisePasses: 3
          },
          getHistoryResourceManager: () => historyManager
        }
      }
    );
    const passNames = graph.compile([backbuffer]).orderedPasses.map((pass) => pass.name);

    for (const name of [
      'SSGI:Trace',
      'SSGI:Surface',
      'SSGI:Temporal',
      'SSGI:ATrous:0',
      'SSGI:ATrous:1',
      'SSGI:ATrous:2',
      'SSGI:Commit'
    ]) {
      expect(passNames).toContain(name);
    }
    expect(passNames.indexOf('LightPass')).toBeLessThan(passNames.indexOf('SSGI:Trace'));
    expect(passNames.indexOf('SSGI:Trace')).toBeLessThan(passNames.indexOf('SSGI:Temporal'));
    expect(passNames.indexOf('SSGI:Temporal')).toBeLessThan(passNames.indexOf('SSGI:ATrous:0'));
    expect(passNames.indexOf('SSGI:Commit')).toBeLessThan(passNames.indexOf('TransparentPass'));
  });

  test('traces and commits history against the fog-free scene color when fog is present', () => {
    const allocator: RGTextureAllocator<any> = {
      allocate: (_desc, _size) => ({}),
      release: () => {},
      retain: () => {}
    };
    const historyManager = new HistoryResourceManager(allocator);
    const compositor = new Compositor();
    compositor.appendPostEffect(new SSGI());

    const { graph, backbuffer } = buildForwardPlusGraphForTest(
      createOptions({
        ssgi: true,
        motionVectors: true,
        hiZ: true,
        sceneNormal: true,
        fogPresents: true
      }),
      {},
      {
        compositor,
        camera: {
          HDR: true,
          ssgiTemporal: true,
          ssgiResolvedSettings: {
            halfRes: false,
            raysPerPixel: 2,
            maxSteps: 64,
            denoisePasses: 3
          },
          getHistoryResourceManager: () => historyManager
        }
      }
    );
    graph.compile([backbuffer]);

    // A traced hit reads this as surface radiance, and fog along the camera ray
    // is not part of the path SSGI integrates.
    const skyPass = graph.passes.find((pass) => pass.name === 'SkyPass');
    expect(skyPass?.writes.some((res) => res.name === 'sceneColorNoFog')).toBe(true);
    const tracePass = graph.passes.find((pass) => pass.name === 'SSGI:Trace');
    expect(tracePass?.reads.some((res) => res.name === 'sceneColorNoFog')).toBe(true);
    // The committed history must match what the trace sampled, or the current
    // and previous frames disagree and the result flickers.
    const commitPass = graph.passes.find((pass) => pass.name === 'SSGI:Commit');
    expect(commitPass?.reads.some((res) => res.name === 'sceneColorNoFog')).toBe(true);
  });

  test.each([
    ['half-float render targets', false, 8, 32],
    ['two draw buffers', true, 1, 32],
    ['the MRT byte budget', true, 8, 8]
  ])('falls back to IBL when SSGI lacks %s', (_reason, halfFloat, maxDrawBuffers, maxBytes) => {
    const compositor = new Compositor();
    compositor.appendPostEffect(new SSGI());
    const { graph, backbuffer } = buildForwardPlusGraphForTest(
      createOptions({ ssgi: true }),
      {},
      {
        compositor,
        device: {
          getDeviceCaps: () => ({
            framebufferCaps: {
              maxDrawBuffers,
              maxColorAttachmentBytesPerSample: maxBytes,
              supportPerTargetBlending: true
            },
            textureCaps: {
              supportHalfFloatColorBuffer: halfFloat,
              getTextureFormatInfo: (format: string) => ({
                size: getMockTextureFormatSize(format)
              })
            }
          })
        }
      }
    );

    const passNames = graph.compile([backbuffer]).orderedPasses.map((pass) => pass.name);
    expect(passNames).not.toContain('SSGI:Trace');
  });

  test('declares compatible TAA history imports as TAA pass reads', () => {
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

    const { TAA } = require('../../../libs/scene/src/posteffect/taa');
    const compositor = new Compositor();
    compositor.appendPostEffect(new TAA());
    const { graph } = buildForwardPlusGraphForTest(
      createOptions({ motionVectors: true }),
      {},
      {
        compositor,
        camera: {
          TAA: true,
          getHistoryResourceManager: () => historyManager
        }
      }
    );

    const taaPass = graph.passes.find((pass) => pass.name === 'PostEffect:TAA');
    expect(taaPass).toBeDefined();
    expect(taaPass?.reads.map((resource) => resource.name)).toEqual(
      expect.arrayContaining([
        `history:${RGHistoryResources.TAA_COLOR}:previous`,
        `history:${RGHistoryResources.TAA_MOTION_VECTOR}:previous`
      ])
    );
    // TAA requires the scene depth attachment, so it never writes the final
    // target directly — its output must stay a readable graph texture for the
    // history commit.
    expect(taaPass?.writes.some((resource) => resource.name.startsWith('backbuffer@'))).toBe(false);
    expect(graph.passes.some((pass) => pass.name === 'Blit')).toBe(true);
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

    const { TAA } = require('../../../libs/scene/src/posteffect/taa');
    const compositor = new Compositor();
    compositor.appendPostEffect(new TAA());
    const { graph } = buildForwardPlusGraphForTest(
      createOptions({ motionVectors: true }),
      {},
      {
        compositor,
        camera: {
          TAA: true,
          getHistoryResourceManager: () => historyManager
        }
      }
    );

    const taaPass = graph.passes.find((pass) => pass.name === 'PostEffect:TAA');
    expect(taaPass).toBeDefined();
    expect(taaPass?.reads.map((resource) => resource.name)).not.toEqual(
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
    expect(passNames).not.toContain('Blit');
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

  test('lets a plain end-layer effect direct-write even when camera TAA is enabled', () => {
    // TAA history commits are owned by the TAA effect itself (committing its
    // own resolve output), so other chain-tail effects keep the direct-write
    // fast path regardless of camera.TAA.
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
    expect(passNames).not.toContain('Blit');
    const effectPass = graph.passes.find((pass) => pass.name === 'PostEffect:EffectA');
    expect(effectPass?.writes.some((res) => res.name.startsWith('backbuffer@'))).toBe(true);
  });

  test('keeps the Blit pass when no end-layer effect is enabled', () => {
    const effect = new EffectA();
    effect.enabled = false;
    const { graph, backbuffer } = buildForwardPlusGraphForTest(
      createOptions(),
      {},
      { compositor: createCompositor([effect]) }
    );
    const passNames = graph.compile([backbuffer]).orderedPasses.map((pass) => pass.name);

    expect(passNames).toContain('Blit');
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
    expect(passNames).not.toContain('Blit');
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

describe('Bloom native multi-pass setup', () => {
  test('expands bloom into prefilter/downsample/upsample/compose passes', () => {
    const { Bloom } = require('../../../libs/scene/src/posteffect/bloom');
    const bloom = new Bloom();
    const compositor = new Compositor();
    compositor.appendPostEffect(bloom);
    const { graph, backbuffer } = buildForwardPlusGraphForTest(createOptions(), {}, { compositor });
    const passNames = graph.compile([backbuffer]).orderedPasses.map((pass) => pass.name);

    // 1920x1080 -> prefilter 960x540 -> pyramid 480x270, 240x135, 120x67, 60x33 (4 levels)
    expect(passNames).toContain('Bloom:Prefilter');
    expect(passNames).toContain('Bloom:Downsample0');
    expect(passNames).toContain('Bloom:Downsample3');
    expect(passNames).toContain('Bloom:Upsample2');
    expect(passNames).toContain('Bloom:Upsample0');
    expect(passNames).toContain('Bloom:Compose');
    expect(passNames.indexOf('LightPass')).toBeLessThan(passNames.indexOf('Bloom:Prefilter'));
    expect(passNames.indexOf('Bloom:Prefilter')).toBeLessThan(passNames.indexOf('Bloom:Downsample0'));
    expect(passNames.indexOf('Bloom:Downsample3')).toBeLessThan(passNames.indexOf('Bloom:Upsample2'));
    expect(passNames.indexOf('Bloom:Upsample0')).toBeLessThan(passNames.indexOf('Bloom:Compose'));

    // Compose takes the direct final write (bloom is the last enabled effect)
    const composePass = graph.passes.find((pass) => pass.name === 'Bloom:Compose');
    expect(composePass?.writes.some((res) => res.name.startsWith('backbuffer@'))).toBe(true);

    // Upsample passes write new versions of the downsample level textures
    const upsamplePass = graph.passes.find((pass) => pass.name === 'Bloom:Upsample0');
    expect(upsamplePass?.writes.some((res) => res.name.startsWith('Bloom:downsample0@'))).toBe(true);
  });

  test('declares absolute pyramid sizes matching the legacy runtime math', () => {
    const { Bloom } = require('../../../libs/scene/src/posteffect/bloom');
    const bloom = new Bloom();
    const compositor = new Compositor();
    compositor.appendPostEffect(bloom);
    const { graph } = buildForwardPlusGraphForTest(createOptions(), {}, { compositor });

    const prefilter = [...graph.resources.values()].find((res) => res.name === 'Bloom:prefilter');
    expect(prefilter?.desc).toMatchObject({ sizeMode: 'absolute', width: 960, height: 540 });
    const level0 = [...graph.resources.values()].find((res) => res.name === 'Bloom:downsample0');
    expect(level0?.desc).toMatchObject({ sizeMode: 'absolute', width: 480, height: 270 });
    const level3 = [...graph.resources.values()].find((res) => res.name === 'Bloom:downsample3');
    expect(level3?.desc).toMatchObject({ sizeMode: 'absolute', width: 60, height: 33 });
  });
});

describe('SceneColorGrab pass (P2)', () => {
  test('extracts the refraction background grab as its own pass before LightPass', () => {
    const passNames = compileForwardPlusPassNames(createOptions({ needSceneColor: true }));

    expect(passNames).toContain('SceneColorGrab');
    expect(passNames.indexOf('DepthPrepass')).toBeLessThan(passNames.indexOf('SceneColorGrab'));
    expect(passNames.indexOf('SceneColorGrab')).toBeLessThan(passNames.indexOf('LightPass'));
  });

  test('omits the grab pass when scene color is not needed', () => {
    const passNames = compileForwardPlusPassNames(createOptions({ needSceneColor: false }));

    expect(passNames).not.toContain('SceneColorGrab');
  });

  test('LightPass reads the grab output', () => {
    const { graph, backbuffer } = buildForwardPlusGraphForTest(createOptions({ needSceneColor: true }));
    graph.compile([backbuffer]);
    const lightPass = graph.passes.find((pass) => pass.name === 'LightPass');

    expect(lightPass?.reads.map((res) => res.name)).toContain('sceneColorCopy');
  });
});

describe('TransparentPass split (P2-S2)', () => {
  test('splits transparent geometry into its own pass writing a scene color version', () => {
    const { graph, backbuffer } = buildForwardPlusGraphForTest(createOptions({ needSceneColor: true }));
    const passNames = graph.compile([backbuffer]).orderedPasses.map((pass) => pass.name);

    expect(passNames).toContain('TransparentPass');
    expect(passNames.indexOf('LightPass')).toBeLessThan(passNames.indexOf('TransparentPass'));
    expect(passNames.indexOf('TransparentPass')).toBeLessThan(passNames.indexOf('TransmissionDepth'));
    const transparentPass = graph.passes.find((pass) => pass.name === 'TransparentPass');
    expect(transparentPass?.writes.some((res) => res.name.startsWith('sceneColor@'))).toBe(true);
  });
});

describe('SkyPass split', () => {
  test('renders opaque geometry and sky as separate ordered graph passes', () => {
    const { graph, backbuffer } = buildForwardPlusGraphForTest(createOptions());
    const passNames = graph.compile([backbuffer]).orderedPasses.map((pass) => pass.name);

    expect(passNames).toContain('LightPass');
    expect(passNames).toContain('SkyPass');
    expect(passNames.indexOf('LightPass')).toBeLessThan(passNames.indexOf('SkyPass'));
    expect(passNames.indexOf('SkyPass')).toBeLessThan(passNames.indexOf('TransparentPass'));

    const lightPass = graph.passes.find((pass) => pass.name === 'LightPass');
    const skyPass = graph.passes.find((pass) => pass.name === 'SkyPass');
    expect(skyPass?.reads).toContain(lightPass?.writes.find((resource) => resource.name === 'sceneColor'));
    expect(skyPass?.writes.some((resource) => resource.name.startsWith('sceneColor@SkyPass'))).toBe(true);
  });
});

describe('SSR native multi-pass setup (P3-S3)', () => {
  function buildWithSSR(cameraOverrides: Record<string, unknown>) {
    const compositor = new Compositor();
    compositor.appendPostEffect(new SSR());
    return buildForwardPlusGraphForTest(
      createOptions({ ssr: true, sceneNormal: true, sceneRoughness: true }),
      {},
      {
        compositor,
        SSR: true,
        camera: {
          ssrTemporal: false,
          ssrBlurScale: 0,
          ssrBlurKernelSize: 0,
          ...cameraOverrides
        }
      }
    );
  }

  test('declares intersect/resolve/combine as individual graph passes', () => {
    const { graph, backbuffer } = buildWithSSR({});
    const passNames = graph.compile([backbuffer]).orderedPasses.map((pass) => pass.name);

    for (const name of ['SSR:Intersect', 'SSR:Resolve', 'PostEffect:SSR']) {
      expect(passNames).toContain(name);
    }
    expect(passNames.indexOf('LightPass')).toBeLessThan(passNames.indexOf('SSR:Intersect'));
    expect(passNames.indexOf('SSR:Intersect')).toBeLessThan(passNames.indexOf('SSR:Resolve'));
    expect(passNames.indexOf('SSR:Resolve')).toBeLessThan(passNames.indexOf('PostEffect:SSR'));
    expect(passNames.indexOf('PostEffect:SSR')).toBeLessThan(passNames.indexOf('TransparentPass'));
    // Blur disabled: no blur pass
    expect(passNames).not.toContain('SSR:Blur');
    expect(passNames).not.toContain('SSR:Temporal');
  });

  test('scene roughness/normal MRT outputs are graph textures owned by LightPass (P3-S4)', () => {
    const { graph, backbuffer } = buildWithSSR({});
    graph.compile([backbuffer]);
    const lightPass = graph.passes.find((pass) => pass.name === 'LightPass');

    expect(lightPass?.writes.some((res) => res.name === 'sceneRoughness')).toBe(true);
    expect(lightPass?.writes.some((res) => res.name === 'sceneNormal')).toBe(true);
    // Effect passes must read them so lifetimes cover the whole opaque chain
    const intersectPass = graph.passes.find((pass) => pass.name === 'SSR:Intersect');
    expect(intersectPass?.reads.some((res) => res.name === 'sceneRoughness')).toBe(true);
    expect(intersectPass?.reads.some((res) => res.name === 'sceneNormal')).toBe(true);
  });

  test('inserts the bilateral blur pass when enabled', () => {
    const { graph, backbuffer } = buildWithSSR({ ssrBlurScale: 1, ssrBlurKernelSize: 5 });
    const passNames = graph.compile([backbuffer]).orderedPasses.map((pass) => pass.name);

    expect(passNames).toContain('SSR:Blur');
    expect(passNames.indexOf('SSR:Resolve')).toBeLessThan(passNames.indexOf('SSR:Blur'));
    expect(passNames.indexOf('SSR:Blur')).toBeLessThan(passNames.indexOf('PostEffect:SSR'));
  });

  test('resolves reflections from the fog-free scene color when fog is present', () => {
    const compositor = new Compositor();
    compositor.appendPostEffect(new SSR());
    const { graph, backbuffer } = buildForwardPlusGraphForTest(
      createOptions({ ssr: true, sceneNormal: true, sceneRoughness: true, fogPresents: true }),
      {},
      {
        compositor,
        SSR: true,
        camera: { ssrTemporal: false, ssrBlurScale: 0, ssrBlurKernelSize: 0 }
      }
    );
    graph.compile([backbuffer]);

    // Fog is composited after the snapshot, so reflections must not pick it up
    // and apply it a second time over the final image.
    const skyPass = graph.passes.find((pass) => pass.name === 'SkyPass');
    expect(skyPass?.writes.some((res) => res.name === 'sceneColorNoFog')).toBe(true);
    const resolvePass = graph.passes.find((pass) => pass.name === 'SSR:Resolve');
    expect(resolvePass?.reads.some((res) => res.name === 'sceneColorNoFog')).toBe(true);
  });

  test('allocates no fog-free copy when the scene has no fog', () => {
    const { graph, backbuffer } = buildWithSSR({});
    graph.compile([backbuffer]);

    const skyPass = graph.passes.find((pass) => pass.name === 'SkyPass');
    expect(skyPass?.writes.some((res) => res.name === 'sceneColorNoFog')).toBe(false);
  });
});

describe('Opaque-layer effect chain (P2-S3)', () => {
  class OpaqueEffect extends AbstractPostEffect {
    constructor() {
      super();
      this._layer = PostEffectLayer.opaque;
    }
    requireDepthAttachment() {
      return true;
    }
  }

  test('builds opaque-layer effects between LightPass and TransparentPass', () => {
    const compositor = new Compositor();
    compositor.appendPostEffect(new OpaqueEffect());
    const { graph, backbuffer } = buildForwardPlusGraphForTest(createOptions(), {}, { compositor });
    const passNames = graph.compile([backbuffer]).orderedPasses.map((pass) => pass.name);

    expect(passNames).toContain('PostEffect:OpaqueEffect');
    expect(passNames.indexOf('LightPass')).toBeLessThan(passNames.indexOf('PostEffect:OpaqueEffect'));
    expect(passNames.indexOf('PostEffect:OpaqueEffect')).toBeLessThan(passNames.indexOf('TransparentPass'));
    // Transparent geometry writes a new version of the chain output
    const transparentPass = graph.passes.find((pass) => pass.name === 'TransparentPass');
    expect(transparentPass?.writes.some((res) => res.name.startsWith('PostEffect:OpaqueEffect:out@'))).toBe(
      true
    );
    // Depth-requiring opaque effects never take the direct final write
    const effectPass = graph.passes.find((pass) => pass.name === 'PostEffect:OpaqueEffect');
    expect(effectPass?.writes.some((res) => res.name.startsWith('backbuffer@'))).toBe(false);
  });

  test('TransparentPass writes the scene color version directly when no opaque effect runs', () => {
    const compositor = new Compositor();
    const { graph, backbuffer } = buildForwardPlusGraphForTest(createOptions(), {}, { compositor });
    graph.compile([backbuffer]);
    const transparentPass = graph.passes.find((pass) => pass.name === 'TransparentPass');

    expect(transparentPass?.writes.some((res) => res.name.startsWith('sceneColor@'))).toBe(true);
  });
});

describe('Final framebuffer as intermediate (editor render-to-texture mode)', () => {
  function createExternalDepthContext() {
    const depthTex = {
      isTexture2D: () => true,
      width: 1920,
      height: 1080,
      format: 'd24s8'
    };
    return {
      finalFramebuffer: {
        getDepthAttachment: () => depthTex,
        getColorAttachments: () => [{ format: 'rgba8unorm', width: 1920, height: 1080 }]
      }
    };
  }

  test('publishes an external depth texture as an imported frame resource', () => {
    const depthConsumer: RenderModule<any> = {
      type: 'ExternalDepthConsumer',
      reads: [{ resource: FrameResources.SceneDepthAttachment, version: 'current' }],
      prepare: () => ({ enabled: true }),
      setup(context) {
        const depth = context.blackboard.expect(FrameResources.SceneDepthAttachment);
        context.graph.addPass('ExternalDepthConsumer', (builder) => {
          builder.read(depth);
          builder.sideEffect();
        });
      }
    };
    const pipeline = createForwardPlusPipeline().insertAfter('DepthPrepass', depthConsumer);
    const graph = new RenderGraph();
    buildForwardPlusGraph(
      graph,
      createMockDrawContext({ camera: { renderPipeline: pipeline }, ...createExternalDepthContext() }),
      createMockRenderQueue({ needSceneColor: false }),
      createOptions()
    );

    const read = graph.passes.find((pass) => pass.name === 'ExternalDepthConsumer')?.reads[0];
    expect(read?.name).toBe('externalSceneDepth');
    expect(read?.kind).toBe('imported');
  });

  test('keeps LightPass alive when the scene renders directly into the final framebuffer', () => {
    const { graph, backbuffer } = buildForwardPlusGraphForTest(
      createOptions(),
      {},
      createExternalDepthContext()
    );
    const passNames = graph.compile([backbuffer]).orderedPasses.map((pass) => pass.name);

    // Regression: with the backbuffer as chain input, nothing read the scene
    // color handle and dead-pass culling removed the light pass (black frame).
    expect(passNames).toContain('LightPass');
    expect(passNames).toContain('TransparentPass');
    // P3-S2: the physical backbuffer write is declared on the graph — the
    // LightPass survives through the real version chain, not keep-alive reads.
    const lightPass = graph.passes.find((pass) => pass.name === 'LightPass');
    expect(lightPass?.writes.some((res) => res.name.startsWith('backbuffer'))).toBe(true);
    const transparentPass = graph.passes.find((pass) => pass.name === 'TransparentPass');
    expect(transparentPass?.writes.some((res) => res.name.startsWith('backbuffer'))).toBe(true);
  });

  test('keeps LightPass alive with an end-layer effect in render-to-texture mode', () => {
    class GizmoLikeEffect extends AbstractPostEffect {
      requireDepthAttachment() {
        return true;
      }
    }
    const compositor = new Compositor();
    compositor.appendPostEffect(new GizmoLikeEffect());
    const { graph, backbuffer } = buildForwardPlusGraphForTest(
      createOptions(),
      {},
      {
        compositor,
        ...createExternalDepthContext()
      }
    );
    const passNames = graph.compile([backbuffer]).orderedPasses.map((pass) => pass.name);

    expect(passNames).toContain('LightPass');
    expect(passNames).toContain('PostEffect:GizmoLikeEffect');
    expect(passNames.indexOf('LightPass')).toBeLessThan(passNames.indexOf('PostEffect:GizmoLikeEffect'));
  });

  test('sole effect never direct-writes the final target it samples (feedback loop)', () => {
    // Regression: in render-to-texture mode the scene physically lives in the
    // final framebuffer. A single end-layer effect (e.g. Tonemap in the editor
    // material preview) sampled that texture while direct-writing it — a
    // WebGPU synchronization-scope error / WebGL feedback loop.
    class TonemapLikeEffect extends AbstractPostEffect {}
    const compositor = new Compositor();
    compositor.appendPostEffect(new TonemapLikeEffect());
    const { graph, backbuffer } = buildForwardPlusGraphForTest(
      createOptions(),
      {},
      {
        compositor,
        ...createExternalDepthContext()
      }
    );
    const passNames = graph.compile([backbuffer]).orderedPasses.map((pass) => pass.name);

    // The effect must write an intermediate texture, then Blit copies it back.
    const effectPass = graph.passes.find((pass) => pass.name === 'PostEffect:TonemapLikeEffect');
    expect(effectPass?.writes.some((res) => res.name.startsWith('backbuffer'))).toBe(false);
    expect(effectPass?.writes.some((res) => res.name === 'PostEffect:TonemapLikeEffect:out')).toBe(true);
    expect(passNames).toContain('Blit');
    expect(passNames.indexOf('PostEffect:TonemapLikeEffect')).toBeLessThan(passNames.indexOf('Blit'));
  });

  test('second chained effect may still direct-write the final target', () => {
    // With two effects the first moves the image into an intermediate texture,
    // so the last effect's direct final write is safe again.
    class EffectA extends AbstractPostEffect {}
    class EffectB extends AbstractPostEffect {}
    const compositor = new Compositor();
    compositor.appendPostEffect(new EffectA());
    compositor.appendPostEffect(new EffectB());
    const { graph, backbuffer } = buildForwardPlusGraphForTest(
      createOptions(),
      {},
      {
        compositor,
        ...createExternalDepthContext()
      }
    );
    graph.compile([backbuffer]);

    const effectB = graph.passes.find((pass) => pass.name === 'PostEffect:EffectB');
    expect(effectB?.writes.some((res) => res.name.startsWith('backbuffer'))).toBe(true);
  });

  test('opaque-layer effects disable final-framebuffer-as-intermediate mode', () => {
    // Regression: with an opaque-layer effect (e.g. SkinSSS) in render-to-texture
    // mode, the scene was still rendered directly into the single-color final
    // framebuffer (breaking surface MRT stores) while the effect chain read the
    // backbuffer handle. The scene must go through the scene color texture.
    class OpaqueEffect extends AbstractPostEffect {
      constructor() {
        super();
        this._layer = PostEffectLayer.opaque;
      }
      requireDepthAttachment() {
        return true;
      }
    }
    const compositor = new Compositor();
    compositor.appendPostEffect(new OpaqueEffect());
    const { graph, backbuffer } = buildForwardPlusGraphForTest(
      createOptions({ skinSSS: true }),
      {},
      {
        compositor,
        ...createExternalDepthContext()
      }
    );
    const passNames = graph.compile([backbuffer]).orderedPasses.map((pass) => pass.name);

    expect(passNames).toContain('LightPass');
    expect(passNames).toContain('PostEffect:OpaqueEffect');
    expect(passNames).toContain('TransparentPass');
    // The chain input must be the scene color texture, not the backbuffer
    const effectPass = graph.passes.find((pass) => pass.name === 'PostEffect:OpaqueEffect');
    expect(effectPass?.reads.some((res) => res.name.startsWith('sceneColor'))).toBe(true);
    expect(effectPass?.reads.some((res) => res.name === 'backbuffer')).toBe(false);
    // LightPass renders into the graph scene color framebuffer, not the final one
    const lightPass = graph.passes.find((pass) => pass.name === 'LightPass');
    expect(lightPass?.writes.some((res) => res.name.startsWith('backbuffer@'))).toBe(false);
    // Transparent geometry renders on top of the chain output
    const transparentPass = graph.passes.find((pass) => pass.name === 'TransparentPass');
    expect(transparentPass?.writes.some((res) => res.name.startsWith('PostEffect:OpaqueEffect:out@'))).toBe(
      true
    );
  });
});

describe('Forward+ pipeline customization', () => {
  function compilePipelinePassNames(
    pipeline: unknown,
    options: ForwardPlusOptions = createOptions()
  ): string[] {
    const graph = new RenderGraph();
    const backbuffer = buildForwardPlusGraph(
      graph,
      createMockDrawContext({ camera: { renderPipeline: pipeline } }),
      createMockRenderQueue({ needSceneColor: options.needSceneColor }),
      options
    );
    return graph.compile([backbuffer]).orderedPasses.map((pass) => pass.name);
  }

  test('default pipeline reproduces the built-in pass set (parity)', () => {
    // No camera.renderPipeline → the shared default pipeline is used, which must
    // match a direct build.
    const direct = compileForwardPlusPassNames(createOptions());
    const viaDefault = compilePipelinePassNames(createForwardPlusPipeline());
    expect(viaDefault).toEqual(direct);
    expect(viaDefault).toContain('LightPass');
    expect(viaDefault).toContain('TransparentPass');
    expect(viaDefault).toContain('Blit');
  });

  test('a custom module inserted after LightPass adds its pass to the built graph', () => {
    const customModule: RenderModule = {
      type: 'MyCustom',
      prepare: () => ({ enabled: true }),
      setup(context) {
        context.graph.addPass('MyCustomPass', (builder) => {
          builder.read(context.blackboard.expect(FrameResources.LinearDepth));
          builder.sideEffect();
          builder.setExecute(() => {});
        });
      }
    };
    const pipeline = createForwardPlusPipeline().insertAfter('LightPass', customModule);
    const names = compilePipelinePassNames(pipeline);
    expect(names).toContain('MyCustomPass');
    expect(names).toContain('LightPass');
  });

  test('collects a module requirement before setup and produces only the requested surface MRT', () => {
    const customModule: RenderModule = {
      type: 'NormalConsumer',
      prepare: () => ({ enabled: true, requirements: { sceneNormal: true } }),
      setup(context) {
        context.graph.addPass('NormalConsumerPass', (builder) => {
          builder.read(context.blackboard.expect(FrameResources.SceneNormal));
          builder.sideEffect();
        });
      }
    };
    const pipeline = createForwardPlusPipeline().insertAfter('LightPass', customModule);
    const graph = new RenderGraph();
    buildForwardPlusGraph(
      graph,
      createMockDrawContext({ camera: { renderPipeline: pipeline } }),
      createMockRenderQueue({ needSceneColor: false }),
      createOptions()
    );
    const lightPassWrites = graph.passes
      .find((pass) => pass.name === 'LightPass')
      ?.writes.map((resource) => resource.name);

    expect(lightPassWrites).toContain('sceneNormal');
    expect(lightPassWrites).not.toContain('sceneRoughness');
    expect(graph.passes.find((pass) => pass.name === 'NormalConsumerPass')?.reads[0]?.name).toBe(
      'sceneNormal'
    );
  });

  test('LightPass consumes the latest ShadowMask version published through the blackboard', () => {
    const replacement: RenderModule = {
      type: 'ShadowMaskReplacement',
      prepare: () => ({ enabled: true }),
      setup(context) {
        const replacementMask = context.graph.addPass('ShadowMaskReplacementPass', (builder) =>
          builder.createTexture({ format: 'rgba8unorm', label: 'replacementShadowMask', arrayLayers: 1 })
        );
        context.blackboard.set(FrameResources.ShadowMask, replacementMask);
      }
    };
    const pipeline = createForwardPlusPipeline().insertBefore('LightPass', replacement);
    const graph = new RenderGraph();
    buildForwardPlusGraph(
      graph,
      createMockDrawContext({ camera: { renderPipeline: pipeline } }),
      createMockRenderQueue({ needSceneColor: false, shadowedLights: [{}] }),
      createOptions({ shadowMask: true })
    );
    const lightPassReads = graph.passes
      .find((pass) => pass.name === 'LightPass')
      ?.reads.map((resource) => resource.name);

    expect(lightPassReads).toContain('replacementShadowMask');
    expect(lightPassReads).not.toContain('shadowMask');
  });

  test('pre-light scene passes read ShadowMask before rendering shaded scene copies', () => {
    const { graph } = buildForwardPlusGraphForTest(
      createOptions({ shadowMask: true, needSceneColor: true, sss: true, sceneNormal: true }),
      { needSceneColor: true, shadowedLights: [{}] }
    );

    for (const passName of ['SceneColorGrab', 'SSSProfile']) {
      const reads = graph.passes
        .find((pass) => pass.name === passName)
        ?.reads.map((resource) => resource.name);
      expect(reads).toContain('shadowMask');
    }
  });

  test('TransparentPass reads ShadowMask so it outlives LightPass', () => {
    // Transparent geometry samples the mask through the same clustered-light
    // bind group as the opaque pass. Resource lifetimes are derived purely from
    // declared reads (RenderGraph.compile) and the executor hands a texture back
    // to the pool at lastUse, so an undeclared read here would let the mask be
    // recycled after LightPass while TransparentPass is still sampling it.
    // Inheriting ctx.shadowMaskTexture from LightPass's execute made that
    // invisible - it happened to hold the right texture, so nothing looked wrong.
    const { graph } = buildForwardPlusGraphForTest(
      createOptions({ shadowMask: true, needSceneColor: true }),
      { needSceneColor: true, shadowedLights: [{}] }
    );

    const reads = graph.passes
      .find((pass) => pass.name === 'TransparentPass')
      ?.reads.map((resource) => resource.name);
    expect(reads).toContain('shadowMask');
  });

  test('CompositeTail consumes a SceneColor version written after LightPass', () => {
    const customModule: RenderModule = {
      type: 'SceneColorOverride',
      prepare: () => ({ enabled: true }),
      setup(context) {
        const input = context.blackboard.expect(FrameResources.SceneColor);
        const output = context.graph.addPass('SceneColorOverridePass', (builder) => {
          builder.read(input);
          return builder.write(input);
        });
        context.blackboard.set(FrameResources.SceneColor, output);
      }
    };
    const pipeline = createForwardPlusPipeline().insertAfter('LightPass', customModule);
    const names = compilePipelinePassNames(pipeline);

    expect(names).toContain('SceneColorOverridePass');
    expect(names.indexOf('LightPass')).toBeLessThan(names.indexOf('SceneColorOverridePass'));
    expect(names.indexOf('SceneColorOverridePass')).toBeLessThan(names.indexOf('TransparentPass'));
  });

  test('removing a built-in module drops its pass, leaving the rest intact', () => {
    const pipeline = createForwardPlusPipeline().remove('SkyUpdate');
    const names = compilePipelinePassNames(pipeline);
    expect(names).not.toContain('SkyUpdate');
    expect(names).toContain('LightPass');
    expect(names).toContain('Blit');
  });
});

describe('Forward+ frame-resource requirements', () => {
  class ResourceConsumer extends AbstractPostEffect {
    requireMotionVectorTexture() {
      return true;
    }
    requireHiZTexture() {
      return true;
    }
    requireSceneNormalTexture() {
      return true;
    }
    requireSceneRoughnessTexture() {
      return true;
    }
  }

  function buildWithEffect(
    effect: AbstractPostEffect,
    options: ForwardPlusOptions = createOptions(),
    drawContextOverrides: Record<string, unknown> = {}
  ) {
    const compositor = new Compositor();
    compositor.appendPostEffect(effect);
    return buildForwardPlusGraphForTest(options, {}, { compositor, ...drawContextOverrides });
  }

  test('enabled effects automatically produce their declared frame resources', () => {
    const { graph, backbuffer } = buildWithEffect(new ResourceConsumer());
    const lightPass = graph.passes.find((pass) => pass.name === 'LightPass');
    const depthPass = graph.passes.find((pass) => pass.name === 'DepthPrepass');
    const passNames = graph.compile([backbuffer]).orderedPasses.map((pass) => pass.name);

    expect(depthPass?.subpasses.map((subpass) => subpass.name)).toContain('SkyMotionVectors');
    expect(passNames).toContain('HiZ');
    expect(lightPass?.writes.map((resource) => resource.name)).toEqual(
      expect.arrayContaining(['sceneNormal', 'sceneRoughness'])
    );
  });

  test('reports an unavailable backend resource during graph build', () => {
    expect(() =>
      buildWithEffect(
        new (class extends AbstractPostEffect {
          requireHiZTexture() {
            return true;
          }
        })(),
        createOptions(),
        { device: { type: 'webgl' } }
      )
    ).toThrow(/HiZ was requested/);
  });

  test('validates unsupported resources enabled directly through pipeline options', () => {
    expect(() =>
      buildForwardPlusGraphForTest(
        createOptions({ motionVectors: true }),
        {},
        {
          device: { type: 'webgl' }
        }
      )
    ).toThrow(/MotionVector was requested/);
  });

  test('reports a missing producer when a required module is removed', () => {
    const pipeline = createForwardPlusPipeline().remove('HiZ');
    const effect = new (class extends AbstractPostEffect {
      requireHiZTexture() {
        return true;
      }
    })();
    expect(() =>
      buildForwardPlusGraph(
        new RenderGraph(),
        createMockDrawContext({
          compositor: (() => {
            const compositor = new Compositor();
            compositor.appendPostEffect(effect);
            return compositor;
          })(),
          camera: { renderPipeline: pipeline }
        }),
        createMockRenderQueue({ needSceneColor: false }),
        createOptions()
      )
    ).toThrow(/frame resource "hiZ"/);
  });

  test('reports a missing shadow-mask producer when shadowed lights need it', () => {
    const pipeline = createForwardPlusPipeline().remove('ShadowMaskPass');
    const effect = new (class extends AbstractPostEffect {
      requireShadowMask() {
        return true;
      }
    })();
    const compositor = new Compositor();
    compositor.appendPostEffect(effect);

    expect(() =>
      buildForwardPlusGraph(
        new RenderGraph(),
        createMockDrawContext({ compositor, camera: { renderPipeline: pipeline } }),
        createMockRenderQueue({ needSceneColor: false, shadowedLights: [{}] }),
        createOptions()
      )
    ).toThrow(/frame resource "shadowMask"/);
  });
});
