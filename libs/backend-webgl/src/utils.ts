/**
 * Utilitty functions and classes
 */

import { WebGLEnum } from './webgl_enum';

export function isWebGL2(gl: WebGLRenderingContext | WebGL2RenderingContext): gl is WebGL2RenderingContext {
  return !!(gl && (gl as any).texStorage2D);
}

export class WebGLError extends Error {
  private static readonly errorToString: Record<number, string> = {
    [WebGLEnum.NO_ERROR]: 'NO_ERROR',
    [WebGLEnum.INVALID_ENUM]: 'INVALID_ENUM',
    [WebGLEnum.INVALID_VALUE]: 'INVALID_VALUE',
    [WebGLEnum.INVALID_OPERATION]: 'INVALID_OPERATION',
    [WebGLEnum.INVALID_FRAMEBUFFER_OPERATION]: 'INVALID_FRAMEBUFFER_OPERATION',
    [WebGLEnum.OUT_OF_MEMORY]: 'OUT_OF_MEMORY',
    [WebGLEnum.CONTEXT_LOST_WEBGL]: 'CONTEXT_LOST_WEBGL'
  };
  code: number;
  constructor(code: number) {
    super(WebGLError.errorToString[code]);
    this.code = code;
  }
}
