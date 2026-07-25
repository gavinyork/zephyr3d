import type { Nullable } from '@zephyr3d/base';
import type { RGHandle, RGTextureHandle } from './types';

/** Typed key used to publish a frame resource. @public */
export type FrameResourceKey<THandle extends RGHandle = RGHandle> = string & {
  readonly __frameResourceHandle: THandle;
};

type FrameResourceMap = {
  readonly SceneColor: FrameResourceKey<RGTextureHandle>;
  readonly SceneColorCopy: FrameResourceKey<RGTextureHandle>;
  readonly LinearDepth: FrameResourceKey<RGTextureHandle>;
  readonly SceneDepthAttachment: FrameResourceKey<RGTextureHandle>;
  readonly MotionVector: FrameResourceKey<RGTextureHandle>;
  readonly HiZ: FrameResourceKey<RGTextureHandle>;
  readonly SceneRoughness: FrameResourceKey<RGTextureHandle>;
  readonly SceneNormal: FrameResourceKey<RGTextureHandle>;
  readonly SSSProfile: FrameResourceKey<RGTextureHandle>;
  readonly SSSParam: FrameResourceKey<RGTextureHandle>;
  readonly SSSDiffuse: FrameResourceKey<RGTextureHandle>;
  readonly SSSTransmission: FrameResourceKey<RGTextureHandle>;
  readonly SkinSSS: FrameResourceKey<RGTextureHandle>;
  readonly ShadowMask: FrameResourceKey<RGTextureHandle>;
  readonly PresentedColor: FrameResourceKey<RGTextureHandle>;
};

/** Well-known frame resource names shared through {@link RGBlackboard}. @public */
export const FrameResources = {
  SceneColor: 'sceneColor',
  SceneColorCopy: 'sceneColorCopy',
  LinearDepth: 'linearDepth',
  SceneDepthAttachment: 'sceneDepthAttachment',
  MotionVector: 'motionVector',
  HiZ: 'hiZ',
  SceneRoughness: 'sceneRoughness',
  SceneNormal: 'sceneNormal',
  SSSProfile: 'sssProfile',
  SSSParam: 'sssParam',
  SSSDiffuse: 'sssDiffuse',
  SSSTransmission: 'sssTransmission',
  SkinSSS: 'skinSSS',
  ShadowMask: 'shadowMask',
  /** Final presented color. The last registration becomes the graph sink. */
  PresentedColor: 'presentedColor'
} as unknown as FrameResourceMap;

/** Per-frame registry of named render graph resources. @public */
export class RGBlackboard {
  /** @internal */
  private _handles: Map<string, RGHandle> = new Map();
  /** Register or replace a resource handle. */
  set<THandle extends RGHandle>(name: FrameResourceKey<THandle>, handle: THandle): void {
    this._handles.set(name, handle);
  }
  /** Return a resource handle, or null when absent. */
  get<THandle extends RGHandle = RGHandle>(name: FrameResourceKey<THandle>): Nullable<THandle> {
    return (this._handles.get(name) as THandle | undefined) ?? null;
  }
  /** Check whether a resource is registered. */
  has(name: FrameResourceKey): boolean {
    return this._handles.has(name);
  }
  /** Return a required resource handle. */
  expect<THandle extends RGHandle = RGHandle>(name: FrameResourceKey<THandle>): THandle {
    const handle = this._handles.get(name);
    if (!handle) {
      throw new Error(`RGBlackboard: required frame resource "${name}" was not registered`);
    }
    return handle as THandle;
  }
  /** Remove all registered handles. */
  clear(): void {
    this._handles.clear();
  }
}
