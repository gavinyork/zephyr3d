import { Vector3, Matrix4x4 } from '@zephyr3d/base';
import {
  GPUProgram,
  BaseTexture,
  Texture2D,
  TextureCube,
  TextureVideo,
  BindGroup,
  RenderStateSet,
  PBInsideFunctionScope,
  PBGlobalScope,
  PBShaderExp,
  ShaderType
} from '@zephyr3d/device';
import { AssetManager, BoxShape, panoramaToCubemap, prefilterCubemap, projectCubemap, projectCubemapCPU, Blitter, BlitType, Application, linearToGamma } from '@zephyr3d/scene';

const cubeMap = './assets/images/environments/cloudy.hdr';
const faceDirections = [
  [new Vector3(0, 0, -1), new Vector3(0, -1, 0), new Vector3(1, 0, 0)],
  [new Vector3(0, 0, 1), new Vector3(0, -1, 0), new Vector3(-1, 0, 0)],
  [new Vector3(1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 1, 0)],
  [new Vector3(1, 0, 0), new Vector3(0, 0, -1), new Vector3(0, -1, 0)],
  [new Vector3(1, 0, 0), new Vector3(0, -1, 0), new Vector3(0, 0, 1)],
  [new Vector3(-1, 0, 0), new Vector3(0, -1, 0), new Vector3(0, 0, -1)],
];

class ReduceBlitter extends Blitter {
  protected _width: number;
  constructor(width?: number) {
    super();
    this._width = width ?? 0;
  }
  get width(): number {
    return this._width;
  }
  set width(val: number) {
    this._width = val;
  }
  setup(scope: PBGlobalScope, type: BlitType) {
    const pb = scope.$builder;
    if (pb.shaderKind === 'fragment') {
      scope.width = pb.float().uniform(0);
    }
  }
  setUniforms(bindGroup: BindGroup) {
    bindGroup.setValue('width', this._width);
  }
  filter(scope: PBInsideFunctionScope, type: BlitType, srcTex: PBShaderExp, srcUV: PBShaderExp, srcLayer: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    pb.func('reduce', [pb.vec2('uv')], function(){
      this.$l.h = pb.div(0.5, this.width);
      // this.$l.uv1 = pb.add(this.uv, pb.vec2(this.h));
      this.$l.uv1 = this.uv;
      this.$l.tl = pb.textureSampleLevel(srcTex, pb.vec2(pb.sub(this.uv1.x, this.h), pb.sub(this.uv1.y, this.h)), 0);
      this.$l.tr = pb.textureSampleLevel(srcTex, pb.vec2(pb.add(this.uv1.x, this.h), pb.sub(this.uv1.y, this.h)), 0);
      this.$l.bl = pb.textureSampleLevel(srcTex, pb.vec2(pb.sub(this.uv1.x, this.h), pb.add(this.uv1.y, this.h)), 0);
      this.$l.br = pb.textureSampleLevel(srcTex, pb.vec2(pb.add(this.uv1.x, this.h), pb.add(this.uv1.y, this.h)), 0);
      this.$return(pb.vec4(pb.add(this.tl, this.tr, this.bl, this.br).rgb, 1));
    });
    return scope.reduce(srcUV);
  }
  protected calcHash(): string {
    return '';
  }
}

export abstract class TextureTestCase {
  protected assetManager: AssetManager;
  protected program: GPUProgram;
  protected texture: BaseTexture;
  protected bindgroup: BindGroup;
  protected renderStates: RenderStateSet;
  protected box: BoxShape;
  protected animate: boolean;
  constructor(assetManager: AssetManager) {
    this.assetManager = assetManager;
    this.program = null;
    this.texture = null;
    this.bindgroup = null;
    this.animate = true;
  }
  async init() {
    this.program = this.createProgram();
    this.texture = await this.createTexture();
    this.bindgroup = this.createBindGroup();
    this.box = new BoxShape({ size: 2, anchorX: 0.5, anchorY: 0.5, anchorZ: 0.5 });
    this.renderStates = Application.instance.device.createRenderStateSet();
    this.renderStates.useDepthState().enableTest(true);
  }
  draw(w: number, h: number) {
    this.updateBindGroup(Date.now(), w, h);
    Application.instance.device.setProgram(this.program);
    Application.instance.device.setRenderStates(this.renderStates);
    Application.instance.device.setBindGroup(0, this.bindgroup);
    this.box.draw();
  }
  protected abstract createProgram(): GPUProgram;
  protected abstract createTexture(): Promise<BaseTexture | TextureVideo>;
  protected abstract createBindGroup(): BindGroup;
  protected abstract updateBindGroup(t: number, width: number, height: number);
}

export class TestTexture2D extends TextureTestCase {
  private viewMatrix: Matrix4x4;
  constructor(assetManager: AssetManager) {
    super(assetManager);
    this.viewMatrix = Matrix4x4.lookAt(
      new Vector3(3, 3, 3),
      Vector3.zero(),
      Vector3.axisPY()
    ).inplaceInvertAffine();
  }
  protected createProgram(): GPUProgram {
    return Application.instance.device.buildRenderProgram({
      label: '2d',
      vertex(pb) {
        this.$inputs.pos = pb.vec3().attrib('position');
        this.$inputs.uv = pb.vec2().attrib('texCoord0');
        this.$outputs.texcoord = pb.vec2();
        this.mvpMatrix = pb.mat4().uniform(0);
        pb.main(function () {
          this.$builtins.position = pb.mul(this.mvpMatrix, pb.vec4(this.$inputs.pos, 1));
          this.$outputs.texcoord = this.$inputs.uv;
        });
      },
      fragment(pb) {
        this.tex = pb.tex2D().uniform(0);
        this.$outputs.color = pb.vec4();
        pb.main(function () {
          this.$l.color = pb.textureSample(this.tex, this.$inputs.texcoord);
          this.$outputs.color = pb.vec4(linearToGamma(this, this.color.rgb), 1);
        });
      }
    });
  }
  protected async createTexture(): Promise<BaseTexture> {
    return (await this.assetManager.fetchTexture(`./assets/images/gj02.dds`)) as Texture2D;
  }
  protected createBindGroup(): BindGroup {
    const bindGroup = Application.instance.device.createBindGroup(this.program.bindGroupLayouts[0]);
    bindGroup.setTexture('tex', this.texture);
    return bindGroup;
  }
  protected updateBindGroup(t: number, w: number, h: number) {
    const vpMatrix = Matrix4x4.multiply(Matrix4x4.perspective(Math.PI / 3, w / h, 1, 10), this.viewMatrix);
    const matrix = this.animate
      ? Matrix4x4.multiply(vpMatrix, Matrix4x4.rotationY((t * 0.001) % (2 * Math.PI)))
      : vpMatrix;
    this.bindgroup.setValue('mvpMatrix', matrix);
  }
}

export class TestTextureVideo extends TextureTestCase {
  private viewMatrix: Matrix4x4;
  private el: HTMLVideoElement;
  private videoSrc: string;
  constructor(assetManager: AssetManager, video: string) {
    super(assetManager);
    this.viewMatrix = Matrix4x4.lookAt(
      new Vector3(3, 3, 3),
      Vector3.zero(),
      Vector3.axisPY()
    ).inplaceInvertAffine();
    this.videoSrc = video;
  }
  protected createProgram(): GPUProgram {
    return Application.instance.device.buildRenderProgram({
      label: '2d',
      vertex(pb) {
        this.$inputs.pos = pb.vec3().attrib('position');
        this.$inputs.uv = pb.vec2().attrib('texCoord0');
        this.$outputs.texcoord = pb.vec2();
        this.mvpMatrix = pb.mat4().uniform(0);
        pb.main(function () {
          this.$builtins.position = pb.mul(this.mvpMatrix, pb.vec4(this.$inputs.pos, 1));
          this.$outputs.texcoord = this.$inputs.uv;
        });
      },
      fragment(pb) {
        this.tex = pb.texExternal().uniform(0);
        this.$outputs.color = pb.vec4();
        pb.main(function () {
          this.$outputs.color = pb.textureSample(this.tex, this.$inputs.texcoord);
          // this.$outputs.color = pb.vec4(pb.pow(this.$outputs.color.xyz, pb.vec3(1 / 2.2)), this.$outputs.color.w);
        });
      }
    });
  }
  protected async createTexture(): Promise<BaseTexture | TextureVideo> {
    this.el = document.createElement('video');
    this.el.src = this.videoSrc;
    this.el.loop = true;
    this.el.muted = true;
    document.body.append(this.el);
    await this.el.play();

    return Application.instance.device.createTextureVideo(this.el);
  }
  protected createBindGroup(): BindGroup {
    const bindGroup = Application.instance.device.createBindGroup(this.program.bindGroupLayouts[0]);
    bindGroup.setTexture('tex', this.texture);
    return bindGroup;
  }
  protected updateBindGroup(t: number, w: number, h: number) {
    const vpMatrix = Matrix4x4.multiply(Matrix4x4.perspective(Math.PI / 3, w / h, 1, 10), this.viewMatrix);
    const matrix = this.animate
      ? Matrix4x4.multiply(vpMatrix, Matrix4x4.rotationY((t * 0.001) % (2 * Math.PI)))
      : vpMatrix;
    this.bindgroup.setValue('mvpMatrix', matrix);
  }
}

export class TestTexture2DArray extends TextureTestCase {
  private viewMatrix: Matrix4x4;
  constructor(assetManager: AssetManager) {
    super(assetManager);
    this.viewMatrix = Matrix4x4.lookAt(
      new Vector3(3, 3, 3),
      Vector3.zero(),
      Vector3.axisPY()
    ).inplaceInvertAffine();
  }
  protected createProgram(): GPUProgram {
    return Application.instance.device.buildRenderProgram({
      label: '2d-array',
      vertex(pb) {
        this.$inputs.pos = pb.vec3().attrib('position');
        this.$outputs.texcoord = pb.vec3();
        this.mvpMatrix = pb.mat4().uniform(0);
        pb.main(function () {
          this.$builtins.position = pb.mul(this.mvpMatrix, pb.vec4(this.$inputs.pos, 1));
          this.$outputs.texcoord = pb.add(pb.mul(this.$inputs.pos, 0.5), pb.vec3(0.5));
        });
      },
      fragment(pb) {
        this.tex = pb.tex2DArray().uniform(0);
        this.$outputs.color = pb.vec4();
        pb.main(function () {
          this.$outputs.color = pb.textureArraySample(
            this.tex,
            this.$inputs.texcoord.xy,
            pb.int(pb.mul(this.$inputs.texcoord.z, 4))
          );
          this.$outputs.color = pb.vec4(linearToGamma(this, this.$outputs.color.rgb), 1);
        });
      }
    });
  }
  protected async createTexture(): Promise<BaseTexture> {
    const red = [255, 0, 0, 255];
    const green = [0, 255, 0, 255];
    const blue = [0, 0, 255, 255];
    const yellow = [255, 255, 0, 255];
    const purple = [255, 0, 255, 255];
    const black = [0, 0, 0, 255];
    const white = [255, 255, 255, 255];
    const pixels = new Uint8Array([
      ...red,
      ...green,
      ...blue,
      ...yellow,
      ...purple,
      ...black,
      ...white,
      ...red,
      ...green,
      ...blue,
      ...yellow,
      ...purple,
      ...black,
      ...white,
      ...red,
      ...green,

      ...green,
      ...blue,
      ...yellow,
      ...purple,
      ...black,
      ...white,
      ...red,
      ...green,
      ...blue,
      ...yellow,
      ...purple,
      ...black,
      ...white,
      ...red,
      ...green,
      ...blue,

      ...blue,
      ...yellow,
      ...purple,
      ...black,
      ...white,
      ...red,
      ...green,
      ...blue,
      ...yellow,
      ...purple,
      ...black,
      ...white,
      ...red,
      ...green,
      ...blue,
      ...yellow,

      ...yellow,
      ...purple,
      ...black,
      ...white,
      ...red,
      ...green,
      ...blue,
      ...yellow,
      ...purple,
      ...black,
      ...white,
      ...red,
      ...green,
      ...blue,
      ...yellow,
      ...purple
    ]);
    const tex = Application.instance.device.createTexture2DArray('rgba8unorm', 4, 4, 4);
    tex.update(pixels, 0, 0, 0, 4, 4, 4);
    return tex;
  }
  protected createBindGroup(): BindGroup {
    const bindGroup = Application.instance.device.createBindGroup(this.program.bindGroupLayouts[0]);
    bindGroup.setTexture('tex', this.texture);
    return bindGroup;
  }
  protected updateBindGroup(t: number, w: number, h: number) {
    const vpMatrix = Matrix4x4.multiply(Matrix4x4.perspective(Math.PI / 3, w / h, 1, 10), this.viewMatrix);
    const matrix = this.animate
      ? Matrix4x4.multiply(vpMatrix, Matrix4x4.rotationY((t * 0.001) % (2 * Math.PI)))
      : vpMatrix;
    this.bindgroup.setValue('mvpMatrix', matrix);
  }
}

export class TestTexture3D extends TextureTestCase {
  private viewMatrix: Matrix4x4;
  constructor(assetManager: AssetManager) {
    super(assetManager);
    this.viewMatrix = Matrix4x4.lookAt(
      new Vector3(3, 3, 3),
      Vector3.zero(),
      Vector3.axisPY()
    ).inplaceInvertAffine();
  }
  protected createProgram(): GPUProgram {
    return Application.instance.device.buildRenderProgram({
      label: '3d',
      vertex(pb) {
        this.$inputs.pos = pb.vec3().attrib('position');
        this.$outputs.texcoord = pb.vec3();
        this.mvpMatrix = pb.mat4().uniform(0);
        pb.main(function () {
          this.$builtins.position = pb.mul(this.mvpMatrix, pb.vec4(this.$inputs.pos, 1));
          this.$outputs.texcoord = pb.add(pb.mul(this.$inputs.pos, 0.5), pb.vec3(0.5));
        });
      },
      fragment(pb) {
        this.tex = pb.tex3D().uniform(0);
        this.$outputs.color = pb.vec4();
        pb.main(function () {
          this.$outputs.color = pb.textureSample(this.tex, this.$inputs.texcoord);
          this.$outputs.color = pb.vec4(
            linearToGamma(this, this.$outputs.color.rgb),
            this.$outputs.color.w
          );
        });
      }
    });
  }
  protected async createTexture(): Promise<BaseTexture> {
    const red = [255, 0, 0, 255];
    const green = [0, 255, 0, 255];
    const blue = [0, 0, 255, 255];
    const yellow = [255, 255, 0, 255];
    const purple = [255, 0, 255, 255];
    const black = [0, 0, 0, 255];
    const white = [255, 255, 255, 255];
    const pixels = new Uint8Array([
      ...red,
      ...green,
      ...blue,
      ...yellow,
      ...purple,
      ...black,
      ...white,
      ...red,
      ...green,
      ...blue,
      ...yellow,
      ...purple,
      ...black,
      ...white,
      ...red,
      ...green,

      ...green,
      ...blue,
      ...yellow,
      ...purple,
      ...black,
      ...white,
      ...red,
      ...green,
      ...blue,
      ...yellow,
      ...purple,
      ...black,
      ...white,
      ...red,
      ...green,
      ...blue,

      ...blue,
      ...yellow,
      ...purple,
      ...black,
      ...white,
      ...red,
      ...green,
      ...blue,
      ...yellow,
      ...purple,
      ...black,
      ...white,
      ...red,
      ...green,
      ...blue,
      ...yellow,

      ...yellow,
      ...purple,
      ...black,
      ...white,
      ...red,
      ...green,
      ...blue,
      ...yellow,
      ...purple,
      ...black,
      ...white,
      ...red,
      ...green,
      ...blue,
      ...yellow,
      ...purple
    ]);
    const tex = Application.instance.device.createTexture3D('rgba8unorm', 4, 4, 4, {
      noMipmap: true
    });
    tex.update(pixels, 0, 0, 0, 4, 4, 4);
    return tex;
  }
  protected createBindGroup(): BindGroup {
    const bindGroup = Application.instance.device.createBindGroup(this.program.bindGroupLayouts[0]);
    bindGroup.setTexture('tex', this.texture);
    return bindGroup;
  }
  protected updateBindGroup(t: number, w: number, h: number) {
    const vpMatrix = Matrix4x4.multiply(Matrix4x4.perspective(Math.PI / 3, w / h, 1, 10), this.viewMatrix);
    const matrix = this.animate
      ? Matrix4x4.multiply(vpMatrix, Matrix4x4.rotationY((t * 0.001) % (2 * Math.PI)))
      : vpMatrix;
    this.bindgroup.setValue('mvpMatrix', matrix);
  }
}

export class TestTextureCube extends TextureTestCase {
  private viewMatrix: Matrix4x4;
  private srcTex: TextureCube;
  private prefilteredTex: TextureCube;
  constructor(assetManager: AssetManager) {
    super(assetManager);
    this.viewMatrix = Matrix4x4.lookAt(
      new Vector3(3, 3, 3),
      Vector3.zero(),
      Vector3.axisPY()
    ).inplaceInvertAffine();
    this.srcTex = null;
    this.prefilteredTex = null;
  }
  protected createProgram(): GPUProgram {
    return Application.instance.device.buildRenderProgram({
      label: 'cube',
      vertex(pb) {
        this.$inputs.pos = pb.vec3().attrib('position');
        this.$outputs.texcoord = pb.vec3();
        this.mvpMatrix = pb.mat4().uniform(0);
        pb.main(function () {
          this.$builtins.position = pb.mul(this.mvpMatrix, pb.vec4(this.$inputs.pos, 1));
          this.$outputs.texcoord = this.$inputs.pos;
        });
      },
      fragment(pb) {
        this.tex = pb.texCube().uniform(0);
        this.$outputs.color = pb.vec4();
        pb.main(function () {
          this.$l.color = pb.textureSample(this.tex, pb.normalize(this.$inputs.texcoord)).rgb;
          //this.color = pb.sub(pb.vec3(1.0), pb.exp(pb.mul(-2, this.color)));
          // this.color = pb.div(this.color, pb.add(pb.vec3(1), this.color));
          //this.$outputs.color = pb.vec4(pb.add(pb.mul(pb.normalize(this.$inputs.texcoord), 0.5), pb.vec3(0.5)), 1);
          this.$outputs.color = pb.vec4(this.color, 1);
        });
      }
    });
  }
  protected async createTexture(): Promise<BaseTexture> {
    const tex = (await this.assetManager.fetchTexture(cubeMap)) as Texture2D;
    this.srcTex = Application.instance.device.createCubeTexture(tex.format, 128);
    panoramaToCubemap(tex, this.srcTex);
    tex.dispose();
    this.prefilteredTex = Application.instance.device.createCubeTexture('rgba16f', 128, { noMipmap: true });
    prefilterCubemap(this.srcTex, 'lambertian', this.prefilteredTex, 300);
    return this.srcTex;
  }
  protected createBindGroup(): BindGroup {
    const bindGroup = Application.instance.device.createBindGroup(this.program.bindGroupLayouts[0]);
    bindGroup.setTexture('tex', this.texture);
    return bindGroup;
  }
  protected updateBindGroup(t: number, w: number, h: number) {
    const vpMatrix = Matrix4x4.multiply(Matrix4x4.perspective(Math.PI / 3, w / h, 1, 10), this.viewMatrix);
    const matrix = this.animate
      ? Matrix4x4.multiply(vpMatrix, Matrix4x4.rotationY((t * 0.001) % (2 * Math.PI)))
      : vpMatrix;
    this.bindgroup.setValue('mvpMatrix', matrix);
    this.bindgroup.setTexture('tex', this.prefilteredTex);
  }
}

export class TestTextureCubePMREM extends TextureTestCase {
  private viewMatrix: Matrix4x4;
  constructor(assetManager: AssetManager) {
    super(assetManager);
    this.viewMatrix = Matrix4x4.lookAt(
      new Vector3(3, 3, 3),
      Vector3.zero(),
      Vector3.axisPY()
    ).inplaceInvertAffine();
  }
  protected createProgram(): GPUProgram {
    return Application.instance.device.buildRenderProgram({
      label: 'cube',
      vertex(pb) {
        this.$inputs.pos = pb.vec3().attrib('position');
        this.$outputs.texcoord = pb.vec3();
        this.mvpMatrix = pb.mat4().uniform(0);
        pb.main(function () {
          this.$builtins.position = pb.mul(this.mvpMatrix, pb.vec4(this.$inputs.pos, 1));
          this.$outputs.texcoord = this.$inputs.pos;
        });
      },
      fragment(pb) {
        this.tex = pb.texCube().uniform(0);
        this.$outputs.color = pb.vec4();
        pb.main(function () {
          this.$outputs.color = pb.textureSample(this.tex, pb.normalize(this.$inputs.texcoord));
          this.$outputs.color = pb.vec4(
            linearToGamma(this, this.$outputs.color.rgb),
            this.$outputs.color.w
          );
        });
      }
    });
  }
  protected async createTexture(): Promise<BaseTexture> {
    /*
    const srcTex = (await this.assetManager.fetchTexture('./assets/images/sky2.dds', null, true)) as TextureCube;
    //const srcTex = await this.assetManager.fetchTexture<TextureCube>(`./assets/images/environments/sunset/output_skybox.dds`)
    const pmremGenerator = new PMREMGenerator(Application.instance.device);
    const prefilteredTex = pmremGenerator.prefilterCubemap(srcTex, 'lambertian', 64);
    srcTex.dispose();
    return prefilteredTex;
    */
    const srcTex = (await this.assetManager.fetchTexture(`./assets/images/environments/Colorful_Studio.hdr`)) as Texture2D;
    const tex = Application.instance.device.createCubeTexture(srcTex.format, 256);
    panoramaToCubemap(srcTex, tex);
    //const prefilteredTex = prefilterCubemap(tex, 'lambertian', 64);
    srcTex.dispose();
    //tex.dispose();
    return tex;
  }
  protected createBindGroup(): BindGroup {
    const bindGroup = Application.instance.device.createBindGroup(this.program.bindGroupLayouts[0]);
    bindGroup.setTexture('tex', this.texture);
    return bindGroup;
  }
  protected updateBindGroup(t: number, w: number, h: number) {
    const vpMatrix = Matrix4x4.multiply(Matrix4x4.perspective(Math.PI / 3, w / h, 1, 10), this.viewMatrix);
    const matrix = this.animate
      ? Matrix4x4.multiply(vpMatrix, Matrix4x4.rotationY((t * 0.001) % (2 * Math.PI)))
      : vpMatrix;
    this.bindgroup.setValue('mvpMatrix', matrix);
  }
}

export class TestTextureCubeSH extends TextureTestCase {
  private viewMatrix: Matrix4x4;
  private shCoeff: Vector3[];
  private prefiltered: TextureCube;
  private srcTex: TextureCube;
  constructor(assetManager: AssetManager) {
    super(assetManager);
    this.viewMatrix = Matrix4x4.lookAt(
      new Vector3(3, 3, 3),
      Vector3.zero(),
      Vector3.axisPY()
    ).inplaceInvertAffine();
    this.shCoeff = Array.from({ length: 9 }).map(() => Vector3.zero());
    this.prefiltered = null;
  }
  protected createProgram(): GPUProgram {
    return Application.instance.device.buildRenderProgram({
      label: 'cube',
      vertex(pb) {
        this.$inputs.pos = pb.vec3().attrib('position');
        this.$outputs.texcoord = pb.vec3();
        this.mvpMatrix = pb.mat4().uniform(0);
        pb.main(function () {
          this.$builtins.position = pb.mul(this.mvpMatrix, pb.vec4(this.$inputs.pos, 1));
          this.$outputs.texcoord = this.$inputs.pos;
        });
      },
      fragment(pb) {
        const structSH = pb.defineStruct([
          pb.vec3('sh0'),
          pb.vec3('sh1'),
          pb.vec3('sh2'),
          pb.vec3('sh3'),
          pb.vec3('sh4'),
          pb.vec3('sh5'),
          pb.vec3('sh6'),
          pb.vec3('sh7'),
          pb.vec3('sh8')
        ]);
        this.sh = structSH().uniform(0);
        this.$outputs.color = pb.vec4();
        pb.func('Y0', [pb.vec3('v')], function(){
          this.$return(0.2820947917);
        });
        pb.func('Y1', [pb.vec3('v')], function(){
          this.$return(pb.mul(this.v.y, -0.4886025119));
        });
        pb.func('Y2', [pb.vec3('v')], function(){
          this.$return(pb.mul(this.v.z, 0.4886025119));
        });
        pb.func('Y3', [pb.vec3('v')], function(){
          this.$return(pb.mul(this.v.x, -0.4886025119));
        });
        pb.func('Y4', [pb.vec3('v')], function(){
          this.$return(pb.mul(this.v.x, this.v.y, 1.0925484306));
        });
        pb.func('Y5', [pb.vec3('v')], function(){
          this.$return(pb.mul(this.v.y, this.v.z, -1.0925484306));
        });
        pb.func('Y6', [pb.vec3('v')], function(){
          this.$return(pb.mul(pb.sub(pb.mul(this.v.z, this.v.z, 3), 1), 0.3153915652));
        });
        pb.func('Y7', [pb.vec3('v')], function(){
          this.$return(pb.mul(this.v.x, this.v.z, -1.0925484306));
        });
        pb.func('Y8', [pb.vec3('v')], function(){
          this.$return(pb.mul(pb.sub(pb.mul(this.v.x, this.v.x), pb.mul(this.v.y, this.v.y)), 0.5462742153));
        });
        pb.main(function () {
          this.$l.v = pb.normalize(this.$inputs.texcoord);
          this.$l.c = pb.mul(this.sh.sh0, this.Y0(this.v));
          this.c = pb.add(this.c, pb.mul(this.sh.sh1, this.Y1(this.v)));
          this.c = pb.add(this.c, pb.mul(this.sh.sh2, this.Y2(this.v)));
          this.c = pb.add(this.c, pb.mul(this.sh.sh3, this.Y3(this.v)));
          this.c = pb.add(this.c, pb.mul(this.sh.sh4, this.Y4(this.v)));
          this.c = pb.add(this.c, pb.mul(this.sh.sh5, this.Y5(this.v)));
          this.c = pb.add(this.c, pb.mul(this.sh.sh6, this.Y6(this.v)));
          this.c = pb.add(this.c, pb.mul(this.sh.sh7, this.Y7(this.v)));
          this.c = pb.add(this.c, pb.mul(this.sh.sh8, this.Y8(this.v)));
          //this.c = pb.div(this.c, pb.add(pb.vec3(1), this.c));
          this.$outputs.color = pb.vec4(this.c, 1);
        });
      }
    });
  }
  protected async createTexture(): Promise<BaseTexture> {
    const hdrTex = await this.assetManager.fetchTexture<Texture2D>(cubeMap);
    this.srcTex = Application.instance.device.createCubeTexture(hdrTex.format, hdrTex.height);
    panoramaToCubemap(hdrTex, this.srcTex);
    this.prefiltered = Application.instance.device.createCubeTexture('rgba16f', 64, { noMipmap: true });
    prefilterCubemap(this.srcTex, 'lambertian', this.prefiltered, 2048);
    hdrTex.dispose();
    if (1) {
      console.time('GPU projection');
      this.shCoeff = await projectCubemap(this.prefiltered);
      console.timeEnd('GPU projection');
      console.log(this.shCoeff);
    } else {
      console.time('CPU projection');
      this.shCoeff = await projectCubemapCPU(this.prefiltered);
      console.timeEnd('CPU projection');
      console.log(this.shCoeff);
    }
    return this.prefiltered;
  }
  protected createBindGroup(): BindGroup {
    const bindGroup = Application.instance.device.createBindGroup(this.program.bindGroupLayouts[0]);
    bindGroup.setValue('sh', {
      sh0: this.shCoeff[0],
      sh1: this.shCoeff[1],
      sh2: this.shCoeff[2],
      sh3: this.shCoeff[3],
      sh4: this.shCoeff[4],
      sh5: this.shCoeff[5],
      sh6: this.shCoeff[6],
      sh7: this.shCoeff[7],
      sh8: this.shCoeff[8]
    });
    return bindGroup;
  }
  protected updateBindGroup(t: number, w: number, h: number) {
    const vpMatrix = Matrix4x4.multiply(Matrix4x4.perspective(Math.PI / 3, w / h, 1, 10), this.viewMatrix);
    const matrix = this.animate
      ? Matrix4x4.multiply(vpMatrix, Matrix4x4.rotationY((t * 0.001) % (2 * Math.PI)))
      : vpMatrix;
    this.bindgroup.setValue('mvpMatrix', matrix);
    prefilterCubemap(this.srcTex, 'lambertian', this.prefiltered, 64);
  }
}
