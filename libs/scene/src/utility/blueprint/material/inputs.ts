import type { SerializableClass } from '../../serialization';
import { BaseGraphNode } from '../node';

/**
 * Vertex color input node
 *
 * @remarks
 * Provides access to per-vertex color data from the mesh.
 * Vertex colors are stored as RGBA values (vec4) and can be used for:
 * - Hand-painted color variations
 * - Ambient occlusion baking
 * - Blend weights for texture mixing
 * - Custom data encoded in color channels
 *
 * Outputs:
 * - Output 1: Full RGBA color (vec4)
 * - Output 2: Red channel (float)
 * - Output 3: Green channel (float)
 * - Output 4: Blue channel (float)
 * - Output 5: Alpha channel (float)
 *
 * @example
 * ```typescript
 * const vertexColor = new VertexColorNode();
 *
 * // Use full color
 * baseColorNode.connectInput(1, vertexColor, 1);
 *
 * // Use individual channels
 * roughnessNode.connectInput(1, vertexColor, 2); // Red as roughness
 * metallicNode.connectInput(1, vertexColor, 3); // Green as metallic
 * ```
 *
 * @public
 */
export class VertexColorNode extends BaseGraphNode {
  /**
   * Creates a new vertex color node
   *
   * @remarks
   * Initializes with 5 output slots: full RGBA and individual R, G, B, A channels.
   */
  constructor() {
    super();
    this._outputs = [
      { id: 1, name: '' },
      { id: 2, name: 'r', swizzle: 'x' },
      { id: 3, name: 'g', swizzle: 'y' },
      { id: 4, name: 'b', swizzle: 'z' },
      { id: 5, name: 'a', swizzle: 'w' }
    ];
  }
  /**
   * Gets the serialization descriptor for this node type
   *
   * @returns Serialization class descriptor
   */
  static getSerializationCls(): SerializableClass {
    return {
      ctor: VertexColorNode,
      name: 'VertexColorNode',
      getProps() {
        return [];
      }
    };
  }
  /**
   * Generates a string representation of this node
   *
   * @returns 'vertex color'
   */
  toString() {
    return 'vertex color';
  }
  /**
   * Validates the node state
   *
   * @returns Empty string (always valid)
   *
   * @remarks
   * Vertex color nodes are always valid as they have no inputs.
   */
  protected validate(): string {
    return '';
  }
  /**
   * Gets the output type for a specific output slot
   *
   * @param id - The output slot ID
   * @returns 'float' for individual channel outputs (id \> 1), 'vec4' for full color
   */
  protected getType(id: number): string {
    return id > 1 ? 'float' : 'vec4';
  }
}

/**
 * Vertex UV coordinate input node
 *
 * @remarks
 * Provides access to per-vertex texture coordinates (UV coordinates) from the mesh.
 * UV coordinates map 3D mesh vertices to 2D texture space, typically in the range [0, 1].
 *
 * Used for:
 * - Texture sampling (most common use)
 * - Procedural pattern generation
 * - Gradient effects based on position in UV space
 * - Decal placement
 *
 * Outputs:
 * - Output 1: Full UV coordinates (vec2)
 * - Output 2: U coordinate (horizontal, float)
 * - Output 3: V coordinate (vertical, float)
 *
 * @example
 * ```typescript
 * const uv = new VertexUVNode();
 *
 * // Sample texture using UV coordinates
 * textureSample.connectInput(1, uv, 1);
 *
 * // Use U coordinate for horizontal gradient
 * mixNode.connectInput(3, uv, 2);
 * ```
 *
 * @public
 */
export class VertexUVNode extends BaseGraphNode {
  /**
   * Creates a new vertex UV node
   *
   * @remarks
   * Initializes with 3 output slots: full UV and individual U, V components.
   */
  constructor() {
    super();
    this._outputs = [
      { id: 1, name: '' },
      { id: 2, name: 'x', swizzle: 'x' },
      { id: 3, name: 'y', swizzle: 'y' }
    ];
  }
  /**
   * Gets the serialization descriptor for this node type
   *
   * @returns Serialization class descriptor
   */
  static getSerializationCls(): SerializableClass {
    return {
      ctor: VertexUVNode,
      name: 'VertexUVNode',
      getProps() {
        return [];
      }
    };
  }
  /**
   * Generates a string representation of this node
   *
   * @returns 'vertex UV'
   */
  toString() {
    return 'vertex UV';
  }
  /**
   * Validates the node state
   *
   * @returns Empty string (always valid)
   *
   * @remarks
   * Vertex UV nodes are always valid as they have no inputs.
   */
  protected validate(): string {
    return '';
  }
  /**
   * Gets the output type for a specific output slot
   *
   * @param id - The output slot ID
   * @returns 'float' for individual component outputs (id \> 1), 'vec2' for full UV
   */
  protected getType(id: number): string {
    return id > 1 ? 'float' : 'vec2';
  }
}

/**
 * Vertex world position input node
 *
 * @remarks
 * Provides access to the vertex position in world space coordinates.
 * World position is the absolute 3D location of the vertex in the scene,
 * after applying all model transformations but before view/projection.
 *
 * Used for:
 * - Distance-based effects (fog, fade)
 * - World-space texturing (triplanar mapping)
 * - Position-based color gradients
 * - Vertex animation based on world location
 * - Custom lighting calculations
 *
 * Outputs:
 * - Output 1: Full position (vec3)
 * - Output 2: X coordinate (float)
 * - Output 3: Y coordinate (float)
 * - Output 4: Z coordinate (float)
 *
 * @example
 * ```typescript
 * const worldPos = new VertexPositionNode();
 *
 * // Calculate distance from origin
 * const origin = new ConstantVec3Node();
 * const distance = new DistanceNode();
 * distance.connectInput(1, worldPos, 1);
 * distance.connectInput(2, origin, 1);
 *
 * // Height-based color gradient
 * colorMix.connectInput(3, worldPos, 3); // Use Y (height)
 * ```
 *
 * @public
 */
export class VertexPositionNode extends BaseGraphNode {
  /**
   * Creates a new vertex position node
   *
   * @remarks
   * Initializes with 4 output slots: full position and individual X, Y, Z components.
   */
  constructor() {
    super();
    this._outputs = [
      { id: 1, name: '' },
      { id: 2, name: 'x', swizzle: 'x' },
      { id: 3, name: 'y', swizzle: 'y' },
      { id: 4, name: 'z', swizzle: 'z' }
    ];
  }
  /**
   * Generates a string representation of this node
   *
   * @returns 'world position'
   */
  toString() {
    return 'world position';
  }
  /**
   * Gets the serialization descriptor for this node type
   *
   * @returns Serialization class descriptor
   */
  static getSerializationCls(): SerializableClass {
    return {
      ctor: VertexPositionNode,
      name: 'VertexPositionNode',
      getProps() {
        return [];
      }
    };
  }
  /**
   * Validates the node state
   *
   * @returns Empty string (always valid)
   *
   * @remarks
   * Vertex position nodes are always valid as they have no inputs.
   */
  protected validate(): string {
    return '';
  }
  /**
   * Gets the output type for a specific output slot
   *
   * @param id - The output slot ID
   * @returns 'float' for individual component outputs (id \> 1), 'vec3' for full position
   */
  protected getType(id: number): string {
    return id > 1 ? 'float' : 'vec3';
  }
}

/**
 * Vertex normal input node
 *
 * @remarks
 * Provides access to per-vertex normal vectors in world space.
 * Normals are unit vectors perpendicular to the surface, used extensively
 * in lighting calculations and surface orientation effects.
 *
 * Used for:
 * - Custom lighting calculations
 * - Fresnel effects (view-dependent shading)
 * - Rim lighting
 * - Normal-based masking
 * - Environment mapping
 *
 * Outputs:
 * - Output 1: Full normal vector (vec3, normalized)
 * - Output 2: X component (float)
 * - Output 3: Y component (float)
 * - Output 4: Z component (float)
 *
 * @example
 * ```typescript
 * const normal = new VertexNormalNode();
 * const viewDir = new ViewDirectionNode();
 *
 * // Calculate Fresnel effect
 * const dot = new DotProductNode();
 * dot.connectInput(1, normal, 1);
 * dot.connectInput(2, viewDir, 1);
 *
 * // Rim lighting using Y component
 * rimMask.connectInput(1, normal, 3);
 * ```
 *
 * @public
 */
export class VertexNormalNode extends BaseGraphNode {
  /**
   * Creates a new vertex normal node
   *
   * @remarks
   * Initializes with 4 output slots: full normal and individual X, Y, Z components.
   */
  constructor() {
    super();
    this._outputs = [
      { id: 1, name: '' },
      { id: 2, name: 'x', swizzle: 'x' },
      { id: 3, name: 'y', swizzle: 'y' },
      { id: 4, name: 'z', swizzle: 'z' }
    ];
  }
  /**
   * Generates a string representation of this node
   *
   * @returns 'vertex normal'
   */
  toString() {
    return 'vertex normal';
  }
  /**
   * Gets the serialization descriptor for this node type
   *
   * @returns Serialization class descriptor
   */
  static getSerializationCls(): SerializableClass {
    return {
      ctor: VertexNormalNode,
      name: 'VertexNormalNode',
      getProps() {
        return [];
      }
    };
  }
  /**
   * Validates the node state
   *
   * @returns Empty string (always valid)
   *
   * @remarks
   * Vertex normal nodes are always valid as they have no inputs.
   */
  protected validate(): string {
    return '';
  }
  /**
   * Gets the output type for a specific output slot
   *
   * @param id - The output slot ID
   * @returns 'float' for individual component outputs (id \> 1), 'vec3' for full normal
   */
  protected getType(id: number): string {
    return id > 1 ? 'float' : 'vec3';
  }
}

/**
 * Vertex tangent input node
 *
 * @remarks
 * Provides access to per-vertex tangent vectors in world space.
 * Tangents are unit vectors parallel to the surface, aligned with the U texture coordinate direction.
 * Together with normals and binormals, they form the tangent-space basis (TBN matrix).
 *
 * Used for:
 * - Normal mapping (constructing TBN matrix)
 * - Anisotropic reflections (hair, brushed metal)
 * - Tangent-space calculations
 * - Flow map effects
 *
 * Outputs:
 * - Output 1: Full tangent vector (vec3, normalized)
 * - Output 2: X component (float)
 * - Output 3: Y component (float)
 * - Output 4: Z component (float)
 *
 * @example
 * ```typescript
 * const tangent = new VertexTangentNode();
 * const normal = new VertexNormalNode();
 * const binormal = new VertexBinormalNode();
 *
 * // Construct TBN matrix for normal mapping
 * const tbnMatrix = new MakeMatrixNode();
 * tbnMatrix.connectInput(1, tangent, 1);
 * tbnMatrix.connectInput(2, binormal, 1);
 * tbnMatrix.connectInput(3, normal, 1);
 * ```
 *
 * @public
 */
export class VertexTangentNode extends BaseGraphNode {
  /**
   * Creates a new vertex tangent node
   *
   * @remarks
   * Initializes with 4 output slots: full tangent and individual X, Y, Z components.
   */
  constructor() {
    super();
    this._outputs = [
      { id: 1, name: '' },
      { id: 2, name: 'x', swizzle: 'x' },
      { id: 3, name: 'y', swizzle: 'y' },
      { id: 4, name: 'z', swizzle: 'z' }
    ];
  }
  /**
   * Generates a string representation of this node
   *
   * @returns 'vertex tangent'
   */
  toString() {
    return 'vertex tangent';
  }
  /**
   * Gets the serialization descriptor for this node type
   *
   * @returns Serialization class descriptor
   */
  static getSerializationCls(): SerializableClass {
    return {
      ctor: VertexTangentNode,
      name: 'VertexTangentNode',
      getProps() {
        return [];
      }
    };
  }
  /**
   * Validates the node state
   *
   * @returns Empty string (always valid)
   *
   * @remarks
   * Vertex tangent nodes are always valid as they have no inputs.
   */
  protected validate(): string {
    return '';
  }
  /**
   * Gets the output type for a specific output slot
   *
   * @param id - The output slot ID
   * @returns 'float' for individual component outputs (id \> 1), 'vec3' for full tangent
   */
  protected getType(id: number): string {
    return id > 1 ? 'float' : 'vec3';
  }
}

/**
 * Vertex binormal (bitangent) input node
 *
 * @remarks
 * Provides access to per-vertex binormal (also called bitangent) vectors in world space.
 * Binormals are unit vectors perpendicular to both the normal and tangent,
 * aligned with the V texture coordinate direction.
 * Together with normals and tangents, they form the tangent-space basis (TBN matrix).
 *
 * The binormal is typically computed as: binormal = cross(normal, tangent) * handedness
 *
 * Used for:
 * - Normal mapping (constructing TBN matrix)
 * - Tangent-space calculations
 * - Surface flow effects
 * - Oriented texture mapping
 *
 * Outputs:
 * - Output 1: Full binormal vector (vec3, normalized)
 * - Output 2: X component (float)
 * - Output 3: Y component (float)
 * - Output 4: Z component (float)
 *
 * @example
 * ```typescript
 * const tangent = new VertexTangentNode();
 * const normal = new VertexNormalNode();
 * const binormal = new VertexBinormalNode();
 *
 * // Use for normal mapping transformation
 * const normalMap = new TextureSampleNode();
 * const tbnTransform = new TransformNode();
 * tbnTransform.connectInput(1, normalMap, 1);
 * tbnTransform.connectInput(2, tbnMatrixNode, 1);
 * ```
 *
 * @public
 */
export class VertexBinormalNode extends BaseGraphNode {
  /**
   * Creates a new vertex binormal node
   *
   * @remarks
   * Initializes with 4 output slots: full binormal and individual X, Y, Z components.
   */
  constructor() {
    super();
    this._outputs = [
      { id: 1, name: '' },
      { id: 2, name: 'x', swizzle: 'x' },
      { id: 3, name: 'y', swizzle: 'y' },
      { id: 4, name: 'z', swizzle: 'z' }
    ];
  }
  /**
   * Generates a string representation of this node
   *
   * @returns 'vertex binormal'
   */
  toString() {
    return 'vertex binormal';
  }
  /**
   * Gets the serialization descriptor for this node type
   *
   * @returns Serialization class descriptor
   */
  static getSerializationCls(): SerializableClass {
    return {
      ctor: VertexBinormalNode,
      name: 'VertexBinormalNode',
      getProps() {
        return [];
      }
    };
  }
  /**
   * Validates the node state
   *
   * @returns Empty string (always valid)
   *
   * @remarks
   * Vertex binormal nodes are always valid as they have no inputs.
   */
  protected validate(): string {
    return '';
  }
  /**
   * Gets the output type for a specific output slot
   *
   * @param id - The output slot ID
   * @returns 'float' for individual component outputs (id \> 1), 'vec3' for full binormal
   */
  protected getType(id: number): string {
    return id > 1 ? 'float' : 'vec3';
  }
}

/**
 * Projection matrix input node
 *
 * @remarks
 * Provides the camera's projection matrix (view space to clip space transformation).
 * This matrix transforms coordinates from camera/view space to normalized device coordinates (NDC).
 *
 * For perspective projection: converts frustum to cube, applies perspective divide
 * For orthographic projection: applies parallel projection scaling
 *
 * Used for:
 * - Custom vertex transformations
 * - Screen-space effects
 * - Depth calculations
 * - Custom projection modifications
 *
 * Output:
 * - Output 1: 4x4 projection matrix (mat4)
 *
 * @example
 * ```typescript
 * const projMatrix = new ProjectionMatrixNode();
 * const viewSpacePos = new ViewSpacePositionNode();
 *
 * // Transform to clip space
 * const transform = new TransformNode();
 * transform.connectInput(1, viewSpacePos, 1);
 * transform.connectInput(2, projMatrix, 1);
 * ```
 *
 * @public
 */
export class ProjectionMatrixNode extends BaseGraphNode {
  /**
   * Creates a new projection matrix node
   *
   * @remarks
   * Initializes with one output slot for the mat4 matrix.
   */
  constructor() {
    super();
    this._outputs = [{ id: 1, name: '' }];
  }
  /**
   * Generates a string representation of this node
   *
   * @returns 'ViewToClipMatrix'
   */
  toString() {
    return 'ViewToClipMatrix';
  }
  /**
   * Gets the serialization descriptor for this node type
   *
   * @returns Serialization class descriptor
   */
  static getSerializationCls(): SerializableClass {
    return {
      ctor: ProjectionMatrixNode,
      name: 'ProjectionMatrixNode',
      getProps() {
        return [];
      }
    };
  }
  /**
   * Validates the node state
   *
   * @returns Empty string (always valid)
   *
   * @remarks
   * Matrix nodes are always valid as they have no inputs.
   */
  protected validate(): string {
    return '';
  }
  /**
   * Gets the output type
   *
   * @returns 'mat4'
   */
  protected getType(): string {
    return 'mat4';
  }
}

/**
 * View matrix input node
 *
 * @remarks
 * Provides the camera's view matrix (world space to view space transformation).
 * This matrix transforms coordinates from world space to camera/view space,
 * where the camera is at the origin looking down the negative Z axis.
 *
 * The view matrix is the inverse of the camera's world transformation matrix.
 *
 * Used for:
 * - Custom lighting in view space
 * - View-space normal calculations
 * - Billboard effects
 * - Custom camera-relative transformations
 *
 * Output:
 * - Output 1: 4x4 view matrix (mat4)
 *
 * @example
 * ```typescript
 * const viewMatrix = new ViewMatrixNode();
 * const worldPos = new VertexPositionNode();
 *
 * // Transform to view space
 * const transform = new TransformNode();
 * transform.connectInput(1, worldPos, 1);
 * transform.connectInput(2, viewMatrix, 1);
 * ```
 *
 * @public
 */
export class ViewMatrixNode extends BaseGraphNode {
  /**
   * Creates a new view matrix node
   *
   * @remarks
   * Initializes with one output slot for the mat4 matrix.
   */
  constructor() {
    super();
    this._outputs = [{ id: 1, name: '' }];
  }
  /**
   * Generates a string representation of this node
   *
   * @returns 'WorldToViewMatrix'
   */
  toString() {
    return 'WorldToViewMatrix';
  }
  /**
   * Gets the serialization descriptor for this node type
   *
   * @returns Serialization class descriptor
   */
  static getSerializationCls(): SerializableClass {
    return {
      ctor: ViewMatrixNode,
      name: 'ViewMatrixNode',
      getProps() {
        return [];
      }
    };
  }
  /**
   * Validates the node state
   *
   * @returns Empty string (always valid)
   *
   * @remarks
   * Matrix nodes are always valid as they have no inputs.
   */
  protected validate(): string {
    return '';
  }
  /**
   * Gets the output type
   *
   * @returns 'mat4'
   */
  protected getType(): string {
    return 'mat4';
  }
}

/**
 * View-projection matrix input node
 *
 * @remarks
 * Provides the combined view-projection matrix (world space to clip space transformation).
 * This is the product of the view matrix and projection matrix, commonly used for
 * transforming vertices from world space directly to clip space in one step.
 *
 * Equivalent to: projectionMatrix * viewMatrix
 *
 * Used for:
 * - Vertex position transformation (most common use)
 * - Custom vertex shaders
 * - Screen-space position calculations
 * - Shadow mapping
 *
 * Output:
 * - Output 1: 4x4 view-projection matrix (mat4)
 *
 * @example
 * ```typescript
 * const viewProjMatrix = new ViewProjMatrixNode();
 * const worldPos = new VertexPositionNode();
 *
 * // Transform directly to clip space
 * const transform = new TransformNode();
 * transform.connectInput(1, worldPos, 1);
 * transform.connectInput(2, viewProjMatrix, 1);
 * ```
 *
 * @public
 */
export class ViewProjMatrixNode extends BaseGraphNode {
  /**
   * Creates a new view-projection matrix node
   *
   * @remarks
   * Initializes with one output slot for the mat4 matrix.
   */
  constructor() {
    super();
    this._outputs = [{ id: 1, name: '' }];
  }
  /**
   * Generates a string representation of this node
   *
   * @returns 'WorldToClipMatrix'
   */
  toString() {
    return 'WorldToClipMatrix';
  }
  /**
   * Gets the serialization descriptor for this node type
   *
   * @returns Serialization class descriptor
   */
  static getSerializationCls(): SerializableClass {
    return {
      ctor: ViewProjMatrixNode,
      name: 'ViewProjMatrixNode',
      getProps() {
        return [];
      }
    };
  }
  /**
   * Validates the node state
   *
   * @returns Empty string (always valid)
   *
   * @remarks
   * Matrix nodes are always valid as they have no inputs.
   */
  protected validate(): string {
    return '';
  }
  /**
   * Gets the output type
   *
   * @returns 'mat4'
   */
  protected getType(): string {
    return 'mat4';
  }
}

/**
 * Inverse projection matrix input node
 *
 * @remarks
 * Provides the inverse of the projection matrix (clip space to view space transformation).
 * This matrix transforms coordinates from normalized device coordinates (NDC) back to camera/view space.
 *
 * Used for:
 * - Screen-space to view-space reconstruction
 * - Depth buffer unprojection
 * - Deferred rendering position reconstruction
 * - Ray marching from screen space
 *
 * Output:
 * - Output 1: 4x4 inverse projection matrix (mat4)
 *
 * @example
 * ```typescript
 * const invProjMatrix = new InvProjMatrixNode();
 * const clipPos = new ClipSpacePositionNode();
 *
 * // Reconstruct view space position
 * const transform = new TransformNode();
 * transform.connectInput(1, clipPos, 1);
 * transform.connectInput(2, invProjMatrix, 1);
 * ```
 *
 * @public
 */
export class InvProjMatrixNode extends BaseGraphNode {
  /**
   * Creates a new inverse projection matrix node
   *
   * @remarks
   * Initializes with one output slot for the mat4 matrix.
   */
  constructor() {
    super();
    this._outputs = [{ id: 1, name: '' }];
  }
  /**
   * Generates a string representation of this node
   *
   * @returns 'ClipToViewMatrix'
   */
  toString() {
    return 'ClipToViewMatrix';
  }
  /**
   * Gets the serialization descriptor for this node type
   *
   * @returns Serialization class descriptor
   */
  static getSerializationCls(): SerializableClass {
    return {
      ctor: InvProjMatrixNode,
      name: 'InvProjMatrixNode',
      getProps() {
        return [];
      }
    };
  }
  /**
   * Validates the node state
   *
   * @returns Empty string (always valid)
   *
   * @remarks
   * Matrix nodes are always valid as they have no inputs.
   */
  protected validate(): string {
    return '';
  }
  /**
   * Gets the output type
   *
   * @returns 'mat4'
   */
  protected getType(): string {
    return 'mat4';
  }
}

/**
 * Inverse view-projection matrix input node
 *
 * @remarks
 * Provides the inverse of the view-projection matrix (clip space to world space transformation).
 * This matrix transforms coordinates from normalized device coordinates (NDC) back to world space.
 *
 * Equivalent to: inverse(projectionMatrix * viewMatrix)
 *
 * Used for:
 * - Screen-space to world-space reconstruction
 * - Deferred rendering world position reconstruction
 * - Picking and ray casting from screen coordinates
 * - Screen-space effects needing world position
 *
 * Output:
 * - Output 1: 4x4 inverse view-projection matrix (mat4)
 *
 * @example
 * ```typescript
 * const invViewProjMatrix = new InvViewProjMatrixNode();
 * const screenPos = new ScreenPositionNode();
 *
 * // Reconstruct world position from screen coordinates
 * const transform = new TransformNode();
 * transform.connectInput(1, screenPos, 1);
 * transform.connectInput(2, invViewProjMatrix, 1);
 * ```
 *
 * @public
 */
export class InvViewProjMatrixNode extends BaseGraphNode {
  /**
   * Creates a new inverse view-projection matrix node
   *
   * @remarks
   * Initializes with one output slot for the mat4 matrix.
   */
  constructor() {
    super();
    this._outputs = [{ id: 1, name: '' }];
  }
  /**
   * Generates a string representation of this node
   *
   * @returns 'ClipToWorldMatrix'
   */
  toString() {
    return 'ClipToWorldMatrix';
  }
  /**
   * Gets the serialization descriptor for this node type
   *
   * @returns Serialization class descriptor
   */
  static getSerializationCls(): SerializableClass {
    return {
      ctor: InvViewProjMatrixNode,
      name: 'InvViewProjMatrixNode',
      getProps() {
        return [];
      }
    };
  }
  /**
   * Validates the node state
   *
   * @returns Empty string (always valid)
   *
   * @remarks
   * Matrix nodes are always valid as they have no inputs.
   */
  protected validate(): string {
    return '';
  }
  /**
   * Gets the output type
   *
   * @returns 'mat4'
   */
  protected getType(): string {
    return 'mat4';
  }
}

/**
 * Elapsed time input node
 *
 * @remarks
 * Provides the total elapsed time since the application started, in seconds.
 * This value continuously increases and is useful for creating time-based animations
 * and effects directly in the material shader.
 *
 * Used for:
 * - Animated textures (scrolling, rotating)
 * - Pulsating effects
 * - Wave animations
 * - Oscillating values (using sin/cos)
 * - Time-based procedural patterns
 *
 * Output:
 * - Output 1: Elapsed time in seconds (float)
 *
 * @example
 * ```typescript
 * const time = new ElapsedTimeNode();
 * const speed = new ConstantScalarNode();
 * speed.x = 0.5;
 *
 * // Animate UV scrolling
 * const mul = new CompMulNode();
 * mul.connectInput(1, time, 1);
 * mul.connectInput(2, speed, 1);
 *
 * const add = new CompAddNode();
 * add.connectInput(1, uvNode, 1);
 * add.connectInput(2, mul, 1);
 *
 * // Pulsating effect with sine wave
 * const sin = new SinNode();
 * sin.connectInput(1, time, 1);
 * ```
 *
 * @public
 */
export class ElapsedTimeNode extends BaseGraphNode {
  /**
   * Creates a new elapsed time node
   *
   * @remarks
   * Initializes with one output slot for the time value.
   */
  constructor() {
    super();
    this._outputs = [{ id: 1, name: '' }];
  }
  /**
   * Generates a string representation of this node
   *
   * @returns 'Elapsed time'
   */
  toString() {
    return 'Elapsed time';
  }
  /**
   * Gets the serialization descriptor for this node type
   *
   * @returns Serialization class descriptor
   */
  static getSerializationCls(): SerializableClass {
    return {
      ctor: ElapsedTimeNode,
      name: 'ElapsedTimeNode',
      getProps() {
        return [];
      }
    };
  }
  /**
   * Validates the node state
   *
   * @returns Empty string (always valid)
   *
   * @remarks
   * Time nodes are always valid as they have no inputs.
   */
  protected validate(): string {
    return '';
  }
  /**
   * Gets the output type
   *
   * @returns 'float'
   */
  protected getType(): string {
    return 'float';
  }
}

/**
 * Camera position input node
 *
 * @remarks
 * Provides the world-space position of the camera/viewer.
 * This is the location of the camera in the 3D scene coordinate system.
 *
 * Used for:
 * - View direction calculations
 * - Distance-based effects (distance fog, LOD)
 * - Reflections and refractions
 * - Fresnel effects
 * - Environment mapping
 * - Specular highlights
 *
 * Outputs:
 * - Output 1: Full camera position (vec3)
 * - Output 2: X coordinate (float)
 * - Output 3: Y coordinate (float)
 * - Output 4: Z coordinate (float)
 *
 * @example
 * ```typescript
 * const cameraPos = new CameraPositionNode();
 * const worldPos = new VertexPositionNode();
 *
 * // Calculate view direction
 * const viewDir = new CompSubNode();
 * viewDir.connectInput(1, cameraPos, 1);
 * viewDir.connectInput(2, worldPos, 1);
 *
 * const normalizedViewDir = new NormalizeNode();
 * normalizedViewDir.connectInput(1, viewDir, 1);
 *
 * // Calculate distance to camera
 * const distance = new DistanceNode();
 * distance.connectInput(1, cameraPos, 1);
 * distance.connectInput(2, worldPos, 1);
 * ```
 *
 * @public
 */
export class CameraPositionNode extends BaseGraphNode {
  /**
   * Creates a new camera position node
   *
   * @remarks
   * Initializes with 4 output slots: full position and individual X, Y, Z components.
   */
  constructor() {
    super();
    this._outputs = [
      { id: 1, name: '' },
      { id: 2, name: 'x', swizzle: 'x' },
      { id: 3, name: 'y', swizzle: 'y' },
      { id: 4, name: 'z', swizzle: 'z' }
    ];
  }
  /**
   * Generates a string representation of this node
   *
   * @returns 'camera position'
   */
  toString() {
    return 'camera position';
  }
  /**
   * Gets the serialization descriptor for this node type
   *
   * @returns Serialization class descriptor
   */
  static getSerializationCls(): SerializableClass {
    return {
      ctor: CameraPositionNode,
      name: 'CameraPositionNode',
      getProps() {
        return [];
      }
    };
  }
  /**
   * Validates the node state
   *
   * @returns Empty string (always valid)
   *
   * @remarks
   * Camera position nodes are always valid as they have no inputs.
   */
  protected validate(): string {
    return '';
  }
  /**
   * Gets the output type for a specific output slot
   *
   * @param id - The output slot ID
   * @returns 'float' for individual component outputs (id \> 1), 'vec3' for full position
   */
  protected getType(id: number): string {
    return id > 1 ? 'float' : 'vec3';
  }
}

/**
 * Sky environment texture input node
 *
 * @remarks
 * Provides access to the scene's sky/environment cubemap texture.
 * This is typically used for skybox rendering, environment reflections,
 * and image-based lighting (IBL).
 *
 * The texture is a cubemap (texCube) that can be sampled using a 3D direction vector.
 *
 * Used for:
 * - Skybox rendering
 * - Environment reflections on metallic surfaces
 * - Image-based lighting (IBL)
 * - Ambient lighting from environment
 * - Reflections and refractions
 *
 * Output:
 * - Output 1: Cubemap texture sampler (texCube)
 *
 * @example
 * ```typescript
 * const skyTexture = new SkyEnvTextureNode();
 * const reflectionDir = new ReflectNode();
 *
 * // Sample environment for reflection
 * const envSample = new TextureSampleCubeNode();
 * envSample.connectInput(1, skyTexture, 1);
 * envSample.connectInput(2, reflectionDir, 1);
 *
 * // Use for metallic reflections
 * metalColor.connectInput(1, envSample, 1);
 * ```
 *
 * @public
 */
export class SkyEnvTextureNode extends BaseGraphNode {
  /**
   * Creates a new sky environment texture node
   *
   * @remarks
   * Initializes with one output slot for the cubemap sampler.
   */
  constructor() {
    super();
    this._outputs = [{ id: 1, name: '' }];
  }
  /**
   * Generates a string representation of this node
   *
   * @returns 'SkyEnvTexture'
   */
  toString(): string {
    return 'SkyEnvTexture';
  }
  /**
   * Gets the serialization descriptor for this node type
   *
   * @returns Serialization class descriptor
   */
  static getSerializationCls(): SerializableClass {
    return {
      ctor: SkyEnvTextureNode,
      name: 'SkyEnvTextureNode',
      getProps() {
        return [];
      }
    };
  }
  /**
   * Validates the node state
   *
   * @returns Empty string (always valid)
   *
   * @remarks
   * Sky environment texture nodes are always valid as they have no inputs.
   */
  protected validate(): string {
    return '';
  }
  /**
   * Gets the output type
   *
   * @returns 'texCube' (cubemap texture sampler)
   */
  protected getType(): string {
    return 'texCube';
  }
}

/**
 * Camera near/far plane input node
 *
 * @remarks
 * Provides the camera's near and far clipping plane distances.
 * These values define the camera's visible depth range:
 * - Near plane: The closest distance at which objects are rendered
 * - Far plane: The farthest distance at which objects are rendered
 *
 * Used for:
 * - Depth linearization (converting from NDC depth to linear depth)
 * - Fog calculations based on depth
 * - Custom depth-of-field effects
 * - Z-buffer precision calculations
 * - Distance-based effects
 *
 * Outputs:
 * - Output 1: Both values as vec2 (x = near, y = far)
 * - Output 2: Near plane distance (float)
 * - Output 3: Far plane distance (float)
 *
 * @example
 * ```typescript
 * const nearFar = new CameraNearFarNode();
 * const depth = new DepthNode();
 *
 * // Linearize depth buffer value
 * // linearDepth = (2.0 * near) / (far + near - depth * (far - near))
 * const farMinusNear = new CompSubNode();
 * farMinusNear.connectInput(1, nearFar, 3); // far
 * farMinusNear.connectInput(2, nearFar, 2); // near
 *
 * // Use for distance fog
 * const fogFactor = new SaturateNode();
 * fogFactor.connectInput(1, linearDepthCalc, 1);
 * ```
 *
 * @public
 */
export class CameraNearFarNode extends BaseGraphNode {
  /**
   * Creates a new camera near/far node
   *
   * @remarks
   * Initializes with 3 output slots: combined vec2 and individual near/far values.
   */
  constructor() {
    super();
    this._outputs = [
      { id: 1, name: '' },
      { id: 2, name: 'near', swizzle: 'x' },
      { id: 3, name: 'far', swizzle: 'y' }
    ];
  }
  /**
   * Generates a string representation of this node
   *
   * @returns 'camera near far'
   */
  toString() {
    return 'camera near far';
  }
  /**
   * Gets the serialization descriptor for this node type
   *
   * @returns Serialization class descriptor
   */
  static getSerializationCls(): SerializableClass {
    return {
      ctor: CameraNearFarNode,
      name: 'CameraNearFarNode',
      getProps() {
        return [];
      }
    };
  }
  /**
   * Validates the node state
   *
   * @returns Empty string (always valid)
   *
   * @remarks
   * Camera near/far nodes are always valid as they have no inputs.
   */
  protected validate(): string {
    return '';
  }
  /**
   * Gets the output type for a specific output slot
   *
   * @param id - The output slot ID
   * @returns 'float' for individual component outputs (id \> 1), 'vec2' for combined output
   */
  protected getType(id: number): string {
    return id > 1 ? 'float' : 'vec2';
  }
}
