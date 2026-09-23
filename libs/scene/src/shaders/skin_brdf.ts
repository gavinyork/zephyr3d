import type { PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { distributionGGX, fresnelSchlick, visGGX } from './pbr';
import { SKIN_TRANSMISSION_NO_DATA_ENCODING, SkinProfile } from '../material/skinprofile';

/**
 * Opacity below which the dual-lobe specular fades back to a single lobe.
 *
 * @remarks
 * `SSSS_OPACITY_THRESHOLD_EPS` in UE5. The fade completes by the time opacity
 * reaches this value rather than at 0, which avoids a discontinuity on
 * nearly-opaque skin.
 *
 * Note there is no `SSSS_MAX_DUAL_SPECULAR_ROUGHNESS` factor here. In UE5 that
 * constant only undoes the profile texture's encoding — the authored value is
 * divided by 2 when packed and multiplied by 2 when read. The profile here
 * carries the authored multiplier directly, so applying it again would double
 * every lobe.
 *
 * @internal
 */

const OPACITY_THRESHOLD_EPS = 0.1;

/**
 * Multiple-scattering energy terms for a GGX specular lobe.
 *
 * @remarks
 * A single-scattering GGX lobe loses energy at high roughness, because light that
 * would have bounced again between microfacets is simply dropped. UE5 compensates
 * with a directional-albedo estimate (`ShadingEnergyConservation.ush`):
 *
 * ```
 * E  = 1 - saturate(pow(r, c/r) * ((r*c + 0.0266916) / (0.466495 + c)))
 * Ef = Pow5(1 - c) * pow(2.36651 * pow(c, 4.7703*r) + 0.0387332, r)
 * W  = 1 + F0 * ((1 - E) / E)
 * A  = W * (E*F0 + Ef*(F90 - F0))
 * ```
 *
 * `W` scales the specular lobe to restore the lost energy, and `A` is the share
 * of incoming light that lobe reflects — the diffuse below it is attenuated by
 * `1 - A` so the surface never reflects more than it receives.
 *
 * This is the `USE_ENERGY_CONSERVATION == 2` path, an analytic fit that needs no
 * lookup texture. UE5's default path samples a baked LUT instead; the fit exists
 * precisely so the terms can be had without binding one.
 *
 * @param scope - Shader scope.
 * @param roughness - Roughness of the lobe being corrected.
 * @param NoV - Clamped dot(normal, viewDir).
 * @param F0 - Fresnel reflectance at normal incidence.
 * @returns `vec2(W, A)`: specular gain and reflected share.
 *
 * @internal
 */
export function skinSpecularEnergyTerms(
  scope: PBInsideFunctionScope,
  roughness: PBShaderExp,
  NoV: PBShaderExp,
  F0: PBShaderExp
): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'lib_skinSpecularEnergyTerms';
  pb.func(funcName, [pb.float('roughness'), pb.float('NoV'), pb.float('F0')], function () {
    this.$l.r = pb.max(this.roughness, 1e-3);
    this.$l.c = pb.max(this.NoV, 1e-3);
    this.$l.E = pb.sub(
      1,
      pb.clamp(
        pb.mul(
          pb.pow(this.r, pb.div(this.c, this.r)),
          pb.div(pb.add(pb.mul(this.r, this.c), 0.0266916), pb.add(0.466495, this.c))
        ),
        0,
        1
      )
    );
    this.E = pb.max(this.E, 1e-4);
    this.$l.oneMinusC = pb.sub(1, this.c);
    this.$l.pow5 = pb.mul(
      pb.mul(this.oneMinusC, this.oneMinusC),
      pb.mul(this.oneMinusC, this.oneMinusC),
      this.oneMinusC
    );
    this.$l.Ef = pb.mul(
      this.pow5,
      pb.pow(pb.add(pb.mul(2.36651, pb.pow(this.c, pb.mul(4.7703, this.r))), 0.0387332), this.r)
    );
    // F90 from micro-occlusion, as UE5 derives it when only F0 is supplied.
    this.$l.F90 = pb.clamp(pb.mul(50, this.F0), 0, 1);
    this.$l.W = pb.add(1, pb.mul(this.F0, pb.div(pb.sub(1, this.E), this.E)));
    this.$l.A = pb.mul(this.W, pb.add(pb.mul(this.E, this.F0), pb.mul(this.Ef, pb.sub(this.F90, this.F0))));
    this.$return(pb.vec2(this.W, pb.clamp(this.A, 0, 1)));
  });
  return pb.getGlobalScope()[funcName](roughness, NoV, F0) as PBShaderExp;
}

/**
 * Burley diffuse BRDF, as UE5 evaluates it for the SubsurfaceProfile shading model.
 *
 * @remarks
 * Transcribed from `Diffuse_Burley` in UE5's `BRDF.ush`:
 *
 * ```
 * FD90 = 0.5 + 2 VoH^2 Roughness
 * FdV  = 1 + (FD90 - 1) (1 - NoV)^5
 * FdL  = 1 + (FD90 - 1) (1 - NoL)^5
 * result = albedo / PI * FdV * FdL
 * ```
 *
 * The caller multiplies by `NoL` and the light colour, exactly as
 * `SubsurfaceProfileBxDF` does — the softness of skin at the terminator comes
 * from the screen-space diffusion, not from bending this term. An earlier
 * version of this function used a curvature-driven wrapped diffuse that skipped
 * the `NoL` clamp to fake that softness; it had no counterpart in UE5 and
 * double-counted what the diffusion already provides.
 *
 * @param scope - Shader scope.
 * @param NdotV - Clamped dot(normal, viewDir).
 * @param NdotL - Clamped dot(normal, lightDir).
 * @param VdotH - dot(viewDir, halfVector).
 * @param roughness - Material roughness.
 * @returns Scalar diffuse BRDF value; the caller applies albedo and `NoL`.
 *
 * @internal
 */
export function skinDiffuseBRDF(
  scope: PBInsideFunctionScope,
  NdotV: PBShaderExp,
  NdotL: PBShaderExp,
  VdotH: PBShaderExp,
  roughness: PBShaderExp
): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'lib_skinDiffuseBurley';
  pb.func(
    funcName,
    [pb.float('NdotV'), pb.float('NdotL'), pb.float('VdotH'), pb.float('roughness')],
    function () {
      this.$l.fd90 = pb.add(0.5, pb.mul(2, this.VdotH, this.VdotH, this.roughness));
      this.$l.fd90m1 = pb.sub(this.fd90, 1);
      this.$l.oneMinusNoV = pb.sub(1, this.NdotV);
      this.$l.pow5V = pb.mul(
        pb.mul(this.oneMinusNoV, this.oneMinusNoV),
        pb.mul(this.oneMinusNoV, this.oneMinusNoV),
        this.oneMinusNoV
      );
      this.$l.oneMinusNoL = pb.sub(1, this.NdotL);
      this.$l.pow5L = pb.mul(
        pb.mul(this.oneMinusNoL, this.oneMinusNoL),
        pb.mul(this.oneMinusNoL, this.oneMinusNoL),
        this.oneMinusNoL
      );
      this.$l.fdV = pb.add(1, pb.mul(this.fd90m1, this.pow5V));
      this.$l.fdL = pb.add(1, pb.mul(this.fd90m1, this.pow5L));
      this.$return(pb.mul(1 / Math.PI, this.fdV, this.fdL));
    }
  );
  return pb.getGlobalScope()[funcName](NdotV, NdotL, VdotH, roughness) as PBShaderExp;
}

/**
 * Resolves the two specular lobe roughnesses from the profile.
 *
 * @remarks
 * Transcribed from `GetSubsurfaceProfileDualSpecular` in UE5:
 *
 * ```
 * scale_n = lerp(1, Roughness_n, saturate((Opacity - EPS) * 10))
 * LobeRoughness0 = max(saturate(Roughness * scale_0), 0.02)
 * LobeRoughness1 =     saturate(Roughness * scale_1)
 * ```
 *
 * The scaling is multiplicative on the material roughness: UE5 authors these in
 * 0.5..2.0, so 1.0 leaves the roughness alone, 0.75 tightens the narrow lobe and
 * 1.3 broadens the wide one. Only lobe 0 gets the 0.02 floor, which keeps the
 * tight highlight from collapsing into a fireflying delta.
 *
 * @param scope - Shader scope.
 * @param roughness - Material roughness.
 * @param opacity - Subsurface opacity, used to fade the effect out.
 * @param lobe0Scale - Profile roughness multiplier for the narrow lobe.
 * @param lobe1Scale - Profile roughness multiplier for the wide lobe.
 * @returns `vec2(lobe0Roughness, lobe1Roughness)`.
 *
 * @internal
 */
export function skinDualSpecularRoughness(
  scope: PBInsideFunctionScope,
  roughness: PBShaderExp,
  opacity: PBShaderExp,
  lobe0Scale: PBShaderExp,
  lobe1Scale: PBShaderExp
): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'lib_skinDualSpecularRoughness';
  pb.func(
    funcName,
    [pb.float('roughness'), pb.float('opacity'), pb.float('lobe0Scale'), pb.float('lobe1Scale')],
    function () {
      this.$l.fade = pb.clamp(pb.mul(pb.sub(this.opacity, OPACITY_THRESHOLD_EPS), 10), 0, 1);
      this.$l.scale0 = pb.mix(pb.float(1), this.lobe0Scale, this.fade);
      this.$l.scale1 = pb.mix(pb.float(1), this.lobe1Scale, this.fade);
      this.$return(
        pb.vec2(
          pb.max(pb.clamp(pb.mul(this.roughness, this.scale0), 0, 1), 0.02),
          pb.clamp(pb.mul(this.roughness, this.scale1), 0, 1)
        )
      );
    }
  );
  return pb.getGlobalScope()[funcName](roughness, opacity, lobe0Scale, lobe1Scale) as PBShaderExp;
}

/**
 * Dual-lobe GGX specular for skin.
 *
 * @remarks
 * Transcribed from `DualSpecularGGX` in UE5's `ShadingModels.ush`:
 *
 * ```
 * D   = lerp(D_GGX(Pow4(r0), NoH), D_GGX(Pow4(r1), NoH), LobeMix)
 * Vis = Vis_SmithJointApprox(Pow4(AverageRoughness), NoV, NoL)
 * F   = F_Schlick(SpecularColor, VoH)
 * ```
 *
 * Two details are easy to get wrong. The lobe roughness enters as `Pow4`, since
 * UE's `alpha = Roughness^2` and `D_GGX` takes `alpha^2`; the helpers here square
 * their argument internally, so they are handed `roughness^2`. And visibility is
 * evaluated **once** from the blended average roughness rather than per lobe,
 * which UE notes approximates the two-lobe result closely.
 *
 * Area-light energy normalization per lobe is omitted: it is only meaningful for
 * area lights, which this material does not represent.
 *
 * @param scope - Shader scope.
 * @param NoH - dot(normal, halfVector).
 * @param NoV - dot(normal, viewDir).
 * @param NoL - dot(normal, lightDir).
 * @param VoH - dot(viewDir, halfVector).
 * @param lobeRoughness - `vec2` of the two lobe roughnesses.
 * @param lobeMix - Blend between the narrow and wide lobe.
 * @param F0 - Specular colour at normal incidence.
 * @returns vec3 specular contribution; the caller applies light colour and `NoL`.
 *
 * @internal
 */
export function skinDualLobeSpecular(
  scope: PBInsideFunctionScope,
  NoH: PBShaderExp,
  NoV: PBShaderExp,
  NoL: PBShaderExp,
  VoH: PBShaderExp,
  lobeRoughness: PBShaderExp,
  lobeMix: PBShaderExp,
  F0: PBShaderExp
): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'lib_skinDualLobeSpecular';
  pb.func(
    funcName,
    [
      pb.float('NoH'),
      pb.float('NoV'),
      pb.float('NoL'),
      pb.float('VoH'),
      pb.vec2('lobeRoughness'),
      pb.float('lobeMix'),
      pb.float('F0')
    ],
    function () {
      // The helpers square what they are given, so `roughness^2` here yields
      // UE's Pow4(roughness).
      this.$l.a0 = pb.mul(this.lobeRoughness.x, this.lobeRoughness.x);
      this.$l.a1 = pb.mul(this.lobeRoughness.y, this.lobeRoughness.y);
      this.$l.avgRoughness = pb.mix(this.lobeRoughness.x, this.lobeRoughness.y, this.lobeMix);
      this.$l.avgAlpha = pb.mul(this.avgRoughness, this.avgRoughness);
      this.$l.D = pb.mix(
        distributionGGX(this, this.NoH, this.a0),
        distributionGGX(this, this.NoH, this.a1),
        this.lobeMix
      );
      // One visibility term from the average roughness, as UE5 does.
      this.$l.Vis = visGGX(this, this.NoV, this.NoL, this.avgAlpha);
      this.$l.F = fresnelSchlick(this, this.VoH, pb.vec3(this.F0), pb.vec3(1));
      this.$return(pb.mul(this.F, pb.mul(this.D, this.Vis)));
    }
  );
  return pb.getGlobalScope()[funcName](NoH, NoV, NoL, VoH, lobeRoughness, lobeMix, F0) as PBShaderExp;
}

/**
 * Fetches one column of a profile row from the packed table.
 *
 * @remarks
 * The table is `rgba32f`, which WebGPU classifies as `unfilterable-float`, so
 * the bound sampler has to be non-filtering and this is an exact texel fetch
 * despite going through `textureSampleLevel`. Anything that wants interpolation
 * between columns — the transmission profile below — has to lerp two fetches by
 * hand; binding a linear sampler instead is not an option.
 *
 * This emits the fetch inline rather than wrapping it in a shader function. A
 * texture *can* be a function parameter, but on WebGPU its sampler has to travel
 * alongside it as a second parameter (see `blueprint/material/ir.ts`), and a
 * plain `textureSampleLevel` on the parameter alone compiles to nothing usable.
 * Reading the uniform where it is declared sidesteps that entirely.
 *
 * @param scope - Shader scope.
 * @param tex - The packed profile table, as declared in the caller's scope.
 * @param texelSize - `vec2(1 / columns, 1 / rows)`.
 * @param row - Precomputed `v` coordinate of the profile's row.
 * @param column - Column to read, as a float.
 * @returns The `vec4` stored at that column.
 *
 * @internal
 */
function readSkinProfileColumn(
  scope: PBInsideFunctionScope,
  tex: PBShaderExp,
  texelSize: PBShaderExp,
  row: PBShaderExp,
  column: PBShaderExp
): PBShaderExp {
  const pb = scope.$builder;
  return pb.textureSampleLevel(tex, pb.vec2(pb.mul(pb.add(column, 0.5), texelSize.x), row), 0);
}

/**
 * Back-lit subsurface transmission, after UE5's `SubsurfaceProfileBxDF`.
 *
 * @remarks
 * Transcribed from `ShadingModels.ush:653-663`:
 *
 * ```
 * ShadowOpticalDepth = DecodeOpticalDepthFromShadowMask(Shadow.TransmittanceOrOpticalThickness)
 * Profile            = GetTransmissionProfile(ProfileId, ShadowOpticalDepth).rgb
 * RefracV            = refract(V, -N, TransmissionParams.OneOverIOR)
 * PhaseFunction      = ApproximateHG(dot(-L, RefracV), ScatteringDistribution)
 * Transmission       = FalloffColor * Profile * (Falloff * PhaseFunction)
 * ```
 *
 * Three things this deliberately does *not* do, each matching UE5:
 *
 * - **No `NoL`.** The light enters from behind; the surface facing the camera is
 *   turned away from it, so a front-facing cosine would zero out exactly the
 *   pixels this term exists for. UE5 notes the omission in a TODO and keeps it.
 * - **No surface shadow.** The caller attenuates by the *transmission* shadow
 *   instead, which is the encoded optical depth itself — see the caller.
 * - **No surface albedo.** The baked profile carries only the falloff shape,
 *   because UE5 passes white for `A` when baking it; the base colour is applied
 *   where this joins the diffuse.
 *
 * `refract` is called with the view vector as the *incident* ray and a flipped
 * normal, which is an odd way to phrase it — the incident ray conventionally
 * points at the surface, and `V` points away from it. It is transcribed as
 * written: the intent is a ray bent by the surface, and reversing it here would
 * change which way the forward-scattering lobe leans.
 *
 * @param scope - Shader scope.
 * @param profileTex - The packed profile table.
 * @param profileTexelSize - `vec2(1 / columns, 1 / rows)` of that table.
 * @param profileId - Normalized profile id.
 * @param thickness - Encoded optical depth from the thickness pass, where 1
 *   means "nothing in the way".
 * @param normal - Shading normal.
 * @param viewVec - Unit vector from the surface towards the eye.
 * @param lightDir - Unit vector from the surface towards the light.
 * @returns vec3 transmitted radiance; the caller applies light colour,
 *   attenuation and the transmission shadow.
 *
 * @internal
 */
export function skinTransmission(
  scope: PBInsideFunctionScope,
  profileTex: PBShaderExp,
  profileTexelSize: PBShaderExp,
  profileId: PBShaderExp,
  thickness: PBShaderExp,
  normal: PBShaderExp,
  viewVec: PBShaderExp,
  lightDir: PBShaderExp
): PBShaderExp {
  const pb = scope.$builder;
  const lutOffset = SkinProfile.transmissionLutOffset;
  const lutSize = SkinProfile.transmissionLutSize;
  const lastLutColumn = lutOffset + lutSize - 1;
  // The table reads stay in the caller's scope; see readSkinProfileColumn for
  // why they cannot move behind a function boundary. The locals are prefixed so
  // that they do not collide with the caller's own.
  //
  // Rows are addressed by the profile id directly, as UE5 does with SSProfiles.
  // The id arrives normalized because it rides in an 8-bit channel.
  scope.$l.zSkinTrRow = pb.mul(pb.add(pb.mul(pb.clamp(profileId, 0, 1), 255), 0.5), profileTexelSize.y);
  // GetTransmissionProfile. The index is `opticalDepth / MAX * (size - 1)` and
  // the decode is `opticalDepth = (1 - thickness) * MAX`, so the MAX cancels and
  // the encoded thickness maps onto the table directly.
  scope.$l.zSkinTrIndex = pb.mul(pb.clamp(pb.sub(1, thickness), 0, 1), lutSize - 1);
  scope.$l.zSkinTrI0 = pb.floor(scope.zSkinTrIndex);
  scope.$l.zSkinTrC0 = pb.add(scope.zSkinTrI0, lutOffset);
  scope.$l.zSkinTrC1 = pb.min(pb.add(scope.zSkinTrC0, 1), lastLutColumn);
  scope.$l.zSkinTrProfile = pb.mix(
    readSkinProfileColumn(scope, profileTex, profileTexelSize, scope.zSkinTrRow, scope.zSkinTrC0).rgb,
    readSkinProfileColumn(scope, profileTex, profileTexelSize, scope.zSkinTrRow, scope.zSkinTrC1).rgb,
    pb.sub(scope.zSkinTrIndex, scope.zSkinTrI0)
  );
  // (extinctionScale, normalScale, scatteringDistribution, 1 / ior)
  scope.$l.zSkinTrParams = readSkinProfileColumn(
    scope,
    profileTex,
    profileTexelSize,
    scope.zSkinTrRow,
    pb.float(SkinProfile.transmissionParamColumn)
  );
  return skinTransmissionPhase(
    scope,
    scope.zSkinTrProfile,
    scope.zSkinTrParams,
    thickness,
    normal,
    viewVec,
    lightDir
  );
}

/**
 * The part of the transmission BxDF that touches no textures.
 *
 * @remarks
 * Split out so the math can live behind a shader function while the table reads
 * stay inline at the call site, where the sampler is in scope.
 *
 * @param scope - Shader scope.
 * @param profile - The interpolated transmission profile, `rgb`.
 * @param params - `(extinctionScale, normalScale, scatteringDistribution, 1 / ior)`.
 * @param thickness - The raw encoding, still needed to spot the "no data" sentinel.
 * @param normal - Shading normal.
 * @param viewVec - Unit vector from the surface towards the eye.
 * @param lightDir - Unit vector from the surface towards the light.
 * @returns vec3 transmitted radiance.
 *
 * @internal
 */
function skinTransmissionPhase(
  scope: PBInsideFunctionScope,
  profile: PBShaderExp,
  params: PBShaderExp,
  thickness: PBShaderExp,
  normal: PBShaderExp,
  viewVec: PBShaderExp,
  lightDir: PBShaderExp
): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'lib_skinTransmissionPhase';
  pb.func(
    funcName,
    [
      pb.vec3('profile'),
      pb.vec4('params'),
      pb.float('thickness'),
      pb.vec3('normal'),
      pb.vec3('viewVec'),
      pb.vec3('lightDir')
    ],
    function () {
      // "No data" comes through as an encoding the pass cannot produce, and it
      // has to be rejected rather than decoded: it decodes to zero optical
      // depth, which is the *most* transmissive entry of the profile. Lights
      // that do not transmit, channels no light occupies and the dummy texture
      // all arrive here, and letting any of them through lights the subject up
      // from behind with a light that was never behind it.
      //
      // The threshold sits midway between the largest encoding the pass can
      // write and the sentinel, a gap no real measurement lands in, so this is a
      // clean partition and not a cutoff that clips thin geometry.
      this.$if(pb.greaterThan(this.thickness, 0.5 * (1 + SKIN_TRANSMISSION_NO_DATA_ENCODING)), function () {
        this.$return(pb.vec3(0));
      });
      this.$l.refracV = pb.refract(this.viewVec, pb.neg(this.normal), this.params.w);
      this.$l.cosJ = pb.dot(pb.neg(this.lightDir), this.refracV);
      // ApproximateHG. Note this is UE5's approximation, not the Henyey-
      // Greenstein phase function itself: the real one raises the denominator to
      // the 3/2, and the normalisation is `1 / 4pi` rather than the `0.5` used
      // here. Transcribed as UE5 has it, since matching its look is the point.
      this.$l.g = this.params.z;
      this.$l.g2 = pb.mul(this.g, this.g);
      this.$l.gcos = pb.sub(1, pb.mul(this.g, this.cosJ));
      this.$l.gcos2 = pb.mul(this.gcos, this.gcos);
      this.$l.phase = pb.div(pb.mul(0.5, pb.sub(1, this.g2)), pb.max(this.gcos2, 1e-5));
      this.$return(pb.mul(this.profile, this.phase));
    }
  );
  return pb.getGlobalScope()[funcName](profile, params, thickness, normal, viewVec, lightDir) as PBShaderExp;
}
