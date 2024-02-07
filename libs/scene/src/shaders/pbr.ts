import type { PBInsideFunctionScope, PBShaderExp } from "@zephyr3d/device";

/** @internal */
export function fresnelSchlickRoughness(
  scope: PBInsideFunctionScope,
  NdotV: PBShaderExp,
  F0: PBShaderExp,
  roughness: PBShaderExp
): PBShaderExp {
  const funcName = 'lib_fresnelSchlickRoughness';
  const pb = scope.$builder;
  pb.func(funcName, [pb.float('NdotV'), pb.vec3('f0'), pb.float('roughness')], function () {
    this.$return(
      pb.add(
        this.f0,
        pb.mul(
          pb.sub(pb.max(pb.vec3(pb.sub(1, this.roughness)), this.f0), this.f0),
          pb.pow(pb.sub(1, this.NdotV), 5)
        )
      )
    );
  });
  return pb.getGlobalScope()[funcName](NdotV, F0, roughness);
}

/** @internal */
export function DFGUE4(scope: PBInsideFunctionScope, roughness: PBShaderExp, NdotV: PBShaderExp): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'lib_envDFGUE4';
  pb.func(funcName, [pb.float('roughness'), pb.float('NdotV')], function () {
    this.$l.c0 = pb.vec4(-1, -0.0275, -0.572, 0.022);
    this.$l.c1 = pb.vec4(1, 0.0425, 1.04, -0.04);
    this.$l.r = pb.add(pb.mul(this.c0, this.roughness), this.c1);
    this.$l.a004 = pb.add(
      pb.mul(pb.min(pb.mul(this.r.x, this.r.x), pb.exp2(pb.mul(this.NdotV, -9.28))), this.r.x),
      this.r.y
    );
    this.$return(pb.add(pb.mul(pb.vec2(-1.04, 1.04), this.a004), this.r.zw));
  });
  return pb.getGlobalScope()[funcName](roughness, NdotV);
}

/** @internal */
export function iblSpecularAndDiffuse(scope: PBInsideFunctionScope, f0: PBShaderExp, radiance: PBShaderExp, irradiance: PBShaderExp, diffuse: PBShaderExp, NdotV: PBShaderExp|number, roughness: PBShaderExp|number, specularWeight: PBShaderExp, outSpecular: PBShaderExp, outDiffuse: PBShaderExp): void {
  const pb = scope.$builder;
  const funcName = 'lib_iblSpecularAndDiffuse';
  pb.func(
    funcName,
    [pb.vec3('f0'), pb.vec3('radiance'), pb.vec3('irradiance'), pb.vec3('diffuse'), pb.float('NdotV'), pb.float('roughness'), pb.float('specularWeight'), pb.vec3('outSpecular').out(), pb.vec3('outDiffuse').out()],
    function () {
      this.$l.fab = DFGUE4(this, this.roughness, this.NdotV);
      this.$l.fr = pb.sub(pb.max(pb.vec3(pb.sub(1, this.roughness)), this.f0), this.f0);
      this.$l.kS = pb.add(this.f0, pb.mul(this.fr, pb.pow(pb.sub(1, this.NdotV), 5)));
      this.$l.t = pb.mul(this.kS, this.fab.x);
      this.outSpecular = pb.mul(
        this.radiance,
        pb.add(this.t, pb.vec3(this.fab.y)),
        this.specularWeight
      );
      this.$l.FssEss = pb.add(pb.mul(this.t, this.specularWeight), this.fab.y);
      this.$l.Ems = pb.sub(1, pb.add(this.fab.x, this.fab.y));
      this.$l.Favg = pb.mul(
        pb.add(this.f0, pb.div(pb.sub(pb.vec3(1), this.f0), 21)),
        this.specularWeight
      );
      this.$l.FmsEms = pb.mul(
        this.Ems,
        this.FssEss,
        pb.div(this.Favg, pb.sub(pb.vec3(1), pb.mul(this.Favg, this.Ems)))
      );
      this.$l.kD = pb.mul(
        this.diffuse,
        pb.add(pb.sub(pb.vec3(1), this.FssEss), this.FmsEms)
      );
      this.outDiffuse = pb.mul(pb.add(this.FmsEms, this.kD), this.irradiance);
    }
  );
  pb.getGlobalScope()[funcName](f0, radiance, irradiance, diffuse, NdotV, roughness, specularWeight, outSpecular, outDiffuse);
}

/** @internal */
export function iblSpecular(scope: PBInsideFunctionScope, f0: PBShaderExp, radiance: PBShaderExp, NdotV: PBShaderExp|number, roughness: PBShaderExp|number, specularWeight: PBShaderExp|number): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'lib_iblSpecular';
  pb.func(
    funcName,
    [pb.vec3('f0'), pb.vec3('radiance'), pb.float('NdotV'), pb.float('roughness'), pb.float('specularWeight')],
    function () {
      this.$l.fab = DFGUE4(this, this.roughness, this.NdotV);
      this.$l.fr = pb.sub(pb.max(pb.vec3(pb.sub(1, this.roughness)), this.f0), this.f0);
      this.$l.kS = pb.add(this.f0, pb.mul(this.fr, pb.pow(pb.sub(1, this.NdotV), 5)));
      this.$l.t = pb.mul(this.kS, this.fab.x);
      this.$return(pb.mul(
        this.radiance,
        pb.add(this.t, pb.vec3(this.fab.y)),
        this.specularWeight
      ));
    }
  );
  return pb.getGlobalScope()[funcName](f0, radiance, NdotV, roughness, specularWeight);
}

/** @internal */
export function iblDiffuse(scope: PBInsideFunctionScope, f0: PBShaderExp, irradiance: PBShaderExp, diffuse: PBShaderExp, NdotV: PBShaderExp|number, roughness: PBShaderExp|number, specularWeight: PBShaderExp|number): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'lib_iblDiffuse';
  pb.func(
    funcName,
    [pb.vec3('f0'), pb.vec3('irradiance'), pb.vec3('diffuse'), pb.float('NdotV'), pb.float('roughness'), pb.float('specularWeight')],
    function () {
      this.$l.fab = DFGUE4(this, this.roughness, this.NdotV);
      this.$l.fr = pb.sub(pb.max(pb.vec3(pb.sub(1, this.roughness)), this.f0), this.f0);
      this.$l.kS = pb.add(this.f0, pb.mul(this.fr, pb.pow(pb.sub(1, this.NdotV), 5)));
      this.$l.t = pb.mul(this.kS, this.fab.x);
      this.$l.FssEss = pb.add(pb.mul(this.t, this.specularWeight), this.fab.y);
      this.$l.Ems = pb.sub(1, pb.add(this.fab.x, this.fab.y));
      this.$l.Favg = pb.mul(
        pb.add(this.f0, pb.div(pb.sub(pb.vec3(1), this.f0), 21)),
        this.specularWeight
      );
      this.$l.FmsEms = pb.mul(
        this.Ems,
        this.FssEss,
        pb.div(this.Favg, pb.sub(pb.vec3(1), pb.mul(this.Favg, this.Ems)))
      );
      this.$l.kD = pb.mul(
        this.diffuse,
        pb.add(pb.sub(pb.vec3(1), this.FssEss), this.FmsEms)
      );
      this.$return(pb.mul(pb.add(this.FmsEms, this.kD), this.irradiance));
    }
  );
  return pb.getGlobalScope()[funcName](f0, irradiance, diffuse, NdotV, roughness, specularWeight);
}

/** @internal */
export function iblSheenBRDF(scope: PBInsideFunctionScope, sheenRoughness: PBShaderExp, NdotV: PBShaderExp): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'iblSheenBRDF';
  pb.func(funcName, [pb.float('sheenRoughness'), pb.float('NdotV')], function(){
    this.$l.r2 = pb.mul(this.sheenRoughness, this.sheenRoughness);
    this.$l.a = pb.float();
    this.$l.b = pb.float();
    this.$l.c = pb.float();
    this.$if(pb.lessThan(this.sheenRoughness, 0.25), function(){
      this.a = pb.sub(pb.add(pb.mul(this.r2, -339.2), pb.mul(this.sheenRoughness, 161.4)), 25.9);
      this.b = pb.add(pb.sub(pb.mul(this.r2, 44), pb.mul(this.sheenRoughness, 23.7)), 3.26)
      this.c = 0;
    }).$else(function(){
      this.a = pb.sub(pb.add(pb.mul(this.r2, -8.48), pb.mul(this.sheenRoughness, 14.3)), 9.95);
      this.b = pb.add(pb.sub(pb.mul(this.r2, 1.97), pb.mul(this.sheenRoughness, 3.27)), 0.72)
      this.c = pb.mul(0.1, pb.sub(this.sheenRoughness, 0.25));
    });
    this.$l.DG = pb.add(pb.exp(pb.add(pb.mul(this.a, this.NdotV), this.b)), this.c);
    this.$return(pb.clamp(pb.div(this.DG, Math.PI), 0, 1));
  });
  return pb.getGlobalScope()[funcName](sheenRoughness, NdotV);
}

/** @internal */
export function fresnelSchlick(
  scope: PBInsideFunctionScope,
  VdotH: PBShaderExp,
  f0: PBShaderExp,
  f90: PBShaderExp
): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'fresnelSchlick';
  pb.func(
    funcName,
    [pb.float('VdotH'), pb.vec3('F0'), pb.vec3('F90')],
    function () {
      this.$return(
        pb.add(
          this.F0,
          pb.mul(pb.sub(this.F90, this.F0), pb.pow(pb.clamp(pb.sub(1, this.VdotH), 0, 1), 5))
        )
      );
    }
  );
  return pb.getGlobalScope()[funcName](VdotH, f0, f90);
}

/** @internal */
export function distributionGGX(
  scope: PBInsideFunctionScope,
  NdotH: PBShaderExp,
  alphaRoughness: PBShaderExp
): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'distributionGGX';
  pb.func(
    funcName,
    [pb.float('NdotH'), pb.float('roughness')],
    function () {
      this.$l.a2 = pb.mul(this.roughness, this.roughness);
      this.$l.NdotH2 = pb.mul(this.NdotH, this.NdotH);
      this.$l.num = this.a2;
      this.$l.denom = pb.add(pb.mul(this.NdotH2, pb.sub(this.a2, 1)), 1);
      this.denom = pb.mul(pb.mul(3.14159265, this.denom), this.denom);
      this.$return(pb.div(this.num, this.denom));
    }
  );
  return pb.getGlobalScope()[funcName](NdotH, alphaRoughness);
}

/** @internal */
export function visGGX(
  scope: PBInsideFunctionScope,
  NdotV: PBShaderExp,
  NdotL: PBShaderExp,
  alphaRoughness: PBShaderExp
): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'visGGX';
  pb.func(
    funcName,
    [pb.float('NdotV'), pb.float('NdotL'), pb.float('roughness')],
    function () {
      this.$l.a2 = pb.mul(this.roughness, this.roughness);
      this.$l.ggxV = pb.mul(
        this.NdotL,
        pb.sqrt(pb.add(pb.mul(this.NdotV, this.NdotV, pb.sub(1, this.a2)), this.a2))
      );
      this.$l.ggxL = pb.mul(
        this.NdotV,
        pb.sqrt(pb.add(pb.mul(this.NdotL, this.NdotL, pb.sub(1, this.a2)), this.a2))
      );
      this.$l.ggx = pb.add(this.ggxV, this.ggxL);
      this.$if(pb.greaterThan(this.ggx, 0), function () {
        this.$return(pb.div(0.5, this.ggx));
      }).$else(function () {
        this.$return(pb.float(0));
      });
    }
  );
  return pb.getGlobalScope()[funcName](NdotV, NdotL, alphaRoughness);
}

/** @internal */
export function D_Charlie(
  scope: PBInsideFunctionScope,
  NdotH: PBShaderExp,
  sheenRoughness: PBShaderExp
): PBShaderExp {
  const funcNameDCharlie = 'lib_DCharlie';
  const pb = scope.$builder;
  pb.func(
    funcNameDCharlie,
    [pb.float('NdotH'), pb.float('sheenRoughness')],
    function () {
      this.$l.alphaG = pb.mul(this.sheenRoughness, this.sheenRoughness);
      this.$l.invR = pb.div(1, this.alphaG);
      this.$l.cos2h = pb.mul(this.NdotH, this.NdotH);
      this.$l.sin2h = pb.max(pb.sub(1, this.cos2h), 0.0078125);
      this.$return(
        pb.div(pb.mul(pb.add(this.invR, 2), pb.pow(this.sin2h, pb.mul(this.invR, 0.5))), 2 * Math.PI)
      );
    }
  );
  return pb.getGlobalScope()[funcNameDCharlie](NdotH, sheenRoughness);
}

/** @internal */
export function V_Ashikhmin(scope: PBInsideFunctionScope, NdotL: PBShaderExp, NdotV: PBShaderExp): PBShaderExp {
  const funcNameVAshikhmin = 'lib_VAshikhmin';
  const pb = scope.$builder;
  pb.func(funcNameVAshikhmin, [pb.float('NdotL'), pb.float('NdotV')], function () {
    this.$return(
      pb.clamp(pb.div(1, pb.mul(pb.sub(pb.add(this.NdotL, this.NdotV), pb.mul(this.NdotL, this.NdotV)), 4)), 0, 1)
    );
  });
  return pb.getGlobalScope()[funcNameVAshikhmin](NdotL, NdotV);
}

/** @internal */
export function indirectClearcoatLighting(scope: PBInsideFunctionScope, f0: PBShaderExp, ccRadiance: PBShaderExp, ccNdotV: PBShaderExp|number, ccRoughness: PBShaderExp|number): PBShaderExp {
  return iblSpecular(scope, f0, ccRadiance, ccNdotV, ccRoughness, 1);
}

/** @internal */
export function directClearcoatLighting(scope: PBInsideFunctionScope, NdotV: PBShaderExp, NdotH: PBShaderExp, NdotL: PBShaderExp, F: PBShaderExp, clearcoatRoughness: PBShaderExp|number): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'pbrDirectClearcoatLighting';
  pb.func(funcName, [pb.float('NdotV'), pb.float('NdotH'), pb.float('NdotL'), pb.vec3('F'), pb.float('clearcoatRoughness')], function(){
    this.$l.ccRoughness = pb.mul(this.clearcoatRoughness, this.clearcoatRoughness);
    this.$l.ccD = distributionGGX(this, this.NdotH, this.ccRoughness);
    this.$l.ccV = visGGX(this, this.NdotV, this.NdotL, this.ccRoughness);
    this.$return(pb.mul(this.ccD, this.ccV, this.F));
  });
  return pb.getGlobalScope()[funcName](NdotV, NdotH, NdotL, F, clearcoatRoughness);
}

/** @internal */
export function indirectSheenLighting(scope: PBInsideFunctionScope, NdotV: PBShaderExp, iblDiffuse: PBShaderExp, sheenColor: PBShaderExp, sheenRoughness: PBShaderExp): PBShaderExp {
  const pb = scope.$builder;
  return pb.mul(sheenColor, iblDiffuse, iblSheenBRDF(scope, sheenRoughness, NdotV));
}

/** @internal */
export function directSheenLighting(scope: PBInsideFunctionScope, NdotV: PBShaderExp, NdotL: PBShaderExp, NdotH: PBShaderExp, sheenColor: PBShaderExp, sheenRoughness: PBShaderExp|number): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'pbrDirectSheenLighting';
  pb.func(funcName, [pb.float('NdotV'), pb.float('NdotL'), pb.float('NdotH'), pb.vec3('sheenColor'), pb.float('sheenRoughness')], function(){
    this.$l.D = D_Charlie(this, this.NdotH, this.sheenRoughness);
    this.$l.V = V_Ashikhmin(this, this.NdotL, this.NdotV);
    this.$return(pb.mul(this.sheenColor, this.D, this.V));
  });
  return pb.getGlobalScope()[funcName](NdotV, NdotL, NdotH, sheenColor, sheenRoughness);
}

/** @internal */
export function directLighting(
  scope: PBInsideFunctionScope,
  diffuse: PBShaderExp,
  NdotV: PBShaderExp,
  NdotH: PBShaderExp,
  NdotL: PBShaderExp,
  F: PBShaderExp,
  roughness: PBShaderExp|number,
  specularWeight: PBShaderExp,
  outSpecular: PBShaderExp,
  outDiffuse: PBShaderExp
): void {
  const pb = scope.$builder;
  const funcName = 'pbrDirectLighting';
  pb.func(
    funcName,
    [pb.vec3('diffuse'), pb.float('NdotV'), pb.float('NdotH'), pb.float('NdotL'), pb.vec3('F'), pb.float('roughness'), pb.float('specularWeight'), pb.vec3('outSpecular').out(), pb.vec3('outDiffuse').out()],
    function () {
      this.$l.alphaRoughness = pb.mul(this.roughness, this.roughness);
      this.$l.D = distributionGGX(this, this.NdotH, this.alphaRoughness);
      this.$l.V = visGGX(this, this.NdotV, this.NdotL, this.alphaRoughness);
      this.outSpecular = pb.mul(this.D, this.V, this.F, this.specularWeight);
      this.outDiffuse = pb.mul(
          pb.sub(pb.vec3(1), pb.mul(this.F, this.specularWeight)),
          pb.div(this.diffuse, Math.PI));
    }
  );
  pb.getGlobalScope()[funcName](diffuse, NdotV, NdotH, NdotL, F, roughness, specularWeight, outSpecular, outDiffuse);
}
