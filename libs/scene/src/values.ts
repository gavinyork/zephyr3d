import { Vector3 } from '@zephyr3d/base';

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

/** @internal */
export const uniformSphereSamples = [
  new Vector3(-0.7838, -0.620933, 0.00996137),
  new Vector3(0.106751, 0.965982, 0.235549),
  new Vector3(-0.215177, -0.687115, -0.693954),
  new Vector3(0.318002, 0.0640084, -0.945927),
  new Vector3(0.357396, 0.555673, 0.750664),
  new Vector3(0.866397, -0.19756, 0.458613),
  new Vector3(0.130216, 0.232736, -0.963783),
  new Vector3(-0.00174431, 0.376657, 0.926351),
  new Vector3(0.663478, 0.704806, -0.251089),
  new Vector3(0.0327851, 0.110534, -0.993331),
  new Vector3(0.0561973, 0.0234288, 0.998145),
  new Vector3(0.0905264, -0.169771, 0.981317),
  new Vector3(0.26694, 0.95222, -0.148393),
  new Vector3(-0.812874, -0.559051, -0.163393),
  new Vector3(-0.323378, -0.25855, -0.910263),
  new Vector3(-0.1333, 0.591356, -0.795317),
  new Vector3(0.480876, 0.408711, 0.775702),
  new Vector3(-0.332263, -0.533895, -0.777533),
  new Vector3(-0.0392473, -0.704457, -0.708661),
  new Vector3(0.427015, 0.239811, 0.871865),
  new Vector3(-0.416624, -0.563856, 0.713085),
  new Vector3(0.12793, 0.334479, -0.933679),
  new Vector3(-0.0343373, -0.160593, -0.986423),
  new Vector3(0.580614, 0.0692947, 0.811225),
  new Vector3(-0.459187, 0.43944, 0.772036),
  new Vector3(0.215474, -0.539436, -0.81399),
  new Vector3(-0.378969, -0.31988, -0.868366),
  new Vector3(-0.279978, -0.0109692, 0.959944),
  new Vector3(0.692547, 0.690058, 0.210234),
  new Vector3(0.53227, -0.123044, -0.837585),
  new Vector3(-0.772313, -0.283334, -0.568555),
  new Vector3(-0.0311218, 0.995988, -0.0838977),
  new Vector3(-0.366931, -0.276531, -0.888196),
  new Vector3(0.488778, 0.367878, -0.791051),
  new Vector3(-0.885561, -0.453445, 0.100842),
  new Vector3(0.71656, 0.443635, 0.538265),
  new Vector3(0.645383, -0.152576, -0.748466),
  new Vector3(-0.171259, 0.91907, 0.354939),
  new Vector3(-0.0031122, 0.9457, 0.325026),
  new Vector3(0.731503, 0.623089, -0.276881),
  new Vector3(-0.91466, 0.186904, 0.358419),
  new Vector3(0.15595, 0.828193, -0.538309),
  new Vector3(0.175396, 0.584732, 0.792038),
  new Vector3(-0.0838381, -0.943461, 0.320707),
  new Vector3(0.305876, 0.727604, 0.614029),
  new Vector3(0.754642, -0.197903, -0.62558),
  new Vector3(0.217255, -0.0177771, -0.975953),
  new Vector3(0.140412, -0.844826, 0.516287),
  new Vector3(-0.549042, 0.574859, -0.606705),
  new Vector3(0.570057, 0.17459, 0.802841),
  new Vector3(-0.0330304, 0.775077, 0.631003),
  new Vector3(-0.938091, 0.138937, 0.317304),
  new Vector3(0.483197, -0.726405, -0.48873),
  new Vector3(0.485263, 0.52926, 0.695991),
  new Vector3(0.224189, 0.742282, -0.631472),
  new Vector3(-0.322429, 0.662214, -0.676396),
  new Vector3(0.625577, -0.12711, 0.769738),
  new Vector3(-0.714032, -0.584461, -0.385439),
  new Vector3(-0.0652053, -0.892579, -0.446151),
  new Vector3(0.408421, -0.912487, 0.0236566),
  new Vector3(0.0900381, 0.319983, 0.943135),
  new Vector3(-0.708553, 0.483646, 0.513847),
  new Vector3(0.803855, -0.0902273, 0.587942),
  new Vector3(-0.0555802, -0.374602, -0.925519)
];
