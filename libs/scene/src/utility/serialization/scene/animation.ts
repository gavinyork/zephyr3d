import type { InterpolationMode, InterpolationTarget } from '@zephyr3d/base';
import { Interpolator } from '@zephyr3d/base';
import type { AnimationTrack } from '../../../animation';
import { AnimationClip, PropertyTrack } from '../../../animation';
import type { SerializationManager } from '../manager';
import type { SerializableClass } from '../types';
import type { SceneNode } from '../../../scene';

export function getInterpolatorClass(): SerializableClass {
  return {
    ctor: Interpolator,
    createFunc(
      ctx,
      init: { mode: InterpolationMode; target: InterpolationTarget; inputs: number[]; outputs: number[] }
    ) {
      return { obj: new Interpolator(init.mode, init.target, init.inputs, init.outputs) };
    },
    getInitParams(obj: Interpolator) {
      return {
        mode: obj.mode,
        target: obj.target,
        inputs: obj.inputs instanceof Float32Array ? [...obj.inputs] : obj.inputs ?? [],
        outputs: obj.outputs instanceof Float32Array ? [...obj.outputs] : obj.outputs ?? []
      };
    },
    getProps() {
      return [
        {
          name: 'Mode',
          type: 'string',
          get(this: Interpolator, value) {
            value.str[0] = this.mode;
          }
        },
        {
          name: 'Target',
          type: 'string',
          get(this: Interpolator, value) {
            value.str[0] = this.target;
          }
        },
        {
          name: 'Inputs',
          type: 'string',
          get(this: Interpolator, value) {
            const data = this.inputs instanceof Float32Array ? [...this.inputs] : this.inputs ?? [];
            value.str[0] = JSON.stringify(data);
          },
          set(this: Interpolator, value) {
            const data = JSON.parse(value.str[0]) as number[];
            this.inputs = new Float32Array(data);
          }
        },
        {
          name: 'Outputs',
          type: 'string',
          get(this: Interpolator, value) {
            const data = this.outputs instanceof Float32Array ? [...this.outputs] : this.outputs ?? [];
            value.str[0] = JSON.stringify(data);
          },
          set(this: Interpolator, value) {
            const data = JSON.parse(value.str[0]) as number[];
            this.outputs = new Float32Array(data);
          }
        }
      ];
    }
  };
}

export function getPropTrackClass(manager: SerializationManager): SerializableClass {
  return {
    ctor: PropertyTrack,
    createFunc(ctx, init) {
      return { obj: new PropertyTrack(manager.getPropertyByName(init)) };
    },
    getInitParams(obj: PropertyTrack) {
      return manager.getPropertyName(obj.getProp());
    },
    getProps() {
      return [
        {
          name: 'TrackName',
          label: 'Name',
          type: 'string',
          get(this: PropertyTrack, value) {
            value.str[0] = this.name;
          },
          set(this: PropertyTrack, value) {
            this.name = value.str[0];
          }
        },
        {
          name: 'TrackTarget',
          label: 'Target',
          type: 'string',
          get(this: PropertyTrack, value) {
            value.str[0] = this.target;
          },
          set(this: PropertyTrack, value) {
            this.target = value.str[0];
          }
        },
        {
          name: 'TrackProp',
          type: 'string',
          get(this: PropertyTrack, value) {
            value.str[0] = manager.getPropertyName(this.getProp());
          }
        },
        {
          name: 'TrackData',
          type: 'object_array',
          objectTypes: [Interpolator],
          isHidden(this: PropertyTrack, index: number) {
            return index >= 0;
          },
          get(this: PropertyTrack, value) {
            value.object = this.interpolatorAlpha
              ? [this.interpolator, this.interpolatorAlpha]
              : [this.interpolator];
          },
          set(this: PropertyTrack, value) {
            this.interpolator = value.object[0] as Interpolator;
            this.interpolatorAlpha = value.object[1] as Interpolator;
          }
        }
      ];
    }
  };
}

export function getAnimationClass(manager: SerializationManager): SerializableClass {
  return {
    ctor: AnimationClip,
    createFunc(ctx: SceneNode, init: string) {
      return { obj: ctx.animationSet.createAnimation(init, false) };
    },
    getInitParams(obj: AnimationClip) {
      return obj.name;
    },
    getProps() {
      return [
        {
          name: 'Name',
          type: 'string',
          get(this: AnimationClip, value) {
            value.str[0] = this.name;
          }
        },
        {
          name: 'Duration',
          type: 'float',
          get(this: AnimationClip, value) {
            value.num[0] = this.timeDuration;
          }
        },
        {
          name: 'Tracks',
          type: 'object_array',
          objectTypes: [PropertyTrack],
          edit: 'proptrack',
          readonly: true,
          get(this: AnimationClip, value) {
            value.object = [];
            for (const tracks of this.tracks) {
              value.object.push(...tracks[1].filter((track) => track instanceof PropertyTrack));
            }
          },
          set(this: AnimationClip, value) {
            for (const track of value.object) {
              if (track instanceof PropertyTrack) {
                const targetObj = manager.findAnimationTarget(this._animationSet.model, track);
                if (targetObj) {
                  this.addTrack(targetObj, track);
                }
              }
            }
          },
          delete(this: AnimationClip, index) {
            const trackList: AnimationTrack[] = [];
            for (const tracks of this.tracks) {
              trackList.push(...tracks[1].filter((track) => track instanceof PropertyTrack));
            }
            const trackToRemove = trackList[index];
            if (trackToRemove) {
              this.deleteTrack(trackToRemove);
              return trackToRemove;
            }
            return null;
          }
        }
      ];
    }
  };
}
