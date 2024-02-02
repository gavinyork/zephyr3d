import { Matrix4x4, Quaternion, Vector4 } from '@zephyr3d/base';
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

  // create vertex layout
  const vertices = [
    // top
    -1, 1, -1, -1, 1, 1, 1, 1, 1, 1, 1, -1,
    // front
    -1, 1, 1, -1, -1, 1, 1, -1, 1, 1, 1, 1,
    // right
    1, 1, 1, 1, -1, 1, 1, -1, -1, 1, 1, -1,
    // back
    1, 1, -1, 1, -1, -1, -1, -1, -1, -1, 1, -1,
    // left
    -1, 1, -1, -1, -1, -1, -1, -1, 1, -1, 1, 1,
    // bottom
    -1, -1, 1, -1, -1, -1, 1, -1, -1, 1, -1, 1
  ];
  const normals = [
    // top
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
    // front
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    // right
    1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
    // back
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
    // left
    -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
    // bottom
    0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0
  ];
  const offsets = [
    -6, -6, -18,
    -2, -6, -18,
     2, -6, -18,
     6, -6, -18,
    -6, -2, -18,
    -2, -2, -18,
     2, -2, -18,
     6, -2, -18,
    -6,  2, -18,
    -2,  2, -18,
     2,  2, -18,
     6,  2, -18,
    -6,  6, -18,
    -2,  6, -18,
     2,  6, -18,
     6,  6, -18,
  ];
  const indices = [
    0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11, 12, 13, 14, 12, 14, 15, 16, 17, 18, 16, 18, 19, 20, 21, 22, 20, 22, 23
  ];
  const vbPos = device.createVertexBuffer('position_f32x3', new Float32Array(vertices));
  const vbNorm = device.createVertexBuffer('normal_f32x3', new Float32Array(normals));
  const vbOffsets = device.createVertexBuffer('tex0_f32x3', new Float32Array(offsets));
  const ib = device.createIndexBuffer(new Uint16Array(indices));
  const vertexLayout = device.createVertexLayout({
    vertexBuffers: [{
      buffer: vbPos
    }, {
      buffer: vbNorm
    }, {
      buffer: vbOffsets,
      stepMode: 'instance'
    }],
    indexBuffer: ib
  });

  // create shader program
  const program = device.buildRenderProgram({
    vertex(pb) {
      this.projMatrix = pb.mat4().uniform(0);
      this.worldMatrix = pb.mat4().uniform(0);
      this.$inputs.position = pb.vec3().attrib('position');
      this.$inputs.normal = pb.vec3().attrib('normal');
      this.$inputs.offset = pb.vec3().attrib('texCoord0');
      this.$outputs.normal = pb.vec3();
      pb.main(function() {
        this.worldPos = pb.mul(this.worldMatrix, pb.vec4(this.$inputs.position, 1));
        this.$builtins.position = pb.mul(this.projMatrix, pb.vec4(pb.add(this.worldPos.xyz, this.$inputs.offset), 1));
        this.$outputs.normal = this.$inputs.normal;
      });
    },
    fragment(pb) {
      this.$outputs.color = pb.vec4();
      pb.main(function() {
        this.normal = pb.add(pb.mul(pb.normalize(this.$inputs.normal), 0.5), pb.vec3(0.5));
        this.$outputs.color = pb.vec4(pb.pow(this.normal, pb.vec3(1/2.2)), 1);
      });
    }
  });

  // create bind group
  const bindGroup = device.createBindGroup(program.bindGroupLayouts[0]);

  // start render loop
  device.runLoop(device => {
    const t = device.frameInfo.elapsedOverall * 0.002;
    const rotateMatrix = Quaternion.fromEulerAngle(t, t, 0, 'XYZ').toMatrix4x4();
    bindGroup.setValue('worldMatrix', rotateMatrix);
    bindGroup.setValue('projMatrix', Matrix4x4.perspective(1.5, device.getDrawingBufferWidth()/device.getDrawingBufferHeight(), 1, 50));

    device.clearFrameBuffer(new Vector4(0, 0, 0.5, 1), 1, 0);
    device.setProgram(program);
    device.setVertexLayout(vertexLayout);
    device.setBindGroup(0, bindGroup);
    device.drawInstanced('triangle-list', 0, 36, 16);

    DrawText.drawText(device, `Device: ${device.type}`, '#ffffff', 30, 30);
    DrawText.drawText(device, `FPS: ${device.frameInfo.FPS.toFixed(2)}`, '#ffff00', 30, 50);
  });
})();
