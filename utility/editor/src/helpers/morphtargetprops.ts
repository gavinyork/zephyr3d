import { defineProps, SceneNode, type PropertyAccessor } from '@zephyr3d/scene';

export function getMorphTargetGroupPropertyAccessors(object: unknown): PropertyAccessor[] {
  if (!(object instanceof SceneNode)) {
    return [];
  }
  const names = object.collectMorphTargetGroupNames();
  if (names.length === 0) {
    return [];
  }
  return defineProps(
    names.map((name) => ({
      name,
      description: `Morph target group weight: ${name}`,
      type: 'float',
      options: {
        group: 'Morph Target Groups',
        defaultOpen: false,
        minValue: 0,
        maxValue: 1,
        speed: 0.01
      },
      get(this: SceneNode, value) {
        value.num[0] = this.getMorphTargetGroupWeight(name);
      },
      set(this: SceneNode, value) {
        this.setMorphTargetGroupWeight(name, value.num[0]);
      }
    }))
  );
}
