/**
 * Shader-level checks for the water interaction field and the generator that
 * layers it over an ambient wave generator.
 *
 * Nothing here renders. What the shader builder is made to emit for both
 * backends is the code every consumer of the surface ends up with once an
 * interaction is attached - the material, the surface-point query, the
 * caustics - and a mistake there is a compile failure at runtime that no other
 * test catches. The parameter clamps are checked on the CPU side because a
 * wave speed past the CFL bound is a field that explodes, silently, a few
 * seconds in.
 */

import * as api from '../../../libs/scene/src/app/api';
import * as fullscreen from '../../../libs/scene/src/render/fullscreenquad';
import * as misc from '../../../libs/scene/src/utility/misc';
import type { AbstractDevice, PBGlobalScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { ProgramBuilder } from '@zephyr3d/device';
import { AABB, Matrix4x4, Vector3 } from '@zephyr3d/base';
import type { WaveGenerator } from '../../../libs/scene/src/render/wavegenerator';
import type { SceneNode } from '../../../libs/scene/src/scene/scene_node';
import {
  createWaterInteractionObstacleShader,
  createWaterInteractionStepShader,
  InteractiveWaveGenerator,
  WaterDisturber,
  WaterInteraction
} from '../../../libs/scene/src/render/water_interaction';

const DEVICE_TYPES = ['webgpu', 'webgl2'] as const;

function createMockDevice(type: (typeof DEVICE_TYPES)[number]): AbstractDevice {
  return {
    type,
    clipSpaceZeroToOne: type === 'webgpu',
    getDeviceCaps() {
      return {
        shaderCaps: {
          supportShaderF16: false
        }
      };
    }
  } as unknown as AbstractDevice;
}

/**
 * A wave generator with no dependency on the engine's global uniforms, so the
 * program under test needs nothing but what the two generators declare.
 */
function createStubWaveGenerator(): WaveGenerator {
  return {
    version: 0,
    getHash: () => 'stub',
    setupUniforms(scope: PBGlobalScope, group: number) {
      scope.stubParams = scope.$builder.vec4().uniform(group);
    },
    calcVertexPositionAndNormal(
      scope: PBInsideFunctionScope,
      inPos: PBShaderExp,
      outPos: PBShaderExp,
      outNormal: PBShaderExp
    ) {
      const pb = scope.$builder;
      pb.func(
        'stubCalcPositionAndNormal',
        [pb.vec3('inPos'), pb.vec3('outPos').out(), pb.vec3('outNormal').out()],
        function () {
          this.outPos = pb.add(this.inPos, pb.vec3(0, this.stubParams.x, 0));
          this.outNormal = pb.vec3(0, 1, 0);
        }
      );
      scope.stubCalcPositionAndNormal(inPos, outPos, outNormal);
    },
    calcFragmentNormal(scope: PBInsideFunctionScope) {
      const pb = scope.$builder;
      return pb.normalize(pb.vec3(scope.stubParams.y, 1, scope.stubParams.z));
    },
    calcFragmentNormalAndFoam(scope: PBInsideFunctionScope) {
      const pb = scope.$builder;
      return pb.vec4(pb.normalize(pb.vec3(scope.stubParams.y, 1, scope.stubParams.z)), scope.stubParams.w);
    },
    applyWaterBindGroup() {},
    calcClipmapTileAABB(minX: number, maxX: number, minZ: number, maxZ: number, y: number, outAABB: AABB) {
      outAABB.minPoint.setXYZ(minX, y - 1, minZ);
      outAABB.maxPoint.setXYZ(maxX, y + 1, maxZ);
    },
    update() {},
    needUpdate: () => true,
    isOk: () => true,
    dispose() {}
  } as unknown as WaveGenerator;
}

/** Builds a program that evaluates the layered surface the way the material does. */
function buildLayered(type: (typeof DEVICE_TYPES)[number]) {
  const pb = new ProgramBuilder(createMockDevice(type));
  const generator = new InteractiveWaveGenerator(createStubWaveGenerator(), new WaterInteraction());
  return pb.buildRender({
    vertex(pb) {
      this.$inputs.pos = pb.vec3().attrib('position');
      this.$outputs.worldPos = pb.vec3();
      generator.setupUniforms(this, 0);
      pb.main(function () {
        this.$l.p = pb.vec3();
        this.$l.n = pb.vec3();
        generator.calcVertexPositionAndNormal(this, this.$inputs.pos, this.p, this.n);
        this.$outputs.worldPos = this.p;
        this.$builtins.position = pb.vec4(this.p, 1);
      });
    },
    fragment(pb) {
      this.$outputs.color = pb.vec4();
      generator.setupUniforms(this, 0);
      pb.main(function () {
        this.$l.nf = generator.calcFragmentNormalAndFoam(this, this.$inputs.worldPos.xz, pb.vec3(0, 1, 0));
        this.$l.n = generator.calcFragmentNormal(this, this.$inputs.worldPos.xz, pb.vec3(0, 1, 0));
        this.$outputs.color = pb.vec4(pb.add(this.nf.xyz, this.n), this.nf.w);
      });
    }
  });
}

describe('interactive wave generator shader', () => {
  test.each(DEVICE_TYPES)('builds the layered surface on %s', (type) => {
    const ret = buildLayered(type);
    expect(ret).not.toBeNull();
    const [vertexSource, fragmentSource] = ret!;
    // The vertex stage adds the field height on top of the base displacement,
    // sampled with an explicit LOD since there are no derivatives there.
    expect(vertexSource).toContain('stubCalcPositionAndNormal');
    expect(vertexSource).toContain('wiSampleHeight');
    expect(vertexSource).toContain('wiHeightTex');
    expect(vertexSource).not.toMatch(/texture\(\s*wiHeightTex/);
    // The fragment stage tilts the base normal by the field's slope and unions
    // the field's foam trail with the base foam.
    expect(fragmentSource).toContain('wiBlendNormal');
    expect(fragmentSource).toContain('wiSampleGradient');
    expect(fragmentSource).toContain('wiSampleFoam');
    expect(fragmentSource).toContain('stubParams');
  });

  test('hash and version compose the base and the field', () => {
    const base = createStubWaveGenerator();
    const interaction = new WaterInteraction();
    const generator = new InteractiveWaveGenerator(base, interaction);
    expect(generator.getHash()).toBe('stub:WI');
    expect(generator.version).toBe(0);
    expect(generator.base).toBe(base);
    expect(generator.interaction).toBe(interaction);
  });

  test('the bounding box grows by the field amplitude both ways', () => {
    const interaction = new WaterInteraction();
    interaction.maxAmplitude = 0.3;
    const generator = new InteractiveWaveGenerator(createStubWaveGenerator(), interaction);
    const aabb = new AABB();
    generator.calcClipmapTileAABB(-5, 5, -5, 5, 2, aabb);
    expect(aabb.minPoint.y).toBeCloseTo(2 - 1 - 0.3);
    expect(aabb.maxPoint.y).toBeCloseTo(2 + 1 + 0.3);
  });
});

describe('water interaction simulation shaders', () => {
  test.each(DEVICE_TYPES)('builds the step program on %s', (type) => {
    const pb = new ProgramBuilder(createMockDevice(type));
    const ret = pb.buildRender(createWaterInteractionStepShader());
    expect(ret).not.toBeNull();
    const [, fragmentSource] = ret!;
    // Texel fetches, not filtered samples: the stencil reads exact neighbours.
    expect(fragmentSource).not.toMatch(/texture\(\s*srcTex/);
    // Neighbours go through the obstacle test so a wall reflects.
    expect(fragmentSource).toContain('wiNeighbour');
    expect(fragmentSource).toContain('wiObstacle');
    // Both the impulses and the disturbers' footprint change are injected.
    expect(fragmentSource).toContain('impulses');
    expect(fragmentSource).toContain('wiFootprint');
    // Foam is accumulated in the third channel and decays.
    expect(fragmentSource).toContain('foamParams');
  });

  test.each(DEVICE_TYPES)('builds the obstacle program on %s', (type) => {
    const pb = new ProgramBuilder(createMockDevice(type));
    const ret = pb.buildRender(createWaterInteractionObstacleShader());
    expect(ret).not.toBeNull();
    expect(ret![1]).toContain('wiFootprintHard');
  });
});

/** A node stub with just the world matrix the disturber reads. */
function createStubNode(x: number, y: number, z: number): SceneNode {
  return { worldMatrix: Matrix4x4.translationXYZ(x, y, z) } as unknown as SceneNode;
}

describe('water disturber footprints', () => {
  test('a sphere cut by the surface displaces half its column over the cut circle', () => {
    const d = new WaterDisturber(createStubNode(3, 0, -2), 'sphere');
    d.radius = 1;
    d.strength = 0.2;
    d._evaluate(0);
    expect(d._now[0]).toBe(1);
    expect(d._now[1]).toBe(3);
    expect(d._now[2]).toBe(-2);
    expect(d._now[3]).toBeCloseTo(0.1);
    expect(d._now[4]).toBeCloseTo(1);
    // Lifted so only the bottom quarter is wet: the cut circle shrinks.
    d.node = createStubNode(3, 0.5, -2);
    d._evaluate(0);
    expect(d._now[3]).toBeCloseTo(0.05);
    expect(d._now[4]).toBeCloseTo(Math.sqrt(0.75));
    // Clear of the water: nothing.
    d.node = createStubNode(3, 1.5, -2);
    d._evaluate(0);
    expect(d._now[3]).toBe(0);
    expect(d._now[4]).toBe(0);
  });

  test('a shape well below the surface stops disturbing it', () => {
    const d = new WaterDisturber(createStubNode(0, -1.5, 0), 'sphere');
    d.radius = 1;
    d.strength = 0.2;
    // Top at -0.5: fully submerged, still close.
    d._evaluate(0);
    expect(d._now[3]).toBeCloseTo(0.2 * 0.75);
    d.node = createStubNode(0, -5, 0);
    d._evaluate(0);
    expect(d._now[3]).toBe(0);
  });

  test('a blocking box packs its frame and flags itself', () => {
    const d = new WaterDisturber(createStubNode(1, 0, 1), 'box');
    d.size = new Vector3(4, 2, 1);
    d.blocking = true;
    d._evaluate(0);
    expect(d._now[0]).toBe(13);
    expect(d._now[4]).toBeCloseTo(1);
    expect(d._now[5]).toBeCloseTo(0);
    expect(d._now[6]).toBeCloseTo(2);
    expect(d._now[7]).toBeCloseTo(0.5);
    expect(d._now[3]).toBeCloseTo(0.15 * 0.5);
  });

  test('a capsule packs both segment ends', () => {
    const d = new WaterDisturber(createStubNode(2, 0, 2), 'capsule');
    d.radius = 0.5;
    d.halfLength = 3;
    d._evaluate(0);
    expect(d._now[0]).toBe(2);
    // Vertical segment: both ends project to the node's XZ.
    expect(d._now[1]).toBe(2);
    expect(d._now[2]).toBe(2);
    expect(d._now[4]).toBe(2);
    expect(d._now[5]).toBe(2);
    expect(d._now[6]).toBe(0.5);
  });

  test('registration and the first frame', () => {
    const interaction = new WaterInteraction();
    const d = new WaterDisturber(createStubNode(0, 0, 0));
    interaction.addDisturber(d);
    interaction.addDisturber(d);
    expect(interaction.disturbers).toHaveLength(1);
    expect(d._hasPrev).toBe(false);
    interaction.removeDisturber(d);
    expect(interaction.disturbers).toHaveLength(0);
  });
});

describe('water interaction parameters', () => {
  test('wave speed is clamped to what the window can integrate stably', () => {
    const interaction = new WaterInteraction();
    // 64 m over 512 texels is 0.125 m per texel; at 60 steps a second the
    // Courant bound of 0.6 allows 4.5 m/s.
    expect(interaction.texelSize).toBeCloseTo(0.125);
    expect(interaction.maxWaveSpeed).toBeCloseTo(4.5);
    interaction.waveSpeed = 100;
    expect(interaction.waveSpeed).toBeCloseTo(4.5);
    // A finer grid lowers the ceiling and pulls the speed down with it.
    interaction.resolution = 1024;
    expect(interaction.waveSpeed).toBeCloseTo(2.25);
    // A wider window raises it, but a speed already under it is left alone.
    interaction.waveSpeed = 1;
    interaction.windowSize = 128;
    expect(interaction.waveSpeed).toBe(1);
    interaction.waveSpeed = -3;
    expect(interaction.waveSpeed).toBe(0);
  });

  test('the sponge band stays inside the window', () => {
    const interaction = new WaterInteraction();
    interaction.spongeWidth = 2;
    expect(interaction.spongeWidth).toBe(0.45);
    interaction.spongeWidth = 0;
    expect(interaction.spongeWidth).toBe(0.01);
  });

  test('foam parameters are clamped', () => {
    const interaction = new WaterInteraction();
    expect(interaction.foamAmount).toBe(0.15);
    interaction.foamAmount = -1;
    expect(interaction.foamAmount).toBe(0);
    interaction.foamDecay = -2;
    expect(interaction.foamDecay).toBe(0);
    interaction.foamThreshold = 0;
    expect(interaction.foamThreshold).toBeGreaterThan(0);
  });

  test('defaults follow the camera', () => {
    const interaction = new WaterInteraction();
    expect(interaction.followMode).toBe('camera');
    expect(interaction.followNode).toBeNull();
  });
});

describe('external interaction history', () => {
  test('keeps impulses but excludes disturbers across substeps and window movement', () => {
    const values: Record<string, any> = {};
    const draws: Record<string, any>[] = [];
    const renderTextures = [{ id: 'render0' }, { id: 'render1' }];
    const externalTextures = [{ id: 'external0' }, { id: 'external1' }];
    const bindGroup = {
      setValue: (name: string, value: any) => {
        values[name] = value;
      },
      setTexture: (name: string, value: any) => {
        values[name] = value;
      }
    };
    const device = {
      pushDeviceStates() {},
      popDeviceStates() {},
      setProgram() {},
      setBindGroup() {},
      setFramebuffer(fb: unknown) {
        values.framebuffer = fb;
      }
    };
    jest.spyOn(api, 'getDevice').mockReturnValue(device as any);
    jest.spyOn(misc, 'fetchSampler').mockReturnValue({} as any);
    jest.spyOn(fullscreen, 'drawFullscreenQuad').mockImplementation(() => {
      draws.push({ ...values, shift: Array.from(values.shift) });
    });
    try {
      const interaction = new WaterInteraction();
      const field = interaction as any;
      field._formatResolved = true;
      field._format = 'rgba32f';
      field._textures = renderTextures;
      field._externalTextures = externalTextures;
      field._framebuffers = ['render0', 'render1'];
      field._externalFramebuffers = ['external0', 'external1'];
      field._ensureField = () => {};
      field._renderObstacles = () => {};
      field._getProgram = () => ({});
      field._bindGroup = bindGroup;
      interaction.followMode = 'fixed';
      const node = createStubNode(0, 0, 0);
      interaction.addDisturber(new WaterDisturber(node));
      interaction.update(0);
      interaction.addImpulse(0, 0, 1, 0.2);
      interaction.update(1 / 30);
      expect(draws.map((d) => d.numDisturbers)).toEqual([1, 0, 0, 0]);
      expect(draws.map((d) => d.numImpulses)).toEqual([1, 1, 0, 0]);
      expect(draws.map((d) => d.srcTex.id)).toEqual(['render0', 'external0', 'render1', 'external1']);
      expect(draws.map((d) => d.framebuffer)).toEqual(['render1', 'external1', 'render0', 'external0']);
      draws.length = 0;
      interaction.center.x += 4;
      interaction.update(1 / 20);
      expect(draws).toHaveLength(2);
      expect(draws[0].shift).toEqual(draws[1].shift);
      expect(draws[0].shift[0]).not.toBe(0);
      interaction.applyBindGroup(bindGroup as any, false);
      expect(values.wiHeightTex).toBe(externalTextures[1]);
      interaction.applyBindGroup(bindGroup as any);
      expect(values.wiHeightTex).toBe(renderTextures[1]);
    } finally {
      jest.restoreAllMocks();
    }
  });
});
