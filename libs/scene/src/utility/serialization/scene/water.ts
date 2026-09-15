import type { Nullable } from '@zephyr3d/base';
import { Vector2, Vector3 } from '@zephyr3d/base';
import type { SceneNode } from '../../../scene';
import { GraphNode } from '../../../scene';
import { Water } from '../../../scene/water';
import { defineProps, type SerializableClass } from '../types';
import type { WaveGenerator } from '../../../render';
import { FBMWaveGenerator, FFTWaveGenerator, GerstnerWaveGenerator } from '../../../render';
import { MAX_GERSTNER_WAVE_COUNT } from '../../../values';
import type { WaterDebugOutput, WaterMediumMode, WaterRefractionMode } from '../../../material/water';
import { DEFAULT_SCATTER_ANISOTROPY, WATER_DEBUG_OUTPUTS } from '../../../material/water';
import type { Texture2D } from '@zephyr3d/device';
import type { ResourceManager } from '../manager';

/** @internal */
export function getFBMWaveGeneratorClass(): SerializableClass {
  return {
    ctor: FBMWaveGenerator,
    name: 'FBMWaveGenerator',
    getProps() {
      return defineProps([
        {
          name: 'NumOctaves',
          description: 'Number of FBM noise octaves used to build the wave pattern',
          type: 'int',
          options: { minValue: 1, maxValue: 8 },
          default: 4,
          get(this: FBMWaveGenerator, value) {
            value.num[0] = this.numOctaves;
          },
          set(this: FBMWaveGenerator, value) {
            this.numOctaves = value.num[0];
          }
        },
        {
          name: 'Wind',
          description: 'Wind direction and speed that drive the FBM waves',
          type: 'vec2',
          default: [0.1, 0],
          options: {
            animatable: true
          },
          get(this: FBMWaveGenerator, value) {
            value.num[0] = this.wind.x;
            value.num[1] = this.wind.y;
          },
          set(this: FBMWaveGenerator, value) {
            this.wind = new Vector2(value.num[0], value.num[1]);
          }
        },
        {
          name: 'Amplitude',
          description: 'Wave height amplitude for the FBM wave generator',
          type: 'float',
          options: { animatable: true, minValue: 0, maxValue: 5 },
          default: 0.3,
          get(this: FBMWaveGenerator, value) {
            value.num[0] = this.amplitude;
          },
          set(this: FBMWaveGenerator, value) {
            this.amplitude = value.num[0];
          }
        },
        {
          name: 'Frequency',
          description: 'Wave frequency for the FBM wave generator',
          type: 'float',
          options: { animatable: true, minValue: 0, maxValue: 16 },
          default: 3,
          get(this: FBMWaveGenerator, value) {
            value.num[0] = this.frequency;
          },
          set(this: FBMWaveGenerator, value) {
            this.frequency = value.num[0];
          }
        }
      ]);
    }
  };
}

/** @internal */
export function getFFTWaveGeneratorClass(): SerializableClass {
  return {
    ctor: FFTWaveGenerator,
    name: 'FFTWaveGenerator',
    getProps() {
      return defineProps([
        {
          name: 'Alignment',
          description: 'How strongly FFT waves align with the wind direction',
          type: 'float',
          options: { animatable: true, minValue: 0, maxValue: 1 },
          get(this: FFTWaveGenerator, value) {
            value.num[0] = this.alignment;
          },
          set(this: FFTWaveGenerator, value) {
            this.alignment = value.num[0];
          }
        },
        {
          name: 'Wind',
          description: 'Wind direction and speed that drive the FFT waves',
          type: 'vec2',
          options: {
            animatable: true
          },
          get(this: FFTWaveGenerator, value) {
            value.num[0] = this.wind.x;
            value.num[1] = this.wind.y;
          },
          set(this: FFTWaveGenerator, value) {
            this.wind = new Vector2(value.num[0], value.num[1]);
          }
        },
        {
          name: 'FoamWidth',
          description: 'Width of foam bands generated on the wave crests',
          type: 'float',
          default: 1.2,
          options: { animatable: true, minValue: 0, maxValue: 10 },
          get(this: FFTWaveGenerator, value) {
            value.num[0] = this.foamWidth;
          },
          set(this: FFTWaveGenerator, value) {
            this.foamWidth = value.num[0];
          }
        },
        {
          name: 'FoamContrast',
          description: 'Contrast of the foam pattern on FFT waves',
          type: 'float',
          default: 7.2,
          options: { animatable: true, minValue: 0, maxValue: 10 },
          get(this: FFTWaveGenerator, value) {
            value.num[0] = this.foamContrast;
          },
          set(this: FFTWaveGenerator, value) {
            this.foamContrast = value.num[0];
          }
        },
        {
          name: 'WaveLengthCascades',
          description: 'Wavelength values for the three FFT wave cascades',
          type: 'vec3',
          default: [400, 100, 15],
          options: { animatable: true, minValue: 0, maxValue: 1000 },
          get(this: FFTWaveGenerator, value) {
            value.num[0] = this.getWaveLength(0);
            value.num[1] = this.getWaveLength(1);
            value.num[2] = this.getWaveLength(2);
          },
          set(this: FFTWaveGenerator, value) {
            this.setWaveLength(0, value.num[0]);
            this.setWaveLength(1, value.num[1]);
            this.setWaveLength(2, value.num[2]);
          }
        },
        {
          name: 'WaveStrengthCascades',
          description: 'Strength values for the three FFT wave cascades',
          type: 'vec3',
          default: [0.4, 0.4, 0.2],
          options: { animatable: true, minValue: 0, maxValue: 1 },
          get(this: FFTWaveGenerator, value) {
            value.num[0] = this.getWaveStrength(0);
            value.num[1] = this.getWaveStrength(1);
            value.num[2] = this.getWaveStrength(2);
          },
          set(this: FFTWaveGenerator, value) {
            this.setWaveStrength(0, value.num[0]);
            this.setWaveStrength(1, value.num[1]);
            this.setWaveStrength(2, value.num[2]);
          }
        },
        {
          name: 'WaveCroppinessCascades',
          description: 'Croppiness values for the three FFT wave cascades',
          type: 'vec3',
          default: [-1.5, -1.2, -0.5],
          options: { animatable: true, minValue: -4, maxValue: 0 },
          get(this: FFTWaveGenerator, value) {
            value.num[0] = this.getWaveCroppiness(0);
            value.num[1] = this.getWaveCroppiness(1);
            value.num[2] = this.getWaveCroppiness(2);
          },
          set(this: FFTWaveGenerator, value) {
            this.setWaveCroppiness(0, value.num[0]);
            this.setWaveCroppiness(1, value.num[1]);
            this.setWaveCroppiness(2, value.num[2]);
          }
        }
      ]);
    }
  };
}

/** @internal */
export function getGerstnerWaveGeneratorClass(): SerializableClass {
  return {
    ctor: GerstnerWaveGenerator,
    name: 'GerstnerWaveGenerator',
    getProps() {
      return defineProps([
        {
          name: 'NumWaves',
          description: 'Number of independent Gerstner waves summed to form the surface',
          type: 'int',
          options: { minValue: 1, maxValue: MAX_GERSTNER_WAVE_COUNT },
          get(this: GerstnerWaveGenerator, value) {
            value.num[0] = this.numWaves;
          },
          set(this: GerstnerWaveGenerator, value) {
            this.numWaves = value.num[0];
          }
        },
        {
          name: 'Waves',
          description: 'Per-wave parameters, one entry per wave in NumWaves order',
          type: 'object_array',
          options: {
            objectTypes: [GerstnerWave]
          },
          get(this: GerstnerWaveGenerator, value) {
            value.object = [];
            for (let i = 0; i < this.numWaves; i++) {
              const wave = new GerstnerWave();
              wave.bind(this, i);
              value.object.push(wave);
            }
          },
          set(this: GerstnerWaveGenerator, value) {
            const waves = value.object as GerstnerWave[];
            // The wave count is ground truth for how many slots the shader
            // reads. NumWaves and Waves are applied concurrently during
            // deserialization, so this setter must leave the generator in the
            // state this array implies regardless of which one runs first.
            this.numWaves = waves.length;
            for (let i = 0; i < waves.length; i++) {
              waves[i].applyTo(this, i);
            }
          },
          add(this: GerstnerWaveGenerator, value, index) {
            const wave = value?.object?.[0] as Nullable<GerstnerWave>;
            const insertAt = index ?? this.numWaves;
            this.insertWave(insertAt);
            wave?.applyTo(this, insertAt);
          },
          delete(this: GerstnerWaveGenerator, index) {
            this.deleteWave(index);
          }
        },
        {
          name: 'FoamWidth',
          description: 'Width of foam bands generated on the wave crests',
          type: 'float',
          default: 1.2,
          options: { animatable: true, minValue: 0, maxValue: 10 },
          get(this: GerstnerWaveGenerator, value) {
            value.num[0] = this.foamWidth;
          },
          set(this: GerstnerWaveGenerator, value) {
            this.foamWidth = value.num[0];
          }
        },
        {
          name: 'FoamContrast',
          description: 'Contrast of the foam pattern on Gerstner waves',
          type: 'float',
          default: 7.2,
          options: { animatable: true, minValue: 0, maxValue: 10 },
          get(this: GerstnerWaveGenerator, value) {
            value.num[0] = this.foamContrast;
          },
          set(this: GerstnerWaveGenerator, value) {
            this.foamContrast = value.num[0];
          }
        }
      ]);
    }
  };
}

/**
 * A single Gerstner wave, as the editor sees one entry of the
 * `Waves` object array on a {@link GerstnerWaveGenerator}.
 *
 * It behaves as a live view while it is bound: the field setters write the new
 * value straight through to the generator's wave buffer, which is what makes an
 * edit in the property panel take effect on the water immediately. Without that
 * the editor would only touch this object's own fields and the surface would
 * keep the previous wave until something else bumped the generator's version.
 *
 * The binding is transient and scoped to one editor session: `_owner` and
 * `_index` are set when the `Waves` getter builds the entry, and the editor
 * rebuilds the whole array from that getter after every add/delete. A copy that
 * survives a list mutation is never reused, so the cached index cannot drift
 * onto a different wave - the same reason it is safe to write through with it.
 */
class GerstnerWave {
  private _owner: Nullable<GerstnerWaveGenerator>;
  private _index: number;
  _direction: number;
  _steepness: number;
  _amplitude: number;
  _length: number;
  _omni: boolean;
  _originX: number;
  _originZ: number;
  constructor() {
    this._owner = null;
    this._index = -1;
    this._direction = 0;
    this._steepness = 0;
    this._amplitude = 0;
    this._length = 1;
    this._omni = false;
    this._originX = 0;
    this._originZ = 0;
  }
  /**
   * Binds this entry to a slot of `owner`, so the field setters write through
   * to the generator. Called by the `Waves` getter and by `add`; the index is
   * the slot the entry currently represents.
   * @internal
   */
  bind(owner: GerstnerWaveGenerator, index: number) {
    this._owner = owner;
    this._index = index;
    this.loadFromOwner(owner, index);
  }
  /**
   * Copies the values in slot `index` of `owner` into this object, refreshing
   * the cached fields without writing back.
   * @internal
   */
  loadFromOwner(owner: GerstnerWaveGenerator, index: number) {
    this._direction = owner.getWaveDirection(index);
    this._steepness = owner.getWaveSteepness(index);
    this._amplitude = owner.getWaveAmplitude(index);
    this._length = owner.getWaveLength(index);
    this._omni = owner.isOmniWave(index);
    this._originX = owner.getOriginX(index);
    this._originZ = owner.getOriginZ(index);
  }
  /**
   * Writes this object's values into slot `index` of `owner`, unconditionally.
   *
   * Used by the `Waves` setter for a serialised-in array, whose entries were
   * constructed without an owner, and by `add` for a freshly created one. It is
   * distinct from the write-through in the field setters, which fire on each
   * individual edit.
   * @internal
   */
  applyTo(owner: GerstnerWaveGenerator, index: number) {
    owner.setWaveDirection(index, this._direction);
    owner.setWaveSteepness(index, this._steepness);
    owner.setWaveAmplitude(index, this._amplitude);
    owner.setWaveLength(index, this._length);
    owner.setOmniWave(index, this._omni);
    owner.setOrigin(index, this._originX, this._originZ);
    this._owner = owner;
    this._index = index;
  }
  /** @internal */
  private writethrough(
    setter: (owner: GerstnerWaveGenerator, index: number, val: number) => void,
    val: number
  ) {
    const owner = this._owner;
    if (owner) {
      setter(owner, this._index, val);
    }
  }
  /** Gets the wave direction angle in radians. */
  get direction() {
    return this._direction;
  }
  set direction(val) {
    this._direction = val;
    this.writethrough((o, i, v) => o.setWaveDirection(i, v), val);
  }
  /** Gets the wave steepness. */
  get steepness() {
    return this._steepness;
  }
  set steepness(val) {
    this._steepness = val;
    this.writethrough((o, i, v) => o.setWaveSteepness(i, v), val);
  }
  /** Gets the wave amplitude. */
  get amplitude() {
    return this._amplitude;
  }
  set amplitude(val) {
    this._amplitude = val;
    this.writethrough((o, i, v) => o.setWaveAmplitude(i, v), val);
  }
  /** Gets the wave length in meters. */
  get length() {
    return this._length;
  }
  set length(val) {
    this._length = val;
    this.writethrough((o, i, v) => o.setWaveLength(i, v), val);
  }
  /** Gets whether the wave is omni-directional. */
  get omni() {
    return this._omni;
  }
  set omni(val) {
    this._omni = val;
    if (this._owner) {
      this._owner.setOmniWave(this._index, val);
    }
  }
  /** Gets the origin X of an omni-directional wave. */
  get originX() {
    return this._originX;
  }
  set originX(val) {
    this._originX = val;
    if (this._owner) {
      this._owner.setOrigin(this._index, val, this._originZ);
    }
  }
  /** Gets the origin Z of an omni-directional wave. */
  get originZ() {
    return this._originZ;
  }
  set originZ(val) {
    this._originZ = val;
    if (this._owner) {
      this._owner.setOrigin(this._index, this._originX, val);
    }
  }
}

/** @internal */
export function getGerstnerWaveClass(): SerializableClass {
  return {
    ctor: GerstnerWave,
    name: 'GerstnerWave',
    getProps() {
      return defineProps([
        {
          name: 'Direction',
          description: 'Wave direction angle in radians',
          type: 'float',
          options: { animatable: true, minValue: -3.14, maxValue: 3.14 },
          get(this: GerstnerWave, value) {
            value.num[0] = this.direction;
          },
          set(this: GerstnerWave, value) {
            this.direction = value.num[0];
          }
        },
        {
          name: 'Steepness',
          description: 'Wave steepness. The sum of steepness across waves sets how sharply crests fold',
          type: 'float',
          options: { animatable: true, minValue: 0, maxValue: 2 },
          get(this: GerstnerWave, value) {
            value.num[0] = this.steepness;
          },
          set(this: GerstnerWave, value) {
            this.steepness = value.num[0];
          }
        },
        {
          name: 'Amplitude',
          description: 'Wave height amplitude',
          type: 'float',
          options: { animatable: true, minValue: 0, maxValue: 5 },
          get(this: GerstnerWave, value) {
            value.num[0] = this.amplitude;
          },
          set(this: GerstnerWave, value) {
            this.amplitude = value.num[0];
          }
        },
        {
          name: 'Length',
          description: 'Wave length in meters',
          type: 'float',
          options: { animatable: true, minValue: 0, maxValue: 100 },
          get(this: GerstnerWave, value) {
            value.num[0] = this.length;
          },
          set(this: GerstnerWave, value) {
            this.length = value.num[0];
          }
        },
        {
          name: 'Omni',
          description: 'If true, radiates outward from an origin rather than travelling in one direction',
          type: 'bool',
          get(this: GerstnerWave, value) {
            value.bool[0] = this.omni;
          },
          set(this: GerstnerWave, value) {
            this.omni = value.bool[0];
          }
        },
        {
          name: 'Origin',
          description: 'Origin of an omni-directional wave, ignored by directional waves',
          type: 'vec2',
          options: { animatable: true, minValue: -1000, maxValue: 1000 },
          get(this: GerstnerWave, value) {
            value.num[0] = this.originX;
            value.num[1] = this.originZ;
          },
          set(this: GerstnerWave, value) {
            this.originX = value.num[0];
            this.originZ = value.num[1];
          }
        }
      ]);
    }
  };
}

/** @internal */
export function getWaterClass(manager: ResourceManager): SerializableClass {
  return {
    ctor: Water,
    name: 'Water',
    parent: GraphNode,
    createFunc(ctx: SceneNode) {
      const node = new Water(ctx.scene!);
      node.parent = ctx;
      return { obj: node };
    },
    getProps() {
      return defineProps([
        {
          name: 'WaveGenerator',
          description: 'Wave generator used to drive the water surface',
          type: 'object',
          default: null,
          options: {
            objectTypes: [FFTWaveGenerator, FBMWaveGenerator, GerstnerWaveGenerator]
          },
          isNullable() {
            return true;
          },
          get(this: Water, value) {
            value.object[0] = this.waveGenerator ?? null;
          },
          set(this: Water, value) {
            if (!value.object[0]) {
              this.waveGenerator = null;
            } else {
              this.waveGenerator = value.object[0] as WaveGenerator;
            }
          }
        },
        {
          name: 'GridScale',
          description: 'Scale of the water simulation grid',
          type: 'float',
          default: 1,
          options: { minValue: 0, maxValue: 1 },
          get(this: Water, value) {
            value.num[0] = this.gridScale;
          },
          set(this: Water, value) {
            this.gridScale = value.num[0];
          }
        },
        {
          name: 'Wireframe',
          description: 'If true, renders the water surface as wireframe',
          type: 'bool',
          default: false,
          get(this: Water, value) {
            value.bool[0] = this.wireframe;
          },
          set(this: Water, value) {
            this.wireframe = value.bool[0];
          }
        },
        {
          name: 'AnimationSpeed',
          description: 'Playback speed of wave animation',
          type: 'float',
          default: 1,
          options: { animatable: true, minValue: 0, maxValue: 100 },
          get(this: Water, value) {
            value.num[0] = this.animationSpeed;
          },
          set(this: Water, value) {
            this.animationSpeed = value.num[0];
          }
        },
        {
          name: 'Infinite',
          description:
            'Draw the surface as an unbounded ocean reaching the horizon instead of a body of water ending at the node extent. Reaches the horizon without enlarging the camera far plane, so near-scene depth precision is unaffected. Leave off for ponds, lakes and pools, which have an edge.',
          type: 'bool',
          default: false,
          get(this: Water, value) {
            value.bool[0] = this.infinite;
          },
          set(this: Water, value) {
            this.infinite = value.bool[0];
          }
        },
        {
          name: 'ViewDistance',
          description:
            'How far the surface is built out from the camera, in meters, or 0 to derive it from the true horizon distance for the camera height. Keep the sky AerialPerspectiveDistance at least this large, or the far water stops converging towards the sky colour and the hard band comes back.',
          type: 'float',
          default: 0,
          options: { minValue: 0, maxValue: 100000 },
          isHidden(this: Water) {
            return !this.infinite;
          },
          get(this: Water, value) {
            value.num[0] = this.viewDistance;
          },
          set(this: Water, value) {
            this.viewDistance = value.num[0];
          }
        },
        {
          name: 'CausticsEnabled',
          description: 'Whether the water projects caustics onto the geometry below it',
          type: 'bool',
          default: true,
          get(this: Water, value) {
            value.bool[0] = this.causticsEnabled;
          },
          set(this: Water, value) {
            this.causticsEnabled = value.bool[0];
          }
        },
        {
          name: 'CausticsIntensity',
          description: 'Strength of the caustic contrast',
          type: 'float',
          default: 1,
          options: { animatable: true, minValue: 0, maxValue: 5 },
          isHidden(this: Water) {
            return !this.causticsEnabled;
          },
          get(this: Water, value) {
            value.num[0] = this.causticsIntensity;
          },
          set(this: Water, value) {
            this.causticsIntensity = value.num[0];
          }
        },
        {
          name: 'CausticsDepth',
          description: 'Depth in meters below the surface where the caustics are in focus',
          type: 'float',
          default: 4,
          options: { animatable: true, minValue: 0.01, maxValue: 100 },
          isHidden(this: Water) {
            return !this.causticsEnabled;
          },
          get(this: Water, value) {
            value.num[0] = this.causticsDepth;
          },
          set(this: Water, value) {
            this.causticsDepth = value.num[0];
          }
        },
        {
          name: 'CausticsRange',
          description: 'Furthest distance in meters from the camera the caustic map reaches',
          type: 'float',
          default: 4,
          options: { minValue: 1, maxValue: 1000 },
          isHidden(this: Water) {
            return !this.causticsEnabled;
          },
          get(this: Water, value) {
            value.num[0] = this.causticsRange;
          },
          set(this: Water, value) {
            this.causticsRange = value.num[0];
          }
        },
        {
          name: 'CausticsFadeDistance',
          description:
            'Width in meters the caustics fade out over at the edge of the map, or 0 to derive it from the range',
          type: 'float',
          default: 0,
          options: { minValue: 0, maxValue: 100 },
          isHidden(this: Water) {
            return !this.causticsEnabled;
          },
          get(this: Water, value) {
            value.num[0] = this.causticsFadeDistance;
          },
          set(this: Water, value) {
            this.causticsFadeDistance = value.num[0];
          }
        },
        {
          name: 'CausticsSceneDepth',
          description:
            'Land caustics on the scene instead of on a plane at CausticsDepth. Reuses the sun shadow cascade, so it costs no extra geometry pass; WebGL2 keeps the plane, which its shadow map format cannot avoid.',
          type: 'bool',
          default: true,
          get(this: Water, value) {
            value.bool[0] = this.causticsSceneDepth;
          },
          set(this: Water, value) {
            this.causticsSceneDepth = value.bool[0];
          }
        },
        {
          name: 'CausticsWarp',
          description:
            'How strongly caustic map texels are concentrated near the camera; ignored while the map already fits the water within range',
          type: 'float',
          default: 1.5,
          options: { minValue: 0, maxValue: 8 },
          isHidden(this: Water) {
            return !this.causticsEnabled;
          },
          get(this: Water, value) {
            value.num[0] = this.causticsWarp;
          },
          set(this: Water, value) {
            this.causticsWarp = value.num[0];
          }
        },
        {
          name: 'UnderwaterEnabled',
          description:
            'Whether a camera inside this water sees it from the inside: the medium over the whole scene, the sky replaced by water, and the surface read from below with its Snell window. Atmospheric fog is suppressed while submerged.',
          type: 'bool',
          default: true,
          get(this: Water, value) {
            value.bool[0] = this.underwaterEnabled;
          },
          set(this: Water, value) {
            this.underwaterEnabled = value.bool[0];
          }
        },
        {
          name: 'UnderwaterAmbientIntensity',
          description:
            'Scale on the downwelling sky light filling the water column. This is what the water fades to in the distance, so it sets how bright the underwater haze reads.',
          type: 'float',
          default: 1,
          options: { animatable: true, minValue: 0, maxValue: 5 },
          isHidden(this: Water) {
            return !this.underwaterEnabled;
          },
          get(this: Water, value) {
            value.num[0] = this.underwaterAmbientIntensity;
          },
          set(this: Water, value) {
            this.underwaterAmbientIntensity = value.num[0];
          }
        },
        {
          name: 'UnderwaterGodRays',
          description:
            'Whether shafts of sunlight are marched through the water column. Reads the caustic map as the surface transmittance, so the shafts carry the pattern that lands on the sea bed; needs CausticsEnabled.',
          type: 'bool',
          default: true,
          isHidden(this: Water) {
            return !this.underwaterEnabled;
          },
          get(this: Water, value) {
            value.bool[0] = this.underwaterGodRays;
          },
          set(this: Water, value) {
            this.underwaterGodRays = value.bool[0];
          }
        },
        {
          name: 'UnderwaterGodRayIntensity',
          description: 'Strength of the light shafts, 1 for the value the medium implies',
          type: 'float',
          default: 1,
          options: { animatable: true, minValue: 0, maxValue: 5 },
          isHidden(this: Water) {
            return !this.underwaterEnabled || !this.underwaterGodRays;
          },
          get(this: Water, value) {
            value.num[0] = this.underwaterGodRayIntensity;
          },
          set(this: Water, value) {
            this.underwaterGodRayIntensity = value.num[0];
          }
        },
        {
          name: 'UnderwaterGodRaySteps',
          description:
            'Samples taken along each view ray for the light shafts. Raise it when the shafts read as grain rather than as beams.',
          type: 'int',
          default: 24,
          options: { minValue: 4, maxValue: 96 },
          isHidden(this: Water) {
            return !this.underwaterEnabled || !this.underwaterGodRays;
          },
          get(this: Water, value) {
            value.num[0] = this.underwaterGodRaySteps;
          },
          set(this: Water, value) {
            this.underwaterGodRaySteps = value.num[0];
          }
        },
        {
          name: 'UnderwaterGodRayShadow',
          description:
            'Whether geometry standing in the water breaks the light shafts. The shafts come from the caustic map, which knows only what the surface did to the sunlight, so without this a shaft runs straight through a piling. Costs a shadow map lookup per march step.',
          type: 'bool',
          default: false,
          isHidden(this: Water) {
            return !this.underwaterEnabled || !this.underwaterGodRays;
          },
          get(this: Water, value) {
            value.bool[0] = this.underwaterGodRayShadow;
          },
          set(this: Water, value) {
            this.underwaterGodRayShadow = value.bool[0];
          }
        },
        {
          name: 'UnderwaterHysteresis',
          description:
            'Half-width in meters of the dead band around the surface the submerged test uses, so a camera at water level does not flip state every frame',
          type: 'float',
          default: 0.05,
          options: { minValue: 0, maxValue: 2 },
          isHidden(this: Water) {
            return !this.underwaterEnabled;
          },
          get(this: Water, value) {
            value.num[0] = this.underwaterHysteresis;
          },
          set(this: Water, value) {
            this.underwaterHysteresis = value.num[0];
          }
        },
        {
          name: 'MediumMode',
          description:
            'How the water medium attenuates light: physical coefficients, or the legacy ramp textures',
          type: 'string',
          default: 'physical',
          options: {
            enum: {
              labels: ['Physical', 'Ramp'],
              values: ['physical', 'ramp']
            }
          },
          get(this: Water, value) {
            value.str[0] = this.material.mediumMode;
          },
          set(this: Water, value) {
            this.material.mediumMode = value.str[0] as WaterMediumMode;
          }
        },
        {
          name: 'RefractionMode',
          description:
            'How the refracted view sample is located. March walks the refracted ray against the scene depth and samples where it lands, which keeps the sample on the object behind the water; Offset skips the search and displaces the screen UV by the wave normal, which costs no depth fetches but samples the wrong point. Use Offset on hardware that cannot afford the search.',
          type: 'string',
          default: 'march',
          options: {
            enum: {
              labels: ['March (accurate)', 'Offset (cheap)'],
              values: ['march', 'offset']
            }
          },
          get(this: Water, value) {
            value.str[0] = this.material.refractionMode;
          },
          set(this: Water, value) {
            this.material.refractionMode = value.str[0] as WaterRefractionMode;
          }
        },
        {
          name: 'DebugOutput',
          description:
            'Debugging aid: replaces the water colour with one of the shading terms it is built from, so a broken term can be identified by eye',
          type: 'string',
          default: 'none',
          options: {
            enum: {
              labels: WATER_DEBUG_OUTPUTS.map((e) => e.label),
              values: WATER_DEBUG_OUTPUTS.map((e) => e.value)
            }
          },
          get(this: Water, value) {
            value.str[0] = this.debugOutput;
          },
          set(this: Water, value) {
            this.debugOutput = value.str[0] as WaterDebugOutput;
          }
        },
        {
          name: 'Absorption',
          description: 'Absorption coefficient sigma_a of the water medium, per meter, per channel',
          type: 'rgb',
          default: [1.0, 0.25, 0.15],
          options: { animatable: true, minValue: 0, maxValue: 10 },
          isHidden(this: Water) {
            return this.material.mediumMode !== 'physical';
          },
          get(this: Water, value) {
            value.num[0] = this.material.absorption.x;
            value.num[1] = this.material.absorption.y;
            value.num[2] = this.material.absorption.z;
          },
          set(this: Water, value) {
            this.material.absorption = new Vector3(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'AbsorptionScale',
          description: 'Scale for the absorption coefficient',
          type: 'float',
          default: 1,
          options: { animatable: true, minValue: 0, maxValue: 10 },
          isHidden(this: Water) {
            return this.material.mediumMode !== 'physical';
          },
          get(this: Water, value) {
            value.num[0] = this.material.absorptionScale;
          },
          set(this: Water, value) {
            this.material.absorptionScale = value.num[0];
          }
        },
        {
          name: 'Scattering',
          description: 'Scattering coefficient sigma_s of the water medium, per meter, per channel',
          type: 'rgb',
          default: [0.05, 0.12, 0.18],
          options: { animatable: true, minValue: 0, maxValue: 10 },
          isHidden(this: Water) {
            return this.material.mediumMode !== 'physical';
          },
          get(this: Water, value) {
            value.num[0] = this.material.scattering.x;
            value.num[1] = this.material.scattering.y;
            value.num[2] = this.material.scattering.z;
          },
          set(this: Water, value) {
            this.material.scattering = new Vector3(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'ScatteringScale',
          description: 'Scale for the scattering coefficient',
          type: 'float',
          default: 1,
          options: { animatable: true, minValue: 0, maxValue: 10 },
          isHidden(this: Water) {
            return this.material.mediumMode !== 'physical';
          },
          get(this: Water, value) {
            value.num[0] = this.material.scatteringScale;
          },
          set(this: Water, value) {
            this.material.scatteringScale = value.num[0];
          }
        },
        {
          name: 'DepthScale',
          description: 'Depth attenuation scale for the water material (ramp medium only)',
          type: 'float',
          default: 10,
          options: { animatable: true, minValue: 0, maxValue: 100 },
          isHidden(this: Water) {
            return this.material.mediumMode !== 'ramp';
          },
          get(this: Water, value) {
            value.num[0] = this.material.depthMulti;
          },
          set(this: Water, value) {
            this.material.depthMulti = value.num[0];
          }
        },
        {
          name: 'ReflectionStrength',
          description:
            'Scale on the Fresnel reflectance, 1 for the physical value. Lower it to trade the reflection away and show more of what is beneath the surface.',
          type: 'float',
          default: 1,
          options: { animatable: true, minValue: 0, maxValue: 1 },
          get(this: Water, value) {
            value.num[0] = this.material.reflectionStrength;
          },
          set(this: Water, value) {
            this.material.reflectionStrength = value.num[0];
          }
        },
        {
          name: 'SubsurfaceIntensity',
          description:
            'Strength of the sunlight scattered forward through a wave crest, which is what makes a backlit crest glow. Grazing views of a low sun show it; looking down at the water does not.',
          type: 'float',
          default: 0.5,
          options: { animatable: true, minValue: 0, maxValue: 10 },
          get(this: Water, value) {
            value.num[0] = this.material.subsurfaceIntensity;
          },
          set(this: Water, value) {
            this.material.subsurfaceIntensity = value.num[0];
          }
        },
        {
          name: 'SubsurfaceCrestHeight',
          description:
            'Height above the still-water level, in meters, over which the lit wall of a crest thins by a factor of e. Crests are thin and glow; troughs see the full path through the medium and are absorbed, so they keep only a tinted trace. Lower it for a calm sea whose crests barely rise, raise it so only the tallest waves light up.',
          type: 'float',
          default: 1.5,
          options: { animatable: true, minValue: 0.001, maxValue: 10 },
          get(this: Water, value) {
            value.num[0] = this.material.subsurfaceCrestHeight;
          },
          set(this: Water, value) {
            this.material.subsurfaceCrestHeight = value.num[0];
          }
        },
        {
          name: 'SubsurfaceTint',
          description:
            'Colour of the crest glow, before the crest gate tints it with the medium extinction. A warm yellow-green keeps some red on the crests where the troughs have lost it.',
          type: 'rgb',
          default: [0.86, 0.98, 0.71],
          options: { animatable: true, minValue: 0, maxValue: 1 },
          get(this: Water, value) {
            value.num[0] = this.material.subsurfaceTint.x;
            value.num[1] = this.material.subsurfaceTint.y;
            value.num[2] = this.material.subsurfaceTint.z;
          },
          set(this: Water, value) {
            this.material.subsurfaceTint = new Vector3(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'SunScatteringIntensity',
          description:
            'Strength of the sunlight scattered out of the water column towards the eye, 1 for the value the medium coefficients imply. This is what makes a shadow on the water darken the water itself and a low sun tint it; 0 leaves the body lit by the environment alone.',
          type: 'float',
          default: 1,
          options: { animatable: true, minValue: 0, maxValue: 4 },
          get(this: Water, value) {
            value.num[0] = this.material.sunScatteringIntensity;
          },
          set(this: Water, value) {
            this.material.sunScatteringIntensity = value.num[0];
          }
        },
        {
          name: 'FoamAmount',
          description:
            'Coverage of the foam on breaking wave crests, mapped from the folding the wave generator reports. 0 disables crest foam. Independent of ShoreFoamAmount.',
          type: 'float',
          default: 1,
          options: { animatable: true, minValue: 0, maxValue: 4 },
          get(this: Water, value) {
            value.num[0] = this.material.foamAmount;
          },
          set(this: Water, value) {
            this.material.foamAmount = value.num[0];
          }
        },
        {
          name: 'FoamFalloff',
          description:
            'Falloff applied to crest foam coverage. Above 1 pushes light folding towards no foam at all, so only a genuinely broken crest shows - which is what keeps a windy sea from turning uniformly white.',
          type: 'float',
          default: 1.5,
          options: { animatable: true, minValue: 0.01, maxValue: 8 },
          isHidden(this: Water) {
            return this.material.foamAmount <= 0;
          },
          get(this: Water, value) {
            value.num[0] = this.material.foamFalloff;
          },
          set(this: Water, value) {
            this.material.foamFalloff = value.num[0];
          }
        },
        {
          name: 'FoamColor',
          description:
            'Diffuse albedo of the foam, shared by the crest foam and the shoreline foam. Slightly off-white and slightly blue - sea foam is water and air, and a pure white one reads as snow.',
          type: 'rgb',
          default: [0.92, 0.95, 0.97],
          options: { animatable: true, minValue: 0, maxValue: 1 },
          get(this: Water, value) {
            value.num[0] = this.material.foamColor.x;
            value.num[1] = this.material.foamColor.y;
            value.num[2] = this.material.foamColor.z;
          },
          set(this: Water, value) {
            this.material.foamColor = new Vector3(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'ShoreFoamAmount',
          description:
            'Coverage of the foam that collects where the water meets a surface - the waterline on a shelving bed, and the collar around a piling or a hull. 0 disables it, which also removes its cost. Independent of the crest foam the wave generator produces. Requires WebGL2 or WebGPU.',
          type: 'float',
          default: 0,
          // Deliberately not animatable: crossing zero switches the whole
          // feature in and out of the shader, so an animation curve driving this
          // through zero rebuilds the program on the way past.
          options: { minValue: 0, maxValue: 4 },
          get(this: Water, value) {
            value.num[0] = this.shoreFoamAmount;
          },
          set(this: Water, value) {
            this.shoreFoamAmount = value.num[0];
          }
        },
        {
          name: 'ShoreFoamDepth',
          description:
            'How far the foam band reaches from the surface behind it, in meters. Over a bed this is a depth of water; against something vertical it is the horizontal distance to its side, and one value serves both. How wide that is on screen depends on the geometry: a thin line on a steep drop-off, a broad stretch on a flat shelf.',
          type: 'float',
          default: 0.5,
          options: { animatable: true, minValue: 0.001, maxValue: 20 },
          isHidden(this: Water) {
            return this.shoreFoamAmount <= 0;
          },
          get(this: Water, value) {
            value.num[0] = this.shoreFoamDepth;
          },
          set(this: Water, value) {
            this.shoreFoamDepth = value.num[0];
          }
        },
        {
          name: 'ShoreFoamFalloff',
          description:
            'Falloff across the foam band. Above 1 pushes the coverage towards the contact line and keeps the outer edge thin and broken.',
          type: 'float',
          default: 1.5,
          options: { animatable: true, minValue: 0.01, maxValue: 8 },
          isHidden(this: Water) {
            return this.shoreFoamAmount <= 0;
          },
          get(this: Water, value) {
            value.num[0] = this.shoreFoamFalloff;
          },
          set(this: Water, value) {
            this.shoreFoamFalloff = value.num[0];
          }
        },
        {
          name: 'ShoreFoamScale',
          description:
            'Size of the clumps the band breaks into, as cycles across the band rather than cycles per meter. Being relative to the band width, one value reads the same on a shoreline metres across and on a collar a handspan wide.',
          type: 'float',
          default: 2.5,
          options: { animatable: true, minValue: 0, maxValue: 20 },
          isHidden(this: Water) {
            return this.shoreFoamAmount <= 0;
          },
          get(this: Water, value) {
            value.num[0] = this.shoreFoamScale;
          },
          set(this: Water, value) {
            this.shoreFoamScale = value.num[0];
          }
        },
        {
          name: 'ShoreFoamWashAmount',
          description:
            'How far the waterline runs up and back, as a fraction of ShoreFoamDepth. This is what makes the band read as surf rather than as a painted rim; 0 leaves it static. Above 1 the band closes completely at the bottom of the cycle, which looks like the foam blinking out.',
          type: 'float',
          default: 0.5,
          options: { animatable: true, minValue: 0, maxValue: 2 },
          isHidden(this: Water) {
            return this.shoreFoamAmount <= 0;
          },
          get(this: Water, value) {
            value.num[0] = this.shoreFoamWashAmount;
          },
          set(this: Water, value) {
            this.shoreFoamWashAmount = value.num[0];
          }
        },
        {
          name: 'ShoreFoamWashSpeed',
          description: 'Run-up cycles per second. Swell rather than wind waves, so well under 1.',
          type: 'float',
          default: 0.12,
          options: { animatable: true, minValue: 0, maxValue: 2 },
          isHidden(this: Water) {
            return this.shoreFoamAmount <= 0;
          },
          get(this: Water, value) {
            value.num[0] = this.shoreFoamWashSpeed;
          },
          set(this: Water, value) {
            this.shoreFoamWashSpeed = value.num[0];
          }
        },
        {
          name: 'ShoreFoamWashScale',
          description:
            'Spatial frequency of the run-up phase, in cycles per meter. At 0 the whole waterline rises and falls in lockstep, which reads as the water level itself changing; a cycle every few tens of meters breaks a long shoreline into sections that run out of step with one another.',
          type: 'float',
          default: 0.03,
          options: { animatable: true, minValue: 0, maxValue: 1 },
          isHidden(this: Water) {
            return this.shoreFoamAmount <= 0;
          },
          get(this: Water, value) {
            value.num[0] = this.shoreFoamWashScale;
          },
          set(this: Water, value) {
            this.shoreFoamWashScale = value.num[0];
          }
        },
        {
          name: 'CheapRefractionDepth',
          description:
            'Depth in meters the cheap refraction mode assumes the water is. Sets how strong the distortion looks when RefractionMode is Offset; ignored by March. A constant rather than the measured distance to the bottom, because an offset scaled by that distance paints a second copy of any object breaking the surface.',
          type: 'float',
          default: 1,
          options: { animatable: true, minValue: 0, maxValue: 20 },
          isHidden(this: Water) {
            return this.material.refractionMode !== 'offset';
          },
          get(this: Water, value) {
            value.num[0] = this.material.cheapRefractionDepth;
          },
          set(this: Water, value) {
            this.material.cheapRefractionDepth = value.num[0];
          }
        },
        {
          name: 'RefractionBlur',
          description:
            'Scale on how much the medium blurs what is seen through it, 1 for the width the scattering coefficient and the path length imply. Turbid or deep water smudges the bottom; 0 keeps it sharp at any depth.',
          type: 'float',
          default: 1,
          options: { animatable: true, minValue: 0, maxValue: 4 },
          get(this: Water, value) {
            value.num[0] = this.material.refractionBlur;
          },
          set(this: Water, value) {
            this.material.refractionBlur = value.num[0];
          }
        },
        {
          name: 'ScatterAnisotropy',
          description:
            'Mean cosine of a single scattering event. 0 scatters equally in all directions; higher brightens the water when looking towards the sun through it. Sea water measures near 0.9, but a turbid column blends towards isotropic on its own.',
          type: 'float',
          default: DEFAULT_SCATTER_ANISOTROPY,
          options: { animatable: true, minValue: 0, maxValue: 0.95 },
          get(this: Water, value) {
            value.num[0] = this.material.scatterAnisotropy;
          },
          set(this: Water, value) {
            this.material.scatterAnisotropy = value.num[0];
          }
        },
        {
          name: 'RefractionScale',
          description:
            'Artistic scale on the refracted view offset. 1 is physical: the view ray is bent by Snell’s law and followed to whatever is behind the water, so the incidence angle, the depth and the perspective are already accounted for. 0 disables refraction.',
          type: 'float',
          default: 1,
          options: { animatable: true, minValue: 0, maxValue: 4 },
          get(this: Water, value) {
            value.num[0] = this.material.refractionScale;
          },
          set(this: Water, value) {
            this.material.refractionScale = value.num[0];
          }
        },
        {
          name: 'TAAStrength',
          description: 'Temporal anti-aliasing strength for the water surface',
          type: 'float',
          default: 0.4,
          options: { minValue: 0, maxValue: 1 },
          get(this: Water, value) {
            value.num[0] = this.TAAStrength;
          },
          set(this: Water, value) {
            this.TAAStrength = value.num[0];
          }
        },
        {
          name: 'ScatterRampTexture',
          description: 'Ramp texture used for water scatter lighting',
          type: 'object',
          default: null,
          isNullable() {
            return true;
          },
          get(this: Water, value) {
            value.str[0] = manager.getAssetId(this.material.scatterRampTexture) ?? '';
          },
          async set(value) {
            if (!value) {
              this.material.scatterRampTexture = null;
            } else {
              if (value.str[0]) {
                const assetId = value.str[0];
                let tex: Nullable<Texture2D>;
                try {
                  tex = await manager.fetchTexture<Texture2D>(assetId);
                } catch (err) {
                  console.error(`Load asset failed: ${value.str[0]}: ${err}`);
                  tex = null;
                }
                if (tex?.isTexture2D()) {
                  this.material.scatterRampTexture = tex;
                } else {
                  console.error('Invalid texture type');
                }
              }
            }
          }
        },
        {
          name: 'AbsorptionRampTexture',
          description: 'Ramp texture used for water absorption',
          type: 'object',
          default: null,
          isNullable() {
            return true;
          },
          get(this: Water, value) {
            value.str[0] = manager.getAssetId(this.material.absorptionRampTexture) ?? '';
          },
          async set(this: Water, value) {
            if (!value) {
              this.material.absorptionRampTexture = null;
            } else {
              if (value.str[0]) {
                const assetId = value.str[0];
                let tex: Nullable<Texture2D>;
                try {
                  tex = await manager.fetchTexture<Texture2D>(assetId);
                } catch (err) {
                  console.error(`Load asset failed: ${value.str[0]}: ${err}`);
                  tex = null;
                }
                if (tex?.isTexture2D()) {
                  this.material.absorptionRampTexture = tex;
                } else {
                  console.error('Invalid texture type');
                }
              }
            }
          }
        }
      ]);
    }
  };
}
