import { PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import {
  DEBUG_CASCADED_SHADOW_MAPS,
  RENDER_PASS_TYPE_FORWARD,
  LIGHT_TYPE_DIRECTIONAL,
  LIGHT_TYPE_POINT,
  LIGHT_TYPE_SPOT,
} from '../values';
import { DrawContext } from '../render/drawable';
import type { LightModel } from '../material/lightmodel';
import { ShaderFramework } from './framework';
import { nonLinearDepthToLinear } from './misc';
import { Application } from '../app';

/**
 * Calculate lighting for forward renderer
 *
 * @param scope - Current shader scope
 * @param lm - The light model
 * @param ctx - The drawing context
 * @returns The final color
 */
export function forwardComputeLighting(
  scope: PBInsideFunctionScope,
  lm: LightModel,
  ctx: DrawContext
): PBShaderExp {
  const env = ctx.drawEnvLight ? ctx.env.light.envLight : null;
  const funcNameIllumPointLight = 'stdmat_illumPointLight';
  const funcNameIllumDirectionalLight = 'stdmat_illumDirectionalLight';
  const funcNameIllumSpotLight = 'stdmat_illumSpotLight';
  const funcNameIllumDirectionalShadowLight = 'stdmat_illumDirectionalShadowLight';
  const funcNameIllumPointShadowLight = 'stdmat_illumPointShadowLight';
  const funcNameIllumCascadedShadowLight = 'stdmat_illumCascadedShadowLight';
  const funcNameIllumUnshadowedLights = 'stdmat_illumUnshadowedLights';
  const funcNameGetClusterIndex = 'stdmat_getClusterIndex';
  const funcNameIllumOneLight = 'stdmat_illumOneLight';
  const funcNameComputeLighting = 'stdmat_computeLighting';
  const pb = scope.$builder;
  if (!scope || !(scope instanceof PBInsideFunctionScope)) {
    throw new Error(
      'forwardComputeLighting() failed: forwardComputeLighting() must be called inside a function'
    );
  }
  if (ctx.renderPass.type !== RENDER_PASS_TYPE_FORWARD) {
    throw new Error(
      `forwardComputeLighting() failed: invalid render pass type: ${ctx.renderPass.type}`
    );
  }
  function illumPointLight(lm: LightModel, ...args: PBShaderExp[]) {
    pb.func(
      funcNameIllumPointLight,
      [
        pb.vec4('lightPositionRange'),
        pb.vec4('lightDirectionCutoff'),
        pb.vec3('lightDir'),
        pb.vec3('attenuation')
      ],
      function () {
        this.$l.dist = pb.distance(
          this.lightPositionRange.xyz,
          ShaderFramework.getWorldPosition(this).xyz
        );
        this.$l.falloff = pb.max(0, pb.sub(1, pb.div(this.dist, this.lightPositionRange.w)));
        this.$l.falloff2 = pb.mul(this.falloff, this.falloff);
        this.$if(pb.greaterThan(this.falloff2, 0), function () {
          lm.directBRDF(this, this.lightDir, pb.mul(this.attenuation, this.falloff2));
        });
      }
    );
    pb.getGlobalScope()[funcNameIllumPointLight](...args);
  }
  function illumDirectionalLight(lm: LightModel, ...args: PBShaderExp[]) {
    pb.func(
      funcNameIllumDirectionalLight,
      [
        pb.vec4('lightPositionRange'),
        pb.vec4('lightDirectionCutoff'),
        pb.vec3('lightDir'),
        pb.vec3('attenuation')
      ],
      function () {
        lm.directBRDF(this, this.lightDir, this.attenuation);
      }
    );
    pb.getGlobalScope()[funcNameIllumDirectionalLight](...args);
  }
  function illumSpotLight(lm: LightModel, ...args: PBShaderExp[]) {
    pb.func(
      funcNameIllumSpotLight,
      [
        pb.vec4('lightPositionRange'),
        pb.vec4('lightDirectionCutoff'),
        pb.vec3('lightDir'),
        pb.vec3('attenuation')
      ],
      function () {
        this.$l.spotFactor = pb.dot(this.lightDir, this.lightDirectionCutoff.xyz);
        this.spotFactor = pb.smoothStep(
          this.lightDirectionCutoff.w,
          pb.mix(this.lightDirectionCutoff.w, 1, 0.5),
          this.spotFactor
        );
        this.$if(pb.greaterThan(this.spotFactor, 0), function () {
          illumPointLight(
            lm,
            this.lightPositionRange,
            this.lightDirectionCutoff,
            this.lightDir,
            pb.mul(this.attenuation, this.spotFactor)
          );
        });
      }
    );
    pb.getGlobalScope()[funcNameIllumSpotLight](...args);
  }
  function illumLight(
    scope: PBInsideFunctionScope,
    lightType: number | PBShaderExp,
    lm: LightModel,
    ...args: PBShaderExp[]
  ) {
    if (typeof lightType === 'number') {
      if (lightType === LIGHT_TYPE_DIRECTIONAL) {
        illumDirectionalLight(lm, ...args);
      } else if (lightType === LIGHT_TYPE_POINT) {
        illumPointLight(lm, ...args);
      } else if (lightType === LIGHT_TYPE_SPOT) {
        illumSpotLight(lm, ...args);
      }
    } else {
      scope
        .$if(pb.equal(lightType, LIGHT_TYPE_DIRECTIONAL), function () {
          illumDirectionalLight(lm, ...args);
        })
        .$elseif(pb.equal(lightType, LIGHT_TYPE_POINT), function () {
          illumPointLight(lm, ...args);
        })
        .$elseif(pb.equal(lightType, LIGHT_TYPE_SPOT), function () {
          illumSpotLight(lm, ...args);
        });
    }
  }
  function illumDirectionalShadowLight(lightType: number, lm: LightModel) {
    pb.func(
      funcNameIllumDirectionalShadowLight,
      [],
      function () {
        this.$l.positionRange = scope.global.light.positionAndRange;//ShaderFramework.getLightPositionAndRange(this, 0);
        this.$l.directionCutoff = scope.global.light.directionAndCutoff;//ShaderFramework.getLightDirectionAndCutoff(this, 0);
        this.$l.diffuseIntensity = scope.global.light.diffuseAndIntensity;//ShaderFramework.getLightColorAndIntensity(this, 0);
        this.$l.lightcolor = pb.mul(this.diffuseIntensity.xyz, this.diffuseIntensity.w);
        this.$l.lightDir = pb.vec3();
        this.$l.nl = pb.float();
        this.$l.NdotL = pb.float();
        if (lightType === LIGHT_TYPE_DIRECTIONAL) {
          this.lightDir = this.directionCutoff.xyz;
          this.nl = pb.dot(this.surfaceData.normal, this.lightDir);
          this.NdotL = pb.clamp(pb.neg(this.nl), 0, 1);
        } else {
          this.lightDir = pb.sub(
            ShaderFramework.getWorldPosition(this).xyz,
            this.positionRange.xyz
          );
          this.lightDir = pb.normalize(this.lightDir);
          this.nl = pb.dot(this.surfaceData.normal, this.lightDir);
          this.NdotL = pb.clamp(pb.neg(this.nl), 0, 1);
        }
        this.shadowVertex = ShaderFramework.calculateShadowSpaceVertex(this);
        const shadowMapParams = ctx.shadowMapInfo.get(ctx.currentShadowLight);
        this.$l.shadow = shadowMapParams.impl.computeShadow(shadowMapParams, this, this.shadowVertex, this.NdotL);
        this.$l.shadowDistance = ShaderFramework.getShadowCameraParams(scope).w;
        this.shadow = pb.mix(this.shadow, 1, pb.smoothStep(pb.mul(this.shadowDistance, 0.8), this.shadowDistance, pb.distance(ShaderFramework.getCameraPosition(this), ShaderFramework.getWorldPosition(this).xyz)));
        // TODO: cannot early exit, shoud make computeShadow() running in non-uniform control flow
        if (lightType !== LIGHT_TYPE_DIRECTIONAL) {
          this.$if(pb.greaterThan(pb.length(this.lightDir), this.positionRange.w), function () {
            this.$return();
          });
        }
        this.$if(pb.greaterThan(this.NdotL, 0), function () {
          this.$l.attenuation = pb.mul(pb.mul(this.lightcolor, this.NdotL), pb.vec3(this.shadow));
          illumLight(
            this,
            lightType,
            lm,
            this.positionRange,
            this.directionCutoff,
            this.lightDir,
            this.attenuation
          );
        });
      }
    );
    pb.getGlobalScope()[funcNameIllumDirectionalShadowLight]();
  }
  function illumPointShadowLight(lm: LightModel) {
    pb.func(
      funcNameIllumPointShadowLight,
      [],
      function () {
        const worldPos = ShaderFramework.getWorldPosition(this);
        this.$l.positionRange = scope.global.light.positionAndRange;//ShaderFramework.getLightPositionAndRange(this, 0);
        this.$l.directionCutoff = scope.global.light.directionAndCutoff;//ShaderFramework.getLightDirectionAndCutoff(this, 0);
        this.$l.diffuseIntensity = scope.global.light.diffuseAndIntensity;//ShaderFramework.getLightColorAndIntensity(this, 0);
        this.$l.lightcolor = pb.mul(this.diffuseIntensity.xyz, this.diffuseIntensity.w);
        this.$l.lightDir = pb.sub(worldPos.xyz, this.positionRange.xyz);
        this.$if(pb.greaterThan(pb.length(this.lightDir), this.positionRange.w), function () {
          this.$return();
        });
        this.lightDir = pb.normalize(this.lightDir);
        this.$l.nl = pb.dot(this.surfaceData.normal, this.lightDir);
        this.$l.NdotL = pb.clamp(pb.neg(this.nl), 0, 1);
        this.shadowBound = pb.vec4(0, 0, 1, 1);
        this.shadowVertex = ShaderFramework.calculateShadowSpaceVertex(this);
        const shadowMapParams = ctx.shadowMapInfo.get(ctx.currentShadowLight);
        this.$l.shadow = shadowMapParams.impl.computeShadow(shadowMapParams, this, this.shadowVertex, this.NdotL);
        this.$l.shadowDistance = ShaderFramework.getShadowCameraParams(scope).w;
        this.shadow = pb.mix(this.shadow, 1, pb.smoothStep(pb.mul(this.shadowDistance, 0.8), this.shadowDistance, pb.distance(ShaderFramework.getCameraPosition(this), ShaderFramework.getWorldPosition(this).xyz)));
        this.$if(pb.greaterThan(this.NdotL, 0), function () {
          this.$l.attenuation = pb.mul(pb.mul(this.lightcolor, this.NdotL), pb.vec3(this.shadow));
          illumLight(
            this,
            LIGHT_TYPE_POINT,
            lm,
            this.positionRange,
            this.directionCutoff,
            this.lightDir,
            this.attenuation
          );
        });
      }
    );
    pb.getGlobalScope()[funcNameIllumPointShadowLight]();
  }
  function illumCascadedShadowLight(lm: LightModel) {
    pb.func(
      funcNameIllumCascadedShadowLight,
      [],
      function () {
        this.$l.shadowCascades = this.global.light.shadowCascades;//ShaderFramework.getLightInfo(this, 0).y;
        this.$l.positionRange = this.global.light.positionAndRange;//ShaderFramework.getLightPositionAndRange(this, 0);
        this.$l.directionCutoff = this.global.light.directionAndCutoff;//ShaderFramework.getLightDirectionAndCutoff(this, 0);
        this.$l.diffuseIntensity = this.global.light.diffuseAndIntensity;//ShaderFramework.getLightColorAndIntensity(this, 0);
        this.$l.lightcolor = pb.mul(this.diffuseIntensity.xyz, this.diffuseIntensity.w);
        if (DEBUG_CASCADED_SHADOW_MAPS) {
          this.$l.shadowDebugColor = pb.vec3(1, 0, 1);
          this.$l.shadowDebugColors = pb.vec3[4]();
          this.$l.shadowDebugColors[0] = pb.vec3(1, 0, 0);
          this.$l.shadowDebugColors[1] = pb.vec3(0, 1, 0);
          this.$l.shadowDebugColors[2] = pb.vec3(0, 0, 1);
          this.$l.shadowDebugColors[3] = pb.vec3(1, 1, 0);
        }
        this.$l.lightDir = pb.vec3();
        this.lightDir = this.directionCutoff.xyz;
        this.$l.nl = pb.dot(this.surfaceData.normal, this.lightDir);
        this.$l.NdotL = pb.clamp(pb.neg(this.nl), 0, 1);
        this.shadowBound = pb.vec4(0, 0, 1, 1);
        this.linearDepth = nonLinearDepthToLinear(this, this.$builtins.fragCoord.z);
        this.splitDistances = ShaderFramework.getCascadeDistances(this);
        this.comparison = pb.vec4(pb.greaterThan(pb.vec4(this.linearDepth), this.splitDistances));
        this.cascadeFlags = pb.vec4(
          pb.float(pb.greaterThan(this.shadowCascades, 0)),
          pb.float(pb.greaterThan(this.shadowCascades, 1)),
          pb.float(pb.greaterThan(this.shadowCascades, 2)),
          pb.float(pb.greaterThan(this.shadowCascades, 3))
        );
        this.split = pb.int(pb.dot(this.comparison, this.cascadeFlags));
        if (DEBUG_CASCADED_SHADOW_MAPS) {
          this.shadowDebugColor = this.shadowDebugColors.at(this.split);
        }
        this.$l.shadowVertex = pb.vec4();
        if (Application.instance.device.type === 'webgl') {
          this.$for(pb.int('cascade'), 0, 4, function () {
            this.$if(pb.equal(this.cascade, this.split), function () {
              this.shadowVertex = ShaderFramework.calculateShadowSpaceVertex(this, this.cascade);
              this.$break();
            });
          });
        } else {
          this.shadowVertex = ShaderFramework.calculateShadowSpaceVertex(this, this.split);
        }
        const shadowMapParams = ctx.shadowMapInfo.get(ctx.currentShadowLight);
        this.$l.shadow = shadowMapParams.impl.computeShadowCSM(shadowMapParams, this, this.shadowVertex, this.NdotL, this.split);
        this.$l.shadowDistance = ShaderFramework.getShadowCameraParams(scope).w;
        this.shadow = pb.mix(this.shadow, 1, pb.smoothStep(pb.mul(this.shadowDistance, 0.8), this.shadowDistance, pb.distance(ShaderFramework.getCameraPosition(this), ShaderFramework.getWorldPosition(this).xyz)));
        this.$if(pb.greaterThan(this.NdotL, 0), function () {
          this.$l.attenuation = pb.mul(pb.mul(this.lightcolor, this.NdotL), pb.vec3(this.shadow));
          if (DEBUG_CASCADED_SHADOW_MAPS) {
            this.attenuation = pb.mul(this.attenuation, this.shadowDebugColor);
          }
          illumLight(
            this,
            LIGHT_TYPE_DIRECTIONAL,
            lm,
            this.positionRange,
            this.directionCutoff,
            this.lightDir,
            this.attenuation
          );
        });
      }
    );
    pb.getGlobalScope()[funcNameIllumCascadedShadowLight]();
  }
  function illumOneLight(lm: LightModel, positionRange: PBShaderExp, directionCutoff: PBShaderExp, diffuseIntensity: PBShaderExp) {
    pb.func(
      funcNameIllumOneLight,
      [pb.vec4('positionRange'), pb.vec4('directionCutoff'), pb.vec4('diffuseIntensity')],
      function() {
        this.$l.lightcolor = pb.mul(this.diffuseIntensity.xyz, this.diffuseIntensity.w);
        this.$l.lightDir = pb.vec3();
        this.$l.nl = pb.float();
        this.$l.NdotL = pb.float();
        this.$l.lightType = pb.int();
        this.$if(pb.lessThan(this.positionRange.w, 0), function () {
          this.lightDir = this.directionCutoff.xyz;
          this.nl = pb.dot(this.surfaceData.normal, this.lightDir);
          this.NdotL = pb.clamp(pb.neg(this.nl), 0, 1);
          this.lightType = LIGHT_TYPE_DIRECTIONAL;
        }).$else(function () {
          this.lightDir = pb.sub(
            ShaderFramework.getWorldPosition(this).xyz,
            this.positionRange.xyz
          );
          this.$if(pb.greaterThan(pb.length(this.lightDir), this.positionRange.w), function () {
            this.$return();
          });
          this.lightDir = pb.normalize(this.lightDir);
          this.nl = pb.dot(this.surfaceData.normal, this.lightDir);
          this.NdotL = pb.clamp(pb.neg(this.nl), 0, 1);
          this.$if(pb.lessThan(this.directionCutoff.w, 0), function(){
            this.lightType = LIGHT_TYPE_POINT;
          }).$else(function(){
            this.lightType = LIGHT_TYPE_SPOT;
          });
        });
        this.$if(pb.greaterThan(this.NdotL, 0), function () {
          illumLight(
            this,
            this.lightType,
            lm,
            this.positionRange,
            this.directionCutoff,
            this.lightDir,
            pb.mul(this.lightcolor, this.NdotL)
          );
        });
      }
    )
    pb.getGlobalScope()[funcNameIllumOneLight](positionRange, directionCutoff, diffuseIntensity);
  }
  function getClusterIndex(fragCoord: PBShaderExp) {
    pb.func(funcNameGetClusterIndex, [pb.vec3('fragCoord')], function(){
      const clusterParams = ShaderFramework.getClusterParams(this);
      const countParams = ShaderFramework.getCountParams(this);
      this.$l.zTile = pb.int(pb.max(pb.add(pb.mul(pb.log2(nonLinearDepthToLinear(this, this.fragCoord.z)), clusterParams.z), clusterParams.w), 0));
      this.$l.f = pb.vec2(this.fragCoord.x, pb.sub(clusterParams.y, pb.add(this.fragCoord.y, 1)));
      this.$l.xyTile = pb.ivec2(pb.div(this.f, pb.div(clusterParams.xy, pb.vec2(countParams.xy))));
      this.$return(pb.ivec3(this.xyTile, this.zTile));
    });
    return pb.getGlobalScope()[funcNameGetClusterIndex](fragCoord);
  }
  function illumUnshadowedLights(lm: LightModel) {
    pb.func(
      funcNameIllumUnshadowedLights,
      [],
      function () {
        const countParams = ShaderFramework.getCountParams(this);
        this.$l.cluster = getClusterIndex(this.$builtins.fragCoord.xyz);
        this.$l.clusterIndex = (pb.add(this.cluster.x, pb.mul(this.cluster.y, countParams.x), pb.mul(this.cluster.z, countParams.x, countParams.y)));
        this.$l.texSize = this.global.light.lightIndexTexSize;
        if (pb.getDevice().type === 'webgl') {
          this.$l.texCoordX = pb.div(pb.add(pb.mod(pb.float(this.clusterIndex), pb.float(this.texSize.x)), 0.5), pb.float(this.texSize.x));
          this.$l.texCoordY = pb.div(pb.add(pb.float(pb.div(this.clusterIndex, this.texSize.x)), 0.5), pb.float(this.texSize.y));
          this.$l.samp = pb.textureSample(ShaderFramework.getClusteredLightIndexTexture(this), pb.vec2(this.texCoordX, this.texCoordY));
        } else {
          // this.$l.texSize = pb.ivec2(pb.textureDimensions(ShaderFramework.getClusteredLightIndexTexture(this), 0));
          this.$l.texCoordX = pb.mod(this.clusterIndex, this.texSize.x);
          this.$l.texCoordY = pb.div(this.clusterIndex, this.texSize.x);
          this.$l.samp = pb.textureLoad(ShaderFramework.getClusteredLightIndexTexture(this), pb.ivec2(this.texCoordX, this.texCoordY), 0);
        }
        if (pb.getDevice().type === 'webgl') {
          this.$for(pb.int('i'), 0, 4, function(){
            this.$l.k = this.samp.at(this.i);
            this.$l.lights = pb.int[2]();
            this.$l.lights[0] = pb.int(pb.mod(this.k, 256));
            this.$l.lights[1] = pb.int(pb.div(this.k, 256));
            this.$for(pb.int('k'), 0, 2, function(){
              this.$l.li = this.lights.at(this.k);
              this.$if(pb.greaterThan(this.li, 0), function(){
                this.$for(pb.int('j'), 1, 256, function(){
                  this.$if(pb.equal(this.j, this.li), function() {
                    this.$l.positionRange = ShaderFramework.getLightPositionAndRange(this, this.j);
                    this.$l.directionCutoff = ShaderFramework.getLightDirectionAndCutoff(this, this.j);
                    this.$l.diffuseIntensity = ShaderFramework.getLightColorAndIntensity(this, this.j);
                    illumOneLight(lm, this.positionRange, this.directionCutoff, this.diffuseIntensity);
                    this.$break();
                  });
                });
              })
            });
          });
        } else {
          this.$for(pb.uint('i'), 0, 4, function(){
            this.$for(pb.uint('k'), 0, 4, function(){
              this.$l.c = pb.compAnd(pb.sar(this.samp.at(this.i), pb.mul(this.k, 8)), 0xff);
              this.$if(pb.greaterThan(this.c, 0), function(){
                this.$l.positionRange = ShaderFramework.getLightPositionAndRange(this, this.c);
                this.$l.directionCutoff = ShaderFramework.getLightDirectionAndCutoff(this, this.c);
                this.$l.diffuseIntensity = ShaderFramework.getLightColorAndIntensity(this, this.c);
                illumOneLight(lm, this.positionRange, this.directionCutoff, this.diffuseIntensity);
              });
            });
          });
        }
      }
    );
    pb.getGlobalScope()[funcNameIllumUnshadowedLights]();
  }
  pb.func(funcNameComputeLighting, [], function () {
    const worldPosition = ShaderFramework.getWorldPosition(this);
    const worldNormal = ShaderFramework.getWorldNormal(this);
    const worldTangent = ShaderFramework.getWorldTangent(this);
    const worldBinormal = ShaderFramework.getWorldBinormal(this);
    lm.getSurfaceData(
      this,
      env,
      worldPosition,
      worldNormal,
      worldTangent,
      worldBinormal
    );
    ShaderFramework.discardIfClipped(this);
    if (lm.supportLighting()) {
      if (env) {
        lm.envBRDF(env, this);
      }
      if (ctx.currentShadowLight) {
        const shadowMapParams = ctx.shadowMapInfo.get(ctx.currentShadowLight);
        if (shadowMapParams.numShadowCascades > 1) {
          illumCascadedShadowLight(lm);
        } else if (shadowMapParams.shadowMap.isTextureCube()) {
          illumPointShadowLight(lm);
        } else {
          illumDirectionalShadowLight(shadowMapParams.lightType, lm);
        }
      } else {
        illumUnshadowedLights(lm);
      }
    }
    this.$return(lm.finalComposite(this));
    // this.$l.result = pb.add(this.lightDiffuse, this.lightSpecular);
    // this.$return(pb.vec4(this.result, this.surfaceData.diffuse.a));
  });
  return pb.getGlobalScope()[funcNameComputeLighting]();
}

