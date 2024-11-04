import { halfToFloat, nextPowerOf2, SH, unpackFloat3, Vector3 } from '@zephyr3d/base';
import type {
  BindGroup,
  Texture2D,
  GPUProgram,
  PBGlobalScope,
  PBInsideFunctionScope,
  PBShaderExp,
  RenderStateSet,
  TextureCube,
  VertexLayout
} from '@zephyr3d/device';
import { Application } from '../app';
import type { BlitType } from '../blitter';
import { Blitter, CopyBlitter } from '../blitter';
import { fetchSampler } from './misc';

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
  filter(
    scope: PBInsideFunctionScope,
    type: BlitType,
    srcTex: PBShaderExp,
    srcUV: PBShaderExp,
    srcLayer: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    pb.func('reduce', [pb.vec2('uv')], function () {
      this.$l.h = pb.div(0.5, this.width);
      //this.$l.uv1 = pb.add(this.uv, pb.vec2(this.h));
      this.$l.uv1 = this.uv;
      this.$l.tl = pb.textureSampleLevel(
        srcTex,
        pb.vec2(pb.sub(this.uv1.x, this.h), pb.sub(this.uv1.y, this.h)),
        0
      );
      this.$l.tr = pb.textureSampleLevel(
        srcTex,
        pb.vec2(pb.add(this.uv1.x, this.h), pb.sub(this.uv1.y, this.h)),
        0
      );
      this.$l.bl = pb.textureSampleLevel(
        srcTex,
        pb.vec2(pb.sub(this.uv1.x, this.h), pb.add(this.uv1.y, this.h)),
        0
      );
      this.$l.br = pb.textureSampleLevel(
        srcTex,
        pb.vec2(pb.add(this.uv1.x, this.h), pb.add(this.uv1.y, this.h)),
        0
      );
      this.$return(pb.vec4(pb.add(this.tl, this.tr, this.bl, this.br).rgb, 1));
    });
    return scope.reduce(srcUV);
  }
  protected calcHash(): string {
    return '';
  }
}

let vertexLayout: VertexLayout = null;
let renderStates: RenderStateSet = null;
let projectionProgram: GPUProgram = null;
let projectionBindgroup: BindGroup = null;
const faceDirections = [
  [new Vector3(0, 0, -1), new Vector3(0, -1, 0), new Vector3(1, 0, 0)],
  [new Vector3(0, 0, 1), new Vector3(0, -1, 0), new Vector3(-1, 0, 0)],
  [new Vector3(1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 1, 0)],
  [new Vector3(1, 0, 0), new Vector3(0, 0, -1), new Vector3(0, -1, 0)],
  [new Vector3(1, 0, 0), new Vector3(0, -1, 0), new Vector3(0, 0, 1)],
  [new Vector3(-1, 0, 0), new Vector3(0, -1, 0), new Vector3(0, 0, -1)]
];

function init() {
  const device = Application.instance.device;
  const vertices = new Float32Array([1, 1, -1, 1, -1, -1, 1, -1]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  vertexLayout = device.createVertexLayout({
    vertexBuffers: [
      {
        buffer: device.createVertexBuffer('position_f32x2', vertices)
      }
    ],
    indexBuffer: device.createIndexBuffer(indices)
  });
  renderStates = device.createRenderStateSet();
  renderStates.useRasterizerState().setCullMode('none');
  renderStates.useDepthState().enableTest(false).enableWrite(false);
  projectionProgram = createProjectionProgram();
  //console.log(projectionProgram.getShaderSource('fragment'));
  projectionBindgroup = device.createBindGroup(projectionProgram.bindGroupLayouts[0]);
}

function createProjectionProgram(): GPUProgram {
  const device = Application.instance.device;
  const pb = device;
  return pb.buildRenderProgram({
    vertex(pb) {
      this.$inputs.pos = pb.vec2().attrib('position');
      this.up = pb.vec3().uniform(0);
      this.right = pb.vec3().uniform(0);
      this.front = pb.vec3().uniform(0);
      pb.main(function () {
        this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
        this.$outputs.direction = pb.mul(
          pb.mat3(this.up, this.right, this.front),
          pb.vec3(this.$inputs.pos, 1)
        );
        if (device.type === 'webgpu') {
          this.$builtins.position.y = pb.neg(this.$builtins.position.y);
        }
      });
    },
    fragment(pb) {
      this.u_cubeMap = pb.texCube().uniform(0);
      this.u_width = pb.int().uniform(0);
      this.u_coeff = pb.int().uniform(0);
      this.$outputs.outcolor = pb.vec4();
      pb.func('dirToUV', [pb.vec3('dir')], function () {
        this.$return(
          pb.vec2(
            pb.add(0.5, pb.div(pb.mul(0.5, pb.atan2(this.dir.z, this.dir.x)), Math.PI)),
            pb.sub(1, pb.div(pb.acos(this.dir.y), Math.PI))
          )
        );
      });
      pb.func('areaElement', [pb.float('x'), pb.float('y')], function () {
        this.$return(
          pb.atan2(pb.mul(this.x, this.y), pb.sqrt(pb.add(pb.mul(this.x, this.x), pb.mul(this.y, this.y), 1)))
        );
      });
      pb.func('solidAngle', [pb.vec2('uv')], function () {
        this.$l.inv = pb.div(1, pb.float(this.u_width));
        this.$l.uv2 = pb.sub(pb.mul(pb.add(this.uv, pb.mul(this.inv, 0.5)), 2), pb.vec2(1));
        this.$l.xy0 = pb.sub(this.uv2, pb.vec2(this.inv));
        this.$l.xy1 = pb.add(this.uv2, pb.vec2(this.inv));
        this.$return(
          pb.sub(
            pb.add(this.areaElement(this.xy0.x, this.xy0.y), this.areaElement(this.xy1.x, this.xy1.y)),
            pb.add(this.areaElement(this.xy0.x, this.xy1.y), this.areaElement(this.xy1.x, this.xy0.y))
          )
        );
      });
      pb.func('Y0', [pb.vec3('v')], function () {
        this.$return(0.2820947917);
      });
      pb.func('Y1', [pb.vec3('v')], function () {
        this.$return(pb.mul(this.v.y, -0.4886025119));
      });
      pb.func('Y2', [pb.vec3('v')], function () {
        this.$return(pb.mul(this.v.z, 0.4886025119));
      });
      pb.func('Y3', [pb.vec3('v')], function () {
        this.$return(pb.mul(this.v.x, -0.4886025119));
      });
      pb.func('Y4', [pb.vec3('v')], function () {
        this.$return(pb.mul(this.v.x, this.v.y, 1.0925484306));
      });
      pb.func('Y5', [pb.vec3('v')], function () {
        this.$return(pb.mul(this.v.y, this.v.z, -1.0925484306));
      });
      pb.func('Y6', [pb.vec3('v')], function () {
        this.$return(pb.mul(pb.sub(pb.mul(this.v.z, this.v.z, 3), 1), 0.3153915652));
      });
      pb.func('Y7', [pb.vec3('v')], function () {
        this.$return(pb.mul(this.v.x, this.v.z, -1.0925484306));
      });
      pb.func('Y8', [pb.vec3('v')], function () {
        this.$return(pb.mul(pb.sub(pb.mul(this.v.x, this.v.x), pb.mul(this.v.y, this.v.y)), 0.5462742153));
      });
      pb.func('evalBasis', [pb.vec3('dir'), pb.int('c')], function () {
        this.$if(pb.equal(this.c, 0), function () {
          this.$return(this.Y0(this.dir));
        })
          .$elseif(pb.equal(this.c, 1), function () {
            this.$return(this.Y1(this.dir));
          })
          .$elseif(pb.equal(this.c, 2), function () {
            this.$return(this.Y2(this.dir));
          })
          .$elseif(pb.equal(this.c, 3), function () {
            this.$return(this.Y3(this.dir));
          })
          .$elseif(pb.equal(this.c, 4), function () {
            this.$return(this.Y4(this.dir));
          })
          .$elseif(pb.equal(this.c, 5), function () {
            this.$return(this.Y5(this.dir));
          })
          .$elseif(pb.equal(this.c, 6), function () {
            this.$return(this.Y6(this.dir));
          })
          .$elseif(pb.equal(this.c, 7), function () {
            this.$return(this.Y7(this.dir));
          })
          .$elseif(pb.equal(this.c, 8), function () {
            this.$return(this.Y8(this.dir));
          })
          .$else(function () {
            this.$return(0);
          });
      });
      pb.main(function () {
        this.$l.dir = pb.normalize(this.$inputs.direction);
        this.$l.radiance = pb.textureSampleLevel(this.u_cubeMap, this.dir, 0).rgb;
        this.$l.uv = this.dirToUV(this.dir);
        this.$l.omega = this.solidAngle(this.uv);
        this.$l.sh = this.evalBasis(this.dir, this.u_coeff);
        this.$outputs.outcolor = pb.vec4(pb.mul(this.radiance, this.sh, this.omega), 1);
      });
    }
  });
}

async function doProjectCubemap(srcTexture: TextureCube, coeff: number): Promise<Vector3> {
  const device = Application.instance.device;
  const result = Vector3.zero();
  let w = nextPowerOf2(srcTexture.width);
  if (w > srcTexture.width) {
    w = w >> 1;
  }
  const tmpTextures: Texture2D[] = [];
  while (w > 0) {
    tmpTextures.push(device.createTexture2D('rgba32f', w, w, { samplerOptions: { mipFilter: 'none' } }));
    w = w >> 1;
  }
  for (let i = 0; i < 6; i++) {
    const dstTex = tmpTextures[0]; //device.createTexture2D('rgba32f', srcTexture.width, w);
    const framebuffer = device.createFrameBuffer([dstTex], null);
    framebuffer.setColorAttachmentGenerateMipmaps(0, false);
    device.setVertexLayout(vertexLayout);
    device.setRenderStates(renderStates);
    device.setProgram(projectionProgram);
    device.setBindGroup(0, projectionBindgroup);
    device.setFramebuffer(framebuffer);
    projectionBindgroup.setValue('up', faceDirections[i][0]);
    projectionBindgroup.setValue('right', faceDirections[i][1]);
    projectionBindgroup.setValue('front', faceDirections[i][2]);
    projectionBindgroup.setValue('u_width', srcTexture.width);
    projectionBindgroup.setValue('u_coeff', coeff);
    projectionBindgroup.setTexture('u_cubeMap', srcTexture);
    device.draw('triangle-list', 0, 6);
    device.setFramebuffer(null);
    framebuffer.dispose();

    const blitter = new ReduceBlitter();
    const sampler = fetchSampler('clamp_nearest_nomip');
    for (let i = 1; i < tmpTextures.length; i++) {
      blitter.width = tmpTextures[i - 1].width;
      blitter.blit(tmpTextures[i - 1], tmpTextures[i], sampler);
    }

    const buffer = new Float32Array(4);
    await tmpTextures[tmpTextures.length - 1].readPixels(0, 0, 1, 1, 0, 0, buffer);
    result.x += buffer[0];
    result.y += buffer[1];
    result.z += buffer[2];
  }

  for (const tmpTex of tmpTextures) {
    tmpTex.dispose();
  }

  return result;
}

/**
 * Projects a function represented in a cubemap into spherical harmonics using GPU
 *
 * @param input - The input cubemap
 * @returns The evaluated SH data
 *
 * @public
 */
export async function projectCubemap(tex: TextureCube): Promise<Vector3[]> {
  const device = Application.instance.device;
  const srcTex = tex;
  if (!device.getDeviceCaps().textureCaps.supportFloatColorBuffer) {
    throw new Error(`projectCubemap(): device does not support rendering to float color buffer`);
  }
  if (!vertexLayout) {
    init();
  }
  device.pushDeviceStates();
  const result: Vector3[] = [];
  for (let i = 0; i < 9; i++) {
    const v = await doProjectCubemap(srcTex, i);
    result.push(v);
  }
  device.popDeviceStates();

  if (srcTex !== tex) {
    srcTex.dispose();
  }
  return result;
}

function directionFromCubemapTexel(face: number, x: number, y: number, invSize: number): Vector3 {
  const dir = Vector3.zero();
  switch (face) {
    case 0: //+X
      dir.x = 1;
      dir.y = 1 - (2 * y + 1) * invSize;
      dir.z = 1 - (2 * x + 1) * invSize;
      break;
    case 1: //-X
      dir.x = -1;
      dir.y = 1 - (2 * y + 1) * invSize;
      dir.z = 1 - (2 * x + 1) * invSize;
      break;
    case 2: //+Y
      dir.x = -1 + (2 * x + 1) * invSize;
      dir.y = 1;
      dir.z = -1 + (2 * y + 1) * invSize;
      break;
    case 3: //-Y
      dir.x = -1 + (2 * x + 1) * invSize;
      dir.y = -1;
      dir.z = 1 - (2 * y + 1) * invSize;
      break;
    case 4: //+Z
      dir.x = -1 + (2 * x + 1) * invSize;
      dir.y = 1 - (2 * y + 1) * invSize;
      dir.z = 1;
      break;
    case 5: //-Z
      dir.x = 1 - (2 * x + 1) * invSize;
      dir.y = 1 - (2 * y + 1) * invSize;
      dir.z = -1;
      break;
  }
  return dir.inplaceNormalize();
}

/**
 * Projects a function represented in a cubemap into spherical harmonics using CPU
 *
 * @param input - The input cubemap
 * @returns The evaluated SH data
 *
 * @public
 */
export async function projectCubemapCPU(input: TextureCube): Promise<Vector3[]> {
  let srcTex = input;
  const device = Application.instance.device;
  if (
    device.getDeviceCaps().textureCaps.supportFloatColorBuffer &&
    input.format === 'rgba16f' &&
    device.type === 'webgl'
  ) {
    const dstTex = device.createCubeTexture('rgba32f', input.width, {
      samplerOptions: { mipFilter: 'none' }
    });
    const blitter = new CopyBlitter();
    blitter.blit(input, dstTex);
    srcTex = dstTex;
  }
  const size = srcTex.width;
  const output: Vector3[] = Array.from({ length: 9 }).map(() => Vector3.zero());
  const radiance = new Vector3();
  const input_face =
    srcTex.format === 'rgba8unorm' || srcTex.format === 'rgba8unorm-srgb'
      ? new Uint8Array(size * size * 4)
      : srcTex.format === 'rgba32f'
      ? new Float32Array(size * size * 4)
      : srcTex.format === 'rgba16f'
      ? new Uint16Array(size * size * 4)
      : srcTex.format === 'rg11b10uf'
      ? new Uint32Array(size * size)
      : null;
  if (!input_face) {
    throw new Error(`invalid input texture format: ${input.format}`);
  }
  const fB = -1 + 1 / size;
  const fS = size > 1 ? (2 * (1 - 1 / size)) / (size - 1) : 0;
  let fWt = 0;
  for (let face = 0; face < 6; face++) {
    await srcTex.readPixels(0, 0, size, size, face, 0, input_face);
    for (let texel = 0; texel < size * size; texel++) {
      const x = texel % size;
      const y = Math.floor(texel / size);
      const u = x * fS + fB;
      const v = y * fS + fB;
      const dir = directionFromCubemapTexel(face, x, y, 1 / size);
      const solidAngle = 4 / ((1 + u * u + v * v) * Math.sqrt(1 + u * u + v * v));
      fWt += solidAngle;
      if (srcTex.format === 'rgba8unorm' || srcTex.format === 'rgba8unorm-srgb') {
        radiance.x = input_face[texel * 4 + 0] / 255;
        radiance.y = input_face[texel * 4 + 1] / 255;
        radiance.z = input_face[texel * 4 + 2] / 255;
        if (srcTex.format === 'rgba8unorm-srgb') {
          radiance.x = Math.pow(radiance.x, 2.2);
          radiance.y = Math.pow(radiance.y, 2.2);
          radiance.z = Math.pow(radiance.z, 2.2);
        }
      } else if (srcTex.format === 'rgba32f') {
        radiance.x = input_face[texel * 4 + 0];
        radiance.y = input_face[texel * 4 + 1];
        radiance.z = input_face[texel * 4 + 2];
      } else if (srcTex.format === 'rgba16f') {
        radiance.x = halfToFloat(input_face[texel * 4 + 0]);
        radiance.y = halfToFloat(input_face[texel * 4 + 1]);
        radiance.z = halfToFloat(input_face[texel * 4 + 2]);
      } else if (srcTex.format === 'rg11b10uf') {
        unpackFloat3(input_face[texel], radiance);
      }
      const shBasis = SH.evalBasis(dir, 3);
      for (let c = 0; c < 9; ++c) {
        const sh = shBasis[c];
        output[c].x += radiance.x * sh * solidAngle;
        output[c].y += radiance.y * sh * solidAngle;
        output[c].z += radiance.z * sh * solidAngle;
      }
    }
  }
  for (const v of output) {
    v.scaleBy((4 * Math.PI) / fWt);
  }
  if (srcTex !== input) {
    srcTex.dispose();
  }
  return output;
}
