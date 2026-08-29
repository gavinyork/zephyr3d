import type { Nullable } from '@zephyr3d/base';
import type {
  BaseTexture,
  DeviceOptions,
  FrameBuffer,
  FrameBufferClearColors,
  FramebufferCaps,
  GPUProgram,
  MiscCaps,
  PrimitiveType,
  ShaderCaps,
  Texture2D,
  TextureCaps
} from '@zephyr3d/device';

/**
 * The device type emulated by a null device.
 *
 * @remarks
 * The value is returned by {@link https://github.com/gavinyork/zephyr3d | AbstractDevice.type} and
 * therefore selects the shader language emitted by the program builder and the
 * device specific code paths taken by the engine. Use 'null' only when testing
 * code that never generates shaders, because shader generation is not supported
 * for that type.
 *
 * @public
 */
export type NullDeviceType = 'webgl' | 'webgl2' | 'webgpu' | 'null';

/**
 * Capability overrides for a null device
 * @public
 */
export interface NullDeviceCapsOptions {
  /** Miscellaneous capability overrides */
  miscCaps?: Partial<MiscCaps>;
  /** Frame buffer capability overrides */
  framebufferCaps?: Partial<FramebufferCaps>;
  /** Shader capability overrides */
  shaderCaps?: Partial<ShaderCaps>;
  /** Texture capability overrides, excluding the format query method */
  textureCaps?: Partial<Omit<TextureCaps, 'getTextureFormatInfo'>>;
}

/**
 * Creation options for a null device
 * @public
 */
export interface NullDeviceOptions extends DeviceOptions {
  /** Device type to emulate, default is 'webgl2' */
  type?: NullDeviceType;
  /** Back buffer width in pixels, default is 800 */
  width?: number;
  /** Back buffer height in pixels, default is 600 */
  height?: number;
  /** Capability overrides */
  caps?: NullDeviceCapsOptions;
  /** Overrides the clip space depth range reported by the device */
  clipSpaceZeroToOne?: boolean;
  /** Throw on validation errors instead of reporting them to the console, default is false */
  strict?: boolean;
  /** Whether device commands should be recorded, default is true */
  recordCommands?: boolean;
  /** Maximum number of recorded commands, default is 4096 */
  maxCommandLogSize?: number;
}

/**
 * A command recorded by a null device
 * @public
 */
export type NullCommand =
  | {
      type: 'beginFrame';
      frame: number;
    }
  | {
      type: 'endFrame';
      frame: number;
    }
  | {
      type: 'setFramebuffer';
      frame: number;
      framebuffer: Nullable<FrameBuffer>;
    }
  | {
      type: 'clear';
      frame: number;
      framebuffer: Nullable<FrameBuffer>;
      color: FrameBufferClearColors;
      depth: Nullable<number>;
      stencil: Nullable<number>;
    }
  | {
      type: 'draw';
      frame: number;
      framebuffer: Nullable<FrameBuffer>;
      program: Nullable<GPUProgram>;
      primitiveType: PrimitiveType;
      first: number;
      count: number;
      numInstances: number;
    }
  | {
      type: 'drawIndirect';
      frame: number;
      framebuffer: Nullable<FrameBuffer>;
      program: Nullable<GPUProgram>;
      primitiveType: PrimitiveType;
      indexed: boolean;
      indirectOffset: number;
    }
  | {
      type: 'compute';
      frame: number;
      program: Nullable<GPUProgram>;
      workgroupCount: [number, number, number];
    }
  | {
      type: 'generateMipmaps';
      frame: number;
      texture: BaseTexture;
    }
  | {
      type: 'copyTexture';
      frame: number;
      src: Texture2D;
      srcLevel: number;
      dst: Texture2D;
      dstLevel: number;
    }
  | {
      type: 'copyFramebufferToTexture';
      frame: number;
      src: FrameBuffer;
      index: number;
      dst: Texture2D;
      level: number;
    }
  | {
      type: 'readPixels';
      frame: number;
      framebuffer: Nullable<FrameBuffer>;
      index: number;
      x: number;
      y: number;
      width: number;
      height: number;
    }
  | {
      type: 'flush';
      frame: number;
    };
