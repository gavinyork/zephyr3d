# 基本框架

## 创建应用

首先我们必需创建一个应用对象。

**注意，使用@zephyr3d/scene框架的项目必需有且只有一个应用实例!**

当一个应用被创建以后，可以使用 [getApp](/doc/markdown/./scene.getapp) 全局函数来获取全局应用实例。

```javascript
import { Application } from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(function () {
  myApp.run();
});
```

构造 `Application` 时的两个必要选项：

- `backend`：渲染后端。目前可选 `backendWebGL`、`backendWebGL2`（均来自 `@zephyr3d/backend-webgl`）
  和 `backendWebGPU`（来自 `@zephyr3d/backend-webgpu`）。
- `canvas`：用于渲染的画布元素。

`ready()` 返回一个 Promise，渲染设备初始化完成后 resolve；`run()` 启动主循环。上面这段代码
只是把渲染环境跑起来，帧循环里什么也没做，所以你会看到一个黑窗口。下面往循环里加内容。

## 添加帧事件响应

`tick` 事件在渲染循环的每帧触发一次，更新和渲染都写在它的处理函数里。

<<< @/../src/tut-0/main.js{js}

关键是第 20 行的 `clearFrameBuffer()`，它把整个画面清成绿色。三个参数依次是：

- 颜色缓冲区的清除颜色（`Vector4`，RGBA）；
- 深度缓冲区的清除值——**用 `@zephyr3d/base` 导出的 `DEPTH_CLEAR_VALUE` 常量，不要硬编码 0 或 1**。
  引擎支持 reverse-Z 深度约定，近平面对应的深度值会随约定改变，这个常量保证两种约定下都正确；
- 模板缓冲区的清除值。

传 `null` 可以跳过对应缓冲区的清除。

现在你应该可以看到一个绿色的屏幕。

<div class="showcase" case="tut-0"></div>

## 响应输入

用户输入通过和 `tick` 相同的方式监听。下面这个例子跟踪鼠标位置并把坐标画在屏幕上：

<<< @/../src/tut-1/main.js{js}

几个要点：

- 第 29 行的 `pointermove` 处理函数只更新 `str` 变量，真正的绘制发生在第 26 行的 `tick` 里。
  输入处理和渲染分开是有意的：事件可能一帧内触发多次，而绘制每帧只需要做一次。
- 第 18 行把 `clearColor` 提到循环外复用。每帧 `new Vector4()` 会产生不必要的垃圾回收压力，
  在数学对象上尤其值得注意。
- `drawText()` 需要先用 `setFont()` 设置字体（第 20 行）。

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
getInput().use(function(evt, type) {
  return processGUIEvent(evt, type);
});

// 如果用户界面未处理此事件(processGUIEvent方法返回false)则轮到此中间件，
getInput().use(function(evt, type) {
  if(type === 'pointerdown') {
    onPointerDown();
    return true;
  } else {
    return false;
  }
});

```

## 渲染场景

渲染一个场景需要三样东西：装载渲染元素的 `Scene`、决定从哪个视角渲染的相机，以及把场景注册为
活动渲染对象。

<<< @/../src/tut-2/main.js{js}

对照第 17、19、21 行：

- `new Scene()` 创建场景容器。
- `new PerspectiveCamera(scene, ...)` 创建透视相机。参数依次是**所属场景、垂直视场角（弧度）、
  近裁剪面、远裁剪面**；宽高比是可选的第 5 个参数，但相机默认开启 `autoAspect`，会自动跟随
  渲染目标的宽高比，通常不需要传。需要正交投影时改用 `OrthoCamera`。
- `getEngine().setRenderable(scene, 0)` 把场景设为第 0 层的活动渲染对象。这一步不做的话，
  即使场景和相机都建好了，画面上也不会有任何东西。

注意这里的相机构造出来没有赋值给任何变量，场景却仍然渲染了：**当场景还没有主相机时，
新构造的相机会自动成为该场景的 `mainCamera`**。后面需要操作相机时（比如设置控制器）
仍然建议显式接住它，像下一节那样写成 `scene.mainCamera = new PerspectiveCamera(...)`。

以上代码渲染了一个空场景，效果如下：

<div class="showcase" case="tut-2"></div>

## 摄像机控制

我们通过给摄像机设置控制器来实现对摄像机的控制。目前我们提供了两个控制器：

- FPSCameraController

  用于实现FPS射击游戏模式的摄像机控制，可以通过WSAD键和鼠标移动和转动摄像机。

- OrbitCameraController

  用于实现围绕目标点旋转和伸缩的摄像机控制。


下面我们为刚才的代码添加一个摄像机控制器：

<<< @/../src/tut-4/main.js{js}

相比上一节只多了两行（第 22 和 24 行）：

- `scene.mainCamera.controller = new OrbitCameraController({ center: ... })` 给相机装上控制器。
  `center` 指定环绕的中心点。
- `getInput().use(scene.mainCamera.handleEvent, scene.mainCamera)` 把控制器接入输入系统。
  **只设 `controller` 而不注册这一行，控制器收不到输入，相机不会响应鼠标。** 第二个参数是
  调用 `handleEvent` 时的 `this`。

以下是运行效果, 尝试用鼠标左键控制摄像机的观察角度：

<div class="showcase" case="tut-4"></div>
