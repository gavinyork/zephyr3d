import type { DecoderModule } from 'draco3d';
import type { InterpolationMode, TypedArray } from '@zephyr3d/base';
import { Vector3, Vector4, Matrix4x4, Quaternion, Interpolator } from '@zephyr3d/base';
import type {
  AssetHierarchyNode,
  AssetMeshData,
  AssetAnimationData,
  AssetSubMeshData,
  AssetMaterial,
  AssetUnlitMaterial,
  AssetPBRMaterialMR,
  AssetPBRMaterialSG,
  AssetMaterialCommon,
  MaterialTextureInfo,
  AssetPBRMaterialCommon,
  AssetAnimationTrack
} from '../../model';
import { SharedModel, AssetSkeleton, AssetScene } from '../../model';
import { BoundingBox } from '../../../utility/bounding_volume';
import { Primitive } from '../../../render/primitive';
import type { MeshMaterial as M } from '../../../material/meshmaterial';
import { UnlitMaterial } from '../../../material';
import { ComponentType, GLTFAccessor } from './helpers';
import { AbstractModelLoader } from '../loader';
import type {
  PrimitiveType,
  VertexSemantic,
  GPUDataBuffer,
  Texture2D,
  IndexBuffer,
  StructuredBuffer,
  TextureAddressMode,
  TextureFilterMode
} from '@zephyr3d/device';
import type { AssetManager } from '../../assetmanager';
import type { AnimationChannel, AnimationSampler, GlTf, Material, TextureInfo } from './gltf';
import { Application } from '../../../app';
import { PBRMetallicRoughnessMaterial } from '../../../material/pbrmr';
import { PBRSpecularGlossinessMaterial } from '../../../material/pbrsg';
import { DracoMeshDecoder } from '../../../utility/draco/decoder';
import {
  MORPH_TARGET_COLOR,
  MORPH_TARGET_NORMAL,
  MORPH_TARGET_POSITION,
  MORPH_TARGET_TANGENT,
  MORPH_TARGET_TEX0,
  MORPH_TARGET_TEX1,
  MORPH_TARGET_TEX2,
  MORPH_TARGET_TEX3
} from '../../../values';
/** @internal */
export interface GLTFContent extends GlTf {
  _manager: AssetManager;
  _loadedBuffers: ArrayBuffer[];
  _accessors: GLTFAccessor[];
  _bufferCache: Record<string, GPUDataBuffer>;
  _textureCache: Record<string, Texture2D>;
  _materialCache: Record<string, M>;
  _nodes: AssetHierarchyNode[];
  _meshes: AssetMeshData[];
  _dracoModule?: DecoderModule;
}

/**
 * The GLTF/GLB model loader
 * @internal
 */
export class GLTFLoader extends AbstractModelLoader {
  supportExtension(ext: string): boolean {
    return ext === '.gltf' || ext === '.glb';
  }
  supportMIMEType(mimeType: string): boolean {
    return mimeType === 'model/gltf+json' || mimeType === 'model/gltf-binary';
  }
  async load(
    assetManager: AssetManager,
    url: string,
    mimeType: string,
    data: Blob,
    decoderModule?: DecoderModule
  ) {
    const buffer = await data.arrayBuffer();
    if (this.isGLB(buffer)) {
      return this.loadBinary(assetManager, url, buffer, decoderModule);
    }
    const gltf = (await new Response(data).json()) as GLTFContent;
    gltf._manager = assetManager;
    gltf._loadedBuffers = null;
    return this.loadJson(url, gltf, decoderModule);
  }
  async loadBinary(
    assetManager: AssetManager,
    url: string,
    buffer: ArrayBuffer,
    decoderModule?: DecoderModule
  ): Promise<SharedModel> {
    const jsonChunkType = 0x4e4f534a;
    const binaryChunkType = 0x004e4942;
    let gltf: GLTFContent = null;
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
    if (gltf) {
      gltf._manager = assetManager;
      gltf._loadedBuffers = buffers;
      return this.loadJson(url, gltf, decoderModule);
    }
    return null;
  }
  async loadJson(url: string, gltf: GLTFContent, dracoDecoderModule?: DecoderModule): Promise<SharedModel> {
    // check extensions
    if (
      !dracoDecoderModule &&
      gltf.extensionsRequired &&
      gltf.extensionsRequired.indexOf('KHR_draco_mesh_compression') >= 0
    ) {
      console.error('Draco3d is required for loading model');
      return null;
    }
    gltf._dracoModule = dracoDecoderModule;
    gltf._accessors = [];
    gltf._bufferCache = {};
    gltf._textureCache = {};
    gltf._materialCache = {};
    gltf._nodes = [];
    gltf._meshes = [];
    // check asset property
    const asset = gltf.asset;
    if (asset) {
      const gltfVersion = asset.version;
      if (gltfVersion !== '2.0') {
        console.error(`Invalid GLTF version: ${gltfVersion}`);
        return null;
      }
    }
    gltf._baseURI = url.substring(0, url.lastIndexOf('/') + 1);
    if (!gltf._loadedBuffers) {
      gltf._loadedBuffers = [];
      const buffers = gltf.buffers;
      if (buffers) {
        for (const buffer of buffers) {
          const uri = this._normalizeURI(gltf._baseURI, buffer.uri);
          const buf = await gltf._manager.fetchBinaryData(uri);
          // const buf = (await new FileLoader(null, 'arraybuffer').load(uri)) as ArrayBuffer;
          if (buffer.byteLength !== buf.byteLength) {
            console.error(`Invalid GLTF: buffer byte length error.`);
            return null;
          }
          gltf._loadedBuffers.push(buf);
        }
      }
    }
    const accessors = gltf.accessors;
    if (accessors) {
      for (const accessor of gltf.accessors) {
        gltf._accessors.push(new GLTFAccessor(accessor));
      }
    }
    const scenes = gltf.scenes;
    if (scenes) {
      const sharedModel = new SharedModel();
      await this._loadMeshes(gltf, sharedModel);
      this._loadNodes(gltf, sharedModel);
      this._loadSkins(gltf, sharedModel);
      for (let i = 0; i < gltf.nodes?.length; i++) {
        if (typeof gltf.nodes[i].skin === 'number' && gltf.nodes[i].skin >= 0) {
          gltf._nodes[i].skeleton = sharedModel.skeletons[gltf.nodes[i].skin];
        }
      }
      this._loadAnimations(gltf, sharedModel);
      for (const scene of scenes) {
        const assetScene = new AssetScene(scene.name);
        for (const node of scene.nodes) {
          assetScene.rootNodes.push(gltf._nodes[node]);
        }
        sharedModel.scenes.push(assetScene);
      }
      if (typeof gltf.scene === 'number') {
        sharedModel.activeScene = gltf.scene;
      }
      return sharedModel;
    }
    return null;
  }
  /** @internal */
  private _normalizeURI(baseURI: string, uri: string) {
    const s = uri.toLowerCase();
    if (
      s.startsWith('http://') ||
      s.startsWith('https://') ||
      s.startsWith('blob:') ||
      s.startsWith('data:')
    ) {
      // absolute path
      return encodeURI(uri);
    }
    uri = uri.replace(/\.\//g, '');
    uri = decodeURIComponent(uri);
    if (uri[0] === '/') {
      uri = uri.slice(1);
    }
    uri = uri
      .split('/')
      .map((val) => encodeURIComponent(val))
      .join('/');
    return baseURI + uri;
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
        const accessor = gltf._accessors[skinInfo.inverseBindMatrices];
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
  }
  /** @internal */
  private _loadAnimations(gltf: GLTFContent, model: SharedModel) {
    if (gltf.animations) {
      for (let i = 0; i < gltf.animations.length; i++) {
        const animation = this._loadAnimation(gltf, i, model);
        model.addAnimation(animation);
      }
    }
  }
  /** @internal */
  private collectNodes(gltf: GLTFContent): Map<
    AssetHierarchyNode,
    {
      translate: Vector3;
      scale: Vector3;
      rotation: Quaternion;
      worldTransform: Matrix4x4;
    }
  > {
    const collect: Map<
      AssetHierarchyNode,
      {
        translate: Vector3;
        scale: Vector3;
        rotation: Quaternion;
        worldTransform: Matrix4x4;
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
    interpolatorTypes: ('translation' | 'scale' | 'rotation' | 'weights')[];
    interpolators: Interpolator[];
    maxTime: number;
    nodes: Map<
      AssetHierarchyNode,
      {
        translate: Vector3;
        scale: Vector3;
        rotation: Quaternion;
        worldTransform: Matrix4x4;
      }
    >;
  } {
    const animationInfo = gltf.animations[index];
    const name = animationInfo.name || null;
    const channels = animationInfo.channels;
    const samplers = animationInfo.samplers;
    const interpolators = [] as Interpolator[];
    const interpolatorTypes = [] as ('translation' | 'scale' | 'rotation' | 'weights')[];
    const nodes = this.collectNodes(gltf);
    let maxTime = 0;
    for (let i = 0; i < channels.length; i++) {
      const channel = channels[i];
      const sampler = samplers[channel.sampler];
      const input = gltf._accessors[sampler.input].getNormalizedDeinterlacedView(gltf);
      const output = gltf._accessors[sampler.output].getNormalizedDeinterlacedView(gltf);
      const mode: InterpolationMode =
        sampler.interpolation === 'STEP'
          ? 'step'
          : sampler.interpolation === 'CUBICSPLINE'
          ? 'cubicspline'
          : 'linear';
      if (channel.target.path === 'rotation') {
        interpolators.push(new Interpolator(mode, 'quat', input, output));
        interpolatorTypes.push('rotation');
      } else if (channel.target.path === 'translation') {
        interpolators.push(new Interpolator(mode, 'vec3', input, output));
        interpolatorTypes.push('translation');
      } else if (channel.target.path === 'scale') {
        interpolators.push(new Interpolator(mode, 'vec3', input, output));
        interpolatorTypes.push('scale');
      } else if (channel.target.path === 'weights') {
        interpolators.push(new Interpolator(mode, null, input, output));
        interpolatorTypes.push('weights');
      } else {
        continue;
      }
      const max = input[input.length - 1];
      if (max > maxTime) {
        maxTime = max;
      }
    }
    return { name, channels, samplers, interpolators, interpolatorTypes, maxTime, nodes };
  }
  /** @internal */
  private _loadAnimation(gltf: GLTFContent, index: number, model: SharedModel): AssetAnimationData {
    const animationInfo = this.getAnimationInfo(gltf, index);
    const animationData: AssetAnimationData = {
      name: animationInfo.name,
      tracks: [],
      skeletons: [],
      nodes: []
    };
    for (let i = 0; i < animationInfo.channels.length; i++) {
      const targetNode = gltf._nodes[animationInfo.channels[i].target.node];
      const track: AssetAnimationTrack = {
        node: targetNode,
        type: animationInfo.interpolatorTypes[i],
        interpolator: animationInfo.interpolators[i]
      };
      if (track.type === 'weights') {
        track.defaultMorphWeights = targetNode.weights;
      }
      animationData.tracks.push(track);
      if (animationData.nodes.indexOf(targetNode) < 0) {
        animationData.nodes.push(targetNode);
      }
      if (targetNode.skeletonAttached && animationData.skeletons.indexOf(targetNode.skeletonAttached) < 0) {
        animationData.skeletons.push(targetNode.skeletonAttached);
      }
    }
    return animationData;
  }
  /** @internal */
  private _loadNode(
    gltf: GLTFContent,
    nodeIndex: number,
    parent: AssetHierarchyNode,
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
      node = model.addNode(parent, nodeIndex, nodeInfo.name);
      if (typeof nodeInfo.mesh === 'number') {
        node.mesh = gltf._meshes[nodeInfo.mesh];
        node.weights = nodeInfo.weights ?? gltf.meshes[nodeInfo.mesh].weights ?? null;
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
  private async _loadMeshes(gltf: GLTFContent, model: SharedModel) {
    if (gltf.meshes) {
      for (let i = 0; i < gltf.meshes.length; i++) {
        gltf._meshes[i] = await this._loadMesh(gltf, i);
      }
    }
  }
  /** @internal */
  private async _loadMesh(gltf: GLTFContent, meshIndex: number): Promise<AssetMeshData> {
    const meshInfo = gltf.meshes && gltf.meshes[meshIndex];
    let mesh: AssetMeshData = null;
    if (meshInfo) {
      mesh = { subMeshes: [] };
      const primitives = meshInfo.primitives;
      const meshName = meshInfo.name || null;
      if (primitives) {
        for (let i = 0; i < primitives.length; i++) {
          const p = primitives[i];
          const subMeshData: AssetSubMeshData = {
            name: `${meshName}-${i}`,
            primitive: null,
            material: null,
            rawPositions: null,
            rawBlendIndices: null,
            rawJointWeights: null
          };
          const primitive = new Primitive();
          const attributes = p.attributes;
          const dracoExtension = gltf._dracoModule ? p.extensions?.['KHR_draco_mesh_compression'] : null;
          let dracoMeshDecoder: DracoMeshDecoder = null;
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
              gltf._dracoModule
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
              dracoMeshDecoder
            );
          }
          if (p.targets) {
            if (Application.instance.device.type === 'webgl') {
              // Emulate vertexID for WebGL1 device
              if (attributes['TEXCOORD_7'] !== undefined) {
                console.error(`Could not load morph target animation`);
                p.targets = null;
              } else {
                const vertexIndices = new Float32Array(primitive.getNumVertices());
                for (let i = 0; i < vertexIndices.length; i++) {
                  vertexIndices[i] = i;
                }
                const vertexIndexBuffer = Application.instance.device.createVertexBuffer(
                  'tex7_f32',
                  vertexIndices
                );
                primitive.setVertexBuffer(vertexIndexBuffer);
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
                const t = targetMap[k];
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
            subMeshData.targets = targets;
            subMeshData.targetBox = targetBox;
            subMeshData.morphAttribCount = morphAttribSet.size;
          }
          const indices = p.indices;
          if (typeof indices === 'number') {
            this._loadIndexBuffer(gltf, indices, primitive, subMeshData, dracoExtension, dracoMeshDecoder);
          }
          let primitiveType = p.mode;
          if (typeof primitiveType !== 'number') {
            primitiveType = 4;
          }
          primitive.primitiveType = this._primitiveType(primitiveType);
          const hasVertexNormal = !!primitive.getVertexBuffer('normal');
          const hasVertexColor = !!primitive.getVertexBuffer('diffuse');
          const hasVertexTangent = !!primitive.getVertexBuffer('tangent');
          const materialHash = `${p.material}.${Number(hasVertexNormal)}.${Number(hasVertexColor)}.${Number(
            hasVertexTangent
          )}`;
          let material = gltf._materialCache[materialHash];
          if (!material) {
            const materialInfo = p.material !== undefined ? gltf.materials[p.material] : null;
            material = await this._loadMaterial(
              gltf,
              materialInfo,
              hasVertexColor,
              hasVertexNormal,
              hasVertexTangent
            );
            gltf._materialCache[materialHash] = material;
          }
          subMeshData.primitive = primitive;
          subMeshData.material = material;
          mesh.subMeshes.push(subMeshData);
        }
      }
    }
    return mesh;
  }
  private async _createMaterial(assetManager: AssetManager, assetMaterial: AssetMaterial): Promise<M> {
    if (assetMaterial.type === 'unlit') {
      const unlitAssetMaterial = assetMaterial as AssetUnlitMaterial;
      const unlitMaterial = new UnlitMaterial(); //new NewLambertMaterial();// new TestLitMaterial();// new UnlitMaterial();
      unlitMaterial.albedoColor = unlitAssetMaterial.diffuse ?? Vector4.one();
      if (unlitAssetMaterial.diffuseMap) {
        unlitMaterial.albedoTexture = unlitAssetMaterial.diffuseMap.texture;
        unlitMaterial.albedoTextureSampler = unlitAssetMaterial.diffuseMap.sampler;
        unlitMaterial.albedoTexCoordIndex = unlitAssetMaterial.diffuseMap.texCoord;
        unlitMaterial.albedoTexCoordMatrix = unlitAssetMaterial.diffuseMap.transform;
      }
      unlitMaterial.vertexColor = unlitAssetMaterial.common.vertexColor;
      if (assetMaterial.common.alphaMode === 'blend') {
        unlitMaterial.blendMode = 'blend';
      } else if (assetMaterial.common.alphaMode === 'mask') {
        unlitMaterial.alphaCutoff = assetMaterial.common.alphaCutoff;
      }
      if (assetMaterial.common.doubleSided) {
        unlitMaterial.cullMode = 'none';
      }
      return unlitMaterial;
    } else if (assetMaterial.type === 'pbrSpecularGlossiness') {
      const assetPBRMaterial = assetMaterial as AssetPBRMaterialSG;
      const pbrMaterial = new PBRSpecularGlossinessMaterial();
      pbrMaterial.ior = assetPBRMaterial.ior;
      pbrMaterial.albedoColor = assetPBRMaterial.diffuse;
      pbrMaterial.specularFactor = new Vector4(
        assetPBRMaterial.specular.x,
        assetPBRMaterial.specular.y,
        assetPBRMaterial.specular.z,
        1
      );
      pbrMaterial.glossinessFactor = assetPBRMaterial.glossness;
      if (assetPBRMaterial.diffuseMap) {
        pbrMaterial.albedoTexture = assetPBRMaterial.diffuseMap.texture;
        pbrMaterial.albedoTextureSampler = assetPBRMaterial.diffuseMap.sampler;
        pbrMaterial.albedoTexCoordIndex = assetPBRMaterial.diffuseMap.texCoord;
        pbrMaterial.albedoTexCoordMatrix = assetPBRMaterial.diffuseMap.transform;
      }
      if (assetPBRMaterial.common.normalMap) {
        pbrMaterial.normalTexture = assetPBRMaterial.common.normalMap.texture;
        pbrMaterial.normalTextureSampler = assetPBRMaterial.common.normalMap.sampler;
        pbrMaterial.normalTexCoordIndex = assetPBRMaterial.common.normalMap.texCoord;
        pbrMaterial.normalTexCoordMatrix = assetPBRMaterial.common.normalMap.transform;
      }
      pbrMaterial.normalScale = assetPBRMaterial.common.bumpScale;
      if (assetPBRMaterial.common.emissiveMap) {
        pbrMaterial.emissiveTexture = assetPBRMaterial.common.emissiveMap.texture;
        pbrMaterial.emissiveTextureSampler = assetPBRMaterial.common.emissiveMap.sampler;
        pbrMaterial.emissiveTexCoordIndex = assetPBRMaterial.common.emissiveMap.texCoord;
        pbrMaterial.emissiveTexCoordMatrix = assetPBRMaterial.common.emissiveMap.transform;
      }
      pbrMaterial.emissiveColor = assetPBRMaterial.common.emissiveColor;
      pbrMaterial.emissiveStrength = assetPBRMaterial.common.emissiveStrength;
      if (assetPBRMaterial.common.occlusionMap) {
        pbrMaterial.occlusionTexture = assetPBRMaterial.common.occlusionMap.texture;
        pbrMaterial.occlusionTextureSampler = assetPBRMaterial.common.occlusionMap.sampler;
        pbrMaterial.occlusionTexCoordIndex = assetPBRMaterial.common.occlusionMap.texCoord;
        pbrMaterial.occlusionTexCoordMatrix = assetPBRMaterial.common.occlusionMap.transform;
      }
      pbrMaterial.occlusionStrength = assetPBRMaterial.common.occlusionStrength;
      if (assetPBRMaterial.specularGlossnessMap) {
        pbrMaterial.specularTexture = assetPBRMaterial.specularGlossnessMap.texture;
        pbrMaterial.specularTextureSampler = assetPBRMaterial.specularGlossnessMap.sampler;
        pbrMaterial.specularTexCoordIndex = assetPBRMaterial.specularGlossnessMap.texCoord;
        pbrMaterial.specularTexCoordMatrix = assetPBRMaterial.specularGlossnessMap.transform;
      }
      pbrMaterial.vertexTangent = assetPBRMaterial.common.useTangent;
      pbrMaterial.vertexColor = assetPBRMaterial.common.vertexColor;
      if (assetPBRMaterial.common.alphaMode === 'blend') {
        pbrMaterial.blendMode = 'blend';
      } else if (assetPBRMaterial.common.alphaMode === 'mask') {
        pbrMaterial.alphaCutoff = assetPBRMaterial.common.alphaCutoff;
      }
      if (assetPBRMaterial.common.doubleSided) {
        pbrMaterial.cullMode = 'none';
      }
      pbrMaterial.vertexNormal = !!assetMaterial.common.vertexNormal;
      return pbrMaterial;
    } else if (assetMaterial.type === 'pbrMetallicRoughness') {
      const assetPBRMaterial = assetMaterial as AssetPBRMaterialMR;
      const pbrMaterial = new PBRMetallicRoughnessMaterial();
      pbrMaterial.ior = assetPBRMaterial.ior;
      pbrMaterial.albedoColor = assetPBRMaterial.diffuse;
      pbrMaterial.metallic = assetPBRMaterial.metallic;
      pbrMaterial.roughness = assetPBRMaterial.roughness;
      if (assetPBRMaterial.diffuseMap) {
        pbrMaterial.albedoTexture = assetPBRMaterial.diffuseMap.texture;
        pbrMaterial.albedoTextureSampler = assetPBRMaterial.diffuseMap.sampler;
        pbrMaterial.albedoTexCoordIndex = assetPBRMaterial.diffuseMap.texCoord;
        pbrMaterial.albedoTexCoordMatrix = assetPBRMaterial.diffuseMap.transform;
      }
      if (assetPBRMaterial.common.normalMap) {
        pbrMaterial.normalTexture = assetPBRMaterial.common.normalMap.texture;
        pbrMaterial.normalTextureSampler = assetPBRMaterial.common.normalMap.sampler;
        pbrMaterial.normalTexCoordIndex = assetPBRMaterial.common.normalMap.texCoord;
        pbrMaterial.normalTexCoordMatrix = assetPBRMaterial.common.normalMap.transform;
      }
      pbrMaterial.normalScale = assetPBRMaterial.common.bumpScale;
      if (assetPBRMaterial.common.emissiveMap) {
        pbrMaterial.emissiveTexture = assetPBRMaterial.common.emissiveMap.texture;
        pbrMaterial.emissiveTextureSampler = assetPBRMaterial.common.emissiveMap.sampler;
        pbrMaterial.emissiveTexCoordIndex = assetPBRMaterial.common.emissiveMap.texCoord;
        pbrMaterial.emissiveTexCoordMatrix = assetPBRMaterial.common.emissiveMap.transform;
      }
      pbrMaterial.emissiveColor = assetPBRMaterial.common.emissiveColor;
      pbrMaterial.emissiveStrength = assetPBRMaterial.common.emissiveStrength;
      if (assetPBRMaterial.common.occlusionMap) {
        pbrMaterial.occlusionTexture = assetPBRMaterial.common.occlusionMap.texture;
        pbrMaterial.occlusionTextureSampler = assetPBRMaterial.common.occlusionMap.sampler;
        pbrMaterial.occlusionTexCoordIndex = assetPBRMaterial.common.occlusionMap.texCoord;
        pbrMaterial.occlusionTexCoordMatrix = assetPBRMaterial.common.occlusionMap.transform;
        pbrMaterial.occlusionStrength = assetPBRMaterial.common.occlusionStrength;
      }
      if (assetPBRMaterial.metallicMap) {
        pbrMaterial.metallicRoughnessTexture = assetPBRMaterial.metallicMap.texture;
        pbrMaterial.metallicRoughnessTextureSampler = assetPBRMaterial.metallicMap.sampler;
        pbrMaterial.metallicRoughnessTexCoordIndex = assetPBRMaterial.metallicMap.texCoord;
        pbrMaterial.metallicRoughnessTexCoordMatrix = assetPBRMaterial.metallicMap.transform;
      }
      pbrMaterial.specularFactor = assetPBRMaterial.specularFactor;
      if (assetPBRMaterial.specularMap) {
        pbrMaterial.specularTexture = assetPBRMaterial.specularMap.texture;
        pbrMaterial.specularTextureSampler = assetPBRMaterial.specularMap.sampler;
        pbrMaterial.specularTexCoordIndex = assetPBRMaterial.specularMap.texCoord;
        pbrMaterial.specularTexCoordMatrix = assetPBRMaterial.specularMap.transform;
      }
      if (assetPBRMaterial.specularColorMap) {
        pbrMaterial.specularColorTexture = assetPBRMaterial.specularColorMap.texture;
        pbrMaterial.specularColorTextureSampler = assetPBRMaterial.specularColorMap.sampler;
        pbrMaterial.specularColorTexCoordIndex = assetPBRMaterial.specularColorMap.texCoord;
        pbrMaterial.specularColorTexCoordMatrix = assetPBRMaterial.specularColorMap.transform;
      }
      if (assetPBRMaterial.sheen) {
        const sheen = assetPBRMaterial.sheen;
        pbrMaterial.sheen = true;
        pbrMaterial.sheenColorFactor = sheen.sheenColorFactor;
        pbrMaterial.sheenRoughnessFactor = sheen.sheenRoughnessFactor;
        if (sheen.sheenColorMap) {
          pbrMaterial.sheenColorTexture = sheen.sheenColorMap.texture;
          pbrMaterial.sheenColorTextureSampler = sheen.sheenColorMap.sampler;
          pbrMaterial.sheenColorTexCoordIndex = sheen.sheenColorMap.texCoord;
          pbrMaterial.sheenColorTexCoordMatrix = sheen.sheenColorMap.transform;
        }
        if (sheen.sheenRoughnessMap) {
          pbrMaterial.sheenRoughnessTexture = sheen.sheenRoughnessMap.texture;
          pbrMaterial.sheenRoughnessTextureSampler = sheen.sheenRoughnessMap.sampler;
          pbrMaterial.sheenRoughnessTexCoordIndex = sheen.sheenRoughnessMap.texCoord;
          pbrMaterial.sheenRoughnessTexCoordMatrix = sheen.sheenRoughnessMap.transform;
        }
      }
      if (assetPBRMaterial.transmission) {
        const transmission = assetPBRMaterial.transmission;
        pbrMaterial.transmission = true;
        pbrMaterial.transmissionFactor = transmission.transmissionFactor;
        if (transmission.transmissionMap) {
          pbrMaterial.transmissionTexture = transmission.transmissionMap.texture;
          pbrMaterial.transmissionTextureSampler = transmission.transmissionMap.sampler;
          pbrMaterial.transmissionTexCoordIndex = transmission.transmissionMap.texCoord;
          pbrMaterial.transmissionTexCoordMatrix = transmission.transmissionMap.transform;
        }
        pbrMaterial.thicknessFactor = transmission.thicknessFactor;
        if (transmission.thicknessMap) {
          pbrMaterial.thicknessTexture = transmission.thicknessMap.texture;
          pbrMaterial.thicknessTextureSampler = transmission.thicknessMap.sampler;
          pbrMaterial.thicknessTexCoordIndex = transmission.thicknessMap.texCoord;
          pbrMaterial.thicknessTexCoordMatrix = transmission.thicknessMap.transform;
        }
        pbrMaterial.attenuationDistance = transmission.attenuationDistance;
        pbrMaterial.attenuationColor = transmission.attenuationColor;
      }
      if (assetPBRMaterial.clearcoat) {
        const cc = assetPBRMaterial.clearcoat;
        pbrMaterial.clearcoat = true;
        pbrMaterial.clearcoatIntensity = cc.clearCoatFactor;
        pbrMaterial.clearcoatRoughnessFactor = cc.clearCoatRoughnessFactor;
        if (cc.clearCoatIntensityMap) {
          pbrMaterial.clearcoatIntensityTexture = cc.clearCoatIntensityMap.texture;
          pbrMaterial.clearcoatIntensityTextureSampler = cc.clearCoatIntensityMap.sampler;
          pbrMaterial.clearcoatIntensityTexCoordIndex = cc.clearCoatIntensityMap.texCoord;
          pbrMaterial.clearcoatIntensityTexCoordMatrix = cc.clearCoatIntensityMap.transform;
        }
        if (cc.clearCoatRoughnessMap) {
          pbrMaterial.clearcoatRoughnessTexture = cc.clearCoatRoughnessMap.texture;
          pbrMaterial.clearcoatRoughnessTextureSampler = cc.clearCoatRoughnessMap.sampler;
          pbrMaterial.clearcoatRoughnessTexCoordIndex = cc.clearCoatRoughnessMap.texCoord;
          pbrMaterial.clearcoatRoughnessTexCoordMatrix = cc.clearCoatRoughnessMap.transform;
        }
        if (cc.clearCoatNormalMap) {
          pbrMaterial.clearcoatNormalTexture = cc.clearCoatNormalMap.texture;
          pbrMaterial.clearcoatNormalTextureSampler = cc.clearCoatNormalMap.sampler;
          pbrMaterial.clearcoatNormalTexCoordIndex = cc.clearCoatNormalMap.texCoord;
          pbrMaterial.clearcoatNormalTexCoordMatrix = cc.clearCoatNormalMap.transform;
        }
      }
      pbrMaterial.vertexTangent = assetPBRMaterial.common.useTangent;
      pbrMaterial.vertexColor = assetPBRMaterial.common.vertexColor;
      if (assetPBRMaterial.common.alphaMode === 'blend') {
        pbrMaterial.blendMode = 'blend';
      } else if (assetPBRMaterial.common.alphaMode === 'mask') {
        pbrMaterial.alphaCutoff = assetPBRMaterial.common.alphaCutoff;
      }
      if (assetPBRMaterial.common.doubleSided) {
        pbrMaterial.cullMode = 'none';
      }
      pbrMaterial.vertexNormal = !!assetMaterial.common.vertexNormal;
      return pbrMaterial;
    }
  }
  /** @internal */
  private async _loadMaterial(
    gltf: GLTFContent,
    materialInfo: Material,
    vertexColor: boolean,
    vertexNormal: boolean,
    useTangent: boolean
  ): Promise<M> {
    let assetMaterial: AssetMaterial = null;
    let pbrMetallicRoughness: AssetPBRMaterialMR = null;
    let pbrSpecularGlossness: AssetPBRMaterialSG = null;
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
    if (materialInfo?.pbrMetallicRoughness || materialInfo?.extensions?.KHR_materials_pbrSpecularGlossiness) {
      pbrCommon.normalMap = materialInfo.normalTexture
        ? await this._loadTexture(gltf, materialInfo.normalTexture, false)
        : null;
      pbrCommon.bumpScale = materialInfo.normalTexture?.scale ?? 1;
      pbrCommon.occlusionMap = materialInfo.occlusionTexture
        ? await this._loadTexture(gltf, materialInfo.occlusionTexture, false)
        : null;
      pbrCommon.occlusionStrength = materialInfo.occlusionTexture?.strength ?? 1;
      pbrCommon.emissiveMap = materialInfo.emissiveTexture
        ? await this._loadTexture(gltf, materialInfo.emissiveTexture, false)
        : null;
      pbrCommon.emissiveStrength =
        materialInfo?.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1;
      pbrCommon.emissiveColor = materialInfo.emissiveFactor
        ? new Vector3(materialInfo.emissiveFactor)
        : Vector3.zero();
    }
    if (materialInfo?.pbrMetallicRoughness) {
      pbrMetallicRoughness = {
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
        ? await this._loadTexture(gltf, materialInfo.pbrMetallicRoughness.baseColorTexture, true)
        : null;
      pbrMetallicRoughness.metallicMap = materialInfo.pbrMetallicRoughness.metallicRoughnessTexture
        ? await this._loadTexture(gltf, materialInfo.pbrMetallicRoughness.metallicRoughnessTexture, false)
        : null;
      pbrMetallicRoughness.metallicIndex = 2;
      pbrMetallicRoughness.roughnessIndex = 1;
    }
    if (materialInfo?.extensions?.KHR_materials_pbrSpecularGlossiness) {
      const sg = materialInfo.extensions?.KHR_materials_pbrSpecularGlossiness;
      pbrSpecularGlossness = {
        type: 'pbrSpecularGlossiness',
        ior: 1.5,
        common: pbrCommon
      };
      pbrSpecularGlossness.diffuse = new Vector4(sg.diffuseFactor ?? [1, 1, 1, 1]);
      pbrSpecularGlossness.specular = new Vector3(sg.specularFactor ?? [1, 1, 1]);
      pbrSpecularGlossness.glossness = sg.glossnessFactor ?? 1;
      pbrSpecularGlossness.diffuseMap = sg.diffuseTexture
        ? await this._loadTexture(gltf, sg.diffuseTexture, true)
        : null;
      pbrSpecularGlossness.specularGlossnessMap = sg.specularGlossinessTexture
        ? await this._loadTexture(gltf, sg.specularGlossinessTexture, true)
        : null;
    }
    assetMaterial = pbrSpecularGlossness || pbrMetallicRoughness;
    if (!assetMaterial || materialInfo?.extensions?.KHR_materials_unlit) {
      if (materialInfo?.extensions?.KHR_materials_unlit) {
        assetMaterial = {
          type: 'unlit',
          common: pbrCommon,
          diffuse: pbrMetallicRoughness?.diffuse ?? Vector4.one(),
          diffuseMap: pbrMetallicRoughness?.diffuseMap ?? null
        } as AssetUnlitMaterial;
      } else {
        assetMaterial = {
          type: 'pbrMetallicRoughness',
          common: pbrCommon,
          diffuse: Vector4.one(),
          metallic: 1,
          roughness: 1,
          diffuseMap: null,
          metallicMap: null,
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
        ? await this._loadTexture(gltf, materialInfo.extensions.KHR_materials_specular.specularTexture, false)
        : null;
      pbrMetallicRoughness.specularColorMap = materialInfo?.extensions?.KHR_materials_specular
        ?.specularColorTexture
        ? await this._loadTexture(
            gltf,
            materialInfo.extensions.KHR_materials_specular.specularColorTexture,
            true
          )
        : null;
      // KHR_material_transmission
      const transmission = materialInfo?.extensions?.KHR_materials_transmission;
      if (transmission) {
        pbrMetallicRoughness.transmission = {
          transmissionFactor: transmission.transmissionFactor ?? 0,
          transmissionMap: transmission.transmissionTexture
            ? await this._loadTexture(gltf, transmission.transmissionTexture, false)
            : null,
          thicknessFactor: 0,
          thicknessMap: null,
          attenuationDistance: 99999,
          attenuationColor: Vector3.one()
        };
        const volume = materialInfo?.extensions?.KHR_materials_volume;
        if (volume) {
          pbrMetallicRoughness.transmission.thicknessFactor = volume.thicknessFactor ?? 0;
          pbrMetallicRoughness.transmission.thicknessMap = volume.thicknessTexture
            ? await this._loadTexture(gltf, volume.thicknessTexture, false)
            : null;
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
            ? await this._loadTexture(gltf, sheen.sheenColorTexture, true)
            : null,
          sheenRoughnessFactor: sheen.sheenRoughnessFactor ?? 0,
          sheenRoughnessMap: sheen.sheenRoughnessTexture
            ? await this._loadTexture(gltf, sheen.sheenRoughnessTexture, true)
            : null
        };
      }
      // KHR_materials_clearcoat
      const cc = materialInfo?.extensions?.KHR_materials_clearcoat;
      if (cc) {
        pbrMetallicRoughness.clearcoat = {
          clearCoatFactor: cc.clearcoatFactor ?? 0,
          clearCoatIntensityMap: cc.clearcoatTexture
            ? await this._loadTexture(gltf, cc.clearcoatTexture, false)
            : null,
          clearCoatRoughnessFactor: cc.clearcoatRoughnessFactor ?? 0,
          clearCoatRoughnessMap: cc.clearcoatRoughnessTexture
            ? await this._loadTexture(gltf, cc.clearcoatRoughnessTexture, false)
            : null,
          clearCoatNormalMap: cc.clearcoatNormalTexture
            ? await this._loadTexture(gltf, cc.clearcoatNormalTexture, false)
            : null
        };
      }
    }
    return await this._createMaterial(gltf._manager, assetMaterial);
  }
  /** @internal */
  private async _loadTexture(
    gltf: GLTFContent,
    info: Partial<TextureInfo>,
    sRGB: boolean
  ): Promise<MaterialTextureInfo> {
    const mt: MaterialTextureInfo = {
      texture: null,
      sampler: null,
      texCoord: info.texCoord ?? 0,
      transform: null
    };
    const textureInfo = gltf.textures[info.index];
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
      let wrapS: TextureAddressMode = 'repeat';
      let wrapT: TextureAddressMode = 'repeat';
      let magFilter: TextureFilterMode = 'linear';
      let minFilter: TextureFilterMode = 'linear';
      let mipFilter: TextureFilterMode = 'linear';
      const samplerIndex: number = textureInfo.sampler;
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
      const imageIndex: number = textureInfo.source;
      const hash = `${imageIndex}:${!!sRGB}:${wrapS}:${wrapT}:${minFilter}:${magFilter}:${mipFilter}`;
      mt.texture = gltf._textureCache[hash];
      if (!mt.texture) {
        const image = gltf.images[imageIndex];
        if (image) {
          if (image.uri) {
            const imageUrl = this._normalizeURI(gltf._baseURI, image.uri);
            mt.texture = await gltf._manager.fetchTexture(imageUrl, { linearColorSpace: !sRGB });
            mt.texture.name = imageUrl;
          } else if (typeof image.bufferView === 'number' && image.mimeType) {
            const bufferView = gltf.bufferViews && gltf.bufferViews[image.bufferView];
            if (bufferView) {
              const arrayBuffer = gltf._loadedBuffers && gltf._loadedBuffers[bufferView.buffer];
              if (arrayBuffer) {
                const view = new Uint8Array(arrayBuffer, bufferView.byteOffset || 0, bufferView.byteLength);
                const mimeType = image.mimeType;
                const blob = new Blob([view], { type: mimeType });
                const sourceURI = URL.createObjectURL(blob);
                mt.texture = await gltf._manager.fetchTexture(sourceURI, {
                  mimeType,
                  linearColorSpace: !sRGB
                });
                URL.revokeObjectURL(sourceURI);
              }
            }
          }
        }
        if (mt.texture) {
          gltf._textureCache[hash] = mt.texture;
        }
      }
      if (mt.texture) {
        mt.sampler = Application.instance.device.createSampler({
          addressU: wrapS,
          addressV: wrapT,
          magFilter: magFilter,
          minFilter: minFilter,
          mipFilter: mipFilter
        });
      }
    }
    return mt;
  }
  /** @internal */
  private _primitiveType(type: number): PrimitiveType {
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
    primitive: Primitive,
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
      gltf._loadedBuffers.push(indices.buffer);
      if (!gltf.bufferViews) {
        gltf.bufferViews = [];
      }
      gltf.bufferViews.push({
        buffer: gltf._loadedBuffers.length - 1,
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
    primitive: Primitive,
    subMeshData: AssetSubMeshData,
    dracoExtension?: any,
    dracoMeshDecoder?: DracoMeshDecoder
  ) {
    const dracoId = dracoExtension?.attributes?.[attribName];
    if (dracoId !== undefined) {
      const accessor = gltf._accessors[accessorIndex];
      let buffer: TypedArray = null;
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
      if (!dracoMeshDecoder.getAttributeBuffer(dracoId, buffer)) {
        throw new Error(`Decode draco mesh failed`);
      }
      gltf._loadedBuffers.push(buffer.buffer);
      if (!gltf.bufferViews) {
        gltf.bufferViews = [];
      }
      gltf.bufferViews.push({
        buffer: gltf._loadedBuffers.length - 1,
        byteOffset: 0,
        byteLength: buffer.byteLength
      });
      accessor.bufferView = gltf.bufferViews.length - 1;
    }
    let semantic: VertexSemantic = null;
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
    primitive: Primitive,
    semantic: VertexSemantic,
    subMeshData: AssetSubMeshData
  ) {
    const device = Application.instance.device;
    const accessor = gltf._accessors[accessorIndex];
    const componentCount = accessor.getComponentCount(accessor.type);
    const normalized = !!accessor.normalized;
    const hash = `${accessorIndex}:${semantic || ''}:${Number(normalized)}`;
    let buffer = gltf._bufferCache[hash];
    if (!buffer) {
      let data = accessor.getNormalizedDeinterlacedView(gltf);
      if (semantic && !(data instanceof Float32Array)) {
        const floatData = new Float32Array(data.length);
        floatData.set(data);
        data = floatData;
      }
      if (!semantic) {
        if (
          !(data instanceof Uint8Array) &&
          !(data instanceof Uint16Array) &&
          !(data instanceof Uint32Array)
        ) {
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
        buffer = device.createIndexBuffer(data as Uint16Array | Uint32Array, { managed: true });
      } else {
        const attribFormat = device.getVertexAttribFormat(semantic, 'f32', componentCount);
        buffer = device.createVertexBuffer(attribFormat, data);
      }
      gltf._bufferCache[hash] = buffer;
    }
    if (buffer) {
      if (!semantic) {
        primitive.setIndexBuffer(buffer as IndexBuffer);
        primitive.indexCount = (buffer as IndexBuffer).length;
      } else {
        primitive.setVertexBuffer(buffer as StructuredBuffer);
        if (semantic === 'position') {
          if (!primitive.getIndexBuffer()) {
            primitive.indexCount = Math.floor(buffer.byteLength / 12);
          }
          const data = accessor.getNormalizedDeinterlacedView(gltf);
          subMeshData.rawPositions = data as Float32Array;
          const min = accessor.min;
          const max = accessor.max;
          if (min && max) {
            primitive.setBoundingVolume(new BoundingBox(new Vector3(min), new Vector3(max)));
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
              primitive.setBoundingVolume(bbox);
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
