# 缓冲区

缓冲区是指从GPU内存中分配的一块空间，一般用于存储顶点，索引，uniform常量或用于UAV读写等。

我们可以利用[Device](/doc/markdown/./device.abstractdevice)的相关接口创建各种类型的Buffer。


## 顶点缓冲区

顶点缓冲区(Vertex Buffer)用于存储顶点数据例如位置，法线，纹理坐标等。

使用[Device.createVertexBuffer()](/doc/markdown/./device.abstractdevice.createvertexbuffer)方法和[Device.createInterleavedVertexBuffer()](/doc/markdown/./device.abstractdevice.createinterleavedvertexbuffer)方法可以创建顶点缓冲区。


```javascript

// 创建用于存储顶点位置的VertexBuffer，格式为每顶点3个float。
const vbPos = device.createVertexBuffer('position_f32x3', new Float32Array(vertices));
// 创建用于存储法线的VertexBuffer，格式为每顶点3个float。
const vbNorm = device.createVertexBuffer('normal_f32x3', new Float32Array(normals));
// 创建用于存储纹理坐标的VertexBuffer，格式为每顶点2个float。
const vbTexCoord = device.createVertexBuffer('tex0_f32x2', new Float32Array(normals));

```

该方法的第一个参数是我们预定义的顶点数据类型，包含数据的用途和格式。参见文档[顶点格式](/doc/markdown/./device.vertexattribformat)

下面的代码演示了如何创建交错的顶点缓冲区：

```javascript

// 创建位置和纹理坐标交错存储的VertexBuffer
const vb = device.createInterleavedVertexBuffer(['position_f32x3','tex0_f32x2'], new Float32Array(vertices));

```

## 索引缓冲区

索引缓冲区(Index Buffer)用于在渲染图元时从顶点缓冲区索引顶点数据的位置，有助于优化顶点的处理效率。

```javascript

// 创建16位索引缓冲区
const ib16 = device.createIndexBuffer(new Uint16Array(indices));

// 创建32位索引缓冲区
const ib32 = device.createIndexBuffer(new Uint32Array(indices));

```

## 常量缓冲区

常量缓冲区(Uniform Buffer)用于给Shader提供常量数据。

```javascript

// 假定我们要为shaderProgram中声明的名为myBuffer的常量缓冲区创建Buffer，首先获取缓冲区的结构类型
const bufferType = shaderProgram.getBindingInfo('myBuffer').type;

// 根据该结构类型创建缓冲区
const ub = device.createStructuredBuffer(bufferType, { usage: 'uniform' });

```

## 存储缓冲区

存储缓冲区(Storage Buffer)允许着色器对结构化数据缓冲区进行读写操作。

```javascript

// 假定我们要为shaderProgram中声明的名为myBuffer的UAV缓冲区创建Buffer，首先获取缓冲区的结构类型
const bufferType = shaderProgram.getBindingInfo('myBuffer').type;

// 根据该结构类型创建缓冲区
const ub = device.createStructuredBuffer(bufferType, { usage: 'storage' });

```

## 更新缓冲区数据

我们调用[GPUDataBuffer.bufferSubData](/doc/markdown/./device.gpudatabuffer.buffersubdata)更新缓冲区的部分数据或全部数据


```javascript

const buf = device.createStructuredBuffer(bufferType, { usage: 'uniform' });
const data = new Float32Array([0, 1, 2, 3]);
// 缓冲区偏移100字节的位置写入4个float
buf.bufferSubData(100, data);

```

## 释放缓冲区

每个缓冲区需要从GPU分配内存，为了使GPU内存不被大量消耗，应当及时释放不再使用的缓冲区。

```javascript

// 调用缓冲区对象的dispose()方法来释放缓冲区
// 释放后的缓冲区不能再继续使用
buffer.dispose();

```
