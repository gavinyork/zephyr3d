import type { PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';

/**
 * Generate random float value from a float
 *
 * @param scope - Current shader scope
 * @param p - random seed
 * @returns random float value
 *
 * @public
 */
export function hash11(scope: PBInsideFunctionScope, p: number | PBShaderExp): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'Z_hash11';
  pb.func(funcName, [pb.float('p')], function () {
    this.$l.x = pb.fract(pb.mul(this.p, 0.1031));
    this.x = pb.mul(this.x, pb.add(this.x, 33.33));
    this.x = pb.mul(this.x, pb.add(this.x, this.x));
    this.$return(pb.fract(this.x));
  });
  return scope[funcName](p);
}

/**
 * Generate random float value from a vec2
 *
 * @param scope - Current shader scope
 * @param p - random seed
 * @returns random float value
 *
 * @public
 */
export function hash21(scope: PBInsideFunctionScope, p: PBShaderExp): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'Z_hash21';
  pb.func(funcName, [pb.vec2('p')], function () {
    this.$l.p3 = pb.fract(pb.mul(this.p.xyx, 0.1031));
    this.p3 = pb.add(this.p3, pb.dot(this.p3, pb.add(this.p3.yzx, pb.vec3(33.33))));
    this.$return(pb.fract(pb.mul(pb.add(this.p3.x, this.p3.y), this.p3.z)));
  });
  return scope[funcName](p);
}

/**
 * Generate random float value from a vec3
 *
 * @param scope - Current shader scope
 * @param p - random seed
 * @returns random float value
 *
 * @public
 */
export function hash31(scope: PBInsideFunctionScope, p: PBShaderExp): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'Z_hash31';
  pb.func(funcName, [pb.vec3('p')], function () {
    this.$l.p3 = pb.fract(pb.mul(this.p, 0.1031));
    this.p3 = pb.add(this.p3, pb.dot(this.p3, pb.add(this.p3.zyx, pb.vec3(31.32))));
    this.$return(pb.fract(pb.mul(pb.add(this.p3.x, this.p3.y), this.p3.z)));
  });
  return scope[funcName](p);
}

/**
 * Generate random vec2 value from a float
 *
 * @param scope - Current shader scope
 * @param p - random seed
 * @returns random vec2 value
 *
 * @public
 */
export function hash12(scope: PBInsideFunctionScope, p: number | PBShaderExp): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'Z_hash12';
  pb.func(funcName, [pb.float('p')], function () {
    this.$l.p3 = pb.fract(pb.mul(pb.vec3(0.1031, 0.103, 0.0973), this.p));
    this.p3 = pb.add(this.p3, pb.dot(this.p3, pb.add(this.p3.yzx, pb.vec3(33.33))));
    this.$return(pb.fract(pb.mul(pb.add(this.p3.xx, this.p3.yz), this.p3.zy)));
  });
  return scope[funcName](p);
}

/**
 * Generate random vec2 value from a vec2
 *
 * @param scope - Current shader scope
 * @param p - random seed
 * @returns random vec2 value
 *
 * @public
 */
export function hash22(scope: PBInsideFunctionScope, p: PBShaderExp): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'Z_hash22';
  pb.func(funcName, [pb.vec2('p')], function () {
    this.$l.p3 = pb.fract(pb.mul(this.p.xyx, pb.vec3(0.1031, 0.103, 0.0973)));
    this.p3 = pb.add(this.p3, pb.dot(this.p3, pb.add(this.p3.yzx, pb.vec3(33.33))));
    this.$return(pb.fract(pb.mul(pb.add(this.p3.xx, this.p3.yz), this.p3.zy)));
  });
  return scope[funcName](p);
}

/**
 * Generate random vec2 value from a vec3
 *
 * @param scope - Current shader scope
 * @param p - random seed
 * @returns random vec2 value
 *
 * @public
 */
export function hash32(scope: PBInsideFunctionScope, p: PBShaderExp): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'Z_hash32';
  pb.func(funcName, [pb.vec3('p')], function () {
    this.$l.p3 = pb.fract(pb.mul(this.p, pb.vec3(0.1031, 0.103, 0.0973)));
    this.p3 = pb.add(this.p3, pb.dot(this.p3, pb.add(this.p3.yzx, pb.vec3(33.33))));
    this.$return(pb.fract(pb.mul(pb.add(this.p3.xx, this.p3.yz), this.p3.zy)));
  });
  return scope[funcName](p);
}

/**
 * Generate random vec3 value from a float
 *
 * @param scope - Current shader scope
 * @param p - random seed
 * @returns random vec3 value
 *
 * @public
 */
export function hash13(scope: PBInsideFunctionScope, p: number | PBShaderExp): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'Z_hash13';
  pb.func(funcName, [pb.float('p')], function () {
    this.$l.p3 = pb.fract(pb.mul(pb.vec3(0.1031, 0.103, 0.0973), this.p));
    this.p3 = pb.add(this.p3, pb.dot(this.p3, pb.add(this.p3.yzx, pb.vec3(33.33))));
    this.$return(pb.fract(pb.mul(pb.add(this.p3.xxy, this.p3.yzz), this.p3.zyx)));
  });
  return scope[funcName](p);
}

/**
 * Generate random vec3 value from a vec2
 *
 * @param scope - Current shader scope
 * @param p - random seed
 * @returns random vec3 value
 *
 * @public
 */
export function hash23(scope: PBInsideFunctionScope, p: PBShaderExp): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'Z_hash23';
  pb.func(funcName, [pb.vec2('p')], function () {
    this.$l.p3 = pb.fract(pb.mul(pb.vec3(0.1031, 0.103, 0.0973), this.p.xyx));
    this.p3 = pb.add(this.p3, pb.dot(this.p3, pb.add(this.p3.yzx, pb.vec3(33.33))));
    this.$return(pb.fract(pb.mul(pb.add(this.p3.xxy, this.p3.yzz), this.p3.zyx)));
  });
  return scope[funcName](p);
}

/**
 * Generate random vec3 value from a vec3
 *
 * @param scope - Current shader scope
 * @param p - random seed
 * @returns random vec3 value
 *
 * @public
 */
export function hash33(scope: PBInsideFunctionScope, p: PBShaderExp): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'Z_hash33';
  pb.func(funcName, [pb.vec3('p')], function () {
    this.$l.p3 = pb.fract(pb.mul(pb.vec3(0.1031, 0.103, 0.0973), this.p));
    this.p3 = pb.add(this.p3, pb.dot(this.p3, pb.add(this.p3.yzx, pb.vec3(33.33))));
    this.$return(pb.fract(pb.mul(pb.add(this.p3.xxy, this.p3.yzz), this.p3.zyx)));
  });
  return scope[funcName](p);
}

/**
 * Generate uniform distributed white noise from a vec2
 *
 * @param scope - Current shader scope
 * @param p - random seed
 * @returns random float value
 *
 * @public
 */
export function whiteNoise(scope: PBInsideFunctionScope, p: PBShaderExp): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'Z_whiteNoise';
  pb.func(funcName, [pb.vec2('p')], function () {
    this.$return(pb.fract(pb.mul(pb.sin(pb.dot(this.p, pb.vec2(12.9898, 78.233))), 43758.5453)));
  });
  return scope[funcName](p);
}

/**
 * Generate value noise from a vec2
 *
 * @param scope - Current shader scope
 * @param p - random seed
 * @returns random float value
 *
 * @public
 */
export function valueNoise(scope: PBInsideFunctionScope, p: PBShaderExp): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'Z_valueNoise';
  pb.func(funcName, [pb.vec2('p')], function () {
    this.$l.i = pb.floor(this.p);
    this.$l.f = pb.fract(this.p);
    this.f = pb.mul(this.f, this.f, pb.sub(pb.vec2(3), pb.mul(this.f, 2)));
    this.$l.c0 = this.i;
    this.$l.c1 = pb.add(this.i, pb.vec2(1, 0));
    this.$l.c2 = pb.add(this.i, pb.vec2(0, 1));
    this.$l.c3 = pb.add(this.i, pb.vec2(1));
    this.$l.r0 = whiteNoise(this, this.c0);
    this.$l.r1 = whiteNoise(this, this.c1);
    this.$l.r2 = whiteNoise(this, this.c2);
    this.$l.r3 = whiteNoise(this, this.c3);
    this.$return(pb.mix(pb.mix(this.r0, this.r1, this.f.x), pb.mix(this.r2, this.r3, this.f.x), this.f.y));
  });
  return scope[funcName](p);
}

/**
 * Generate random float value from a vec2
 *
 * @param scope - Current shader scope
 * @param p - random seed
 * @returns random float value
 *
 * @public
 */
export function gradient(scope: PBInsideFunctionScope, p: PBShaderExp, t: PBShaderExp | number) {
  const pb = scope.$builder;
  const funcName = 'Z_gradient2f';
  pb.func(funcName, [pb.vec2('p'), pb.float('t')], function () {
    this.$l.rand = hash21(this, this.p);
    this.$l.angle = pb.mul(pb.add(this.t, Math.PI * 2), this.rand);
    this.$return(pb.vec2(pb.cos(this.angle), pb.sin(this.angle)));
  });
  return scope[funcName](p, t);
}

/**
 * Generate a float perlin noise value from a vec2
 *
 * @param scope - Current shader scope
 * @param p - 2d vector
 * @returns a float noise value
 *
 * @public
 */
export function perlinNoise2D(scope: PBInsideFunctionScope, p: PBShaderExp) {
  return perlinNoise3D(scope, scope.$builder.vec3(p, 0));
}

/**
 * Generate a float perlin noise value from a vec3
 *
 * @param scope - Current shader scope
 * @param p - 3d vector
 * @returns a float noise value
 *
 * @public
 */
export function perlinNoise3D(scope: PBInsideFunctionScope, p: PBShaderExp) {
  const pb = scope.$builder;
  const funcNameNoise = 'Z_perlinNoise3D';
  pb.func(funcNameNoise, [pb.vec3('p')], function () {
    this.i = pb.floor(this.p.xy);
    this.f = pb.sub(this.p.xy, this.i);
    this.u = pb.mul(this.f, this.f, pb.sub(3, pb.mul(this.f, 2)));
    this.h1 = gradient(this, this.i, this.p.z);
    this.h2 = gradient(this, pb.add(this.i, pb.vec2(1, 0)), this.p.z);
    this.h3 = gradient(this, pb.add(this.i, pb.vec2(0, 1)), this.p.z);
    this.h4 = gradient(this, pb.add(this.i, pb.vec2(1, 1)), this.p.z);
    this.$l.tl = pb.dot(this.h1, this.f);
    this.$l.tr = pb.dot(this.h2, pb.sub(this.f, pb.vec2(1, 0)));
    this.$l.bl = pb.dot(this.h3, pb.sub(this.f, pb.vec2(0, 1)));
    this.$l.br = pb.dot(this.h4, pb.sub(this.f, pb.vec2(1, 1)));
    this.$l.noise = pb.mix(pb.mix(this.tl, this.tr, this.u.x), pb.mix(this.bl, this.br, this.u.x), this.u.y);
    this.noise = pb.add(pb.mul(this.noise, 0.5), 0.5);
    this.$return(this.noise);
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
export function worleyNoise(
  scope: PBInsideFunctionScope,
  uv: PBShaderExp,
  freq: PBShaderExp | number
): PBShaderExp {
  const pb = scope.$builder;
  const funcNameHash = 'Z_worleyHash';
  // https://www.shadertoy.com/view/4sc3z2
  pb.func(funcNameHash, [pb.vec3('p')], function () {
    if (1) {
      this.$l.mod3 = pb.vec3(0.1031, 0.11369, 0.13787);
      this.$l.p3 = pb.fract(pb.mul(this.p, this.mod3));
      this.p3 = pb.add(this.p3, pb.dot(this.p3, pb.add(this.p3.yxz, pb.vec3(19.19))));
      this.$return(
        pb.sub(
          pb.mul(
            pb.fract(
              pb.vec3(
                pb.mul(pb.add(this.p3.x, this.p3.y), this.p3.z),
                pb.mul(pb.add(this.p3.x, this.p3.z), this.p3.y),
                pb.mul(pb.add(this.p3.y, this.p3.z), this.p3.x)
              )
            ),
            2
          ),
          1
        )
      );
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
  const funcNameNoise = 'Z_worleyNoise';
  pb.func(funcNameNoise, [pb.vec3('uv'), pb.float('freq')], function () {
    this.$l.id = pb.floor(this.uv);
    this.$l.p = pb.fract(this.uv);
    this.$l.minDist = pb.float(10000);
    this.$for(pb.int('x'), -1, 2, function () {
      this.$for(pb.int('y'), -1, 2, function () {
        this.$for(pb.int('z'), -1, 2, function () {
          this.$l.offset = pb.vec3(pb.float(this.x), pb.float(this.y), pb.float(this.z));

          if (1 /* tilable */) {
            this.$l.h = pb.add(
              pb.mul(this[funcNameHash](pb.mod(pb.add(this.id, this.offset), pb.vec3(this.freq))), 0.4),
              pb.vec3(0.3)
            );
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
export function worleyFBM(
  scope: PBInsideFunctionScope,
  p: PBShaderExp,
  freq: PBShaderExp | number
): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'Z_worleyFBM';
  pb.func(funcName, [pb.vec3('p'), pb.float('freq')], function () {
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
  const funcName = 'Z_noise3d';
  pb.func(funcName, [pb.vec3('p')], function () {
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
  const funcName = 'Z_smoothNoise3D';
  pb.func(funcName, [pb.vec3('p')], function () {
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
    this.$return(
      pb.mix(
        pb.mix(
          pb.mix(this.ldb, this.rdb, this.local.x),
          pb.mix(this.ldf, this.rdf, this.local.x),
          this.local.z
        ),
        pb.mix(
          pb.mix(this.lub, this.rub, this.local.x),
          pb.mix(this.luf, this.ruf, this.local.x),
          this.local.z
        ),
        this.local.y
      )
    );
  });
  return pb.getGlobalScope()[funcName](p);
}

/**
 * Calculate interleaved gradient noise
 *
 * @param scope - current shader scope
 * @param c - 2d position at where to calculate noise
 * @returns noise value
 *
 * @public
 */
export function interleavedGradientNoise(scope: PBInsideFunctionScope, c: PBShaderExp): PBShaderExp {
  const pb = scope.$builder;
  const x = 0.06711056;
  const y = 0.00583715;
  const z = 52.9829189;
  return pb.fract(pb.mul(z, pb.fract(pb.dot(c, pb.vec2(x, y)))));
}
