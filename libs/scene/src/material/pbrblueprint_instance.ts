import { DRef, Vector4, type Nullable } from '@zephyr3d/base';
import { getEngine } from '../app/api';
import type { BluePrintUniformTexture, BluePrintUniformValue } from '../utility/blueprint/material/ir';
import { PBRBluePrintMaterial } from './pbrblueprint';
import type { PBRReflectionMode } from './mixins/lightmodel/pbrmetallicroughness';
import { SubsurfaceProfile, type SubsurfaceProfilePreset } from './subsurfaceprofile';

function cloneUniformFinalValue(value: BluePrintUniformValue) {
  if (typeof value.finalValue === 'number') {
    return value.finalValue;
  }
  if (value.finalValue instanceof Float32Array) {
    return new Float32Array(value.finalValue);
  }
  return value.value.length === 1 ? value.value[0] : new Float32Array(value.value);
}

function cloneTextureParams(params: BluePrintUniformTexture['params']) {
  return params instanceof Vector4
    ? params.clone()
    : params &&
        typeof params === 'object' &&
        'x' in params &&
        'y' in params &&
        'z' in params &&
        'w' in params
      ? new Vector4(
          Number((params as { x: number }).x) || 0,
          Number((params as { y: number }).y) || 0,
          Number((params as { z: number }).z) || 0,
          Number((params as { w: number }).w) || 0
        )
      : Vector4.zero();
}

function cloneUniformValues(values: Nullable<BluePrintUniformValue[]>) {
  return (values ?? []).map((v) => ({
    ...v,
    value: [...v.value],
    finalValue: cloneUniformFinalValue(v)
  }));
}

function cloneUniformTextures(values: Nullable<BluePrintUniformTexture[]>) {
  return (values ?? []).map((v) => ({
    ...v,
    exposed: v.exposed ?? true,
    params: cloneTextureParams(v.params),
    finalTexture: v.finalTexture ? new DRef(v.finalTexture.get()) : undefined,
    finalSampler: v.finalSampler
  }));
}

function mergeHydratedUniformTexture(
  base: BluePrintUniformTexture,
  runtime: Nullable<BluePrintUniformTexture>
) {
  if (!runtime) {
    return base;
  }
  return {
    ...base,
    finalTexture: runtime.finalTexture ?? base.finalTexture,
    finalSampler: runtime.finalSampler ?? base.finalSampler,
    params: runtime.params ?? base.params
  };
}

function uniformValueEquals(a: BluePrintUniformValue, b: BluePrintUniformValue) {
  if (a.type !== b.type || a.value.length !== b.value.length) {
    return false;
  }
  for (let i = 0; i < a.value.length; i++) {
    if (a.value[i] !== b.value[i]) {
      return false;
    }
  }
  return true;
}

function uniformTextureEquals(a: BluePrintUniformTexture, b: BluePrintUniformTexture) {
  return (
    a.type === b.type &&
    a.texture === b.texture &&
    (a.exposed ?? true) === (b.exposed ?? true) &&
    a.sRGB === b.sRGB &&
    a.wrapS === b.wrapS &&
    a.wrapT === b.wrapT &&
    a.minFilter === b.minFilter &&
    a.magFilter === b.magFilter &&
    a.mipFilter === b.mipFilter
  );
}

function valuesEqual(a: unknown, b: unknown) {
  if (a === b) {
    return true;
  }
  if (
    a &&
    b &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    'equalsTo' in (a as Record<string, unknown>) &&
    typeof (a as { equalsTo?: unknown }).equalsTo === 'function'
  ) {
    return !!(a as { equalsTo: (other: unknown) => boolean }).equalsTo(b);
  }
  return false;
}

/** Parameter overrides that cannot be migrated to a new blueprint material parent. */
export interface PBRBluePrintMaterialInstanceDiscardedOverrides {
  uniformValues: string[];
  uniformTextures: string[];
}

function copyParentMaterialState(
  instance: PBRBluePrintMaterialInstance,
  parentMaterial: PBRBluePrintMaterial
) {
  instance.alphaCutoff = parentMaterial.alphaCutoff;
  instance.alphaDither = parentMaterial.alphaDither;
  instance.alphaToCoverage = parentMaterial.alphaToCoverage;
  instance.blendMode = parentMaterial.blendMode;
  instance.transparentShadowCaster = parentMaterial.transparentShadowCaster;
  instance.shadowAlphaCutoff = parentMaterial.shadowAlphaCutoff;
  instance.cullMode = parentMaterial.cullMode;
  instance.opacity = parentMaterial.opacity;
  instance.objectColor = parentMaterial.objectColor;
  instance.TAAStrength = parentMaterial.TAAStrength;
  if (!instance.isMaterialPropertyOverridden('RectSpecularScale')) {
    instance.rectSpecularScale = parentMaterial.rectSpecularScale;
  }
  instance.clearcoat = parentMaterial.clearcoat;
  instance.clearcoatIntensity = parentMaterial.clearcoatIntensity;
  instance.clearcoatRoughnessFactor = parentMaterial.clearcoatRoughnessFactor;
  instance.clearcoatIntensityTexture = parentMaterial.clearcoatIntensityTexture;
  instance.clearcoatIntensityTextureSampler = parentMaterial.clearcoatIntensityTextureSampler;
  instance.clearcoatIntensityTexCoordMatrix = parentMaterial.clearcoatIntensityTexCoordMatrix;
  instance.clearcoatIntensityTexCoordIndex = parentMaterial.clearcoatIntensityTexCoordIndex;
  instance.clearcoatRoughnessTexture = parentMaterial.clearcoatRoughnessTexture;
  instance.clearcoatRoughnessTextureSampler = parentMaterial.clearcoatRoughnessTextureSampler;
  instance.clearcoatRoughnessTexCoordMatrix = parentMaterial.clearcoatRoughnessTexCoordMatrix;
  instance.clearcoatRoughnessTexCoordIndex = parentMaterial.clearcoatRoughnessTexCoordIndex;
  instance.clearcoatNormalTexture = parentMaterial.clearcoatNormalTexture;
  instance.clearcoatNormalTextureSampler = parentMaterial.clearcoatNormalTextureSampler;
  instance.clearcoatNormalTexCoordMatrix = parentMaterial.clearcoatNormalTexCoordMatrix;
  instance.clearcoatNormalTexCoordIndex = parentMaterial.clearcoatNormalTexCoordIndex;
  instance.syncInheritedSubsurfaceProfile(parentMaterial.subsurfaceProfile);
  if (!instance.hasReflectionModeOverride()) {
    instance.setBlueprintInstanceReflectionMode(parentMaterial.reflectionMode, true);
  }
}

/**
 * Blueprint material instance asset.
 *
 * Inherits graph/IR from a parent blueprint material and only stores parameter overrides.
 * Instances are asset-level indirections, distinct from MeshMaterial runtime instancing.
 *
 * @public
 */
export class PBRBluePrintMaterialInstance extends PBRBluePrintMaterial {
  private _parentMaterialId: string;
  private _parentMaterial: Nullable<PBRBluePrintMaterial>;
  private _overrideUniformValues: Map<string, BluePrintUniformValue>;
  private _overrideUniformTextures: Map<string, BluePrintUniformTexture>;
  private _reflectionModeOverridden: boolean;
  private _overrideMaterialProps: Set<string>;
  private _subsurfaceProfileOverride: SubsurfaceProfile | null;

  constructor(parentMaterial?: Nullable<PBRBluePrintMaterial>, parentMaterialId = '') {
    super();
    this._parentMaterialId = parentMaterialId;
    this._parentMaterial = null;
    this._overrideUniformValues = new Map();
    this._overrideUniformTextures = new Map();
    this._reflectionModeOverridden = false;
    this._overrideMaterialProps = new Set();
    this._subsurfaceProfileOverride = null;
    if (parentMaterial) {
      this.setParentMaterial(parentMaterial, parentMaterialId);
    }
  }

  get parentMaterialId() {
    return this._parentMaterialId;
  }

  get parentMaterial() {
    return this._parentMaterial;
  }

  get isBlueprintMaterialInstance() {
    return true;
  }

  get hasSubsurfaceProfileOverride() {
    return !!this._subsurfaceProfileOverride;
  }

  setMaterialPropertyOverrides(propNames: Iterable<string>) {
    this._overrideMaterialProps = new Set(propNames);
  }

  getMaterialPropertyOverrides() {
    return [...this._overrideMaterialProps];
  }

  markMaterialPropertyOverridden(propName: string) {
    this._overrideMaterialProps.add(propName);
  }

  isMaterialPropertyOverridden(propName: string) {
    return this._overrideMaterialProps.has(propName);
  }

  set uniformValues(val: BluePrintUniformValue[]) {
    super.uniformValues = val;
  }

  get uniformValues() {
    return super.uniformValues;
  }

  set uniformTextures(val: BluePrintUniformTexture[]) {
    super.uniformTextures = val;
  }

  get uniformTextures() {
    return super.uniformTextures;
  }

  setOverrides(
    uniformValues: Nullable<BluePrintUniformValue[]>,
    uniformTextures: Nullable<BluePrintUniformTexture[]>
  ) {
    const parentValueMap = new Map((this._parentMaterial?.uniformValues ?? []).map((v) => [v.name, v]));
    const parentTextureMap = new Map((this._parentMaterial?.uniformTextures ?? []).map((v) => [v.name, v]));
    this._overrideUniformValues = new Map(
      cloneUniformValues(uniformValues)
        .filter((v) => {
          const parent = parentValueMap.get(v.name);
          return !parent || !uniformValueEquals(v, parent);
        })
        .map((v) => [v.name, v])
    );
    this._overrideUniformTextures = new Map(
      cloneUniformTextures(uniformTextures)
        .filter((v) => {
          const parent = parentTextureMap.get(v.name);
          return !parent || !uniformTextureEquals(v, parent);
        })
        .map((v) => [v.name, v])
    );
    this.syncInheritedUniforms();
  }

  getOverrideUniformValues() {
    return [...this._overrideUniformValues.values()].map((v) => ({
      name: v.name,
      type: v.type,
      value: [...v.value],
      finalValue: undefined
    }));
  }

  getOverrideUniformTextures() {
    return [...this._overrideUniformTextures.values()].map((v) => ({
      ...v,
      params: cloneTextureParams(v.params),
      finalTexture: undefined,
      finalSampler: undefined
    }));
  }

  getDiscardedOverridesForParent(
    parentMaterial: PBRBluePrintMaterial
  ): PBRBluePrintMaterialInstanceDiscardedOverrides {
    const parentValueMap = new Map(parentMaterial.uniformValues.map((v) => [v.name, v]));
    const parentTextureMap = new Map(parentMaterial.uniformTextures.map((v) => [v.name, v]));
    return {
      uniformValues: [...this._overrideUniformValues.values()]
        .filter((v) => {
          const parent = parentValueMap.get(v.name);
          return !parent || parent.type !== v.type || parent.value.length !== v.value.length;
        })
        .map((v) => v.name),
      uniformTextures: [...this._overrideUniformTextures.values()]
        .filter((v) => {
          const parent = parentTextureMap.get(v.name);
          return !parent || parent.type !== v.type || parent.exposed === false;
        })
        .map((v) => v.name)
    };
  }

  changeParentMaterial(
    parentMaterial: PBRBluePrintMaterial,
    parentMaterialId?: string
  ): PBRBluePrintMaterialInstanceDiscardedOverrides {
    const discarded = this.getDiscardedOverridesForParent(parentMaterial);
    const discardedValues = new Set(discarded.uniformValues);
    const discardedTextures = new Set(discarded.uniformTextures);
    const parentTextureMap = new Map(parentMaterial.uniformTextures.map((v) => [v.name, v]));

    this._overrideUniformValues = new Map(
      [...this._overrideUniformValues.entries()].filter(([name]) => !discardedValues.has(name))
    );
    this._overrideUniformTextures = new Map(
      [...this._overrideUniformTextures.entries()]
        .filter(([name]) => !discardedTextures.has(name))
        .map(([name, override]) => {
          const parent = parentTextureMap.get(name)!;
          return [
            name,
            {
              ...override,
              exposed: parent.exposed,
              inVertexShader: parent.inVertexShader,
              inFragmentShader: parent.inFragmentShader
            }
          ];
        })
    );
    this.uniformTextures = this.uniformTextures.filter((v) => !discardedTextures.has(v.name));
    this.setParentMaterial(parentMaterial, parentMaterialId);
    return discarded;
  }

  hasReflectionModeOverride() {
    return this._reflectionModeOverridden;
  }

  setBlueprintInstanceReflectionMode(val: PBRReflectionMode, inherited = false) {
    this._reflectionModeOverridden =
      !inherited && !!this._parentMaterial && val !== this._parentMaterial.reflectionMode;
    super.reflectionMode = val;
  }

  private copySubsurfaceProfile(source: Nullable<SubsurfaceProfile>) {
    if (!source) {
      return null;
    }
    const profile = new SubsurfaceProfile();
    profile.copyFrom(source);
    return profile;
  }

  private ensureSubsurfaceProfileOverride() {
    if (this._subsurfaceProfileOverride) {
      return this._subsurfaceProfileOverride;
    }
    const source = this.subsurfaceProfile ?? this._parentMaterial?.subsurfaceProfile ?? null;
    const profile = this.copySubsurfaceProfile(source);
    this._subsurfaceProfileOverride = profile;
    super.subsurfaceProfile = profile;
    return profile;
  }

  private getInheritedSubsurfaceProfile() {
    return this._parentMaterial?.subsurfaceProfile ?? null;
  }

  syncInheritedSubsurfaceProfile(parentProfile: Nullable<SubsurfaceProfile>) {
    if (this._subsurfaceProfileOverride) {
      super.subsurfaceProfile = this._subsurfaceProfileOverride;
    } else {
      super.subsurfaceProfile = parentProfile ?? null;
    }
  }

  setBlueprintInstanceSubsurfacePreset(val: SubsurfaceProfilePreset) {
    this.setBlueprintInstanceSubsurfaceProfileValue('SubsurfaceLookPreset', 'preset', val);
  }

  setBlueprintInstanceSubsurfaceStrength(val: number) {
    this.setBlueprintInstanceSubsurfaceProfileValue('SubsurfaceScatterWeight', 'strength', val);
  }

  setBlueprintInstanceSubsurfaceScale(val: number) {
    this.setBlueprintInstanceSubsurfaceProfileValue('SubsurfaceScatterScale', 'scale', val);
  }

  setBlueprintInstanceSubsurfaceProfileValue<K extends keyof SubsurfaceProfile>(
    propName: string,
    key: K,
    value: SubsurfaceProfile[K]
  ) {
    const inherited = this.getInheritedSubsurfaceProfile();
    const inheritedValue = inherited ? inherited[key] : undefined;
    if (!this._subsurfaceProfileOverride && inherited && valuesEqual(inheritedValue, value)) {
      this._overrideMaterialProps.delete(propName);
      super.subsurfaceProfile = inherited;
      return;
    }
    const profile = this.ensureSubsurfaceProfileOverride();
    if (profile) {
      this._overrideMaterialProps.add(propName);
      (profile as unknown as Record<string, unknown>)[key as string] = value;
      super.subsurfaceProfile = profile;
    }
  }

  setParentMaterial(parentMaterial: Nullable<PBRBluePrintMaterial>, parentMaterialId?: string) {
    this._parentMaterial = parentMaterial;
    this._parentMaterialId =
      parentMaterialId ??
      (parentMaterial ? (getEngine().resourceManager.getAssetId(parentMaterial.coreMaterial) ?? '') : '');
    if (parentMaterial) {
      this.syncInheritedUniforms(parentMaterial);
      // Keep the asset id on the instance asset, not the parent.
      this.clearCache();
      this.optionChanged(true);
    }
  }

  syncInheritedUniforms(parentMaterial = this._parentMaterial) {
    if (!parentMaterial) {
      return;
    }
    const runtimeTextureMap = new Map((this.uniformTextures ?? []).map((v) => [v.name, v]));
    this.fragmentIR = parentMaterial.fragmentIR;
    this.vertexIR = parentMaterial.vertexIR;
    copyParentMaterialState(this, parentMaterial);
    if (!this.isMaterialPropertyOverridden('Transmission')) {
      this.transmission = parentMaterial.transmission;
    }
    if (!this.isMaterialPropertyOverridden('IOR')) {
      this.ior = parentMaterial.ior;
    }
    if (!this.isMaterialPropertyOverridden('TransmissionFactor')) {
      this.transmissionFactor = parentMaterial.transmissionFactor;
    }
    if (!this.isMaterialPropertyOverridden('ThicknessFactor')) {
      this.thicknessFactor = parentMaterial.thicknessFactor;
    }
    if (!this.isMaterialPropertyOverridden('AttenuationColor')) {
      this.attenuationColor = parentMaterial.attenuationColor;
    }
    if (!this.isMaterialPropertyOverridden('AttenuationDistance')) {
      this.attenuationDistance = parentMaterial.attenuationDistance;
    }
    if (!this.isMaterialPropertyOverridden('TransmissionTexture')) {
      this.transmissionTexture = parentMaterial.transmissionTexture;
    }
    if (
      !this.isMaterialPropertyOverridden('TransmissionTexCoordAddressU') &&
      !this.isMaterialPropertyOverridden('TransmissionTexCoordAddressV')
    ) {
      this.transmissionTextureSampler = parentMaterial.transmissionTextureSampler;
    }
    if (!this.isMaterialPropertyOverridden('TransmissionTexCoordScale')) {
      this.transmissionTexCoordMatrix = parentMaterial.transmissionTexCoordMatrix;
    }
    if (!this.isMaterialPropertyOverridden('TransmissionTexCoordIndex')) {
      this.transmissionTexCoordIndex = parentMaterial.transmissionTexCoordIndex;
    }
    if (!this.isMaterialPropertyOverridden('ThicknessTexture')) {
      this.thicknessTexture = parentMaterial.thicknessTexture;
    }
    if (
      !this.isMaterialPropertyOverridden('ThicknessTexCoordAddressU') &&
      !this.isMaterialPropertyOverridden('ThicknessTexCoordAddressV')
    ) {
      this.thicknessTextureSampler = parentMaterial.thicknessTextureSampler;
    }
    if (!this.isMaterialPropertyOverridden('ThicknessTexCoordScale')) {
      this.thicknessTexCoordMatrix = parentMaterial.thicknessTexCoordMatrix;
    }
    if (!this.isMaterialPropertyOverridden('ThicknessTexCoordIndex')) {
      this.thicknessTexCoordIndex = parentMaterial.thicknessTexCoordIndex;
    }
    if (!this.isMaterialPropertyOverridden('SubsurfaceTexture')) {
      this.subsurfaceTexture = parentMaterial.subsurfaceTexture;
    }
    if (
      !this.isMaterialPropertyOverridden('SubsurfaceTexCoordAddressU') &&
      !this.isMaterialPropertyOverridden('SubsurfaceTexCoordAddressV')
    ) {
      this.subsurfaceTextureSampler = parentMaterial.subsurfaceTextureSampler;
    }
    if (!this.isMaterialPropertyOverridden('SubsurfaceTexCoordScale')) {
      this.subsurfaceTexCoordMatrix = parentMaterial.subsurfaceTexCoordMatrix;
    }
    if (!this.isMaterialPropertyOverridden('SubsurfaceTexCoordIndex')) {
      this.subsurfaceTexCoordIndex = parentMaterial.subsurfaceTexCoordIndex;
    }
    this.uniformValues = cloneUniformValues(parentMaterial.uniformValues).map(
      (v) => {
        const override = this._overrideUniformValues.get(v.name);
        return override
          ? {
              ...v,
              value: [...override.value],
              finalValue: cloneUniformFinalValue(override)
            }
          : v;
      }
    );
    this.uniformTextures = cloneUniformTextures(parentMaterial.uniformTextures).map(
      (v) =>
        mergeHydratedUniformTexture(
          this._overrideUniformTextures.get(v.name) ?? v,
          this._overrideUniformTextures.get(v.name) ?? runtimeTextureMap.get(v.name) ?? null
        )
    );
  }

  protected override onDispose() {
    this._subsurfaceProfileOverride?.dispose();
    this._subsurfaceProfileOverride = null;
    super.onDispose();
  }
}
