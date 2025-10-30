import type { SerializableClass } from '../../serialization';
import { BaseGraphNode } from '../node';

/**
 * PBR (Physically Based Rendering) material output node
 *
 * @remarks
 * This is the final output node for PBR materials in the material blueprint graph.
 * It defines the complete surface properties using the metallic-roughness workflow,
 * which is the industry-standard approach for physically-based materials.
 *
 * The node accepts all essential PBR material properties:
 * - **BaseColor**: The diffuse/albedo color of the surface (what color the surface is)
 * - **Metallic**: Whether the surface is metallic (0 = dielectric/non-metal, 1 = metal)
 * - **Roughness**: How rough/smooth the surface is (0 = mirror smooth, 1 = completely rough)
 * - **Specular**: Controls specular reflectance for dielectrics (non-metals)
 * - **Emissive**: Light emitted by the surface (for glowing effects)
 * - **Normal**: Surface normal in tangent/world space (for bump/normal mapping)
 * - **Tangent**: Surface tangent vector (for anisotropic effects)
 * - **Opacity**: Surface transparency (0 = fully transparent, 1 = fully opaque)
 *
 * All inputs are optional and have sensible defaults. Only the inputs you connect
 * will override the default values.
 *
 * Material workflow:
 * 1. Connect texture samples and math nodes to the various inputs
 * 2. The shader compiler will generate appropriate PBR lighting code
 * 3. The material will respond correctly to scene lighting
 *
 * @example
 * ```typescript
 * const output = new PBRBlockNode();
 *
 * // Basic textured material
 * const albedoTex = new TextureSampleNode();
 * output.connectInput(1, albedoTex, 1); // BaseColor from texture
 *
 * // Metal/rough workflow
 * const metallicTex = new TextureSampleNode();
 * const roughnessTex = new TextureSampleNode();
 * output.connectInput(2, metallicTex, 2); // Metallic from R channel
 * output.connectInput(3, roughnessTex, 2); // Roughness from R channel
 *
 * // Normal mapping
 * const normalMap = new TextureSampleNode();
 * output.connectInput(6, normalMap, 1); // Normal from RGB
 *
 * // Emissive glow
 * const emissiveColor = new ConstantVec3Node();
 * emissiveColor.x = 1.0; // Red glow
 * output.connectInput(5, emissiveColor, 1);
 * ```
 *
 * @example
 * ```typescript
 * // Advanced material with procedural roughness variation
 * const output = new PBRBlockNode();
 *
 * const baseColor = new ConstantVec3Node();
 * baseColor.x = 0.8; baseColor.y = 0.2; baseColor.z = 0.1; // Orange
 * output.connectInput(1, baseColor, 1);
 *
 * // Procedural roughness pattern
 * const uv = new VertexUVNode();
 * const noise = new NoiseNode();
 * noise.connectInput(1, uv, 1);
 *
 * const roughness = new MixNode();
 * roughness.connectInput(1, constant0_3, 1); // Min roughness 0.3
 * roughness.connectInput(2, constant0_8, 1); // Max roughness 0.8
 * roughness.connectInput(3, noise, 1);       // Blend factor
 * output.connectInput(3, roughness, 1);
 *
 * // Non-metallic
 * const metallic = new ConstantScalarNode();
 * metallic.x = 0.0;
 * output.connectInput(2, metallic, 1);
 * ```
 *
 * @public
 */
export class PBRBlockNode extends BaseGraphNode {
  /**
   * Creates a new PBR material output node
   *
   * @remarks
   * Initializes with 8 input slots for all PBR material properties.
   * Each input has:
   * - Flexible type acceptance (float can expand to vec3/vec4, etc.)
   * - Default values for when no connection is made
   * - Origin type that defines the expected canonical type
   *
   * Default values provide a reasonable starting material:
   * - White base color (1, 1, 1, 1)
   * - Fully metallic (1.0)
   * - Fully rough (1.0)
   * - White specular (1, 1, 1)
   * - No emission (0, 0, 0)
   * - Default surface normal (from vertex data)
   * - Default tangent (from vertex data)
   * - Fully opaque (1.0)
   */
  constructor() {
    super();
    this._inputs = [
      {
        id: 1,
        name: 'BaseColor',
        type: ['float', 'vec2', 'vec3', 'vec4'],
        defaultValue: [1, 1, 1, 1],
        originType: 'vec4'
      },
      {
        id: 2,
        name: 'Metallic',
        type: ['float'],
        defaultValue: 1,
        originType: 'float'
      },
      {
        id: 3,
        name: 'Roughness',
        type: ['float'],
        defaultValue: 1,
        originType: 'float'
      },
      {
        id: 4,
        name: 'Specular',
        type: ['float', 'vec2', 'vec3', 'vec4'],
        defaultValue: [1, 1, 1],
        originType: 'vec3'
      },
      {
        id: 5,
        name: 'Emissive',
        type: ['float', 'vec2', 'vec3', 'vec4'],
        defaultValue: [0, 0, 0],
        originType: 'vec3'
      },
      {
        id: 6,
        name: 'Normal',
        type: ['vec3', 'vec4'],
        originType: 'vec3'
      },
      {
        id: 7,
        name: 'Tangent',
        type: ['vec3'],
        originType: 'vec3'
      },
      {
        id: 8,
        name: 'Opacity',
        type: ['float'],
        defaultValue: 1,
        originType: 'float'
      }
    ];
  }
  /**
   * Gets the serialization descriptor for this node type
   *
   * @returns Serialization class descriptor
   *
   * @remarks
   * No additional properties need to be serialized beyond the base node data
   * and input connections.
   */
  static getSerializationCls(): SerializableClass {
    return {
      ctor: PBRBlockNode,
      name: 'PBRBlockNode',
      getProps() {
        return [];
      }
    };
  }
  /**
   * Generates a string representation of this node
   *
   * @returns 'Output'
   *
   * @remarks
   * This node is typically labeled "Output" in the material editor UI
   * as it represents the final material output.
   */
  toString(): string {
    return 'Output';
  }
  /**
   * Validates the node state
   *
   * @returns Empty string (always valid)
   *
   * @remarks
   * The PBR output node is always valid because:
   * - All inputs are optional (have default values)
   * - Type conversions are handled automatically (float → vec3, etc.)
   * - It's the terminal node with no type inference requirements
   */
  protected validate(): string {
    return '';
  }
  /**
   * Gets the output type
   *
   * @returns Empty string (no outputs)
   *
   * @remarks
   * As a terminal output node, PBRBlockNode has no outputs.
   * It consumes the material graph data and provides it to the renderer.
   */
  protected getType(): string {
    return '';
  }
}

/**
 * Vertex output node
 *
 * @public
 */
export class VertexBlockNode extends BaseGraphNode {
  constructor() {
    super();
    this._inputs = [
      {
        id: 1,
        name: 'Position',
        type: ['vec3'],
        originType: 'vec3'
      },
      {
        id: 2,
        name: 'Normal',
        type: ['vec3'],
        originType: 'vec3'
      },
      {
        id: 3,
        name: 'Tangent',
        type: ['vec4'],
        originType: 'vec4'
      },
      {
        id: 4,
        name: 'Color',
        type: ['vec4'],
        defaultValue: [1, 1, 1, 1],
        originType: 'vec4'
      },
      {
        id: 5,
        name: 'UV',
        type: ['vec2'],
        originType: 'vec2'
      }
    ];
  }
  /**
   * Gets the serialization descriptor for this node type
   *
   * @returns Serialization class descriptor
   *
   * @remarks
   * No additional properties need to be serialized beyond the base node data
   * and input connections.
   */
  static getSerializationCls(): SerializableClass {
    return {
      ctor: VertexBlockNode,
      name: 'VertexBlockNode',
      getProps() {
        return [];
      }
    };
  }
  /**
   * Generates a string representation of this node
   *
   * @returns 'Output'
   *
   * @remarks
   * This node is typically labeled "Output" in the material editor UI
   * as it represents the final material output.
   */
  toString(): string {
    return 'VertexOutput';
  }
  /**
   * Validates the node state
   *
   * @returns Empty string (always valid)
   *
   * @remarks
   * The PBR output node is always valid because:
   * - All inputs are optional (have default values)
   * - Type conversions are handled automatically (float → vec3, etc.)
   * - It's the terminal node with no type inference requirements
   */
  protected validate(): string {
    return '';
  }
  /**
   * Gets the output type
   *
   * @returns Empty string (no outputs)
   *
   * @remarks
   * As a terminal output node, PBRBlockNode has no outputs.
   * It consumes the material graph data and provides it to the renderer.
   */
  protected getType(): string {
    return '';
  }
}
