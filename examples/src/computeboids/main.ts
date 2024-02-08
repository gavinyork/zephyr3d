import { Vector4 } from '@zephyr3d/base';
import type { StructuredBuffer, BindGroup, VertexLayout } from '@zephyr3d/device';
import { DrawText } from '@zephyr3d/device';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';

(async function () {
  const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
  const device = await backendWebGPU.createDevice(canvas);
  if (!device) {
    throw new Error('WebGPU is not available');
  }
  const spriteProgram = device.buildRenderProgram({
    label: 'spriteRender',
    vertex(pb) {
      this.$inputs.pos = pb.vec2().attrib('position');
      this.$inputs.instPos = pb.vec2().attrib('texCoord0');
      this.$inputs.instVel = pb.vec2().attrib('texCoord1');
      pb.main(function () {
        this.angle = pb.neg(pb.atan2(this.$inputs.instVel.x, this.$inputs.instVel.y));
        this.c = pb.cos(this.angle);
        this.s = pb.sin(this.angle);
        this.x = pb.sub(pb.mul(this.$inputs.pos.x, this.c), pb.mul(this.$inputs.pos.y, this.s));
        this.y = pb.add(pb.mul(this.$inputs.pos.x, this.s), pb.mul(this.$inputs.pos.y, this.c));
        this.$builtins.position = pb.vec4(pb.add(this.$inputs.instPos, pb.vec2(this.x, this.y)), 0, 1);
      });
    },
    fragment(pb) {
      this.$outputs.color = pb.vec4();
      pb.main(function () {
        this.$outputs.color = pb.vec4(1);
      });
    }
  });
  const spriteUpdateProgram = device.buildComputeProgram({
    label: 'spriteUpdate',
    workgroupSize: [64, 1, 1],
    compute(pb) {
      const structParticle = pb.defineStruct([pb.vec2('pos'), pb.vec2('vel')], 'Particle');
      const structParams = pb.defineStruct(
        [
          pb.float('deltaT'),
          pb.float('rule1Distance'),
          pb.float('rule2Distance'),
          pb.float('rule3Distance'),
          pb.float('rule1Scale'),
          pb.float('rule2Scale'),
          pb.float('rule3Scale')
        ],
        'SimParams'
      );
      this.params = structParams().uniformBuffer(0);
      this.particlesA = structParticle[0]().storageBuffer(0);
      this.particlesB = structParticle[0]().storageBuffer(0);
      pb.main(function () {
        this.index = this.$builtins.globalInvocationId.x;
        this.vPos = this.particlesA.at(this.index).pos;
        this.vVel = this.particlesA.at(this.index).vel;
        this.cMass = pb.vec2(0);
        this.cVel = pb.vec2(0);
        this.colVel = pb.vec2(0);
        this.cMassCount = pb.uint(0);
        this.cVelCount = pb.uint(0);
        this.pos = pb.vec2();
        this.vel = pb.vec2();
        this.$for(pb.uint('i'), 0, pb.arrayLength(this.particlesA), function () {
          this.$if(pb.equal(this.i, this.index), function () {
            this.$continue();
          });
          this.pos = this.particlesA.at(this.i).pos.xy;
          this.vel = this.particlesA.at(this.i).vel.xy;
          this.$if(pb.lessThan(pb.distance(this.pos, this.vPos), this.params.rule1Distance), function () {
            this.cMass = pb.add(this.cMass, this.pos);
            this.cMassCount = pb.add(this.cMassCount, 1);
          });
          this.$if(pb.lessThan(pb.distance(this.pos, this.vPos), this.params.rule2Distance), function () {
            this.colVel = pb.sub(this.colVel, pb.sub(this.pos, this.vPos));
          });
          this.$if(pb.lessThan(pb.distance(this.pos, this.vPos), this.params.rule3Distance), function () {
            this.cVel = pb.add(this.cVel, this.vel);
            this.cVelCount = pb.add(this.cVelCount, 1);
          });
        });
        this.$if(pb.greaterThan(this.cMassCount, 0), function () {
          this.temp = pb.float(this.cMassCount);
          this.cMass = pb.sub(pb.div(this.cMass, pb.vec2(this.temp)), this.vPos);
        });
        this.$if(pb.greaterThan(this.cVelCount, 0), function () {
          this.temp = pb.float(this.cVelCount);
          this.cVel = pb.div(this.cVel, pb.vec2(this.temp));
        });
        this.vVel = pb.add(this.vVel, pb.mul(this.cMass, this.params.rule1Scale));
        this.vVel = pb.add(this.vVel, pb.mul(this.colVel, this.params.rule2Scale));
        this.vVel = pb.add(this.vVel, pb.mul(this.cVel, this.params.rule3Scale));
        this.vVel = pb.mul(pb.normalize(this.vVel), pb.clamp(pb.length(this.vVel), 0, 0.1));
        this.vPos = pb.add(this.vPos, pb.mul(this.vVel, this.params.deltaT));
        this.$if(pb.lessThan(this.vPos.x, -1), function () {
          this.vPos.x = 1;
        });
        this.$if(pb.greaterThan(this.vPos.x, 1), function () {
          this.vPos.x = -1;
        });
        this.$if(pb.lessThan(this.vPos.y, -1), function () {
          this.vPos.y = 1;
        });
        this.$if(pb.greaterThan(this.vPos.y, 1), function () {
          this.vPos.y = -1;
        });
        this.particlesB.at(this.index).pos = this.vPos;
        this.particlesB.at(this.index).vel = this.vVel;
      });
    }
  });
  console.log(spriteUpdateProgram.getShaderSource('compute'));
  console.log(spriteUpdateProgram.bindGroupLayouts[0]);
  const spriteVertexBuffer = device.createVertexBuffer(
    'position_f32x2',
    new Float32Array([-0.01, -0.02, 0.01, -0.02, 0.0, 0.02])
  );
  const simParams = {
    deltaT: 0.04,
    rule1Distance: 0.1,
    rule2Distance: 0.025,
    rule3Distance: 0.025,
    rule1Scale: 0.02,
    rule2Scale: 0.05,
    rule3Scale: 0.005
  };
  const uniformBuffer = spriteUpdateProgram.createUniformBuffer('params');
  const numParticles = 1500;
  const initialParticleData = new Float32Array(numParticles * 4);
  for (let i = 0; i < numParticles; ++i) {
    initialParticleData[4 * i + 0] = 2 * (Math.random() - 0.5);
    initialParticleData[4 * i + 1] = 2 * (Math.random() - 0.5);
    initialParticleData[4 * i + 2] = 2 * (Math.random() - 0.5) * 0.1;
    initialParticleData[4 * i + 3] = 2 * (Math.random() - 0.5) * 0.1;
  }
  const particleBuffers: StructuredBuffer[] = [];
  const particleBindGroups: BindGroup[] = [];
  const primitives: VertexLayout[] = [];
  for (let i = 0; i < 2; i++) {
    particleBuffers.push(
      device.createInterleavedVertexBuffer(['tex0_f32x2', 'tex1_f32x2'], initialParticleData, {
        storage: true
      })
    );
  }
  for (let i = 0; i < 2; i++) {
    const bindGroup = device.createBindGroup(spriteUpdateProgram.bindGroupLayouts[0]);
    bindGroup.setBuffer('params', uniformBuffer);
    bindGroup.setBuffer('particlesA', particleBuffers[i]);
    bindGroup.setBuffer('particlesB', particleBuffers[(i + 1) % 2]);
    particleBindGroups.push(bindGroup);

    const primitive = device.createVertexLayout({
      vertexBuffers: [
        {
          buffer: spriteVertexBuffer,
          stepMode: 'vertex'
        },
        {
          buffer: particleBuffers[i],
          stepMode: 'instance'
        }
      ]
    });
    primitives.push(primitive);
  }

  function updateSimParams() {
    for (const k in simParams) {
      uniformBuffer.set(k, simParams[k]);
    }
  }
  updateSimParams();
  let t = 0;
  device.runLoop((device) => {
    device.setProgram(spriteUpdateProgram);
    device.setBindGroup(0, particleBindGroups[t % 2]);
    device.compute(Math.ceil(numParticles / 64), 1, 1);

    device.clearFrameBuffer(new Vector4(0, 0, 0, 1), 1, 0);
    device.setProgram(spriteProgram);
    primitives[(t + 1) % 2].drawInstanced('triangle-list', 0, 3, numParticles);
    t++;

    DrawText.drawText(device, `Device: ${device.type}`, '#ffffff', 30, 30);
    DrawText.drawText(device, `FPS: ${device.frameInfo.FPS.toFixed(2)}`, '#ffff00', 30, 50);
  });
})();
