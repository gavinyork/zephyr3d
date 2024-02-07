# Buffer

A buffer refers to a space allocated from GPU memory, commonly used to store vertices, indices, uniform constants, or for UAV read and write operations. We can create various types of buffers using the [Device](/doc/markdown/./device.abstractdevice)'s relevant interfaces.

## Vertex Buffer

Vertex Buffer is designed to store vertex data such as position, normals, texture coordinates, etc. You can create a vertex buffer using the [Device.createVertexBuffer()](/doc/markdown/./device.abstractdevice.createvertexbuffer) and [Device.createInterleavedVertexBuffer()](/doc/markdown/./ device.abstractdevice.createInterleavedVertexBuffer) methods.

```javascript

// Create a VertexBuffer to store vertex positions in the format of 3 floats per vertex.
const vbPos = device.createVertexBuffer('position_f32x3', new Float32Array(vertices));
// Create a VertexBuffer for storing normals, in the format of 3 floats per vertex.
const vbNorm = device.createVertexBuffer('normal_f32x3', new Float32Array(normals));
// Create a VertexBuffer to store texture coordinates in the format of 2 floats per vertex.
const vbTexCoord = device.createVertexBuffer('tex0_f32x2', new Float32Array(normals));

```

The first parameter of this method is our predefined vertex data type, which includes the data's purpose and format. For more details, refer to the [documentation](/doc/markdown/./device.vertexattribformat) on vertex formats.

The following code demonstrates how to create an interleaved vertex buffer:

```javascript

// Create a VertexBuffer that is stored interleaved with location and texture coordinates
const vb = device.createInterleavedVertexBuffer(['position_f32x3','tex0_f32x2'], new Float32Array(vertices));

```

## Index Buffer

An Index Buffer is used to index vertex data positions from the Vertex Buffer when rendering primitives, helping to optimize the processing efficiency of vertices.

```javascript

// Create a 16-bit index buffer
const ib16 = device.createIndexBuffer(new Uint16Array(indices));

// Create a 32-bit index buffer
const ib32 = device.createIndexBuffer(new Uint32Array(indices));

```

## Uniform buffer

Uniform Buffer is a type of buffer used to store uniform data that can be accessed by shaders in a GPU.

```javascript

const program = device.buildRenderProgram({
  vertex(pb){
    // ...
  },
  fragment(pb){
    // defines an uniform buffer named myBuffer
    this.myBuffer = pb.vec4[100]().uniformBuffer(0);
    // ...
  }
});
// Gets the structure type of the buffer
const bufferType = program.getBindingInfo('myBuffer').type;
// Creates uniform buffer based on that structure type
const ub = device.createStructuredBuffer(bufferType, { usage: 'uniform' });

```

## Storage Buffer

Storage Buffer is a type of buffer that provides shaders with read and write access to a buffer of structured data.

```javascript

const program = device.buildRenderProgram({
  vertex(pb){
    // ...
  },
  fragment(pb){
    // defines a storage buffer named myBuffer
    this.myBuffer = pb.vec4[100]().storageBuffer(0);
    // ...
  }
});
// Gets the structure type of the buffer
const bufferType = shaderProgram.getBindingInfo('myBuffer').type;

// Creates storage buffer based on that structure type
const ub = device.createStructuredBuffer(bufferType, { usage: 'storage' });

```

## Update Buffer Data

We use [GPUDataBuffer.bufferSubData](/doc/markdown/./device.gpudatabuffer.buffersubdata) to update part or all of the data in the buffer.

```javascript

const buf = device.createStructuredBuffer(bufferType, { usage: 'uniform' });
const data = new Float32Array([0, 1, 2, 3]);
// Write 4 floats where the buffer is offset by 100 bytes
buf.bufferSubData(100, data);

```

## Dispose Buffer

Each buffer requires memory allocation from the GPU. To prevent excessive consumption of GPU memory, buffers that are no longer in use should be released promptly.

```javascript

// Call the dispose() method of the buffer object to free the buffer
// The freed buffer can no longer be used
buffer.dispose();

```
