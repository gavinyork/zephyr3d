/**
 * Forward render pass type
 * @public
 */
export const RENDER_PASS_TYPE_LIGHT = 0;
/**
 * Shadow map render pass type
 * @public
 */
export const RENDER_PASS_TYPE_SHADOWMAP = 1;
/**
 * Depth only render pass type
 * @public
 */
export const RENDER_PASS_TYPE_DEPTH = 2;

/**
 * Builtin texture name for sheen LUT
 * @public
 */
export const BUILTIN_ASSET_TEXTURE_SHEEN_LUT = 'LUT_Sheen';

/**
 * Builtin cube texture for test
 * @public
 */
export const BUILTIN_ASSET_TEST_CUBEMAP = 'TEST_Cubemap';

/**
 * No light
 * @public
 */
export const LIGHT_TYPE_NONE = 0;

/**
 * Directional light type
 * @public
 */
export const LIGHT_TYPE_DIRECTIONAL = 1;

/**
 * Point light type
 * @public
 */
export const LIGHT_TYPE_POINT = 2;

/**
 * Spot light type
 * @public
 */
export const LIGHT_TYPE_SPOT = 3;

/**
 * Max light size for clustered lighting
 * @public
 */
export const MAX_CLUSTERED_LIGHTS = 255;

/**
 * Opaque render queue type
 * @public
 */
export const QUEUE_OPAQUE = 1;

/**
 * Transparent render queue type
 * @public
 */
export const QUEUE_TRANSPARENT = 2;

/**
 * Morph target attributes
 */
export const MORPH_TARGET_POSITION = 1 << 0;
export const MORPH_TARGET_NORMAL = 1 << 1;
export const MORPH_TARGET_TANGENT = 1 << 2;
export const MORPH_TARGET_COLOR = 1 << 3;
export const MORPH_TARGET_TEX0 = 1 << 4;
export const allMorphTargets = [
  MORPH_TARGET_POSITION,
  MORPH_TARGET_NORMAL,
  MORPH_TARGET_TANGENT,
  MORPH_TARGET_TEX0,
  MORPH_TARGET_COLOR
];
export const MORPH_WEIGHTS_VECTOR_COUNT = 64;
export const MAX_MORPH_TARGETS = MORPH_WEIGHTS_VECTOR_COUNT * 4;
export const MORPH_ATTRIBUTE_VECTOR_COUNT = 2;
export const MAX_MORPH_ATTRIBUTES = MORPH_ATTRIBUTE_VECTOR_COUNT * 4;
