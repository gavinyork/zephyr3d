import type { InterpolationMode, InterpolationTarget } from '@zephyr3d/base';
import { Interpolator, Vector3 } from '@zephyr3d/base';
import { AnimationTrack } from '../../../animation';
import {
  AnimationClip,
  MorphTargetTrack,
  NodeEulerRotationTrack,
  NodeRotationTrack,
  NodeScaleTrack,
  NodeTranslationTrack,
  PropertyTrack
} from '../../../animation';
import type { SerializationManager } from '../manager';
import type { SerializableClass } from '../types';
import { SceneNode } from '../../../scene';
import { BoundingBox } from '../../bounding_volume';

/** @internal */
export function getInterpolatorClass(): SerializableClass {
  return {
    ctor: Interpolator,
    name: 'Interpolator',
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

/** @internal */
export function getMorphTrackClass(): SerializableClass {
  return {
    ctor: MorphTargetTrack,
    name: 'MorphTargetTrack',
    getProps() {
      return [
        {
          name: 'TrackName',
          type: 'string',
          options: {
            label: 'Name'
          },
          get(this: MorphTargetTrack, value) {
            value.str[0] = this.name;
          },
          set(this: MorphTargetTrack, value) {
            this.name = value.str[0];
          }
        },
        {
          name: 'Interpolator',
          type: 'object',
          options: {
            objectTypes: [Interpolator]
          },
          isHidden() {
            return true;
          },
          get(this: MorphTargetTrack, value) {
            value.object[0] = this.interpolator;
          },
          set(this: MorphTargetTrack, value) {
            this.interpolator = value.object[0] as Interpolator;
          }
        },
        {
          name: 'DefaultWeights',
          type: 'object',
          get(this: MorphTargetTrack, value) {
            value.object[0] = this.defaultWeights ?? null;
          },
          set(this: MorphTargetTrack, value) {
            this.defaultWeights = (value.object[0] as number[]) ?? null;
          }
        },
        {
          name: 'BoundingBox',
          type: 'object',
          get(this: MorphTargetTrack, value) {
            if (!this.boundingBox) {
              value.object[0] = null;
            } else {
              const arr: number[] = [];
              for (const box of this.boundingBox) {
                arr.push(...box.minPoint);
                arr.push(...box.maxPoint);
              }
              value.object[0] = arr;
            }
          },
          set(this: MorphTargetTrack, value) {
            if (!value.object[0]) {
              this.boundingBox = null;
            } else {
              const arr: BoundingBox[] = [];
              const values = value.object[0] as number[];
              for (let i = 0; i < values.length / 6; i++) {
                arr.push(
                  new BoundingBox(
                    new Vector3(values[i * 6 + 0], values[i * 6 + 1], values[i * 6 + 2]),
                    new Vector3(values[i * 6 + 3], values[i * 6 + 4], values[i * 6 + 5])
                  )
                );
              }
              this.boundingBox = arr;
            }
          }
        }
      ];
    }
  };
}

/** @internal */
export function getNodeRotationTrackClass(): SerializableClass {
  return {
    ctor: NodeRotationTrack,
    name: 'NodeRotationTrack',
    getProps() {
      return [
        {
          name: 'TrackName',
          type: 'string',
          options: {
            label: 'Name'
          },
          get(this: NodeRotationTrack, value) {
            value.str[0] = this.name;
          },
          set(this: NodeRotationTrack, value) {
            this.name = value.str[0];
          }
        },
        {
          name: 'Interpolator',
          type: 'object',
          options: {
            objectTypes: [Interpolator]
          },
          isHidden() {
            return true;
          },
          get(this: NodeRotationTrack, value) {
            value.object[0] = this.interpolator;
          },
          set(this: NodeRotationTrack, value) {
            this.interpolator = value.object[0] as Interpolator;
          }
        }
      ];
    }
  };
}

/** @internal */
export function getNodeEulerRotationTrackClass(): SerializableClass {
  return {
    ctor: NodeEulerRotationTrack,
    name: 'NodeEulerRotationTrack',
    getProps() {
      return [
        {
          name: 'TrackName',
          type: 'string',
          options: {
            label: 'Name'
          },
          get(this: NodeEulerRotationTrack, value) {
            value.str[0] = this.name;
          },
          set(this: NodeEulerRotationTrack, value) {
            this.name = value.str[0];
          }
        },
        {
          name: 'Interpolator',
          type: 'object',
          options: {
            objectTypes: [Interpolator]
          },
          isHidden() {
            return true;
          },
          get(this: NodeEulerRotationTrack, value) {
            value.object[0] = this.interpolator;
          },
          set(this: NodeEulerRotationTrack, value) {
            this.interpolator = value.object[0] as Interpolator;
          }
        }
      ];
    }
  };
}

/** @internal */
export function getNodeTranslationTrackClass(): SerializableClass {
  return {
    ctor: NodeTranslationTrack,
    name: 'NodeTranslationTrack',
    getProps() {
      return [
        {
          name: 'TrackName',
          type: 'string',
          options: {
            label: 'Name'
          },
          get(this: NodeTranslationTrack, value) {
            value.str[0] = this.name;
          },
          set(this: NodeTranslationTrack, value) {
            this.name = value.str[0];
          }
        },
        {
          name: 'Interpolator',
          type: 'object',
          options: {
            objectTypes: [Interpolator]
          },
          isHidden() {
            return true;
          },
          get(this: NodeTranslationTrack, value) {
            value.object[0] = this.interpolator;
          },
          set(this: NodeTranslationTrack, value) {
            this.interpolator = value.object[0] as Interpolator;
          }
        }
      ];
    }
  };
}

/** @internal */
export function getNodeScaleTrackClass(): SerializableClass {
  return {
    ctor: NodeScaleTrack,
    name: 'NodeScaleTrack',
    getProps() {
      return [
        {
          name: 'TrackName',
          type: 'string',
          options: {
            label: 'Name'
          },
          get(this: NodeScaleTrack, value) {
            value.str[0] = this.name;
          },
          set(this: NodeScaleTrack, value) {
            this.name = value.str[0];
          }
        },
        {
          name: 'Interpolator',
          type: 'object',
          options: {
            objectTypes: [Interpolator]
          },
          isHidden() {
            return true;
          },
          get(this: NodeScaleTrack, value) {
            value.object[0] = this.interpolator;
          },
          set(this: NodeScaleTrack, value) {
            this.interpolator = value.object[0] as Interpolator;
          }
        }
      ];
    }
  };
}

/** @internal */
export function getPropTrackClass(manager: SerializationManager): SerializableClass {
  return {
    ctor: PropertyTrack,
    name: 'PropertyTrack',
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
          type: 'string',
          options: {
            label: 'Name'
          },
          get(this: PropertyTrack, value) {
            value.str[0] = this.name;
          },
          set(this: PropertyTrack, value) {
            this.name = value.str[0];
          }
        },
        {
          name: 'TrackTarget',
          type: 'string',
          options: {
            label: 'Target'
          },
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
          options: {
            objectTypes: [Interpolator]
          },
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

/** @internal */
export function getAnimationClass(manager: SerializationManager): SerializableClass {
  return {
    ctor: AnimationClip,
    name: 'AnimationClip',
    createFunc(ctx: SceneNode, init: string) {
      return { obj: ctx.animationSet.get(init) ?? ctx.animationSet.createAnimation(init, false) };
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
          default: 1,
          get(this: AnimationClip, value) {
            value.num[0] = this.timeDuration;
          },
          set(this: AnimationClip, value) {
            this.timeDuration = value.num[0];
          }
        },
        {
          name: 'Weight',
          type: 'float',
          default: 1,
          get(this: AnimationClip, value) {
            value.num[0] = this.weight;
          },
          set(this: AnimationClip, value) {
            this.weight = value.num[0];
          }
        },
        {
          name: 'AutoPlay',
          type: 'bool',
          default: false,
          get(this: AnimationClip, value) {
            value.bool[0] = this.autoPlay;
          },
          set(this: AnimationClip, value) {
            this.autoPlay = value.bool[0];
          }
        },
        {
          name: 'Tracks',
          type: 'object_array',
          options: {
            edit: 'proptrack',
            objectTypes: [PropertyTrack]
          },
          readonly: true,
          isHidden(this: AnimationClip, index: number, obj: unknown) {
            return !(obj instanceof PropertyTrack);
          },
          get(this: AnimationClip, value) {
            value.object = [];
            for (const tracks of this.tracks) {
              for (const track of tracks[1]) {
                if (tracks[0] instanceof SceneNode && !(track instanceof PropertyTrack)) {
                  track.target = tracks[0].persistentId;
                }
              }
              //value.object.push(...tracks[1].filter((track) => track instanceof PropertyTrack));
              value.object.push(...tracks[1].filter((track) => !!track.target));
            }
          },
          set(this: AnimationClip, value) {
            for (const track of value.object) {
              if (track instanceof PropertyTrack) {
                const targetObj = manager.findAnimationTarget(this._animationSet.model, track);
                if (targetObj) {
                  this.addTrack(targetObj, track);
                }
              } else if (track instanceof AnimationTrack) {
                const node = this._animationSet.model.scene.findNodeById(track.target);
                if (node) {
                  this.addTrack(node, track);
                } else {
                  console.error(`No node found with id = ${track.target}`);
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
            }
          }
        }
      ];
    }
  };
}
