import { DRef, Vector4, type Nullable } from '@zephyr3d/base';
import { getEngine } from '../app/api';
import type { BluePrintUniformTexture, BluePrintUniformValue } from '../utility/blueprint/material/ir';
import { PBRBluePrintMaterial } from './pbrblueprint';

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
    params: cloneTextureParams(v.params),
    finalTexture: v.finalTexture ? new DRef(v.finalTexture.get()) : undefined,
    finalSampler: v.finalSampler
  }));
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
    a.sRGB === b.sRGB &&
    a.wrapS === b.wrapS &&
    a.wrapT === b.wrapT &&
    a.minFilter === b.minFilter &&
    a.magFilter === b.magFilter &&
    a.mipFilter === b.mipFilter
  );
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

  constructor(parentMaterial?: Nullable<PBRBluePrintMaterial>, parentMaterialId = '') {
    super();
    this._parentMaterialId = parentMaterialId;
    this._parentMaterial = null;
    this._overrideUniformValues = new Map();
    this._overrideUniformTextures = new Map();
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
      ...v,
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
    this.fragmentIR = parentMaterial.fragmentIR;
    this.vertexIR = parentMaterial.vertexIR;
    copyParentMaterialState(this, parentMaterial);
    this.uniformValues = cloneUniformValues(parentMaterial.uniformValues).map(
      (v) => this._overrideUniformValues.get(v.name) ?? v
    );
    this.uniformTextures = cloneUniformTextures(parentMaterial.uniformTextures).map(
      (v) => this._overrideUniformTextures.get(v.name) ?? v
    );
  }
}
