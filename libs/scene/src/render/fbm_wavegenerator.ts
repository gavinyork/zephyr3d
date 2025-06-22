import type { AABB } from '@zephyr3d/base';
import { Vector2 } from '@zephyr3d/base';
import type { WaveGenerator } from './wavegenerator';
import type { BindGroup, PBGlobalScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { hash } from '../shaders';
import { ShaderHelper } from '../material';

const MAX_NUM_OCTAVES = 16;

/**
 * FBM wave generator.
 * @public
 */
export class FBMWaveGenerator implements WaveGenerator {
  private _version: number;
  private _windVelocity: Vector2;
  private _numOctaves: number;
  private _amplitude: number;
  private _frequency: number;
  private _lacunarity: number;
  private _gain: number;
  private _disposed: boolean;
  /**
   * Creates a new Gerstner wave generator.
   */
  constructor() {
    this._version = 0;
    this._numOctaves = 4;
    this._windVelocity = new Vector2(0.1, 0);
    this._amplitude = 0.3;
    this._frequency = 3;
    this._lacunarity = 1.83;
    this._gain = 0.57;
    this._disposed = false;
  }
  clone(): this {
    const other = new FBMWaveGenerator();
    other.numOctaves = this.numOctaves;
    other.wind = this.wind;
    other.amplitude = this.amplitude;
    other.frequency = this.frequency;
    return other as this;
  }
  get version() {
    return this._version;
  }
  get disposed() {
    return this._disposed;
  }
  /** Number of octaves */
  get numOctaves(): number {
    return this._numOctaves;
  }
  set numOctaves(val: number) {
    if (val !== this.numOctaves) {
      this._numOctaves = val;
      this._version++;
    }
  }
  /** Wave amplitude */
  get amplitude(): number {
    return this._amplitude;
  }
  set amplitude(val: number) {
    if (val !== this._amplitude) {
      this._amplitude = val;
      this._version++;
    }
  }
  /** Wave frequency */
  get frequency(): number {
    return this._frequency;
  }
  set frequency(val: number) {
    if (val !== this._frequency) {
      this._frequency = val;
      this._version++;
    }
  }
  /** Wind velocity */
  get wind(): Vector2 {
    return this._windVelocity;
  }
  set wind(val: Vector2) {
    if (!val.equalsTo(this._windVelocity)) {
      this._windVelocity.set(val);
      this._version++;
    }
  }
  /** @internal */
  private calcWaveNormal(
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp,
    time: PBShaderExp,
    windVelocity: PBShaderExp,
    amplitude: PBShaderExp,
    frequency: PBShaderExp,
    gain: PBShaderExp,
    lacunarity: PBShaderExp,
    numOctaves: PBShaderExp
  ) {
    const pb = scope.$builder;
    const funcName = 'calcWaveNormal';
    const that = this;
    pb.func(
      funcName,
      [
        pb.vec2('worldPos'),
        pb.float('time'),
        pb.vec2('windVelocity'),
        pb.float('amplitude'),
        pb.float('frequency'),
        pb.float('gain'),
        pb.float('lacunarity'),
        pb.int('numOctaves')
      ],
      function () {
        this.$l.epsilon = pb.float(0.1);
        this.$l.hr = that.calcWaveHeight(
          this,
          pb.add(this.worldPos, pb.vec2(this.epsilon, 0)),
          this.windVelocity,
          this.amplitude,
          this.frequency,
          this.gain,
          this.lacunarity,
          this.numOctaves
        );
        this.$l.hl = that.calcWaveHeight(
          this,
          pb.sub(this.worldPos, pb.vec2(this.epsilon, 0)),
          this.windVelocity,
          this.amplitude,
          this.frequency,
          this.gain,
          this.lacunarity,
          this.numOctaves
        );
        this.$l.hu = that.calcWaveHeight(
          this,
          pb.add(this.worldPos, pb.vec2(0, this.epsilon)),
          this.windVelocity,
          this.amplitude,
          this.frequency,
          this.gain,
          this.lacunarity,
          this.numOctaves
        );
        this.$l.hd = that.calcWaveHeight(
          this,
          pb.sub(this.worldPos, pb.vec2(0, this.epsilon)),
          this.windVelocity,
          this.amplitude,
          this.frequency,
          this.gain,
          this.lacunarity,
          this.numOctaves
        );
        this.$l.dHdx = pb.div(pb.sub(this.hr, this.hl), pb.mul(this.epsilon, 2));
        this.$l.dHdz = pb.div(pb.sub(this.hu, this.hd), pb.mul(this.epsilon, 2));
        this.$l.normal = pb.normalize(pb.vec3(pb.neg(this.dHdx), 1, pb.neg(this.dHdz)));
        this.$return(this.normal);
      }
    );
    return scope[funcName](worldPos, time, windVelocity, amplitude, frequency, gain, lacunarity, numOctaves);
  }
  /** @internal */
  private calcWaveHeight(
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp,
    windVelocity: PBShaderExp,
    amplitude: PBShaderExp,
    frequency: PBShaderExp,
    gain: PBShaderExp,
    lacunarity: PBShaderExp,
    numOctaves: PBShaderExp
  ) {
    const pb = scope.$builder;
    const funcName = 'calcWaveHeight';
    const that = this;
    pb.func(
      funcName,
      [
        pb.vec2('worldPos'),
        pb.vec2('windVelocity'),
        pb.float('amplitude'),
        pb.float('frequency'),
        pb.float('gain'),
        pb.float('lacunarity'),
        pb.int('numOctaves')
      ],
      function () {
        this.$l.windOffset = pb.mul(this.windVelocity, ShaderHelper.getElapsedTime(this));
        this.$l.height = that.fbm(
          this,
          pb.add(pb.mul(this.worldPos, 0.01), this.windOffset),
          this.frequency,
          this.gain,
          this.lacunarity,
          this.numOctaves
        );
        this.height = pb.add(
          this.height,
          pb.mul(
            0.3,
            that.fbm(
              this,
              pb.add(pb.mul(this.worldPos, 0.05), pb.mul(this.windOffset, 1.5)),
              this.frequency,
              this.gain,
              this.lacunarity,
              this.numOctaves
            )
          )
        );
        this.height = pb.add(
          this.height,
          pb.mul(
            0.1,
            that.fbm(
              this,
              pb.add(pb.mul(this.worldPos, 0.1), pb.mul(this.windOffset, 2)),
              this.frequency,
              this.gain,
              this.lacunarity,
              this.numOctaves
            )
          )
        );
        this.$return(pb.mul(this.height, this.amplitude));
      }
    );
    return scope[funcName](worldPos, windVelocity, amplitude, frequency, gain, lacunarity, numOctaves);
  }
  /** @internal */
  private fbm(
    scope: PBInsideFunctionScope,
    st: PBShaderExp,
    frequency: PBShaderExp,
    gain: PBShaderExp,
    lacunarity: PBShaderExp,
    numOctaves: PBShaderExp
  ) {
    const pb = scope.$builder;
    const funcName = 'FBM';
    const that = this;
    pb.func(
      funcName,
      [pb.vec2('st'), pb.float('frequency'), pb.float('gain'), pb.float('lacunarity'), pb.int('numOctaves')],
      function () {
        this.$l.m2 = pb.mat2(0.8, 0.6, -0.6, 0.8);
        this.$l.p = this.st; //pb.mul(this.st, 0.05);
        this.$l.a = pb.float(0);
        this.$l.b = pb.float(1);
        this.$l.c = pb.float(0);
        this.$for(
          pb.int('i'),
          0,
          pb.getDevice().type === 'webgl' ? MAX_NUM_OCTAVES : this.numOctaves,
          function () {
            if (pb.getDevice().type === 'webgl') {
              this.$if(pb.greaterThanEqual(this.i, this.numOctaves), function () {
                this.$break();
              });
            }
            this.$l.n = pb.sub(that.noise2D(this, this.p), 0.5);
            this.a = pb.add(this.a, pb.mul(this.n, this.b));
            this.c = pb.add(this.c, this.b);
            this.b = pb.mul(this.b, this.gain);
            this.p = pb.mul(this.m2, this.p, this.frequency);
          }
        );
        this.$return(pb.div(this.a, this.c));
      }
    );
    return scope[funcName](st, frequency, gain, lacunarity, numOctaves);
  }
  /** @internal */
  private noise2D(scope: PBInsideFunctionScope, st: PBShaderExp) {
    const pb = scope.$builder;
    const funcName = 'noise2D';
    pb.func(funcName, [pb.vec2('st')], function () {
      this.$l.i = pb.floor(this.st);
      this.$l.f = pb.fract(this.st);
      this.$l.u = pb.mul(
        this.f,
        this.f,
        this.f,
        pb.add(pb.mul(this.f, pb.sub(pb.mul(this.f, 6), pb.vec2(15))), pb.vec2(10))
      );
      this.$l.a = hash(this, pb.add(this.i, pb.vec2(0)));
      this.$l.b = hash(this, pb.add(this.i, pb.vec2(1, 0)));
      this.$l.c = hash(this, pb.add(this.i, pb.vec2(0, 1)));
      this.$l.d = hash(this, pb.add(this.i, pb.vec2(1, 1)));
      this.$return(
        pb.add(
          this.a,
          pb.mul(pb.sub(this.b, this.a), this.u.x),
          pb.mul(pb.sub(this.c, this.a), this.u.y),
          pb.mul(pb.sub(pb.add(this.a, this.d), pb.add(this.b, this.c)), this.u.x, this.u.y)
        )
      );
    });
    return scope[funcName](st);
  }
  /** {@inheritDoc WaveGenerator.update} */
  update(): void {}
  /** {@inheritDoc WaveGenerator.needUpdate} */
  needUpdate() {
    return false;
  }
  /** {@inheritDoc WaveGenerator.calcClipmapTileAABB} */
  calcClipmapTileAABB(minX: number, maxX: number, minZ: number, maxZ: number, y: number, outAABB: AABB) {
    const maxHeight = 1.5 * this._amplitude;
    outAABB.minPoint.setXYZ(minX, y - maxHeight, minZ);
    outAABB.maxPoint.setXYZ(maxX, y + maxHeight, maxZ);
  }
  /** {@inheritDoc WaveGenerator.calcFragmentNormal} */
  calcFragmentNormal(scope: PBInsideFunctionScope, xz: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    pb.func('calcFragmentNormal', [pb.vec2('xz')], function () {
      this.$l.normal = that.calcWaveNormal(
        this,
        this.xz,
        ShaderHelper.getElapsedTime(this),
        this.windVelocity,
        this.waveAmplitude,
        this.waveFrequency,
        this.waveGain,
        this.waveLacunarity,
        this.numOctaves
      );
      this.$return(this.normal);
    });
    return scope.calcFragmentNormal(xz);
  }
  /** {@inheritDoc WaveGenerator.calcFragmentNormalAndFoam} */
  calcFragmentNormalAndFoam(scope: PBInsideFunctionScope, xz: PBShaderExp): PBShaderExp {
    return scope.$builder.vec4(this.calcFragmentNormal(scope, xz), 0);
  }
  /** {@inheritDoc WaveGenerator.setupUniforms} */
  setupUniforms(scope: PBGlobalScope, uniformGroup: number): void {
    const pb = scope.$builder;
    scope.numOctaves = pb.int().uniform(uniformGroup);
    scope.windVelocity = pb.vec2().uniform(uniformGroup);
    scope.waveAmplitude = pb.float().uniform(uniformGroup);
    scope.waveFrequency = pb.float().uniform(uniformGroup);
    scope.waveGain = pb.float().uniform(uniformGroup);
    scope.waveLacunarity = pb.float().uniform(uniformGroup);
  }
  /** @internal */
  private calcNormalAndPos(
    scope: PBInsideFunctionScope,
    inPos: PBShaderExp,
    outPos: PBShaderExp,
    outNormal: PBShaderExp
  ) {
    const pb = scope.$builder;
    const that = this;
    pb.func(
      'calcPositionAndNormal',
      [pb.vec3('inPos'), pb.vec3('outPos').out(), pb.vec3('outNormal').out()],
      function () {
        this.outNormal = that.calcWaveNormal(
          this,
          this.inPos.xz,
          ShaderHelper.getElapsedTime(this),
          this.windVelocity,
          this.waveAmplitude,
          this.waveFrequency,
          this.waveGain,
          this.waveLacunarity,
          this.numOctaves
        );
        this.$l.h = that.calcWaveHeight(
          this,
          this.inPos.xz,
          this.windVelocity,
          this.waveAmplitude,
          this.waveFrequency,
          this.waveGain,
          this.waveLacunarity,
          this.numOctaves
        );
        this.outPos = pb.add(this.inPos, pb.vec3(0, this.h, 0));
      }
    );
    scope.calcPositionAndNormal(inPos, outPos, outNormal);
  }
  /** {@inheritDoc WaveGenerator.calcVertexPositionAndNormal} */
  calcVertexPositionAndNormal(
    scope: PBInsideFunctionScope,
    inPos: PBShaderExp,
    outPos: PBShaderExp,
    outNormal: PBShaderExp
  ): void {
    this.calcNormalAndPos(scope, inPos, outPos, outNormal);
  }
  /** {@inheritDoc WaveGenerator.applyWaterBindGroup} */
  applyWaterBindGroup(bindGroup: BindGroup): void {
    bindGroup.setValue('numOctaves', this._numOctaves);
    bindGroup.setValue('windVelocity', this._windVelocity);
    bindGroup.setValue('waveAmplitude', this._amplitude);
    bindGroup.setValue('waveFrequency', this._frequency);
    bindGroup.setValue('waveGain', this._gain);
    bindGroup.setValue('waveLacunarity', this._lacunarity);
  }
  /** {@inheritDoc WaveGenerator.isOk} */
  isOk(): boolean {
    return true;
  }
  /** {@inheritDoc WaveGenerator.getHash} */
  getHash(): string {
    return 'FBMWaveGenerator';
  }
  /** {@inheritDoc WaveGenerator.dispose} */
  dispose(): void {
    this._disposed = true;
  }
}
