/** Render graph history resource names. @public */
export const RGHistoryResources = {
  TAA_COLOR: 'taaColor',
  TAA_MOTION_VECTOR: 'taaMotionVector',
  SSR_REFLECT: 'ssrReflect',
  SSR_MOTION_VECTOR: 'ssrMotionVector',
  /** Opaque linear-HDR scene color sampled by SSGI rays on the next frame. */
  SSGI_SCENE_COLOR: 'ssgiSceneColor',
  /** Denoised diffuse irradiance reprojected into the next frame's lighting pass. */
  SSGI_IRRADIANCE: 'ssgiIrradiance',
  /** Depth/normal surface data used to validate SSGI reprojection. */
  SSGI_SURFACE: 'ssgiSurface',
  /** First and second luminance moments used by the SSGI temporal filter. */
  SSGI_MOMENTS: 'ssgiMoments',
  /** Temporally accumulated screen space ambient occlusion traced alongside SSGI. */
  SSGI_AO: 'ssgiAO'
} as const;
