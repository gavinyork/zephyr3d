import { BaseGraphNode } from '../node';
import { getParamName } from '../common';
import type {
  Texture2D,
  Texture2DArray,
  TextureAddressMode,
  TextureCube,
  TextureFilterMode
} from '@zephyr3d/device';
import { DRef } from '@zephyr3d/base';
import { getDevice } from '../../../app/api';
import type { PropertyAccessor, SerializableClass } from '../../serialization';

/**
 * Default 1x1 white 2D texture reference
 * @internal
 */
const defaultTexture2D: DRef<Texture2D> = new DRef();

/**
 * Default 1x1 white cubemap texture reference
 * @internal
 */
const defaultTextureCube: DRef<TextureCube> = new DRef();

/**
 * Default 1x1 white 2D array texture reference
 * @internal
 */
const defaultTexture2DArray: DRef<Texture2DArray> = new DRef();

/**
 * Gets or creates the default 2D texture
 *
 * @remarks
 * Returns a 1x1 white (255, 255, 255, 255) texture used as a fallback
 * when no texture is assigned to a texture node.
 *
 * @returns A 1x1 white Texture2D instance
 *
 * @internal
 */
export function getDefaultTexture2D(): Texture2D {
  if (!defaultTexture2D.get()) {
    const defaultTex = getDevice().createTexture2D('rgba8unorm', 1, 1, {
      mipmapping: false
    });
    defaultTex.update(new Uint8Array([255, 255, 255, 255]), 0, 0, 1, 1);
    defaultTexture2D.set(defaultTex);
  }
  return defaultTexture2D.get();
}

/**
 * Gets or creates the default 2D array texture
 *
 * @remarks
 * Returns a 1x1x1 white (255, 255, 255, 255) array texture used as a fallback
 * when no texture is assigned to a 2D array texture node.
 *
 * @returns A 1x1x1 white Texture2DArray instance
 *
 * @internal
 */
export function getDefaultTexture2DArray(): Texture2DArray {
  if (!defaultTexture2DArray.get()) {
    const defaultTex = getDevice().createTexture2DArray('rgba8unorm', 1, 1, 1, {
      mipmapping: false
    });
    defaultTex.update(new Uint8Array([255, 255, 255, 255]), 0, 0, 0, 1, 1, 1);
    defaultTexture2DArray.set(defaultTex);
  }
  return defaultTexture2DArray.get();
}

/**
 * Gets or creates the default cubemap texture
 *
 * @remarks
 * Returns a 1x1 white (255, 255, 255, 255) cubemap texture (all 6 faces white)
 * used as a fallback when no texture is assigned to a cubemap texture node.
 *
 * @returns A 1x1 white TextureCube instance
 *
 * @internal
 */
export function getDefaultTextureCube(): TextureCube {
  if (!defaultTextureCube.get()) {
    const defaultTex = getDevice().createCubeTexture('rgba8unorm', 1, {
      mipmapping: false
    });
    for (let i = 0; i < 6; i++) {
      defaultTex.update(new Uint8Array([255, 255, 255, 255]), 0, 0, 1, 1, i);
    }
    defaultTextureCube.set(defaultTex);
  }
  return defaultTextureCube.get();
}

/**
 * Common property descriptors for texture nodes
 *
 * @remarks
 * Defines serialization properties shared by all texture node types:
 * - Name: Shader parameter name for the texture uniform
 * - sRGB: Whether texture should be loaded into sRGB color space
 * - AddressU: Horizontal texture wrapping mode
 * - AddressV: Vertical texture wrapping mode
 * - MinFilter: Minification filter mode
 * - MagFilter: Magnification filter mode
 * - MipFilter: Mipmap filter mode
 *
 * @internal
 */
const textureNodeProps = (function getTextureNodeProps(): PropertyAccessor<BaseTextureNode>[] {
  return [
    {
      name: 'Name',
      type: 'string',
      isNullable() {
        return false;
      },
      get(this: BaseTextureNode, value) {
        value.str[0] = this.paramName;
      },
      set(this: BaseTextureNode, value) {
        this.paramName = value.str[0];
      }
    },
    {
      name: 'sRGB',
      type: 'bool',
      default: true,
      get(this: BaseTextureNode, value) {
        value.bool[0] = this.sRGB;
      },
      set(this: BaseTextureNode, value) {
        this.sRGB = value.bool[0];
      }
    },
    {
      name: 'AddressU',
      type: 'string',
      default: 'clamp',
      options: {
        enum: {
          labels: ['clamp', 'repeat', 'mirrored-repeat'],
          values: ['clamp', 'repeat', 'mirrored-repeat']
        }
      },
      isNullable() {
        return false;
      },
      get(this: BaseTextureNode, value) {
        value.str[0] = this.addressU;
      },
      set(this: BaseTextureNode, value) {
        this.addressU = value.str[0] as TextureAddressMode;
      }
    },
    {
      name: 'AddressV',
      type: 'string',
      default: 'clamp',
      options: {
        enum: {
          labels: ['clamp', 'repeat', 'mirrored-repeat'],
          values: ['clamp', 'repeat', 'mirrored-repeat']
        }
      },
      isNullable() {
        return false;
      },
      get(this: BaseTextureNode, value) {
        value.str[0] = this.addressV;
      },
      set(this: BaseTextureNode, value) {
        this.addressV = value.str[0] as TextureAddressMode;
      }
    },
    {
      name: 'MinFilter',
      type: 'string',
      default: 'linear',
      options: {
        enum: {
          labels: ['nearest', 'linear'],
          values: ['nearest', 'linear']
        }
      },
      isNullable() {
        return false;
      },
      get(this: BaseTextureNode, value) {
        value.str[0] = this.filterMin;
      },
      set(this: BaseTextureNode, value) {
        this.filterMin = value.str[0] as TextureFilterMode;
      }
    },
    {
      name: 'MagFilter',
      type: 'string',
      default: 'linear',
      options: {
        enum: {
          labels: ['nearest', 'linear'],
          values: ['nearest', 'linear']
        }
      },
      isNullable() {
        return false;
      },
      get(this: BaseTextureNode, value) {
        value.str[0] = this.filterMag;
      },
      set(this: BaseTextureNode, value) {
        this.filterMag = value.str[0] as TextureFilterMode;
      }
    },
    {
      name: 'MipFilter',
      type: 'string',
      default: 'nearest',
      options: {
        enum: {
          labels: ['nearest', 'linear', 'none'],
          values: ['nearest', 'linear', 'none']
        }
      },
      isNullable() {
        return false;
      },
      get(this: BaseTextureNode, value) {
        value.str[0] = this.filterMip;
      },
      set(this: BaseTextureNode, value) {
        this.filterMip = value.str[0] as TextureFilterMode;
      }
    }
  ];
})();

/**
 * Abstract base class for texture nodes
 *
 * @remarks
 * Provides common functionality for all texture types in the material node graph.
 * Texture nodes represent shader texture uniforms and their sampling parameters.
 *
 * Common properties:
 * - **paramName**: The shader uniform name for this texture
 * - **addressU/V**: Texture coordinate wrapping modes (clamp, repeat, mirrored-repeat)
 * - **filterMin**: Minification filter (nearest, linear)
 * - **filterMag**: Magnification filter (nearest, linear)
 * - **filterMip**: Mipmap filter (nearest, linear, none)
 * - **texture**: Reference to the actual GPU texture resource
 * - **textureId**: Asset ID for serialization/loading
 *
 * Texture addressing modes:
 * - **clamp**: Coordinates outside [0,1] are clamped to edge colors
 * - **repeat**: Texture tiles infinitely (wraps around)
 * - **mirrored-repeat**: Texture tiles with alternating mirroring
 *
 * Filtering modes:
 * - **nearest**: Point sampling (sharp, pixelated)
 * - **linear**: Bilinear interpolation (smooth)
 * - **none**: No mipmap filtering (mip filter only)
 *
 * @typeParam T - The specific texture type (Texture2D, TextureCube, etc.)
 *
 * @public
 */
export abstract class BaseTextureNode extends BaseGraphNode {
  /** The shader parameter name for this texture uniform */
  private _paramName: string;
  /** Whether this texture should be loaded in sRGB color space */
  sRGB: boolean;
  /** Horizontal texture coordinate wrapping mode */
  addressU: TextureAddressMode;
  /** Vertical texture coordinate wrapping mode */
  addressV: TextureAddressMode;
  /** Minification filter mode */
  filterMin: TextureFilterMode;
  /** Magnification filter mode */
  filterMag: TextureFilterMode;
  /** Mipmap filter mode */
  filterMip: TextureFilterMode;
  /** Asset ID for the texture (for serialization) */
  textureId: string;
  /**
   * Creates a new texture node
   *
   * @remarks
   * Initializes with default sampling parameters:
   * - Auto-generated unique parameter name
   * - Clamp addressing mode
   * - Nearest filtering (point sampling)
   * - No mipmap filtering
   * - Empty texture ID
   */
  constructor() {
    super();
    this._paramName = getParamName();
    this.sRGB = true;
    this.addressU = 'clamp';
    this.addressV = 'clamp';
    this.filterMin = 'linear';
    this.filterMag = 'linear';
    this.filterMip = 'nearest';
    this.textureId = '';
  }
  /**
   * Gets the shader parameter name
   *
   * @returns The uniform name used in generated shader code
   */
  get paramName() {
    return this._paramName;
  }
  set paramName(val: string) {
    if (val !== this._paramName) {
      this._paramName = val;
      this.dispatchEvent('changed');
    }
  }
  /**
   * Indicates this node represents a shader uniform
   *
   * @returns Always true for texture nodes
   *
   * @remarks
   * Texture nodes create uniform declarations in the generated shader code.
   */
  get isUniform() {
    return true;
  }
  /**
   * Generates a string representation of this node
   *
   * @returns The parameter name
   */
  toString() {
    return this._paramName;
  }
  /**
   * Validates the node state
   *
   * @returns Empty string (always valid)
   *
   * @remarks
   * Texture nodes are always valid as they have no required inputs
   * and always have a valid texture (default if none assigned).
   */
  protected validate(): string {
    return '';
  }
  /**
   * Gets the output type
   *
   * @returns Empty string (overridden by subclasses)
   *
   * @remarks
   * Subclasses return texture type identifiers like 'tex2D', 'texCube', etc.
   */
  protected getType(): string {
    return '';
  }
}

/**
 * 2D texture constant node
 *
 * @remarks
 * Represents a 2D texture resource in the material node graph.
 * This is the most common texture type, used for:
 * - Albedo/diffuse maps
 * - Normal maps
 * - Roughness/metallic maps
 * - Emissive maps
 * - Any 2D image-based data
 *
 * The texture can be loaded from various image formats:
 * - JPEG (.jpg, .jpeg)
 * - PNG (.png)
 * - TGA (.tga)
 * - HDR/Radiance (.hdr)
 * - DDS (.dds)
 * - WebP (.webp)
 *
 * Output:
 * - Output 1: Texture sampler (tex2D type)
 *
 * @example
 * ```typescript
 * const albedoTex = new ConstantTexture2DNode();
 * albedoTex.paramName = 'albedoMap';
 * albedoTex.addressU = 'repeat';
 * albedoTex.addressV = 'repeat';
 * albedoTex.filterMin = 'linear';
 * albedoTex.filterMag = 'linear';
 *
 * // Sample the texture
 * const uv = new VertexUVNode();
 * const sample = new TextureSampleNode();
 * sample.connectInput(1, albedoTex, 1);
 * sample.connectInput(2, uv, 1);
 *
 * // Use in material
 * output.connectInput(1, sample, 1); // BaseColor
 * ```
 *
 * @public
 */
export class ConstantTexture2DNode extends BaseTextureNode {
  /**
   * Creates a new 2D texture node
   *
   * @remarks
   * Initializes with:
   * - One output slot for the texture sampler
   * - Default 1x1 white texture
   */
  constructor() {
    super();
    this._outputs = [
      {
        id: 1,
        name: ''
      }
    ];
  }
  /**
   * Gets the serialization descriptor for this node type
   *
   * @param manager - The serialization manager for loading textures
   * @returns Serialization class descriptor
   *
   * @remarks
   * Includes:
   * - Texture asset loading with MIME type validation
   * - All common texture parameters (addressing, filtering)
   * - Error handling for invalid or missing textures
   */
  static getSerializationCls(): SerializableClass {
    return {
      ctor: ConstantTexture2DNode,
      name: 'Texture2DNode',
      noTitle: true,
      getProps() {
        return [
          {
            name: 'Texture',
            type: 'object',
            default: null,
            options: {
              mimeTypes: [
                'image/jpeg',
                'image/png',
                'image/tga',
                'image/vnd.radiance',
                'image/x-dds',
                'image/webp'
              ]
            },
            isNullable() {
              return true;
            },
            get(this: ConstantTexture2DNode, value) {
              value.str[0] = this.textureId;
            },
            async set(this: ConstantTexture2DNode, value) {
              this.textureId = value.str[0] ?? '';
            }
          },
          ...textureNodeProps
        ];
      }
    };
  }
  /**
   * Validates the node state
   *
   * @returns Empty string (always valid)
   */
  protected validate(): string {
    return '';
  }
  /**
   * Gets the output type
   *
   * @returns 'tex2D'
   */
  protected getType(): string {
    return 'tex2D';
  }
}

/**
 * 2D texture array constant node
 *
 * @remarks
 * Represents a 2D texture array resource in the material node graph.
 * A texture array is a collection of 2D textures with the same size and format,
 * accessed using a 3D coordinate (u, v, layer).
 *
 * Used for:
 * - Terrain texture splatting (multiple terrain textures in one array)
 * - Animation frames (sprite sheets)
 * - Texture atlases with uniform tile sizes
 * - Reducing texture bindings (multiple textures in one resource)
 *
 * Note: Only DDS format supports texture arrays.
 *
 * Output:
 * - Output 1: Texture array sampler (tex2DArray type)
 *
 * @example
 * ```typescript
 * const terrainTexArray = new ConstantTexture2DArrayNode();
 * terrainTexArray.paramName = 'terrainTextures';
 *
 * // Sample from layer 2
 * const uv = new VertexUVNode();
 * const layer = new ConstantScalarNode();
 * layer.x = 2.0;
 *
 * const uvLayer = new MakeVectorNode();
 * uvLayer.connectInput(1, uv, 1);     // UV (vec2)
 * uvLayer.connectInput(2, layer, 1);  // Layer (float)
 *
 * const sample = new TextureSampleNode();
 * sample.connectInput(1, terrainTexArray, 1);
 * sample.connectInput(2, uvLayer, 1); // vec3 (u, v, layer)
 * ```
 *
 * @public
 */
export class ConstantTexture2DArrayNode extends BaseTextureNode {
  /**
   * Creates a new 2D texture array node
   *
   * @remarks
   * Initializes with:
   * - One output slot for the texture array sampler
   * - Default 1x1x1 white texture array
   */
  constructor() {
    super();
    this._outputs = [
      {
        id: 1,
        name: ''
      }
    ];
  }
  /**
   * Gets the serialization descriptor for this node type
   *
   * @param manager - The serialization manager for loading textures
   * @returns Serialization class descriptor
   *
   * @remarks
   * Only accepts DDS format, which is the standard format for texture arrays.
   * Includes validation to ensure the loaded texture is actually a 2D array.
   */
  static getSerializationCls(): SerializableClass {
    return {
      ctor: ConstantTexture2DArrayNode,
      name: 'Texture2DArrayNode',
      noTitle: true,
      getProps() {
        return [
          {
            name: 'Texture',
            type: 'object',
            default: null,
            options: {
              mimeTypes: ['image/x-dds']
            },
            isNullable() {
              return true;
            },
            get(this: ConstantTexture2DArrayNode, value) {
              value.str[0] = this.textureId;
            },
            async set(this: ConstantTexture2DArrayNode, value) {
              this.textureId = value.str[0] ?? '';
            }
          },
          ...textureNodeProps
        ];
      }
    };
  }
  /**
   * Validates the node state
   *
   * @returns Empty string (always valid)
   */
  protected validate(): string {
    return '';
  }
  /**
   * Gets the output type
   *
   * @returns 'tex2DArray'
   */
  protected getType(): string {
    return 'tex2DArray';
  }
}

/**
 * Cubemap texture constant node
 *
 * @remarks
 * Represents a cubemap texture resource in the material node graph.
 * A cubemap consists of 6 square textures representing the faces of a cube,
 * sampled using a 3D direction vector.
 *
 * Used for:
 * - Environment maps (skyboxes)
 * - Reflections (environment reflections on shiny surfaces)
 * - Image-based lighting (IBL)
 * - Irradiance maps for ambient lighting
 * - Prefiltered environment maps for specular reflections
 *
 * Cubemap faces (standard ordering):
 * - +X (right), -X (left)
 * - +Y (top), -Y (bottom)
 * - +Z (front), -Z (back)
 *
 * Note: Only DDS format supports cubemap textures.
 *
 * Output:
 * - Output 1: Cubemap sampler (texCube type)
 *
 * @example
 * ```typescript
 * const envMap = new ConstantTextureCubeNode();
 * envMap.paramName = 'environmentMap';
 * envMap.filterMin = 'linear';
 * envMap.filterMag = 'linear';
 * envMap.filterMip = 'linear';
 *
 * // Sample environment for reflection
 * const normal = new VertexNormalNode();
 * const viewDir = new ViewDirectionNode();
 *
 * const reflectDir = new ReflectNode();
 * reflectDir.connectInput(1, viewDir, 1);
 * reflectDir.connectInput(2, normal, 1);
 *
 * const sample = new TextureSampleNode();
 * sample.connectInput(1, envMap, 1);
 * sample.connectInput(2, reflectDir, 1); // vec3 direction
 *
 * // Use for reflections
 * output.connectInput(1, sample, 1);
 * ```
 *
 * @public
 */
export class ConstantTextureCubeNode extends BaseTextureNode {
  /**
   * Creates a new cubemap texture node
   *
   * @remarks
   * Initializes with:
   * - One output slot for the cubemap sampler
   * - Default 1x1 white cubemap (all faces white)
   * - No inputs (texture resource only)
   */
  constructor() {
    super();
    this._inputs = [];
    this._outputs = [
      {
        id: 1,
        name: ''
      }
    ];
  }
  /**
   * Gets the serialization descriptor for this node type
   *
   * @param manager - The serialization manager for loading textures
   * @returns Serialization class descriptor
   *
   * @remarks
   * Only accepts DDS format, which is the standard format for cubemaps.
   * Includes validation to ensure the loaded texture is actually a cubemap.
   */
  static getSerializationCls(): SerializableClass {
    return {
      ctor: ConstantTextureCubeNode,
      name: 'TextureCubeNode',
      noTitle: true,
      getProps() {
        return [
          {
            name: 'Texture',
            type: 'object',
            default: null,
            options: {
              mimeTypes: ['image/x-dds']
            },
            isNullable() {
              return true;
            },
            get(this: ConstantTextureCubeNode, value) {
              value.str[0] = this.textureId;
            },
            async set(this: ConstantTextureCubeNode, value) {
              this.textureId = value.str[0] ?? '';
            }
          },
          ...textureNodeProps
        ];
      }
    };
  }
  /**
   * Validates the node state
   *
   * @returns Empty string (always valid)
   */
  protected validate(): string {
    return '';
  }
  /**
   * Gets the output type
   *
   * @returns 'texCube'
   */
  protected getType(): string {
    return 'texCube';
  }
}

/**
 * Texture sampling node
 *
 * @remarks
 * Samples a texture at the specified coordinates and returns the color value.
 * This is the primary way to read texture data in material shaders.
 *
 * Supports multiple texture types:
 * - **tex2D**: Requires vec2 coordinates (u, v)
 * - **tex2DArray**: Requires vec3 coordinates (u, v, layer)
 * - **texCube**: Requires vec3 direction vector
 *
 * Sampler types:
 * - **Color**: Standard color sampling (returns RGBA as-is)
 * - **Normal**: Normal map sampling (may apply special transformations)
 *
 * The sampling uses the texture's configured filtering and addressing modes.
 * Mipmap level is automatically selected based on screen-space derivatives.
 *
 * Inputs:
 * - Input 1: Texture sampler (tex2D, tex2DArray, or texCube)
 * - Input 2: Texture coordinates (vec2 for 2D, vec3 for array/cube)
 *
 * Output:
 * - Output 1: Sampled color (vec4 RGBA)
 *
 * @example
 * ```typescript
 * // Basic 2D texture sampling
 * const albedoTex = new ConstantTexture2DNode();
 * const uv = new VertexUVNode();
 *
 * const sample = new TextureSampleNode();
 * sample.samplerType = 'Color';
 * sample.connectInput(1, albedoTex, 1);
 * sample.connectInput(2, uv, 1);
 *
 * output.connectInput(1, sample, 1); // Use as base color
 * ```
 *
 * @example
 * ```typescript
 * // Normal map sampling
 * const normalMap = new ConstantTexture2DNode();
 * const uv = new VertexUVNode();
 *
 * const sample = new TextureSampleNode();
 * sample.samplerType = 'Normal';
 * sample.connectInput(1, normalMap, 1);
 * sample.connectInput(2, uv, 1);
 *
 * output.connectInput(6, sample, 1); // Use as normal
 * ```
 *
 * @example
 * ```typescript
 * // Cubemap environment sampling
 * const envMap = new ConstantTextureCubeNode();
 * const normal = new VertexNormalNode();
 * const viewDir = new ViewDirectionNode();
 *
 * const reflectDir = new ReflectNode();
 * reflectDir.connectInput(1, viewDir, 1);
 * reflectDir.connectInput(2, normal, 1);
 *
 * const sample = new TextureSampleNode();
 * sample.connectInput(1, envMap, 1);
 * sample.connectInput(2, reflectDir, 1);
 * ```
 *
 * @public
 */
export class TextureSampleNode extends BaseGraphNode {
  /** The type of sampling (Color or Normal) */
  samplerType: 'Color' | 'Normal';
  /**
   * Creates a new texture sample node
   *
   * @remarks
   * Initializes with:
   * - Two required inputs (texture and coordinates)
   * - One output (sampled color)
   * - Color sampler type by default
   */
  constructor() {
    super();
    this.samplerType = 'Color';
    this._outputs = [
      {
        id: 1,
        name: ''
      }
    ];
    this._inputs = [
      {
        id: 1,
        name: 'texture',
        type: ['tex2D', 'tex2DArray', 'texCube'],
        required: true
      },
      {
        id: 2,
        name: 'coord',
        type: ['vec2', 'vec3'],
        required: true
      }
    ];
  }
  /**
   * Gets the serialization descriptor for this node type
   *
   * @returns Serialization class descriptor
   *
   * @remarks
   * Serializes the sampler type (Color or Normal).
   */
  static getSerializationCls(): SerializableClass {
    return {
      ctor: TextureSampleNode,
      name: 'TextureSampleNode',
      getProps(): PropertyAccessor<TextureSampleNode>[] {
        return [
          {
            name: 'SamplerType',
            type: 'string',
            options: {
              enum: {
                labels: ['Color', 'Normal'],
                values: ['Color', 'Normal']
              }
            },
            get(this: TextureSampleNode, value) {
              value.str[0] = this.samplerType;
            },
            set(this: TextureSampleNode, value) {
              this.samplerType = value.str[0] as any;
            }
          }
        ];
      }
    };
  }
  /**
   * Generates a string representation of this node
   *
   * @returns 'textureSample'
   */
  toString(): string {
    return 'textureSample';
  }
  /**
   * Validates the node state and input type compatibility
   *
   * @returns Error message if invalid, empty string if valid
   *
   * @remarks
   * Validation ensures:
   * - Both inputs are connected
   * - Texture input is a valid texture type
   * - Coordinate input matches texture dimensionality:
   *   - tex2D requires vec2
   *   - tex2DArray requires vec3 (u, v, layer)
   *   - texCube requires vec3 (direction)
   */
  protected validate(): string {
    const err = super.validate();
    if (err) {
      return err;
    }
    const type0 = this._inputs[0].inputNode.getOutputType(this._inputs[0].inputId);
    if (!type0) {
      return `Cannot determine type of argument \`${this._inputs[0].name}\``;
    }
    if (!this._inputs[0].type.includes(type0)) {
      return `Invalid input type of argument \`${this._inputs[0].name}\`: ${type0}`;
    }
    const type1 = this._inputs[1].inputNode.getOutputType(this._inputs[1].inputId);
    if (!type1) {
      return `Cannot determine type of argument \`${this._inputs[1].name}\``;
    }
    const expectedType1 = type0 === 'tex2D' ? 'vec2' : 'vec3';
    if (type1 !== expectedType1) {
      return `Texture coordinate type should be ${expectedType1}`;
    }
    return '';
  }
  /**
   * Gets the output type
   *
   * @returns 'vec4' (RGBA color)
   */
  protected getType(): string {
    return 'vec4';
  }
}

/**
 * Texture sampling with explicit gradients node
 *
 * @remarks
 * Samples a texture using explicitly provided screen-space gradients (derivatives)
 * instead of automatically computed ones. This allows precise control over mipmap
 * level selection and can be used for advanced effects.
 *
 * Use cases:
 * - Manual mipmap level control
 * - Sampling in non-fragment shaders (where automatic derivatives aren't available)
 * - Custom anisotropic filtering
 * - Texture sampling in control flow that breaks derivatives
 * - Advanced procedural effects
 *
 * Note: The current implementation appears identical to TextureSampleNode.
 * Full gradient support would require additional inputs for dPdx and dPdy.
 *
 * Inputs:
 * - Input 1: Texture sampler (tex2D, tex2DArray, or texCube)
 * - Input 2: Texture coordinates (vec2 or vec3)
 *
 * Output:
 * - Output 1: Sampled color (vec4 RGBA)
 *
 * @public
 */
export class TextureSampleGrad extends BaseGraphNode {
  /** The type of sampling (Color or Normal) */
  samplerType: 'Color' | 'Normal';
  /**
   * Creates a new texture sample with gradients node
   *
   * @remarks
   * Initializes with:
   * - Two required inputs (texture and coordinates)
   * - One output (sampled color)
   * - Color sampler type by default
   *
   * TODO: Add gradient inputs (dPdx, dPdy) for full explicit gradient support
   */
  constructor() {
    super();
    this.samplerType = 'Color';
    this._outputs = [
      {
        id: 1,
        name: ''
      }
    ];
    this._inputs = [
      {
        id: 1,
        name: 'texture',
        type: ['tex2D', 'tex2DArray', 'texCube'],
        required: true
      },
      {
        id: 2,
        name: 'coord',
        type: ['vec2', 'vec3'],
        required: true
      }
    ];
  }
  /**
   * Gets the serialization descriptor for this node type
   *
   * @returns Serialization class descriptor
   *
   * @remarks
   * Currently returns TextureSampleNode serialization (likely needs separate class).
   */
  static getSerializationCls(): SerializableClass {
    return {
      ctor: TextureSampleNode,
      name: 'TextureSampleNode',
      getProps(): PropertyAccessor<TextureSampleNode>[] {
        return [
          {
            name: 'SamplerType',
            type: 'string',
            options: {
              enum: {
                labels: ['Color', 'Normal'],
                values: ['Color', 'Normal']
              }
            },
            get(this: TextureSampleNode, value) {
              value.str[0] = this.samplerType;
            },
            set(this: TextureSampleNode, value) {
              this.samplerType = value.str[0] as any;
            }
          }
        ];
      }
    };
  }
  /**
   * Generates a string representation of this node
   *
   * @returns 'textureSample'
   */
  toString(): string {
    return 'textureSample';
  }
  /**
   * Validates the node state and input type compatibility
   *
   * @returns Error message if invalid, empty string if valid
   *
   * @remarks
   * Validation ensures:
   * - Both inputs are connected
   * - Texture input is a valid texture type
   * - Coordinate input matches texture dimensionality
   */
  protected validate(): string {
    const err = super.validate();
    if (err) {
      return err;
    }
    const type0 = this._inputs[0].inputNode.getOutputType(this._inputs[0].inputId);
    if (!type0) {
      return `Cannot determine type of argument \`${this._inputs[0].name}\``;
    }
    if (!this._inputs[0].type.includes(type0)) {
      return `Invalid input type of argument \`${this._inputs[0].name}\`: ${type0}`;
    }
    const type1 = this._inputs[1].inputNode.getOutputType(this._inputs[1].inputId);
    if (!type1) {
      return `Cannot determine type of argument \`${this._inputs[1].name}\``;
    }
    const expectedType1 = type0 === 'tex2D' ? 'vec2' : 'vec3';
    if (type1 !== expectedType1) {
      return `Texture coordinate type should be ${expectedType1}`;
    }
    return '';
  }
  /**
   * Gets the output type
   *
   * @returns 'vec4' (RGBA color)
   */
  protected getType(): string {
    return 'vec4';
  }
}
