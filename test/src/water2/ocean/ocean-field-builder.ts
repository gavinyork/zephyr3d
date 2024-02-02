import { merge } from 'lodash-es';

let testData = true;
import { createButterflyTexture } from './butterfly';
import {
  Gpu,
  RenderTarget,
  ShaderProgram,
  Texture2d,
  Geometry,
  createQuad,
  TextureFiltering,
  TextureMode,
} from '../graphics';
import { OceanField } from './ocean-field';
import {
  defaultBuildParams,
  OceanFieldBuildParams,
} from './ocean-field-build-params';
import { vs as h0vs, fs as h0fs } from './programs/h0';

export class OceanFieldBuilder {
  private readonly quad: Geometry;
  private readonly frameBuffer: RenderTarget;
  private readonly butterflyTexture = new Map<number, Texture2d>();
  private readonly noiseTexture = new Map<number, Texture2d>();
  private readonly h0Program: ShaderProgram;

  constructor(private readonly gpu: Gpu) {
    this.quad = this.gpu.createGeometry(createQuad());
    this.frameBuffer = this.gpu.createRenderTarget();
    this.h0Program = this.gpu.createShaderProgram(h0vs, h0fs);
  }

  build(params: Partial<OceanFieldBuildParams>): OceanField {
    const _params: OceanFieldBuildParams = merge(
      {},
      defaultBuildParams,
      params
    );

    const h0Textures = this.createH0Textures(_params.resolution);
    this.generateInitialSpectrum(h0Textures, _params);

    const butterflyTexture = this.getButterflyTexture(_params.resolution);

    return new OceanField(
      this.gpu,
      h0Textures,
      butterflyTexture,
      this.quad,
      _params
    );
  }

  update(field: OceanField, params: Partial<OceanFieldBuildParams>): void {
    const _params: OceanFieldBuildParams = merge({}, field.params, params);
    this.generateInitialSpectrum(field['h0Textures'], _params);
    this.updateFieldPrograms(field, _params);
    Object.assign(field, { params: _params });
  }

  private updateFieldPrograms(
    field: OceanField,
    params: OceanFieldBuildParams
  ) {
    if (params.resolution !== field.params.resolution) {
      this.gpu.setProgram(field['hkProgram']);
      this.gpu.setProgramVariable(
        field['hkProgram'],
        'resolution',
        'uint',
        params.resolution
      );

      this.gpu.setProgram(field['postfft2Program']);
      this.gpu.setProgramVariable(
        field['postfft2Program'],
        'N2',
        'float',
        params.resolution * params.resolution
      );
    }

    this.gpu.setProgram(field['hkProgram']);
    for (let i = 0; i < params.cascades.length; i++) {
      if (params.cascades[i].size !== field.params.cascades[i].size) {
        this.gpu.setProgramVariable(
          field['hkProgram'],
          `sizes[${i}]`,
          'float',
          params.cascades[i].size
        );
      }
    }
  }

  private createH0Textures(size: number): [Texture2d, Texture2d, Texture2d] {
    return [
      this.gpu.createFloat4Texture(size, size),
      this.gpu.createFloat4Texture(size, size),
      this.gpu.createFloat4Texture(size, size),
    ];
  }

  generateInitialSpectrum(
    h0Textures: [Texture2d, Texture2d, Texture2d],
    params: OceanFieldBuildParams
  ): void {
    this.gpu.attachTextures(this.frameBuffer, h0Textures);
    this.gpu.setRenderTarget(this.frameBuffer);
    this.gpu.setViewport(0, 0, params.resolution, params.resolution);
    this.gpu.clearRenderTarget();

    this.gpu.setProgram(this.h0Program);
    this.gpu.setProgramTexture(
      this.h0Program,
      'noise',
      this.getNoiseTexture(params.resolution, params.randomSeed),
      0
    );
    this.gpu.setProgramVariable(
      this.h0Program,
      'resolution',
      'uint',
      params.resolution
    );
    this.gpu.setProgramVariable(this.h0Program, 'wind', 'vec2', params.wind);
    this.gpu.setProgramVariable(
      this.h0Program,
      'alignment',
      'float',
      params.alignment
    );

    for (let i = 0; i < params.cascades.length; i++) {
      this.gpu.setProgramVariable(
        this.h0Program,
        `cascades[${i}].size`,
        'float',
        params.cascades[i].size
      );
      this.gpu.setProgramVariable(
        this.h0Program,
        `cascades[${i}].strength`,
        'float',
        (params.cascades[i].strength * 0.081) / params.cascades[i].size ** 2
      );
      this.gpu.setProgramVariable(
        this.h0Program,
        `cascades[${i}].minK`,
        'float',
        (2.0 * Math.PI) / params.cascades[i].maxWave
      );
      this.gpu.setProgramVariable(
        this.h0Program,
        `cascades[${i}].maxK`,
        'float',
        (2.0 * Math.PI) / params.cascades[i].minWave
      );
    }

    this.gpu.drawGeometry(this.quad);
    if (testData) {
      testData = false;
      const data = new Float32Array(params.resolution * params.resolution * 4);
      this.gpu.readValues(this.frameBuffer, data, params.resolution, params.resolution, WebGL2RenderingContext.RGBA, WebGL2RenderingContext.FLOAT, 0);
      console.log(data);
      this.gpu.readValues(this.frameBuffer, data, params.resolution, params.resolution, WebGL2RenderingContext.RGBA, WebGL2RenderingContext.FLOAT, 1);
      console.log(data);
      this.gpu.readValues(this.frameBuffer, data, params.resolution, params.resolution, WebGL2RenderingContext.RGBA, WebGL2RenderingContext.FLOAT, 2);
      console.log(data);
    }
    this.gpu.setRenderTarget(null);
  }

  private getNoiseTexture(size: number, randomSeed: number): Texture2d {
    if (!this.noiseTexture.has(size)) {
      this.noiseTexture.set(
        size,
        this.gpu.createFloat2Texture(
          size,
          size,
          TextureFiltering.Nearest,
          TextureMode.Repeat
        )
      );
    }

    const texture = this.noiseTexture.get(size);
    this.gpu.updateTexture(
      texture,
      size,
      size,
      WebGL2RenderingContext.RG,
      WebGL2RenderingContext.FLOAT,
      this.getNoise2d(size, randomSeed)
    );

    return texture;
  }

  private getButterflyTexture(size: number) {
    if (!this.butterflyTexture.has(size)) {
      const texture = this.gpu.createFloat4Texture(Math.log2(size), size);
      this.gpu.updateTexture(
        texture,
        Math.log2(size),
        size,
        WebGL2RenderingContext.RGBA,
        WebGL2RenderingContext.FLOAT,
        createButterflyTexture(size)
      );
      this.butterflyTexture.set(size, texture);
    }
    return this.butterflyTexture.get(size);
  }

  private getNoise2d(size: number, randomSeed: number) {
    const mulberry32 = (a: number) => {
      return (): number => {
        var t = (a += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };
    const random = mulberry32(randomSeed);
    return Float32Array.from([...Array(size * size * 2)].map(() => random()));
  }
}
