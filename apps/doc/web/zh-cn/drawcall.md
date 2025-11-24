# 渲染图元

渲染图元需要先设定顶点输入，Shader，Shader相关的绑定组和渲染状态，然后发起渲染调用。

## 顶点输入

顶点输入由一组顶点缓冲(索引缓冲)构成。

```javascript

// 创建顶点缓冲区
const vbPos = device.createVertexBuffer('position_f32x3', new Float32Array(vertices));
const vbTexCoord = device.createVertexBuffer('tex0_f32x2', new Float32Array(normals));
const ib = device.createIndexBuffer(new Uint16Array(indices));

// VertexLayout用做顶点输入
const vertexLayout = device.createVertexLayout({
  // 顶点缓冲区列表
  vertexBuffers: [{
    // VertexBuffer对象
    buffer: vbPos,
    // 用途 默认值为'vertex'，如果使用GPU实例化渲染，值可能为'instance'
    stepMode: 'vertex'
  }, {
    buffer: vbTexCoord,
    stepMode: 'vertex'    
  }],
  // 索引缓冲区，如果没有可省略
  indexBuffer: ib
});

// 渲染时需设置为当前的顶点输入
device.setVertexLayout(vertexLayout);

```

## Shader和绑定组

渲染时需设置为当前Shader。参见：[创建Shader](/zh-cn/shader)

```javascript

// 创建Shader
const program = device.buildRenderProgram({
  vertex(pb){
    // VertexShader
  },
  fragment(pb){
    // Fragment
  }
});

// 设置为当前Shader
device.setProgram(program);

```

设置当前Shader还需要设置当前的绑定组，用于提供常量给Shader。

```javascript

// 为Shader创建绑定组
const bindGroup0 = device.createBindGroup(program.bindGroupLayouts[0]);
const bindGroup1 = device.createBindGroup(program.bindGroupLayouts[1]);

// 绑定组设置Shader绑定资源
bindGroup0.setValue('a', VALUE);
bindGroup1.setTexture('t', TEXTURE);

// 渲染前设置Shader和绑定组
device.setProgram(program);
device.setBindGroup(0, bindGroup0);
device.setBindGroup(1, bindGroup1);

```

## 渲染状态

渲染前可能需要设置当前的渲染状态。参见[渲染状态](/zh-cn/renderstate)

```javascript

// 创建渲染状态对象
const renderStates = device.createRenderStateSet();
renderStates.useDepthState().enableTest(false).enableWrite(false);

// 渲染前设置为当前渲染状态
device.setRenderStates(renderStates);

```

## 视口和剪切

渲染前我们可能需要设置视口(viewport)和剪切矩形(scissor)。

**原生WebGPU使用屏幕左上角为视口原点，我们统一WebGL和WebGPU设备的视口原点在屏幕左下角。**

```javascript

// 设置视口
device.setViewport([X, Y, WIDTH, HEIGHT]);
// 设置剪裁矩形
device.setScissor([X, Y, WIDTH, HEIGHT]);

// 设置视口符合当前帧缓冲的大小（如果帧缓冲大小发生改变，视口大小自动跟随)
device.setViewport(null);
// 设置剪裁矩形符合当前帧缓冲的大小（如果帧缓冲大小发生改变，剪裁矩形大小自动跟随)
device.setScissor(null);

// 获取当前视口
const viewport = device.getViewport();
// 获取当前剪裁矩形
const scissor = device.getScissor();

```

## 渲染调用

当各种必要状态都设置好以后就可以发起渲染调用。

```javascript

// 清除帧缓冲
// 参数1: 清除色RGBA，为null则不清除颜色缓冲
// 参数2: 深度值，为null则不清除深度缓冲
// 参数3: 模板值，为null则不清除模板缓冲
device.clearFrameBuffer(new Vector4(0, 0, 1, 1), 1, 0);

// 渲染三角列表
// 参数1：顶点拓扑类型
// 参数2: 索引缓冲区的起始索引
// 参数3: 索引数
device.draw('triangle-list', 0, 100);

// GPU实例化渲染三角列表
// 参数1：顶点拓扑类型
// 参数2: 索引缓冲区的起始索引
// 参数3: 索引数
// 参数4: 渲染实例个数
device.drawInstanced('triangle-list', 0, 100, 20);

// 设备提供了一个简易的渲染文字功能，无排版功能
// 设置当前文字渲染字体，默认值为'12px arial'
device.setFont('16px arial');
// 参数1: 文字内容
// 参数2：相对屏幕左侧偏移
// 参数3: 相对屏幕上方偏移
// 参数4: 文字颜色(CSS颜色表示)
device.drawText('Hello world!', 100, 100, '#ffffff');
```

## 帧缓冲

[帧缓冲(Framebuffer)](/doc/markdown/./device.framebuffer)是我们渲染的目标地点，可以是屏幕，也可以是我们自定义的帧缓冲。

```javascript

// 创建一个2D纹理用作颜色缓冲区
const colorTex = device.createTexture2D('rgba8unorm', 256, 256);
// 创建一个2D深度纹理用作深度缓冲区
const depthTex = device.createTexture2D('d24s8', 256, 256);
// 创建帧缓冲
// 参数1: 颜色缓冲区纹理列表
// 参数2: 深度缓冲区纹理，可以为null
const framebuffer = device.createFrameBuffer([colorTex], depthTex);
// 设置为当前帧缓冲
device.setFramebuffer(framebuffer);

// 设置帧缓冲为屏幕
device.setFramebuffer(null);

// 获取当前帧缓冲
const framebuffer = device.getFramebuffer();

```

**如果更改当前帧缓冲，当前视口和剪裁矩形会重置**

## 状态保存

```javascript

// 该方法保存所有当前渲染状态，包括：
// 当前Shader
// 当前BindGroup
// 当前顶点输入
// 当前帧缓冲
// 当前视口
// 当前剪裁矩形
// 当前渲染状态
device.pushDeviceStates();

// 恢复上一次保存的渲染状态
device.popDeviceStates();

```

## GPU计算

GPU计算只需要设置计算Shader以及相关的绑定组然后调用[Device.compute()](/doc/markdown/./device.abstractdevice.compute)，仅WebGPU设备可用。

```javascript

// 设置计算Shader以及绑定组
device.setProgram(computeProgram);
device.setBindGroup(0, bindGroup);
// 发起该计算任务
// 参数0：线程组X维度长度
// 参数1: 线程组Y维度长度
// 参数2: 线程组Z维度长度
device.compute(8, 1, 1);

```
