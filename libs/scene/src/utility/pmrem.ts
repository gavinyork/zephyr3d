import { Vector3 } from '@zephyr3d/base';
import type {
  BindGroup,
  FrameBuffer,
  GPUProgram,
  RenderStateSet,
  TextureCube,
  TextureSampler,
  VertexLayout
} from '@zephyr3d/device';
import { getDevice } from '../app/api';
import { fetchSampler } from './misc';

// reference: https://placeholderart.wordpress.com/2015/07/28/implementation-notes-runtime-environment-map-filtering-for-image-based-lighting/

type DistributionType = 'lambertian' | 'ggx';

let vertexLayout: VertexLayout = null;
let renderStates: RenderStateSet = null;
const programs: Record<
  string,
  {
    program: GPUProgram;
    bindgroup: BindGroup;
  }
> = {};

const faceDirections = [
  [new Vector3(0, 0, -1), new Vector3(0, -1, 0), new Vector3(1, 0, 0)],
  [new Vector3(0, 0, 1), new Vector3(0, -1, 0), new Vector3(-1, 0, 0)],
  [new Vector3(1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 1, 0)],
  [new Vector3(1, 0, 0), new Vector3(0, 0, -1), new Vector3(0, -1, 0)],
  [new Vector3(1, 0, 0), new Vector3(0, -1, 0), new Vector3(0, 0, 1)],
  [new Vector3(-1, 0, 0), new Vector3(0, -1, 0), new Vector3(0, 0, -1)]
];

function init() {
  const device = getDevice();
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
}

function getProgramInfo(type: DistributionType, numSamples: number) {
  const device = getDevice();
  const hash = `${type}:${numSamples}`;
  let ret = programs[hash];
  if (!ret) {
    const program = createPMREMProgram(type, numSamples);
    const bindgroup = device.createBindGroup(program.bindGroupLayouts[0]);
    programs[hash] = ret = { program, bindgroup };
  }
  return ret;
}

function createPMREMProgram(type: DistributionType, numSamples: number): GPUProgram {
  const device = getDevice();
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
      if (type === 'ggx') {
        this.alphaG = pb.float().uniform(0);
      }
      this.vFilteringInfo = pb.vec3().uniform(0);
      this.hdrScale = pb.float().uniform(0);
      this.inputTexture = pb.texCube().uniform(0);
      this.NUM_SAMPLES_FLOAT = pb.float(numSamples);
      this.NUM_SAMPLES_FLOAT_INVERSED = pb.float(1 / numSamples);
      this.K = pb.float(4);
      this.$outputs.outcolor = pb.vec4();
      if (device.type === 'webgl') {
        pb.func('radicalInverse_VdC', [pb.int('bits')], function () {
          this.$l.rand = pb.float(0);
          this.$l.denom = pb.float(1);
          this.$l.invBase = pb.float(0.5);
          this.$l.n = this.bits;
          this.$for(pb.int('i'), 0, 32, function () {
            this.denom = pb.mul(this.denom, 2);
            this.rand = pb.add(this.rand, pb.div(pb.mod(pb.float(this.n), 2), this.denom));
            this.n = pb.div(this.n, 2);
            this.$if(pb.equal(this.n, 0), function () {
              this.$break();
            });
          });
          this.$return(this.rand);
        });
        pb.func('hammersley2d', [pb.int('i'), pb.int('N')], function () {
          this.$return(pb.vec2(pb.div(pb.float(this.i), pb.float(this.N)), this.radicalInverse_VdC(this.i)));
        });
      } else {
        pb.func('radicalInverse_VdC', [pb.uint('bits')], function () {
          this.$l.n = this.bits;
          this.n = pb.compOr(pb.sal(this.n, 16), pb.sar(this.n, 16));
          this.n = pb.compOr(
            pb.sal(pb.compAnd(this.n, 0x55555555), 1),
            pb.sar(pb.compAnd(this.n, 0xaaaaaaaa), 1)
          );
          this.n = pb.compOr(
            pb.sal(pb.compAnd(this.n, 0x33333333), 2),
            pb.sar(pb.compAnd(this.n, 0xcccccccc), 2)
          );
          this.n = pb.compOr(
            pb.sal(pb.compAnd(this.n, 0x0f0f0f0f), 4),
            pb.sar(pb.compAnd(this.n, 0xf0f0f0f0), 4)
          );
          this.n = pb.compOr(
            pb.sal(pb.compAnd(this.n, 0x00ff00ff), 8),
            pb.sar(pb.compAnd(this.n, 0xff00ff00), 8)
          );
          this.$return(pb.mul(pb.float(this.n), 2.3283064365386963e-10));
        });
        pb.func('hammersley2d', [pb.int('i'), pb.int('N')], function () {
          this.$return(
            pb.vec2(pb.div(pb.float(this.i), pb.float(this.N)), this.radicalInverse_VdC(pb.uint(this.i)))
          );
        });
      }
      pb.func('log4', [pb.float('x')], function () {
        this.$return(pb.mul(pb.log2(this.x), 0.5));
      });
      if (type === 'lambertian') {
        pb.func('hemisphereCosSample', [pb.vec2('u')], function () {
          this.$l.phi = pb.mul(this.u.x, 2 * Math.PI);
          this.$l.cosTheta2 = pb.sub(1, this.u.y);
          this.$l.cosTheta = pb.sqrt(this.cosTheta2);
          this.$l.sinTheta = pb.sqrt(pb.sub(1, this.cosTheta2));
          this.$return(
            pb.vec3(
              pb.mul(this.sinTheta, pb.cos(this.phi)),
              pb.mul(this.sinTheta, pb.sin(this.phi)),
              this.cosTheta
            )
          );
        });
        pb.func('irradiance', [pb.vec3('direction'), pb.vec3('vFilteringInfo')], function () {
          this.$l.n = pb.normalize(this.direction);
          this.$l.result = pb.vec3(0);
          this.$l.tangent = pb.vec3();
          this.$if(pb.lessThan(pb.abs(this.n.z), 0.999), function () {
            this.tangent = pb.vec3(0, 0, 1);
          }).$else(function () {
            this.tangent = pb.vec3(1, 0, 0);
          });
          this.tangent = pb.normalize(pb.cross(this.tangent, this.n));
          this.$l.bitangent = pb.cross(this.n, this.tangent);
          this.$l.tbn = pb.mat3(this.tangent, this.bitangent, this.n);
          this.$l.maxLevel = this.vFilteringInfo.y;
          this.$l.dim0 = this.vFilteringInfo.x;
          this.$l.colorScale = this.vFilteringInfo.z;
          this.$l.omegaP = pb.div(4 * Math.PI, pb.mul(this.dim0, this.dim0, 6));
          this.$for(pb.int('i'), 0, numSamples, function () {
            this.$l.Xi = this.hammersley2d(this.i, numSamples);
            this.$l.Ls = pb.normalize(this.hemisphereCosSample(this.Xi));
            this.$l.Ns = pb.vec3(0, 0, 1);
            this.$l.NoL = pb.dot(this.Ns, this.Ls);
            this.$if(pb.greaterThan(this.NoL, 0), function () {
              this.$l.pdf_inversed = pb.div(Math.PI, this.NoL);
              this.$l.omegaS = pb.mul(this.pdf_inversed, this.NUM_SAMPLES_FLOAT_INVERSED);
              this.$l.l = pb.add(pb.sub(this.log4(this.omegaS), this.log4(this.omegaP)), this.log4(this.K));
              this.$l.mipLevel = pb.clamp(this.l, 0, this.maxLevel);
              this.$l.c = pb.textureSampleLevel(
                this.inputTexture,
                pb.mul(this.tbn, this.Ls),
                this.mipLevel
              ).rgb;
              this.result = pb.add(this.result, this.c);
            });
          });
          this.result = pb.mul(this.result, this.NUM_SAMPLES_FLOAT_INVERSED, this.colorScale);
          this.$return(this.result);
        });
      }
      if (type === 'ggx') {
        pb.func('hemisphereImportanceSampleDggx', [pb.vec2('u'), pb.float('a')], function () {
          this.$l.phi = pb.mul(this.u.x, 2 * Math.PI);
          this.$l.cosTheta2 = pb.div(
            pb.sub(1, this.u.y),
            pb.add(pb.mul(pb.add(this.a, 1), pb.sub(this.a, 1), this.u.y), 1)
          );
          this.$l.cosTheta = pb.sqrt(this.cosTheta2);
          this.$l.sinTheta = pb.sqrt(pb.sub(1, this.cosTheta2));
          this.$return(
            pb.vec3(
              pb.mul(pb.cos(this.phi), this.sinTheta),
              pb.mul(pb.sin(this.phi), this.sinTheta),
              this.cosTheta
            )
          );
        });
        pb.func(
          'normalDistributionFunction_TrowbridgeReitzGGX',
          [pb.float('NoH'), pb.float('alphaG')],
          function () {
            this.$l.a2 = pb.mul(this.alphaG, this.alphaG);
            this.$l.d = pb.add(pb.mul(this.NoH, this.NoH, pb.sub(this.a2, 1)), 1);
            this.$return(pb.div(this.a2, pb.mul(this.d, this.d, Math.PI)));
          }
        );
        pb.func(
          'radiance',
          [pb.float('alphaG'), pb.vec3('direction'), pb.vec3('vFilteringInfo')],
          function () {
            this.$l.n = pb.normalize(this.direction);
            this.$if(pb.equal(this.alphaG, 0), function () {
              this.$l.c = pb.textureSampleLevel(this.inputTexture, this.n, 0).rgb;
              this.$return(this.c);
            }).$else(function () {
              this.$l.result = pb.vec3(0);
              this.$l.tangent = pb.vec3();
              this.$if(pb.lessThan(pb.abs(this.n.z), 0.999), function () {
                this.tangent = pb.vec3(0, 0, 1);
              }).$else(function () {
                this.tangent = pb.vec3(1, 0, 0);
              });
              this.tangent = pb.normalize(pb.cross(this.tangent, this.n));
              this.$l.bitangent = pb.cross(this.n, this.tangent);
              this.$l.tbn = pb.mat3(this.tangent, this.bitangent, this.n);
              this.$l.maxLevel = this.vFilteringInfo.y;
              this.$l.dim0 = this.vFilteringInfo.x;
              this.$l.omegaP = pb.div(4 * Math.PI, pb.mul(this.dim0, this.dim0, 6));
              this.$l.weight = pb.float(0);
              this.$for(pb.int('i'), 0, numSamples, function () {
                this.$l.Xi = this.hammersley2d(this.i, numSamples);
                this.$l.H = this.hemisphereImportanceSampleDggx(this.Xi, this.alphaG);
                this.$l.NoV = pb.float(1);
                this.$l.NoH = this.H.z;
                this.$l.NoH2 = pb.mul(this.H.z, this.H.z);
                this.$l.NoL = pb.sub(pb.mul(this.NoH2, 2), 1);
                this.$l.L = pb.normalize(
                  pb.vec3(pb.mul(this.NoH, this.H.x, 2), pb.mul(this.NoH, this.H.y, 2), this.NoL)
                );
                this.$if(pb.greaterThan(this.NoL, 0), function () {
                  this.$l.pdf_inversed = pb.div(
                    4,
                    this.normalDistributionFunction_TrowbridgeReitzGGX(this.NoH, this.alphaG)
                  );
                  this.$l.omegaS = pb.mul(this.pdf_inversed, this.NUM_SAMPLES_FLOAT_INVERSED);
                  this.$l.l = pb.add(
                    pb.sub(this.log4(this.omegaS), this.log4(this.omegaP)),
                    this.log4(this.K)
                  );
                  this.$l.mipLevel = pb.clamp(this.l, 0, this.maxLevel);
                  this.weight = pb.add(this.weight, this.NoL);
                  this.$l.c = pb.textureSampleLevel(
                    this.inputTexture,
                    pb.mul(this.tbn, this.L),
                    this.mipLevel
                  ).rgb;
                  this.result = pb.add(this.result, pb.mul(this.c, this.NoL));
                });
              });
              this.result = pb.div(this.result, this.weight);
              this.$return(this.result);
            });
          }
        );
      }
      pb.main(function () {
        if (type === 'ggx') {
          this.$l.color = this.radiance(this.alphaG, this.$inputs.direction, this.vFilteringInfo);
        }
        if (type === 'lambertian') {
          this.$l.color = this.irradiance(this.$inputs.direction, this.vFilteringInfo);
        }
        this.$outputs.outcolor = pb.vec4(pb.mul(this.color, this.hdrScale), 1);
      });
    }
  });
}
function doPrefilterCubemap(
  type: DistributionType,
  roughness: number,
  miplevel: number,
  srcTexture: TextureCube,
  sampler: TextureSampler,
  dstFramebuffer: FrameBuffer,
  filteringInfo: Vector3,
  numSamples: number
): void {
  const device = getDevice();
  const framebuffer = dstFramebuffer;
  framebuffer.setColorAttachmentMipLevel(0, miplevel);
  framebuffer.setColorAttachmentGenerateMipmaps(0, false);
  const { program, bindgroup } = getProgramInfo(type, numSamples);
  bindgroup.setValue('vFilteringInfo', filteringInfo);
  bindgroup.setValue('hdrScale', 1);
  bindgroup.setTexture('inputTexture', srcTexture);
  if (type === 'ggx') {
    bindgroup.setValue('alphaG', roughness);
  }
  device.setProgram(program);
  device.setBindGroup(0, bindgroup);
  device.setFramebuffer(framebuffer);
  for (let i = 0; i < 6; i++) {
    framebuffer.setColorAttachmentCubeFace(0, i);
    device.setVertexLayout(vertexLayout);
    device.setRenderStates(renderStates);
    bindgroup.setValue('up', faceDirections[i][0]);
    bindgroup.setValue('right', faceDirections[i][1]);
    bindgroup.setValue('front', faceDirections[i][2]);
    device.draw('triangle-list', 0, 6);
  }
}

/**
 * Prefilters an environment cubemap
 *
 * @param tex - The environment cubemap
 * @param type - The prefilter type
 * @param destTex - The output cubemap
 *
 * @public
 */
export function prefilterCubemap(
  tex: TextureCube,
  type: DistributionType,
  destTexture: TextureCube | FrameBuffer,
  numSamples?: number,
  radianceSource?: boolean
): void {
  if (!tex || !tex.isTextureCube()) {
    console.error('prefilterCubemap(): source texture must be cube texture');
    return;
  }
  const device = getDevice();
  if (!vertexLayout) {
    init();
  }
  device.pushDeviceStates();
  radianceSource = radianceSource ?? true;
  const rs = device.getRenderStates();
  const srcTex = tex;
  const width = tex.width;
  const mipmapsCount = tex.mipLevelCount;
  const filteringInfo = new Vector3(width, mipmapsCount, radianceSource ? 1 : Math.PI);
  const fb = destTexture.isFramebuffer() ? destTexture : device.createFrameBuffer([destTexture], null);
  const attachMiplevel = fb.getColorAttachmentMipLevel(0);
  const generateMipmap = fb.getColorAttachmentGenerateMipmaps(0);
  const destTex = fb.getColorAttachments()[0];
  const mips = type === 'ggx' ? destTex.mipLevelCount : 1;
  for (let i = 0; i < mips; i++) {
    const alpha = i === 0 ? 0 : Math.pow(2, i) / width;
    doPrefilterCubemap(
      type,
      alpha,
      i,
      srcTex,
      fetchSampler(type === 'ggx' ? 'clamp_nearest_nomip' : 'clamp_linear'),
      fb,
      filteringInfo,
      numSamples ?? 64
    );
  }
  device.popDeviceStates();
  device.setRenderStates(rs);
  fb.setColorAttachmentMipLevel(0, attachMiplevel);
  fb.setColorAttachmentGenerateMipmaps(0, generateMipmap);
  if (!destTexture.isFramebuffer()) {
    fb.dispose();
  }
}
