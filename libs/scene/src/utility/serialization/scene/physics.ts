import { Vector3 } from '@zephyr3d/base';
import { ScenePhysicsSettings } from '../../../scene/physics_settings';
import { defineProps, type SerializableClass } from '../types';

/** @internal */
export function getScenePhysicsSettingsClass(): SerializableClass {
  return {
    ctor: ScenePhysicsSettings,
    name: 'ScenePhysicsSettings',
    getProps() {
      return defineProps([
        {
          name: 'Gravity',
          description:
            'Pull on everything that falls, in m/s². Earth is 9.81 straight down; a lower value makes things float down like on the moon',
          type: 'vec3',
          default: [0, -9.81, 0],
          get(this: ScenePhysicsSettings, value) {
            const g = this.gravity;
            value.num[0] = g.x;
            value.num[1] = g.y;
            value.num[2] = g.z;
          },
          set(this: ScenePhysicsSettings, value) {
            this.gravity = new Vector3(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'StepRate',
          description:
            'Simulation steps per second. Higher keeps fast objects and tall stacks steadier but costs more time',
          type: 'int',
          default: 60,
          options: { minValue: 10, maxValue: 240 },
          get(this: ScenePhysicsSettings, value) {
            value.num[0] = Math.round(1 / this.fixedTimeStep);
          },
          set(this: ScenePhysicsSettings, value) {
            this.fixedTimeStep = 1 / Math.max(1, value.num[0]);
          }
        },
        {
          name: 'MaxSubSteps',
          description:
            'Most simulation steps in one frame. When the game runs slower than this allows, objects move in slow motion instead of the game stalling further',
          type: 'int',
          default: 4,
          options: { minValue: 1, maxValue: 16 },
          get(this: ScenePhysicsSettings, value) {
            value.num[0] = this.maxSubSteps;
          },
          set(this: ScenePhysicsSettings, value) {
            this.maxSubSteps = value.num[0];
          }
        },
        {
          name: 'Interpolation',
          description:
            'Smooths moving objects when the frame rate differs from the step rate; without it they may stutter',
          type: 'bool',
          default: true,
          get(this: ScenePhysicsSettings, value) {
            value.bool[0] = this.interpolation;
          },
          set(this: ScenePhysicsSettings, value) {
            this.interpolation = value.bool[0];
          }
        },
        {
          name: 'WaitForCollidersOnStart',
          description:
            'Holds the simulation until mesh and terrain colliders are ready, so nothing falls through the ground in the first frames',
          type: 'bool',
          default: true,
          get(this: ScenePhysicsSettings, value) {
            value.bool[0] = this.waitForCollidersOnStart;
          },
          set(this: ScenePhysicsSettings, value) {
            this.waitForCollidersOnStart = value.bool[0];
          }
        },
        {
          name: 'LayerNames',
          description: 'Names of the 16 collision layers',
          type: 'string',
          isHidden() {
            return true;
          },
          get(this: ScenePhysicsSettings, value) {
            value.str[0] = this.layerNamesData;
          },
          set(this: ScenePhysicsSettings, value) {
            this.layerNamesData = value.str[0];
          }
        },
        {
          name: 'LayerMatrix',
          description: 'Which collision layers collide with which',
          type: 'string',
          isHidden() {
            return true;
          },
          get(this: ScenePhysicsSettings, value) {
            value.str[0] = this.layerMatrixData;
          },
          set(this: ScenePhysicsSettings, value) {
            this.layerMatrixData = value.str[0];
          }
        }
      ]);
    }
  };
}
