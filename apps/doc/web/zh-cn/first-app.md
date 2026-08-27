# 第一个应用

本页从空项目开始，跑出一个能看到东西的页面。假设你已经[装好了包](zh-cn/installation.md)，
并且用 Vite 之类的构建工具。

## HTML 骨架

引擎需要一个 canvas 元素来渲染。让它铺满窗口：

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>My Zephyr3d app</title>
    <style>
      * { margin: 0; padding: 0; }
      html, body { width: 100vw; height: 100vh; }
      canvas { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <canvas id="my-canvas"></canvas>
    <script type="module" src="./main.js"></script>
  </body>
</html>
```

canvas 的 CSS 尺寸就是渲染分辨率的依据，引擎会自动跟随它的变化，你不需要手动处理
窗口 resize。

## 创建应用

一个 Zephyr3d 项目**有且只有一个** `Application` 实例。

<<< @/../src/tut-0/main.js{js}

三个步骤：

1. `new Application({ backend, canvas })` —— 指定后端和画布。
2. `myApp.ready()` —— 返回 Promise，渲染设备初始化完成后 resolve。所有引擎调用都要在这之后。
3. `myApp.run()` —— 启动主循环。

主循环每帧触发一次 `tick` 事件，更新和渲染写在它的回调里。上例每帧把画面清成绿色，
所以你会看到一整片绿色。

<div class="showcase" case="tut-0"></div>

关于 `clearFrameBuffer()` 的深度参数：**用 `@zephyr3d/base` 导出的 `DEPTH_CLEAR_VALUE`
常量，不要硬编码 0 或 1**。引擎支持 reverse-Z 深度约定，近平面对应的深度值会随约定改变，
这个常量在两种约定下都正确，详见[深度约定](zh-cn/reverse-z.md)。

应用创建后，任何地方都可以用 `getApp()`、`getEngine()`、`getDevice()`、`getInput()`
这几个全局函数取到实例，不必到处传递引用。

## 选择渲染后端

上例固定用了 WebGL2。实际项目通常希望优先使用 WebGPU，不支持时回退：

```javascript
import { backendWebGL1, backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';

async function selectBackend() {
  if (await backendWebGPU.supported()) {
    return backendWebGPU;
  }
  if (await backendWebGL2.supported()) {
    return backendWebGL2;
  }
  return backendWebGL1;
}

const myApp = new Application({
  backend: await selectBackend(),
  canvas: document.querySelector('#my-canvas')
});
```

后端差异需要留意：WebGPU 支持计算着色器，WebGL 完全不支持；部分特性（如 ABuffer OIT、
DOM 阴影）也只在 WebGPU 上可用。引擎在能力不足时通常会静默回退到替代实现，
所以**跨后端开发时要在目标设备上实测**，不能只看代码没报错。

## 渲染一个场景

清屏还算不上 3D。要渲染场景需要三样东西：装载渲染对象的 `Scene`、决定视角的相机，
以及把场景注册为活动渲染对象。

<<< @/../src/tut-2/main.js{16-21 js}

- `new Scene()` 创建场景容器。
- `new PerspectiveCamera(scene, fovY, near, far)` 创建透视相机。宽高比是可选的第 5 个参数，
  默认开启 `autoAspect` 会自动跟随渲染目标，通常不用传。需要正交投影时用 `OrthoCamera`。
- `getEngine().setRenderable(scene, 0)` 把场景设为第 0 层的活动渲染对象。
  **不做这一步，即使场景和相机都建好了画面上也不会有任何东西。**

上例的相机没有赋值给变量却依然生效，因为**场景还没有主相机时，新构造的相机会自动成为
该场景的 `mainCamera`**。后面要操作相机时仍建议显式接住它。

<div class="showcase" case="tut-2"></div>

## 让相机能操作

现在场景是空的、相机也不能动。加一个轨道控制器：

<<< @/../src/tut-4/main.js{20-24 js}

两行都必要：设 `controller` 只是装上控制器，还要用 `getInput().use(...)` 把它接入输入系统，
控制器才收得到事件。第二个参数是调用 `handleEvent` 时的 `this`。

除此之外，控制器还需要**每帧更新状态**才能工作——它要靠这个时机做惯性、阻尼、平滑跟随之类的
逐帧计算。更新入口是 `camera.updateController()`：

```javascript
myApp.on('tick', function () {
  scene.mainCamera.updateController();
});
```

上面的示例里没有这行，是因为**场景的 `mainCamera` 会被自动更新**：场景每帧的更新流程中
会调用 `mainCamera.updateController()`。所以只用一个主相机时不必手动调。

但下面两种情况必须自己调，否则控制器装了也不起作用：

- 相机**不是**场景的 `mainCamera`（例如多视口渲染里的副相机）；
- 你绕过 `setRenderable()`，自己在 `tick` 里调用 `camera.render(scene)` 驱动渲染，
  且该相机不是 `mainCamera`。

反过来，**每个相机每帧只应更新一次**。引擎不保证同一帧内重复调用是安全的，所以已经被自动
更新的主相机不要在 `tick` 里再手动调一次。

<div class="showcase" case="tut-4"></div>

试着用鼠标左键拖动、滚轮缩放。

## 下一步

到这里你已经有一个可交互的空场景了。接着往里放东西：

- [放入模型与材质](zh-cn/first-scene.md) —— 创建网格、加载模型、打光
- [加上阴影与后处理](zh-cn/first-polish.md) —— 让画面像样起来
