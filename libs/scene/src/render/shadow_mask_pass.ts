import { Vector2, Vector4 } from '@zephyr3d/base';
import type { Nullable } from '@zephyr3d/base';
import type {
  AbstractDevice,
  BindGroup,
  FrameBuffer,
  GPUProgram,
  PBShaderExp,
  RenderStateSet,
  Texture2D
} from '@zephyr3d/device';
import type { DrawContext } from './drawable';
import type { PunctualLight } from '../scene/light';
import type { ShadowMapParams } from '../shadow/shadowmapper';
import { ShaderHelper } from '../material/shader/helper';
import { drawFullscreenQuad } from './fullscreenquad';
import { MAX_SHADOW_MASK_LIGHTS } from '../values';

const UNIFORM_NAME_SHADOW_MAP = 'Z_UniformShadowMap';

/**
 * Number of shadow-casting lights packed into a single RGBA8 mask array layer.
 * One light per color channel.
 */
export const SHADOW_MASK_LIGHTS_PER_LAYER = 4;

/**
 * Maximum number of shadow mask array layers, derived from the per-light cap.
 */
export const MAX_SHADOW_MASK_LAYERS = MAX_SHADOW_MASK_LIGHTS / SHADOW_MASK_LIGHTS_PER_LAYER;

/**
 * Renders the screen-space shadow mask for the Forward+ pipeline.
 *
 * For each shadow-casting light, the light's visibility factor `[0,1]` (1 = lit,
 * 0 = fully shadowed) is reconstructed from the linear depth prepass and written
 * into one channel of one layer of an `rgba8unorm` texture array. Four lights are
 * packed per layer (one per RGBA channel).
 *
 * The layer/channel assignment must stay in lockstep with
 * {@link ClusteredLight.getVisibleLights}: shadow-casting lights occupy clustered
 * buffer indices `1..N` in the order of `renderQueue.shadowedLights`. The zero-based
 * light ordinal `s = index - 1` maps to `layer = s >> 2`, `channel = s & 3`. The
 * clustered shading pass recovers the same mapping from a light's buffer index, so
 * no per-light mask index is stored.
 *
 * @internal
 */
export class ShadowMaskRenderer {
  /** Fullscreen mask programs keyed by a per-light shader signature. */
  private _programs: Map<string, GPUProgram>;
  /** Bind groups paired with each cached program. */
  private _bindGroups: Map<string, BindGroup>;
  /** One render state per RGBA channel (color mask selects the target channel). */
  private _channelStates: Nullable<RenderStateSet[]>;
  private readonly _nearFar: Vector2;
  private readonly _cameraPosition: Vector4;
  private readonly _cameraParams: Vector4;

  constructor() {
    this._programs = new Map();
    this._bindGroups = new Map();
    this._channelStates = null;
    this._nearFar = new Vector2();
    this._cameraPosition = new Vector4();
    this._cameraParams = new Vector4();
  }

  /**
   * Number of array layers required to hold `numLights` shadow lights.
   * @param numLights - Number of shadow-casting lights.
   * @returns Layer count, clamped to {@link MAX_SHADOW_MASK_LAYERS}.
   */
  static getLayerCount(numLights: number): number {
    const n = Math.min(numLights, MAX_SHADOW_MASK_LIGHTS);
    return Math.min(Math.ceil(n / SHADOW_MASK_LIGHTS_PER_LAYER), MAX_SHADOW_MASK_LAYERS);
  }

  /**
   * Render the shadow mask for the given shadow-casting lights.
   *
   * @param ctx - Draw context (must carry shadowMapInfo for the lights).
   * @param depthTexture - Linear depth texture from the depth prepass.
   * @param lights - Shadow-casting lights, in clustered-buffer order (index 1..N).
   * @param getLayerFramebuffer - Resolves the framebuffer bound to mask array layer `k`.
   */
  render(
    ctx: DrawContext,
    depthTexture: Texture2D,
    lights: PunctualLight[],
    getLayerFramebuffer: (layer: number) => FrameBuffer
  ): void {
    const device = ctx.device;
    const numLights = Math.min(lights.length, MAX_SHADOW_MASK_LIGHTS);
    if (numLights === 0 || !ctx.shadowMapInfo) {
      return;
    }
    const numLayers = ShadowMaskRenderer.getLayerCount(numLights);
    const channelStates = this.getChannelStates(device);
    const savedShadowLight = ctx.currentShadowLight;

    device.pushDeviceStates();
    for (let layer = 0; layer < numLayers; layer++) {
      const framebuffer = getLayerFramebuffer(layer);
      device.setFramebuffer(framebuffer);
      // Clear to "fully lit" (1 = no shadow) so channels without an assigned
      // light, and pixels outside any shadow, read as unshadowed. The mask array
      // has no depth attachment, so depth/stencil clear args are null.
      device.clearFrameBuffer(new Vector4(1, 1, 1, 1), null, null);
      for (let channel = 0; channel < SHADOW_MASK_LIGHTS_PER_LAYER; channel++) {
        const ordinal = layer * SHADOW_MASK_LIGHTS_PER_LAYER + channel;
        if (ordinal >= numLights) {
          break;
        }
        const light = lights[ordinal];
        const shadowMapParams = ctx.shadowMapInfo.get(light);
        if (!shadowMapParams || !shadowMapParams.shadowMap) {
          continue;
        }
        // Record where this light lives in the mask so downstream samplers (e.g.
        // the SSS combine pass) can read its channel without recomputing shadows.
        shadowMapParams.maskOrdinal = ordinal;
        ctx.currentShadowLight = light;
        this.renderLightChannel(ctx, depthTexture, light, shadowMapParams, channelStates[channel]);
      }
    }
    device.popDeviceStates();
    ctx.currentShadowLight = savedShadowLight;
  }

  /** Render one shadow light into one color channel of the current framebuffer. */
  private renderLightChannel(
    ctx: DrawContext,
    depthTexture: Texture2D,
    light: PunctualLight,
    shadowMapParams: ShadowMapParams,
    renderState: RenderStateSet
  ): void {
    const device = ctx.device;
    const key = this.getProgramKey(ctx, shadowMapParams);
    let program = this._programs.get(key) ?? null;
    let bindGroup = this._bindGroups.get(key) ?? null;
    if (!program) {
      program = this.createProgram(ctx, shadowMapParams);
      bindGroup = device.createBindGroup(program.bindGroupLayouts[0]);
      this._programs.set(key, program);
      this._bindGroups.set(key, bindGroup);
    }
    bindGroup = this._bindGroups.get(key)!;
    this.setUniforms(bindGroup, ctx, depthTexture, light, shadowMapParams);
    device.setProgram(program);
    device.setBindGroup(0, bindGroup);
    drawFullscreenQuad(renderState);
  }

  /**
   * The program signature: distinct shadow implementations, cascade counts and
   * shadow map types must not share a compiled program.
   */
  private getProgramKey(ctx: DrawContext, shadowMapParams: ShadowMapParams): string {
    return `${ctx.device.type}|${shadowMapParams.shaderHash}`;
  }

  private getChannelStates(device: AbstractDevice): RenderStateSet[] {
    if (!this._channelStates) {
      this._channelStates = [];
      for (let c = 0; c < SHADOW_MASK_LIGHTS_PER_LAYER; c++) {
        const rs = device.createRenderStateSet();
        rs.useDepthState().enableTest(false).enableWrite(false);
        rs.useRasterizerState().setCullMode('none');
        rs.useColorState().setColorMask(c === 0, c === 1, c === 2, c === 3);
        this._channelStates.push(rs);
      }
    }
    return this._channelStates;
  }

  private setUniforms(
    bindGroup: BindGroup,
    ctx: DrawContext,
    depthTexture: Texture2D,
    light: PunctualLight,
    shadowMapParams: ShadowMapParams
  ): void {
    const camera = ctx.camera;
    const near = camera.getNearPlane();
    const far = camera.getFarPlane();
    const cameraPos = camera.getWorldPosition();
    this._cameraPosition.setXYZW(cameraPos.x, cameraPos.y, cameraPos.z, 0);
    this._cameraParams.setXYZW(near, far, 1, 1);
    this._nearFar.setXY(near, far);
    bindGroup.setValue('camera', {
      position: this._cameraPosition,
      params: this._cameraParams,
      shadowDebugCascades: camera.shadowDebugCascades ? 1 : 0,
      framestamp: ctx.device.frameInfo.frameCounter
    });
    // Full shadow light struct (matches helper.ts currentShadowLight lightStruct,
    // including implParams which PCSS/VSM impls read via getShadowImplParams).
    const implParams = new Vector4();
    shadowMapParams.impl!.getParams(implParams);
    bindGroup.setValue('light', {
      sunDir: ctx.sunLight
        ? ctx.sunLight.directionAndCutoff.xyz().scaleBy(-1)
        : new Vector4(0, 1, 0, 0).xyz(),
      shadowCascades: shadowMapParams.numShadowCascades,
      positionAndRange: light.positionAndRange,
      directionAndCutoff: light.directionAndCutoff,
      diffuseAndIntensity: light.diffuseAndIntensity,
      extraParams: light.extraParams,
      cascadeDistances: shadowMapParams.cascadeDistances,
      depthBiasValues: shadowMapParams.depthBiasValues[0],
      shadowCameraParams: shadowMapParams.cameraParams,
      depthBiasScales: shadowMapParams.depthBiasScales,
      implParams: implParams,
      shadowMatrices: new Float32Array(shadowMapParams.shadowMatrices),
      shadowStrength: light.shadow.shadowStrength,
      envLightStrength: ctx.env?.light.strength ?? 0,
      envLightSpecularStrength: ctx.env?.light.specularStrength ?? 1
    });
    bindGroup.setValue('invViewProjMatrix', camera.invViewProjectionMatrix);
    bindGroup.setValue('cameraNearFar', this._nearFar);
    bindGroup.setValue('flip', this.needFlip(ctx.device) ? 1 : 0);
    bindGroup.setTexture('depthTex', depthTexture);
    bindGroup.setTexture(
      UNIFORM_NAME_SHADOW_MAP,
      shadowMapParams.shadowMap!,
      shadowMapParams.shadowMapSampler
    );
  }

  /**
   * Whether the fullscreen output needs a vertical flip. Mask array layers are
   * offscreen render targets, so the convention matches other offscreen passes
   * (no flip); WebGPU still flips clip-space Y in the vertex shader.
   */
  private needFlip(_device: AbstractDevice): boolean {
    return false;
  }

  private createProgram(ctx: DrawContext, shadowMapParams: ShadowMapParams): GPUProgram {
    const device = ctx.device;
    const numCascades = shadowMapParams.numShadowCascades;
    const shadowMap = shadowMapParams.shadowMap!;
    const program = device.buildRenderProgram({
      label: 'ShadowMask',
      vertex(pb) {
        this.flip = pb.int().uniform(0);
        this.$inputs.pos = pb.vec2().attrib('position');
        this.$outputs.uv = pb.vec2();
        pb.main(function () {
          this.$builtins.position = pb.vec4(this.$inputs.pos, 1, 1);
          this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
          this.$if(pb.notEqual(this.flip, 0), function () {
            this.$builtins.position.y = pb.neg(this.$builtins.position.y);
          });
          if (device.type === 'webgpu') {
            this.$builtins.position.y = pb.neg(this.$builtins.position.y);
          }
        });
      },
      fragment(pb) {
        const cameraStruct = pb.defineStruct([
          pb.vec4('position'),
          pb.vec4('params'),
          pb.float('shadowDebugCascades'),
          // Required by PCSS temporal jitter (ShaderHelper.getFramestamp).
          pb.int('framestamp')
        ]);
        // Must match helper.ts currentShadowLight lightStruct field-for-field.
        const lightStruct = pb.defineStruct([
          pb.vec3('sunDir'),
          pb.int('shadowCascades'),
          pb.vec4('positionAndRange'),
          pb.vec4('directionAndCutoff'),
          pb.vec4('diffuseAndIntensity'),
          pb.vec4('extraParams'),
          pb.vec4('cascadeDistances'),
          pb.vec4('depthBiasValues'),
          pb.vec4('shadowCameraParams'),
          pb.vec4('depthBiasScales'),
          pb.vec4('implParams'),
          pb.vec4[16]('shadowMatrices'),
          pb.float('shadowStrength'),
          pb.float('envLightStrength'),
          pb.float('envLightSpecularStrength')
        ]);
        this.camera = cameraStruct().uniform(0);
        this.light = lightStruct().uniform(0);
        const shadowTex = shadowMap.isTextureCube()
          ? shadowMap.isDepth()
            ? pb.texCubeShadow()
            : pb.texCube()
          : shadowMap.isTexture2D()
            ? shadowMap.isDepth()
              ? pb.tex2DShadow()
              : pb.tex2D()
            : shadowMap.isDepth()
              ? pb.tex2DArrayShadow()
              : pb.tex2DArray();
        if (
          !shadowMap.isDepth() &&
          !device.getDeviceCaps().textureCaps.getTextureFormatInfo(shadowMap.format).filterable
        ) {
          shadowTex.sampleType('unfilterable-float');
        }
        this[UNIFORM_NAME_SHADOW_MAP] = shadowTex.uniform(0);
        this.depthTex = pb.tex2D().uniform(0);
        this.invViewProjMatrix = pb.mat4().uniform(0);
        this.cameraNearFar = pb.vec2().uniform(0);
        this.$outputs.color = pb.vec4();
        // Explicit-depth cascade selection (fragCoord.z is invalid in a fullscreen
        // pass). Mirrors posteffect/sss.ts calculateTransmissionShadow.
        pb.func(
          'zShadowMaskFactor',
          [pb.vec3('worldPos'), pb.float('depth01'), pb.float('NoL')],
          function () {
            if (numCascades > 1) {
              this.$l.linearDepth = pb.mul(this.depth01, this.camera.params.y);
              this.$l.splitDistances = this.light.cascadeDistances;
              this.$l.comparison = pb.vec4(pb.greaterThan(pb.vec4(this.linearDepth), this.splitDistances));
              this.$l.cascadeFlags = pb.vec4(
                pb.float(pb.greaterThan(this.light.shadowCascades, 0)),
                pb.float(pb.greaterThan(this.light.shadowCascades, 1)),
                pb.float(pb.greaterThan(this.light.shadowCascades, 2)),
                pb.float(pb.greaterThan(this.light.shadowCascades, 3))
              );
              this.$l.split = pb.int(pb.dot(this.comparison, this.cascadeFlags));
              if (device.type === 'webgl') {
                this.$l.shadowVertex = pb.vec4();
                this.$for(pb.int('cascade'), 0, 4, function () {
                  this.$if(pb.equal(this.cascade, this.split), function () {
                    this.shadowVertex = ShaderHelper.calculateShadowSpaceVertex(
                      this,
                      pb.vec4(this.worldPos, 1),
                      this.cascade
                    );
                    this.$break();
                  });
                });
              } else {
                this.$l.shadowVertex = ShaderHelper.calculateShadowSpaceVertex(
                  this,
                  pb.vec4(this.worldPos, 1),
                  this.split
                );
              }
              this.$l.shadow = shadowMapParams.impl!.computeShadowCSM(
                shadowMapParams,
                this,
                this.shadowVertex,
                this.NoL,
                this.split
              );
              this.$l.shadowDistance = this.light.shadowCameraParams.w;
              this.shadow = pb.mix(
                this.shadow,
                1,
                pb.smoothStep(
                  pb.mul(this.shadowDistance, 0.8),
                  this.shadowDistance,
                  pb.distance(this.camera.position.xyz, this.worldPos)
                )
              );
              this.shadow = pb.mix(1, this.shadow, this.light.shadowStrength);
              this.$return(pb.clamp(this.shadow, 0, 1));
            } else {
              this.$l.shadowVertex = ShaderHelper.calculateShadowSpaceVertex(this, pb.vec4(this.worldPos, 1));
              this.$l.shadow = shadowMapParams.impl!.computeShadow(
                shadowMapParams,
                this,
                this.shadowVertex,
                this.NoL
              );
              this.$l.shadowDistance = this.light.shadowCameraParams.w;
              this.shadow = pb.mix(
                this.shadow,
                1,
                pb.smoothStep(
                  pb.mul(this.shadowDistance, 0.8),
                  this.shadowDistance,
                  pb.distance(this.camera.position.xyz, this.worldPos)
                )
              );
              this.shadow = pb.mix(1, this.shadow, this.light.shadowStrength);
              this.$return(pb.clamp(this.shadow, 0, 1));
            }
          }
        );
        pb.main(function () {
          this.$l.pos = ShaderHelper.samplePositionFromDepth(
            this,
            this.depthTex,
            this.$inputs.uv,
            this.invViewProjMatrix,
            this.cameraNearFar
          );
          // NoL is unavailable in a fullscreen pass (no geometric normal); it only
          // feeds normal-offset bias, so a conservative 1.0 is used.
          this.$l.factor = this.zShadowMaskFactor(this.pos.xyz, this.pos.w, pb.float(1));
          this.$outputs.color = pb.vec4(this.factor);
        });
      }
    })!;
    program.name = '@ShadowMask';
    return program;
  }

  /** Release cached GPU resources. */
  dispose(): void {
    for (const program of this._programs.values()) {
      program.dispose();
    }
    this._programs.clear();
    this._bindGroups.clear();
    this._channelStates = null;
  }
}

/** Shared type alias to keep the mask factor accessor discoverable. */
export type ShadowMaskFactorExp = PBShaderExp;
