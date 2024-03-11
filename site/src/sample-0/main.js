import { Vector4 } from '@zephyr3d/base';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

(async function() {
  // Create WebGL2 device
  /** @type HTMLCanvasElement */
  const canvas = document.querySelector('#canvas');
  const device = await backendWebGL2.createDevice(canvas);
  // Create vertex buffers
  const positions = device.createVertexBuffer('position_f32x2', new Float32Array([-0.3, -0.7, 0.3, -0.7, 0, 0.7]));
  const colors = device.createVertexBuffer('diffuse_u8normx4', new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]));
  // Create vertex input layout object
  const vertexLayout = device.createVertexLayout({
    vertexBuffers: [{
      buffer: positions
    }, {
      buffer: colors
    }]
  });
  // Create shader
  const program = device.buildRenderProgram({
    vertex(pb) {
      // Vertex stream definitions
      this.$inputs.position = pb.vec2().attrib('position');
      this.$inputs.color = pb.vec4().attrib('diffuse');
      // Varying definitions
      this.$outputs.color = pb.vec4();
      // Entry point
      pb.main(function(){
        this.$builtins.position = pb.vec4(this.$inputs.position, 0, 1);
        this.$outputs.color = this.$inputs.color;
      });
    },
    fragment(pb) {
      // Color output
      this.$outputs.color = pb.vec4();
      // Entry point
      pb.main(function(){
        this.$outputs.color = pb.vec4(pb.pow(this.$inputs.color.rgb, pb.vec3(1/2.2)), 1);
      });
    }
  });

  // Start rendering loop
  device.runLoop(device => {
    // Clear frame buffers
    device.clearFrameBuffer(new Vector4(0, 0, 0.5, 1), 1, 0);
    // Set current shader
    device.setProgram(program);
    // Set vertex input
    device.setVertexLayout(vertexLayout);
    // Render triangles
    device.draw('triangle-list', 0, 3);
    // Display some text
    device.drawText(`Device: ${device.type}`, 30, 30, '#ffffff');
    device.drawText(`FPS: ${device.frameInfo.FPS.toFixed(2)}`, 30, 50, '#ffff00');
  });
})();
