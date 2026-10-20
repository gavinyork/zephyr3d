import { createNullDevice, type NullDevice } from '@zephyr3d/backend-null';
import { Vector2, Vector3, Vector4 } from '@zephyr3d/base';
import type { Texture2D } from '@zephyr3d/device';
import { CopyBlitter } from '@zephyr3d/scene';
import * as api from '../../../libs/scene/src/app/api';
import {
  TerrainErosionCompute,
  type TerrainErosionMode
} from '../../../utility/editor/src/views/edittools/brushes/erosioncompute';
import { HydraulicErosionBrush } from '../../../utility/editor/src/views/edittools/brushes/hydraulicerosion';
import { WindErosionBrush } from '../../../utility/editor/src/views/edittools/brushes/winderosion';

jest.mock('@zephyr3d/imgui', () => ({ ImGui: {} }));

describe('terrain erosion compute', () => {
  // Blitter caches its primitive globally, so all successful stamps share one device.
  let device: NullDevice;
  beforeAll(async () => {
    device = await createNullDevice({ type: 'webgpu', strict: true });
  });

  beforeEach(() => {
    device.clearCommands();
    jest.spyOn(api, 'getDevice').mockReturnValue(device as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([HydraulicErosionBrush, WindErosionBrush])(
    'preserves %p state across render frames and brush movement until the stroke ends',
    (BrushClass) => {
      let now = 0;
      jest.spyOn(performance, 'now').mockImplementation(() => now);
      const apply = jest.spyOn(TerrainErosionCompute.prototype, 'apply').mockReturnValue(true);
      const invalidate = jest.spyOn(TerrainErosionCompute.prototype, 'invalidate');
      const dispose = jest.spyOn(TerrainErosionCompute.prototype, 'dispose');
      const heightMap = device.createTexture2D('r16f', 64, 48, { mipmapping: false });
      const brush = new BrushClass();
      const paint = (center = new Vector2(32, 24)) =>
        brush.applyCompute(
          heightMap,
          null,
          new Vector4(0, 0, 64, 48),
          new Vector3(1, 12, 1),
          center,
          8,
          0.75,
          0
        );

      // Starting an untouched brush allocates no compute resources.
      brush.beginStroke();
      brush.beginStroke();
      expect(invalidate).not.toHaveBeenCalled();
      expect(paint()).toBe(true);
      expect(apply).toHaveBeenCalledTimes(1);

      now = 16;
      expect(paint()).toBe(false);
      expect(apply).toHaveBeenCalledTimes(1);
      now = 34;
      const movedCenter = new Vector2(36, 27);
      expect(paint(movedCenter)).toBe(true);
      expect(apply).toHaveBeenLastCalledWith(expect.objectContaining({ brushCenter: movedCenter }));
      brush.beginStroke();
      expect(invalidate).not.toHaveBeenCalled();

      // Catch-up is bounded when rendering stalls, retaining the same live simulation.
      const beforeStall = apply.mock.calls.length;
      now = 5000;
      expect(paint()).toBe(true);
      expect(apply.mock.calls.length - beforeStall).toBeLessThanOrEqual(2);
      expect(invalidate).not.toHaveBeenCalled();

      brush.endStroke();
      brush.endStroke();
      expect(invalidate).toHaveBeenCalledTimes(1);
      brush.beginStroke();
      expect(invalidate).toHaveBeenCalledTimes(2);
      expect(paint()).toBe(true);
      brush.dispose();
      expect(invalidate).toHaveBeenCalledTimes(3);
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(heightMap.disposed).toBe(false);
      heightMap.dispose();
    }
  );

  test('retains runoff and sediment across hydraulic batches and reprojects them when the brush moves', () => {
    const blits = jest.spyOn(CopyBlitter.prototype, 'blit');
    const groups = jest.spyOn(device, 'createBindGroup');
    const programs = jest.spyOn(device, 'buildComputeProgram');
    const heightMap = device.createTexture2D('r16f', 256, 192, { mipmapping: false });
    const erosion = new TerrainErosionCompute(device as any);
    const params = {
      mode: 'hydraulic' as const,
      heightMap,
      mask: null,
      region: new Vector4(0, 0, 256, 192),
      scale: new Vector3(1, 12, 1),
      brushCenter: new Vector2(96, 80),
      brushSize: 8,
      brushStrength: 0.75,
      brushRotation: 0,
      iterations: 3
    };
    const imports = () => blits.mock.calls.filter(([source]) => source === heightMap);
    const commandLabels = () =>
      device
        .getCommands('compute')
        .map((command) => command.program?.bindGroupLayouts[0].label?.replace(/\[0\]$/, ''));
    const findGroup = (label: string) => {
      const index = groups.mock.calls.findIndex(([layout]) => layout.label === `${label}[0]`);
      expect(index).toBeGreaterThanOrEqual(0);
      return groups.mock.results[index].value;
    };

    expect(erosion.apply(params)).toBe(true);
    expect(commandLabels()).toEqual([
      'HydraulicImport',
      'HydraulicRunoff',
      'HydraulicStreamPower',
      'HydraulicIncision',
      'HydraulicRunoff',
      'HydraulicStreamPower',
      'HydraulicIncision',
      'HydraulicRunoff',
      'HydraulicStreamPower',
      'HydraulicIncision',
      'HydraulicPublish'
    ]);
    expect(imports()).toHaveLength(1);
    const working = imports()[0][1] as Texture2D;
    expect([working.format, working.width, working.height]).toEqual(['r32f', 256, 192]);
    const importer = findGroup('HydraulicImport');
    const importValues = jest.spyOn(importer, 'setValue');
    const runoff = findGroup('HydraulicRunoff');
    const streamPower = findGroup('HydraulicStreamPower');
    const incision = findGroup('HydraulicIncision');
    const publish = findGroup('HydraulicPublish');
    const state0 = runoff.getTexture('stateIn');
    const state1 = incision.getTexture('stateOut');
    const flux0 = runoff.getTexture('flux0Out');
    const flux1 = runoff.getTexture('flux1Out');
    const catchment0 = runoff.getTexture('area0Out');
    const catchment1 = runoff.getTexture('area1Out');
    const rate = streamPower.getTexture('incisionOut');
    expect([rate.format, rate.width, rate.height]).toEqual(['r32f', state0.width, state0.height]);
    expect(incision.getTexture('incisionIn')).toBe(rate);
    const output = publish.getTexture('heightOut');
    const white = runoff.getTexture('mask');
    const previousState = publish.getTexture('stateIn');
    expect(previousState).toBe(state1);

    device.clearCommands();
    expect(erosion.apply(params)).toBe(true);
    expect(commandLabels()).not.toContain('HydraulicImport');
    expect(imports()).toHaveLength(1);
    // Three more steps continue the ping-pong parity from the previous batch.
    expect(publish.getTexture('stateIn')).toBe(state0);
    expect(state0.disposed).toBe(false);
    expect(state1.disposed).toBe(false);

    device.clearCommands();
    expect(erosion.apply({ ...params, brushCenter: new Vector2(128, 80) })).toBe(true);
    expect(commandLabels()[0]).toBe('HydraulicImport');
    expect(imports()).toHaveLength(1);
    expect(importer.getTexture('heightMap')).toBe(working);
    expect(importer.getTexture('previousState')).toBe(state0);
    expect(importValues).toHaveBeenCalledWith('source', expect.objectContaining({ w: 1 }));
    expect(
      [state0, state1, flux0, flux1, catchment0, catchment1, rate, output].every(
        (texture) => texture.disposed
      )
    ).toBe(true);
    expect(working.disposed).toBe(false);

    erosion.invalidate();
    importValues.mockClear();
    device.clearCommands();
    expect(erosion.apply(params)).toBe(true);
    expect(commandLabels()[0]).toBe('HydraulicImport');
    expect(imports()).toHaveLength(2);
    expect(importValues).toHaveBeenCalledWith('source', expect.objectContaining({ w: 0 }));
    const liveTextures = [
      runoff.getTexture('stateIn'),
      incision.getTexture('stateOut'),
      runoff.getTexture('flux0Out'),
      runoff.getTexture('flux1Out'),
      runoff.getTexture('area0Out'),
      runoff.getTexture('area1Out'),
      streamPower.getTexture('incisionOut'),
      publish.getTexture('heightOut')
    ];
    erosion.dispose();
    expect(liveTextures.every((texture) => texture.disposed)).toBe(true);
    expect(working.disposed).toBe(true);
    expect(white.disposed).toBe(true);
    const computeGroups = groups.mock.results
      .filter((_, index) => groups.mock.calls[index][0].label?.startsWith('Hydraulic'))
      .map((result) => result.value);
    expect(computeGroups.every((group) => group.disposed)).toBe(true);
    expect(programs.mock.results.every((result) => result.value.disposed)).toBe(true);
    expect(heightMap.disposed).toBe(false);
    heightMap.dispose();
  });

  test('retains airborne sand across wind batches and reprojects it when the brush moves', () => {
    const blits = jest.spyOn(CopyBlitter.prototype, 'blit');
    const groups = jest.spyOn(device, 'createBindGroup');
    const programs = jest.spyOn(device, 'buildComputeProgram');
    const heightMap = device.createTexture2D('r16f', 256, 192, { mipmapping: false });
    const erosion = new TerrainErosionCompute(device as any);
    const params = {
      mode: 'wind' as const,
      heightMap,
      mask: null,
      region: new Vector4(0, 0, 256, 192),
      scale: new Vector3(1, 12, 1),
      brushCenter: new Vector2(96, 80),
      brushSize: 12,
      brushStrength: 0.75,
      brushRotation: 0,
      iterations: 3
    };
    const imports = () => blits.mock.calls.filter(([source]) => source === heightMap);
    const labels = () =>
      device
        .getCommands('compute')
        .map((command) => command.program?.bindGroupLayouts[0].label?.replace(/\[0\]$/, ''));
    const findGroup = (label: string) => {
      const index = groups.mock.calls.findIndex(([layout]) => layout.label === `${label}[0]`);
      expect(index).toBeGreaterThanOrEqual(0);
      return groups.mock.results[index].value;
    };

    expect(erosion.apply(params)).toBe(true);
    expect(labels()).toEqual([
      'WindImport',
      'WindTransport',
      'WindExchange',
      'WindTransport',
      'WindExchange',
      'WindTransport',
      'WindExchange',
      'WindPublish'
    ]);
    expect(imports()).toHaveLength(1);
    const working = imports()[0][1] as Texture2D;
    expect([working.format, working.width, working.height]).toEqual(['r32f', 256, 192]);
    const importer = findGroup('WindImport');
    const importValues = jest.spyOn(importer, 'setValue');
    const transport = findGroup('WindTransport');
    const exchange = findGroup('WindExchange');
    const publish = findGroup('WindPublish');
    const state0 = transport.getTexture('stateIn');
    const state1 = exchange.getTexture('stateOut');
    const flux = transport.getTexture('fluxOut');
    const output = publish.getTexture('heightOut');
    const white = transport.getTexture('mask');
    expect(exchange.getTexture('fluxIn')).toBe(flux);
    expect(publish.getTexture('stateIn')).toBe(state1);

    device.clearCommands();
    expect(erosion.apply(params)).toBe(true);
    expect(labels()).not.toContain('WindImport');
    expect(imports()).toHaveLength(1);
    expect(publish.getTexture('stateIn')).toBe(state0);
    expect([state0, state1, flux, output].every((texture) => !texture.disposed)).toBe(true);

    device.clearCommands();
    expect(erosion.apply({ ...params, brushCenter: new Vector2(128, 80) })).toBe(true);
    expect(labels()[0]).toBe('WindImport');
    expect(imports()).toHaveLength(1);
    expect(importer.getTexture('heightMap')).toBe(working);
    expect(importer.getTexture('previousState')).toBe(state0);
    expect(importValues).toHaveBeenCalledWith('source', expect.objectContaining({ w: 1 }));
    expect([state0, state1, flux, output].every((texture) => texture.disposed)).toBe(true);

    erosion.invalidate();
    importValues.mockClear();
    expect(erosion.apply(params)).toBe(true);
    expect(imports()).toHaveLength(2);
    expect(importValues).toHaveBeenCalledWith('source', expect.objectContaining({ w: 0 }));
    const liveTextures = [
      transport.getTexture('stateIn'),
      exchange.getTexture('stateOut'),
      transport.getTexture('fluxOut'),
      publish.getTexture('heightOut')
    ];
    erosion.dispose();
    expect(liveTextures.every((texture) => texture.disposed)).toBe(true);
    expect(working.disposed).toBe(true);
    expect(white.disposed).toBe(true);
    const computeGroups = groups.mock.results
      .filter((_, index) => groups.mock.calls[index][0].label?.startsWith('Wind'))
      .map((result) => result.value);
    expect(computeGroups.every((group) => group.disposed)).toBe(true);
    expect(programs.mock.results.every((result) => result.value.disposed)).toBe(true);
    expect(heightMap.disposed).toBe(false);
    heightMap.dispose();
  });

  test.each(['hydraulic', 'wind'] as const)(
    'reimports %s state when terrain dimensions, region or height scale change',
    (mode) => {
      const blits = jest.spyOn(CopyBlitter.prototype, 'blit');
      const groups = jest.spyOn(device, 'createBindGroup');
      const erosion = new TerrainErosionCompute(device as any);
      const heightMap = device.createTexture2D('r16f', 128, 96, { mipmapping: false });
      const replacement = device.createTexture2D('r16f', 64, 48, { mipmapping: false });
      const params = {
        mode,
        heightMap,
        mask: null,
        region: new Vector4(0, 0, 128, 96),
        scale: new Vector3(1, 12, 1),
        brushCenter: new Vector2(64, 48),
        brushSize: 8,
        brushStrength: 0.75,
        brushRotation: 0,
        iterations: 1
      };
      expect(erosion.apply(params)).toBe(true);
      const importLabel = mode === 'hydraulic' ? 'HydraulicImport[0]' : 'WindImport[0]';
      const importerIndex = groups.mock.calls.findIndex(([layout]) => layout.label === importLabel);
      const importer = groups.mock.results[importerIndex].value;
      const importValues = jest.spyOn(importer, 'setValue');
      const initialWorking = blits.mock.calls.find(([source]) => source === heightMap)[1] as Texture2D;
      expect(erosion.apply({ ...params, scale: new Vector3(1, 24, 1) })).toBe(true);
      expect(importValues).toHaveBeenCalledWith('source', expect.objectContaining({ z: 24, w: 0 }));
      expect(blits.mock.calls.filter(([source]) => source === heightMap)).toHaveLength(2);

      importValues.mockClear();
      expect(
        erosion.apply({ ...params, scale: new Vector3(1, 24, 1), region: new Vector4(0, 0, 256, 96) })
      ).toBe(true);
      expect(importValues).toHaveBeenCalledWith('source', expect.objectContaining({ w: 0 }));
      expect(blits.mock.calls.filter(([source]) => source === heightMap)).toHaveLength(3);

      importValues.mockClear();
      expect(erosion.apply({ ...params, heightMap: replacement })).toBe(true);
      expect(importValues).toHaveBeenCalledWith('source', expect.objectContaining({ w: 0 }));
      const replacementWorking = blits.mock.calls.find(([source]) => source === replacement)[1] as Texture2D;
      expect([replacementWorking.width, replacementWorking.height]).toEqual([64, 48]);
      expect(initialWorking.disposed).toBe(true);
      erosion.dispose();
      expect(replacementWorking.disposed).toBe(true);
      expect(heightMap.disposed).toBe(false);
      expect(replacement.disposed).toBe(false);
      heightMap.dispose();
      replacement.dispose();
    }
  );

  test.each<TerrainErosionMode>(['thermal'])(
    'builds and dispatches the %s simulation on WebGPU',
    async (mode) => {
      const erosion = new TerrainErosionCompute(device as any);
      const heightMap = device.createTexture2D('r32f', 64, 48, { mipmapping: false });
      const mask = device.createTexture2D('rgba8unorm', 16, 16, { mipmapping: false });
      const iterations = 3;

      expect(
        erosion.apply({
          mode,
          heightMap,
          mask,
          region: new Vector4(0, 0, 64, 48),
          scale: new Vector3(1, 12, 1),
          brushCenter: new Vector2(32, 24),
          brushSize: 8,
          brushStrength: 0.75,
          brushRotation: Math.PI / 6,
          iterations
        })
      ).toBe(true);

      const commands = device.getCommands('compute');
      expect(commands).toHaveLength(2 + iterations * 2);
      const programs = [...new Set(commands.map((command) => command.program))];
      expect(programs).toHaveLength(4);
      const [init, flux, update, resolve] = programs;
      expect(commands.map((command) => command.program)).toEqual([
        init,
        flux,
        update,
        flux,
        update,
        flux,
        update,
        resolve
      ]);
      for (const program of programs) {
        expect(program?.getShaderSource('compute')).toContain('@compute');
      }
      // A centered 16x16 brush plus its halo occupies only part of the 64x48 height map.
      expect(
        commands.every((command) => command.workgroupCount[0] < 8 && command.workgroupCount[1] < 6)
      ).toBe(true);

      erosion.dispose();
      heightMap.dispose();
      mask.dispose();
    }
  );

  test.each([
    { mode: 'thermal' as const, size: [8, 14], viewport: [16, 29, 8, 14] },
    { mode: 'wind' as const, size: [38, 34], viewport: [1, 14, 38, 34] }
  ])('maps an off-centre nonsquare $mode ROI to both writeback viewports', ({ mode, size, viewport }) => {
    const originalBlit = CopyBlitter.prototype.blit;
    const calls: { source: Texture2D; dest: Texture2D; viewport: number[]; scissor: number[] }[] = [];
    jest.spyOn(CopyBlitter.prototype, 'blit').mockImplementation(function (this: CopyBlitter, ...args) {
      calls.push({
        source: args[0] as Texture2D,
        dest: args[1] as Texture2D,
        viewport: this.viewport?.slice() ?? null,
        scissor: this.scissor?.slice() ?? null
      });
      return originalBlit.apply(this, args);
    });
    const erosion = new TerrainErosionCompute(device as any);
    const heightMap = device.createTexture2D('r16f', 64, 48, { mipmapping: false });
    expect(
      erosion.apply({
        mode,
        heightMap,
        mask: null,
        region: new Vector4(0, 0, 128, 48),
        scale: new Vector3(1, 12, 1),
        brushCenter: new Vector2(40, 12),
        brushSize: 8,
        brushStrength: 1,
        brushRotation: 0,
        iterations: 1
      })
    ).toBe(true);

    expect(calls).toHaveLength(3);
    const [importHeight, writeWorking, writeTerrain] = calls;
    expect(importHeight.source).toBe(heightMap);
    expect(importHeight.viewport).toBeNull();
    expect(importHeight.scissor).toBeNull();
    expect(writeWorking.dest).toBe(importHeight.dest);
    expect(writeTerrain.dest).toBe(heightMap);
    expect(writeTerrain.source).toBe(writeWorking.source);
    expect([writeTerrain.source.width, writeTerrain.source.height]).toEqual(size);
    for (const writeback of [writeWorking, writeTerrain]) {
      // Texture-space rows are flipped to the device's bottom-origin viewport.
      expect(writeback.viewport).toEqual(viewport);
      expect(writeback.scissor).toEqual(viewport);
    }
    erosion.dispose();
    heightMap.dispose();
  });

  test('preserves full precision between stamps, invalidates external edits and releases its resources', async () => {
    const blits = jest.spyOn(CopyBlitter.prototype, 'blit');
    const textures = jest.spyOn(device, 'createTexture2D');
    const groups = jest.spyOn(device, 'createBindGroup');
    const programs = jest.spyOn(device, 'buildComputeProgram');
    const heightMap = device.createTexture2D('r16f', 64, 48, { mipmapping: false });
    const erosion = new TerrainErosionCompute(device as any);
    const params = {
      mode: 'thermal' as const,
      heightMap,
      mask: null,
      region: new Vector4(0, 0, 64, 48),
      scale: new Vector3(1, 12, 1),
      brushCenter: new Vector2(32, 24),
      brushSize: 8,
      brushStrength: 0.75,
      brushRotation: 0,
      iterations: 2
    };
    const imports = () => blits.mock.calls.filter(([source]) => source === heightMap);
    const localTextures = () =>
      textures.mock.results
        .map((result) => result.value as Texture2D)
        .filter((texture) => texture.name.startsWith('TerrainErosion') && texture !== working);

    expect(erosion.apply(params)).toBe(true);
    expect(imports()).toHaveLength(1);
    const working = imports()[0][1] as Texture2D;
    expect([working.format, working.width, working.height]).toEqual(['r32f', 64, 48]);
    const initGroupIndex = groups.mock.calls.findIndex(
      ([layout]) => layout.label === 'TerrainErosionInit[0]'
    );
    const initGroup = groups.mock.results[initGroupIndex].value;
    const defaultMask = initGroup.getTexture('mask');
    expect(initGroup.getTexture('heightMap')).toBe(working);
    const firstLocalTextures = localTextures();
    expect(firstLocalTextures).toHaveLength(4);

    device.clearCommands();
    expect(erosion.apply(params)).toBe(true);
    expect(imports()).toHaveLength(1);
    expect(device.getCommandCount('draw')).toBe(2);
    expect(initGroup.getTexture('heightMap')).toBe(working);

    erosion.invalidate();
    device.clearCommands();
    expect(erosion.apply(params)).toBe(true);
    expect(imports()).toHaveLength(2);
    expect(imports()[1][1]).toBe(working);
    expect(device.getCommandCount('draw')).toBe(3);

    // A different brush footprint recreates local storage without quantizing the cached height map.
    device.clearCommands();
    expect(erosion.apply({ ...params, brushSize: 16 })).toBe(true);
    expect(imports()).toHaveLength(2);
    expect(device.getCommandCount('draw')).toBe(2);
    expect(initGroup.getTexture('heightMap')).toBe(working);
    expect(working.disposed).toBe(false);
    expect(firstLocalTextures.every((texture) => texture.disposed)).toBe(true);
    expect(localTextures().filter((texture) => !texture.disposed)).toHaveLength(4);

    const computeGroups = groups.mock.results
      .filter((_, index) => groups.mock.calls[index][0].label?.startsWith('TerrainErosion'))
      .map((result) => result.value);
    erosion.dispose();
    expect(working.disposed).toBe(true);
    expect(defaultMask.disposed).toBe(true);
    expect(localTextures().every((texture) => texture.disposed)).toBe(true);
    expect(computeGroups.every((group) => group.disposed)).toBe(true);
    expect(programs.mock.results.every((result) => result.value.disposed)).toBe(true);
    expect(heightMap.disposed).toBe(false);
    heightMap.dispose();
  });

  test('rejects unsupported devices and invalid brush input without dispatching', async () => {
    const webgl = await createNullDevice({ type: 'webgl2', strict: true });
    const webglErosion = new TerrainErosionCompute(webgl as any);
    const heightMap = webgl.createTexture2D('r32f', 16, 16, { mipmapping: false });
    const mask = webgl.createTexture2D('rgba8unorm', 4, 4, { mipmapping: false });
    const params = {
      mode: 'hydraulic' as const,
      heightMap,
      mask,
      region: new Vector4(0, 0, 16, 16),
      scale: new Vector3(1, 1, 1),
      brushCenter: new Vector2(8, 8),
      brushSize: 4,
      brushStrength: 1,
      brushRotation: 0,
      iterations: 1
    };

    expect(TerrainErosionCompute.isSupported(webgl as any)).toBe(false);
    expect(webglErosion.apply(params)).toBe(false);
    expect(webgl.getCommandCount('compute')).toBe(0);

    const webgpu = await createNullDevice({ type: 'webgpu', strict: true });
    jest.spyOn(api, 'getDevice').mockReturnValue(webgpu as any);
    const webgpuErosion = new TerrainErosionCompute(webgpu as any);
    const gpuHeightMap = webgpu.createTexture2D('r32f', 16, 16, { mipmapping: false });
    const gpuMask = webgpu.createTexture2D('rgba8unorm', 4, 4, { mipmapping: false });
    expect(
      webgpuErosion.apply({
        ...params,
        heightMap: gpuHeightMap,
        mask: gpuMask,
        brushSize: Number.POSITIVE_INFINITY
      })
    ).toBe(false);
    expect(webgpu.getCommandCount('compute')).toBe(0);

    webglErosion.dispose();
    webgpuErosion.dispose();
    heightMap.dispose();
    mask.dispose();
    gpuHeightMap.dispose();
    gpuMask.dispose();
  });
});
