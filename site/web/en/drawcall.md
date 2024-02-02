# Rendering

To render primitives, it's essential to first establish vertex inputs, Shaders, Shader-associated binding groups, and rendering states before initiating a render call.

## Vertex inputs

Vertex inputs consist of a set of vertex buffers (index buffer).

```javascript

// Creates vertex buffers
const vbPos = device.createVertexBuffer('position_f32x3', new Float32Array(vertices));
const vbTexCoord = device.createVertexBuffer('tex0_f32x2', new Float32Array(normals));
const ib = device.createIndexBuffer(new Uint16Array(indices));

// Vertex input layout
const vertexLayout = device.createVertexLayout({
  // Vertex buffers
  vertexBuffers: [{
    // Vertex buffer object
    buffer: vbPos,
    // Vertex buffer step mode, can be 'vertex' or 'instance', default is 'vertex'
    stepMode: 'vertex'
  }, {
    buffer: vbTexCoord,
    stepMode: 'vertex'    
  }],
  // Index buffer if needed
  indexBuffer: ib
});

// Set as current vertex input layout
device.setVertexLayout(vertexLayout);

```

## Shader and bind groups

When rendering, it's necessary to set the current Shader. For more information, see:[Shader](/en/shader)

```javascript

// Create shader
const program = device.buildRenderProgram({
  vertex(pb){
    // VertexShader
  },
  fragment(pb){
    // Fragment
  }
});

// Set as current shader
device.setProgram(program);

```

Along with setting the current Shader, it's also required to configure the current binding group to supply constants to the Shader.

```javascript

// Creates binding groups
const bindGroup0 = device.createBindGroup(program.bindGroupLayouts[0]);
const bindGroup1 = device.createBindGroup(program.bindGroupLayouts[1]);

// Set uniform values
bindGroup0.setValue('a', VALUE);
bindGroup1.setTexture('t', TEXTURE);

// Set current shader and binding groups before rendering
device.setProgram(program);
device.setBindGroup(0, bindGroup0);
device.setBindGroup(1, bindGroup1);

```

## Rendering states

Before rendering, setting the current rendering state might be needed. For more details, refer to [Rendering states](/en/renderstate)

```javascript

// Creates rendering states object
const renderStates = device.createRenderStateSet();
renderStates.useDepthState().enableTest(false).enableWrite(false);

// Set as current rendering states object before rendering
device.setRenderStates(renderStates);

```

## Viewport and Scissor

Setting the viewport and scissor rectangle may be required before rendering.

**In native WebGPU, the viewport's origin is at the top-left corner of the screen. However, to standardize the viewport origin between WebGL and WebGPU devices, we've adjusted it to be at the bottom-left corner of the screen.**

```javascript

// Set viewport
device.setViewport([X, Y, WIDTH, HEIGHT]);
// Set scissor
device.setScissor([X, Y, WIDTH, HEIGHT]);

// Sets the size of the viewport to match the current framebuffer (if the framebuffer size changes, the viewport size automatically follows)
device.setViewport(null);
// Set the scissor rectangle to match the size of the current framebuffer (if the framebuffer size changes, the scissor rectangle size will automatically follow)
device.setScissor(null);

// Get current viewport
const viewport = device.getViewport();
// Get current scissor rectangle
const scissor = device.getScissor();

```

## Draw call

Once all the necessary states are set, we can initiate the rendering call.

```javascript

// Clear frame buffer
// parameter 1: RGBA for clearing color buffers，if null, color buffers will not been cleared.
// parameter 2: Clear value of depth buffer，if null, depth buffer will not be cleared
// parameter 3: Clear value of stencil buffer，if null, stencil buffer will no be cleared
device.clearFrameBuffer(new Vector4(0, 0, 1, 1), 1, 0);

// Draw triangles
// parameter 1：vertex topologic, possible values: 'triangle-list','triangle-strip','triangle-fan','line-list','line-strip','point-list'
// parameter 2: Start index
// parameter 3: Number of indices
device.draw('triangle-list', 0, 100);

// Draw instances of triangles
// parameter 1：vertex topologic, possible values: 'triangle-list','triangle-strip','triangle-fan','line-list','line-strip','point-list'
// parameter 2: Start index
// parameter 3: Number of indices
// parameter 4: How many instances should be rendered
device.drawInstanced('triangle-list', 0, 100, 20);

// The device provides a simple text rendering function with no typesetting function

// Sets the current text rendering font, the default value is '12px arial'
device.setFont('16px arial');
// Rendering text
// parameter 1: text content
// parameter 2：pixel offset related to the left of screen
// parameter 3: pixel offset related to the top of screen
// parameter 4: color of the text (CSS value)
device.drawText('Hello world!', 100, 100, '#ffffff');
```

## Frame buffer

The [Framebuffer](/doc/markdown/./device.framebuffer) is our rendering destination, which can be the screen or a custom Framebuffer we define.

```javascript

// Create a 2D texture to use as a color buffer
const colorTex = device.createTexture2D('rgba8unorm', 256, 256);
// Create a 2D depth texture to use as a depth buffer
const depthTex = device.createTexture2D('d24s8', 256, 256);
// Creates frame buffer
// parameter 1: A list of color buffer textures
// parameter 2: Depth buffer texture, which can be null
const framebuffer = device.createFrameBuffer([colorTex], depthTex);
// Set as current frame buffer
device.setFramebuffer(framebuffer);

// Set screen as current frame buffer
device.setFramebuffer(null);

// Get current frame buffer
const framebuffer = device.getFramebuffer();

```

**Changing the current Framebuffer will reset the current viewport and scissor rectangle.**

## Save states

```javascript

// This method saves all current render states, including:
// current shader
// current binding groups
// current vertex input layout
// current frame buffer
// current viewport
// current scissor rectangle
// current rendering states
device.pushDeviceStates();

// Restore the last saved render state
device.popDeviceStates();

```

## GPU Compute

For GPU computations, it's only required to set up the compute Shader and the related binding groups, then call [Device.compute()](/doc/markdown/./device.abstractdevice.compute), which is available only on WebGPU devices.

```javascript

// Set compute shader and binding groups
device.setProgram(computeProgram);
device.setBindGroup(0, bindGroup);
// Dispatches the compute task
// parameter 0：Thread group X-dimension length
// parameter 1：Thread group Y-dimension length
// parameter 2：Thread group Z-dimension length
device.compute(8, 1, 1);

```
