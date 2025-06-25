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
 * Object color render pass type
 * @public
 */
export const RENDER_PASS_TYPE_OBJECT_COLOR = 3;

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

// Morph target attributes

/** @internal */
export const MORPH_TARGET_POSITION = 0;
/** @internal */
export const MORPH_TARGET_NORMAL = 1;
/** @internal */
export const MORPH_TARGET_TANGENT = 2;
/** @internal */
export const MORPH_TARGET_COLOR = 3;
/** @internal */
export const MORPH_TARGET_TEX0 = 4;
/** @internal */
export const MORPH_TARGET_TEX1 = 5;
/** @internal */
export const MORPH_TARGET_TEX2 = 6;
/** @internal */
export const MORPH_TARGET_TEX3 = 7;
/** @internal */
export const MAX_MORPH_ATTRIBUTES = 8;
/** @internal */
export const MAX_MORPH_TARGETS = 256;
/** @internal */
export const MORPH_WEIGHTS_VECTOR_COUNT = (MAX_MORPH_TARGETS + 3) >> 2;
/** @internal */
export const MORPH_ATTRIBUTE_VECTOR_COUNT = (MAX_MORPH_ATTRIBUTES + 3) >> 2;

/** @internal */
export const MAX_TERRAIN_MIPMAP_LEVELS = 64;

/** @internal */
export const MAX_GERSTNER_WAVE_COUNT = 16;

/**
 * Material varying flags
 * @public
 */
export const enum MaterialVaryingFlags {
  MORPH_ANIMATION = 1 << 0,
  SKIN_ANIMATION = 1 << 1,
  INSTANCING = 1 << 2,
  SSR_STORE_ROUGHNESS = 1 << 3
}
