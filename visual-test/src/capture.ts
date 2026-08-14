import { getDevice, getEngine, PerspectiveCamera, Scene } from '@zephyr3d/scene';
import type { Application } from '@zephyr3d/scene';
import type { FrameBuffer, Texture2D } from '@zephyr3d/device';
import type { BackendId, CaptureResult, VisualScene } from './types';

/** Fixed timestep for every scene. 60Hz, so elapsed time is frames/60 exactly. */
const FIXED_DT_MS = 1000 / 60;

/**
 * Renders a scene deterministically and reads the pixels back.
 *
 * Determinism comes from three engine facilities, none of which is new here:
 *
 *  - `device.setFixedFrameTime()` replaces the wall clock with a synthetic one
 *    seeded at 0, so anything time-driven is a function of the frame index.
 *  - `Application.stepFrame()` advances per-frame non-idempotent state (history
 *    ping-pong, frame counter, motion-vector matrices) exactly once, which the
 *    run loop cannot guarantee.
 *  - TAA jitter is `Camera._halton23[frameCounter % n]`, so it too is pinned by
 *    the frame counter rather than by time.
 *
 * The capture target is a fixed-size offscreen framebuffer, not the canvas.
 * That removes DPR, swapchain lifetime, alpha premultiplication and compositor
 * colour management from the picture in one move - and, unlike the swapchain
 * texture, the FBO stays readable after the frame ends, so the "no await
 * between the last draw and the capture" constraint that the editor's canvas
 * capture lives under does not apply.
 *
 * The framebuffer is deliberately colour-only: when the final framebuffer has
 * no depth attachment the render graph owns depth itself
 * (`graphDepthAttachmentHandle` in forward_plus_builder.ts), which is the
 * default path and keeps `SceneDepthAttachment` registered for the passes that
 * consume it.
 */
export class SceneCapturer {
  private readonly _app: Application;
  private readonly _backend: BackendId;
  private readonly _size: number;
  private _colorTex: Texture2D;
  private _framebuffer: FrameBuffer;

  constructor(app: Application, backend: BackendId, size: number) {
    this._app = app;
    this._backend = backend;
    this._size = size;
    const device = getDevice();
    const tex = device.createTexture2D('rgba8unorm', size, size, {
      samplerOptions: { mipFilter: 'none' }
    });
    if (!tex) {
      throw new Error('SceneCapturer: failed to create the capture colour texture');
    }
    this._colorTex = tex;
    this._framebuffer = device.createFrameBuffer([tex], null);
  }

  get size() {
    return this._size;
  }

  async capture(def: VisualScene): Promise<CaptureResult> {
    const device = getDevice();
    const frames = Math.max(1, Math.floor(def.frames ?? 1));

    const scene = new Scene();
    const camera = new PerspectiveCamera(scene, Math.PI / 3, 0.1, 100);
    scene.mainCamera = camera;

    try {
      await def.setup({ scene, camera, size: this._size, backend: this._backend });

      // Bind the capture framebuffer from inside engine.render(): Application
      // .frame() unconditionally resets the framebuffer to null at the top of
      // every frame, so binding it before stepFrame() would have no effect.
      getEngine().setRenderable(scene, 0, {
        beforeRender: () => {
          device.setFramebuffer(this._framebuffer);
          device.setViewport(null);
          device.setScissor(null);
          return true;
        }
      });

      device.setFixedFrameTime(FIXED_DT_MS);
      let stalls = 0;
      for (let i = 0; i < frames; i++) {
        // Yield a macrotask between frames so in-flight promise chains (lazily
        // fetched environment maps, shader compilation continuations) can
        // settle. Deliberately not requestAnimationFrame: headless pages must
        // not depend on compositor vsync.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (!this._app.stepFrame()) {
          // beginFrame() refused - context lost, or a device still coming up.
          if (++stalls > 100) {
            throw new Error(`scene "${def.name}": device refused to begin a frame (context lost?)`);
          }
          i--;
          continue;
        }
        stalls = 0;
      }

      // Camera.render() wraps rendering in push/popDeviceStates(), so the
      // binding is back to null by now; rebind before reading back.
      device.setFramebuffer(this._framebuffer);
      const raw = new Uint8Array(this._size * this._size * 4);
      await device.readPixels(0, 0, 0, this._size, this._size, raw);
      device.setFramebuffer(null);

      return {
        name: def.name,
        width: this._size,
        height: this._size,
        rgbaBase64: toBase64(normalizeRowOrder(raw, this._size, this._backend)),
        frames,
        tolerance: def.tolerance
      };
    } finally {
      getEngine().setRenderable(null, 0);
      device.setFixedFrameTime(null);
      scene.dispose();
    }
  }

  dispose() {
    this._framebuffer?.dispose();
    this._colorTex?.dispose();
  }
}

/**
 * Brings the capture to row 0 = top of the image, so baseline PNGs are the right
 * way up and the two backends are directly comparable.
 *
 * Both backends need the same flip, which is *not* what the readback APIs alone
 * would suggest - `gl.readPixels` is documented bottom-up while WebGPU's
 * `copyTextureToBuffer` is top-down, so the naive expectation is that only WebGL
 * needs flipping. Measured with the `sanity-orientation` scene, that is wrong:
 * flipping WebGL alone leaves the WebGPU capture vertically mirrored. The
 * orientation that dominates is the engine's own - it renders bottom-up into an
 * offscreen framebuffer on both backends - so buffer row 0 is the bottom of the
 * image either way.
 *
 * This stays parameterised on `backend` because that symmetry is an empirical
 * fact about the current engine rather than a guarantee; if a backend ever
 * diverges, `sanity-orientation` is what will catch it, and this is the one
 * place to encode it.
 */
export function normalizeRowOrder(rgba: Uint8Array, size: number, _backend: BackendId): Uint8Array {
  const stride = size * 4;
  const out = new Uint8Array(rgba.length);
  for (let y = 0; y < size; y++) {
    out.set(rgba.subarray(y * stride, y * stride + stride), (size - 1 - y) * stride);
  }
  return out;
}

function toBase64(bytes: Uint8Array): string {
  // Chunked so a 512x512 RGBA buffer (1 MiB) does not blow the argument limit
  // of String.fromCharCode.
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as unknown as number[]);
  }
  return btoa(s);
}
