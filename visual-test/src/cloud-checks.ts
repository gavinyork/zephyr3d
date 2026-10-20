import { Matrix4x4, Vector4 } from '@zephyr3d/base';
import type { BindGroup, GPUProgram, Texture2D, Texture3D } from '@zephyr3d/device';
import { getDevice } from '@zephyr3d/scene';
// Use the renderer's built modules so these checks share its device and density implementation.
import {
  CLOUD_COVERAGE_BASE_RANGE,
  cloudCoverageThreshold,
  cloudHeightProfile,
  cloudSampleDensity,
  getCloudParamsStruct
} from '@zephyr3d/scene/dist/render/volumetric_cloud/cloud_common.js';
import { VolumetricCloudResources } from '@zephyr3d/scene/dist/render/volumetric_cloud/resources.js';

type Check = { name: string; passed: boolean; details: unknown };
type DensityCase = {
  coverage: number;
  strength: number;
  erosion: number;
  bottom: number;
  height: number;
  formation: 'connected' | 'isolated';
  baseVariation?: number;
};
type NoiseTextures = { weatherMap: Texture2D; baseNoise: Texture3D; detailNoise: Texture3D };

const SAMPLE_WIDTH = 128;
const SAMPLE_HEIGHT = 500;
const COVERAGES = [0, 0.25, 0.5, 0.75, 1];
const TYPES = [0, 0.5, 1];
const LAYER_HEIGHTS = [100, 1000, 10000, 20000];
const PROFILE_WIDTH = 512;

function statistics(values: number[]) {
  values.sort((a, b) => a - b);
  const quantile = (q: number) => values[Math.floor((values.length - 1) * q)];
  return {
    min: values[0],
    p01: quantile(0.01),
    p05: quantile(0.05),
    p50: quantile(0.5),
    p99: quantile(0.99),
    p95: quantile(0.95),
    max: values[values.length - 1]
  };
}

function submit(work: () => void) {
  const device = getDevice();
  if (!device.beginFrame()) {
    throw new Error('Cloud checks could not begin a GPU frame');
  }
  device.pushDeviceStates();
  try {
    work();
  } finally {
    device.popDeviceStates();
    device.endFrame();
  }
  device.flush();
}

function outputTexture(width: number, height: number) {
  const texture = getDevice().createTexture2D('rgba32f', width, height, {
    writable: true,
    mipmapping: false,
    samplerOptions: { minFilter: 'nearest', magFilter: 'nearest', mipFilter: 'none' }
  });
  if (!texture) {
    throw new Error('Cloud checks could not allocate an rgba32f readback texture');
  }
  return texture;
}

async function read(texture: Texture2D) {
  const pixels = new Float32Array(texture.width * texture.height * 4);
  await texture.readPixels(0, 0, texture.width, texture.height, 0, 0, pixels);
  return pixels;
}

async function weatherStatistics(texture: Texture2D) {
  const pixels = new Uint8Array(texture.width * texture.height * 4);
  await texture.readPixels(0, 0, texture.width, texture.height, 0, 0, pixels);
  return Object.fromEntries(
    ['connected', 'isolated', 'cloudType'].map((name, channel) => {
      const values = Array.from(
        { length: pixels.length / 4 },
        (_, index) => pixels[index * 4 + channel] / 255
      );
      const zeroFraction = values.filter((value) => value === 0).length / values.length;
      return [name, { ...statistics(values), zeroFraction, nonzeroFraction: 1 - zeroFraction }];
    })
  );
}

function dispatch(program: GPUProgram, group: BindGroup, width: number, height: number) {
  submit(() => {
    const device = getDevice();
    device.setProgram(program);
    device.setBindGroup(0, group);
    device.compute(Math.ceil(width / 8), Math.ceil(height / 8), 1);
  });
}

function makeRawNoiseProgram() {
  return getDevice().buildComputeProgram({
    label: 'CloudChecksFilteredBaseNoise',
    workgroupSize: [8, 8, 1],
    compute(pb) {
      this.noise = pb.tex3D().uniform(0);
      this.dst = pb.texStorage2D.rgba32float().storage(0);
      pb.main(function () {
        this.$l.id = this.$builtins.globalInvocationId.xy;
        this.$if(pb.lessThan(this.id.y, SAMPLE_HEIGHT), function () {
          this.$l.index = pb.add(pb.mul(this.id.y, SAMPLE_WIDTH), this.id.x);
          // A uniform 40^3 grid deliberately off texel centres includes quantization and trilinear filtering.
          this.$l.p = pb.div(
            pb.add(
              pb.vec3(
                pb.uvec3(pb.mod(this.index, 40), pb.mod(pb.div(this.index, 40), 40), pb.div(this.index, 1600))
              ),
              pb.vec3(0.37, 0.23, 0.41)
            ),
            40
          );
          this.$l.n = pb.textureSampleLevel(this.noise, this.p, 0);
          this.$l.low = pb.dot(this.n.gba, pb.vec3(0.625, 0.25, 0.125));
          // The exact rawBase remap used before height/coverage in cloudSampleDensity.
          this.$l.raw = pb.div(pb.sub(this.n.r, pb.sub(this.low, 1)), pb.sub(2, this.low));
          this.$l.normalized = pb.clamp(
            pb.div(
              pb.sub(this.raw, CLOUD_COVERAGE_BASE_RANGE[0]),
              CLOUD_COVERAGE_BASE_RANGE[1] - CLOUD_COVERAGE_BASE_RANGE[0]
            ),
            0,
            1
          );
          pb.textureStore(this.dst, this.id, pb.vec4(this.raw, this.normalized, this.n.r, this.low));
        });
      });
    }
  })!;
}

function makeDensityProgram() {
  return getDevice().buildComputeProgram({
    label: 'CloudChecksActualDensity',
    workgroupSize: [8, 8, 1],
    compute(pb) {
      this.cloud = getCloudParamsStruct(pb)().uniform(0);
      this.grid = pb.vec4().uniform(0);
      this.cases = pb.tex2D().sampleType('unfilterable-float').uniform(0);
      this.weather = pb.tex2D().uniform(0);
      this.base = pb.tex3D().uniform(0);
      this.detail = pb.tex3D().uniform(0);
      this.dst = pb.texStorage2D.rgba32float().storage(0);
      pb.main(function () {
        this.$l.id = this.$builtins.globalInvocationId.xy;
        this.$if(
          pb.all(pb.lessThan(this.id, pb.uvec2(pb.vec2(this.grid.x, pb.mul(this.grid.x, this.grid.y))))),
          function () {
            this.$l.caseIndex = pb.div(this.id.y, pb.uint(this.grid.x));
            this.$l.a = pb.textureLoad(this.cases, pb.ivec2(0, pb.int(this.caseIndex)), 0);
            this.$l.b = pb.textureLoad(this.cases, pb.ivec2(1, pb.int(this.caseIndex)), 0);
            this.$l.c = this.cloud;
            this.c.density.x = this.a.y;
            this.c.density.z = this.a.w;
            this.c.shape = pb.vec4(this.a.z, this.b.x, this.a.x, this.b.w);
            this.c.windDir.z = this.b.z;
            this.$l.xz = pb.mul(
              pb.sub(
                pb.div(
                  pb.add(
                    pb.vec2(pb.uvec2(this.id.x, pb.mod(this.id.y, pb.uint(this.grid.x)))),
                    pb.vec2(0.37, 0.23)
                  ),
                  this.grid.x
                ),
                pb.vec2(0.5)
              ),
              this.grid.z
            );
            // At the layer boundaries, avoid tangential f32 radius error obscuring an exact zero check.
            this.$if(pb.or(pb.lessThanEqual(this.b.y, 0), pb.greaterThanEqual(this.b.y, 1)), function () {
              this.xz = pb.vec2(0);
            });
            this.$l.radius = pb.mix(this.c.layer.x, this.c.layer.y, this.b.y);
            this.$l.p = pb.vec3(
              this.xz.x,
              pb.sqrt(pb.sub(pb.mul(this.radius, this.radius), pb.dot(this.xz, this.xz))),
              this.xz.y
            );
            pb.textureStore(
              this.dst,
              this.id,
              cloudSampleDensity(this, this.c, this.p, this.weather, this.base, this.detail)
            );
          }
        );
      });
    }
  })!;
}

function cloudParameters() {
  const zero = () => new Vector4();
  return {
    referential: new Matrix4x4(),
    layer: new Vector4(6376000, 6386000, 6371000, 50000),
    march: zero(),
    eye: zero(),
    sunDir: zero(),
    sunIlluminance: zero(),
    phase: zero(),
    ms: zero(),
    density: new Vector4(0, 1, 0, 0),
    shape: new Vector4(1, 1, 1, 0),
    albedo: new Vector4(1, 1, 1, 0),
    scales: new Vector4(1 / 64000, 1 / 20000, 1 / 1000, 0),
    windOffset: zero(),
    windDir: zero()
  };
}

async function sampleDensity(
  program: GPUProgram,
  textures: NoiseTextures,
  cases: DensityCase[],
  edge: number
) {
  const device = getDevice();
  const input = outputTexture(2, cases.length);
  const output = outputTexture(edge, cases.length * edge);
  const group = device.createBindGroup(program.bindGroupLayouts[0]);
  const settings = new Float32Array(cases.length * 8);
  cases.forEach((c, index) => {
    settings.set(
      [
        c.coverage,
        cloudCoverageThreshold(c.coverage, c.formation),
        c.strength,
        c.erosion,
        c.bottom,
        c.height,
        c.formation === 'isolated' ? 1 : 0,
        c.baseVariation ?? 0
      ],
      index * 8
    );
  });
  try {
    input.update(settings, 0, 0, 2, cases.length);
    group.setValue('cloud', cloudParameters());
    group.setValue('grid', new Vector4(edge, cases.length, 64000, 0));
    group.setTexture('cases', input);
    group.setTexture('weather', textures.weatherMap);
    group.setTexture('base', textures.baseNoise);
    group.setTexture('detail', textures.detailNoise);
    group.setTextureView('dst', output, 0, 0, 1);
    dispatch(program, group, output.width, output.height);
    return await read(output);
  } finally {
    group.dispose();
    input.dispose();
    output.dispose();
  }
}

function checkDensity(pixels: Float32Array, cases: DensityCase[], edge: number) {
  const perCase = edge * edge * 4;
  let nonFinite = 0;
  let outOfRange = 0;
  let nonzeroWhenAbsent = 0;
  const occupancy = cases.map((c, index) => {
    let occupied = 0;
    for (let offset = index * perCase; offset < (index + 1) * perCase; offset += 4) {
      for (let channel = 0; channel < 4; channel++) {
        nonFinite += Number(!Number.isFinite(pixels[offset + channel]));
      }
      const density = pixels[offset];
      outOfRange += Number(density < -1e-6 || density > 1 + 1e-6);
      if (c.coverage === 0 || c.height <= 0 || c.height >= 1) {
        nonzeroWhenAbsent += Number(density !== 0);
      }
      occupied += Number(density > 1e-6);
    }
    return occupied / (edge * edge);
  });
  return { nonFinite, outOfRange, nonzeroWhenAbsent, occupancy };
}

function generatedCases() {
  const cases: DensityCase[] = [];
  for (const formation of ['connected', 'isolated'] as const) {
    for (const strength of [0, 0.45, 1]) {
      for (const erosion of [0, 1]) {
        for (const coverage of COVERAGES) {
          cases.push({ coverage, strength, erosion, bottom: 0.1, height: 0.2, formation });
        }
      }
    }
  }
  return cases;
}

async function checkBaseVariation(
  program: GPUProgram,
  textures: NoiseTextures,
  checks: Check[],
  seed: number
) {
  const edge = 32;
  const heights = Array.from({ length: 21 }, (_, index) => index * 0.005);
  const cases: DensityCase[] = [];
  for (const formation of ['connected', 'isolated'] as const) {
    for (const baseVariation of [0, 700]) {
      for (const height of heights) {
        cases.push({ coverage: 0.75, strength: 0, erosion: 0, bottom: 0, height, formation, baseVariation });
      }
    }
  }
  const pixels = await sampleDensity(program, textures, cases, edge);
  const perCase = edge * edge * 4;
  for (let formation = 0; formation < 2; formation++) {
    const lifts: number[] = [];
    const variedBases: number[] = [];
    for (let pixel = 0; pixel < edge * edge; pixel++) {
      const first = (variation: number) => {
        for (let height = 0; height < heights.length; height++) {
          const caseIndex = (formation * 2 + variation) * heights.length + height;
          if (pixels[caseIndex * perCase + pixel * 4 + 1] > 0.05) {
            return height;
          }
        }
        return -1;
      };
      const flat = first(0);
      const varied = first(1);
      if (flat >= 0 && varied >= 0) {
        lifts.push((varied - flat) * 50);
        variedBases.push(varied * 50);
      }
    }
    const spread = variedBases.length ? Math.max(...variedBases) - Math.min(...variedBases) : 0;
    const lifted = lifts.filter((value) => value >= 50).length;
    checks.push({
      name: `varying-cloud-base-${seed}-${formation}`,
      passed: lifts.length > 20 && lifted > 0 && lifts.every((value) => value >= 0) && spread >= 100,
      details: { samples: lifts.length, lifted, spreadMeters: spread, maxLiftMeters: Math.max(0, ...lifts) }
    });
  }
}

async function checkProfiles(checks: Check[]) {
  const device = getDevice();
  const rows = TYPES.flatMap((type) => LAYER_HEIGHTS.map((height) => ({ type, height })));
  const input = outputTexture(PROFILE_WIDTH, rows.length);
  const output = outputTexture(PROFILE_WIDTH, rows.length);
  const requests = new Float32Array(PROFILE_WIDTH * rows.length * 4);
  rows.forEach(({ type, height }, row) => {
    const top = type === 0 ? 0.11 : type === 0.5 ? 0.625 : 1;
    const boundaries = [-0.01, 0, 1, 1.01, top, top + 0.01, top - 0.001, top * 0.5];
    for (let x = 0; x < PROFILE_WIDTH; x++) {
      // First sample the bottom in whole meters, then the entire normalized layer.
      const h = x <= 200 ? x / height : x <= 401 ? (x - 201) / 200 : (boundaries[x - 402] ?? top * 0.5);
      requests.set([h, type, height, 0], (row * PROFILE_WIDTH + x) * 4);
    }
  });
  const program = device.buildComputeProgram({
    label: 'CloudChecksActualHeightProfile',
    workgroupSize: [8, 8, 1],
    compute(pb) {
      this.requests = pb.tex2D().sampleType('unfilterable-float').uniform(0);
      this.dst = pb.texStorage2D.rgba32float().storage(0);
      pb.main(function () {
        this.$l.id = this.$builtins.globalInvocationId.xy;
        this.$if(pb.lessThan(this.id.y, rows.length), function () {
          this.$l.request = pb.textureLoad(this.requests, pb.ivec2(this.id), 0);
          this.$l.profile = cloudHeightProfile(this, this.request.x, this.request.y, this.request.z);
          pb.textureStore(this.dst, this.id, pb.vec4(this.profile.xy, this.request.xy));
        });
      });
    }
  })!;
  const group = device.createBindGroup(program.bindGroupLayouts[0]);
  try {
    input.update(requests, 0, 0, input.width, input.height);
    group.setTexture('requests', input);
    group.setTextureView('dst', output, 0, 0, 1);
    dispatch(program, group, output.width, output.height);
    const pixels = await read(output);
    const profiles = rows.map(({ type, height }, row) => {
      const start = row * PROFILE_WIDTH * 4;
      const values = Array.from({ length: PROFILE_WIDTH }, (_, x) => pixels[start + x * 4]);
      const bottomTo99Meters = values.slice(0, 201).findIndex((v) => v >= 0.99);
      const finiteAndBounded = values.every((v) => Number.isFinite(v) && v >= 0 && v <= 1);
      const outsideZero = values.slice(402, 408).every((v) => Math.abs(v) <= 1e-6);
      const interiorPresent = values[409] > 0;
      const passed =
        finiteAndBounded &&
        outsideZero &&
        interiorPresent &&
        bottomTo99Meters >= 0 &&
        bottomTo99Meters <= 150;
      checks.push({
        name: `profile-type-${type}-height-${height}`,
        passed,
        details: { bottomTo99Meters, finiteAndBounded, outsideZero, interiorPresent }
      });
      return { type, layerHeight: height, bottomTo99Meters };
    });
    for (const type of TYPES) {
      const large = profiles.filter((p) => p.type === type && p.layerHeight >= 10000);
      checks.push({
        name: `bottom-transition-meters-type-${type}`,
        passed: Math.abs(large[0].bottomTo99Meters - large[1].bottomTo99Meters) <= 1,
        details: large
      });
    }
    return profiles;
  } finally {
    group.dispose();
    program.dispose();
    input.dispose();
    output.dispose();
  }
}

/** GPU checks only; requires an initialized WebGPU harness, without rendering a sky frame. */
export async function runCloudChecks() {
  const device = getDevice();
  if (device.type !== 'webgpu') {
    throw new Error('Cloud checks require WebGPU');
  }
  const started = performance.now();
  const checks: Check[] = [];
  const calibration: unknown[] = [];
  const coverageResponses: unknown[] = [];
  const pooledRawBase: number[] = [];
  const resources = new VolumetricCloudResources();
  const rawProgram = makeRawNoiseProgram();
  const densityProgram = makeDensityProgram();
  const rawOutput = outputTexture(SAMPLE_WIDTH, SAMPLE_HEIGHT);
  const rawGroup = device.createBindGroup(rawProgram.bindGroupLayouts[0]);
  try {
    const profiles = await checkProfiles(checks);
    const cases = generatedCases();
    for (const seed of [0, 1, 2]) {
      submit(() => resources.update(seed));
      const weatherMap = await weatherStatistics(resources.weatherMap);
      rawGroup.setTexture('noise', resources.baseNoise);
      rawGroup.setTextureView('dst', rawOutput, 0, 0, 1);
      dispatch(rawProgram, rawGroup, SAMPLE_WIDTH, SAMPLE_HEIGHT);
      const raw = await read(rawOutput);
      const channels = Array.from({ length: 4 }, (_, channel) =>
        Array.from({ length: raw.length / 4 }, (_, index) => raw[index * 4 + channel])
      );
      pooledRawBase.push(...channels[0]);
      checks.push({
        name: `generated-filtered-noise-finite-seed-${seed}`,
        passed: channels.every((c) => c.every(Number.isFinite)),
        details: { samples: SAMPLE_WIDTH * SAMPLE_HEIGHT }
      });
      calibration.push({
        seed,
        samples: SAMPLE_WIDTH * SAMPLE_HEIGHT,
        weatherMap,
        rawBase: statistics(channels[0]),
        normalizedShape: statistics(channels[1]),
        perlinWorley: statistics(channels[2]),
        lowFbm: statistics(channels[3])
      });

      const density = await sampleDensity(densityProgram, resources, cases, 32);
      const summary = checkDensity(density, cases, 32);
      let monotonicViolations = 0;
      let shapingViolations = 0;
      let shapedPixels = 0;
      const perCase = 32 * 32 * 4;
      for (let index = 0; index < cases.length; index += COVERAGES.length) {
        for (let step = 1; step < COVERAGES.length; step++) {
          for (let pixel = 0; pixel < perCase; pixel += 4) {
            monotonicViolations += Number(
              density[(index + step) * perCase + pixel] + 1e-6 < density[(index + step - 1) * perCase + pixel]
            );
          }
        }
      }
      const casesPerStrength = 2 * COVERAGES.length;
      const casesPerFormation = 3 * casesPerStrength;
      for (let formation = 0; formation < 2; formation++) {
        for (let strength = 1; strength < 3; strength++) {
          for (let offset = 0; offset < casesPerStrength; offset++) {
            const weaker =
              (formation * casesPerFormation + (strength - 1) * casesPerStrength + offset) * perCase;
            const stronger = (formation * casesPerFormation + strength * casesPerStrength + offset) * perCase;
            for (let pixel = 0; pixel < perCase; pixel += 4) {
              shapingViolations += Number(density[stronger + pixel] > density[weaker + pixel] + 1e-6);
              shapedPixels += Number(density[weaker + pixel] > density[stronger + pixel] + 1e-4);
            }
          }
        }
      }
      checks.push({
        name: `actual-density-boundaries-seed-${seed}`,
        passed: summary.nonFinite === 0 && summary.outOfRange === 0 && summary.nonzeroWhenAbsent === 0,
        details: {
          nonFinite: summary.nonFinite,
          outOfRange: summary.outOfRange,
          nonzeroWhenAbsent: summary.nonzeroWhenAbsent
        }
      });
      checks.push({
        name: `actual-density-coverage-monotonic-seed-${seed}`,
        passed: monotonicViolations === 0,
        details: { monotonicViolations, samplesPerCase: 1024, cases: cases.length }
      });
      checks.push({
        name: `actual-density-shape-strength-seed-${seed}`,
        passed: shapingViolations === 0 && shapedPixels > 0,
        details: { shapingViolations, shapedPixels }
      });
      coverageResponses.push({
        seed,
        cases: cases.map((c, index) => ({ ...c, occupancy: summary.occupancy[index] }))
      });
      await checkBaseVariation(densityProgram, resources, checks, seed);
    }

    const customCases: DensityCase[] = [];
    for (const coverage of [0, 1]) {
      for (const strength of [0, 1]) {
        for (const erosion of [0, 1]) {
          for (const bottom of [0, 1]) {
            for (const height of [-0.01, 0, 0.005, 0.1, 0.5, 0.999, 1, 1.01]) {
              customCases.push({ coverage, strength, erosion, bottom, height, formation: 'connected' });
            }
          }
        }
      }
    }
    for (const baseValue of [0, 255]) {
      for (const detailValue of [0, 255]) {
        const imported = new VolumetricCloudResources();
        const base = device.createTexture2D('rgba8unorm', 1, 1, { mipmapping: false })!;
        const detail = device.createTexture2D('rgba8unorm', 1, 1, { mipmapping: false })!;
        const weather = device.createTexture2D('rgba8unorm', 1, 1, { mipmapping: false })!;
        try {
          base.update(new Uint8Array([baseValue, baseValue, baseValue, baseValue]), 0, 0, 1, 1);
          detail.update(new Uint8Array([detailValue, detailValue, detailValue, 255]), 0, 0, 1, 1);
          imported.baseNoiseSource = base;
          imported.detailNoiseSource = detail;
          imported.weatherMapSource = weather;
          submit(() => imported.update(0));
          // Validate the atlas conversion itself; zero densities alone can hide an invalid GPU dispatch.
          for (const [name, texture, value] of [
            ['base', imported.baseNoise, baseValue],
            ['detail', imported.detailNoise, detailValue]
          ] as const) {
            rawGroup.setTexture('noise', texture);
            rawGroup.setTextureView('dst', rawOutput, 0, 0, 1);
            dispatch(rawProgram, rawGroup, SAMPLE_WIDTH, SAMPLE_HEIGHT);
            const filtered = await read(rawOutput);
            let mismatches = 0;
            for (let offset = 2; offset < filtered.length; offset += 4) {
              mismatches += Number(Math.abs(filtered[offset] - value / 255) > 1e-6);
            }
            checks.push({
              name: `imported-atlas-${name}-base-${baseValue}-detail-${detailValue}`,
              passed: mismatches === 0,
              details: { mismatches, expectedChannel: value / 255 }
            });
          }
          for (const type of TYPES) {
            weather.update(new Uint8Array([255, 255, Math.round(type * 255), 255]), 0, 0, 1, 1);
            const pixels = await sampleDensity(densityProgram, imported, customCases, 8);
            const summary = checkDensity(pixels, customCases, 8);
            const positiveControl = customCases.some(
              (c, index) =>
                c.coverage === 1 &&
                c.strength === 0 &&
                c.erosion === 0 &&
                c.height === 0.1 &&
                summary.occupancy[index] === 1
            );
            checks.push({
              name: `imported-constant-base-${baseValue}-detail-${detailValue}-type-${type}`,
              passed:
                summary.nonFinite === 0 &&
                summary.outOfRange === 0 &&
                summary.nonzeroWhenAbsent === 0 &&
                positiveControl,
              details: {
                cases: customCases.length,
                nonFinite: summary.nonFinite,
                outOfRange: summary.outOfRange,
                nonzeroWhenAbsent: summary.nonzeroWhenAbsent,
                positiveControl
              }
            });
          }
        } finally {
          imported.dispose();
          base.dispose();
          detail.dispose();
          weather.dispose();
        }
      }
    }
    return {
      passed: checks.every((c) => c.passed),
      backend: device.type,
      elapsedMs: performance.now() - started,
      referenceBaseRange: Array.from(CLOUD_COVERAGE_BASE_RANGE),
      calibration,
      pooledRawBase: statistics(pooledRawBase),
      profiles,
      coverageResponses,
      checks
    };
  } finally {
    rawGroup.dispose();
    rawProgram.dispose();
    densityProgram.dispose();
    rawOutput.dispose();
    resources.dispose();
  }
}
