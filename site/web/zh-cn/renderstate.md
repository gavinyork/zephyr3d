## 渲染状态

我们使用[RenderStateSet](/doc/markdown/./device.renderstateset)接口来管理渲染状态。

```javascript

// 创建渲染状态集合
const renderStateSet = device.createRenderStateSet();

// 自定义AlphaBlending状态，如不调用，使用默认值
const blendingState = renderStateSet.useBlendingState();
// 设置AlphaBlend参数
blendingState.enable(true).setBlendFunc('one', 'one');

// 自定义DepthBuffer状态
const depthState = renderStateSet.useDepthState();
depthState.enableTest(false).enableWrite(false);

// 渲染前设置为当前渲染状态
device.setRenderStates(renderStateSet);

```

注意：

我们不支持设置顶点旋转方向(CW/CCW)状态，如需反转，调用[Device.reverseVertexWindingOrder()](/doc/markdown/./device.abstractdevice.reversevertexwindingorder)。
