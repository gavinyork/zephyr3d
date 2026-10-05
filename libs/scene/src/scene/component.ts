import type { Nullable } from '@zephyr3d/base';
import type { SceneNode } from './scene_node';

/**
 * Behaviour attached to a {@link SceneNode} through {@link SceneNode.addComponent}.
 *
 * @remarks
 * A component holds stable, serializable configuration and rebuilds whatever
 * runtime state it needs when its host enters a scene; nothing it creates at
 * runtime is serialized. The node drives the lifecycle:
 *
 * - `attach` when the component is added to a node, `detach` when it is removed;
 * - `hostAttached` / `hostDetached` when the host (or an ancestor) enters or
 *   leaves a scene, so runtime state can be created and released;
 * - `dispose` after it is removed from the node or when the node is disposed.
 *
 * A component belongs to at most one node at a time.
 *
 * @public
 */
export interface SceneNodeComponent {
  /** The node this component is attached to, or null. */
  readonly host: Nullable<SceneNode>;
  /** Whether the component has been disposed. */
  readonly disposed: boolean;
  /** Called when the component is added to `host`. */
  attach(host: SceneNode): void;
  /** Called when the component is removed from `host`. */
  detach(host?: SceneNode): void;
  /** Called when the host enters a scene. */
  hostAttached(): void;
  /** Called when the host leaves a scene. */
  hostDetached(): void;
  /** Releases the component. */
  dispose(): void;
  /** Type guard for GPU cloth, which keeps its own serialized property. @internal */
  isGPUClothComponent?(): boolean;
}

/** Constructor of a component type. @public */
export type SceneNodeComponentType<T extends SceneNodeComponent = SceneNodeComponent> = abstract new (
  ...args: any[]
) => T;

const componentTypes: SceneNodeComponentType[] = [];

/**
 * Makes a component type available to the generic `Components` property of
 * scene nodes, so the editor can create it and scenes can serialize it.
 *
 * @remarks
 * The type must also be registered with the resource manager as a serializable
 * class. Packages outside `@zephyr3d/scene` (physics, for one) call this when
 * they initialize. Registering a type twice has no effect.
 *
 * @public
 */
export function registerSceneNodeComponentType(type: SceneNodeComponentType) {
  if (!componentTypes.includes(type)) {
    componentTypes.push(type);
  }
}

/**
 * The registered component types.
 *
 * @remarks
 * The returned array is live: types registered later appear in it.
 *
 * @public
 */
export function getSceneNodeComponentTypes(): readonly SceneNodeComponentType[] {
  return componentTypes;
}
