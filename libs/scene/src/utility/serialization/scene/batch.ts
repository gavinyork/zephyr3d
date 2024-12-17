import { BatchGroup, type SceneNode } from "../../../scene";
import type { Scene } from "../../../scene/scene";
import type { SerializableClass } from "../types";
import { sceneNodeClass } from "./node";

export const batchGroupClass: SerializableClass<SceneNode> = {
  ctor: BatchGroup,
  parent: sceneNodeClass,
  className: 'BatchGroup',
  createFunc(scene: Scene) {
    return new BatchGroup(scene);
  },
  getProps() {
    return [];
  }
}
