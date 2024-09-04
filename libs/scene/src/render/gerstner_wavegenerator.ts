import type { AABB } from '@zephyr3d/base';
import { WaveGenerator } from './wavegenerator';
import type { AbstractDevice, BindGroup, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';

const MAX_NUM_WAVES = 64;

export class GerstnerWaveGenerator extends WaveGenerator {
  private _currentTime: number;
  private _waveParams: Float32Array;
  private _numWaves: number;
  constructor() {
    super();
    this._currentTime = 0;
    this._numWaves = 1;
    this._waveParams = new Float32Array(4 * MAX_NUM_WAVES);
    this.randomWave(0);
  }
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
  setWaveDirection(waveIndex: number, x: number, y: number) {
    if (waveIndex < MAX_NUM_WAVES) {
      this._waveParams[waveIndex * 4 + 0] = x;
      this._waveParams[waveIndex * 4 + 1] = y;
    }
  }
  setWaveDirectionX(waveIndex: number, x: number) {
    if (waveIndex < MAX_NUM_WAVES) {
      this._waveParams[waveIndex * 4 + 0] = x;
    }
  }
  getWaveDirectionX(waveIndex: number): number {
    return waveIndex < MAX_NUM_WAVES ? this._waveParams[waveIndex * 4 + 0] : 0;
  }
  setWaveDirectionY(waveIndex: number, y: number) {
    if (waveIndex < MAX_NUM_WAVES) {
      this._waveParams[waveIndex * 4 + 1] = y;
    }
  }
  getWaveDirectionY(waveIndex: number): number {
    return waveIndex < MAX_NUM_WAVES ? this._waveParams[waveIndex * 4 + 1] : 0;
  }
  setWaveAmplitude(waveIndex: number, val: number) {
    if (waveIndex < MAX_NUM_WAVES) {
      this._waveParams[waveIndex * 4 + 2] = val;
    }
  }
  getWaveAmplitude(waveIndex: number) {
    return waveIndex < MAX_NUM_WAVES ? this._waveParams[waveIndex * 4 + 2] : 0;
  }
  setWaveLength(waveIndex: number, val: number) {
    if (waveIndex < MAX_NUM_WAVES) {
      this._waveParams[waveIndex * 4 + 3] = val;
    }
  }
  getWaveLength(waveIndex: number) {
    return waveIndex < MAX_NUM_WAVES ? this._waveParams[waveIndex * 4 + 3] : 0;
  }
  private randomWave(i: number) {
    this._waveParams[i * 4 + 0] = Math.random() * 2 - 1;
    this._waveParams[i * 4 + 1] = Math.random() * 2 - 1;
    this._waveParams[i * 4 + 2] = Math.random() * 0.5;
    this._waveParams[i * 4 + 3] = Math.random() * 50;
  }
  update(timeInSeconds: number): void {
    this._currentTime = timeInSeconds;
  }
  calcClipmapTileAABB(minX: number, maxX: number, minZ: number, maxZ: number, y: number, outAABB: AABB) {
    let maxHeight = 0;
    for (let i = 0; i < this._numWaves; i++) {
      const h = this._waveParams[i * 4 + 2];
      if (h > maxHeight) {
        maxHeight = h;
      }
    }
    outAABB.minPoint.setXYZ(minX, y, minZ);
    outAABB.maxPoint.setXYZ(maxX, y + maxHeight, maxZ);
  }
  calcFragmentNormalAndFoam(
    scope: PBInsideFunctionScope,
    xz: PBShaderExp,
    vertexNormal: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    scope.time = pb.float().uniform(0);
    scope.numWaves = pb.int().uniform(0);
    scope.waveParams = pb.vec4[MAX_NUM_WAVES]().uniform(0);
    pb.func('calcNormalAndFoam', [pb.vec2('xz')], function () {
      this.$l.inPos = pb.vec3(this.xz.x, 0, this.xz.y);
      this.$l.outPos = pb.vec3();
      this.$l.outNormal = pb.vec3();
      that.calcNormalAndPos(this, this.inPos, this.outPos, this.outNormal);
      this.$return(pb.vec4(this.outNormal, 0));
    });
    return scope.calcNormalAndFoam(xz);
  }
  private gerstnerWave(
    scope: PBInsideFunctionScope,
    waveParam: PBShaderExp,
    time: PBShaderExp,
    inPos: PBShaderExp,
    tangent: PBShaderExp,
    bitangent: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    pb.func(
      'gerstnerWave',
      [
        pb.vec4('waveParam'),
        pb.float('time'),
        pb.vec3('inPos'),
        pb.vec3('tangent').inout(),
        pb.vec3('bitangent').inout()
      ],
      function () {
        this.$l.pos = pb.vec3(0);
        this.$l.steepness = this.waveParam.z;
        this.$l.wavelength = this.waveParam.w;
        this.$l.k = pb.div(2 * Math.PI, this.wavelength);
        this.$l.c = pb.sqrt(pb.div(9.8, this.k));
        this.$l.d = pb.normalize(this.waveParam.xy);
        this.$l.f = pb.mul(this.k, pb.sub(pb.dot(this.d, this.inPos.xz), pb.mul(this.c, this.time)));
        this.$l.a = pb.div(this.steepness, this.k);
        this.tangent = pb.add(
          this.tangent,
          pb.vec3(
            pb.mul(pb.neg(this.d.x), this.d.x, this.steepness, pb.sin(this.f)),
            pb.mul(this.d.x, this.steepness, pb.cos(this.f)),
            pb.mul(pb.neg(this.d.x), this.d.y, this.steepness, pb.sin(this.f))
          )
        );
        this.bitangent = pb.add(
          this.bitangent,
          pb.vec3(
            pb.mul(pb.neg(this.d.x), this.d.y, this.steepness, pb.sin(this.f)),
            pb.mul(this.d.y, this.steepness, pb.cos(this.f)),
            pb.mul(pb.neg(this.d.y), this.d.y, this.steepness, pb.sin(this.f))
          )
        );
        this.pos.x = pb.mul(this.d.x, this.a, pb.cos(this.f));
        this.pos.y = pb.mul(this.a, pb.sin(this.f));
        this.pos.z = pb.mul(this.d.y, this.a, pb.cos(this.f));
        this.$return(this.pos);
      }
    );
    return scope.gerstnerWave(waveParam, time, inPos, tangent, bitangent);
  }
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
        this.$l.tangent = pb.vec3(1, 0, 0);
        this.$l.bitangent = pb.vec3(0, 0, 1);
        this.$l.wavePos = pb.vec3(0);
        this.$for(
          pb.int('i'),
          0,
          pb.getDevice().type === 'webgl' ? MAX_NUM_WAVES : this.numWaves,
          function () {
            if (pb.getDevice().type === 'webgl') {
              this.$if(pb.greaterThanEqual(this.i, this.numWaves), function () {
                this.$break();
              });
            }
            this.wavePos = pb.add(
              this.wavePos,
              that.gerstnerWave(
                this,
                this.waveParams.at(this.i),
                this.time,
                this.inPos,
                this.tangent,
                this.bitangent
              )
            );
            this.outPos = pb.add(this.inPos, this.wavePos);
            this.outNormal = pb.cross(pb.normalize(this.bitangent), pb.normalize(this.tangent));
          }
        );
      }
    );
    scope.calcPositionAndNormal(inPos, outPos, outNormal);
  }
  calcVertexPositionAndNormal(
    scope: PBInsideFunctionScope,
    inPos: PBShaderExp,
    outPos: PBShaderExp,
    outNormal: PBShaderExp
  ): void {
    const pb = scope.$builder;
    scope.time = pb.float().uniform(0);
    scope.numWaves = pb.int().uniform(0);
    scope.waveParams = pb.vec4[MAX_NUM_WAVES]().uniform(0);
    this.calcNormalAndPos(scope, inPos, outPos, outNormal);
  }
  applyWaterBindGroup(bindGroup: BindGroup): void {
    bindGroup.setValue('time', this._currentTime);
    bindGroup.setValue('numWaves', this._numWaves);
    bindGroup.setValue('waveParams', this._waveParams);
  }
  isOk(): boolean {
    return true;
  }
  getHash(device: AbstractDevice): string {
    return '';
  }
  dispose(): void {}
}
