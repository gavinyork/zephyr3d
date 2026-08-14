import type { PerspectiveCamera, Scene } from '@zephyr3d/scene';

/** Backends the harness can drive. Extend alongside playwright.config.ts. */
export type BackendId = 'webgl2' | 'webgpu';

/** What a scene is handed to build itself into. */
export interface SceneContext {
  scene: Scene;
  camera: PerspectiveCamera;
  /** Edge length of the offscreen capture framebuffer, in pixels. */
  size: number;
  backend: BackendId;
}

/** Per-scene comparison tolerance. Omitted fields fall back to the defaults in tests/compare.ts. */
export interface Tolerance {
  /**
   * Per-pixel perceptual tolerance handed to pixelmatch (0..1). Lower is
   * stricter. Raise only for scenes with genuine rasterisation noise.
   */
  threshold?: number;
  /** Fraction of pixels allowed to differ before the scene fails (0..1). */
  maxDiffPixelRatio?: number;
}

/**
 * One regression scene.
 *
 * Scenes must be pure functions of their setup: no wall-clock time, no
 * `Math.random()`, no unawaited asset loads. The harness enforces a fixed
 * timestep and a fixed frame count, but it cannot enforce these.
 */
export interface VisualScene {
  /** Stable identifier. Doubles as the baseline filename, so renaming orphans a baseline. */
  name: string;
  /** One-line note on what regressing this scene would mean. */
  description: string;
  /**
   * Frames to step before capturing. Keep at 1 unless the feature under test
   * accumulates across frames (TAA, SSR/SSGI history, motion vectors), in which
   * case the count is part of what is being pinned.
   */
  frames?: number;
  /** Return false to skip this scene on a backend that cannot run it. */
  supports?: (backend: BackendId) => boolean;
  /** Build the scene. Must await every asset it needs. */
  setup: (ctx: SceneContext) => void | Promise<void>;
  tolerance?: Tolerance;
}

/** Result of a single scene capture, as handed back to the Playwright runner. */
export interface CaptureResult {
  name: string;
  width: number;
  height: number;
  /** Base64 RGBA8, row 0 = top. Base64 rather than an array to keep the CDP payload small. */
  rgbaBase64: string;
  frames: number;
  tolerance?: Tolerance;
}
