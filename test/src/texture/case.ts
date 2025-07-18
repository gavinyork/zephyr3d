import { Vector3, Matrix4x4 } from '@zephyr3d/base';
import type {
  GPUProgram,
  BaseTexture,
  Texture2D,
  TextureCube,
  TextureVideo,
  BindGroup,
  RenderStateSet
} from '@zephyr3d/device';
import type { AssetManager } from '@zephyr3d/scene';
import { BoxShape, panoramaToCubemap, prefilterCubemap, Application, linearToGamma } from '@zephyr3d/scene';

const panorama = './assets/images/cloudy.hdr';
const texture = './assets/images/Di-3d.png';

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
    this.box = new BoxShape({ size: 2 });
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
    return (await this.assetManager.fetchTexture(texture)) as Texture2D;
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
          this.$outputs.color = pb.vec4(linearToGamma(this, this.$outputs.color.rgb), this.$outputs.color.w);
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
      samplerOptions: { mipFilter: 'none' }
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
    const tex = await this.assetManager.fetchTexture<Texture2D>(panorama);
    this.srcTex = Application.instance.device.createCubeTexture(tex.format, 128);
    panoramaToCubemap(tex, this.srcTex);
    tex.dispose();
    this.prefilteredTex = Application.instance.device.createCubeTexture('rgba16f', 128, {
      samplerOptions: { mipFilter: 'none' }
    });
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
