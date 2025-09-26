import type { Texture2D } from '@zephyr3d/device';
import { getDevice } from '../../app/api';

const ggxLut: Map<number, Texture2D> = new Map();
export function getGGXLUT(size: number): Texture2D {
  let lut = ggxLut.get(size);
  if (!lut) {
    lut = createGGXLUT(size);
    ggxLut.set(size, lut);
  }
  return lut;
}
function createGGXLUT(size: number) {
  const device = getDevice();
  const program = device.buildRenderProgram({
    vertex(pb) {
      this.$inputs.pos = pb.vec2().attrib('position');
      this.$outputs.uv = pb.vec2();
      pb.main(function () {
        this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
        this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
        if (device.type === 'webgpu') {
          this.$builtins.position.y = pb.neg(this.$builtins.position.y);
        }
      });
    },
    fragment(pb) {
      this.$outputs.color = pb.vec4();
      const SAMPLE_COUNT = 1024;
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
      pb.func('generateTBN', [pb.vec3('normal')], function () {
        this.$l.bitangent = pb.vec3(0, 1, 0);
        this.$l.NoU = this.normal.y;
        this.$l.epsl = 0.0000001;
        this.$if(pb.lessThanEqual(pb.sub(1, pb.abs(this.normal.y)), this.epsl), function () {
          this.bitangent = this.$choice(
            pb.greaterThan(this.normal.y, 0),
            pb.vec3(0, 0, 1),
            pb.vec3(0, 0, -1)
          );
        });
        this.$l.tangent = pb.normalize(pb.cross(this.bitangent, this.normal));
        this.bitangent = pb.cross(this.normal, this.tangent);
        this.$return(pb.mat3(this.tangent, this.bitangent, this.normal));
      });
      pb.func('D_Charlie', [pb.float('sheenRoughness'), pb.float('NdotH')], function () {
        this.$l.roughness = pb.max(this.sheenRoughness, 0.000001);
        this.$l.invR = pb.div(1, this.roughness);
        this.$l.cos2h = pb.mul(this.NdotH, this.NdotH);
        this.$l.sin2h = pb.sub(1, this.cos2h);
        this.$return(
          pb.div(pb.mul(pb.add(this.invR, 2), pb.pow(this.sin2h, pb.mul(this.invR, 0.5))), Math.PI * 2)
        );
      });
      pb.func('smithGGXCorrelated', [pb.float('NoV'), pb.float('NoL'), pb.float('roughness')], function () {
        this.$l.a2 = pb.mul(this.roughness, this.roughness, this.roughness, this.roughness);
        this.$l.GGXV = pb.mul(
          this.NoL,
          pb.sqrt(pb.add(pb.mul(this.NoV, this.NoV, pb.sub(1, this.a2)), this.a2))
        );
        this.$l.GGXL = pb.mul(
          this.NoV,
          pb.sqrt(pb.add(pb.mul(this.NoL, this.NoL, pb.sub(1, this.a2)), this.a2))
        );
        this.$return(pb.div(0.5, pb.add(this.GGXV, this.GGXL)));
      });
      pb.func('V_Ashikhmin', [pb.float('NdotL'), pb.float('NdotV')], function () {
        this.$return(
          pb.clamp(
            pb.div(1, pb.mul(pb.sub(pb.add(this.NdotL, this.NdotV), pb.mul(this.NdotL, this.NdotV)), 4)),
            0,
            1
          )
        );
      });
      pb.func(
        'importanceSample',
        [
          pb.vec2('xi'),
          pb.vec3('normal'),
          pb.float('roughness'),
          pb.vec3('ggx').out(),
          pb.vec3('charlie').out()
        ],
        function () {
          this.$l.alphaRoughness = pb.mul(this.roughness, this.roughness);
          this.$l.cosTheta = pb.clamp(
            pb.sqrt(
              pb.div(
                pb.sub(1, this.xi.y),
                pb.add(1, pb.mul(pb.sub(pb.mul(this.alphaRoughness, this.alphaRoughness), 1), this.xi.y))
              )
            ),
            0,
            1
          );
          this.$l.sinTheta = pb.sqrt(pb.sub(1, pb.mul(this.cosTheta, this.cosTheta)));
          this.$l.phi = pb.mul(this.xi.x, Math.PI * 2);
          this.$l.TBN = this.generateTBN(this.normal);
          this.$l.localSpaceDir = pb.normalize(
            pb.vec3(
              pb.mul(this.sinTheta, pb.cos(this.phi)),
              pb.mul(this.sinTheta, pb.sin(this.phi)),
              this.cosTheta
            )
          );
          this.ggx = pb.mul(this.TBN, this.localSpaceDir);
          this.sinTheta = pb.pow(
            this.xi.y,
            pb.div(this.alphaRoughness, pb.add(pb.mul(this.alphaRoughness, 2), 1))
          );
          this.cosTheta = pb.sqrt(pb.sub(1, pb.mul(this.sinTheta, this.sinTheta)));
          this.localSpaceDir = pb.normalize(
            pb.vec3(
              pb.mul(this.sinTheta, pb.cos(this.phi)),
              pb.mul(this.sinTheta, pb.sin(this.phi)),
              this.cosTheta
            )
          );
          this.charlie = pb.mul(this.TBN, this.localSpaceDir);
        }
      );
      pb.func('integrateBRDF', [pb.float('NoV'), pb.float('roughness')], function () {
        this.$l.V = pb.vec3(pb.sub(1, pb.mul(this.NoV, this.NoV)), 0, this.NoV);
        this.$l.a = pb.float(0);
        this.$l.b = pb.float(0);
        this.$l.c = pb.float(0);
        this.$l.n = pb.vec3(0, 0, 1);
        this.$for(pb.int('i'), 0, SAMPLE_COUNT, function () {
          this.$l.xi = this.hammersley2d(this.i, SAMPLE_COUNT);
          this.$l.ggxSample = pb.vec3();
          this.$l.charlieSample = pb.vec3();
          this.importanceSample(this.xi, this.n, this.roughness, this.ggxSample, this.charlieSample);
          this.$l.ggxL = pb.normalize(pb.reflect(pb.neg(this.V), this.ggxSample.xyz));
          this.$l.ggxNoL = pb.clamp(this.ggxL.z, 0, 1);
          this.$l.ggxNoH = pb.clamp(this.ggxSample.z, 0, 1);
          this.$l.ggxVoH = pb.clamp(pb.dot(this.V, this.ggxSample.xyz), 0, 1);
          this.$l.charlieL = pb.normalize(pb.reflect(pb.neg(this.V), this.charlieSample.xyz));
          this.$l.charlieNoL = pb.clamp(this.charlieL.z, 0, 1);
          this.$l.charlieNoH = pb.clamp(this.charlieSample.z, 0, 1);
          this.$l.charlieVoH = pb.clamp(pb.dot(this.V, this.charlieSample.xyz), 0, 1);
          this.$if(pb.greaterThan(this.ggxNoL, 0), function () {
            this.$l.pdf = pb.div(
              pb.mul(
                this.smithGGXCorrelated(this.NoV, this.ggxNoL, this.roughness),
                this.ggxVoH,
                this.ggxNoL
              ),
              this.ggxNoH
            );
            this.$l.Fc = pb.pow(pb.sub(1, this.ggxVoH), 5);
            this.a = pb.add(this.a, pb.mul(pb.sub(1, this.Fc), this.pdf));
            this.b = pb.add(this.b, pb.mul(this.Fc, this.pdf));
          });
          this.$if(pb.greaterThan(this.charlieNoL, 0), function () {
            this.$l.sheenDistribution = this.D_Charlie(this.roughness, this.charlieNoH);
            this.$l.sheenVis = this.V_Ashikhmin(this.charlieNoL, this.NoV);
            this.c = pb.add(
              this.c,
              pb.mul(this.sheenVis, this.sheenDistribution, this.charlieNoL, this.charlieVoH)
            );
          });
        });
        this.$return(
          pb.div(pb.vec3(pb.mul(this.a, 4), pb.mul(this.b, 4), pb.mul(this.c, 8 * Math.PI)), SAMPLE_COUNT)
        );
      });
      pb.main(function () {
        this.$outputs.color = pb.vec4(this.integrateBRDF(this.$inputs.uv.x, this.$inputs.uv.y), 1);
      });
    }
  });
  const vertexLayout = device.createVertexLayout({
    vertexBuffers: [
      { buffer: device.createVertexBuffer('position_f32x2', new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])) }
    ]
  });
  const rs = device.createRenderStateSet();
  rs.useRasterizerState().setCullMode('none');
  rs.useDepthState().enableTest(false).enableWrite(false);
  const tex = device.createTexture2D('rgba8unorm', size, size, { mipmapping: false });
  tex.name = 'GGXLUT';
  const fb = device.createFrameBuffer([tex], null);
  device.pushDeviceStates();
  device.setProgram(program);
  device.setVertexLayout(vertexLayout);
  device.setRenderStates(rs);
  device.setFramebuffer(fb);
  device.draw('triangle-strip', 0, 4);
  device.popDeviceStates();
  fb.dispose();
  vertexLayout.dispose();
  program.dispose();
  return tex;
}
