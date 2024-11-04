# 场景拾取

场景拾取是指在虚拟场景中,通过鼠标或其他输入设备选择场景中物体的技术，对于实现场景交互非常重要。引擎提供了射线检测和颜色检测两种拾取方案。

## 射线检测

射线检测是一种CPU上执行的拾取算法，原理是根据鼠标或其他输入设备的位置在世界坐标系(或摄像机坐标系)生成一条射线，然后将射线与场景中的物体求交来得到被拾取的物体。

以下代码演示了如何使用射线检测拾取场景中的物体。

```javascript

// 假设x, y是相对于视口左上角的屏幕坐标，拾取该位置的物体

// 构造一条从摄像机原点穿过该屏幕坐标的射线
const ray = camera.constructRay(x, y);
// 对场景进行射线检测
const pickResult = scene.raycast(ray);
// 返回拾取到的场景节点以及相交距离和交点，否则返回null
if (pickResult) {
  console.log(`节点: ${pickResult.target.node}`);
  console.log(`距离: ${pickResult.dist}`);
  console.log(`交点: ${pickResult.point}`);
}

```

射线检测是通过与物体的包围盒求交来进行拾取，它是不精确的，尤其对于不规则形状物体，
透明物体以及动画变形的物体，可能无法拾取到正确的物体，这种情况下，可以采用颜色拾取
的方法。

<div class="showcase" case="tut-47"></div>

## 颜色拾取

颜色拾取是利用GPU进行像素级拾取的方案。原理是通过使用不同的颜色渲染物体到1x1纹理，
然后回读该纹理根据颜色判断拾取到了哪个物体。WebGL，WebGL2和WebGPU设备均支持颜
色拾取，但是对于WebGL，回读纹理是一个阻塞的操作，可能导致卡顿，因此我们推荐在
WebGL2或WebGPU设备上使用颜色拾取。在我们的实现中，进行颜色拾取必须进行一次场景
渲染。

以下代码演示了如何使用颜色拾取。

```javascript

// 告诉摄像机在渲染的同时执行拾取
camera.enablePicking = true;

// 鼠标移动时更新拾取位置
app.device.canvas.addEventListener('pointermove', (ev) => {
  camera.pickPosX = ev.offsetX;
  camera.pickPosY = ev.offsetY;
});

// 渲染之后可以获取拾取结果
// 注意，对于WebGL2和WebGPU设备，拾取是一个异步过程，因此本次获取的实际上是上一帧的拾取结果
app.on('tick', () => {
  // 首先渲染场景
  camera.render(scene);
  // 然后获取拾取结果，如果未拾取到任何物体则返回null.
  const pickResult = camera.pickResult;
  if (pickResult) {
    // drawable是拾取到的渲染对象
    console.log(pickResult.drawable);
    // node是拾取到的节点
    console.log(pickResult.target.node);
  }
});

```

<div class="showcase" case="tut-48"></div>

使用上述方法，每次获取的是上一帧的拾取结果，因此只适用于每帧进行拾取的场景，不适用于单次拾取，
例如每次点击鼠标时进行一次拾取。在这种情况下，可以异步获取拾取结果。下面是一个示例：

```javascript

// 告诉摄像机在渲染的同时执行拾取
camera.enablePicking = true;

// 鼠标移动时更新拾取位置
app.device.canvas.addEventListener('pointermove', (ev) => {
  camera.pickPosX = ev.offsetX;
  camera.pickPosY = ev.offsetY;
});

app.on('tick', () => {
  // 首先渲染场景
  camera.render(scene);
  // 异步获取本次拾取结果，如果未拾取到任何物体则返回null.
  camera.pickResultAsync.then((pickResult) => {
    if (pickResult) {
      // drawable是拾取到的渲染对象
      console.log(pickResult.drawable);
      // node是拾取到的节点
      console.log(pickResult.target.node);
    }
  });
});

```
