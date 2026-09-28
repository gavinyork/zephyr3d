import { DEPTH_CLEAR_VALUE, Vector4 } from '@zephyr3d/base';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
import { DrawText } from '@zephyr3d/device';

/**
 * Visual check of computeIndirect (WebGPU only).
 *
 * A 4x4 grid of cells. Every frame:
 * - compute A (one workgroup of 16 threads) clears all cells and writes the dispatch arguments
 *   (n, 1, 1) into a storage + indirect buffer, n cycling through 1..16 once per second;
 * - compute B is launched with computeIndirect on those arguments; workgroup i lights cell i;
 * - the grid is drawn reading the cells from a read-only storage buffer.
 *
 * Expected: n cells lit, filling the grid row by row from the top left, one more every second.
 */
(async function () {
  const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
  const device = await backendWebGPU.createDevice(canvas);
  if (!device) {
    throw new Error('WebGPU is not available');
  }
  if (!device.getDeviceCaps().miscCaps.supportDispatchIndirect) {
    throw new Error('Indirect dispatch is not supported');
  }
  const GRID = 4;
  const NUM_CELLS = GRID * GRID;

  const argsBuffer = device.createBuffer(3 * 4, { usage: 'indirect', storage: true });
  const cellBuffer = device.createBuffer(NUM_CELLS * 4, { usage: 'uniform', storage: true });

  const writeArgsProgram = device.buildComputeProgram({
    label: 'writeDispatchArgs',
    workgroupSize: [NUM_CELLS, 1, 1],
    compute(pb) {
      this.count = pb.uint().uniform(0);
      this.args = pb.uint[0]().storageBuffer(0);
      this.cells = pb.uint[0]().storageBuffer(0);
      pb.main(function () {
        this.cells.setAt(this.$builtins.localInvocationId.x, pb.uint(0));
        this.$if(pb.equal(this.$builtins.localInvocationId.x, pb.uint(0)), function () {
          this.args.setAt(0, this.count);
          this.args.setAt(1, pb.uint(1));
          this.args.setAt(2, pb.uint(1));
        });
      });
    }
  });
  const writeArgsBindGroup = device.createBindGroup(writeArgsProgram.bindGroupLayouts[0]);
  writeArgsBindGroup.setBuffer('args', argsBuffer);
  writeArgsBindGroup.setBuffer('cells', cellBuffer);

  const lightProgram = device.buildComputeProgram({
    label: 'lightCells',
    workgroupSize: [1, 1, 1],
    compute(pb) {
      this.cells = pb.uint[0]().storageBuffer(0);
      pb.main(function () {
        this.cells.setAt(this.$builtins.workGroupId.x, pb.uint(1));
      });
    }
  });
  const lightBindGroup = device.createBindGroup(lightProgram.bindGroupLayouts[0]);
  lightBindGroup.setBuffer('cells', cellBuffer);

  // Two triangles per cell, the cell index is the instance index. Wound clockwise here: the
  // vertex shader flips y to put row 0 at the top, which makes them counter-clockwise on screen.
  const quad = device.createVertexBuffer(
    'position_f32x2',
    new Float32Array([0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1])
  );
  const quadLayout = device.createVertexLayout({ vertexBuffers: [{ buffer: quad }] });
  const drawProgram = device.buildRenderProgram({
    vertex(pb) {
      this.aspect = pb.float().uniform(0);
      this.cells = pb.uint[0]().storageBufferReadonly(0);
      this.$inputs.pos = pb.vec2().attrib('position');
      this.$outputs.color = pb.vec3();
      pb.main(function () {
        this.index = this.$builtins.instanceIndex;
        this.cell = pb.vec2(
          pb.float(pb.sub(this.index, pb.mul(pb.div(this.index, pb.uint(GRID)), pb.uint(GRID)))),
          pb.float(pb.div(this.index, pb.uint(GRID)))
        );
        // cells of 0.36 with 0.04 gaps, row 0 at the top
        this.xy = pb.add(pb.mul(pb.add(this.cell, pb.mul(this.$inputs.pos, 0.9)), 0.4), pb.vec2(-0.8, -0.8));
        this.$builtins.position = pb.vec4(pb.div(this.xy.x, this.aspect), pb.neg(this.xy.y), 0.5, 1);
        this.$outputs.color = pb.mix(
          pb.vec3(0.15, 0.15, 0.25),
          pb.vec3(1, 0.85, 0.2),
          pb.float(pb.notEqual(this.cells.at(this.index), pb.uint(0)))
        );
      });
    },
    fragment(pb) {
      this.$outputs.color = pb.vec4();
      pb.main(function () {
        this.$outputs.color = pb.vec4(this.$inputs.color, 1);
      });
    }
  });
  const drawBindGroup = device.createBindGroup(drawProgram.bindGroupLayouts[0]);
  drawBindGroup.setBuffer('cells', cellBuffer);

  device.runLoop((device) => {
    const second = Math.floor(device.frameInfo.elapsedOverall * 0.001);
    const count = (second % NUM_CELLS) + 1;

    device.setProgram(writeArgsProgram);
    writeArgsBindGroup.setValue('count', count);
    device.setBindGroup(0, writeArgsBindGroup);
    device.compute(1, 1, 1);

    device.setProgram(lightProgram);
    device.setBindGroup(0, lightBindGroup);
    device.computeIndirect(argsBuffer, 0);

    device.clearFrameBuffer(new Vector4(0.05, 0.05, 0.08, 1), DEPTH_CLEAR_VALUE, 0);
    device.setProgram(drawProgram);
    drawBindGroup.setValue('aspect', device.getDrawingBufferWidth() / device.getDrawingBufferHeight());
    device.setBindGroup(0, drawBindGroup);
    quadLayout.drawInstanced('triangle-list', 0, 6, NUM_CELLS);

    DrawText.drawText(device, `Device: ${device.type}`, '#ffffff', 30, 30);
    DrawText.drawText(device, `FPS: ${device.frameInfo.FPS.toFixed(2)}`, '#ffff00', 30, 50);
    DrawText.drawText(
      device,
      `computeIndirect with ${count} workgroups: expect ${count} lit cells, filling row by row from the top left`,
      '#80ff80',
      30,
      80
    );
  });
})();
