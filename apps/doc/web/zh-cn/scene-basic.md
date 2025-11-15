# 基本框架

## 创建应用

  首先我们必需创建一个应用对象。

  **注意，使用@zephyr3d/scene框架的项目必需有且只有一个应用实例!**

  当一个应用被创建以后，可以使用 [getApp](/doc/markdown/./scene.getapp) 全局函数来获取全局应用实例。

  ```javascript
  import { Application } from '@zephyr3d/scene';
  import { backendWebGL2 } from '@zephyr3d/backend-webgl';

  // 创建一个应用实例
  const myApp = new Application({
    // 使用WebGL2作为渲染后端
    // 目前我们支持三种渲染设备：WebGL, WebGL2和WebGPU。
    backend: backendWebGL2,
    // Canvas元素用于渲染
    canvas: document.querySelector('#my-canvas')
  });

  // 等待渲染设备就绪
  myApp.ready().then(function(){
    // 应用已经初始化完成，开始渲染循环
    myApp.run();
  });

  ```

  以上是一个最基本的应用框架，它创建应用，然后初始化渲染环境并开始主循环，目前我们并未在帧循环内做任何事情，所以只能看到一个黑窗口。下面我们来添加一些渲染代码。

## 添加帧事件响应

  帧事件会在渲染循环的每帧触发一次，我们可以在该事件处理函数中执行更新和渲染。

  ```javascript

  // 引入Vector4
  import { Vector4 } from '@zephyr3d/base';
  import { Application } from '@zephyr3d/scene';
  import { backendWebGL2 } from '@zephyr3d/backend-webgl';

  // 创建一个应用实例
  const myApp = new Application({
    // 使用WebGL2作为渲染后端
    // 目前我们支持三种渲染设备：WebGL, WebGL2和WebGPU。
    backend: backendWebGL2,
    // Canvas元素用于渲染
    canvas: document.querySelector('#my-canvas')
  });

  // 等待渲染设备就绪
  myApp.ready().then(function(){
    // 添加帧事件处理
    myApp.on('tick', function(){
      // device是渲染设备，我们调用其clearFrameBuffer方法把屏幕清为绿色
      // 其中，第一个参数为清除颜色缓冲区的RGBA颜色，第二个参数指定深度缓冲区的清除值，第三个指定模板缓冲区的清除值。
      myApp.device.clearFrameBuffer(new Vector4(0, 1, 0, 1), 1, 0);
    });
    // 应用已经初始化完成，开始渲染循环
    myApp.run();
  });

  ```

  现在，你应该可以看到一个绿色的屏幕。

  <div class="showcase" case="tut-0"></div>

## 响应输入

  我们可以通过捕获事件来响应用户输入。

  ```javascript

  // 引入Vector4
  import { Vector4 } from '@zephyr3d/base';
  import { Application } from '@zephyr3d/scene';
  import { backendWebGL2 } from '@zephyr3d/backend-webgl';

  // 创建一个应用实例
  const myApp = new Application({
    // 使用WebGL2作为渲染后端
    // 目前我们支持三种渲染设备：WebGL, WebGL2和WebGPU。
    backend: backendWebGL2,
    // Canvas元素用于渲染
    canvas: document.querySelector('#my-canvas')
  });

  // 等待渲染设备就绪
  myApp.ready().then(function () {
    let str = '';
    // 设置字体
    myApp.device.setFont('16px arial');
    // 添加帧事件处理
    myApp.on('tick', function () {
      // device是渲染设备，我们调用其clearFrameBuffer方法把屏幕清为绿色
      // 其中，第一个参数为清除颜色缓冲区的RGBA颜色，第二个参数指定深度缓冲区的清除值，第三个指定模板缓冲区的清除值。
      myApp.device.clearFrameBuffer(new Vector4(0, 0, 0, 1), 1, 0);
      // 调用device的drawText方法在屏幕上渲染文字
      myApp.device.drawText(str, 30, 30, '#ffff00');
    });
    // Pointer移动事件
    myApp.on('pointermove', function (ev) {
      // 更新显示内容
      str = `X:${ev.offsetX.toFixed()} Y:${ev.offsetY.toFixed()}`;
    });
    // 应用已经初始化完成，开始渲染循环
    myApp.run();
  });

  ```

  <div class="showcase" case="tut-1"></div>


  目前，画布会绑定以下事件并通过App透传给用户：

  - pointerdown
  - pointerup
  - pointermove
  - pointercancel
  - keydown
  - keyup
  - keypress
  - drag
  - dragenter
  - dragleave
  - dragstart
  - dragend
  - dragover
  - drop
  - wheel
  - compositionstart
  - compositionupdate
  - compositionend

  很多情况下，我们处理输入事件的时候是有优先级的，例如在某些场合下，我们需要先处理UI部分的输入，在UI系统未处理该输入的情况下，我们才触发场景的点击。针对这种情况，
  我们也提供了中间件模式。你可以依次注册事件处理函数作为中间件，当有用户输入的时候，中间件将会按照注册次序被依次调用，直到某个中间件函数返回true为止。如果所有中间件
  都返回false，则通过```Application.on```注册的事件回调将被调用。下面是一个使用中间件的例子：

  ```javascript

  // 优先响应用户界面交互事件
  getInput().use(function(evt, type){
    return processGUIEvent(evt, type);
  });

  // 如果用户界面未处理此事件(processGUIEvent方法返回false)则轮到此中间件，
  getInput().use(function(evt, type){
    if(type === 'pointerdown') {
      onPointerDown();
      return true;
    } else {
      return false;
    }
  });

  ```

## 渲染场景

  下面我们演示如何渲染一个场景。

  首先我们需要通过构造一个Scene对象来创建一个场景。场景是一个包含了若干需要渲染的元素的容器。
  另外我们还需要一个摄像机对象来执行对场景的渲染。我们可以通过构造PerspectiveCamera对象来创建一个透视相机或通过构造一个OrthoCamera来创建一个正交相机。
  最后我们调用引擎实例的setRenderable方法将场景设置为活动渲染对象。

  ```javascript

  import { Application, PerspectiveCamera } from '@zephyr3d/scene';
  import { backendWebGL2 } from '@zephyr3d/backend-webgl';
  import { Scene } from '@zephyr3d/scene';

  // 创建一个应用实例
  const myApp = new Application({
    // 使用WebGL2作为渲染后端
    // 目前我们支持三种渲染设备：WebGL, WebGL2和WebGPU。
    backend: backendWebGL2,
    // Canvas元素用于渲染
    canvas: document.querySelector('#my-canvas')
  });

  // 等待渲染设备就绪
  myApp.ready().then(function () {
    // 创建场景
    const scene = new Scene();
    // 创建主相机
    scene.mainCamera = new PerspectiveCamera(scene, Math.PI/3, 1, 100);
    // 将场景设置为第0层的活动渲染对象
    getEngine().setRenderable(scene, 0);
    // 应用已经初始化完成，开始渲染循环
    myApp.run();
  });

  ```

  通过以上代码，我们渲染了一个空的场景，效果如下：

  <div class="showcase" case="tut-2"></div>

## 摄像机控制

  我们通过给摄像机设置控制器来实现对摄像机的控制。目前我们提供了两个控制器：
  
  - FPSCameraController

    用于实现FPS射击游戏模式的摄像机控制，可以通过WSAD键和鼠标移动和转动摄像机。
  
  - OrbitCameraController

    用于实现围绕目标点旋转和伸缩的摄像机控制。


  下面我们为刚才的代码添加一个摄像机控制器：

  ```javascript

  import { Application, PerspectiveCamera, OrbitCameraController } from '@zephyr3d/scene';
  
  // ...

  // 创建相机
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI/3, 1, 100);

  // 添加代码，设置摄像机控制器
  scene.mainCamera.controller = new OrbitCameraController();

  // camera.handleEvent可作为输入事件中间件，允许摄像机控制器接受交互
  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  //...

  ```  

  以下是运行效果, 尝试用鼠标左键控制摄像机的观察角度：

  <div class="showcase" case="tut-4"></div>
