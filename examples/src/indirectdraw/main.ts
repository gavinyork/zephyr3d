import { DEPTH_CLEAR_VALUE, Matrix4x4, Quaternion, Vector4 } from '@zephyr3d/base';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
import { DrawText } from '@zephyr3d/device';

/**
 * Visual check of the indirect draw API (WebGPU only).
 *
 * Three 4x4 grids of cubes, each drawn with one indirect call:
 *
 * - Left: drawIndexedIndirect, arguments written by the CPU. The instance count grows by one
 *   every second, 1..16, filling the grid row by row.
 * - Middle: drawIndirect (non-indexed), arguments written by the CPU. The instance count shrinks
 *   by one every second, 16..1.
 * - Right: fully GPU driven. A compute shader keeps the cubes whose (index + second) % 3 != 0,
 *   appends their offsets to a storage + vertex buffer with atomicAdd and accumulates the instance
 *   count in a storage + indirect buffer, then drawIndexedIndirect draws them. Every third cube is
 *   missing and the gaps shift by one position every second.
 */
(async function () {
  const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
  const device = await backendWebGPU.createDevice(canvas);
  if (!device) {
    throw new Error('WebGPU is not available');
  }
  if (!device.getDeviceCaps().miscCaps.supportDrawIndirect) {
    throw new Error('Indirect draw is not supported');
  }

  const GRID = 4;
  const NUM_INSTANCES = GRID * GRID;

  // cube geometry
  const positions = [
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
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
    0, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, 0, -1, 0, 0, -1, 0, 0,
    -1, 0, 0, -1, 0
  ];
  const indices = [
    0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11, 12, 13, 14, 12, 14, 15, 16, 17, 18, 16, 18, 19,
    20, 21, 22, 20, 22, 23
  ];
  // the same cube expanded for the non-indexed draw
  const expandedPositions: number[] = [];
  const expandedNormals: number[] = [];
  for (const i of indices) {
    expandedPositions.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    expandedNormals.push(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]);
  }

  /** Offsets of a 4x4 grid centred at (cx, 0, -30), row by row from the top */
  function gridOffsets(cx: number) {
    const data = new Float32Array(NUM_INSTANCES * 4);
    for (let i = 0; i < NUM_INSTANCES; i++) {
      const x = i % GRID;
      const y = Math.floor(i / GRID);
      data[i * 4 + 0] = cx + (x - 1.5) * 3;
      data[i * 4 + 1] = (1.5 - y) * 3;
      data[i * 4 + 2] = -30;
      data[i * 4 + 3] = 0;
    }
    return data;
  }

  const vbPos = device.createVertexBuffer('position_f32x3', new Float32Array(positions));
  const vbNorm = device.createVertexBuffer('normal_f32x3', new Float32Array(normals));
  const vbPosExpanded = device.createVertexBuffer('position_f32x3', new Float32Array(expandedPositions));
  const vbNormExpanded = device.createVertexBuffer('normal_f32x3', new Float32Array(expandedNormals));
  const ib = device.createIndexBuffer(new Uint16Array(indices));

  // Left: indexed, CPU written arguments
  const leftOffsets = device.createVertexBuffer('tex0_f32x4', gridOffsets(-15));
  const leftLayout = device.createVertexLayout({
    vertexBuffers: [{ buffer: vbPos }, { buffer: vbNorm }, { buffer: leftOffsets, stepMode: 'instance' }],
    indexBuffer: ib
  });
  // indexCount, instanceCount, firstIndex, baseVertex, firstInstance
  const leftArgs = device.createBuffer(5 * 4, { usage: 'indirect' });

  // Middle: non-indexed, CPU written arguments
  const middleOffsets = device.createVertexBuffer('tex0_f32x4', gridOffsets(0));
  const middleLayout = device.createVertexLayout({
    vertexBuffers: [
      { buffer: vbPosExpanded },
      { buffer: vbNormExpanded },
      { buffer: middleOffsets, stepMode: 'instance' }
    ]
  });
  // vertexCount, instanceCount, firstVertex, firstInstance
  const middleArgs = device.createBuffer(4 * 4, { usage: 'indirect' });

  // Right: GPU written instances and arguments
  const rightSource = device.createBuffer(NUM_INSTANCES * 16, { usage: 'uniform', storage: true });
  rightSource.bufferSubData(0, gridOffsets(15));
  const rightOffsets = device.createVertexBuffer('tex0_f32x4', new Float32Array(NUM_INSTANCES * 4), {
    storage: true
  });
  const rightLayout = device.createVertexLayout({
    vertexBuffers: [{ buffer: vbPos }, { buffer: vbNorm }, { buffer: rightOffsets, stepMode: 'instance' }],
    indexBuffer: ib
  });
  const rightArgs = device.createBuffer(5 * 4, { usage: 'indirect', storage: true });

  const cullProgram = device.buildComputeProgram({
    label: 'indirectCull',
    workgroupSize: [NUM_INSTANCES, 1, 1],
    compute(pb) {
      this.second = pb.uint().uniform(0);
      this.source = pb.vec4[0]().storageBuffer(0);
      this.instances = pb.vec4[0]().storageBuffer(0);
      this.args = pb.atomic_uint[0]().storageBuffer(0);
      pb.main(function () {
        this.index = this.$builtins.globalInvocationId.x;
        this.key = pb.add(this.index, this.second);
        this.remainder = pb.sub(this.key, pb.mul(pb.div(this.key, pb.uint(3)), pb.uint(3)));
        this.$if(pb.notEqual(this.remainder, pb.uint(0)), function () {
          // args[1] is the instance count
          this.slot = pb.atomicAdd(this.args.at(1), 1);
          this.instances.setAt(this.slot, this.source.at(this.index));
        });
      });
    }
  });
  const cullBindGroup = device.createBindGroup(cullProgram.bindGroupLayouts[0]);
  cullBindGroup.setBuffer('source', rightSource);
  cullBindGroup.setBuffer('instances', rightOffsets);
  cullBindGroup.setBuffer('args', rightArgs);

  const program = device.buildRenderProgram({
    vertex(pb) {
      this.projMatrix = pb.mat4().uniform(0);
      this.worldMatrix = pb.mat4().uniform(0);
      this.$inputs.position = pb.vec3().attrib('position');
      this.$inputs.normal = pb.vec3().attrib('normal');
      this.$inputs.offset = pb.vec4().attrib('texCoord0');
      this.$outputs.normal = pb.vec3();
      pb.main(function () {
        this.worldPos = pb.mul(this.worldMatrix, pb.vec4(this.$inputs.position, 1));
        this.$builtins.position = pb.mul(
          this.projMatrix,
          pb.vec4(pb.add(this.worldPos.xyz, this.$inputs.offset.xyz), 1)
        );
        this.$outputs.normal = pb.mul(this.worldMatrix, pb.vec4(this.$inputs.normal, 0)).xyz;
      });
    },
    fragment(pb) {
      this.$outputs.color = pb.vec4();
      pb.main(function () {
        this.normal = pb.add(pb.mul(pb.normalize(this.$inputs.normal), 0.5), pb.vec3(0.5));
        this.$outputs.color = pb.vec4(pb.pow(this.normal, pb.vec3(1 / 2.2)), 1);
      });
    }
  });
  const bindGroup = device.createBindGroup(program.bindGroupLayouts[0]);

  device.runLoop((device) => {
    const t = device.frameInfo.elapsedOverall * 0.001;
    const second = Math.floor(t);
    const leftCount = (second % NUM_INSTANCES) + 1;
    const middleCount = NUM_INSTANCES - (second % NUM_INSTANCES);

    leftArgs.bufferSubData(0, new Uint32Array([36, leftCount, 0, 0, 0]));
    middleArgs.bufferSubData(0, new Uint32Array([36, middleCount, 0, 0]));
    // Reset the GPU written count; the compute pass accumulates it
    rightArgs.bufferSubData(0, new Uint32Array([36, 0, 0, 0, 0]));

    device.setProgram(cullProgram);
    cullBindGroup.setValue('second', second);
    device.setBindGroup(0, cullBindGroup);
    device.compute(1, 1, 1);

    const rotation = Quaternion.fromEulerAngle(t * 0.7, t, 0).toMatrix4x4();
    bindGroup.setValue('worldMatrix', rotation);
    bindGroup.setValue(
      'projMatrix',
      Matrix4x4.perspective(1.2, device.getDrawingBufferWidth() / device.getDrawingBufferHeight(), 1, 100)
    );
    device.clearFrameBuffer(new Vector4(0.1, 0.1, 0.2, 1), DEPTH_CLEAR_VALUE, 0);
    device.setProgram(program);
    device.setBindGroup(0, bindGroup);
    device.setVertexLayout(leftLayout);
    device.drawIndexedIndirect('triangle-list', leftArgs, 0);
    device.setVertexLayout(middleLayout);
    device.drawIndirect('triangle-list', middleArgs, 0);
    device.setVertexLayout(rightLayout);
    device.drawIndexedIndirect('triangle-list', rightArgs, 0);

    const expectedRight = Array.from({ length: NUM_INSTANCES }, (_, i) => i).filter(
      (i) => (i + second) % 3 !== 0
    ).length;
    DrawText.drawText(device, `Device: ${device.type}`, '#ffffff', 30, 30);
    DrawText.drawText(device, `FPS: ${device.frameInfo.FPS.toFixed(2)}`, '#ffff00', 30, 50);
    DrawText.drawText(
      device,
      `Left  drawIndexedIndirect (CPU args): expect ${leftCount} cubes, filling row by row`,
      '#80ff80',
      30,
      80
    );
    DrawText.drawText(
      device,
      `Middle drawIndirect (CPU args): expect ${middleCount} cubes, emptying from the end`,
      '#80ff80',
      30,
      100
    );
    DrawText.drawText(
      device,
      `Right  compute + drawIndexedIndirect: expect ${expectedRight} cubes, every cube with (index + ${second}) % 3 == 0 missing`,
      '#80ff80',
      30,
      120
    );
  });
})();
