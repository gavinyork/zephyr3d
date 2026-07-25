import type { Nullable } from '@zephyr3d/base';
import type { RGHandle } from './types';

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
} as const;

/** Per-frame registry of named render graph resources. @public */
export class RGBlackboard {
  /** @internal */
  private _handles: Map<string, RGHandle> = new Map();
  /** Register or replace a resource handle. */
  set(name: string, handle: RGHandle): void {
    this._handles.set(name, handle);
  }
  /** Return a resource handle, or null when absent. */
  get(name: string): Nullable<RGHandle> {
    return this._handles.get(name) ?? null;
  }
  /** Check whether a resource is registered. */
  has(name: string): boolean {
    return this._handles.has(name);
  }
  /** Return a required resource handle. */
  expect(name: string): RGHandle {
    const handle = this._handles.get(name);
    if (!handle) {
      throw new Error(`RGBlackboard: required frame resource "${name}" was not registered`);
    }
    return handle;
  }
  /** Remove all registered handles. */
  clear(): void {
    this._handles.clear();
  }
}
