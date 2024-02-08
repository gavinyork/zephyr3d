import { Application } from '../app';
import type { Vector4 } from '@zephyr3d/base';
import type { TextureFormat } from '@zephyr3d/device';
import type { Camera } from '../camera/camera';
import type { Scene } from '../scene/scene';
import type { Compositor } from '../posteffect';
import type { DrawContext } from '.';

/**
 * Base class for any kind of render scheme
 * @public
 */
export abstract class RenderScheme {
  /** @internal */
  protected _shadowMapFormat: TextureFormat;
  /** @internal */
  protected _enableDepthPass: boolean;
  /** @internal */
  protected _currentScene: Scene;
  /**
   * Creates an instance of RenderScheme
   */
  constructor() {
    this._shadowMapFormat = null;
    this._enableDepthPass = false;
    this._currentScene = null;
  }
  /** True if an early depth pass is required  */
  get requireDepthPass(): boolean {
    return this._enableDepthPass;
  }
  set requireDepthPass(val: boolean) {
    this._enableDepthPass = !!val;
  }
  /** The scene that is currently been rendered */
  get currentScene(): Scene {
    return this._currentScene;
  }
  /**
   * Renders a scene by given camera
   * @param scene - The scene to be rendered
   * @param camera - The camera that will be used to render the scene
   */
  renderScene(scene: Scene, camera: Camera, compositor?: Compositor): void {
    this._currentScene = scene;
    const ctx = { scene, camera, compositor } as DrawContext;
    scene.frameUpdate();
    if (camera && !Application.instance.device.isContextLost()) {
      this._renderScene(ctx);
    }
    this._currentScene = null;
  }
  /**
   * Disposes the render scheme
   */
  dispose(): void {
    this._dispose();
  }
  /**
   * Gets the texture format for shadow maps
   * @returns Texture format for shadow maps
   */
  getShadowMapFormat(): TextureFormat {
    if (!this._shadowMapFormat) {
      const device = Application.instance.device;
      this._shadowMapFormat = device.getDeviceCaps().textureCaps.supportHalfFloatColorBuffer
        ? device.type === 'webgl'
          ? 'rgba16f'
          : 'r16f'
        : device.getDeviceCaps().textureCaps.supportFloatColorBuffer
        ? device.type === 'webgl'
          ? 'rgba32f'
          : 'r32f'
        : 'rgba8unorm';
    }
    return this._shadowMapFormat;
  }
  /** @internal */
  abstract setClearParams(color: Vector4, depth: number, stencil: number): void;
  /** @internal */
  protected abstract _renderScene(ctx: DrawContext): void;
  /** @internal */
  protected abstract _dispose(): void;
}
