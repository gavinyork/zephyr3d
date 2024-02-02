import { mat4, vec2, vec3, vec4 } from 'gl-matrix';
import { animationFrames, lastValueFrom, takeWhile } from 'rxjs';
import { finalize, tap } from 'rxjs/operators';
import { KtxInfo } from '../utils';

export type Texture2d = WebGLTexture;
export type VertexBuffer = WebGLBuffer;
export type IndexBuffer = WebGLBuffer;
export type RenderTarget = WebGLFramebuffer;
export type Sync = WebGLSync;
export type Cubemap = WebGLTexture;

export interface VertexAttribute {
  semantics: string;
  slot: number;
  size: number;
  type: GLenum;
  offset: number;
  stride: number;
}

export interface Geometry {
  vao: WebGLVertexArrayObject;
  vbo: VertexBuffer;
  ebo?: IndexBuffer;
  length: number;
  type: GLenum;
}

export interface TransformFeedback {
  tfo: WebGLTransformFeedback;
  buffers: VertexBuffer[];
}

export interface ShaderProgram {
  program: WebGLProgram;
  shaders: WebGLShader[];
}

export interface Mesh {
  vertexFormat: VertexAttribute[];
  vertexData: ArrayBufferView & { length: number };
  indexData?: Uint32Array;
}

export enum TextureFiltering {
  Nearest = WebGL2RenderingContext.NEAREST,
  Linear = WebGL2RenderingContext.LINEAR,
}

export enum TextureMode {
  Repeat = WebGL2RenderingContext.REPEAT,
  Edge = WebGL2RenderingContext.CLAMP_TO_EDGE,
  Mirror = WebGL2RenderingContext.MIRRORED_REPEAT,
}

export class Gpu {
  get context() {
    return this._gl;
  }

  constructor(private readonly _gl: WebGL2RenderingContext) {
    _gl.enable(WebGL2RenderingContext.DEPTH_TEST);
    _gl.enable(WebGL2RenderingContext.CULL_FACE);
    _gl.depthFunc(WebGL2RenderingContext.LEQUAL);
    _gl.frontFace(WebGL2RenderingContext.CCW);
    _gl.clearDepth(1.0);
    _gl.lineWidth(2);
    _gl.disable(WebGL2RenderingContext.BLEND);
    _gl.pixelStorei(WebGL2RenderingContext.UNPACK_ALIGNMENT, 1);
    _gl.pixelStorei(WebGL2RenderingContext.PACK_ALIGNMENT, 1);
    _gl.viewport(0, 0, _gl.canvas.width, _gl.canvas.height);
    _gl.getExtension('EXT_color_buffer_float');
    _gl.getExtension('OES_texture_float_linear');
    _gl.clearColor(0.0, 0.0, 0.0, 0.0);
  }

  createGeometry(
    mesh: Mesh,
    type: GLenum = WebGL2RenderingContext.TRIANGLES
  ): Geometry {
    const vao = this._gl.createVertexArray();
    this._gl.bindVertexArray(vao);

    const vbo = this.createVertexBuffer(
      mesh.vertexData,
      WebGL2RenderingContext.STATIC_DRAW
    );

    for (const attribute of mesh.vertexFormat) {
      this._gl.enableVertexAttribArray(attribute.slot);
      this._gl.bindBuffer(WebGL2RenderingContext.ARRAY_BUFFER, vbo);
      if (attribute.type === WebGL2RenderingContext.FLOAT) {
        this._gl.vertexAttribPointer(
          attribute.slot,
          attribute.size,
          attribute.type,
          false,
          attribute.stride,
          attribute.offset
        );
      } else {
        this._gl.vertexAttribIPointer(
          attribute.slot,
          attribute.size,
          attribute.type,
          attribute.stride,
          attribute.offset
        );
      }
    }

    const geometry: Geometry = {
      vao,
      vbo,
      length: 0,
      type,
    };

    if (mesh.indexData) {
      const ebo = this.createIndexBuffer(mesh.indexData);
      geometry.length = mesh.indexData.length;
      geometry.ebo = ebo;
      this._gl.bindBuffer(WebGL2RenderingContext.ELEMENT_ARRAY_BUFFER, ebo);
    } else {
      const components = mesh.vertexFormat.reduce(
        (components, attribute) => components + attribute.size,
        0
      );
      geometry.length = mesh.vertexData.length / components;
    }

    this._gl.bindVertexArray(null);
    return geometry;
  }

  createShaderProgram(
    vs: string,
    fs: string,
    feedbackVars?: string[]
  ): ShaderProgram {
    const gl = this._gl;
    const program = gl.createProgram();

    let shaders: WebGLShader[] = [];
    try {
      for (const shader of [
        { type: WebGL2RenderingContext.VERTEX_SHADER, sourceCode: vs },
        { type: WebGL2RenderingContext.FRAGMENT_SHADER, sourceCode: fs },
      ]) {
        const shaderObject = gl.createShader(shader.type);
        gl.shaderSource(shaderObject, shader.sourceCode);
        gl.compileShader(shaderObject);
        const compileStatus = gl.getShaderParameter(
          shaderObject,
          WebGL2RenderingContext.COMPILE_STATUS
        );

        if (!compileStatus) {
          const source = shader.sourceCode
            .split(/\n/)
            .map((line: string, no: number) => `${no + 1}:\t${line}`)
            .join('\n');

          throw new Error(
            `${
              shader.type === WebGL2RenderingContext.VERTEX_SHADER
                ? 'Vertex'
                : 'Fragment'
            } shader compile error: '${gl.getShaderInfoLog(
              shaderObject
            )}' \n${source}\n`
          );
        }

        gl.attachShader(program, shaderObject);
        shaders.push(shaderObject);
      }

      if (feedbackVars) {
        this._gl.transformFeedbackVaryings(
          program,
          feedbackVars,
          WebGL2RenderingContext.SEPARATE_ATTRIBS
        );
      }

      gl.linkProgram(program);
      if (
        !gl.getProgramParameter(program, WebGL2RenderingContext.LINK_STATUS)
      ) {
        throw new Error(
          `Unable to initialize the shader program: '${gl.getProgramInfoLog(
            program
          )}'`
        );
      }
    } catch (e) {
      shaders.forEach((shader) => gl.deleteShader(shader));
      gl.deleteProgram(program);
      throw e;
    }

    return { program, shaders };
  }

  setProgram(program: ShaderProgram) {
    this._gl.useProgram(program.program);
  }

  setProgramVariable(
    program: ShaderProgram,
    name: string,
    type: 'uint' | 'int' | 'float',
    value: number
  ): void;
  setProgramVariable(
    program: ShaderProgram,
    name: string,
    type: 'vec2',
    value: vec2
  ): void;
  setProgramVariable(
    program: ShaderProgram,
    name: string,
    type: 'vec3',
    value: vec3
  ): void;
  setProgramVariable(
    program: ShaderProgram,
    name: string,
    type: 'vec4',
    value: vec4
  ): void;
  setProgramVariable(
    program: ShaderProgram,
    name: string,
    type: 'mat4',
    value: mat4
  ): void;
  setProgramVariable(
    program: ShaderProgram,
    name: string,
    type: any,
    value: any
  ): void {
    const loc: WebGLUniformLocation = this._gl.getUniformLocation(
      program.program,
      name
    );
    if (!loc) {
      //console.warn('Failed to find loc: ', name);
      return;
    }
    if (type === 'uint') {
      this._gl.uniform1ui(loc, value);
    } else if (type === 'int') {
      this._gl.uniform1i(loc, value);
    } else if (type === 'float') {
      this._gl.uniform1f(loc, value);
    } else if (type === 'vec2') {
      this._gl.uniform2fv(loc, value);
    } else if (type === 'vec3') {
      this._gl.uniform3fv(loc, value);
    } else if (type === 'vec4') {
      this._gl.uniform4fv(loc, value);
    } else if (type === 'mat4') {
      this._gl.uniformMatrix4fv(loc, false, value);
    }
  }

  setProgramTexture(
    program: ShaderProgram,
    name: string,
    texture: Texture2d,
    slot: number
  ) {
    const loc: WebGLUniformLocation = this._gl.getUniformLocation(
      program.program,
      name
    );
    if (!loc) {
      //console.warn('Failed to find loc: ', name);
      return;
    }

    this._gl.uniform1i(loc, slot);
    this._gl.activeTexture(WebGL2RenderingContext.TEXTURE0 + slot);
    this._gl.bindTexture(WebGL2RenderingContext.TEXTURE_2D, texture);
  }

  setProgramCubemap(
    program: ShaderProgram,
    name: string,
    texture: Cubemap,
    slot: number
  ) {
    const loc: WebGLUniformLocation = this._gl.getUniformLocation(
      program.program,
      name
    );
    if (!loc) {
      //console.warn('Failed to find loc: ', name);
      return;
    }

    this._gl.uniform1i(loc, slot);
    this._gl.activeTexture(WebGL2RenderingContext.TEXTURE0 + slot);
    this._gl.bindTexture(WebGL2RenderingContext.TEXTURE_CUBE_MAP, texture);
  }

  setProgramTextures(
    program: ShaderProgram,
    names: string[],
    textures: Texture2d[]
  ) {
    for (let i = 0; i < names.length; i++) {
      this.setProgramTexture(program, names[i], textures[i], i);
    }
  }

  setViewport(x: number, y: number, width: number, height: number) {
    this._gl.viewport(x, y, width, height);
  }

  drawGeometry(geometry: Geometry, type?: number) {
    this._gl.bindVertexArray(geometry.vao);
    if (geometry.ebo) {
      this._gl.drawElements(
        type ?? geometry.type ?? WebGL2RenderingContext.TRIANGLES,
        geometry.length,
        WebGL2RenderingContext.UNSIGNED_INT,
        0
      );
    } else {
      this._gl.drawArrays(
        type ?? geometry.type ?? WebGL2RenderingContext.TRIANGLES,
        0,
        geometry.length
      );
    }
  }

  flush() {
    this._gl.flush();
  }

  createFloatTexture(
    width: number,
    height: number,
    filter: TextureFiltering = TextureFiltering.Nearest,
    mode: TextureMode = TextureMode.Repeat
  ): WebGLTexture {
    const texture = this._gl.createTexture();
    this._gl.bindTexture(this._gl.TEXTURE_2D, texture);
    this._gl.texImage2D(
      WebGL2RenderingContext.TEXTURE_2D,
      0,
      WebGL2RenderingContext.R32F,
      width,
      height,
      0,
      WebGL2RenderingContext.RED,
      WebGL2RenderingContext.FLOAT,
      null
    );
    this._gl.texParameteri(
      WebGL2RenderingContext.TEXTURE_2D,
      WebGL2RenderingContext.TEXTURE_MIN_FILTER,
      filter
    );
    this._gl.texParameteri(
      WebGL2RenderingContext.TEXTURE_2D,
      WebGL2RenderingContext.TEXTURE_MAG_FILTER,
      filter
    );
    this._gl.texParameteri(
      WebGL2RenderingContext.TEXTURE_2D,
      WebGL2RenderingContext.TEXTURE_WRAP_S,
      mode
    );
    this._gl.texParameteri(
      WebGL2RenderingContext.TEXTURE_2D,
      WebGL2RenderingContext.TEXTURE_WRAP_T,
      mode
    );
    this._gl.bindTexture(WebGL2RenderingContext.TEXTURE_2D, null);

    return texture;
  }

  createFloat2Texture(
    width: number,
    height: number,
    filter: TextureFiltering = TextureFiltering.Nearest,
    mode: TextureMode = TextureMode.Repeat
  ): WebGLTexture {
    const texture = this._gl.createTexture();
    this._gl.bindTexture(this._gl.TEXTURE_2D, texture);
    this._gl.texImage2D(
      WebGL2RenderingContext.TEXTURE_2D,
      0,
      WebGL2RenderingContext.RG32F,
      width,
      height,
      0,
      WebGL2RenderingContext.RG,
      WebGL2RenderingContext.FLOAT,
      null
    );
    this._gl.texParameteri(
      WebGL2RenderingContext.TEXTURE_2D,
      WebGL2RenderingContext.TEXTURE_MIN_FILTER,
      filter
    );
    this._gl.texParameteri(
      WebGL2RenderingContext.TEXTURE_2D,
      WebGL2RenderingContext.TEXTURE_MAG_FILTER,
      filter
    );
    this._gl.texParameteri(
      WebGL2RenderingContext.TEXTURE_2D,
      WebGL2RenderingContext.TEXTURE_WRAP_S,
      mode
    );
    this._gl.texParameteri(
      WebGL2RenderingContext.TEXTURE_2D,
      WebGL2RenderingContext.TEXTURE_WRAP_T,
      mode
    );
    this._gl.bindTexture(WebGL2RenderingContext.TEXTURE_2D, null);

    return texture;
  }

  createFloat3Texture(
    width: number,
    height: number,
    filter: TextureFiltering = TextureFiltering.Nearest,
    mode: TextureMode = TextureMode.Repeat
  ): WebGLTexture {
    const texture = this._gl.createTexture();
    this._gl.bindTexture(this._gl.TEXTURE_2D, texture);
    this._gl.texImage2D(
      WebGL2RenderingContext.TEXTURE_2D,
      0,
      WebGL2RenderingContext.RGB32F,
      width,
      height,
      0,
      WebGL2RenderingContext.RGB,
      WebGL2RenderingContext.FLOAT,
      null
    );
    this._gl.texParameteri(
      WebGL2RenderingContext.TEXTURE_2D,
      WebGL2RenderingContext.TEXTURE_MIN_FILTER,
      filter
    );
    this._gl.texParameteri(
      WebGL2RenderingContext.TEXTURE_2D,
      WebGL2RenderingContext.TEXTURE_MAG_FILTER,
      filter
    );
    this._gl.texParameteri(
      WebGL2RenderingContext.TEXTURE_2D,
      WebGL2RenderingContext.TEXTURE_WRAP_S,
      mode
    );
    this._gl.texParameteri(
      WebGL2RenderingContext.TEXTURE_2D,
      WebGL2RenderingContext.TEXTURE_WRAP_T,
      mode
    );
    this._gl.bindTexture(WebGL2RenderingContext.TEXTURE_2D, null);

    return texture;
  }

  createFloat4Texture(
    width: number,
    height: number,
    filter: TextureFiltering = TextureFiltering.Nearest,
    mode: TextureMode = TextureMode.Repeat
  ): WebGLTexture {
    const texture = this._gl.createTexture();
    this._gl.bindTexture(this._gl.TEXTURE_2D, texture);
    this._gl.texImage2D(
      WebGL2RenderingContext.TEXTURE_2D,
      0,
      WebGL2RenderingContext.RGBA32F,
      width,
      height,
      0,
      WebGL2RenderingContext.RGBA,
      WebGL2RenderingContext.FLOAT,
      null
    );
    this._gl.texParameteri(
      WebGL2RenderingContext.TEXTURE_2D,
      WebGL2RenderingContext.TEXTURE_MIN_FILTER,
      filter
    );
    this._gl.texParameteri(
      WebGL2RenderingContext.TEXTURE_2D,
      WebGL2RenderingContext.TEXTURE_MAG_FILTER,
      filter
    );
    this._gl.texParameteri(
      WebGL2RenderingContext.TEXTURE_2D,
      WebGL2RenderingContext.TEXTURE_WRAP_S,
      mode
    );
    this._gl.texParameteri(
      WebGL2RenderingContext.TEXTURE_2D,
      WebGL2RenderingContext.TEXTURE_WRAP_T,
      mode
    );
    this._gl.bindTexture(WebGL2RenderingContext.TEXTURE_2D, null);

    return texture;
  }

  updateTexture(
    texture: WebGLTexture,
    width: number,
    height: number,
    format: GLenum,
    type: GLenum,
    data: ArrayBufferView
  ) {
    this._gl.bindTexture(WebGL2RenderingContext.TEXTURE_2D, texture);
    this._gl.texSubImage2D(
      WebGL2RenderingContext.TEXTURE_2D,
      0,
      0,
      0,
      width,
      height,
      format,
      type,
      data
    );
  }

  createCubeMap(ktx: KtxInfo): Cubemap {
    const texture = this._gl.createTexture();
    this._gl.bindTexture(this._gl.TEXTURE_CUBE_MAP, texture);

    let level = 0;
    for (let mip of ktx.mipmaps) {
      const faces = [
        {
          target: WebGL2RenderingContext.TEXTURE_CUBE_MAP_POSITIVE_X,
          bytes: mip.cubemap[0],
        },
        {
          target: WebGL2RenderingContext.TEXTURE_CUBE_MAP_NEGATIVE_X,
          bytes: mip.cubemap[1],
        },
        {
          target: WebGL2RenderingContext.TEXTURE_CUBE_MAP_POSITIVE_Y,
          bytes: mip.cubemap[2],
        },
        {
          target: WebGL2RenderingContext.TEXTURE_CUBE_MAP_NEGATIVE_Y,
          bytes: mip.cubemap[3],
        },
        {
          target: WebGL2RenderingContext.TEXTURE_CUBE_MAP_POSITIVE_Z,
          bytes: mip.cubemap[4],
        },
        {
          target: WebGL2RenderingContext.TEXTURE_CUBE_MAP_NEGATIVE_Z,
          bytes: mip.cubemap[5],
        },
      ];

      for (const face of faces) {
        this._gl.texImage2D(
          face.target,
          level,
          ktx.glInternalFormat,
          mip.width,
          mip.height,
          0,
          ktx.glInternalFormat === WebGL2RenderingContext.R11F_G11F_B10F
            ? WebGL2RenderingContext.RGB
            : ktx.glFormat,
          ktx.glInternalFormat === WebGL2RenderingContext.R11F_G11F_B10F
            ? WebGL2RenderingContext.UNSIGNED_INT_10F_11F_11F_REV
            : ktx.glType,
          ktx.glInternalFormat === WebGL2RenderingContext.R11F_G11F_B10F
            ? new Uint32Array(
                face.bytes.buffer,
                face.bytes.byteOffset,
                face.bytes.byteLength / 4
              )
            : face.bytes
        );
      }

      level++;
    }

    this._gl.texParameteri(
      WebGL2RenderingContext.TEXTURE_CUBE_MAP,
      WebGL2RenderingContext.TEXTURE_MAG_FILTER,
      WebGL2RenderingContext.LINEAR
    );
    this._gl.texParameteri(
      WebGL2RenderingContext.TEXTURE_CUBE_MAP,
      WebGL2RenderingContext.TEXTURE_MIN_FILTER,
      WebGL2RenderingContext.LINEAR_MIPMAP_LINEAR
    );
    this._gl.texParameteri(
      WebGL2RenderingContext.TEXTURE_CUBE_MAP,
      WebGL2RenderingContext.TEXTURE_BASE_LEVEL,
      0
    );
    this._gl.texParameteri(
      WebGL2RenderingContext.TEXTURE_CUBE_MAP,
      WebGL2RenderingContext.TEXTURE_MAX_LEVEL,
      ktx.numberOfMipmapLevels - 1
    );
    this._gl.texParameteri(
      WebGL2RenderingContext.TEXTURE_CUBE_MAP,
      WebGL2RenderingContext.TEXTURE_WRAP_S,
      WebGL2RenderingContext.CLAMP_TO_EDGE
    );
    this._gl.texParameteri(
      WebGL2RenderingContext.TEXTURE_CUBE_MAP,
      WebGL2RenderingContext.TEXTURE_WRAP_T,
      WebGL2RenderingContext.CLAMP_TO_EDGE
    );

    return texture;
  }

  updateGeometry(geometry: Geometry, vertexData: ArrayBufferView) {
    this._gl.bindBuffer(WebGL2RenderingContext.ARRAY_BUFFER, geometry.vbo);
    this._gl.bufferSubData(WebGL2RenderingContext.ARRAY_BUFFER, 0, vertexData);
    this._gl.bindBuffer(WebGL2RenderingContext.ARRAY_BUFFER, null);
  }

  createRenderTarget(): RenderTarget {
    return this._gl.createFramebuffer();
  }

  createTransformFeedback(...capacity: number[]): TransformFeedback {
    const tfo = this._gl.createTransformFeedback();
    this._gl.bindTransformFeedback(
      WebGL2RenderingContext.TRANSFORM_FEEDBACK,
      tfo
    );
    const buffers: VertexBuffer[] = [];
    for (let i = 0; i < capacity.length; i++) {
      const tbo = this.createVertexBuffer(
        capacity[i],
        WebGL2RenderingContext.DYNAMIC_READ
      );
      this._gl.bindBufferBase(
        WebGL2RenderingContext.TRANSFORM_FEEDBACK_BUFFER,
        i,
        tbo
      );
      buffers.push(tbo);
    }
    this._gl.bindTransformFeedback(
      WebGL2RenderingContext.TRANSFORM_FEEDBACK,
      null
    );
    return { tfo, buffers };
  }

  beginTransformFeedback(
    transformFeedback: TransformFeedback,
    primitive: GLenum = WebGL2RenderingContext.POINTS
  ) {
    this._gl.enable(WebGL2RenderingContext.RASTERIZER_DISCARD);
    this._gl.bindTransformFeedback(
      WebGL2RenderingContext.TRANSFORM_FEEDBACK,
      transformFeedback.tfo
    );
    this._gl.beginTransformFeedback(primitive);
  }

  endTransformFeedback() {
    this._gl.endTransformFeedback();
    this._gl.bindTransformFeedback(
      WebGL2RenderingContext.TRANSFORM_FEEDBACK,
      null
    );
    this._gl.disable(WebGL2RenderingContext.RASTERIZER_DISCARD);
  }

  async waitAsync(timeout: number = 1000) {
    this._gl.flush();
    const sync = this._gl.fenceSync(
      WebGL2RenderingContext.SYNC_GPU_COMMANDS_COMPLETE,
      0
    );

    let result: GLenum = this._gl.getSyncParameter(
      sync,
      WebGL2RenderingContext.SYNC_STATUS
    );
    return lastValueFrom(
      animationFrames().pipe(
        takeWhile(() => result === WebGL2RenderingContext.UNSIGNALED),
        tap(({ elapsed }) => {
          if (elapsed > timeout) {
            throw new Error('waitAsync: timeout expired');
          }
        }),
        tap(() => {
          result = this._gl.getSyncParameter(
            sync,
            WebGL2RenderingContext.SYNC_STATUS
          );
        }),
        finalize(() => {
          this._gl.deleteSync(sync);
        })
      )
    );
  }

  attachTexture(target: RenderTarget, texture: Texture2d, slot: number) {
    this._gl.bindFramebuffer(WebGL2RenderingContext.FRAMEBUFFER, target);
    this._gl.framebufferTexture2D(
      WebGL2RenderingContext.FRAMEBUFFER,
      WebGL2RenderingContext.COLOR_ATTACHMENT0 + slot,
      WebGL2RenderingContext.TEXTURE_2D,
      texture,
      0
    );

    this._gl.drawBuffers(
      [...Array(slot + 1).keys()].map(
        (i) => WebGL2RenderingContext.COLOR_ATTACHMENT0 + i
      )
    );

    const status = this._gl.checkFramebufferStatus(
      WebGL2RenderingContext.FRAMEBUFFER
    );
    if (status !== WebGL2RenderingContext.FRAMEBUFFER_COMPLETE) {
      throw new Error(`Incomplete frame buffer, status: ${status}`);
    }
    this._gl.bindFramebuffer(WebGL2RenderingContext.FRAMEBUFFER, null);
  }

  attachTextures(target: RenderTarget, textures: Texture2d[]) {
    this._gl.bindFramebuffer(WebGL2RenderingContext.FRAMEBUFFER, target);
    const drawBuffers: GLenum[] = [];

    for (let i = 0; i < textures.length; i++) {
      this._gl.framebufferTexture2D(
        WebGL2RenderingContext.FRAMEBUFFER,
        WebGL2RenderingContext.COLOR_ATTACHMENT0 + i,
        WebGL2RenderingContext.TEXTURE_2D,
        textures[i],
        0
      );
      drawBuffers.push(WebGL2RenderingContext.COLOR_ATTACHMENT0 + i);
    }

    this._gl.drawBuffers(drawBuffers);

    const status = this._gl.checkFramebufferStatus(
      WebGL2RenderingContext.FRAMEBUFFER
    );
    if (status !== WebGL2RenderingContext.FRAMEBUFFER_COMPLETE) {
      throw new Error(`Incomplete frame buffer, status: ${status}`);
    }
    this._gl.bindFramebuffer(WebGL2RenderingContext.FRAMEBUFFER, null);
  }

  setRenderTarget(target: RenderTarget) {
    this._gl.bindFramebuffer(WebGL2RenderingContext.FRAMEBUFFER, target);
  }

  setCullFace(face: GLenum) {
    this._gl.frontFace(face);
  }

  enableDepthWrite(flag: boolean) {
    this._gl.depthMask(flag);
  }

  clearRenderTarget() {
    this._gl.clear(
      WebGL2RenderingContext.COLOR_BUFFER_BIT |
        WebGL2RenderingContext.DEPTH_BUFFER_BIT
    );
    // this._gl.clearBufferuiv(WebGL2RenderingContext.COLOR, 0, [0, 0, 0, 0]);
    // this._gl.clearBufferfv(WebGL2RenderingContext.DEPTH, 0, [1.0]);
  }

  destroyProgram(program: ShaderProgram) {
    program.shaders.forEach((shader) => this._gl.deleteShader(shader));
    this._gl.deleteProgram(program.program);
  }

  destroyGeometry(geometry: Geometry) {
    this._gl.deleteBuffer(geometry.ebo);
    this._gl.deleteBuffer(geometry.vbo);
    this._gl.deleteVertexArray(geometry.vao);
  }

  destroyRenderTarget(target: RenderTarget) {
    this._gl.deleteFramebuffer(target);
  }

  destroyTexture(texture: Texture2d) {
    this._gl.deleteTexture(texture);
  }

  destroyTransfromFeedback(transformFeedback: TransformFeedback) {
    transformFeedback.buffers.forEach((tbo) => this._gl.deleteBuffer(tbo));
    this._gl.deleteTransformFeedback(transformFeedback.tfo);
  }

  readTransformFeedback(
    transformFeedback: TransformFeedback,
    buffers: Float32Array[]
  ): void {
    this._gl.bindTransformFeedback(
      WebGL2RenderingContext.TRANSFORM_FEEDBACK,
      transformFeedback.tfo
    );
    for (let i = 0; i < transformFeedback.buffers.length; i++) {
      this._gl.bindBuffer(
        WebGL2RenderingContext.TRANSFORM_FEEDBACK_BUFFER,
        transformFeedback.buffers[i]
      );
      this._gl.getBufferSubData(
        WebGL2RenderingContext.TRANSFORM_FEEDBACK_BUFFER,
        0,
        buffers[i]
      );
    }
    this._gl.bindTransformFeedback(
      WebGL2RenderingContext.TRANSFORM_FEEDBACK,
      null
    );
  }

  readValues(
    target: RenderTarget,
    values: Float32Array,
    width: number,
    height: number,
    format: GLenum,
    type: GLenum,
    slot: number
  ) {
    this._gl.bindFramebuffer(
      WebGL2RenderingContext.READ_FRAMEBUFFER,
      target ?? null
    );
    this._gl.readBuffer(WebGL2RenderingContext.COLOR_ATTACHMENT0 + slot);
    this._gl.readPixels(0, 0, width, height, format, type, values);
  }

  private createVertexBuffer(data: number, usage: GLenum): VertexBuffer;
  private createVertexBuffer(
    data: ArrayBufferView,
    usage: GLenum
  ): VertexBuffer;
  private createVertexBuffer(data: any, usage: GLenum): VertexBuffer {
    const vbo = this._gl.createBuffer();
    this._gl.bindBuffer(WebGL2RenderingContext.ARRAY_BUFFER, vbo);
    this._gl.bufferData(WebGL2RenderingContext.ARRAY_BUFFER, data, usage);
    this._gl.bindBuffer(WebGL2RenderingContext.ARRAY_BUFFER, null);
    return vbo;
  }

  private createIndexBuffer(data: ArrayBufferView): IndexBuffer {
    const ebo = this._gl.createBuffer();
    this._gl.bindBuffer(WebGL2RenderingContext.ELEMENT_ARRAY_BUFFER, ebo);
    this._gl.bufferData(
      WebGL2RenderingContext.ELEMENT_ARRAY_BUFFER,
      data,
      WebGL2RenderingContext.STATIC_DRAW
    );
    this._gl.bindBuffer(WebGL2RenderingContext.ELEMENT_ARRAY_BUFFER, null);
    return ebo;
  }
}
