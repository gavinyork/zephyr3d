import type { PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';

/**
 * Rect light integration with linearly transformed cosines, shared by every
 * material that shades rect lights as area lights.
 *
 * @remarks
 * After Heitz et al. 2016 and UE5's `RectLight.ush`. The fitted edge term
 * returns `theta / (2 pi sin theta)`, so an edge sum is already a form factor
 * and needs no further normalization.
 *
 * The LUTs are read from the global uniforms `zLTCMatLut` and `zLTCAmpLut`,
 * which the calling material declares and binds (see `getLTCMatLUT`).
 *
 * @internal
 */

const LUT_SIZE = 64;
const LUT_SCALE = (LUT_SIZE - 1) / LUT_SIZE;
const LUT_BIAS = 0.5 / LUT_SIZE;

/**
 * Declares `Z_LTCIntegrateEdgeVec(v1, v2)`: the vector form factor of one
 * polygon edge between two unit directions.
 *
 * @internal
 */
export function defineLTCEdgeFunctions(scope: PBInsideFunctionScope) {
  const pb = scope.$builder;
  pb.func('Z_LTCIntegrateEdgeVec', [pb.vec3('v1'), pb.vec3('v2')], function () {
    this.$l.x = pb.dot(this.v1, this.v2);
    this.$l.y = pb.abs(this.x);
    this.$l.a = pb.add(0.8543985, pb.mul(pb.add(0.4965155, pb.mul(0.0145206, this.y)), this.y));
    this.$l.b = pb.add(3.417594, pb.mul(pb.add(4.1616724, this.y), this.y));
    this.$l.v = pb.div(this.a, this.b);
    this.$l.thetaSinTheta = this.$choice(
      pb.greaterThan(this.x, 0),
      this.v,
      pb.sub(pb.mul(0.5, pb.inverseSqrt(pb.max(pb.sub(1, pb.mul(this.x, this.x)), 1e-7))), this.v)
    );
    this.$return(pb.mul(pb.cross(this.v1, this.v2), this.thetaSinTheta));
  });
  pb.func('Z_LTCClipQuadToHorizon', [pb.vec3[5]('L').inout(), pb.int('n').out()], function () {
    this.$l.config = pb.int(0);
    this.$if(pb.greaterThan(this.L[0].z, 0), function () {
      this.config = pb.add(this.config, 1);
    });
    this.$if(pb.greaterThan(this.L[1].z, 0), function () {
      this.config = pb.add(this.config, 2);
    });
    this.$if(pb.greaterThan(this.L[2].z, 0), function () {
      this.config = pb.add(this.config, 4);
    });
    this.$if(pb.greaterThan(this.L[3].z, 0), function () {
      this.config = pb.add(this.config, 8);
    });
    this.n = 0;
    this.$if(pb.equal(this.config, 0), function () {})
      .$elseif(pb.equal(this.config, 1), function () {
        this.n = 3;
        this.L[1] = pb.add(pb.mul(pb.neg(this.L[1].z), this.L[0]), pb.mul(this.L[0].z, this.L[1]));
        this.L[2] = pb.add(pb.mul(pb.neg(this.L[3].z), this.L[0]), pb.mul(this.L[0].z, this.L[3]));
      })
      .$elseif(pb.equal(this.config, 2), function () {
        this.n = 3;
        this.L[0] = pb.add(pb.mul(pb.neg(this.L[0].z), this.L[1]), pb.mul(this.L[1].z, this.L[0]));
        this.L[2] = pb.add(pb.mul(pb.neg(this.L[2].z), this.L[1]), pb.mul(this.L[1].z, this.L[2]));
      })
      .$elseif(pb.equal(this.config, 3), function () {
        this.n = 4;
        this.L[2] = pb.add(pb.mul(pb.neg(this.L[2].z), this.L[1]), pb.mul(this.L[1].z, this.L[2]));
        this.L[3] = pb.add(pb.mul(pb.neg(this.L[3].z), this.L[0]), pb.mul(this.L[0].z, this.L[3]));
      })
      .$elseif(pb.equal(this.config, 4), function () {
        this.n = 3;
        this.L[0] = pb.add(pb.mul(pb.neg(this.L[3].z), this.L[2]), pb.mul(this.L[2].z, this.L[3]));
        this.L[1] = pb.add(pb.mul(pb.neg(this.L[1].z), this.L[2]), pb.mul(this.L[2].z, this.L[1]));
      })
      .$elseif(pb.equal(this.config, 6), function () {
        this.n = 4;
        this.L[0] = pb.add(pb.mul(pb.neg(this.L[0].z), this.L[1]), pb.mul(this.L[1].z, this.L[0]));
        this.L[3] = pb.add(pb.mul(pb.neg(this.L[3].z), this.L[2]), pb.mul(this.L[2].z, this.L[3]));
      })
      .$elseif(pb.equal(this.config, 7), function () {
        this.n = 5;
        this.L[4] = pb.add(pb.mul(pb.neg(this.L[3].z), this.L[0]), pb.mul(this.L[0].z, this.L[3]));
        this.L[3] = pb.add(pb.mul(pb.neg(this.L[3].z), this.L[2]), pb.mul(this.L[2].z, this.L[3]));
      })
      .$elseif(pb.equal(this.config, 8), function () {
        this.n = 3;
        this.L[0] = pb.add(pb.mul(pb.neg(this.L[0].z), this.L[3]), pb.mul(this.L[3].z, this.L[0]));
        this.L[1] = pb.add(pb.mul(pb.neg(this.L[2].z), this.L[3]), pb.mul(this.L[3].z, this.L[2]));
        this.L[2] = this.L[3];
      })
      .$elseif(pb.equal(this.config, 9), function () {
        this.n = 4;
        this.L[1] = pb.add(pb.mul(pb.neg(this.L[1].z), this.L[0]), pb.mul(this.L[0].z, this.L[1]));
        this.L[2] = pb.add(pb.mul(pb.neg(this.L[2].z), this.L[3]), pb.mul(this.L[3].z, this.L[2]));
      })
      .$elseif(pb.equal(this.config, 11), function () {
        this.n = 5;
        this.L[4] = this.L[3];
        this.L[3] = pb.add(pb.mul(pb.neg(this.L[2].z), this.L[3]), pb.mul(this.L[3].z, this.L[2]));
        this.L[2] = pb.add(pb.mul(pb.neg(this.L[2].z), this.L[1]), pb.mul(this.L[1].z, this.L[2]));
      })
      .$elseif(pb.equal(this.config, 12), function () {
        this.n = 4;
        this.L[1] = pb.add(pb.mul(pb.neg(this.L[1].z), this.L[2]), pb.mul(this.L[2].z, this.L[1]));
        this.L[0] = pb.add(pb.mul(pb.neg(this.L[0].z), this.L[3]), pb.mul(this.L[3].z, this.L[0]));
      })
      .$elseif(pb.equal(this.config, 13), function () {
        this.n = 5;
        this.L[4] = this.L[3];
        this.L[3] = this.L[2];
        this.L[2] = pb.add(pb.mul(pb.neg(this.L[1].z), this.L[2]), pb.mul(this.L[2].z, this.L[1]));
        this.L[1] = pb.add(pb.mul(pb.neg(this.L[1].z), this.L[0]), pb.mul(this.L[0].z, this.L[1]));
      })
      .$elseif(pb.equal(this.config, 14), function () {
        this.n = 5;
        this.L[4] = pb.add(pb.mul(pb.neg(this.L[0].z), this.L[3]), pb.mul(this.L[3].z, this.L[0]));
        this.L[0] = pb.add(pb.mul(pb.neg(this.L[0].z), this.L[1]), pb.mul(this.L[1].z, this.L[0]));
      })
      .$elseif(pb.equal(this.config, 15), function () {
        this.n = 4;
      });
    this.$if(pb.equal(this.n, 3), function () {
      this.L[3] = this.L[0];
    });
    this.$if(pb.equal(this.n, 4), function () {
      this.L[4] = this.L[0];
    });
  });
  pb.func(
    'Z_LTCEvaluateRect',
    [
      pb.vec3('N'),
      pb.vec3('V'),
      pb.vec3('P'),
      pb.mat3('Minv'),
      pb.vec3('p0'),
      pb.vec3('p1'),
      pb.vec3('p2'),
      pb.vec3('p3')
    ],
    function () {
      this.$l.T1 = pb.normalize(pb.sub(this.V, pb.mul(this.N, pb.dot(this.V, this.N))));
      this.$l.T2 = pb.cross(this.N, this.T1);
      if (pb.getDevice().type === 'webgl') {
        this.$l.ltcBasis = pb.mat3(
          pb.vec3(this.T1.x, this.T2.x, this.N.x),
          pb.vec3(this.T1.y, this.T2.y, this.N.y),
          pb.vec3(this.T1.z, this.T2.z, this.N.z)
        );
        this.$l.ltcMatrix = pb.mul(this.Minv, this.ltcBasis);
      } else {
        this.$l.ltcMatrix = pb.mul(this.Minv, pb.transpose(pb.mat3(this.T1, this.T2, this.N)));
      }
      this.$l.L = pb.vec3[5]();
      this.L[0] = pb.mul(this.ltcMatrix, pb.sub(this.p0, this.P));
      this.L[1] = pb.mul(this.ltcMatrix, pb.sub(this.p1, this.P));
      this.L[2] = pb.mul(this.ltcMatrix, pb.sub(this.p2, this.P));
      this.L[3] = pb.mul(this.ltcMatrix, pb.sub(this.p3, this.P));
      this.$l.n = pb.int(0);
      this.Z_LTCClipQuadToHorizon(this.L, this.n);
      this.$if(pb.equal(this.n, 0), function () {
        this.$return(pb.vec3(0));
      });
      this.L[0] = pb.normalize(this.L[0]);
      this.L[1] = pb.normalize(this.L[1]);
      this.L[2] = pb.normalize(this.L[2]);
      this.L[3] = pb.normalize(this.L[3]);
      this.L[4] = pb.normalize(this.L[4]);
      this.$l.sum = pb.float(0);
      this.sum = pb.add(this.sum, this.Z_LTCIntegrateEdgeVec(this.L[0], this.L[1]).z);
      this.sum = pb.add(this.sum, this.Z_LTCIntegrateEdgeVec(this.L[1], this.L[2]).z);
      this.sum = pb.add(this.sum, this.Z_LTCIntegrateEdgeVec(this.L[2], this.L[3]).z);
      this.$if(pb.greaterThanEqual(this.n, 4), function () {
        this.sum = pb.add(this.sum, this.Z_LTCIntegrateEdgeVec(this.L[3], this.L[4]).z);
      });
      this.$if(pb.equal(this.n, 5), function () {
        this.sum = pb.add(this.sum, this.Z_LTCIntegrateEdgeVec(this.L[4], this.L[0]).z);
      });
      this.sum = pb.max(0, this.sum);
      this.$return(pb.vec3(this.sum));
    }
  );
}

/**
 * The terms a material needs to shade one rect light, as
 * `(specularIntegral, fresnelNorm, fresnelBias, diffuseFormFactor)`.
 *
 * @remarks
 * The specular reflectance is `specularIntegral * (F0 * fresnelNorm + (F90 - F0)
 * * fresnelBias)` - the Schlick split UE5's `GetRectLTC_GGX` uses, which with
 * `F90 = 1` is Heitz's `F0 * t2.x + (1 - F0) * t2.y` - and the diffuse is
 * `diffuseColor * diffuseFormFactor`, both times the light's luminance. The
 * light's range window and one-sidedness are already applied, so behind the
 * light, past its range or for a degenerate rect this returns zero.
 *
 * `roughness` is perceptual; it is floored at 0.02, as UE5's rect path does,
 * below which the fitted matrix degenerates towards singular.
 *
 * @internal
 */
export function evaluateLTCRectLightTerms(
  scope: PBInsideFunctionScope,
  worldPos: PBShaderExp,
  normal: PBShaderExp,
  viewVec: PBShaderExp,
  roughness: PBShaderExp,
  posRange: PBShaderExp,
  axisX: PBShaderExp,
  axisY: PBShaderExp
): PBShaderExp {
  const pb = scope.$builder;
  defineLTCEdgeFunctions(scope);
  pb.func(
    'Z_LTCRectLightTerms',
    [
      pb.vec3('worldPos'),
      pb.vec3('normal'),
      pb.vec3('viewVec'),
      pb.float('roughness'),
      pb.vec4('posRange'),
      pb.vec3('ax'),
      pb.vec3('ay')
    ],
    function () {
      this.$l.center = this.posRange.xyz;
      this.$l.range = this.posRange.w;
      this.$l.area = pb.mul(pb.length(this.ax), pb.length(this.ay), 4);
      this.$if(pb.lessThanEqual(this.area, 0), function () {
        this.$return(pb.vec4(0));
      });
      this.$l.lightNormal = pb.neg(pb.normalize(pb.cross(this.ax, this.ay)));
      this.$l.centerToPoint = pb.sub(this.center, this.worldPos);
      this.$l.dist = pb.length(this.centerToPoint);
      // One-sided: the plane through the centre separates lit from unlit.
      this.$if(
        pb.lessThanEqual(pb.dot(this.lightNormal, pb.neg(pb.normalize(this.centerToPoint))), 1e-5),
        function () {
          this.$return(pb.vec4(0));
        }
      );
      this.$l.falloff = pb.float(1);
      this.$if(pb.greaterThan(this.range, 0), function () {
        this.falloff = pb.sub(1, pb.smoothStep(pb.mul(this.range, 0.9), this.range, this.dist));
      });
      this.$l.p0 = pb.sub(pb.sub(this.center, this.ax), this.ay);
      this.$l.p1 = pb.add(pb.sub(this.center, this.ay), this.ax);
      this.$l.p2 = pb.add(pb.add(this.center, this.ax), this.ay);
      this.$l.p3 = pb.add(pb.sub(this.center, this.ax), this.ay);
      this.$l.NoV = pb.clamp(pb.dot(this.normal, this.viewVec), 0.0001, 1);
      this.$l.ltcRoughness = pb.max(this.roughness, 0.02);
      this.$l.uv = pb.clamp(
        pb.add(
          pb.mul(pb.vec2(this.ltcRoughness, pb.sqrt(pb.max(pb.sub(1, this.NoV), 0))), LUT_SCALE),
          pb.vec2(LUT_BIAS)
        ),
        pb.vec2(0),
        pb.vec2(1)
      );
      this.$l.t1 = pb.textureSampleLevel(this.zLTCMatLut, this.uv, 0);
      this.$l.t2 = pb.textureSampleLevel(this.zLTCAmpLut, this.uv, 0);
      this.$l.Minv = pb.mat3(
        pb.vec3(this.t1.x, 0, this.t1.y),
        pb.vec3(0, 1, 0),
        pb.vec3(this.t1.z, 0, this.t1.w)
      );
      this.$l.spec = this.Z_LTCEvaluateRect(
        this.normal,
        this.viewVec,
        this.worldPos,
        this.Minv,
        this.p0,
        this.p1,
        this.p2,
        this.p3
      ).x;
      this.$l.diff = this.Z_LTCEvaluateRect(
        this.normal,
        this.viewVec,
        this.worldPos,
        pb.mat3(pb.vec3(1, 0, 0), pb.vec3(0, 1, 0), pb.vec3(0, 0, 1)),
        this.p0,
        this.p1,
        this.p2,
        this.p3
      ).x;
      this.$return(
        pb.vec4(pb.mul(this.spec, this.falloff), this.t2.x, this.t2.y, pb.mul(this.diff, this.falloff))
      );
    }
  );
  return pb
    .getGlobalScope()
    .Z_LTCRectLightTerms(worldPos, normal, viewVec, roughness, posRange, axisX, axisY) as PBShaderExp;
}
