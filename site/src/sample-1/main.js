import { Matrix4x4, Quaternion, Vector3, Vector4 } from '@zephyr3d/base';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

(async function () {
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
    0, 0, 0, 1, 1, 1, 1, 0
  ];
  const indices = [
    0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11, 12, 13, 14, 12, 14, 15, 16, 17, 18, 16, 18, 19,
    20, 21, 22, 20, 22, 23
  ];
  const vbPos = device.createVertexBuffer('position_f32x3', new Float32Array(vertices));
  const vbNormals = device.createVertexBuffer('normal_f32x3', new Float32Array(normals));
  const vbTexCoords = device.createVertexBuffer('tex0_f32x2', new Float32Array(texcoords));
  const ib = device.createIndexBuffer(new Uint16Array(indices));
  const vertexLayout = device.createVertexLayout({
    vertexBuffers: [
      {
        buffer: vbPos
      },
      {
        buffer: vbNormals
      },
      {
        buffer: vbTexCoords
      }
    ],
    indexBuffer: ib
  });

  // load texture
  const img = document.createElement('img');
  img.src = 'assets/images/layer.jpg';
  await img.decode();
  const bitmap = await createImageBitmap(img, { premultiplyAlpha: 'none' });
  const texture = device.createTexture2DFromImage(bitmap, true);

  // create shader program
  const program = device.buildRenderProgram({
    vertex(pb) {
      this.projMatrix = pb.mat4().uniform(1);
      this.worldMatrix = pb.mat4().uniform(1);
      this.$inputs.position = pb.vec3().attrib('position');
      this.$inputs.normal = pb.vec3().attrib('normal');
      this.$inputs.uv = pb.vec2().attrib('texCoord0');
      this.$outputs.uv = pb.vec2();
      this.$outputs.worldNormal = pb.vec3();
      pb.main(function () {
        this.worldPos = pb.mul(this.worldMatrix, pb.vec4(this.$inputs.position, 1));
        this.$builtins.position = pb.mul(this.projMatrix, this.worldPos);
        this.$outputs.worldNormal = pb.mul(this.worldMatrix, pb.vec4(this.$inputs.normal, 0)).xyz;
        this.$outputs.uv = this.$inputs.uv;
      });
    },
    fragment(pb) {
      this.tex = pb.tex2D().uniform(0);
      this.lightdir = pb.vec3().uniform(0);
      this.lightcolor = pb.vec3().uniform(0);
      this.ambient = pb.vec3().uniform(0);
      this.$outputs.color = pb.vec4();
      pb.main(function () {
        this.sampleColor = pb.textureSample(this.tex, this.$inputs.uv);
        this.NdotL = pb.clamp(
          pb.neg(pb.dot(pb.normalize(this.lightdir), pb.normalize(this.$inputs.worldNormal))),
          0,
          1
        );
        this.finalColor = pb.add(pb.mul(this.sampleColor.rgb, this.lightcolor, this.NdotL), this.ambient);
        this.$outputs.color = pb.vec4(pb.pow(this.finalColor, pb.vec3(1 / 2.2)), 1);
      });
    }
  });

  // create bind groups

  // bind group 0 holds the shader uniforms which will be never changed
  const bindGroup0 = device.createBindGroup(program.bindGroupLayouts[0]);
  bindGroup0.setValue('lightdir', new Vector3(1, -1, -1).inplaceNormalize());
  bindGroup0.setValue('lightcolor', Vector3.one());
  bindGroup0.setValue('ambient', new Vector3(0.01, 0.01, 0.01));
  bindGroup0.setTexture('tex', texture);
  // bind group 1 holds the shader uniforms which will be changed every frame
  const bindGroup1 = device.createBindGroup(program.bindGroupLayouts[1]);

  // start render loop
  device.runLoop((device) => {
    const t = device.frameInfo.elapsedOverall * 0.002;
    const rotateMatrix = Quaternion.fromEulerAngle(t, t, 0, 'XYZ').toMatrix4x4();
    bindGroup1.setValue(
      'projMatrix',
      Matrix4x4.perspective(1.5, device.getDrawingBufferWidth() / device.getDrawingBufferHeight(), 1, 50)
    );
    bindGroup1.setValue('worldMatrix', Matrix4x4.translateLeft(rotateMatrix, new Vector3(0, 0, -4)));

    device.clearFrameBuffer(new Vector4(0, 0, 0.5, 1), 1, 0);
    device.setProgram(program);
    device.setVertexLayout(vertexLayout);
    device.setBindGroup(0, bindGroup0);
    device.setBindGroup(1, bindGroup1);
    device.draw('triangle-list', 0, 36);

    device.drawText(`Device: ${device.type}`, 30, 30, '#ffffff');
    device.drawText(`FPS: ${device.frameInfo.FPS.toFixed(2)}`, 30, 50, '#ffff00');
  });
})();
