import type { PBInsideFunctionScope, PBShaderExp } from "@zephyr3d/device";

/**
 * Generate single float noise from a vec2
 *
 * @param scope - Current shader scope
 * @param p - random seed
 * @returns a float noise value
 *
 * @public
 */
export function noisef(scope: PBInsideFunctionScope, p: PBShaderExp) {
  const pb = scope.$builder;
  const funcNameHash = 'lib_hashf';
  const funcNameNoise = 'lib_noisef';
  pb.func(funcNameHash, [pb.vec2('p')], function () {
    this.h = pb.dot(this.p, pb.vec2(127.1, 311.7));
    this.$return(pb.fract(pb.mul(pb.sin(this.h), 43758.5453123)));
  });
  pb.func(funcNameNoise, [pb.vec2('p')], function () {
    this.i = pb.floor(this.p);
    this.f = pb.fract(this.p);
    this.u = pb.mul(this.f, this.f, pb.sub(3, pb.mul(this.f, 2)));
    this.h1 = this[funcNameHash](this.i);
    this.h2 = this[funcNameHash](pb.add(this.i, pb.vec2(1, 0)));
    this.h3 = this[funcNameHash](pb.add(this.i, pb.vec2(0, 1)));
    this.h4 = this[funcNameHash](pb.add(this.i, pb.vec2(1, 1)));
    this.$return(
      pb.add(
        -1,
        pb.mul(
          2,
          pb.mix(pb.mix(this.h1, this.h2, this.u.x), pb.mix(this.h3, this.h4, this.u.x), this.u.y)
        )
      )
    );
  });
  return scope[funcNameNoise](p);
}
/**
 * worley 3d noise
 *
 * @param scope - current shader scope
 * @param uv - uv coordinate
 * @param freq - frequency
 *
 * @returns worley noise value
 *
 * @public
 */
export function worleyNoise(scope: PBInsideFunctionScope, uv: PBShaderExp, freq: PBShaderExp|number): PBShaderExp {
  const pb = scope.$builder;
  const funcNameHash = 'lib_worleyHash';
  // https://www.shadertoy.com/view/4sc3z2
  pb.func(funcNameHash, [pb.vec3('p')], function(){
    /* eslint-disable no-constant-condition */
    if (1) {
      this.$l.mod3 = pb.vec3(0.1031, 0.11369, 0.13787);
      this.$l.p3 = pb.fract(pb.mul(this.p, this.mod3));
      this.p3 = pb.add(this.p3, pb.dot(this.p3, pb.add(this.p3.yxz, pb.vec3(19.19))));
      this.$return(pb.sub(pb.mul(pb.fract(pb.vec3(pb.mul(pb.add(this.p3.x, this.p3.y), this.p3.z), pb.mul(pb.add(this.p3.x, this.p3.z), this.p3.y), pb.mul(pb.add(this.p3.y, this.p3.z), this.p3.x))), 2), 1));
    } else {
      this.$l.UI0 = pb.uint(1597334673);
      this.$l.UI1 = pb.uint(3812015801);
      this.$l.UI2 = pb.uvec2(this.UI0, this.UI1);
      this.$l.UI3 = pb.uvec3(this.UI0, this.UI1, pb.uint(2798796415));
      this.$l.UIF = pb.div(1, pb.float(pb.uint(0xffffffff)));
      this.$l.q = pb.mul(pb.uvec3(pb.ivec3(this.p)), this.UI3);
      this.q = pb.mul(pb.compXor(pb.compXor(this.q.x, this.q.y), this.q.z), this.UI3);
      this.$return(pb.sub(pb.mul(pb.vec3(this.q), this.UIF, 2), pb.vec3(1)));
    }
  });
  const funcNameNoise = 'lib_worleyNoise';
  pb.func(funcNameNoise, [pb.vec3('uv'), pb.float('freq')], function(){
    this.$l.id = pb.floor(this.uv);
    this.$l.p = pb.fract(this.uv);
    this.$l.minDist = pb.float(10000);
    this.$for(pb.int('x'), -1, 2, function(){
      this.$for(pb.int('y'), -1, 2, function(){
        this.$for(pb.int('z'), -1, 2, function(){
          this.$l.offset = pb.vec3(pb.float(this.x), pb.float(this.y), pb.float(this.z));
          /* eslint-disable no-constant-condition */
          if (1 /* tilable */) {
            this.$l.h = pb.add(pb.mul(this[funcNameHash](pb.mod(pb.add(this.id, this.offset), pb.vec3(this.freq))), 0.4), pb.vec3(0.3));
          } else {
            this.$l.h = pb.add(pb.mul(this[funcNameHash](pb.add(this.id, this.offset)), 0.4), pb.vec3(0.3));
          }
          this.h = pb.add(this.h, this.offset);
          this.$l.d = pb.sub(this.p, this.h);
          this.minDist = pb.min(this.minDist, pb.dot(this.d, this.d));
        });
      });
    });
    this.$return(pb.sub(1, this.minDist));
  });
  return pb.getGlobalScope()[funcNameNoise](uv, freq);
}
/**
 * Calculate worley FBM
 *
 * @param scope - current shader scope
 * @param p - noise coordinate
 * @param freq - frequency
 * @returns worley FBM value
 *
 * @public
 */
export function worleyFBM(scope: PBInsideFunctionScope, p: PBShaderExp, freq: PBShaderExp|number): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'lib_worleyFBM';
  pb.func(funcName, [pb.vec3('p'), pb.float('freq')], function(){
    this.$l.n1 = worleyNoise(this, pb.mul(this.p, this.freq), this.freq);
    this.$l.n2 = worleyNoise(this, pb.mul(this.p, this.freq, 2), pb.mul(this.freq, 2));
    this.$l.n3 = worleyNoise(this, pb.mul(this.p, this.freq, 4), pb.mul(this.freq, 4));
    this.$l.fbm = pb.add(pb.mul(this.n1, 0.625), pb.mul(this.n2, 0.25), pb.mul(this.n3, 0.125));
    this.$return(pb.max(pb.sub(pb.mul(this.fbm, 1.1), pb.vec3(0.1)), pb.vec3(0)));
  });
  return pb.getGlobalScope()[funcName](p, freq);
}
/**
 * Calculate 3d noise by a 3d position
 *
 * @param scope - current shader scope
 * @param p - 3d position at where to calculate noise
 * @returns noise value between 0 and 1
 *
 * @public
 */
export function noise3D(scope: PBInsideFunctionScope, p: PBShaderExp): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'lib_noise3d';
  pb.func(funcName, [pb.vec3('p')], function(){
    this.$l.p3 = pb.fract(pb.mul(this.p, 0.1031));
    this.$l.p3 = pb.add(this.p3, pb.vec3(pb.dot(this.p3, pb.add(this.p3.yzx, pb.vec3(33.33)))));
    this.$return(pb.fract(pb.mul(pb.add(this.p3.x, this.p3.y), this.p3.z)));
  });
  return pb.getGlobalScope()[funcName](p);
}
/**
 * Calculate smooth 3d noise by a 3d position
 *
 * @param scope - current shader scope
 * @param p - 3d position at where to calculate noise
 * @returns noise value between 0 and 1
 *
 * @public
 */
export function smoothNoise3D(scope: PBInsideFunctionScope, p: PBShaderExp): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'lib_smoothNoise3D';
  pb.func(funcName, [pb.vec3('p')], function(){
    this.$l.cell = pb.floor(this.p);
    this.$l.local = pb.fract(this.p);
    this.$l.local = pb.mul(this.local, pb.mul(this.local, pb.sub(pb.vec3(3), pb.mul(this.local, 2))));
    this.$l.ldb = noise3D(this, this.cell);
    this.$l.rdb = noise3D(this, pb.add(this.cell, pb.vec3(1, 0, 0)));
    this.$l.ldf = noise3D(this, pb.add(this.cell, pb.vec3(0, 0, 1)));
    this.$l.rdf = noise3D(this, pb.add(this.cell, pb.vec3(1, 0, 1)));
    this.$l.lub = noise3D(this, pb.add(this.cell, pb.vec3(0, 1, 0)));
    this.$l.rub = noise3D(this, pb.add(this.cell, pb.vec3(1, 1, 0)));
    this.$l.luf = noise3D(this, pb.add(this.cell, pb.vec3(0, 1, 1)));
    this.$l.ruf = noise3D(this, pb.add(this.cell, pb.vec3(1, 1, 1)));
    this.$return(pb.mix(
      pb.mix(pb.mix(this.ldb, this.rdb, this.local.x), pb.mix(this.ldf, this.rdf, this.local.x), this.local.z),
      pb.mix(pb.mix(this.lub, this.rub, this.local.x), pb.mix(this.luf, this.ruf, this.local.x), this.local.z),
      this.local.y));
  });
  return pb.getGlobalScope()[funcName](p);
}
