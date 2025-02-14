import type { AABB } from '@zephyr3d/base';
import type { WaveGenerator } from './wavegenerator';
import type { BindGroup, PBGlobalScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';

const MAX_NUM_WAVES = 64;

/**
 * Gerstner wave generator.
 * @public
 */
export class GerstnerWaveGenerator implements WaveGenerator {
  private _currentTime: number;
  private _waveParams: Float32Array;
  private _numWaves: number;
  private _disposed: boolean;
  /**
   * Creates a new Gerstner wave generator.
   */
  constructor() {
    this._currentTime = 0;
    this._waveParams = new Float32Array(8 * MAX_NUM_WAVES);
    this.randomWave(0);
    this.randomWave(1);
    this.randomWave(2);
    this.randomWave(3);
    this._numWaves = 4;
    this._disposed = false;
  }
  get disposed() {
    return this._disposed;
  }
  /** Gets the number of waves. */
  get numWaves(): number {
    return this._numWaves;
  }
  set numWaves(val: number) {
    if (!Number.isInteger(val) || val <= 0 || val > MAX_NUM_WAVES) {
      console.error(`Invalid wave number: ${val}`);
      return;
    }
    for (let i = this._numWaves; i < val; i++) {
      this.randomWave(i);
    }
    this._numWaves = val;
  }
  /**
   * Sets the angle of the wave direction in radians.
   * @param waveIndex - index of the wave to set.
   * @param angle - angle of the wave direction in radians.
   */
  setWaveDirection(waveIndex: number, angle: number) {
    if (waveIndex < MAX_NUM_WAVES) {
      this._waveParams[waveIndex * 8 + 0] = angle;
    }
  }
  /**
   * Gets the angle of the wave direction in radians.
   * @param waveIndex - index of the wave to get.
   * @returns Angle of the wave direction in radians.
   */
  getWaveDirection(waveIndex: number): number {
    return waveIndex < MAX_NUM_WAVES ? this._waveParams[waveIndex * 8 + 0] : 0;
  }
  /**
   * Sets the steepness of the wave.
   * @param waveIndex - index of the wave to set.
   * @param steepness - Steepness of the wave.
   */
  setWaveSteepness(waveIndex: number, steepness: number) {
    if (waveIndex < MAX_NUM_WAVES) {
      this._waveParams[waveIndex * 8 + 1] = steepness;
    }
  }
  /**
   * Gets the steepness of the wave.
   * @param waveIndex - index of the wave to set.
   * @returns Steepness of the wave.
   */
  getWaveSteepness(waveIndex: number): number {
    return waveIndex < MAX_NUM_WAVES ? this._waveParams[waveIndex * 8 + 1] : 0;
  }
  /**
   * Sets the amplitude of the wave.
   * @param waveIndex - index of the wave to set.
   * @param val - Amplitude of the wave.
   */
  setWaveAmplitude(waveIndex: number, val: number) {
    if (waveIndex < MAX_NUM_WAVES) {
      this._waveParams[waveIndex * 8 + 2] = val;
    }
  }
  /**
   * Gets the amplitude of the wave.
   * @param waveIndex - index of the wave to set.
   * @returns Amplitude of the wave.
   */
  getWaveAmplitude(waveIndex: number) {
    return waveIndex < MAX_NUM_WAVES ? this._waveParams[waveIndex * 8 + 2] : 0;
  }
  /**
   * Sets the length of the wave.
   * @param waveIndex - index of the wave to set.
   * @param val - Length of the wave.
   */
  setWaveLength(waveIndex: number, val: number) {
    if (waveIndex < MAX_NUM_WAVES) {
      this._waveParams[waveIndex * 8 + 3] = val;
    }
  }
  /**
   * Gets the length of the wave.
   * @param waveIndex - index of the wave to set.
   * @returns Length of the wave.
   */
  getWaveLength(waveIndex: number) {
    return waveIndex < MAX_NUM_WAVES ? this._waveParams[waveIndex * 8 + 3] : 0;
  }
  /**
   * Query if the wave is an omni-directional wave.
   * @param waveIndex - index of the wave to set.
   * @returns true if the wave is an omni-directional wave, false otherwise.
   */
  isOmniWave(waveIndex: number): boolean {
    return waveIndex < MAX_NUM_WAVES ? this._waveParams[waveIndex * 8 + 7] !== 0 : false;
  }
  /**
   * Sets whether the wave is an omni-directional wave.
   * @param waveIndex - index of the wave to set.
   * @param isOmni - true if the wave is an omni-directional wave, false otherwise.
   */
  setOmniWave(waveIndex: number, isOmni: boolean) {
    if (waveIndex < MAX_NUM_WAVES) {
      this._waveParams[waveIndex * 8 + 7] = isOmni ? 1 : 0;
    }
  }
  /**
   * Gets the X coordinate of the wave origin if it is an omni-directional wave.
   * @param waveIndex - index of the wave to set.
   * @returns X coordinate of the wave origin if it is an omni-directional wave, 0 otherwise.
   */
  getOriginX(waveIndex: number) {
    return waveIndex < MAX_NUM_WAVES ? this._waveParams[waveIndex * 8 + 4] : 0;
  }
  /**
   * Gets the Z coordinate of the wave origin if it is an omni-directional wave.
   * @param waveIndex - index of the wave to set.
   * @returns Z coordinate of the wave origin if it is an omni-directional wave, 0 otherwise.
   */
  getOriginZ(waveIndex: number) {
    return waveIndex < MAX_NUM_WAVES ? this._waveParams[waveIndex * 8 + 6] : 0;
  }
  /**
   * Sets the X and Z coordinates of the wave origin if it is an omni-directional wave.
   * @param waveIndex - index of the wave to set.
   * @param x - X coordinate of the wave origin
   * @param z - Z coordinate of the wave origin
   */
  setOrigin(waveIndex: number, x: number, z: number) {
    if (waveIndex < MAX_NUM_WAVES) {
      this._waveParams[waveIndex * 8 + 4] = x;
      this._waveParams[waveIndex * 8 + 6] = z;
    }
  }
  /** @internal */
  private randomWave(i: number) {
    this._waveParams[i * 8 + 0] = Math.random() * Math.PI * 2;
    this._waveParams[i * 8 + 1] = Math.random() * 0.5 + 0.5;
    this._waveParams[i * 8 + 2] = Math.random() * 0.1;
    this._waveParams[i * 8 + 3] = Math.random() * 10;
    this._waveParams[i * 8 + 4] = Math.random() * 100 - 50;
    this._waveParams[i * 8 + 5] = 0;
    this._waveParams[i * 8 + 6] = Math.random() * 100 - 50;
    this._waveParams[i * 8 + 7] = 0;
  }
  /** {@inheritDoc WaveGenerator.update} */
  update(timeInSeconds: number): void {
    this._currentTime = timeInSeconds;
  }
  /** {@inheritDoc WaveGenerator.calcClipmapTileAABB} */
  calcClipmapTileAABB(minX: number, maxX: number, minZ: number, maxZ: number, y: number, outAABB: AABB) {
    let maxHeight = 0;
    for (let i = 0; i < this._numWaves; i++) {
      const h = this._waveParams[i * 8 + 2];
      if (h > maxHeight) {
        maxHeight = h;
      }
    }
    outAABB.minPoint.setXYZ(minX, y, minZ);
    outAABB.maxPoint.setXYZ(maxX, y + maxHeight, maxZ);
  }
  /** {@inheritDoc WaveGenerator.calcFragmentNormal} */
  calcFragmentNormal(scope: PBInsideFunctionScope, xz: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    pb.func('calcFragmentNormal', [pb.vec2('xz')], function () {
      this.$l.inPos = pb.vec3(this.xz.x, 0, this.xz.y);
      this.$l.outPos = pb.vec3();
      this.$l.outNormal = pb.vec3();
      that.calcNormalAndPos(this, this.inPos, this.outPos, this.outNormal);
      this.$return(this.outNormal);
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
    scope.time = pb.float().uniform(uniformGroup);
    scope.numWaves = pb.float().uniform(uniformGroup);
    scope.waveParams = pb.vec4[MAX_NUM_WAVES * 2]().uniform(uniformGroup);
  }
  /** @internal */
  private gerstnerWave(
    scope: PBInsideFunctionScope,
    waveParam: PBShaderExp,
    omniParam: PBShaderExp,
    time: PBShaderExp,
    inPos: PBShaderExp,
    outNormal: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    pb.func(
      'gerstnerWave',
      [
        pb.vec4('waveParam'),
        pb.vec4('omniParam'),
        pb.float('time'),
        pb.vec3('inPos'),
        pb.vec3('outNormal').out()
      ],
      function () {
        this.$l.amplitude = pb.max(this.waveParam.z, 0.01);
        this.$l.wavelength = this.waveParam.w;
        this.$l.omniPos = this.omniParam.xz;
        this.$l.omni = this.omniParam.w;
        this.$l.direction = pb.vec2(pb.sin(this.waveParam.x), pb.cos(this.waveParam.x));
        this.$l.w = pb.max(0.001, pb.div(Math.PI * 2, this.wavelength));
        this.$l.wSpeed = pb.sqrt(pb.mul(9.8, this.w));
        this.$l.peak = this.waveParam.y;
        this.$l.qi = pb.div(this.peak, pb.mul(this.amplitude, this.w, this.numWaves));
        this.$l.dirWaveInput = pb.mul(this.direction, pb.sub(1, this.omni));
        this.$l.omniWaveInput = pb.mul(pb.sub(this.inPos.xz, this.omniPos), this.omni);
        this.$l.windDir = pb.normalize(pb.add(this.dirWaveInput, this.omniWaveInput));
        this.$l.dir = pb.dot(this.windDir, pb.sub(this.inPos.xz, pb.mul(this.omniPos, this.omni)));
        this.$l.calc = pb.sub(pb.mul(this.dir, this.w), pb.mul(this.wSpeed, this.time));
        this.$l.cosCalc = pb.cos(this.calc);
        this.$l.sinCalc = pb.sin(this.calc);
        this.$l.waveXZ = pb.mul(this.windDir.xy, this.qi, this.amplitude, this.cosCalc);
        this.$l.waveY = pb.div(pb.mul(this.sinCalc, this.amplitude), this.numWaves);
        this.$l.wave = pb.vec3(this.waveXZ.x, this.waveY, this.waveXZ.y);
        this.$l.wa = pb.mul(this.w, this.amplitude);
        this.$l.n = pb.vec3(
          pb.neg(pb.mul(this.windDir.xy, this.wa, this.cosCalc)),
          pb.sub(1, pb.mul(this.qi, this.wa, this.sinCalc))
        );
        this.outNormal = pb.div(this.n.xzy, this.numWaves);
        this.$return(pb.mul(this.wave, pb.clamp(pb.mul(this.amplitude, 10000), 0, 1)));
      }
    );
    return scope.gerstnerWave(waveParam, omniParam, time, inPos, outNormal);
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
        this.outPos = this.inPos;
        this.outNormal = pb.vec3(0);
        this.$for(
          pb.float('i'),
          0,
          pb.getDevice().type === 'webgl' ? MAX_NUM_WAVES : this.numWaves,
          function () {
            if (pb.getDevice().type === 'webgl') {
              this.$if(pb.greaterThanEqual(this.i, this.numWaves), function () {
                this.$break();
              });
            }
            this.$l.waveNormal = pb.vec3();
            this.$l.wavePos = that.gerstnerWave(
              this,
              this.waveParams.at(pb.mul(this.i, 2)),
              this.waveParams.at(pb.add(pb.mul(this.i, 2), 1)),
              this.time,
              this.inPos,
              this.waveNormal
            );
            this.outPos = pb.add(this.outPos, this.wavePos);
            this.outNormal = pb.add(this.outNormal, this.waveNormal);
          }
        );
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
    bindGroup.setValue('time', this._currentTime);
    bindGroup.setValue('numWaves', this._numWaves);
    bindGroup.setValue('waveParams', this._waveParams);
  }
  /** {@inheritDoc WaveGenerator.isOk} */
  isOk(): boolean {
    return true;
  }
  /** {@inheritDoc WaveGenerator.getHash} */
  getHash(): string {
    return 'GerstnerWaveGenerator';
  }
  /** {@inheritDoc WaveGenerator.dispose} */
  dispose(): void {
    this._disposed = true;
  }
}
