import { Matrix4x4, Quaternion, Vector3, Vector4 } from '@zephyr3d/base';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

(async function() {
  // create render device
  /** @type HTMLCanvasElement */
  const canvas = document.querySelector('#canvas');
  const device = await backendWebGL2.createDevice(canvas);

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
  const texcoords = [
    // top
    0, 0, 0, 1, 1, 1, 1, 0,
    // front
    0, 0, 0, 1, 1, 1, 1, 0,
    // right
    0, 0, 0, 1, 1, 1, 1, 0,
    // back
    0, 0, 0, 1, 1, 1, 1, 0,
    // left
    0, 0, 0, 1, 1, 1, 1, 0,
    // bottom
    0, 0, 0, 1, 1, 1, 1, 0,
  ];
  const indices = [
    0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11, 12, 13, 14, 12, 14, 15, 16, 17, 18, 16, 18, 19, 20, 21, 22, 20, 22, 23
  ];
  const vbPos = device.createVertexBuffer('position_f32x3', new Float32Array(vertices));
  const vbNorm = device.createVertexBuffer('normal_f32x3', new Float32Array(normals));
  const vbTexCoords = device.createVertexBuffer('tex0_f32x2', new Float32Array(texcoords));
  const ib = device.createIndexBuffer(new Uint16Array(indices));
  const vertexLayout = device.createVertexLayout({
    vertexBuffers: [{
      buffer: vbPos
    }, {
      buffer: vbNorm
    }, {
      buffer: vbTexCoords
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
      this.$outputs.normal = pb.vec3();
      pb.main(function() {
        this.worldPos = pb.mul(this.worldMatrix, pb.vec4(this.$inputs.position, 1));
        this.$builtins.position = pb.mul(this.projMatrix, this.worldPos);
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

  const programTextured = device.buildRenderProgram({
    vertex(pb) {
      this.projMatrix = pb.mat4().uniform(0);
      this.worldMatrix = pb.mat4().uniform(0);
      this.$inputs.position = pb.vec3().attrib('position');
      this.$inputs.uv = pb.vec2().attrib('texCoord0');
      this.$outputs.uv = pb.vec2();
      pb.main(function() {
        this.worldPos = pb.mul(this.worldMatrix, pb.vec4(this.$inputs.position, 1));
        this.$builtins.position = pb.mul(this.projMatrix, this.worldPos);
        this.$outputs.uv = this.$inputs.uv;
      });
    },
    fragment(pb) {
      this.tex = pb.tex2D().uniform(0);
      this.$outputs.color = pb.vec4();
      pb.main(function() {
        this.sampleColor = pb.textureSample(this.tex, this.$inputs.uv).rgb;
        this.$outputs.color = pb.vec4(pb.pow(this.sampleColor, pb.vec3(1/2.2)), 1);
      });
    }
  });
  const bindGroup = device.createBindGroup(program.bindGroupLayouts[0]);

  // create render target
  const renderTargetColorTexture = device.createTexture2D('rgba8unorm', 512, 512);
  const renderTargetDepthTexture = device.createTexture2D('d16', 512, 512);
  const framebuffer = device.createFrameBuffer([renderTargetColorTexture], renderTargetDepthTexture);
  const bindGroupTextured = device.createBindGroup(programTextured.bindGroupLayouts[0]);

  // start render loop
  device.runLoop(device => {
    const t = device.frameInfo.elapsedOverall * 0.002;
    const rotateMatrix = Quaternion.fromEulerAngle(t, t, 0, 'XYZ').toMatrix4x4();
    const worldMatrix = Matrix4x4.translateLeft(rotateMatrix, new Vector3(0, 0, -4));
    device.setVertexLayout(vertexLayout);

    // render to texture
    device.setFramebuffer(framebuffer);
    device.clearFrameBuffer(new Vector4(0.5, 0, 0, 1), 1, 0);
    bindGroup.setValue('worldMatrix', worldMatrix);
    bindGroup.setValue('projMatrix', Matrix4x4.perspective(1.5, device.getDrawingBufferWidth()/device.getDrawingBufferHeight(), 1, 50));
    device.setBindGroup(0, bindGroup);
    device.setProgram(program);
    device.draw('triangle-list', 0, 36);

    // render to screen
    device.setFramebuffer(null);
    device.clearFrameBuffer(new Vector4(0, 0, 0.5, 1), 1, 0);
    bindGroupTextured.setValue('worldMatrix', worldMatrix);
    bindGroupTextured.setValue('projMatrix', Matrix4x4.perspective(1.5, device.getDrawingBufferWidth()/device.getDrawingBufferHeight(), 1, 50));
    bindGroupTextured.setTexture('tex', renderTargetColorTexture);
    device.setBindGroup(0, bindGroupTextured);
    device.setProgram(programTextured);
    device.draw('triangle-list', 0, 36);

    device.drawText(`Device: ${device.type}`, 30, 30, '#ffffff');
    device.drawText(`FPS: ${device.frameInfo.FPS.toFixed(2)}`, 30, 50, '#ffff00');
  });
})();
