import type { Nullable } from '@zephyr3d/base';
import type { RGHandle } from './types';

/**
 * Canonical names for well-known per-frame resources shared through {@link RGBlackboard}.
 *
 * Producer passes register their output handles under these names so that
 * consumers (e.g. post effects) can declare reads without hard-coupling to
 * the pass that produced them.
 *
 * @public
 */
export const FrameResources = {
  SceneColor: 'sceneColor',
  SceneColorCopy: 'sceneColorCopy',
  LinearDepth: 'linearDepth',
  SceneDepthAttachment: 'sceneDepthAttachment',
  MotionVector: 'motionVector',
  HiZ: 'hiZ',
  SSRRoughness: 'ssrRoughness',
  SSRNormal: 'ssrNormal',
  SSSProfile: 'sssProfile',
  SSSParam: 'sssParam',
  SSSDiffuse: 'sssDiffuse',
  SSSTransmission: 'sssTransmission',
  SkinSSS: 'skinSSS',
  ShadowMask: 'shadowMask'
} as const;

/**
 * Named registry of render graph resource handles for the current frame.
 *
 * The blackboard decouples resource producers from consumers: passes that
 * create shared resources register the returned handles by name, and later
 * passes look them up to declare read dependencies. This replaces passing
 * textures through mutable `DrawContext` fields.
 *
 * A blackboard instance is valid for a single graph build; create a new one
 * (or clear it) every frame together with the graph.
 *
 * @public
 */
export class RGBlackboard {
  /** @internal */
  private _handles: Map<string, RGHandle> = new Map();
  /**
   * Register a resource handle under a name, replacing any previous entry.
   * @param name - Resource name, typically one of {@link FrameResources}.
   * @param handle - The handle to register.
   */
  set(name: string, handle: RGHandle): void {
    this._handles.set(name, handle);
  }
  /**
   * Look up a resource handle by name.
   * @param name - Resource name, typically one of {@link FrameResources}.
   * @returns The registered handle, or null if not present this frame.
   */
  get(name: string): Nullable<RGHandle> {
    return this._handles.get(name) ?? null;
  }
  /**
   * Check whether a resource is registered.
   * @param name - Resource name.
   * @returns true if a handle is registered under the name.
   */
  has(name: string): boolean {
    return this._handles.has(name);
  }
  /**
   * Look up a resource handle that must exist.
   * @param name - Resource name.
   * @returns The registered handle.
   */
  expect(name: string): RGHandle {
    const handle = this._handles.get(name);
    if (!handle) {
      throw new Error(`RGBlackboard: required frame resource "${name}" was not registered`);
    }
    return handle;
  }
  /**
   * Remove all registered handles.
   */
  clear(): void {
    this._handles.clear();
  }
}
