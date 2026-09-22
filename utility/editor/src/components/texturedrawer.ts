import { Vector2, Vector3 } from '@zephyr3d/base';
import type {
  BaseTexture,
  BindGroup,
  GPUProgram,
  RenderStateSet,
  Texture2D,
  TextureSampler
} from '@zephyr3d/device';
import { Primitive, decodeNormalizedFloatFromRGBA, getDevice, linearToGamma } from '@zephyr3d/scene';

const UV_SCALE_ONE = new Vector2(1, 1);
const UV_SCALE_ZERO = new Vector2(0, 0);
const UV_OFFSET_ZERO = new Vector2(0, 0);

type SampleType = 'depth' | 'float' | 'unfilterable-float' | 'int' | 'uint';

type TextureViewProgram = {
  // 'float'
  normal: {
    program: GPUProgram;
    bindGroup: BindGroup;
  };
  // 'unfilterable-float'
  nonfilterable: {
    program: GPUProgram;
    bindGroup: BindGroup;
  };
  // 'int'
  int: {
    program: GPUProgram;
    bindGroup: BindGroup;
  };
  // 'uint
  uint: {
    program: GPUProgram;
    bindGroup: BindGroup;
  };
  // 'depth'
  depth: {
    program: GPUProgram;
    bindGroup: BindGroup;
  };
};
type TextureViewProgramEncodes = TextureViewProgram[];

export class TextureDrawer {
  static readonly R = 1 << 0;
  static readonly G = 1 << 1;
  static readonly B = 1 << 2;
  static readonly A = 1 << 3;
  static readonly RG = this.R | this.G;
  static readonly RGB = this.R | this.G | this.B;
  static readonly RGBA = this.RGB | this.A;
  static readonly faceDirections = [
    [new Vector3(0, 0, -1), new Vector3(0, -1, 0), new Vector3(1, 0, 0)],
    [new Vector3(0, 0, 1), new Vector3(0, -1, 0), new Vector3(-1, 0, 0)],
    [new Vector3(1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 1, 0)],
    [new Vector3(1, 0, 0), new Vector3(0, 0, -1), new Vector3(0, -1, 0)],
    [new Vector3(1, 0, 0), new Vector3(0, -1, 0), new Vector3(0, 0, 1)],
    [new Vector3(-1, 0, 0), new Vector3(0, -1, 0), new Vector3(0, 0, -1)]
  ];
  static readonly ENCODE_NORMAL = 1;
  static readonly ENCODE_NORMALIZED_FLOAT = 2;

  private readonly _rect: Primitive;
  private readonly _dummyTexture: Texture2D;
  private readonly _renderStates: RenderStateSet;
  private readonly _probeRenderStates: RenderStateSet;
  private _program2D: TextureViewProgramEncodes;
  private _programCube: TextureViewProgramEncodes;
  private _programVideo: TextureViewProgramEncodes;
  private _program2DArray: TextureViewProgramEncodes;
  private readonly _programBk: GPUProgram;
  private _enableBlend: boolean;
  private _colorScale: number;
  constructor() {
    const device = getDevice();
    this._program2D = [];
    this._programCube = [];
    this._programVideo = [];
    this._program2DArray = [];
    [TextureDrawer.ENCODE_NORMAL, TextureDrawer.ENCODE_NORMALIZED_FLOAT].forEach((val) => {
      this._program2D[val] = this.create2DPrograms(val);
      this._programCube[val] = this.createCubePrograms(val);
      this._programVideo[val] = this.createVideoPrograms(val);
      if (device.type !== 'webgl') {
        this._program2DArray[val] = this.create2DArrayPrograms(val);
      }
    });
    this._programBk = this.createBkShader();
    const vb = device.createInterleavedVertexBuffer(
      ['position_f32x2', 'tex0_f32x2'],
      new Float32Array([1, 1, 1, 0, -1, 1, 0, 0, -1, -1, 0, 1, 1, -1, 1, 1])
    );
    const ib = device.createIndexBuffer(new Uint16Array([0, 1, 2, 0, 2, 3]));
    this._rect = new Primitive();
    this._rect.setVertexBuffer(vb);
    this._rect.setIndexBuffer(ib);
    this._rect.indexStart = 0;
    this._rect.indexCount = 6;
    this._rect.primitiveType = 'triangle-list';
    this._renderStates = device.createRenderStateSet();
    this._renderStates.useRasterizerState().setCullMode('none');
    this._renderStates.useDepthState().enableTest(false).enableWrite(false);
    // Blending must be off while probing, otherwise the raw sample value would be blended
    this._probeRenderStates = device.createRenderStateSet();
    this._probeRenderStates.useRasterizerState().setCullMode('none');
    this._probeRenderStates.useDepthState().enableTest(false).enableWrite(false);
    this._dummyTexture = device.createTexture2D('rgba8unorm', 1, 1, {
      mipmapping: false
    });
    this.alphaBlend = true;
    this._colorScale = 1;
  }
  get colorScale() {
    return this._colorScale;
  }
  set colorScale(val: number) {
    this._colorScale = val;
  }
  get alphaBlend() {
    return this._enableBlend;
  }
  set alphaBlend(val: boolean) {
    val = !!val;
    if (this._enableBlend !== val) {
      this._enableBlend = val;
      if (val) {
        this._renderStates.useBlendingState().enable(true).setBlendFunc('one', 'inv-src-alpha');
      } else {
        this._renderStates.defaultBlendingState();
      }
    }
  }
  draw(
    tex: BaseTexture,
    repeat: number,
    gammaCorrect: boolean,
    linear: boolean,
    flip: boolean,
    encode: number,
    mode: number,
    miplevel: number,
    faceOrLayer = 0
  ) {
    tex = tex ?? this._dummyTexture;
    const device = getDevice();
    const programinfo = this.getProgramInfo(tex, encode);
    if (!programinfo || tex.disposed) {
      return;
    }
    const sampler = this.createSampler(tex, linear, repeat);
    device.setProgram(this._programBk);
    device.setRenderStates(this._renderStates);
    this._rect.draw();
    this.setCommonUniforms(programinfo.bindGroup, tex, sampler, miplevel, faceOrLayer);
    programinfo.bindGroup.setValue('linearOutput', gammaCorrect ? 0 : 1);
    programinfo.bindGroup.setValue('flip', flip ? -1 : 1);
    programinfo.bindGroup.setValue(
      'uvScale',
      tex.isTextureCube() ? UV_SCALE_ONE : new Vector2(repeat, repeat)
    );
    programinfo.bindGroup.setValue('uvOffset', UV_OFFSET_ZERO);
    programinfo.bindGroup.setValue('colorScale', this._colorScale * this._colorScale);
    programinfo.bindGroup.setValue('mode', mode);
    programinfo.bindGroup.setValue('rawOutput', 0);
    device.setBindGroup(0, programinfo.bindGroup);
    device.setProgram(programinfo.program);
    this._rect.draw();
  }
  /**
   * Samples a single texel of given texture and writes the raw sampled value to the
   * current frame buffer, bypassing every transform that {@link TextureDrawer.draw} applies
   * for display purposes (channel mode, color scale, gamma and alpha premultiplication).
   *
   * @param tex - The texture to be sampled
   * @param u - Horizontal texture coordinate of the texel to be sampled
   * @param v - Vertical texture coordinate of the texel to be sampled
   * @param miplevel - The mipmap level to be sampled
   * @param faceOrLayer - The cube face or the array layer to be sampled
   * @returns true if the texel was drawn, false if the texture cannot be sampled
   */
  drawPixel(tex: BaseTexture, u: number, v: number, miplevel: number, faceOrLayer = 0) {
    const device = getDevice();
    const programinfo = tex ? this.getProgramInfo(tex, TextureDrawer.ENCODE_NORMAL) : null;
    if (!programinfo || tex.disposed) {
      return false;
    }
    const sampler = this.createSampler(tex, false, 1);
    this.setCommonUniforms(programinfo.bindGroup, tex, sampler, miplevel, faceOrLayer);
    programinfo.bindGroup.setValue('linearOutput', 1);
    programinfo.bindGroup.setValue('flip', 1);
    // A zero scale makes the whole quad sample the very same texel, the cube shader
    // takes the vertex position instead of the texture coordinate
    programinfo.bindGroup.setValue('uvScale', UV_SCALE_ZERO);
    programinfo.bindGroup.setValue(
      'uvOffset',
      tex.isTextureCube() ? new Vector2(u * 2 - 1, v * 2 - 1) : new Vector2(u, v)
    );
    programinfo.bindGroup.setValue('colorScale', 1);
    programinfo.bindGroup.setValue('mode', TextureDrawer.RGBA);
    programinfo.bindGroup.setValue('rawOutput', 1);
    device.setBindGroup(0, programinfo.bindGroup);
    device.setProgram(programinfo.program);
    device.setRenderStates(this._probeRenderStates);
    this._rect.draw();
    return true;
  }
  private getProgramInfo(tex: BaseTexture, encode: number) {
    return tex.isTextureVideo()
      ? this._programVideo[encode].normal
      : tex.isTexture2D()
        ? tex.isDepth()
          ? this._program2D[encode].depth
          : tex.isFilterable()
            ? this._program2D[encode].normal
            : tex.isIntegerFormat()
              ? tex.isSignedFormat()
                ? this._program2D[encode].int
                : this._program2D[encode].uint
              : this._program2D[encode].nonfilterable
        : tex.isTextureCube()
          ? tex.isDepth()
            ? this._programCube[encode].depth
            : tex.isFilterable()
              ? this._programCube[encode].normal
              : this._programCube[encode].nonfilterable
          : tex.isTexture2DArray()
            ? tex.isDepth()
              ? this._program2DArray[encode].depth
              : tex.isFilterable()
                ? this._program2DArray[encode].normal
                : tex.isIntegerFormat()
                  ? tex.isSignedFormat()
                    ? this._program2DArray[encode].int
                    : this._program2DArray[encode].uint
                  : this._program2DArray[encode].nonfilterable
            : null;
  }
  private createSampler(tex: BaseTexture, linear: boolean, repeat: number) {
    // Depth, integer and non-filterable textures are bound to a non-filtering sampler
    // in the generated bind group layout, linear filtering is not an option for them
    const filterable = tex.isFilterable() && !tex.isDepth() && !tex.isIntegerFormat();
    const useLinear = linear && filterable;
    return getDevice().createSampler({
      magFilter: useLinear ? 'linear' : 'nearest',
      minFilter: useLinear ? 'linear' : 'nearest',
      mipFilter: tex.mipLevelCount > 1 ? (useLinear ? 'linear' : 'nearest') : 'none',
      addressU: repeat === 1 ? 'clamp' : 'repeat',
      addressV: repeat === 1 ? 'clamp' : 'repeat'
    });
  }
  private setCommonUniforms(
    bindGroup: BindGroup,
    tex: BaseTexture,
    sampler: TextureSampler,
    miplevel: number,
    faceOrLayer: number
  ) {
    bindGroup.setTexture('tex', tex, sampler);
    // texSize is used to address individual texels of integer textures, so it must be
    // the size of the mipmap level being sampled
    bindGroup.setValue(
      'texSize',
      new Vector2(Math.max(1, tex.width >> miplevel), Math.max(1, tex.height >> miplevel))
    );
    bindGroup.setValue('miplevel', miplevel);
    if (tex.isTextureCube()) {
      bindGroup.setValue('up', TextureDrawer.faceDirections[faceOrLayer][0]);
      bindGroup.setValue('right', TextureDrawer.faceDirections[faceOrLayer][1]);
      bindGroup.setValue('front', TextureDrawer.faceDirections[faceOrLayer][2]);
    } else if (tex.isTexture2DArray()) {
      bindGroup.setValue('layer', faceOrLayer);
    }
  }
  private create2DPrograms(encode: number): TextureViewProgram {
    const device = getDevice();
    const normal = this.create2DProgram('float', encode);
    const nonfilterable = this.create2DProgram('unfilterable-float', encode);
    const depth = this.create2DProgram('depth', encode);
    const int = device.type === 'webgl' ? null : this.create2DProgram('int', encode);
    const uint = device.type === 'webgl' ? null : this.create2DProgram('uint', encode);
    return {
      normal: {
        program: normal,
        bindGroup: device.createBindGroup(normal.bindGroupLayouts[0])
      },
      nonfilterable: {
        program: nonfilterable,
        bindGroup: device.createBindGroup(nonfilterable.bindGroupLayouts[0])
      },
      depth: {
        program: depth,
        bindGroup: device.createBindGroup(depth.bindGroupLayouts[0])
      },
      int: {
        program: int,
        bindGroup: int ? device.createBindGroup(int.bindGroupLayouts[0]) : null
      },
      uint: {
        program: uint,
        bindGroup: uint ? device.createBindGroup(uint.bindGroupLayouts[0]) : null
      }
    };
  }
  private createVideoPrograms(encode: number): TextureViewProgram {
    const device = getDevice();
    const normal = this.createVideoProgram(encode);
    const bindgroup = device.createBindGroup(normal.bindGroupLayouts[0]);
    return {
      normal: {
        program: normal,
        bindGroup: bindgroup
      },
      nonfilterable: {
        program: normal,
        bindGroup: bindgroup
      },
      depth: {
        program: normal,
        bindGroup: bindgroup
      },
      int: {
        program: null,
        bindGroup: null
      },
      uint: {
        program: null,
        bindGroup: null
      }
    };
  }
  private createCubePrograms(encode: number): TextureViewProgram {
    const device = getDevice();
    const normal = this.createCubeProgram('float', encode);
    const nonfilterable = this.createCubeProgram('unfilterable-float', encode);
    const depth = this.createCubeProgram('depth', encode);
    return {
      normal: {
        program: normal,
        bindGroup: device.createBindGroup(normal.bindGroupLayouts[0])
      },
      nonfilterable: {
        program: nonfilterable,
        bindGroup: device.createBindGroup(nonfilterable.bindGroupLayouts[0])
      },
      depth: {
        program: depth,
        bindGroup: device.createBindGroup(depth.bindGroupLayouts[0])
      },
      int: null,
      uint: null
    };
  }
  private create2DArrayPrograms(encode: number): TextureViewProgram {
    const device = getDevice();
    const normal = this.create2DArrayProgram('float', encode);
    const nonfilterable = this.create2DArrayProgram('unfilterable-float', encode);
    const depth = this.create2DArrayProgram('depth', encode);
    const int = device.type === 'webgl' ? null : this.create2DArrayProgram('int', encode);
    const uint = device.type === 'webgl' ? null : this.create2DArrayProgram('uint', encode);
    return {
      normal: {
        program: normal,
        bindGroup: device.createBindGroup(normal.bindGroupLayouts[0])
      },
      nonfilterable: {
        program: nonfilterable,
        bindGroup: device.createBindGroup(nonfilterable.bindGroupLayouts[0])
      },
      depth: {
        program: depth,
        bindGroup: device.createBindGroup(depth.bindGroupLayouts[0])
      },
      int: {
        program: int,
        bindGroup: int ? device.createBindGroup(int.bindGroupLayouts[0]) : null
      },
      uint: {
        program: uint,
        bindGroup: uint ? device.createBindGroup(uint.bindGroupLayouts[0]) : null
      }
    };
  }
  private create2DProgram(sampleType: SampleType, encode: number): GPUProgram {
    const device = getDevice();
    return device.buildRenderProgram({
      vertex(pb) {
        this.$inputs.pos = pb.vec2().attrib('position');
        this.$inputs.uv = pb.vec2().attrib('texCoord0');
        this.$outputs.uv = pb.vec2();
        this.flip = pb.float().uniform(0);
        this.uvScale = pb.vec2().uniform(0);
        this.uvOffset = pb.vec2().uniform(0);
        pb.main(function () {
          this.$builtins.position = pb.mul(pb.vec4(this.$inputs.pos, 0, 1), pb.vec4(1, this.flip, 1, 1));
          this.$outputs.uv = pb.add(pb.mul(this.$inputs.uv, this.uvScale), this.uvOffset);
        });
      },
      fragment(pb) {
        switch (sampleType) {
          case 'depth':
            // Declared as a normal texture with depth sample type instead of a shadow
            // texture, so that we read the depth value itself instead of a comparison result
            this.tex = pb.tex2D().sampleType('depth').uniform(0);
            break;
          case 'float':
            this.tex = pb.tex2D().uniform(0);
            break;
          case 'unfilterable-float':
            this.tex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
            break;
          case 'int':
            this.tex = pb.itex2D().uniform(0);
            break;
          case 'uint':
            this.tex = pb.utex2D().uniform(0);
            break;
          default:
            throw new Error('Invalid sample type');
        }
        this.texSize = pb.vec2().uniform(0);
        this.linearOutput = pb.int().uniform(0);
        this.mode = pb.int().uniform(0);
        this.miplevel = pb.float().uniform(0);
        this.colorScale = pb.float().uniform(0);
        this.rawOutput = pb.int().uniform(0);
        this.$outputs.color = pb.vec4();
        pb.func('getCenter', [pb.vec2('coord'), pb.vec2('texelSize')], function () {
          this.$return(
            pb.add(pb.sub(this.coord, pb.mod(this.coord, this.texelSize)), pb.mul(this.texelSize, 0.5))
          );
        });
        if (sampleType === 'float' || sampleType === 'unfilterable-float') {
          pb.func('linearFilter', [pb.vec2('coord')], function () {
            this.$l.invTexSize = pb.div(pb.vec2(1), this.texSize);
            this.$l.x = pb.fract(this.coord);
            this.$l.t = pb.floor(pb.sub(pb.mul(this.x, this.texSize), pb.vec2(0.5)));
            this.$l.lt = pb.div(pb.add(this.t, pb.vec2(0.5)), this.texSize);
            this.$l.ratio = pb.mul(pb.sub(this.x, this.lt), this.texSize);
            this.$l.ltSample = pb.textureSampleLevel(this.tex, this.lt, this.miplevel);
            this.$l.lbSample = pb.textureSampleLevel(
              this.tex,
              pb.add(this.lt, pb.vec2(0, this.invTexSize.y)),
              this.miplevel
            );
            this.$l.rbSample = pb.textureSampleLevel(
              this.tex,
              pb.add(this.lt, this.invTexSize),
              this.miplevel
            );
            this.$l.rtSample = pb.textureSampleLevel(
              this.tex,
              pb.add(this.lt, pb.vec2(this.invTexSize.x, 0)),
              this.miplevel
            );
            //this.$return(pb.vec4(this.lt.x));
            this.$return(
              pb.mix(
                pb.mix(this.ltSample, this.rtSample, this.ratio.x),
                pb.mix(this.lbSample, this.rbSample, this.ratio.x),
                this.ratio.y
              )
            );
            /*
            this.$l.texelSize = pb.div(pb.vec2(1), this.texSize);
            this.$l.lt = pb.sub(this.coord, pb.mul(this.texelSize, 0.49));
            this.$l.rb = pb.add(this.coord, pb.mul(this.texelSize, 0.49));
            this.$l.ltcenter = this.getCenter(this.lt, this.texelSize);
            this.$l.lbcenter = this.getCenter(pb.vec2(this.lt.x, this.rb.y), this.texelSize);
            this.$l.rbcenter = this.getCenter(this.rb, this.texelSize);
            this.$l.rtcenter = this.getCenter(pb.vec2(this.rb.x, this.lt.y), this.texelSize);
            this.$l.ltSample = pb.textureSampleLevel(this.tex, this.ltcenter, this.miplevel);
            this.$l.lbSample = pb.textureSampleLevel(this.tex, this.lbcenter, this.miplevel);
            this.$l.rbSample = pb.textureSampleLevel(this.tex, this.rbcenter, this.miplevel);
            this.$l.rtSample = pb.textureSampleLevel(this.tex, this.rtcenter, this.miplevel);
            this.$l.t = pb.div(pb.sub(this.coord, this.ltcenter), pb.sub(this.rbcenter, this.ltcenter));
            this.$l.tSample = pb.mix(this.ltSample, this.rtSample, this.t.x);
            this.$l.bSample = pb.mix(this.lbSample, this.rbSample, this.t.x);
            this.$return(pb.mix(this.tSample, this.bSample, this.t.y));
*/
          });
        }
        pb.main(function () {
          this.c =
            sampleType === 'int' || sampleType === 'uint'
              ? pb.textureLoad(
                  this.tex,
                  pb.ivec2(pb.mul(this.$inputs.uv, this.texSize)),
                  pb.int(this.miplevel)
                )
              : /*this.linearFilter(this.$inputs.uv) */ pb.textureSampleLevel(
                  this.tex,
                  this.$inputs.uv,
                  this.miplevel
                );
          this.$l.rawColor = sampleType === 'int' || sampleType === 'uint' ? pb.vec4(this.c) : this.c;
          if (sampleType === 'depth') {
            // Sampling a depth texture yields (depth, 0, 0, 1), display it as grayscale
            this.rgb = pb.vec3(this.c.r);
            this.a = pb.float(1);
          } else if (
            (sampleType === 'float' || sampleType === 'unfilterable-float') &&
            encode === TextureDrawer.ENCODE_NORMALIZED_FLOAT
          ) {
            this.rgb = pb.vec3(decodeNormalizedFloatFromRGBA(this, this.c));
            this.a = pb.float(1);
          } else {
            this.rgb = pb.vec3(this.c.rgb);
            this.a = pb.float(this.c.a);
          }
          this.$if(pb.equal(this.mode, TextureDrawer.RGB), function () {
            this.a = 1;
          })
            .$elseif(pb.equal(this.mode, TextureDrawer.R), function () {
              this.rgb = this.rgb.rrr;
              this.a = 1;
            })
            .$elseif(pb.equal(this.mode, TextureDrawer.G), function () {
              this.rgb = this.rgb.ggg;
              this.a = 1;
            })
            .$elseif(pb.equal(this.mode, TextureDrawer.B), function () {
              this.rgb = this.rgb.bbb;
              this.a = 1;
            })
            .$elseif(pb.equal(this.mode, TextureDrawer.A), function () {
              this.rgb = pb.vec3(this.a);
              this.a = 1;
            })
            .$elseif(pb.equal(this.mode, TextureDrawer.RG), function () {
              this.rgb = pb.vec3(this.rgb.rg, 0);
              this.a = 1;
            });
          this.rgb = pb.abs(pb.mul(this.rgb, this.colorScale));
          this.$if(pb.notEqual(this.linearOutput, 0), function () {
            this.$outputs.color = pb.vec4(pb.mul(this.rgb, this.a), this.a);
          }).$else(function () {
            this.$outputs.color = pb.vec4(pb.mul(linearToGamma(this, this.rgb), this.a), this.a);
          });
          // Probing wants the value as it is stored in the texture
          this.$if(pb.notEqual(this.rawOutput, 0), function () {
            this.$outputs.color = this.rawColor;
          });
        });
      }
    });
  }
  private createVideoProgram(_encode: number): GPUProgram {
    const device = getDevice();
    return device.buildRenderProgram({
      vertex(pb) {
        this.$inputs.pos = pb.vec2().attrib('position');
        this.$inputs.uv = pb.vec2().attrib('texCoord0');
        this.$outputs.uv = pb.vec2();
        this.flip = pb.float().uniform(0);
        this.uvScale = pb.vec2().uniform(0);
        this.uvOffset = pb.vec2().uniform(0);
        pb.main(function () {
          this.$builtins.position = pb.mul(pb.vec4(this.$inputs.pos, 0, 1), pb.vec4(1, this.flip, 1, 1));
          this.$outputs.uv = pb.add(pb.mul(this.$inputs.uv, this.uvScale), this.uvOffset);
        });
      },
      fragment(pb) {
        this.tex = pb.texExternal().uniform(0);
        this.linearOutput = pb.int().uniform(0);
        this.mode = pb.int().uniform(0);
        this.miplevel = pb.float().uniform(0);
        this.colorScale = pb.float().uniform(0);
        this.rawOutput = pb.int().uniform(0);
        this.$outputs.color = pb.vec4();
        pb.main(function () {
          this.c = pb.textureSample(this.tex, this.$inputs.uv);
          this.$l.rawColor = this.c;
          this.rgb = pb.vec3(this.c.rgb);
          this.$if(pb.equal(this.mode, TextureDrawer.R), function () {
            this.rgb = this.rgb.rrr;
          })
            .$elseif(pb.equal(this.mode, TextureDrawer.G), function () {
              this.rgb = this.rgb.ggg;
            })
            .$elseif(pb.equal(this.mode, TextureDrawer.B), function () {
              this.rgb = this.rgb.bbb;
            })
            .$elseif(pb.equal(this.mode, TextureDrawer.A), function () {
              this.rgb = pb.vec3(1);
            });
          this.rgb = pb.abs(pb.mul(this.rgb, this.colorScale));
          this.$if(pb.notEqual(this.linearOutput, 0), function () {
            this.$outputs.color = pb.vec4(this.rgb, 1);
          }).$else(function () {
            this.$outputs.color = pb.vec4(linearToGamma(this, this.rgb), 1);
          });
          // Probing wants the value as it is stored in the texture
          this.$if(pb.notEqual(this.rawOutput, 0), function () {
            this.$outputs.color = this.rawColor;
          });
        });
      }
    });
  }
  private createCubeProgram(sampleType: SampleType, encode: number): GPUProgram {
    const device = getDevice();
    return device.buildRenderProgram({
      vertex(pb) {
        this.$inputs.pos = pb.vec2().attrib('position');
        this.up = pb.vec3().uniform(0);
        this.right = pb.vec3().uniform(0);
        this.front = pb.vec3().uniform(0);
        this.flip = pb.float().uniform(0);
        this.uvScale = pb.vec2().uniform(0);
        this.uvOffset = pb.vec2().uniform(0);
        pb.main(function () {
          this.$builtins.position = pb.mul(pb.vec4(this.$inputs.pos, 0, 1), pb.vec4(1, this.flip, 1, 1));
          this.$l.p = pb.add(pb.mul(this.$inputs.pos, this.uvScale), this.uvOffset);
          this.$outputs.direction = pb.mul(pb.mat3(this.up, this.right, this.front), pb.vec3(this.p, 1));
          if (pb.getDevice().type === 'webgpu') {
            this.$builtins.position.y = pb.neg(this.$builtins.position.y);
          }
        });
      },
      fragment(pb) {
        switch (sampleType) {
          case 'depth':
            // Declared as a normal texture with depth sample type instead of a shadow
            // texture, so that we read the depth value itself instead of a comparison result
            this.tex = pb.texCube().sampleType('depth').uniform(0);
            break;
          case 'float':
            this.tex = pb.texCube().uniform(0);
            break;
          case 'unfilterable-float':
            this.tex = pb.texCube().sampleType('unfilterable-float').uniform(0);
            break;
          default:
            throw new Error('Invalid sample type');
        }
        this.texSize = pb.vec2().uniform(0);
        this.linearOutput = pb.int().uniform(0);
        this.mode = pb.int().uniform(0);
        this.miplevel = pb.float().uniform(0);
        this.colorScale = pb.float().uniform(0);
        this.rawOutput = pb.int().uniform(0);
        this.$outputs.color = pb.vec4();
        pb.main(function () {
          this.$l.n = this.$inputs.direction;
          this.c = pb.textureSampleLevel(this.tex, this.n, this.miplevel);
          this.$l.rawColor = this.c;
          if (sampleType === 'depth') {
            // Sampling a depth texture yields (depth, 0, 0, 1), display it as grayscale
            this.rgb = pb.vec3(this.c.r);
            this.a = pb.float(1);
          } else if (
            (sampleType === 'float' || sampleType === 'unfilterable-float') &&
            encode === TextureDrawer.ENCODE_NORMALIZED_FLOAT
          ) {
            this.rgb = pb.vec3(decodeNormalizedFloatFromRGBA(this, this.c));
            this.a = pb.float(1);
          } else {
            this.rgb = pb.vec3(this.c.rgb);
            this.a = pb.float(this.c.a);
          }
          this.$if(pb.equal(this.mode, TextureDrawer.RGB), function () {
            this.a = 1;
          })
            .$elseif(pb.equal(this.mode, TextureDrawer.R), function () {
              this.rgb = this.rgb.rrr;
              this.a = 1;
            })
            .$elseif(pb.equal(this.mode, TextureDrawer.G), function () {
              this.rgb = this.rgb.ggg;
              this.a = 1;
            })
            .$elseif(pb.equal(this.mode, TextureDrawer.B), function () {
              this.rgb = this.rgb.bbb;
              this.a = 1;
            })
            .$elseif(pb.equal(this.mode, TextureDrawer.A), function () {
              this.rgb = pb.vec3(this.a);
              this.a = 1;
            })
            .$elseif(pb.equal(this.mode, TextureDrawer.RG), function () {
              this.rgb = pb.vec3(this.rgb.rg, 0);
              this.a = 1;
            });
          this.rgb = pb.abs(pb.mul(this.rgb, this.colorScale));
          this.$if(pb.notEqual(this.linearOutput, 0), function () {
            this.$outputs.color = pb.vec4(pb.mul(this.rgb, this.a), this.a);
          }).$else(function () {
            this.$outputs.color = pb.vec4(pb.mul(linearToGamma(this, this.rgb), this.a), this.a);
          });
          // Probing wants the value as it is stored in the texture
          this.$if(pb.notEqual(this.rawOutput, 0), function () {
            this.$outputs.color = this.rawColor;
          });
        });
      }
    });
  }
  private create2DArrayProgram(sampleType: SampleType, encode: number): GPUProgram {
    const device = getDevice();
    return device.buildRenderProgram({
      vertex(pb) {
        this.$inputs.pos = pb.vec2().attrib('position');
        this.$inputs.uv = pb.vec2().attrib('texCoord0');
        this.$outputs.uv = pb.vec2();
        this.flip = pb.float().uniform(0);
        this.uvScale = pb.vec2().uniform(0);
        this.uvOffset = pb.vec2().uniform(0);
        pb.main(function () {
          this.$builtins.position = pb.mul(pb.vec4(this.$inputs.pos, 0, 1), pb.vec4(1, this.flip, 1, 1));
          this.$outputs.uv = pb.add(pb.mul(this.$inputs.uv, this.uvScale), this.uvOffset);
        });
      },
      fragment(pb) {
        switch (sampleType) {
          case 'depth':
            // Declared as a normal texture with depth sample type instead of a shadow
            // texture, so that we read the depth value itself instead of a comparison result
            this.tex = pb.tex2DArray().sampleType('depth').uniform(0);
            break;
          case 'float':
            this.tex = pb.tex2DArray().uniform(0);
            break;
          case 'unfilterable-float':
            this.tex = pb.tex2DArray().sampleType('unfilterable-float').uniform(0);
            break;
          case 'int':
            this.tex = pb.itex2DArray().uniform(0);
            break;
          case 'uint':
            this.tex = pb.utex2DArray().uniform(0);
            break;
          default:
            throw new Error('Invalid sampler type');
        }
        this.texSize = pb.vec2().uniform(0);
        this.linearOutput = pb.int().uniform(0);
        this.mode = pb.int().uniform(0);
        this.miplevel = pb.float().uniform(0);
        this.colorScale = pb.float().uniform(0);
        this.layer = pb.int().uniform(0);
        this.rawOutput = pb.int().uniform(0);
        this.$outputs.color = pb.vec4();
        pb.main(function () {
          this.c =
            sampleType === 'int' || sampleType === 'uint'
              ? pb.textureArrayLoad(
                  this.tex,
                  pb.ivec2(pb.mul(this.texSize, this.$inputs.uv)),
                  this.layer,
                  pb.int(this.miplevel)
                )
              : pb.textureArraySampleLevel(this.tex, this.$inputs.uv, this.layer, this.miplevel);
          this.$l.rawColor = sampleType === 'int' || sampleType === 'uint' ? pb.vec4(this.c) : this.c;
          if (sampleType === 'depth') {
            // Sampling a depth texture yields (depth, 0, 0, 1), display it as grayscale
            this.rgb = pb.vec3(this.c.r);
            this.a = pb.float(1);
          } else if (
            (sampleType === 'float' || sampleType === 'unfilterable-float') &&
            encode === TextureDrawer.ENCODE_NORMALIZED_FLOAT
          ) {
            this.rgb = pb.vec3(decodeNormalizedFloatFromRGBA(this, this.c));
            this.a = pb.float(1);
          } else {
            this.rgb = pb.vec3(this.c.rgb);
            this.a = pb.float(this.c.a);
          }
          this.$if(pb.equal(this.mode, TextureDrawer.RGB), function () {
            this.a = 1;
          })
            .$elseif(pb.equal(this.mode, TextureDrawer.R), function () {
              this.rgb = this.rgb.rrr;
              this.a = 1;
            })
            .$elseif(pb.equal(this.mode, TextureDrawer.G), function () {
              this.rgb = this.rgb.ggg;
              this.a = 1;
            })
            .$elseif(pb.equal(this.mode, TextureDrawer.B), function () {
              this.rgb = this.rgb.bbb;
              this.a = 1;
            })
            .$elseif(pb.equal(this.mode, TextureDrawer.A), function () {
              this.rgb = pb.vec3(this.a);
              this.a = 1;
            })
            .$elseif(pb.equal(this.mode, TextureDrawer.RG), function () {
              this.rgb = pb.vec3(this.rgb.rg, 0);
              this.a = 1;
            });
          this.rgb = pb.abs(pb.mul(this.rgb, this.colorScale));
          this.$if(pb.notEqual(this.linearOutput, 0), function () {
            this.$outputs.color = pb.vec4(pb.mul(this.rgb, this.a), this.a);
          }).$else(function () {
            this.$outputs.color = pb.vec4(pb.mul(linearToGamma(this, this.rgb), this.a), this.a);
          });
          // Probing wants the value as it is stored in the texture
          this.$if(pb.notEqual(this.rawOutput, 0), function () {
            this.$outputs.color = this.rawColor;
          });
        });
      }
    });
  }
  private createBkShader(): GPUProgram {
    const device = getDevice();
    return device.buildRenderProgram({
      vertex(pb) {
        this.$inputs.pos = pb.vec2().attrib('position');
        this.$inputs.uv = pb.vec2().attrib('texCoord0');
        this.$outputs.uv = pb.vec2();
        pb.main(function () {
          this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
          this.$outputs.uv = pb.mul(this.$inputs.uv, 16);
        });
      },
      fragment(pb) {
        this.$outputs.color = pb.vec4();
        pb.main(function () {
          this.color0 = pb.vec4(1, 1, 1, 1);
          this.color1 = pb.vec4(0.6, 0.6, 0.6, 1);
          this.c = pb.div(pb.floor(this.$inputs.uv), 2);
          this.checker = pb.mul(pb.fract(pb.add(this.c.x, this.c.y)), 2);
          this.checker = 0;
          this.$outputs.color = pb.add(
            pb.mul(this.color0, this.checker),
            pb.mul(this.color1, pb.sub(1, this.checker))
          );
        });
      }
    });
  }
}
