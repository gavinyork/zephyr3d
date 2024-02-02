import { frag, vert } from './testshader';

(async function () {
  if (!navigator.gpu) {
    alert('Your browser does not support WebGPU or it is not enabled. More info: https://webgpu.io');
    return;
  }

  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();

  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const context = canvas.getContext('webgpu') as unknown as GPUCanvasContext;

  const swapChainFormat = 'bgra8unorm';

  context.configure({
    device,
    format: swapChainFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    alphaMode: 'opaque',
    colorSpace: 'srgb'
  });

  const sm = device.createShaderModule({
    code: vert
  });
  if (sm) {
    const func: (this: GPUShaderModule) => Promise<GPUCompilationInfo> = (sm as any).compilationInfo || (sm as any).getCompilationInfo;
    if (!func) {
      return sm;
    }
    func.call(sm).then((compilationInfo) => {
      let err = false;
      if (compilationInfo?.messages?.length > 0) {
        let msg = '';
        for (const message of compilationInfo.messages) {
          if (message.type === 'error') {
            err = true;
          }
          msg += `${message.type}: ${message.message} (${message.lineNum}/${message.linePos})\n`;
        }
        if (msg) {
          console.log(msg);
        }
      }
    });
  }

  const vertexShaderWgslCode = `
    struct VERTEX_INPUT {
      @builtin(instance_index) instance_id: u32,
      @builtin(vertex_index) vertex_id: u32,
    };
    struct VERTEX_OUTPUT {
      @builtin(position) pos: vec4<f32>
    };
    @group(0) @binding(0) var<uniform> xforms: array<mat4x4<f32>, 2>;
    @vertex fn main(input: VERTEX_INPUT)->VERTEX_OUTPUT {
      var output: VERTEX_OUTPUT;
      var coords = array<vec2<f32>, 4>(vec2<f32>(-0.5, 0.5), vec2<f32>(0.5, 0.5), vec2<f32>(-0.5, -0.5), vec2<f32>(0.5, -0.5));
      output.pos = xforms[input.instance_id] * vec4<f32>(coords[input.vertex_id], 0.0, 1.0);
      return output;
    }
    `;

  const fragmentShaderWgslCode = `
    struct FRAG_OUTPUT {
      @location(0) outColor: vec4<f32>
    };
    @fragment fn main()->FRAG_OUTPUT {
      var output: FRAG_OUTPUT;
      let linearDepth = vec4<f32>(82.5);
      let splitDistances = vec4<f32>(10.0, 20.0, 40.0, 80.0);
      let cascadeCount = 4;
      let comparison = vec4<i32>(linearDepth > splitDistances);
      let cascadeFlags = vec4<i32>(i32(cascadeCount > 0), i32(cascadeCount > 1), i32(cascadeCount > 2), i32(cascadeCount > 3));
      let index = dot(comparison, cascadeFlags);
      let cascade = dot(comparison, vec4<i32>(1));
      output.outColor = vec4<f32>(f32(cascade)/4.0, 0.0, 0.0, 1.0);
      return output;
    }
  `;

  const bgl: GPUBindGroupLayoutEntry = {
    binding: 0,
    buffer: { type: 'uniform' },
    visibility: GPUShaderStage.VERTEX
  };
  const bindGroupLayout = device.createBindGroupLayout({
    entries: [bgl]
  });

  const layout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
  const pipeline = device.createRenderPipeline({
    layout: layout,
    vertex: {
      module: device.createShaderModule({
        code: vertexShaderWgslCode
      }),
      entryPoint: 'main'
    },
    fragment: {
      module: device.createShaderModule({
        code: fragmentShaderWgslCode
      }),
      entryPoint: 'main',
      targets: [
        {
          format: swapChainFormat
        }
      ]
    },
    primitive: {
      topology: 'triangle-strip',
      cullMode: 'none'
    }
  });

  const ubo = device.createBuffer({
    size: 128,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });

  const bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    // layout: device.createBindGroupLayout({ entries: [{ binding: 0, buffer: {}, visibility: 1}] }),
    entries: [
      {
        binding: 0,
        resource: {
          buffer: ubo,
          offset: 0,
          size: 128
        }
      }
    ]
  });

  const v = new Float32Array([
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.2, 0.2, 0, 1
  ]);
  device.queue.writeBuffer(ubo, 0, v);

  (function frame() {
    if (canvas.clientWidth !== canvas.width || canvas.clientHeight !== canvas.height) {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    }
    requestAnimationFrame(frame);
    const commandEncoder = device.createCommandEncoder();
    const textureView = context.getCurrentTexture().createView();

    const renderPassDescriptor: GPURenderPassDescriptor = {
      colorAttachments: [
        {
          view: textureView,
          loadOp: 'clear',
          clearValue: [0.5, 0.5, 0.5, 1],
          storeOp: 'store'
        }
      ]
    };

    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);

    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.draw(4, 2, 0, 0);

    passEncoder.end();

    device.queue.submit([commandEncoder.finish()]);
  })();
})();
