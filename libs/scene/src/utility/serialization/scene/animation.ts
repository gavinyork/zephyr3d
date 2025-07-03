import type { InterpolationMode, InterpolationTarget } from '@zephyr3d/base';
import { Interpolator } from '@zephyr3d/base';
import type { AnimationTrack } from '../../../animation';
import { AnimationClip, AnimationSet, PropertyTrack } from '../../../animation';
import type { SerializationManager } from '../manager';
import type { SerializableClass } from '../types';
import type { SceneNode } from '../../../scene';
import { ClipmapTerrain, Mesh, ParticleSystem, Terrain, Water } from '../../../scene';

export function findAnimationTarget(manager: SerializationManager, node: SceneNode, track: PropertyTrack) {
  const prop = track?.getProp();
  if (!prop) {
    return null;
  }
  const cls = manager.getClassByProperty(prop);
  if (!cls) {
    return null;
  }
  if (cls.ctor.isPrototypeOf(node.constructor)) {
    return node;
  }
  if (
    node instanceof Mesh ||
    node instanceof ParticleSystem ||
    node instanceof Terrain ||
    node instanceof ClipmapTerrain ||
    node instanceof Water
  ) {
    if (node.material && cls.ctor.isPrototypeOf(node.material.constructor)) {
      return node.material;
    }
  }
  if (node instanceof Mesh) {
    if (node.primitive && cls.ctor.isPrototypeOf(node.primitive.constructor)) {
      return node.primitive;
    }
  }
  if (node instanceof Water) {
    if (node.waveGenerator && cls.ctor.isPrototypeOf(node.waveGenerator.constructor)) {
      return node.waveGenerator;
    }
  }
  return null;
}

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
          type: 'object',
          edit: 'interpolator',
          objectTypes: [Interpolator],
          get(this: PropertyTrack, value) {
            value.object[0] = this.interpolator;
          },
          set(this: PropertyTrack, value) {
            this.interpolator = value.object[0] as Interpolator;
          }
        }
      ];
    }
  };
}

export function getAnimationClass(): SerializableClass {
  return {
    ctor: AnimationClip,
    createFunc(ctx: AnimationSet, init: string) {
      return { obj: ctx.createAnimation(init, false) };
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
          get(this: AnimationClip, value) {
            value.object = [];
            for (const tracks of this.tracks) {
              value.object.push(...tracks[1].filter((track) => track instanceof PropertyTrack));
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

export function getAnimationSetClass(): SerializableClass {
  return {
    ctor: AnimationSet,
    getProps() {
      return [
        {
          name: 'Animations',
          type: 'object_array',
          objectTypes: [AnimationClip],
          readonly: true,
          get(this: AnimationSet, value) {
            value.object = this.getAnimationNames().map((name) => this.getAnimationClip(name));
          },
          set(this: AnimationSet, value) {
            for (const ani of value.object) {
              const animation = ani as AnimationClip;
              for (const tracks of animation.tracks) {
                for (const track of tracks[1]) {
                  if (!track.embedded) {
                    animation.addTrack(tracks[0], track);
                  }
                }
              }
            }
          }
        }
      ];
    }
  };
}
