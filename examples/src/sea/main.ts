import { Vector4 } from '@zephyr3d/base';
import { backendWebGL1, backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
import { DeviceBackend, DrawText } from '@zephyr3d/device';

(async function() {
  const backendsMap: Record<string, DeviceBackend> = {
    webgl: backendWebGL1,
    webgl2: backendWebGL2,
    webgpu: backendWebGPU
  };
  // create render device
  const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
  const type = new URL(location.href).searchParams.get('dev') || 'webgl';
  const backend = backendsMap[type];
  if (!backend) {
    throw new Error(`Invalid backend: ${type}`);
  }
  const device = await backend.createDevice(canvas);

  const vertices = device.createVertexBuffer('position_f32x2', new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));
  const vertexLayout = device.createVertexLayout({
    vertexBuffers: [{
      buffer: vertices
    }]
  });

  const program = device.buildRenderProgram({
    label: 'seaMaterial',
    vertex(pb) {
      this.$inputs.pos = pb.vec2().attrib('position');
      pb.main(function () {
        this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
      });
    },
    fragment(pb) {
      this.uniforms = pb.vec4().uniform(0); // iTime, iMouseX, iResX, iResY
      this.$outputs.outColor = pb.vec4();
      this.NUM_STEPS = pb.int(8);
      this.PI = 3.141592;
      this.EPSILON = 1e-3;
      this.ITER_GEOMETRY = pb.int(3);
      this.ITER_FRAGMENT = pb.int(5);
      this.SEA_HEIGHT = 0.6;
      this.SEA_CHOPPY = pb.float(4.0);
      this.SEA_SPEED = 0.8;
      this.SEA_FREQ = 0.16;
      this.SEA_BASE = pb.vec3(0, 0.09, 0.18);
      this.SEA_WATER_COLOR = pb.vec3(0.48, 0.54, 0.36);
      this.octave_m = pb.mat2(pb.vec2(1.6, 1.2), pb.vec2(-1.2, 1.6));
      pb.func('SEA_TIME', [], function () {
        this.$return(pb.add(1, pb.mul(pb.float(this.uniforms.x), this.SEA_SPEED)));
      });
      pb.func('fromEuler', [pb.vec3('ang')], function () {
        this.a1 = pb.vec2(pb.sin(this.ang.x), pb.cos(this.ang.x));
        this.a2 = pb.vec2(pb.sin(this.ang.y), pb.cos(this.ang.y));
        this.a3 = pb.vec2(pb.sin(this.ang.z), pb.cos(this.ang.z));
        this.m = pb.mat3();
        this.m[0] = pb.vec3(
          pb.add(pb.mul(this.a1.y, this.a3.y), pb.mul(this.a1.x, this.a2.x, this.a3.x)),
          pb.add(pb.mul(this.a1.y, this.a2.x, this.a3.x), pb.mul(this.a3.y, this.a1.x)),
          pb.neg(pb.mul(this.a2.y, this.a3.x))
        );
        this.m[1] = pb.vec3(pb.neg(pb.mul(this.a2.y, this.a1.x)), pb.mul(this.a1.y, this.a2.y), this.a2.x);
        this.m[2] = pb.vec3(
          pb.add(pb.mul(this.a3.y, this.a1.x, this.a2.x), pb.mul(this.a1.y, this.a3.x)),
          pb.sub(pb.mul(this.a1.x, this.a3.x), pb.mul(this.a1.y, this.a3.y, this.a2.x)),
          pb.mul(this.a2.y, this.a3.y)
        );
        this.$return(this.m);
      });
      pb.func('hash', [pb.vec2('p')], function () {
        this.h = pb.dot(this.p, pb.vec2(127.1, 311.7));
        this.$return(pb.fract(pb.mul(pb.sin(this.h), 43758.5453123)));
      });
      pb.func('noise', [pb.vec2('p')], function () {
        this.i = pb.floor(this.p);
        this.f = pb.fract(this.p);
        this.u = pb.mul(this.f, this.f, pb.sub(3, pb.mul(this.f, 2)));
        this.h1 = this.hash(this.i);
        this.h2 = this.hash(pb.add(this.i, pb.vec2(1, 0)));
        this.h3 = this.hash(pb.add(this.i, pb.vec2(0, 1)));
        this.h4 = this.hash(pb.add(this.i, pb.vec2(1, 1)));
        this.$return(
          pb.add(
            -1,
            pb.mul(
              2,
              pb.mix(pb.mix(this.h1, this.h2, this.u.x), pb.mix(this.h3, this.h4, this.u.x), this.u.y)
            )
          )
        );
      });
      pb.func('diffuse', [pb.vec3('n'), pb.vec3('l'), pb.float('p')], function () {
        this.$return(pb.pow(pb.add(pb.mul(pb.dot(this.n, this.l), 0.4), 0.6), this.p));
      });
      pb.func('specular', [pb.vec3('n'), pb.vec3('l'), pb.vec3('e'), pb.float('s')], function () {
        this.nrm = pb.div(pb.add(this.s, 8), pb.mul(this.PI, 8));
        this.$return(pb.mul(pb.pow(pb.max(pb.dot(pb.reflect(this.e, this.n), this.l), 0), this.s), this.nrm));
      });
      pb.func('getSkyColor', [pb.vec3('e')], function () {
        this.ey = pb.mul(pb.add(pb.mul(pb.max(this.e.y, 0), 0.8), 0.2), 0.8);
        this.$return(
          pb.mul(
            pb.vec3(
              pb.pow(pb.sub(1, this.ey), 2),
              pb.sub(1, this.ey),
              pb.add(0.6, pb.mul(pb.sub(1, this.ey), 0.4))
            ),
            1.1
          )
        );
      });
      pb.func('sea_octave', [pb.vec2('uv'), pb.float('choppy')], function () {
        this.uv2 = pb.add(this.uv, this.noise(this.uv));
        this.wv = pb.sub(pb.vec2(1), pb.abs(pb.sin(this.uv2)));
        this.swv = pb.abs(pb.cos(this.uv2));
        this.wv = pb.mix(this.wv, this.swv, this.wv);
        this.$return(pb.pow(pb.sub(1, pb.pow(pb.mul(this.wv.x, this.wv.y), 0.65)), this.choppy));
      });
      pb.func('map', [pb.vec3('p')], function () {
        this.freq = this.SEA_FREQ;
        this.amp = this.SEA_HEIGHT;
        this.choppy = this.SEA_CHOPPY;
        this.uv = this.p.xz;
        this.uv.x = pb.mul(this.uv.x, 0.75);
        this.d = pb.float();
        this.h = pb.float(0);
        this.seaTime = this.SEA_TIME();
        this.$for(pb.int('i'), 0, this.ITER_GEOMETRY, function () {
          this.d = this.sea_octave(pb.mul(pb.add(this.uv, this.seaTime), this.freq), this.choppy);
          this.d = pb.add(
            this.d,
            this.sea_octave(pb.mul(pb.sub(this.uv, this.seaTime), this.freq), this.choppy)
          );
          this.h = pb.add(this.h, pb.mul(this.d, this.amp));
          this.uv = pb.mul(this.uv, this.octave_m);
          this.freq = pb.mul(this.freq, 1.9);
          this.amp = pb.mul(this.amp, 0.22);
          this.choppy = pb.mix(this.choppy, 1, 0.2);
        });
        this.$return(pb.sub(this.p.y, this.h));
      });
      pb.func('map_detailed', [pb.vec3('p')], function () {
        this.freq = this.SEA_FREQ;
        this.amp = this.SEA_HEIGHT;
        this.choppy = this.SEA_CHOPPY;
        this.uv = this.p.xz;
        this.uv.x = pb.mul(this.uv.x, 0.75);
        this.d = pb.float();
        this.h = pb.float(0);
        this.seaTime = this.SEA_TIME();
        this.$for(pb.int('i'), 0, this.ITER_FRAGMENT, function () {
          this.d = this.sea_octave(pb.mul(pb.add(this.uv, this.seaTime), this.freq), this.choppy);
          this.d = pb.add(
            this.d,
            this.sea_octave(pb.mul(pb.sub(this.uv, this.seaTime), this.freq), this.choppy)
          );
          this.h = pb.add(this.h, pb.mul(this.d, this.amp));
          this.uv = pb.mul(this.uv, this.octave_m);
          this.freq = pb.mul(this.freq, 1.9);
          this.amp = pb.mul(this.amp, 0.22);
          this.choppy = pb.mix(this.choppy, 1, 0.2);
        });
        this.$return(pb.sub(this.p.y, this.h));
      });
      pb.func(
        'getSeaColor',
        [pb.vec3('p'), pb.vec3('n'), pb.vec3('l'), pb.vec3('eye'), pb.vec3('dist')],
        function () {
          this.fresnel = pb.clamp(pb.sub(1, pb.dot(this.n, pb.neg(this.eye))), 0, 1);
          this.fresnel = pb.mul(pb.pow(this.fresnel, 3), 0.5);
          this.reflected = this.getSkyColor(pb.reflect(this.eye, this.n));
          this.refracted = pb.add(
            this.SEA_BASE,
            pb.mul(this.diffuse(this.n, this.l, 80), this.SEA_WATER_COLOR, 0.12)
          );
          this.color = pb.mix(this.refracted, this.reflected, this.fresnel);
          this.atten = pb.max(pb.sub(1, pb.mul(pb.dot(this.dist, this.dist), 0.001)), 0);
          this.color = pb.add(
            this.color,
            pb.mul(this.SEA_WATER_COLOR, pb.sub(this.p.y, this.SEA_HEIGHT), 0.18, this.atten)
          );
          this.color = pb.add(this.color, pb.vec3(this.specular(this.n, this.l, this.eye, 60)));
          this.$return(this.color);
        }
      );
      pb.func('getNormal', [pb.vec3('p'), pb.float('eps')], function () {
        this.n = pb.vec3();
        this.n.y = this.map_detailed(this.p);
        this.n.x = pb.sub(
          this.map_detailed(pb.vec3(pb.add(this.p.x, this.eps), this.p.y, this.p.z)),
          this.n.y
        );
        this.n.z = pb.sub(
          this.map_detailed(pb.vec3(this.p.x, this.p.y, pb.add(this.p.z, this.eps))),
          this.n.y
        );
        this.n.y = this.eps;
        this.$return(pb.normalize(this.n));
      });
      pb.func('heightMapTracing', [pb.vec3('ori'), pb.vec3('dir'), pb.vec3('p').inout()], function () {
        this.tm = pb.float(0);
        this.tx = pb.float(1000);
        this.hx = this.map(pb.add(this.ori, pb.mul(this.dir, this.tx)));
        this.$if(pb.greaterThan(this.hx, 0), function () {
          this.p = pb.add(this.ori, pb.mul(this.dir, this.tx));
          this.$return(this.tx);
        });
        this.hm = this.map(pb.add(this.ori, pb.mul(this.dir, this.tm)));
        this.tmid = pb.float(0);
        this.$for(pb.int('i'), 0, this.NUM_STEPS, function () {
          this.tmid = pb.mix(this.tm, this.tx, pb.div(this.hm, pb.sub(this.hm, this.hx)));
          this.p = pb.add(this.ori, pb.mul(this.dir, this.tmid));
          this.hmid = this.map(this.p);
          this.$if(pb.lessThan(this.hmid, 0), function () {
            this.tx = this.tmid;
            this.hx = this.hmid;
          }).$else(function () {
            this.tm = this.tmid;
            this.hm = this.hmid;
          });
        });
        this.$return(this.tmid);
      });
      pb.func('getPixel', [pb.vec2('coord'), pb.float('time')], function () {
        this.uv = pb.div(this.coord, this.uniforms.zw);
        this.uv = pb.sub(pb.mul(this.uv, 2), pb.vec2(1));
        if (pb.getDevice().type === 'webgpu') {
          this.uv.y = pb.neg(this.uv.y);
        }
        this.uv.x = pb.mul(this.uv.x, pb.div(this.uniforms.z, this.uniforms.w));
        this.ang = pb.vec3(
          pb.mul(pb.sin(pb.mul(this.time, 3)), 0.1),
          pb.add(pb.mul(pb.sin(this.time), 0.2), 0.3),
          this.time
        );
        this.ori = pb.vec3(0, 3.5, pb.mul(this.time, 5));
        this.dir = pb.normalize(pb.vec3(this.uv.xy, -2));
        this.dir.z = pb.add(this.dir.z, pb.mul(pb.length(this.uv), 0.14));
        this.dir = pb.mul(pb.normalize(this.dir), this.fromEuler(this.ang));
        this.p = pb.vec3();
        this.heightMapTracing(this.ori, this.dir, this.p);
        this.dist = pb.sub(this.p, this.ori);
        this.n = this.getNormal(this.p, pb.mul(pb.dot(this.dist, this.dist), pb.div(0.1, this.uniforms.z)));
        this.light = pb.normalize(pb.vec3(0, 1, 0.8));
        this.$return(
          pb.mix(
            this.getSkyColor(this.dir),
            this.getSeaColor(this.p, this.n, this.light, this.dir, this.dist),
            pb.pow(pb.smoothStep(0, -0.02, this.dir.y), 0.2)
          )
        );
      });
      pb.main(function () {
        this.time = pb.add(pb.mul(this.uniforms.x, 0.3), pb.mul(this.uniforms.y, 0.01));
        this.color = this.getPixel(this.$builtins.fragCoord.xy, this.time);
        this.$outputs.outColor = pb.vec4(pb.pow(this.color, pb.vec3(0.65)), 1);
      });
    }
  });
  const bindGroup = device.createBindGroup(program.bindGroupLayouts[0]);

  const renderStates = device.createRenderStateSet();
  renderStates.useDepthState().enableTest(false);

  device.runLoop(device => {
    bindGroup.setValue(
      'uniforms',
      new Vector4(
        device.frameInfo.elapsedOverall * 0.001,
        0,
        device.getDrawingBufferWidth(),
        device.getDrawingBufferHeight()
      )
    );
    device.setRenderStates(renderStates);
    device.setVertexLayout(vertexLayout);
    device.setProgram(program);
    device.setBindGroup(0, bindGroup);
    device.draw('triangle-strip', 0, 4);

    DrawText.drawText(device, `Device: ${device.type}`, '#ffffff', 30, 30);
    DrawText.drawText(device, `FPS: ${device.frameInfo.FPS.toFixed(2)}`, '#ffff00', 30, 50);
  });
})();
