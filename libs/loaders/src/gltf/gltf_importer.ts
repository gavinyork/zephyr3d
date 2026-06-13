import type * as draco3d from 'draco3d';
import type { DeepPartial, InterpolationMode, Nullable, TypedArray, VFS } from '@zephyr3d/base';
import {
  Vector3,
  Vector4,
  Matrix4x4,
  Quaternion,
  Interpolator,
  InterpolatorScalar,
  ASSERT
} from '@zephyr3d/base';
import { AssetHierarchyNode } from '@zephyr3d/scene';
import type {
  AssetJointDynamicsCollider,
  AssetJointDynamicsFlatPlane,
  AssetMeshData,
  AssetAnimationData,
  AssetSubMeshData,
  AssetMaterial,
  AssetUnlitMaterial,
  AssetPBRMaterialMR,
  AssetPBRMaterialSG,
  AssetMaterialCommon,
  AssetPBRMaterialCommon,
  AssetAnimationTrack,
  AssetMorphTargetBinding,
  AssetPrimitiveInfo,
  AssetTextureInfo,
  AssetSpringBoneCollider,
  AssetSpringBoneColliderGroup,
  AssetSpringBoneJoint,
  SharedModel,
  ControllerConfig
} from '@zephyr3d/scene';
import { AssetSkeleton, AssetScene } from '@zephyr3d/scene';
import type { HumanoidJointMapping } from '@zephyr3d/scene';
import { HumanoidBodyRig, HumanoidHandRig } from '@zephyr3d/scene';
import {
  BoundingBox,
  DracoMeshDecoder,
  getEngine,
  MORPH_TARGET_COLOR,
  MORPH_TARGET_NORMAL,
  MORPH_TARGET_POSITION,
  MORPH_TARGET_TANGENT,
  MORPH_TARGET_TEX0,
  MORPH_TARGET_TEX1,
  MORPH_TARGET_TEX2,
  MORPH_TARGET_TEX3
} from '@zephyr3d/scene';
import { ColliderForce, getDevice } from '@zephyr3d/scene';
import { ComponentType, GLTFAccessor } from './helpers';
import type { VertexAttribFormat } from '@zephyr3d/device';
import {
  type VertexSemantic,
  type TextureAddressMode,
  type TextureFilterMode,
  type AbstractDevice,
  getVertexFormatComponentCount,
  getVertexAttribName,
  getVertexAttributeIndex
} from '@zephyr3d/device';
import type {
  AnimationChannel,
  AnimationSampler,
  GlTf,
  Material,
  MeshPrimitive,
  TextureInfo
} from './gltf_types';
import { AbstractModelImporter } from '../importer';

type SpringBoneJointInfo = {
  node?: unknown;
  hitRadius?: number;
  stiffness?: number;
  gravityPower?: number;
  gravityDir?: unknown;
  dragForce?: number;
};

type VRMC0BlendShapeBindInfo = {
  mesh?: unknown;
  index?: unknown;
  weight?: unknown;
};

type VRMC0BlendShapeGroupInfo = {
  name?: unknown;
  presetName?: unknown;
  binds?: unknown;
};

type VRMC1MorphTargetBindInfo = {
  node?: unknown;
  index?: unknown;
  weight?: unknown;
};

type VRMC1ExpressionInfo = {
  isBinary?: unknown;
  morphTargetBinds?: unknown;
};

type VRMCMToonTextureInfo = TextureInfo & {
  scale?: number;
};

type VRMCMToonOutlineWidthMode = 'none' | 'worldCoordinates' | 'screenCoordinates';

type VRMCMToonMaterialInfo = {
  transparentWithZWrite?: boolean;
  renderQueueOffsetNumber?: number;
  shadeColorFactor?: number[];
  shadeMultiplyTexture?: TextureInfo;
  shadingShiftFactor?: number;
  shadingShiftTexture?: VRMCMToonTextureInfo;
  shadingToonyFactor?: number;
  giEqualizationFactor?: number;
  matcapFactor?: number[];
  matcapTexture?: TextureInfo;
  parametricRimColorFactor?: number[];
  parametricRimFresnelPowerFactor?: number;
  parametricRimLiftFactor?: number;
  rimMultiplyTexture?: TextureInfo;
  rimLightingMixFactor?: number;
  outlineWidthMode?: VRMCMToonOutlineWidthMode;
  outlineWidthFactor?: number;
  outlineWidthMultiplyTexture?: TextureInfo;
  outlineColorFactor?: number[];
  outlineLightingMixFactor?: number;
  uvAnimationMaskTexture?: TextureInfo;
  uvAnimationScrollXSpeedFactor?: number;
  uvAnimationScrollYSpeedFactor?: number;
  uvAnimationRotationSpeedFactor?: number;
};

type GLTFMToonAssetMaterial = AssetUnlitMaterial & {
  shadeColorFactor?: Vector3;
  shadeMultiplyMap?: AssetTextureInfo;
  shadingShiftFactor?: number;
  shadingShiftMap?: AssetTextureInfo;
  shadingShiftTextureScale?: number;
  shadingToonyFactor?: number;
  giEqualizationFactor?: number;
  matcapFactor?: Vector3;
  matcapMap?: AssetTextureInfo;
  parametricRimColorFactor?: Vector3;
  parametricRimFresnelPowerFactor?: number;
  parametricRimLiftFactor?: number;
  rimMultiplyMap?: AssetTextureInfo;
  rimLightingMixFactor?: number;
  outlineWidthMode?: VRMCMToonOutlineWidthMode;
  outlineWidthFactor?: number;
  outlineWidthMultiplyMap?: AssetTextureInfo;
  outlineColorFactor?: Vector3;
  outlineLightingMixFactor?: number;
  outlineUsesTangentNormals?: boolean;
  uvAnimationMaskMap?: AssetTextureInfo;
  uvAnimationScrollXSpeedFactor?: number;
  uvAnimationScrollYSpeedFactor?: number;
  uvAnimationRotationSpeedFactor?: number;
  transparentWithZWrite?: boolean;
  renderQueueOffsetNumber?: number;
};

type GLTFLoadedMeshPrimitive = {
  source: MeshPrimitive;
  primitive: AssetPrimitiveInfo;
  subMeshData: AssetSubMeshData;
  materialInfo: Nullable<Material>;
  outlineUsesTangentNormals: boolean;
};

type VRMAHumanoidBoneInfo = {
  node?: unknown;
};

type VRMAHumanoidInfo = {
  humanBones?: Record<string, VRMAHumanoidBoneInfo>;
};

type VRMCVRMAnimationInfo = {
  specVersion?: unknown;
  humanoid?: VRMAHumanoidInfo;
};

const VRM_SPRING_BONE_SUBSTEPS = 3;
const VRM_GRAVITY_ACCELERATION_SCALE = 3;
const VRM_BASE_GRAVITY_ACCELERATION = 9.8 * VRM_GRAVITY_ACCELERATION_SCALE;
const VRM_GRAVITY_POWER_TO_ACCELERATION = 9.8 * VRM_GRAVITY_ACCELERATION_SCALE;
const VRM_STIFFNESS_TO_FRAME_HARDNESS = 0.05;
const VRM_DRAGFORCE_SCALE = 0.5;

/** @internal */
export interface GLTFContent extends GlTf {
  _loadedBuffers: Nullable<ArrayBuffer[]>;
  _accessors: GLTFAccessor[];
  _nodes: AssetHierarchyNode[];
  _meshes: AssetMeshData[];
  _device: AbstractDevice;
  _dracoModule?: draco3d.DecoderModule;
}

/**
 * The GLTF/GLB model loader
 * @public
 */
export class GLTFImporter extends AbstractModelImporter {
  /** @internal */
  async initDraco3d(gltf: GLTFContent) {
    return new Promise<void>((resolve) => {
      const dracoDecoderModule = (window as any).DracoDecoderModule as draco3d.DracoDecoderModule;
      if (dracoDecoderModule) {
        dracoDecoderModule({
          onModuleLoaded: (module) => {
            gltf._dracoModule = module;
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }
  async import(data: Blob, model: SharedModel, basePath: string, vfs?: VFS) {
    const buffer = await data.arrayBuffer();
    if (this.isGLB(buffer)) {
      await this.loadBinary(buffer, model, basePath, vfs);
      return;
    }
    const gltf = (await new Response(data).json()) as GLTFContent;
    gltf._loadedBuffers = null;
    await this.loadJson(gltf, model, basePath, vfs);
  }
  /** @internal */
  async loadBinary(buffer: ArrayBuffer, model: SharedModel, basePath: string, vfs?: VFS) {
    const jsonChunkType = 0x4e4f534a;
    const binaryChunkType = 0x004e4942;
    let gltf: Nullable<GLTFContent> = null;
    const buffers: ArrayBuffer[] = [];
    const chunkInfos = this.getGLBChunkInfos(buffer);
    for (const info of chunkInfos) {
      if (info.type === jsonChunkType && !gltf) {
        const jsonSlice = new Uint8Array(buffer, 20, info.length);
        const stringBuffer = new TextDecoder('utf-8').decode(jsonSlice);
        gltf = JSON.parse(stringBuffer);
      } else if (info.type === binaryChunkType) {
        buffers.push(buffer.slice(info.start, info.start + info.length));
      }
    }
    ASSERT(!!gltf, 'Invalid GLTF format');
    gltf._loadedBuffers = buffers;
    await this.loadJson(gltf, model, basePath, vfs);
  }
  /** @internal */
  async loadJson(gltf: GLTFContent, model: SharedModel, basePath: string, vfs?: VFS) {
    vfs = vfs ?? getEngine().VFS;
    // check extensions
    if (
      !gltf._dracoModule &&
      gltf.extensionsRequired &&
      gltf.extensionsRequired.indexOf('KHR_draco_mesh_compression') >= 0
    ) {
      await this.initDraco3d(gltf);
      ASSERT(!!gltf._dracoModule, 'Draco3d is required for loading model');
    }
    gltf._accessors = [];
    gltf._nodes = [];
    gltf._meshes = [];
    // check asset property
    const asset = gltf.asset;
    if (asset) {
      const gltfVersion = asset.version;
      ASSERT(gltfVersion === '2.0', `Invalid GLTF version: ${gltfVersion}`);
    }
    gltf._baseURI = basePath;
    if (!gltf._loadedBuffers) {
      gltf._loadedBuffers = [];
      const buffers = gltf.buffers;
      if (buffers) {
        for (const buffer of buffers) {
          const uri =
            vfs.parseDataURI(buffer.uri!) || vfs.isAbsoluteURL(buffer.uri!)
              ? buffer.uri
              : vfs.normalizePath(vfs.join(gltf._baseURI, buffer.uri!));
          const buf = (await vfs.readFile(uri!, { encoding: 'binary' })) as ArrayBuffer;
          ASSERT(buffer.byteLength === buf.byteLength, 'Invalid GLTF: buffer byte length error.');
          gltf._loadedBuffers.push(buf);
        }
      }
    }
    const accessors = gltf.accessors;
    if (accessors) {
      for (const accessor of gltf.accessors!) {
        gltf._accessors.push(new GLTFAccessor(accessor));
      }
    }
    const scenes = gltf.scenes;
    ASSERT(!!scenes, 'No scenes found in model');
    const sharedModel = model;
    await this._loadMeshes(sharedModel, gltf, vfs);
    this._loadNodes(gltf, sharedModel);
    this._loadSkins(gltf, sharedModel);
    this._loadMorphTargetGroups(gltf, sharedModel);
    for (let i = 0; i < (gltf.nodes?.length ?? 0); i++) {
      if (typeof gltf.nodes![i].skin === 'number' && gltf.nodes![i].skin! >= 0) {
        gltf._nodes[i].skeleton = sharedModel.skeletons[gltf.nodes![i].skin!];
      }
    }
    this._loadSpringBones(gltf, sharedModel);
    this._loadAnimations(gltf, sharedModel);
    for (const scene of scenes) {
      const assetScene = new AssetScene(scene.name);
      for (const node of scene.nodes!) {
        assetScene.rootNodes.push(gltf._nodes[node]);
      }
      sharedModel.scenes.push(assetScene);
    }
    if (typeof gltf.scene === 'number') {
      sharedModel.activeScene = gltf.scene;
    }
  }
  /** @internal */
  private _loadSpringBones(gltf: GLTFContent, model: SharedModel) {
    this._loadVRMC0SpringBones(gltf, model);
    this._loadVRMC1SpringBones(gltf, model);
    this._buildJointDynamicsSpringBones(model);
  }

  /** @internal */
  private _loadMorphTargetGroups(gltf: GLTFContent, model: SharedModel) {
    model.clearMorphTargetGroups();
    const hasVRMC1 = !!gltf.extensions?.VRMC_vrm;
    const hasVRMC0 = !!gltf.extensions?.VRM;
    if (hasVRMC1) {
      this._loadVRMC1MorphTargetGroups(gltf, model);
    } else if (hasVRMC0) {
      this._loadVRMC0MorphTargetGroups(gltf, model);
    } else {
      model.buildMorphTargetGroupsByName();
    }
  }

  private _loadVRMC0MorphTargetGroups(gltf: GLTFContent, model: SharedModel) {
    const groups = gltf.extensions?.VRM?.blendShapeMaster?.blendShapeGroups;
    if (!Array.isArray(groups)) {
      return;
    }
    for (const value of groups) {
      if (!value || typeof value !== 'object') {
        continue;
      }
      const groupInfo = value as VRMC0BlendShapeGroupInfo;
      const name = this._getVRMC0BlendShapeGroupName(groupInfo);
      if (!name) {
        continue;
      }
      const bindings: AssetMorphTargetBinding[] = [];
      const binds = Array.isArray(groupInfo.binds) ? groupInfo.binds : [];
      for (const bindValue of binds) {
        if (!bindValue || typeof bindValue !== 'object') {
          continue;
        }
        const bindInfo = bindValue as VRMC0BlendShapeBindInfo;
        const meshIndex = typeof bindInfo.mesh === 'number' ? bindInfo.mesh : -1;
        const targetIndex = typeof bindInfo.index === 'number' ? bindInfo.index : -1;
        const mesh = meshIndex >= 0 ? gltf._meshes[meshIndex] : null;
        if (!mesh) {
          continue;
        }
        const targetName = this._getMorphTargetName(mesh, targetIndex);
        if (!targetName) {
          continue;
        }
        bindings.push({
          mesh,
          targetIndex,
          targetName,
          weight: typeof bindInfo.weight === 'number' ? bindInfo.weight / 100 : 1
        });
      }
      model.addMorphTargetGroup({ name, bindings });
    }
  }

  private _loadVRMC1MorphTargetGroups(gltf: GLTFContent, model: SharedModel) {
    const expressions = gltf.extensions?.VRMC_vrm?.expressions;
    if (!expressions) {
      return;
    }
    this._loadVRMC1ExpressionMap(gltf, model, expressions.preset);
    this._loadVRMC1ExpressionMap(gltf, model, expressions.custom);
  }

  private _loadVRMC1ExpressionMap(gltf: GLTFContent, model: SharedModel, expressionMap: unknown) {
    if (!expressionMap || typeof expressionMap !== 'object') {
      return;
    }
    for (const [name, expressionInfo] of Object.entries(expressionMap)) {
      if (!expressionInfo || typeof expressionInfo !== 'object') {
        continue;
      }
      const expression = expressionInfo as VRMC1ExpressionInfo;
      const bindings: AssetMorphTargetBinding[] = [];
      const morphTargetBinds = Array.isArray(expression.morphTargetBinds) ? expression.morphTargetBinds : [];
      for (const bindValue of morphTargetBinds) {
        if (!bindValue || typeof bindValue !== 'object') {
          continue;
        }
        const bindInfo = bindValue as VRMC1MorphTargetBindInfo;
        const nodeIndex = typeof bindInfo.node === 'number' ? bindInfo.node : -1;
        const targetIndex = typeof bindInfo.index === 'number' ? bindInfo.index : -1;
        const node = nodeIndex >= 0 ? gltf._nodes[nodeIndex] : null;
        const mesh = node?.mesh ?? null;
        if (!node || !mesh) {
          continue;
        }
        const targetName = this._getMorphTargetName(mesh, targetIndex);
        if (!targetName) {
          continue;
        }
        bindings.push({
          node,
          targetIndex,
          targetName,
          weight: typeof bindInfo.weight === 'number' ? bindInfo.weight : 1
        });
      }
      model.addMorphTargetGroup({
        name,
        bindings,
        isBinary: expression.isBinary === true
      });
    }
  }

  private _getVRMC0BlendShapeGroupName(groupInfo: VRMC0BlendShapeGroupInfo): Nullable<string> {
    const presetName = typeof groupInfo.presetName === 'string' ? groupInfo.presetName : '';
    if (presetName && presetName.toLowerCase() !== 'unknown') {
      return presetName;
    }
    const name = typeof groupInfo.name === 'string' ? groupInfo.name : '';
    return name || presetName || null;
  }

  private _getMorphTargetName(mesh: AssetMeshData, targetIndex: number): Nullable<string> {
    if (targetIndex < 0) {
      return null;
    }
    let count = 0;
    for (const subMesh of mesh.subMeshes) {
      count = Math.max(count, subMesh.numTargets);
    }
    return targetIndex < count ? (mesh.morphNames?.[targetIndex] ?? `Target${targetIndex}`) : null;
  }

  private _loadVRMC1SpringBones(gltf: GLTFContent, model: SharedModel) {
    const ext = gltf.extensions?.VRMC_springBone;
    if (!ext) {
      return;
    }

    const colliders: Nullable<AssetSpringBoneCollider>[] = [];
    for (let i = 0; i < (ext.colliders ?? []).length; i++) {
      const colliderInfo = ext.colliders[i];
      const node = this._getNode(gltf, colliderInfo.node);
      const extendedShape = colliderInfo.extensions?.VRMC_springBone_extended_collider?.shape;
      if (!node || (!colliderInfo.shape && !extendedShape)) {
        colliders[i] = null;
        continue;
      }
      const sphere = colliderInfo.shape?.sphere;
      const capsule = colliderInfo.shape?.capsule;
      const extendedSphere = extendedShape?.sphere;
      const extendedCapsule = extendedShape?.capsule;
      const extendedPlane = extendedShape?.plane;
      let collider: Nullable<AssetSpringBoneCollider> = null;
      if (sphere) {
        collider = {
          name: colliderInfo.name,
          node,
          shape: {
            type: 'sphere',
            offset: this._arrayToVector3(sphere.offset, Vector3.zero()),
            radius: sphere.radius ?? 0,
            inside: sphere.inside
          }
        };
      } else if (extendedSphere) {
        collider = {
          name: colliderInfo.name,
          node,
          shape: {
            type: 'sphere',
            offset: this._arrayToVector3(extendedSphere.offset, Vector3.zero()),
            radius: extendedSphere.radius ?? 0,
            inside: extendedSphere.inside
          }
        };
      } else if (capsule) {
        collider = {
          name: colliderInfo.name,
          node,
          shape: {
            type: 'capsule',
            offset: this._arrayToVector3(capsule.offset, Vector3.zero()),
            tail: this._arrayToVector3(capsule.tail, Vector3.zero()),
            radius: capsule.radius ?? 0,
            inside: capsule.inside
          }
        };
      } else if (extendedCapsule) {
        collider = {
          name: colliderInfo.name,
          node,
          shape: {
            type: 'capsule',
            offset: this._arrayToVector3(extendedCapsule.offset, Vector3.zero()),
            tail: this._arrayToVector3(extendedCapsule.tail, Vector3.zero()),
            radius: extendedCapsule.radius ?? 0,
            inside: extendedCapsule.inside
          }
        };
      } else if (extendedPlane) {
        collider = {
          name: colliderInfo.name,
          node,
          shape: {
            type: 'plane',
            offset: this._arrayToVector3(extendedPlane.offset, Vector3.zero()),
            normal: this._arrayToVector3(extendedPlane.normal, Vector3.axisPY())
          }
        };
      }
      if (collider) {
        colliders[i] = collider;
        model.springBoneColliders.push(collider);
      } else {
        colliders[i] = null;
      }
    }

    const colliderGroups: AssetSpringBoneColliderGroup[] = [];
    for (const groupInfo of ext.colliderGroups ?? []) {
      const group: AssetSpringBoneColliderGroup = {
        name: groupInfo.name,
        colliders: (groupInfo.colliders ?? [])
          .map((ref: unknown) => colliders[this._getIndex(ref, ['collider', 'index'])])
          .filter((collider: Nullable<AssetSpringBoneCollider>): collider is AssetSpringBoneCollider => {
            return !!collider;
          })
      };
      colliderGroups.push(group);
      model.springBoneColliderGroups.push(group);
    }

    for (const springInfo of ext.springs ?? []) {
      const joints: AssetSpringBoneJoint[] = [];
      for (const jointRef of springInfo.joints ?? []) {
        const jointInfo = this._getSpringBoneJointInfo(ext, jointRef);
        if (!jointInfo) {
          continue;
        }
        const node = this._getNode(gltf, jointInfo?.node);
        if (!node) {
          continue;
        }
        joints.push({
          node,
          hitRadius: jointInfo.hitRadius ?? 0,
          stiffness: jointInfo.stiffness ?? 0,
          gravityPower: jointInfo.gravityPower ?? 0,
          gravityDir: this._arrayToVector3(jointInfo.gravityDir, new Vector3(0, -1, 0)),
          dragForce: jointInfo.dragForce ?? 0
        });
      }
      model.springBones.push({
        name: springInfo.name,
        center: this._getNode(gltf, springInfo.center)!,
        joints,
        colliderGroups: (springInfo.colliderGroups ?? [])
          .map((ref: unknown) => colliderGroups[this._getIndex(ref, ['colliderGroup', 'index'])])
          .filter((group: Nullable<AssetSpringBoneColliderGroup>): group is AssetSpringBoneColliderGroup => {
            return !!group;
          })
      });
    }
  }

  private _loadVRMC0SpringBones(gltf: GLTFContent, model: SharedModel) {
    const secondaryAnimation = gltf.extensions?.VRM?.secondaryAnimation;
    if (!secondaryAnimation) {
      return;
    }

    const colliderGroups: Nullable<AssetSpringBoneColliderGroup>[] = [];
    for (let i = 0; i < (secondaryAnimation.colliderGroups ?? []).length; i++) {
      const groupInfo = secondaryAnimation.colliderGroups[i];
      const node = this._getNode(gltf, groupInfo.node);
      if (!node) {
        colliderGroups[i] = null;
        continue;
      }
      const group: AssetSpringBoneColliderGroup = {
        colliders: []
      };
      for (const colliderInfo of groupInfo.colliders ?? []) {
        const collider: AssetSpringBoneCollider = {
          node,
          shape: {
            type: 'sphere',
            offset: this._arrayToVector3(colliderInfo.offset, Vector3.zero()),
            radius: colliderInfo.radius ?? 0
          }
        };
        group.colliders.push(collider);
        model.springBoneColliders.push(collider);
      }
      colliderGroups[i] = group;
      model.springBoneColliderGroups.push(group);
    }

    for (const boneGroupInfo of secondaryAnimation.boneGroups ?? []) {
      const rootBones = (boneGroupInfo.bones ?? [])
        .map((index: number) => this._getNode(gltf, index))
        .filter((node: AssetHierarchyNode) => !!node);
      const joints: AssetSpringBoneJoint[] = rootBones.map((node: AssetHierarchyNode) => ({
        node,
        hitRadius: boneGroupInfo.hitRadius ?? 0,
        stiffness: boneGroupInfo.stiffiness ?? boneGroupInfo.stiffness ?? 0,
        gravityPower: boneGroupInfo.gravityPower ?? 0,
        gravityDir: this._arrayToVector3(boneGroupInfo.gravityDir, new Vector3(0, -1, 0)),
        dragForce: boneGroupInfo.dragForce ?? 0
      }));
      model.springBones.push({
        name: boneGroupInfo.comment,
        center: this._getNode(gltf, boneGroupInfo.center)!,
        joints,
        rootBones,
        colliderGroups: (boneGroupInfo.colliderGroups ?? [])
          .map((ref: unknown) => colliderGroups[this._getIndex(ref, ['colliderGroup', 'index'])])
          .filter((group: Nullable<AssetSpringBoneColliderGroup>): group is AssetSpringBoneColliderGroup => {
            return !!group;
          })
      });
    }
  }

  private _getNode(gltf: GLTFContent, index: unknown): Nullable<AssetHierarchyNode> {
    return typeof index === 'number' && index >= 0 ? gltf._nodes[index] : null;
  }

  private _arrayToVector3(value: unknown, fallback: Vector3): Vector3 {
    if (Array.isArray(value)) {
      return new Vector3(value[0] ?? fallback.x, value[1] ?? fallback.y, value[2] ?? fallback.z);
    }
    if (value && typeof value === 'object') {
      const obj = value as { x?: unknown; y?: unknown; z?: unknown };
      return new Vector3(
        typeof obj.x === 'number' ? obj.x : fallback.x,
        typeof obj.y === 'number' ? obj.y : fallback.y,
        typeof obj.z === 'number' ? obj.z : fallback.z
      );
    }
    return fallback.clone();
  }

  private _getIndex(value: unknown, keys: string[] = ['index']): number {
    if (typeof value === 'number' && value >= 0 && Number.isInteger(value)) {
      return value;
    }
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      for (const key of keys) {
        const index = obj[key];
        if (typeof index === 'number' && index >= 0 && Number.isInteger(index)) {
          return index;
        }
      }
    }
    return -1;
  }

  private _getSpringBoneJointInfo(
    ext: { joints?: SpringBoneJointInfo[] },
    jointRef: unknown
  ): Nullable<SpringBoneJointInfo> {
    const directIndex = this._getIndex(jointRef);
    if (directIndex >= 0) {
      return ext.joints?.[directIndex] ?? null;
    }
    if (jointRef && typeof jointRef === 'object') {
      const obj = jointRef as SpringBoneJointInfo;
      if (typeof obj.node === 'number') {
        return obj;
      }
      const jointIndex = this._getIndex(jointRef, ['joint', 'index']);
      if (jointIndex >= 0) {
        return ext.joints?.[jointIndex] ?? null;
      }
    }
    return null;
  }

  private _buildJointDynamicsSpringBones(model: SharedModel) {
    const colliderMap = new Map<AssetSpringBoneCollider, AssetJointDynamicsCollider>();
    const flatPlaneMap = new Map<AssetSpringBoneCollider, AssetJointDynamicsFlatPlane>();
    const nodeKeys = new Map<AssetHierarchyNode, number>();
    model.nodes.forEach((node, index) => nodeKeys.set(node, index));
    for (const collider of model.springBoneColliders) {
      const converted = this._toJointDynamicsCollider(collider);
      if (converted) {
        colliderMap.set(collider, converted);
        model.jointDynamicsColliders.push(converted);
        continue;
      }
      const flatPlane = this._toJointDynamicsFlatPlane(collider);
      if (flatPlane) {
        flatPlaneMap.set(collider, flatPlane);
      }
    }

    for (const spring of model.springBones) {
      const chains = spring.rootBones
        ? this._collectJointDynamicsChainsFromRoots(spring.rootBones)
        : this._collectJointDynamicsChains(spring.joints);
      if (chains.length === 0 || spring.joints.length === 0) {
        continue;
      }
      const colliders: AssetJointDynamicsCollider[] = [];
      const flatPlanes: AssetJointDynamicsFlatPlane[] = [];
      const colliderKeys = new Set<string>();
      const flatPlaneKeys = new Set<string>();
      for (const group of spring.colliderGroups) {
        for (const collider of group.colliders) {
          const converted = colliderMap.get(collider);
          const colliderKey = converted ? this._getJointDynamicsColliderKey(converted, nodeKeys) : '';
          if (converted && !colliderKeys.has(colliderKey)) {
            colliderKeys.add(colliderKey);
            colliders.push(converted);
          }
          const flatPlane = flatPlaneMap.get(collider);
          const flatPlaneKey = flatPlane ? this._getJointDynamicsFlatPlaneKey(flatPlane, nodeKeys) : '';
          if (flatPlane && !flatPlaneKeys.has(flatPlaneKey)) {
            flatPlaneKeys.add(flatPlaneKey);
            flatPlanes.push(flatPlane);
          }
        }
      }
      model.jointDynamicsSpringBones.push({
        name: spring.name,
        center: spring.center,
        chains,
        colliders,
        flatPlanes,
        controllerConfig: this._mapSpringJointsToControllerConfig(spring.joints, chains.length > 1)
      });
    }
  }

  private _collectJointDynamicsChains(joints: AssetSpringBoneJoint[]) {
    const chains: { start: AssetHierarchyNode; end: AssetHierarchyNode }[] = [];
    if (joints.length === 0) {
      return chains;
    }
    let chainStart = joints[0].node;
    let chainEnd = joints[0].node;
    for (let i = 1; i < joints.length; i++) {
      const node = joints[i].node;
      if (chainEnd.isParentOf(node)) {
        chainEnd = node;
        continue;
      }
      this._pushJointDynamicsChain(chains, chainStart, chainEnd);
      chainStart = node;
      chainEnd = node;
    }
    this._pushJointDynamicsChain(chains, chainStart, chainEnd);
    return chains;
  }

  private _collectJointDynamicsChainsFromRoots(rootBones: AssetHierarchyNode[]) {
    const chains: { start: AssetHierarchyNode; end: AssetHierarchyNode }[] = [];
    for (const start of rootBones) {
      const end = this._findSingleChildChainEnd(start);
      if (end && end !== start) {
        chains.push({ start, end });
      }
    }
    return chains;
  }

  private _pushJointDynamicsChain(
    chains: { start: AssetHierarchyNode; end: AssetHierarchyNode }[],
    start: AssetHierarchyNode,
    end: AssetHierarchyNode
  ) {
    if (start !== end) {
      chains.push({ start, end });
      return;
    }
    const inferredEnd = this._findSingleChildChainEnd(start);
    if (inferredEnd && inferredEnd !== start) {
      chains.push({ start, end: inferredEnd });
    }
  }

  private _findSingleChildChainEnd(start: AssetHierarchyNode): Nullable<AssetHierarchyNode> {
    let current = start;
    while (current.children.length > 0) {
      if (current.children.length !== 1) {
        return null;
      }
      current = current.children[0];
    }
    return current;
  }

  private _mapSpringJointsToControllerConfig(
    joints: AssetSpringBoneJoint[],
    loop: boolean
  ): DeepPartial<ControllerConfig> {
    let stiffness = 0;
    let dragForce = 0;
    let hitRadius = 0;
    const gravity = new Vector3(0, -VRM_BASE_GRAVITY_ACCELERATION, 0);
    const gravityPower = Vector3.zero();
    for (const joint of joints) {
      stiffness += joint.stiffness;
      dragForce += joint.dragForce;
      hitRadius = Math.max(hitRadius, joint.hitRadius);
      const gravityDir =
        joint.gravityDir.magnitudeSq > 0 ? Vector3.normalize(joint.gravityDir) : new Vector3(0, -1, 0);
      Vector3.add(
        gravityPower,
        Vector3.scale(gravityDir, Math.max(0, joint.gravityPower) * VRM_GRAVITY_POWER_TO_ACCELERATION),
        gravityPower
      );
    }
    const invCount = joints.length > 0 ? 1 / joints.length : 1;
    stiffness *= invCount;
    dragForce *= invCount;
    Vector3.scale(gravityPower, invCount, gravityPower);
    Vector3.add(gravity, gravityPower, gravity);
    const frameHardness = Math.max(0, Math.min(1, stiffness * VRM_STIFFNESS_TO_FRAME_HARDNESS));
    const frameResistance = Math.max(0, Math.min(1, 1 - dragForce * VRM_DRAGFORCE_SCALE));
    return {
      enableBroadPhase: false,
      enableSurfaceCollision: false,
      subSteps: VRM_SPRING_BONE_SUBSTEPS,
      gravity,
      curves: {
        hardness: InterpolatorScalar.constant(
          this._frameRatioToSubstepRatio(frameHardness, VRM_SPRING_BONE_SUBSTEPS)
        ),
        resistance: InterpolatorScalar.constant(
          this._frameRateToSubstepRate(frameResistance, VRM_SPRING_BONE_SUBSTEPS)
        ),
        pointRadius: InterpolatorScalar.constant(Math.max(0, hitRadius)),
        // ── KEY: stiff structural = inextensible fabric ──
        structuralShrinkVertical: InterpolatorScalar.constant(0.95),
        structuralStretchVertical: InterpolatorScalar.constant(0.95),
        structuralShrinkHorizontal: InterpolatorScalar.constant(0.7),
        structuralStretchHorizontal: InterpolatorScalar.constant(0.7),
        // Moderate shear keeps the grid from collapsing diagonally
        shearShrink: InterpolatorScalar.constant(0.025),
        shearStretch: InterpolatorScalar.constant(0.025),
        // ── KEY: very soft bending = cloth folds/drapes freely ──
        bendingShrinkVertical: InterpolatorScalar.constant(0),
        bendingStretchVertical: InterpolatorScalar.constant(0),
        bendingShrinkHorizontal: InterpolatorScalar.constant(0),
        bendingStretchHorizontal: InterpolatorScalar.constant(0)
      },
      constraintOptions: {
        structuralVertical: true,
        structuralHorizontal: true,
        shear: false,
        bendingVertical: true,
        collideStructuralVertical: true,
        collideStructuralHorizontal: true,
        collideShear: true,
        isLoop: loop
      }
    };
  }

  private _frameRatioToSubstepRatio(frameRatio: number, subSteps: number): number {
    const ratio = Math.max(0, Math.min(1, frameRatio));
    return 1 - Math.pow(1 - ratio, 1 / Math.max(1, subSteps));
  }

  private _frameRateToSubstepRate(frameRate: number, subSteps: number): number {
    const rate = Math.max(0, Math.min(1, frameRate));
    return Math.pow(rate, 1 / Math.max(1, subSteps));
  }

  private _getJointDynamicsColliderKey(
    collider: AssetJointDynamicsCollider,
    nodeKeys: Map<AssetHierarchyNode, number>
  ): string {
    const r = collider.collider;
    return [
      this._getAssetNodeKey(collider.node, nodeKeys),
      this._vector3Key(collider.localPosition),
      this._quaternionKey(collider.localRotation),
      this._numberKey(r.radius),
      this._numberKey(r.radiusTailScale),
      this._numberKey(r.height),
      this._numberKey(r.friction),
      r.isInverseCollider ? 1 : 0,
      r.forceType
    ].join('|');
  }

  private _getJointDynamicsFlatPlaneKey(
    flatPlane: AssetJointDynamicsFlatPlane,
    nodeKeys: Map<AssetHierarchyNode, number>
  ): string {
    return [
      this._getAssetNodeKey(flatPlane.node, nodeKeys),
      this._vector3Key(flatPlane.position),
      this._vector3Key(flatPlane.up)
    ].join('|');
  }

  private _getAssetNodeKey(node: AssetHierarchyNode, nodeKeys: Map<AssetHierarchyNode, number>): number {
    let key = nodeKeys.get(node);
    if (key === undefined) {
      key = nodeKeys.size;
      nodeKeys.set(node, key);
    }
    return key;
  }

  private _vector3Key(value: Vector3): string {
    return [value.x, value.y, value.z].map((component) => this._numberKey(component)).join(',');
  }

  private _quaternionKey(value: Quaternion): string {
    return [value.x, value.y, value.z, value.w].map((component) => this._numberKey(component)).join(',');
  }

  private _numberKey(value: number): string {
    return `${Object.is(value, -0) ? 0 : value}`;
  }

  private _toJointDynamicsCollider(collider: AssetSpringBoneCollider): Nullable<AssetJointDynamicsCollider> {
    const shape = collider.shape;
    if (shape.type === 'plane') {
      return null;
    }
    if (shape.type === 'sphere') {
      return {
        name: collider.name,
        node: collider.node,
        localPosition: shape.offset.clone(),
        localRotation: Quaternion.identity(),
        collider: {
          radius: shape.radius,
          radiusTailScale: 1,
          height: 0,
          friction: 0,
          isInverseCollider: shape.inside ?? false,
          forceType: ColliderForce.Off
        }
      };
    }
    const localDirection = Vector3.sub(shape.tail, shape.offset);
    const height = localDirection.magnitude;
    const localRotation =
      height > 0
        ? Quaternion.unitVectorToUnitVector(Vector3.axisPY(), localDirection)
        : Quaternion.identity();
    const localPosition = Vector3.scale(Vector3.add(shape.offset, shape.tail), 0.5);
    return {
      name: collider.name,
      node: collider.node,
      localPosition,
      localRotation,
      collider: {
        radius: shape.radius,
        radiusTailScale: 1,
        height,
        friction: 0,
        isInverseCollider: shape.inside ?? false,
        forceType: ColliderForce.Off
      }
    };
  }

  private _toJointDynamicsFlatPlane(
    collider: AssetSpringBoneCollider
  ): Nullable<AssetJointDynamicsFlatPlane> {
    const shape = collider.shape;
    if (shape.type !== 'plane') {
      return null;
    }
    return {
      node: collider.node,
      position: shape.offset.clone(),
      up: shape.normal.magnitudeSq > 0 ? Vector3.normalize(shape.normal) : Vector3.axisPY()
    };
  }

  /** @internal */
  private _loadNodes(gltf: GLTFContent, model: SharedModel) {
    if (gltf.nodes) {
      for (let i = 0; i < gltf.nodes.length; i++) {
        this._loadNode(gltf, i, null, model);
      }
      for (const node of gltf._nodes) {
        if (!node.parent) {
          node.computeTransforms(null);
        }
      }
    }
  }
  /** @internal */
  private _loadSkins(gltf: GLTFContent, model: SharedModel) {
    if (gltf.skins) {
      for (let i = 0; i < gltf.skins.length; i++) {
        const skinInfo = gltf.skins[i];
        const skeleton = new AssetSkeleton(skinInfo.name);
        if (typeof skinInfo.skeleton === 'number') {
          skeleton.pivot = gltf._nodes[skinInfo.skeleton];
        }
        const accessor = gltf._accessors[skinInfo.inverseBindMatrices!];
        if (!accessor || accessor.type !== 'MAT4' || accessor.componentType !== ComponentType.FLOAT) {
          throw new Error('Invalid GLTF inverse bind matricies accessor');
        }
        const matrices =
          typeof skinInfo.inverseBindMatrices === 'number'
            ? (accessor.getDeinterlacedView(gltf) as Float32Array)
            : null;
        skinInfo.joints.forEach((joint, index) => {
          const m = index * 16;
          skeleton.addJoint(
            gltf._nodes[joint],
            matrices ? new Matrix4x4(matrices.subarray(m, m + 16)) : Matrix4x4.identity()
          );
        });
        model.addSkeleton(skeleton);
      }
    }
    this._loadVRMAHumanoidSkeleton(gltf, model);
  }
  /** @internal */
  private _loadVRMAHumanoidSkeleton(gltf: GLTFContent, model: SharedModel) {
    const ext = gltf.extensions?.VRMC_vrm_animation as VRMCVRMAnimationInfo | undefined;
    const humanBones = ext?.humanoid?.humanBones;
    if (!humanBones || typeof humanBones !== 'object') {
      return;
    }
    const mapping = this._getVRMAHumanoidMapping(gltf, humanBones);
    const hips = mapping?.body[HumanoidBodyRig.Hips];
    if (!mapping || !hips) {
      return;
    }
    const humanBoneNodes = this._getVRMAHumanoidNodes(mapping);
    if (humanBoneNodes.length === 0) {
      return;
    }
    const existingSkeleton = model.skeletons.find((skeleton) =>
      humanBoneNodes.every((node) => skeleton.joints.indexOf(node) >= 0)
    );
    if (existingSkeleton) {
      this._setAssetSkeletonHumanoidMapping(existingSkeleton, mapping);
      return;
    }
    const root = this._findCommonRoot(humanBoneNodes) ?? hips;
    const jointSet = new Set<AssetHierarchyNode>();
    for (const node of humanBoneNodes) {
      let current: Nullable<AssetHierarchyNode> = node;
      while (current) {
        jointSet.add(current);
        if (current === root) {
          break;
        }
        current = current.parent;
      }
    }
    const skeleton = new AssetSkeleton('VRMC_vrm_animation_humanoid');
    skeleton.pivot = root;
    this._setAssetSkeletonHumanoidMapping(skeleton, mapping);
    for (const joint of this._sortSkeletonJoints(root, jointSet)) {
      skeleton.addJoint(joint, Matrix4x4.identity());
    }
    if (skeleton.joints.length > 0) {
      model.addSkeleton(skeleton);
    }
  }

  private _setAssetSkeletonHumanoidMapping(
    skeleton: AssetSkeleton,
    mapping: Nullable<HumanoidJointMapping<AssetHierarchyNode>>
  ) {
    (
      skeleton as AssetSkeleton & {
        humanoidJointMapping: Nullable<HumanoidJointMapping<AssetHierarchyNode>>;
      }
    ).humanoidJointMapping = mapping;
  }

  private _getVRMAHumanoidMapping(
    gltf: GLTFContent,
    humanBones: Record<string, VRMAHumanoidBoneInfo>
  ): Nullable<HumanoidJointMapping<AssetHierarchyNode>> {
    const body = {} as Partial<Record<HumanoidBodyRig, AssetHierarchyNode>>;
    const leftHand = {} as Partial<Record<HumanoidHandRig, AssetHierarchyNode>>;
    const rightHand = {} as Partial<Record<HumanoidHandRig, AssetHierarchyNode>>;
    const setBody = (vrmaName: string, rig: HumanoidBodyRig) => {
      const node = this._getVRMAHumanBoneNode(gltf, humanBones, vrmaName);
      if (node) {
        body[rig] = node;
      }
    };
    const setHand = (side: 'left' | 'right', vrmaName: string, rig: HumanoidHandRig) => {
      const node = this._getVRMAHumanBoneNode(gltf, humanBones, vrmaName);
      if (node) {
        (side === 'left' ? leftHand : rightHand)[rig] = node;
      }
    };
    setBody('hips', HumanoidBodyRig.Hips);
    setBody('spine', HumanoidBodyRig.Spine);
    setBody('chest', HumanoidBodyRig.Chest);
    setBody('upperChest', HumanoidBodyRig.UpperChest);
    setBody('neck', HumanoidBodyRig.Neck);
    setBody('head', HumanoidBodyRig.Head);
    setBody('leftShoulder', HumanoidBodyRig.LeftShoulder);
    setBody('leftUpperArm', HumanoidBodyRig.LeftUpperArm);
    setBody('leftLowerArm', HumanoidBodyRig.LeftLowerArm);
    setBody('leftHand', HumanoidBodyRig.LeftHand);
    setBody('rightShoulder', HumanoidBodyRig.RightShoulder);
    setBody('rightUpperArm', HumanoidBodyRig.RightUpperArm);
    setBody('rightLowerArm', HumanoidBodyRig.RightLowerArm);
    setBody('rightHand', HumanoidBodyRig.RightHand);
    setBody('leftUpperLeg', HumanoidBodyRig.LeftUpperLeg);
    setBody('leftLowerLeg', HumanoidBodyRig.LeftLowerLeg);
    setBody('leftFoot', HumanoidBodyRig.LeftFoot);
    setBody('leftToes', HumanoidBodyRig.LeftToes);
    setBody('rightUpperLeg', HumanoidBodyRig.RightUpperLeg);
    setBody('rightLowerLeg', HumanoidBodyRig.RightLowerLeg);
    setBody('rightFoot', HumanoidBodyRig.RightFoot);
    setBody('rightToes', HumanoidBodyRig.RightToes);
    setHand('left', 'leftThumbMetacarpal', HumanoidHandRig.ThumbProximal);
    setHand('left', 'leftThumbProximal', HumanoidHandRig.ThumbIntermediate);
    setHand('left', 'leftThumbDistal', HumanoidHandRig.ThumbDistal);
    setHand('left', 'leftIndexProximal', HumanoidHandRig.IndexProximal);
    setHand('left', 'leftIndexIntermediate', HumanoidHandRig.IndexIntermediate);
    setHand('left', 'leftIndexDistal', HumanoidHandRig.IndexDistal);
    setHand('left', 'leftMiddleProximal', HumanoidHandRig.MiddleProximal);
    setHand('left', 'leftMiddleIntermediate', HumanoidHandRig.MiddleIntermediate);
    setHand('left', 'leftMiddleDistal', HumanoidHandRig.MiddleDistal);
    setHand('left', 'leftRingProximal', HumanoidHandRig.RingProximal);
    setHand('left', 'leftRingIntermediate', HumanoidHandRig.RingIntermediate);
    setHand('left', 'leftRingDistal', HumanoidHandRig.RingDistal);
    setHand('left', 'leftLittleProximal', HumanoidHandRig.PinkyProximal);
    setHand('left', 'leftLittleIntermediate', HumanoidHandRig.PinkyIntermediate);
    setHand('left', 'leftLittleDistal', HumanoidHandRig.PinkyDistal);
    setHand('right', 'rightThumbMetacarpal', HumanoidHandRig.ThumbProximal);
    setHand('right', 'rightThumbProximal', HumanoidHandRig.ThumbIntermediate);
    setHand('right', 'rightThumbDistal', HumanoidHandRig.ThumbDistal);
    setHand('right', 'rightIndexProximal', HumanoidHandRig.IndexProximal);
    setHand('right', 'rightIndexIntermediate', HumanoidHandRig.IndexIntermediate);
    setHand('right', 'rightIndexDistal', HumanoidHandRig.IndexDistal);
    setHand('right', 'rightMiddleProximal', HumanoidHandRig.MiddleProximal);
    setHand('right', 'rightMiddleIntermediate', HumanoidHandRig.MiddleIntermediate);
    setHand('right', 'rightMiddleDistal', HumanoidHandRig.MiddleDistal);
    setHand('right', 'rightRingProximal', HumanoidHandRig.RingProximal);
    setHand('right', 'rightRingIntermediate', HumanoidHandRig.RingIntermediate);
    setHand('right', 'rightRingDistal', HumanoidHandRig.RingDistal);
    setHand('right', 'rightLittleProximal', HumanoidHandRig.PinkyProximal);
    setHand('right', 'rightLittleIntermediate', HumanoidHandRig.PinkyIntermediate);
    setHand('right', 'rightLittleDistal', HumanoidHandRig.PinkyDistal);
    if (!body[HumanoidBodyRig.Hips]) {
      return null;
    }
    const result: HumanoidJointMapping<AssetHierarchyNode> = {
      body: body as Record<HumanoidBodyRig, AssetHierarchyNode>
    };
    if (Object.keys(leftHand).length > 0) {
      result.leftHand = leftHand as Record<HumanoidHandRig, AssetHierarchyNode>;
    }
    if (Object.keys(rightHand).length > 0) {
      result.rightHand = rightHand as Record<HumanoidHandRig, AssetHierarchyNode>;
    }
    return result;
  }

  private _getVRMAHumanBoneNode(
    gltf: GLTFContent,
    humanBones: Record<string, VRMAHumanoidBoneInfo>,
    boneName: string
  ): Nullable<AssetHierarchyNode> {
    const nodeIndex = humanBones[boneName]?.node;
    return this._getNode(gltf, nodeIndex);
  }

  private _getVRMAHumanoidNodes(mapping: HumanoidJointMapping<AssetHierarchyNode>): AssetHierarchyNode[] {
    const nodes: AssetHierarchyNode[] = [];
    const addMappedNodes = <T extends string>(mapped: Record<T, AssetHierarchyNode> | undefined) => {
      if (!mapped) {
        return;
      }
      for (const node of Object.values(mapped) as AssetHierarchyNode[]) {
        if (node && nodes.indexOf(node) < 0) {
          nodes.push(node);
        }
      }
    };
    addMappedNodes(mapping.body);
    addMappedNodes(mapping.leftHand);
    addMappedNodes(mapping.rightHand);
    return nodes;
  }

  private _findCommonRoot(nodes: AssetHierarchyNode[]): Nullable<AssetHierarchyNode> {
    let root: Nullable<AssetHierarchyNode> = nodes[0] ?? null;
    for (let i = 1; root && i < nodes.length; i++) {
      while (root && !root.isParentOf(nodes[i])) {
        root = root.parent;
      }
    }
    return root;
  }

  private _sortSkeletonJoints(root: AssetHierarchyNode, joints: Set<AssetHierarchyNode>) {
    const sorted: AssetHierarchyNode[] = [];
    const visit = (node: AssetHierarchyNode) => {
      if (joints.has(node)) {
        sorted.push(node);
      }
      for (const child of node.children) {
        visit(child);
      }
    };
    visit(root);
    for (const joint of joints) {
      if (sorted.indexOf(joint) < 0) {
        sorted.push(joint);
      }
    }
    return sorted;
  }
  /** @internal */
  private _loadAnimations(gltf: GLTFContent, model: SharedModel) {
    if (gltf.animations) {
      for (let i = 0; i < gltf.animations.length; i++) {
        const animation = this._loadAnimation(gltf, i);
        model.addAnimation(animation);
      }
    }
  }
  /** @internal */
  private collectNodes(gltf: GLTFContent) {
    const collect: Map<
      AssetHierarchyNode,
      {
        translate: Vector3;
        scale: Vector3;
        rotation: Quaternion;
        worldTransform: Nullable<Matrix4x4>;
      }
    > = new Map();
    for (const node of gltf._nodes) {
      collect.set(node, {
        translate: node.position || Vector3.zero(),
        rotation: node.rotation || Quaternion.identity(),
        scale: node.scaling || Vector3.one(),
        worldTransform: null
      });
    }
    return collect;
  }
  /** @internal */
  private getAnimationInfo(
    gltf: GLTFContent,
    index: number
  ): {
    name: string;
    channels: AnimationChannel[];
    samplers: AnimationSampler[];
    interpolatorTypes: Nullable<'translation' | 'scale' | 'rotation' | 'weights'>[];
    interpolators: Nullable<Interpolator>[];
    maxTime: number;
    nodes: Map<
      AssetHierarchyNode,
      {
        translate: Vector3;
        scale: Vector3;
        rotation: Quaternion;
        worldTransform: Nullable<Matrix4x4>;
      }
    >;
  } {
    const animationInfo = gltf.animations![index];
    const name = animationInfo.name || null;
    const channels = animationInfo.channels;
    const samplers = animationInfo.samplers;
    const interpolators = [] as Nullable<Interpolator>[];
    const interpolatorTypes = [] as Nullable<'translation' | 'scale' | 'rotation' | 'weights'>[];
    const nodes = this.collectNodes(gltf);
    let maxTime = 0;
    for (let i = 0; i < channels.length; i++) {
      const channel = channels[i];
      const sampler = samplers[channel.sampler];
      if (!sampler) {
        interpolators.push(null);
        interpolatorTypes.push(null);
        continue;
      }
      const input = gltf._accessors[sampler.input].getNormalizedDeinterlacedView(gltf);
      const output = gltf._accessors[sampler.output].getNormalizedDeinterlacedView(gltf);
      if (!(input instanceof Float32Array) || !(output instanceof Float32Array)) {
        console.error('Input/output channel of animation must be Float32Array');
        interpolators.push(null);
        interpolatorTypes.push(null);
        continue;
      }
      const mode: InterpolationMode =
        sampler.interpolation === 'STEP'
          ? 'step'
          : sampler.interpolation === 'CUBICSPLINE'
            ? 'cubicspline'
            : 'linear';
      let interpolator: Nullable<Interpolator> = null;
      let interpolatorType: Nullable<'translation' | 'scale' | 'rotation' | 'weights'> = null;
      if (channel.target.path === 'rotation') {
        interpolator = new Interpolator(mode, 'quat', input, output);
        interpolatorType = 'rotation';
      } else if (channel.target.path === 'translation') {
        interpolator = new Interpolator(mode, 'vec3', input, output);
        interpolatorType = 'translation';
      } else if (channel.target.path === 'scale') {
        interpolator = new Interpolator(mode, 'vec3', input, output);
        interpolatorType = 'scale';
      } else if (channel.target.path === 'weights') {
        interpolator = new Interpolator(mode, null, input, output);
        interpolatorType = 'weights';
      }
      interpolators.push(interpolator);
      interpolatorTypes.push(interpolatorType);
      if (interpolator) {
        const max = input[input.length - 1];
        if (max > maxTime) {
          maxTime = max;
        }
      }
    }
    return { name, channels, samplers, interpolators, interpolatorTypes, maxTime, nodes };
  }
  /** @internal */
  private _loadAnimation(gltf: GLTFContent, index: number): AssetAnimationData {
    const animationInfo = this.getAnimationInfo(gltf, index);
    const animationData: AssetAnimationData = {
      name: animationInfo.name,
      tracks: [],
      skeletons: [],
      nodes: []
    };
    for (let i = 0; i < animationInfo.channels.length; i++) {
      const interpolator = animationInfo.interpolators[i];
      const interpolatorType = animationInfo.interpolatorTypes[i];
      const targetNodeIndex = animationInfo.channels[i].target.node;
      if (!interpolator || !interpolatorType || typeof targetNodeIndex !== 'number') {
        continue;
      }
      const targetNode = gltf._nodes[targetNodeIndex];
      if (!targetNode) {
        continue;
      }
      const track: AssetAnimationTrack = {
        node: targetNode,
        type: interpolatorType,
        interpolator
      };
      if (track.type === 'weights') {
        track.defaultMorphWeights = targetNode.weights!;
      }
      animationData.tracks.push(track);
      if (animationData.nodes.indexOf(targetNode) < 0) {
        animationData.nodes.push(targetNode);
      }
      if (targetNode.skeletonAttached) {
        for (const skeleton of targetNode.skeletonAttached) {
          if (animationData.skeletons.indexOf(skeleton) < 0) {
            animationData.skeletons.push(skeleton);
          }
        }
      }
    }
    return animationData;
  }
  /** @internal */
  private _loadNode(
    gltf: GLTFContent,
    nodeIndex: number,
    parent: Nullable<AssetHierarchyNode>,
    model: SharedModel
  ): AssetHierarchyNode {
    let node: AssetHierarchyNode = gltf._nodes[nodeIndex];
    if (node) {
      if (parent) {
        if (node.parent) {
          throw new Error('invalid node hierarchy');
        }
        parent.addChild(node);
      }
      return node;
    }
    const nodeInfo = gltf.nodes?.[nodeIndex];
    if (nodeInfo) {
      node = new AssetHierarchyNode(nodeInfo.name, model, parent!); //model.addNode(parent, nodeInfo.name);
      node.weights = nodeInfo.weights ?? null;
      if (typeof nodeInfo.mesh === 'number') {
        node.mesh = gltf._meshes[nodeInfo.mesh];
        if (node.mesh && nodeInfo.name) {
          const subMeshCount = node.mesh.subMeshes.length;
          for (let i = 0; i < subMeshCount; i++) {
            const primitive = node.mesh.subMeshes[i]?.primitive;
            if (primitive) {
              primitive.name = subMeshCount > 1 ? `${nodeInfo.name}_${i}` : nodeInfo.name;
            }
          }
        }
        if (!node.mesh.morphNames && nodeInfo.extras?.targetNames) {
          node.mesh.morphNames = nodeInfo.extras.targetNames;
        }
        const instancing = nodeInfo.extensions?.['EXT_mesh_gpu_instancing'];
        if (instancing) {
          const attributes = instancing.attributes;
          if (attributes) {
            const accessorTranslation =
              typeof attributes.TRANSLATION === 'number' ? gltf._accessors[attributes.TRANSLATION] : null;
            const accessorScale =
              typeof attributes.SCALE === 'number' ? gltf._accessors[attributes.SCALE] : null;
            const accessorRotation =
              typeof attributes.ROTATION === 'number' ? gltf._accessors[attributes.ROTATION] : null;
            const count = accessorTranslation?.count ?? accessorScale?.count ?? accessorRotation?.count ?? 0;
            const translationValues = accessorTranslation?.getNormalizedDeinterlacedView(
              gltf
            ) as Float32Array;
            const scaleValues = accessorScale?.getNormalizedDeinterlacedView(gltf) as Float32Array;
            const rotationValues = accessorRotation?.getNormalizedDeinterlacedView(gltf) as Float32Array;
            for (let i = 0; i < count; i++) {
              const t = translationValues
                ? new Vector3(
                    translationValues[i * 3],
                    translationValues[i * 3 + 1],
                    translationValues[i * 3 + 2]
                  )
                : Vector3.zero();
              const s = scaleValues
                ? new Vector3(scaleValues[i * 3], scaleValues[i * 3 + 1], scaleValues[i * 3 + 2])
                : Vector3.one();
              const r = rotationValues
                ? new Quaternion(
                    rotationValues[i * 4],
                    rotationValues[i * 4 + 1],
                    rotationValues[i * 4 + 2],
                    rotationValues[i * 4 + 3]
                  )
                : Quaternion.identity();
              node.instances.push({ t, s, r });
            }
          }
        } else {
          node.instances.push({ t: Vector3.zero(), s: Vector3.one(), r: Quaternion.identity() });
        }
      }
      if (!(typeof nodeInfo.skin === 'number') || nodeInfo.skin < 0) {
        // GLTF spec: Only the joint transforms are applied to the skinned mesh; the transform of the skinned mesh node MUST be ignored.
        if (nodeInfo.matrix) {
          const matrix = new Matrix4x4(nodeInfo.matrix);
          matrix.decompose(node.scaling, node.rotation, node.position);
        } else {
          if (nodeInfo.rotation) {
            node.rotation.set(nodeInfo.rotation);
          }
          if (nodeInfo.scale) {
            node.scaling.set(nodeInfo.scale);
          }
          if (nodeInfo.translation) {
            node.position.set(nodeInfo.translation);
          }
        }
      }
      gltf._nodes[nodeIndex] = node;
      if (nodeInfo.children) {
        for (const childIndex of nodeInfo.children) {
          this._loadNode(gltf, childIndex, node, model);
        }
      }
    } else {
      throw new Error(`invalid GLTF node: ${nodeIndex}`);
    }
    return node;
  }
  /** @internal */
  private async _loadMeshes(model: SharedModel, gltf: GLTFContent, vfs: VFS) {
    if (gltf.meshes) {
      for (let i = 0; i < gltf.meshes.length; i++) {
        gltf._meshes[i] = (await this._loadMesh(model, gltf, i, vfs))!;
      }
    }
  }
  /** @internal */
  private async _loadMesh(model: SharedModel, gltf: GLTFContent, meshIndex: number, vfs: VFS) {
    const meshInfo = gltf.meshes && gltf.meshes[meshIndex];
    let mesh: Nullable<AssetMeshData> = null;
    if (meshInfo) {
      mesh = {
        morphWeights: meshInfo.weights ?? undefined,
        morphNames: meshInfo['extras']?.targetNames ?? null,
        subMeshes: []
      };
      const primitives = meshInfo.primitives;
      const meshName = meshInfo.name || null;
      if (primitives) {
        const loadedPrimitives: GLTFLoadedMeshPrimitive[] = [];
        for (let i = 0; i < primitives.length; i++) {
          const p = primitives[i];
          const subMeshName = meshName
            ? primitives.length > 1
              ? `${meshName}_${i}`
              : meshName
            : `mesh_${meshIndex}_${i}`;
          const subMeshData: AssetSubMeshData = {
            name: subMeshName,
            primitive: null,
            material: null,
            rawPositions: null,
            rawBlendIndices: null,
            rawJointWeights: null,
            numTargets: 0
          };
          const primitive: AssetPrimitiveInfo = {
            name: subMeshName,
            vertices: {} as any,
            type: 'triangle-list',
            indexCount: 0,
            indices: null,
            boxMax: Vector3.zero(),
            boxMin: Vector3.zero()
          };
          const attributes = p.attributes;
          const dracoExtension = gltf._dracoModule ? p.extensions?.['KHR_draco_mesh_compression'] : null;
          let dracoMeshDecoder: Nullable<DracoMeshDecoder> = null;
          if (dracoExtension) {
            const bufferView = gltf.bufferViews && gltf.bufferViews[dracoExtension.bufferView];
            if (!bufferView) {
              throw new Error('Draco buffer view not set');
            }
            const arrayBuffer = gltf._loadedBuffers && gltf._loadedBuffers[bufferView.buffer];
            if (!arrayBuffer) {
              throw new Error('Draco buffer view does not point to a valid ArrayBuffer');
            }
            dracoMeshDecoder = new DracoMeshDecoder(
              new Int8Array(arrayBuffer, bufferView.byteOffset ?? 0, bufferView.byteLength),
              gltf._dracoModule!
            );
          }
          for (const attrib in attributes) {
            this._loadVertexBuffer(
              gltf,
              attrib,
              attributes[attrib],
              primitive,
              subMeshData,
              dracoExtension,
              dracoMeshDecoder!
            );
          }
          if (p.targets) {
            if (getDevice().type === 'webgl') {
              // Emulate vertexID for WebGL1 device
              if (attributes['TEXCOORD_7'] !== undefined) {
                console.error(`Could not load morph target animation`);
                p.targets = undefined;
              } else {
                const positionInfo = primitive.vertices['position'];
                const numVertices = positionInfo
                  ? (positionInfo.data.length / getVertexFormatComponentCount(positionInfo.format)) >> 0
                  : 0;
                const vertexIndices = new Float32Array(numVertices);
                for (let i = 0; i < vertexIndices.length; i++) {
                  vertexIndices[i] = i;
                }
                primitive.vertices['texCoord7'] = { format: 'tex7_f32', data: vertexIndices };
              }
            }
          }
          if (p.targets) {
            const targets: AssetSubMeshData['targets'] = {};
            const targetBox: AssetSubMeshData['targetBox'] = [];
            const targetMap = {
              POSITION: MORPH_TARGET_POSITION,
              NORMAL: MORPH_TARGET_NORMAL,
              TANGENT: MORPH_TARGET_TANGENT,
              TEXCOORD_0: MORPH_TARGET_TEX0,
              TEXCOORD_1: MORPH_TARGET_TEX1,
              TEXCOORD_2: MORPH_TARGET_TEX2,
              TEXCOORD_3: MORPH_TARGET_TEX3,
              COLOR_0: MORPH_TARGET_COLOR
            };
            const morphAttribSet = new Set<number>();
            for (const target of p.targets) {
              for (const k in target) {
                const t = targetMap[k as keyof typeof targetMap];
                if (t !== undefined) {
                  targets[t] = targets[t] ?? { numComponents: 0, data: [] };
                  const accessorIndex = target[k] as number;
                  const accessor = gltf._accessors[accessorIndex];
                  targets[t].numComponents = accessor.getComponentCount(accessor.type);
                  targets[t].data.push(accessor.getNormalizedDeinterlacedView(gltf) as Float32Array);
                  if (k === 'POSITION') {
                    const min = accessor.min
                      ? new Vector3(accessor.min[0], accessor.min[1], accessor.min[2])
                      : Vector3.zero();
                    const max = accessor.max
                      ? new Vector3(accessor.max[0], accessor.max[1], accessor.max[2])
                      : Vector3.zero();
                    targetBox.push(new BoundingBox(min, max));
                  }
                  morphAttribSet.add(t);
                }
              }
            }
            subMeshData.numTargets = p.targets.length;
            subMeshData.targets = targets;
            subMeshData.targetBox = targetBox;
            subMeshData.morphAttribCount = morphAttribSet.size;
          }
          const indices = p.indices;
          if (typeof indices === 'number') {
            this._loadIndexBuffer(gltf, indices, primitive, subMeshData, dracoExtension, dracoMeshDecoder!);
          }
          let primitiveType = p.mode;
          if (typeof primitiveType !== 'number') {
            primitiveType = 4;
          }
          primitive.type = this._primitiveType(primitiveType)!;
          const materialInfo = p.material !== undefined ? gltf.materials![p.material] : null;
          const outlineUsesTangentNormals = this._shouldGenerateMToonOutlineNormals(
            materialInfo,
            p,
            primitive
          );
          loadedPrimitives.push({
            source: p,
            primitive,
            subMeshData,
            materialInfo,
            outlineUsesTangentNormals
          });
        }
        this._generateMToonOutlineNormals(loadedPrimitives);
        for (const loaded of loadedPrimitives) {
          const { source: p, primitive, subMeshData, materialInfo, outlineUsesTangentNormals } = loaded;
          const hasVertexNormal = !!primitive.vertices['normal'];
          const hasVertexColor = !!primitive.vertices['diffuse'];
          const hasVertexTangent = !!primitive.vertices['tangent'];
          const flagsHash = [
            hasVertexNormal ? 'N' : '',
            hasVertexColor ? 'C' : '',
            hasVertexTangent ? 'T' : '',
            outlineUsesTangentNormals ? 'OTN' : ''
          ]
            .filter((v) => !!v)
            .join('');
          const materialHash = [p.material ?? 'default', flagsHash].filter((v) => !!v).join('.');
          let material = model.getMaterial(materialHash);
          if (!material) {
            material = await this._loadMaterial(
              model,
              gltf,
              materialInfo!,
              hasVertexColor,
              hasVertexNormal,
              hasVertexTangent,
              outlineUsesTangentNormals,
              vfs
            );
            model.setMaterial(materialHash, material);
          } else if (outlineUsesTangentNormals && material.type === 'mtoon') {
            (material as GLTFMToonAssetMaterial).outlineUsesTangentNormals = true;
          }
          subMeshData.primitive = primitive;
          subMeshData.material = material;
          mesh.subMeshes.push(subMeshData);
          model.addPrimitive(primitive);
        }
      }
    }
    return mesh;
  }
  private _shouldGenerateMToonOutlineNormals(
    materialInfo: Nullable<Material>,
    primitiveInfo: MeshPrimitive,
    primitive: AssetPrimitiveInfo
  ) {
    if (!materialInfo?.extensions?.VRMC_materials_mtoon) {
      return false;
    }
    if (materialInfo.normalTexture) {
      return false;
    }
    if (primitiveInfo.targets?.some((target) => target.TANGENT !== undefined)) {
      return false;
    }
    return (
      primitive.type === 'triangle-list' && !!primitive.vertices['position'] && !!primitive.vertices['normal']
    );
  }
  private _generateMToonOutlineNormals(primitives: GLTFLoadedMeshPrimitive[]) {
    const targets = primitives.filter((p) => p.outlineUsesTangentNormals);
    if (targets.length === 0) {
      return;
    }
    const sums = new Map<string, [number, number, number]>();
    for (const { primitive } of targets) {
      const positionInfo = primitive.vertices['position'];
      if (!positionInfo) {
        continue;
      }
      const positions = positionInfo.data as Float32Array;
      const positionStride = getVertexFormatComponentCount(positionInfo.format);
      const vertexCount = (positions.length / positionStride) >> 0;
      const indices = this._getTriangleIndices(primitive, vertexCount);
      if (!indices) {
        continue;
      }
      for (let i = 0; i + 2 < indices.length; i += 3) {
        const i0 = indices[i];
        const i1 = indices[i + 1];
        const i2 = indices[i + 2];
        const p0 = i0 * positionStride;
        const p1 = i1 * positionStride;
        const p2 = i2 * positionStride;
        const ax = positions[p1] - positions[p0];
        const ay = positions[p1 + 1] - positions[p0 + 1];
        const az = positions[p1 + 2] - positions[p0 + 2];
        const bx = positions[p2] - positions[p0];
        const by = positions[p2 + 1] - positions[p0 + 1];
        const bz = positions[p2 + 2] - positions[p0 + 2];
        const nx = ay * bz - az * by;
        const ny = az * bx - ax * bz;
        const nz = ax * by - ay * bx;
        if (nx * nx + ny * ny + nz * nz <= 1e-20) {
          continue;
        }
        this._accumulateOutlineNormal(sums, positions, positionStride, i0, nx, ny, nz);
        this._accumulateOutlineNormal(sums, positions, positionStride, i1, nx, ny, nz);
        this._accumulateOutlineNormal(sums, positions, positionStride, i2, nx, ny, nz);
      }
    }
    for (const { primitive } of targets) {
      const positionInfo = primitive.vertices['position'];
      const normalInfo = primitive.vertices['normal'];
      if (!positionInfo || !normalInfo) {
        continue;
      }
      const positions = positionInfo.data as Float32Array;
      const normals = normalInfo.data as Float32Array;
      const positionStride = getVertexFormatComponentCount(positionInfo.format);
      const normalStride = getVertexFormatComponentCount(normalInfo.format);
      const vertexCount = (positions.length / positionStride) >> 0;
      const tangents = new Float32Array(vertexCount * 4);
      for (let i = 0; i < vertexCount; i++) {
        const key = this._outlinePositionKey(
          positions[i * positionStride],
          positions[i * positionStride + 1],
          positions[i * positionStride + 2]
        );
        const sum = sums.get(key);
        let nx = sum?.[0] ?? normals[i * normalStride];
        let ny = sum?.[1] ?? normals[i * normalStride + 1];
        let nz = sum?.[2] ?? normals[i * normalStride + 2];
        const len = Math.hypot(nx, ny, nz);
        if (len > 1e-10) {
          nx /= len;
          ny /= len;
          nz /= len;
        } else {
          nx = normals[i * normalStride];
          ny = normals[i * normalStride + 1];
          nz = normals[i * normalStride + 2];
          const fallbackLen = Math.hypot(nx, ny, nz);
          if (fallbackLen > 1e-10) {
            nx /= fallbackLen;
            ny /= fallbackLen;
            nz /= fallbackLen;
          } else {
            nx = 0;
            ny = 1;
            nz = 0;
          }
        }
        tangents[i * 4] = nx;
        tangents[i * 4 + 1] = ny;
        tangents[i * 4 + 2] = nz;
        tangents[i * 4 + 3] = 1;
      }
      primitive.vertices['tangent'] = { format: 'tangent_f32x4', data: tangents };
    }
  }
  private _accumulateOutlineNormal(
    sums: Map<string, [number, number, number]>,
    positions: Float32Array,
    stride: number,
    index: number,
    x: number,
    y: number,
    z: number
  ) {
    const offset = index * stride;
    const key = this._outlinePositionKey(positions[offset], positions[offset + 1], positions[offset + 2]);
    const sum = sums.get(key);
    if (sum) {
      sum[0] += x;
      sum[1] += y;
      sum[2] += z;
    } else {
      sums.set(key, [x, y, z]);
    }
  }
  private _getTriangleIndices(primitive: AssetPrimitiveInfo, vertexCount: number) {
    if (primitive.indices) {
      return primitive.indices;
    }
    const indices = new Uint32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) {
      indices[i] = i;
    }
    return indices;
  }
  private _outlinePositionKey(x: number, y: number, z: number) {
    return `${Math.round(x * 100000)},${Math.round(y * 100000)},${Math.round(z * 100000)}`;
  }
  /** @internal */
  private async _loadMaterial(
    model: SharedModel,
    gltf: GLTFContent,
    materialInfo: Material,
    vertexColor: boolean,
    vertexNormal: boolean,
    useTangent: boolean,
    outlineUsesTangentNormals: boolean,
    vfs: VFS
  ): Promise<AssetMaterial> {
    const materialName = materialInfo?.name || 'material';
    let assetMaterial: Nullable<AssetMaterial> = null;
    let pbrMetallicRoughness: Nullable<AssetPBRMaterialMR> = null;
    let pbrSpecularGlossness: Nullable<AssetPBRMaterialSG> = null;
    const pbrCommon: AssetMaterialCommon = {
      useTangent,
      vertexColor,
      vertexNormal,
      bumpScale: 1,
      emissiveColor: Vector3.zero(),
      emissiveStrength: 1,
      occlusionStrength: 1
    };
    switch (materialInfo?.alphaMode) {
      case 'BLEND': {
        pbrCommon.alphaMode = 'blend';
        break;
      }
      case 'MASK': {
        pbrCommon.alphaMode = 'mask';
        pbrCommon.alphaCutoff = materialInfo.alphaCutoff ?? 0.5;
        break;
      }
    }
    if (materialInfo?.doubleSided) {
      pbrCommon.doubleSided = true;
    }
    const mtoonExtension = materialInfo?.extensions?.VRMC_materials_mtoon as
      | VRMCMToonMaterialInfo
      | undefined;
    if (
      materialInfo?.pbrMetallicRoughness ||
      materialInfo?.extensions?.KHR_materials_pbrSpecularGlossiness ||
      mtoonExtension
    ) {
      pbrCommon.normalMap = materialInfo.normalTexture
        ? await this._loadTexture(model, gltf, materialInfo.normalTexture, false, vfs)
        : undefined;
      pbrCommon.bumpScale = materialInfo.normalTexture?.scale ?? 1;
      pbrCommon.occlusionMap = materialInfo.occlusionTexture
        ? await this._loadTexture(model, gltf, materialInfo.occlusionTexture, false, vfs)
        : undefined;
      pbrCommon.occlusionStrength = materialInfo.occlusionTexture?.strength ?? 1;
      pbrCommon.emissiveMap = materialInfo.emissiveTexture
        ? await this._loadTexture(model, gltf, materialInfo.emissiveTexture, false, vfs)
        : undefined;
      pbrCommon.emissiveStrength =
        materialInfo?.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1;
      pbrCommon.emissiveColor = materialInfo.emissiveFactor
        ? new Vector3(materialInfo.emissiveFactor)
        : Vector3.zero();
    }
    if (materialInfo?.pbrMetallicRoughness) {
      pbrMetallicRoughness = {
        name: materialName,
        type: 'pbrMetallicRoughness',
        ior: 1.5,
        common: pbrCommon
      };
      pbrMetallicRoughness.diffuse = new Vector4(
        materialInfo.pbrMetallicRoughness.baseColorFactor ?? [1, 1, 1, 1]
      );
      pbrMetallicRoughness.metallic = materialInfo.pbrMetallicRoughness.metallicFactor ?? 1;
      pbrMetallicRoughness.roughness = materialInfo.pbrMetallicRoughness.roughnessFactor ?? 1;
      pbrMetallicRoughness.diffuseMap = materialInfo.pbrMetallicRoughness.baseColorTexture
        ? await this._loadTexture(model, gltf, materialInfo.pbrMetallicRoughness.baseColorTexture, true, vfs)
        : undefined;
      pbrMetallicRoughness.metallicMap = materialInfo.pbrMetallicRoughness.metallicRoughnessTexture
        ? await this._loadTexture(
            model,
            gltf,
            materialInfo.pbrMetallicRoughness.metallicRoughnessTexture,
            false,
            vfs
          )
        : undefined;
      pbrMetallicRoughness.metallicIndex = 2;
      pbrMetallicRoughness.roughnessIndex = 1;
    }
    if (mtoonExtension) {
      return this._loadMToonMaterial(
        model,
        gltf,
        materialName,
        materialInfo,
        pbrCommon,
        mtoonExtension,
        outlineUsesTangentNormals,
        vfs
      );
    }
    if (materialInfo?.extensions?.KHR_materials_pbrSpecularGlossiness) {
      const sg = materialInfo.extensions?.KHR_materials_pbrSpecularGlossiness;
      pbrSpecularGlossness = {
        name: materialName,
        type: 'pbrSpecularGlossiness',
        ior: 1.5,
        common: pbrCommon
      };
      pbrSpecularGlossness.diffuse = new Vector4(sg.diffuseFactor ?? [1, 1, 1, 1]);
      pbrSpecularGlossness.specular = new Vector3(sg.specularFactor ?? [1, 1, 1]);
      pbrSpecularGlossness.glossness = sg.glossnessFactor ?? 1;
      pbrSpecularGlossness.diffuseMap = sg.diffuseTexture
        ? await this._loadTexture(model, gltf, sg.diffuseTexture, true, vfs)
        : undefined;
      pbrSpecularGlossness.specularGlossnessMap = sg.specularGlossinessTexture
        ? await this._loadTexture(model, gltf, sg.specularGlossinessTexture, true, vfs)
        : undefined;
    }
    assetMaterial = pbrSpecularGlossness || pbrMetallicRoughness;
    if (!assetMaterial || materialInfo?.extensions?.KHR_materials_unlit) {
      if (materialInfo?.extensions?.KHR_materials_unlit) {
        assetMaterial = {
          name: materialName,
          type: 'unlit',
          common: pbrCommon,
          diffuse: pbrMetallicRoughness?.diffuse ?? Vector4.one(),
          diffuseMap: pbrMetallicRoughness?.diffuseMap ?? null
        } as AssetUnlitMaterial;
      } else {
        assetMaterial = {
          name: materialName,
          type: 'pbrMetallicRoughness',
          common: pbrCommon,
          diffuse: Vector4.one(),
          metallic: 1,
          roughness: 1,
          diffuseMap: undefined,
          metallicMap: undefined,
          metallicIndex: 2,
          roughnessIndex: 1
        } as AssetPBRMaterialMR;
      }
    }
    if (assetMaterial.type !== 'unlit' && materialInfo?.extensions?.KHR_materials_ior) {
      (assetMaterial as AssetPBRMaterialCommon).ior = materialInfo.extensions.KHR_materials_ior.ior ?? 1.5;
    }
    if (assetMaterial.type === 'pbrMetallicRoughness') {
      pbrMetallicRoughness = assetMaterial;
      // KHR_materials_specular extension
      const specularColorFactor = (materialInfo?.extensions?.KHR_materials_specular?.specularColorFactor ?? [
        1, 1, 1
      ]) as [number, number, number];
      pbrMetallicRoughness.specularFactor = new Vector4(
        ...specularColorFactor,
        materialInfo?.extensions?.KHR_materials_specular?.specularFactor ?? 1
      );
      pbrMetallicRoughness.specularMap = materialInfo?.extensions?.KHR_materials_specular?.specularTexture
        ? await this._loadTexture(
            model,
            gltf,
            materialInfo.extensions.KHR_materials_specular.specularTexture,
            false,
            vfs
          )
        : undefined;
      pbrMetallicRoughness.specularColorMap = materialInfo?.extensions?.KHR_materials_specular
        ?.specularColorTexture
        ? await this._loadTexture(
            model,
            gltf,
            materialInfo.extensions.KHR_materials_specular.specularColorTexture,
            true,
            vfs
          )
        : undefined;
      // KHR_materials_iridescence
      const iridescence = materialInfo?.extensions?.KHR_materials_iridescence;
      if (iridescence) {
        pbrMetallicRoughness.iridescence = {
          iridescenceFactor: iridescence.iridescenceFactor ?? 0,
          iridescenceMap: iridescence.iridescenceTexture
            ? await this._loadTexture(model, gltf, iridescence.iridescenceTexture, false, vfs)
            : undefined,
          iridescenceIor: iridescence.iridescenceIor ?? 1.3,
          iridescenceThicknessMinimum: iridescence.iridescenceThicknessMinimum ?? 100,
          iridescenceThicknessMaximum: iridescence.iridescenceThicknessMaximum ?? 400,
          iridescenceThicknessMap: iridescence.iridescenceThicknessTexture
            ? await this._loadTexture(model, gltf, iridescence.iridescenceThicknessTexture, false, vfs)
            : undefined
        };
      }
      // KHR_materials_transmission
      const transmission = materialInfo?.extensions?.KHR_materials_transmission;
      if (transmission) {
        pbrMetallicRoughness.transmission = {
          transmissionFactor: transmission.transmissionFactor ?? 0,
          transmissionMap: transmission.transmissionTexture
            ? await this._loadTexture(model, gltf, transmission.transmissionTexture, false, vfs)
            : undefined,
          thicknessFactor: 0,
          thicknessMap: undefined,
          attenuationDistance: 99999,
          attenuationColor: Vector3.one()
        };
        const volume = materialInfo?.extensions?.KHR_materials_volume;
        if (volume) {
          pbrMetallicRoughness.transmission.thicknessFactor = volume.thicknessFactor ?? 0;
          pbrMetallicRoughness.transmission.thicknessMap = volume.thicknessTexture
            ? await this._loadTexture(model, gltf, volume.thicknessTexture, false, vfs)
            : undefined;
          pbrMetallicRoughness.transmission.attenuationDistance = volume.attenuationDistance ?? 99999;
          const attenuationColor = (volume.attenuationColor ?? [1, 1, 1]) as [number, number, number];
          pbrMetallicRoughness.transmission.attenuationColor = new Vector3(...attenuationColor);
        }
      }
      // KHR_materials_sheen
      const sheen = materialInfo?.extensions?.KHR_materials_sheen;
      if (sheen) {
        pbrMetallicRoughness.sheen = {
          sheenColorFactor: new Vector3(sheen.sheenColorFactor ?? [0, 0, 0]),
          sheenColorMap: sheen.sheenColorTexture
            ? await this._loadTexture(model, gltf, sheen.sheenColorTexture, true, vfs)
            : undefined,
          sheenRoughnessFactor: sheen.sheenRoughnessFactor ?? 0,
          sheenRoughnessMap: sheen.sheenRoughnessTexture
            ? await this._loadTexture(model, gltf, sheen.sheenRoughnessTexture, true, vfs)
            : undefined
        };
      }
      // KHR_materials_clearcoat
      const cc = materialInfo?.extensions?.KHR_materials_clearcoat;
      if (cc) {
        pbrMetallicRoughness.clearcoat = {
          clearCoatFactor: cc.clearcoatFactor ?? 0,
          clearCoatIntensityMap: cc.clearcoatTexture
            ? await this._loadTexture(model, gltf, cc.clearcoatTexture, false, vfs)
            : undefined,
          clearCoatRoughnessFactor: cc.clearcoatRoughnessFactor ?? 0,
          clearCoatRoughnessMap: cc.clearcoatRoughnessTexture
            ? await this._loadTexture(model, gltf, cc.clearcoatRoughnessTexture, false, vfs)
            : undefined,
          clearCoatNormalMap: cc.clearcoatNormalTexture
            ? await this._loadTexture(model, gltf, cc.clearcoatNormalTexture, false, vfs)
            : undefined
        };
      }
    }
    return assetMaterial;
  }
  /** @internal */
  private async _loadMToonMaterial(
    model: SharedModel,
    gltf: GLTFContent,
    materialName: string,
    materialInfo: Material,
    common: AssetMaterialCommon,
    mtoon: VRMCMToonMaterialInfo,
    outlineUsesTangentNormals: boolean,
    vfs: VFS
  ): Promise<GLTFMToonAssetMaterial> {
    const pbr = materialInfo?.pbrMetallicRoughness;
    const mtoonMaterial: GLTFMToonAssetMaterial = {
      name: materialName,
      type: 'mtoon',
      common,
      diffuse: new Vector4(pbr?.baseColorFactor ?? [1, 1, 1, 1]),
      diffuseMap: pbr?.baseColorTexture
        ? await this._loadTexture(model, gltf, pbr.baseColorTexture, true, vfs)
        : undefined,
      shadeColorFactor: mtoon.shadeColorFactor ? new Vector3(mtoon.shadeColorFactor) : undefined,
      shadeMultiplyMap: mtoon.shadeMultiplyTexture
        ? await this._loadTexture(model, gltf, mtoon.shadeMultiplyTexture, true, vfs)
        : undefined,
      shadingShiftFactor: mtoon.shadingShiftFactor,
      shadingShiftMap: mtoon.shadingShiftTexture
        ? await this._loadTexture(model, gltf, mtoon.shadingShiftTexture, false, vfs)
        : undefined,
      shadingShiftTextureScale: mtoon.shadingShiftTexture?.scale,
      shadingToonyFactor: mtoon.shadingToonyFactor,
      giEqualizationFactor: mtoon.giEqualizationFactor,
      matcapFactor: mtoon.matcapFactor ? new Vector3(mtoon.matcapFactor) : undefined,
      matcapMap: mtoon.matcapTexture
        ? await this._loadTexture(model, gltf, mtoon.matcapTexture, true, vfs)
        : undefined,
      parametricRimColorFactor: mtoon.parametricRimColorFactor
        ? new Vector3(mtoon.parametricRimColorFactor)
        : undefined,
      parametricRimFresnelPowerFactor: mtoon.parametricRimFresnelPowerFactor,
      parametricRimLiftFactor: mtoon.parametricRimLiftFactor,
      rimMultiplyMap: mtoon.rimMultiplyTexture
        ? await this._loadTexture(model, gltf, mtoon.rimMultiplyTexture, true, vfs)
        : undefined,
      rimLightingMixFactor: mtoon.rimLightingMixFactor,
      outlineWidthMode: mtoon.outlineWidthMode,
      outlineWidthFactor: mtoon.outlineWidthFactor,
      outlineWidthMultiplyMap: mtoon.outlineWidthMultiplyTexture
        ? await this._loadTexture(model, gltf, mtoon.outlineWidthMultiplyTexture, false, vfs)
        : undefined,
      outlineColorFactor: mtoon.outlineColorFactor ? new Vector3(mtoon.outlineColorFactor) : undefined,
      outlineLightingMixFactor: mtoon.outlineLightingMixFactor,
      outlineUsesTangentNormals,
      uvAnimationMaskMap: mtoon.uvAnimationMaskTexture
        ? await this._loadTexture(model, gltf, mtoon.uvAnimationMaskTexture, false, vfs)
        : undefined,
      uvAnimationScrollXSpeedFactor: mtoon.uvAnimationScrollXSpeedFactor,
      uvAnimationScrollYSpeedFactor: mtoon.uvAnimationScrollYSpeedFactor,
      uvAnimationRotationSpeedFactor: mtoon.uvAnimationRotationSpeedFactor,
      transparentWithZWrite: mtoon.transparentWithZWrite,
      renderQueueOffsetNumber: mtoon.renderQueueOffsetNumber
    };
    return mtoonMaterial;
  }
  /** @internal */
  private async _loadTexture(
    model: SharedModel,
    gltf: GLTFContent,
    info: Partial<TextureInfo>,
    sRGB: boolean,
    vfs: VFS
  ): Promise<AssetTextureInfo> {
    const mt: AssetTextureInfo = {
      image: null,
      sampler: null,
      texCoord: info.texCoord ?? 0,
      transform: null
    };
    const textureInfo = gltf.textures![info.index!];
    if (textureInfo) {
      if (info.extensions?.KHR_texture_transform) {
        const uvTransform = info.extensions.KHR_texture_transform;
        if (uvTransform.texCoord !== undefined) {
          mt.texCoord = uvTransform.texCoord;
        }
        const rotation =
          uvTransform.rotation !== undefined
            ? Matrix4x4.rotationZ(-uvTransform.rotation)
            : Matrix4x4.identity();
        const scale =
          uvTransform.scale !== undefined
            ? new Vector3(uvTransform.scale[0], uvTransform.scale[1], 1)
            : Vector3.one();
        const translation =
          uvTransform.offset !== undefined
            ? new Vector3(uvTransform.offset[0], uvTransform.offset[1], 0)
            : Vector3.zero();
        mt.transform = Matrix4x4.scaling(scale).multiplyLeft(rotation).translateLeft(translation);
      }
      mt.name = textureInfo.name || undefined;
      let wrapS: TextureAddressMode = 'repeat';
      let wrapT: TextureAddressMode = 'repeat';
      let magFilter: TextureFilterMode = 'linear';
      let minFilter: TextureFilterMode = 'linear';
      let mipFilter: TextureFilterMode = 'linear';
      const samplerIndex: number = textureInfo.sampler!;
      const sampler = gltf.samplers && gltf.samplers[samplerIndex];
      if (sampler) {
        switch (sampler.wrapS) {
          case 0x2901: // gl.REPEAT
            wrapS = 'repeat';
            break;
          case 0x8370: // gl.MIRRORED_REPEAT
            wrapS = 'mirrored-repeat';
            break;
          case 0x812f: // gl.CLAMP_TO_EDGE
            wrapS = 'clamp';
            break;
        }
        switch (sampler.wrapT) {
          case 0x2901: // gl.REPEAT
            wrapT = 'repeat';
            break;
          case 0x8370: // gl.MIRRORED_REPEAT
            wrapT = 'mirrored-repeat';
            break;
          case 0x812f: // gl.CLAMP_TO_EDGE
            wrapT = 'clamp';
            break;
        }
        switch (sampler.magFilter) {
          case 0x2600: // gl.NEAREST
            magFilter = 'nearest';
            break;
          case 0x2601: // gl.LINEAR
            magFilter = 'linear';
            break;
        }
        switch (sampler.minFilter) {
          case 0x2600: // gl.NEAREST
            minFilter = 'nearest';
            mipFilter = 'none';
            break;
          case 0x2601: // gl.LINEAR
            minFilter = 'linear';
            mipFilter = 'none';
            break;
          case 0x2700: // gl.NEAREST_MIPMAP_NEAREST
            minFilter = 'nearest';
            mipFilter = 'nearest';
            break;
          case 0x2701: // gl.LINEAR_MIPMAP_NEAREST
            minFilter = 'linear';
            mipFilter = 'nearest';
            break;
          case 0x2702: // gl.NEAREST_MIPMAP_LINEAR
            minFilter = 'nearest';
            mipFilter = 'linear';
            break;
          case 0x2703: // gl.LINEAR_MIPMAP_LINEAR
            minFilter = 'linear';
            mipFilter = 'linear';
            break;
        }
      }
      const imageIndex: number = textureInfo.source!;
      mt.image = model.getImage(imageIndex);
      if (!mt.image) {
        const image = gltf.images![imageIndex];
        if (image) {
          if (image.uri) {
            const imageUrl = vfs.normalizePath(vfs.join(gltf._baseURI, image.uri));
            mt.image = {
              name: image.name || textureInfo.name || undefined,
              uri: imageUrl
            };
          } else if (typeof image.bufferView === 'number' && image.mimeType) {
            const bufferView = gltf.bufferViews && gltf.bufferViews[image.bufferView];
            if (bufferView) {
              const arrayBuffer = gltf._loadedBuffers && gltf._loadedBuffers[bufferView.buffer];
              if (arrayBuffer) {
                const view = new Uint8Array(arrayBuffer, bufferView.byteOffset || 0, bufferView.byteLength);
                const mimeType = image.mimeType;
                mt.image = {
                  name: image.name || textureInfo.name || undefined,
                  data: view,
                  mimeType
                };
              }
            }
          }
        }
        if (mt.image) {
          model.setImage(imageIndex, mt.image);
        }
      }
      if (mt.image) {
        mt.sRGB = !!sRGB;
        mt.sampler = {
          wrapS,
          wrapT,
          magFilter,
          minFilter,
          mipFilter
        };
      }
    }
    return mt;
  }
  /** @internal */
  private _primitiveType(type: number) {
    switch (type) {
      case 0: // GL_POINTS
        return 'point-list';
      case 1: // GL_LINES
        return 'line-list';
      /* FIXME:
      case 2: // GL_LINE_LOOP
        return PrimitiveType.LineLoop;
      */
      case 3: // GL_LINE_STRIP
        return 'line-strip';
      case 4: // GL_TRIANGLES
        return 'triangle-list';
      case 5: // GL_TRIANGLE_STRIP
        return 'triangle-strip';
      case 6: // GL_TRIANGLE_FAN
        return 'triangle-fan';
      default:
        return null;
    }
  }
  /** @internal */
  private _loadIndexBuffer(
    gltf: GLTFContent,
    accessorIndex: number,
    primitive: AssetPrimitiveInfo,
    meshData: AssetSubMeshData,
    dracoExtension?: any,
    dracoMeshDecoder?: DracoMeshDecoder
  ) {
    const accessor = gltf._accessors[accessorIndex];
    if (dracoMeshDecoder) {
      const indices = dracoMeshDecoder.getIndexBuffer();
      if (!indices || indices.length !== accessor.count) {
        throw new Error(`Decode index buffer failed`);
      }
      if (indices.length !== accessor.count) {
        throw new Error(`Decode index buffer failed`);
      }
      gltf._loadedBuffers!.push(indices.buffer);
      if (!gltf.bufferViews) {
        gltf.bufferViews = [];
      }
      gltf.bufferViews.push({
        buffer: gltf._loadedBuffers!.length - 1,
        byteOffset: 0,
        byteLength: indices.byteLength
      });
      accessor.componentType = ComponentType.UINT;
      accessor.bufferView = gltf.bufferViews.length - 1;
    }
    this._setBuffer(gltf, accessorIndex, primitive, null, meshData);
  }
  /** @internal */
  private _loadVertexBuffer(
    gltf: GLTFContent,
    attribName: string,
    accessorIndex: number,
    primitive: AssetPrimitiveInfo,
    subMeshData: AssetSubMeshData,
    dracoExtension?: any,
    dracoMeshDecoder?: DracoMeshDecoder
  ) {
    const dracoId = dracoExtension?.attributes?.[attribName];
    if (dracoId !== undefined) {
      const accessor = gltf._accessors[accessorIndex];
      let buffer: Nullable<TypedArray> = null;
      const numElements = accessor.count * accessor.getComponentCount(accessor.type);
      switch (accessor.componentType) {
        case ComponentType.FLOAT:
          buffer = new Float32Array(numElements);
          break;
        case ComponentType.BYTE:
          buffer = new Int8Array(numElements);
          break;
        case ComponentType.SHORT:
          buffer = new Int16Array(numElements);
          break;
        case ComponentType.INT:
          buffer = new Int32Array(numElements);
          break;
        case ComponentType.UBYTE:
          buffer = new Uint8Array(numElements);
          break;
        case ComponentType.USHORT:
          buffer = new Uint16Array(numElements);
          break;
        case ComponentType.UINT:
          buffer = new Uint32Array(numElements);
          break;
        default:
          throw new Error(`Invalid component type: ${accessor.componentType}`);
      }
      if (!dracoMeshDecoder!.getAttributeBuffer(dracoId, buffer)) {
        throw new Error(`Decode draco mesh failed`);
      }
      gltf._loadedBuffers!.push(buffer.buffer);
      if (!gltf.bufferViews) {
        gltf.bufferViews = [];
      }
      gltf.bufferViews.push({
        buffer: gltf._loadedBuffers!.length - 1,
        byteOffset: 0,
        byteLength: buffer.byteLength
      });
      accessor.bufferView = gltf.bufferViews.length - 1;
    }
    let semantic: Nullable<VertexSemantic> = null;
    switch (attribName) {
      case 'POSITION':
        semantic = 'position';
        break;
      case 'NORMAL':
        semantic = 'normal';
        break;
      case 'TANGENT':
        semantic = 'tangent';
        break;
      case 'TEXCOORD_0':
        semantic = 'texCoord0';
        break;
      case 'TEXCOORD_1':
        semantic = 'texCoord1';
        break;
      case 'TEXCOORD_2':
        semantic = 'texCoord2';
        break;
      case 'TEXCOORD_3':
        semantic = 'texCoord3';
        break;
      case 'TEXCOORD_4':
        semantic = 'texCoord4';
        break;
      case 'TEXCOORD_5':
        semantic = 'texCoord5';
        break;
      case 'TEXCOORD_6':
        semantic = 'texCoord6';
        break;
      case 'TEXCOORD_7':
        semantic = 'texCoord7';
        break;
      case 'COLOR_0':
        semantic = 'diffuse';
        break;
      case 'JOINTS_0':
        semantic = 'blendIndices';
        break;
      case 'WEIGHTS_0':
        semantic = 'blendWeights';
        break;
      default:
        return;
    }

    this._setBuffer(gltf, accessorIndex, primitive, semantic, subMeshData);
  }
  /** @internal */
  private _setBuffer(
    gltf: GLTFContent,
    accessorIndex: number,
    primitive: AssetPrimitiveInfo,
    semantic: Nullable<VertexSemantic>,
    subMeshData: AssetSubMeshData
  ) {
    const device = getDevice();
    const accessor = gltf._accessors[accessorIndex];
    const componentCount = accessor.getComponentCount(accessor.type);
    let data = accessor.getNormalizedDeinterlacedView(gltf);
    let buffer: Nullable<TypedArray> = null;
    let attribFormat: Nullable<VertexAttribFormat> = null;
    if (semantic && !(data instanceof Float32Array)) {
      const floatData = new Float32Array(data.length);
      floatData.set(data);
      data = floatData;
    }
    if (!semantic) {
      if (!(data instanceof Uint8Array) && !(data instanceof Uint16Array) && !(data instanceof Uint32Array)) {
        console.error('Invalid index buffer component type');
        return;
      }
      if (data instanceof Uint32Array && !device.getDeviceCaps().miscCaps.support32BitIndex) {
        console.error('Device does not support 32bit vertex index');
        return;
      }
      if (data instanceof Uint8Array) {
        const uint16Data = new Uint16Array(data.length);
        uint16Data.set(data);
        data = uint16Data;
      }
    }
    if (!semantic) {
      buffer = data as Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>;
    } else {
      attribFormat = device.getVertexAttribFormat(semantic, 'f32', componentCount);
      buffer = data;
    }
    if (buffer) {
      if (!semantic) {
        primitive.indices = buffer as Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>;
        primitive.indexCount = buffer.length;
      } else {
        const semantic = getVertexAttribName(getVertexAttributeIndex(attribFormat!));
        primitive.vertices[semantic] = { format: attribFormat!, data: buffer };
        if (semantic === 'position') {
          if (!primitive.indices) {
            primitive.indexCount = Math.floor(buffer.byteLength / 12);
          }
          const data = accessor.getNormalizedDeinterlacedView(gltf);
          subMeshData.rawPositions = data as Float32Array;
          const min = accessor.min;
          const max = accessor.max;
          if (min && max) {
            primitive.boxMin.set(min);
            primitive.boxMax.set(max);
          } else {
            const bbox = new BoundingBox();
            bbox.beginExtend();
            for (let i = 0; i < data.length; i++) {
              const v = new Vector3(
                data[i * componentCount],
                data[i * componentCount + 1],
                data[i * componentCount + 2]
              );
              bbox.extend(v);
            }
            if (bbox.isValid()) {
              primitive.boxMin.set(bbox.minPoint);
              primitive.boxMax.set(bbox.maxPoint);
            }
          }
        } else if (semantic === 'blendIndices') {
          subMeshData.rawBlendIndices = accessor.getNormalizedDeinterlacedView(gltf);
        } else if (semantic === 'blendWeights') {
          subMeshData.rawJointWeights = accessor.getNormalizedDeinterlacedView(gltf);
        }
      }
    }
    return buffer;
  }
  /** @internal */
  private isGLB(data: ArrayBuffer): boolean {
    if (data.byteLength > 12) {
      const p = new Uint32Array(data, 0, 3);
      if (p[0] === 0x46546c67 && p[1] === 2 && p[2] === data.byteLength) {
        return true;
      }
    }
    return false;
  }
  /** @internal */
  private getGLBChunkInfo(
    data: ArrayBuffer,
    offset: number
  ): { start: number; length: number; type: number } {
    const header = new Uint32Array(data, offset, 2);
    const start = offset + 8;
    const length = header[0];
    const type = header[1];
    return { start, length, type };
  }
  /** @internal */
  private getGLBChunkInfos(data: ArrayBuffer): { start: number; length: number; type: number }[] {
    const infos: { start: number; length: number; type: number }[] = [];
    let offset = 12;
    while (offset < data.byteLength) {
      const info = this.getGLBChunkInfo(data, offset);
      infos.push(info);
      offset += info.length + 8;
    }
    return infos;
  }
}
