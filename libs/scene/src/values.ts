/**
 * Forward render pass type
 * @public
 */
export const RENDER_PASS_TYPE_FORWARD = 0;
/**
 * Shadow map render pass type
 * @public
 */
export const RENDER_PASS_TYPE_SHADOWMAP = 1;
/**
 * Depth only render pass type
 * @public
 */
export const RENDER_PASS_TYPE_DEPTH_ONLY = 2;
/**
 * Max light count for forward rendering
 * @internal
 */
export const MAX_FORWARD_LIGHT_COUNT = 8;

/** @internal */
export const DEBUG_CASCADED_SHADOW_MAPS = false;

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
