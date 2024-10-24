import type { AABB } from '@zephyr3d/base';
import { WaveGenerator } from './wavegenerator';
import type {
  AbstractDevice,
  BindGroup,
  PBGlobalScope,
  PBInsideFunctionScope,
  PBShaderExp
} from '@zephyr3d/device';

const MAX_NUM_WAVES = 64;

export class GerstnerWaveGenerator extends WaveGenerator {
  private _currentTime: number;
  private _waveParams: Float32Array;
  private _numWaves: number;
  constructor() {
    super();
    this._currentTime = 0;
    this._numWaves = 1;
    this._waveParams = new Float32Array(8 * MAX_NUM_WAVES);
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
      this._waveParams[waveIndex * 8 + 0] = x;
      this._waveParams[waveIndex * 8 + 1] = y;
    }
  }
  setWaveDirectionX(waveIndex: number, x: number) {
    if (waveIndex < MAX_NUM_WAVES) {
      this._waveParams[waveIndex * 8 + 0] = x;
    }
  }
  getWaveDirectionX(waveIndex: number): number {
    return waveIndex < MAX_NUM_WAVES ? this._waveParams[waveIndex * 8 + 0] : 0;
  }
  setWaveDirectionY(waveIndex: number, y: number) {
    if (waveIndex < MAX_NUM_WAVES) {
      this._waveParams[waveIndex * 8 + 1] = y;
    }
  }
  getWaveDirectionY(waveIndex: number): number {
    return waveIndex < MAX_NUM_WAVES ? this._waveParams[waveIndex * 8 + 1] : 0;
  }
  setWaveAmplitude(waveIndex: number, val: number) {
    if (waveIndex < MAX_NUM_WAVES) {
      this._waveParams[waveIndex * 8 + 2] = val;
    }
  }
  getWaveAmplitude(waveIndex: number) {
    return waveIndex < MAX_NUM_WAVES ? this._waveParams[waveIndex * 8 + 2] : 0;
  }
  setWaveLength(waveIndex: number, val: number) {
    if (waveIndex < MAX_NUM_WAVES) {
      this._waveParams[waveIndex * 8 + 3] = val;
    }
  }
  getWaveLength(waveIndex: number) {
    return waveIndex < MAX_NUM_WAVES ? this._waveParams[waveIndex * 8 + 3] : 0;
  }
  isOmniWave(waveIndex: number): boolean {
    return waveIndex < MAX_NUM_WAVES ? this._waveParams[waveIndex * 8 + 7] !== 0 : false;
  }
  setOmniWave(waveIndex: number, isOmni: boolean) {
    if (waveIndex < MAX_NUM_WAVES) {
      this._waveParams[waveIndex * 8 + 7] = isOmni ? 1 : 0;
    }
  }
  getOriginX(waveIndex: number) {
    return waveIndex < MAX_NUM_WAVES ? this._waveParams[waveIndex * 8 + 4] : 0;
  }
  getOriginZ(waveIndex: number) {
    return waveIndex < MAX_NUM_WAVES ? this._waveParams[waveIndex * 8 + 6] : 0;
  }
  setOrigin(waveIndex: number, x: number, z: number) {
    if (waveIndex < MAX_NUM_WAVES) {
      this._waveParams[waveIndex * 8 + 4] = x;
      this._waveParams[waveIndex * 8 + 6] = z;
    }
  }
  private randomWave(i: number) {
    this._waveParams[i * 8 + 0] = Math.random() * 2 - 1;
    this._waveParams[i * 8 + 1] = Math.random() * 2 - 1;
    this._waveParams[i * 8 + 2] = Math.random() * 0.5;
    this._waveParams[i * 8 + 3] = Math.random() * 50;
    this._waveParams[i * 8 + 7] = 0;
  }
  update(timeInSeconds: number): void {
    this._currentTime = timeInSeconds;
  }
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
  calcFragmentNormalAndFoam(scope: PBInsideFunctionScope, xz: PBShaderExp): PBShaderExp {
    return scope.$builder.vec4(this.calcFragmentNormal(scope, xz), 0);
  }
  setupUniforms(scope: PBGlobalScope): void {
    const pb = scope.$builder;
    scope.time = pb.float().uniform(0);
    scope.numWaves = pb.int().uniform(0);
    scope.waveParams = pb.vec4[MAX_NUM_WAVES * 2]().uniform(0);
  }
  private gerstnerWave(
    scope: PBInsideFunctionScope,
    waveParam: PBShaderExp,
    omniParam: PBShaderExp,
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
        pb.vec4('omniParam'),
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
        this.$l.d = pb.mix(
          pb.normalize(this.waveParam.xy),
          pb.normalize(pb.sub(this.inPos.xz, this.omniParam.xz)),
          this.omniParam.w
        );
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
    return scope.gerstnerWave(waveParam, omniParam, time, inPos, tangent, bitangent);
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
                this.waveParams.at(pb.mul(this.i, 2)),
                this.waveParams.at(pb.add(pb.mul(this.i, 2), 1)),
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