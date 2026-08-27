# 渲染图与自定义渲染 Pass

引擎的场景渲染由一张**渲染图**（frame graph）驱动：每帧先声明这一帧需要哪些 pass、
各自读写哪些资源，再由执行器统一编译、分配纹理并按依赖顺序执行。

这套机制是插入自定义渲染 pass 的官方扩展点。**如果你只是要用内置的后处理效果，
不需要读本页**——`camera.bloom`、`camera.SSR` 这类属性已经封装好了，见
[后处理](zh-cn/posteffect-intro.md)。

需要本页的典型场景：

- 插入一个自定义 pass（描边、体积光、自定义 GBuffer 处理等）；
- 想读取渲染中间产物（深度、场景颜色、Hi-Z）做自己的计算；
- 要实现时序效果，需要跨帧保留的历史资源。

## 管线与模块

渲染图不是手写的，而是由一条**管线**（`RenderPipeline`）里的一串**模块**
（`RenderModule`）各自贡献 pass 组装出来的。

默认管线由 `createForwardPlusPipeline()` 构造，包含 13 个模块，按此顺序：

| # | 模块 `type` | 职责 |
| --- | --- | --- |
| 1 | `SkyUpdate` | 更新天空/大气 LUT |
| 2 | `ClusterLights` | 聚簇光照的光源分配 |
| 3 | `GPUPicking` | GPU 拾取 |
| 4 | `ShadowMaps` | 渲染各光源的 shadow map |
| 5 | `DepthPrepass` | 深度预渲染 |
| 6 | `ShadowMaskPass` | 屏幕空间阴影遮罩 |
| 7 | `TransmissionDepthForSSR` | 透射物体深度（供 SSR 用） |
| 8 | `HiZ` | 构建 Hi-Z 层级深度 |
| 9 | `SSSProfile` | 次表面散射 profile |
| 10 | `SceneColorGrab` | 抓取场景颜色（供折射用） |
| 11 | `LightPass` | 主光照 pass |
| 12 | `SkyPass` | 天空与雾 |
| 13 | `CompositeTail` | 后处理链与最终合成 |

这些模块可以从 `ForwardPlusModules` 取到，例如 `ForwardPlusModules.LightPass`。

## 给相机换一条管线

`camera.renderPipeline` 为 `null`（默认）时使用共享的默认管线。赋一条自己的管线可以
只改这一个相机的渲染方式：

```javascript
import { createForwardPlusPipeline, ForwardPlusModules } from '@zephyr3d/scene';

camera.renderPipeline = createForwardPlusPipeline().insertAfter(
  ForwardPlusModules.SkyPass,
  myOutlineModule
);
```

::: warning 不要直接改共享默认管线
`getDefaultForwardPlusPipeline()` 返回的是**全局共享实例**，改动它会影响所有使用默认管线的
相机。要定制就用 `createForwardPlusPipeline()` 新建一条，或对现有管线调用 `clone()`。
:::

管线的编辑方法：`append`、`prepend`、`insertBefore`、`insertAfter`、`replace`、`remove`、
`get`、`has`、`clone`。

::: tip 锚点建议传模块对象而不是字符串
这些方法的锚点参数接受字符串或模块对象，字符串是按模块的 `type` 匹配的。
注意 `ForwardPlusModules` 的键名和 `type` 并不总是一致——例如
`ForwardPlusModules.ShadowMask` 的 `type` 是 `'ShadowMaskPass'`，
写 `insertAfter('ShadowMask', ...)` 会抛出「no module with type」。
**直接传 `ForwardPlusModules.ShadowMask` 这个对象即可避免这个问题。**
:::

几条需要注意的规则：

- **`type` 在一条管线内必须唯一**，插入重名模块会抛错。
- `remove()` 和 `replace()` 只会**分离**模块而不销毁它，需要释放时显式调用
  `pipeline.disposeModule(module)`。`pipeline.dispose()` 会分离并销毁它拥有的全部模块。
- 已 `dispose()` 的管线不能再编辑。
- `clone()` 遇到定义了 `attach`/`detach`/`dispose` 却没有实现 `clone()` 的模块会**抛错**，
  因为无法安全复制有状态的模块。无状态模块（三个生命周期回调都没有）会按引用共享，这是安全的。

## 写一个模块

`RenderModule` 接口的必需成员只有三个：

```typescript
interface RenderModule {
  // 稳定标识，管线编辑方法用它定位模块
  readonly type: string;
  // 每帧决定本模块这一帧是否参与
  prepare(context): { enabled: boolean; requirements?: FrameResourceRequirements };
  // 往渲染图里添加 pass 并发布产物
  setup(context): void;
}
```

可选成员：`reads` / `writes`（声明依赖，见下节）、`attach` / `detach`（被管线接管与移出时的
回调）、`dispose`（释放自有资源）、`clone`（供 `RenderPipeline.clone()` 使用）。

`prepare()` 返回 `{ enabled: false }` 时该模块这一帧不贡献任何 pass。把「这一帧要不要做」
的判断放在 `prepare()` 而不是 `setup()` 里，是因为模块排序在 `setup()` 之前就要完成。

## 声明依赖

模块之间不直接互相引用，而是通过**黑板**（blackboard）上的命名资源通信：

```javascript
const myModule = {
  type: 'MyOutline',
  // 我需要读场景颜色和线性深度
  reads: [
    { resource: FrameResources.SceneColor, version: 'current' },
    { resource: FrameResources.LinearDepth }
  ],
  // 我会写回场景颜色
  writes: [FrameResources.SceneColor],
  prepare: () => ({ enabled: true }),
  setup(fg) {
    // ...
  }
};
```

`reads` 的每一项可以指定：

- `resource` —— 黑板资源键；
- `version` —— `'current'`（默认，读当前版本）或 `'final'`（读最终版本，**这会让模块被重新排序**
  到该资源的最后一个写入者之后）；
- `optional` —— 默认 false。为 true 时允许该资源没有启用的写入者。

**这些声明会影响模块的实际执行顺序**，未必等于你在管线里排的顺序。所以不要依赖authored
顺序来保证依赖关系，要靠 `reads`/`writes` 表达。

## 上下文对象

`prepare()` 和 `setup()` 收到的上下文提供了构建这一帧所需的一切：

| 字段 | 用途 |
| --- | --- |
| `graph` | 正在构建的渲染图，用它 `addPass()` |
| `ctx` | 帧的 `DrawContext`：相机、场景、设备、`renderWidth` / `renderHeight` 等 |
| `blackboard` | 命名资源注册表，模块之间靠它传递 handle |
| `renderQueue` | 本帧裁剪好的渲染队列 |
| `history` | 跨帧历史资源管理器，**可能为 null** |
| `ordering` | 纯副作用 pass 的排序 token 链 |
| `backbuffer` | 导入的后缓冲 handle（图的最终汇点） |
| `finalFramebuffer` | 本帧输出的外部 framebuffer，渲染到屏幕时为 null |
| `options` | 由场景/相机状态推导出的特性开关（Forward+ 专有） |

黑板的接口：`get(key)` 取资源（不存在时返回 `null`）、`expect(key)` 取必需资源（不存在时抛错）、
`has(key)` 判断存在、`set(key, handle)` 发布资源。

内置资源键定义在 `FrameResources` 里，常用的有 `SceneColor`、`LinearDepth`、
`SceneDepthAttachment`、`SceneNormal`、`SceneRoughness`、`MotionVector`、`HiZ`、
`ShadowMask`、`PresentedColor`，以及次表面散射相关的若干项。

其中两个值得留意：

- **`PresentedColor`** —— 最终呈现的颜色，**最后一次注册的会成为图的汇点**。
- **`SceneColorNoFog`** —— 合成高度雾之前的场景颜色。屏幕空间 pass 应该读它而不是
  `SceneColor`，因为相机到命中点的雾和这些 pass 积分的路径无关，读进去会给命中点染上雾色
  并在下一帧反馈。只在场景确实有雾且有消费方时才会发布。

> 类型名 `RenderModuleContext` 已废弃，改名为 `ForwardPlusModuleContext`；
> 与管线无关的通用基础接口是 `RenderContext`。

## 添加 pass

在 `setup()` 里通过 `graph.addPass()` 添加 pass。构建回调拿到的 `builder` 提供：

| 方法 | 作用 |
| --- | --- |
| `read(handle)` | 声明读取某资源 |
| `write(handle, options?)` | 写入并返回新版本的 handle |
| `createTexture(desc)` | 创建本 pass 产出的瞬时纹理 |
| `createFramebuffer(desc)` | 创建图管理的 framebuffer，并自动推导附件依赖 |
| `createToken(name?)` | 创建纯排序用的逻辑 token（无资源依赖） |
| `sideEffect()` | 标记本 pass 不可被裁剪 |
| `setExecute(fn)` | 设置执行回调 |
| `addSubpass(name, fn)` | 添加有序子 pass（与 `setExecute` 互斥） |

`createTexture()` 的描述对象里，`format` 是必需的，其余可选：`label`、`allocationKey`
（跨帧复用同一张池化纹理的标识）、`sizeMode`（默认 `'backbuffer-relative'`）、
`width` / `height`（在相对模式下是缩放系数，默认 1）、`mipLevels`、`arrayLayers`。

**没有被任何输出依赖的 pass 会被裁剪掉。** 如果你的 pass 只有副作用（比如写到外部纹理），
要调用 `builder.sideEffect()` 阻止裁剪。

::: warning 不能又采样又渲染同一张纹理
`builder.write(handle)` 返回的是**新的版本 handle**，但物理上仍然是同一张纹理。所以
「读 sceneColor、处理、写回 sceneColor」这种写法会让驱动报 feedback loop 并丢弃绘制。
需要基于某张纹理做处理时，用 `createTexture()` 单独分配输出，再把新 handle 发布回黑板。
:::

执行回调收到的上下文用来把 handle 换成真实的设备对象：

```javascript
builder.setExecute((rgCtx) => {
  const tex = rgCtx.getTexture(someHandle);
  const fb = rgCtx.getFramebuffer(fbHandle);
  // 在这里发起实际的绘制
});
```

## 一个完整的模块

下面是一个完整可运行的例子：一个读取线性深度、检测深度不连续处、给场景颜色叠加描边的模块。
模块本体（声明、`prepare`、`setup`）如下：

<<< @/../src/tut-70/main.js{113-186 js}

要点：

- `reads` / `writes` 声明了依赖，图据此决定本模块的执行位置；
- `LinearDepth` 虽然由深度预渲染稳定发布，这里仍然用 `get()` 而不是 `expect()` 取，
  拿不到时直接返回——模块降级比抛异常更好；
- **输出用 `createTexture()` 单独分配，而不是 `builder.write(sceneColor)` 原地写。**
  一个 pass 不能同时采样和渲染同一张纹理：`write()` 给出的是新的版本 handle，
  但物理上仍是同一张纹理，驱动会报 feedback loop。这是写自定义 pass 最容易踩的坑；
- 最后把新 handle `set()` 回黑板，`SkyPass` 和 `CompositeTail` 才会读到描边后的结果。

装到相机上：

<<< @/../src/tut-70/main.js{217-233 js}

这里插在 `LightPass` 之后，所以描边发生在天空和雾合成之前。改插到 `SkyPass` 之后就会
叠在天空之上。位置取决于你要读的是哪个阶段的画面。

把 `renderPipeline` 设为 `null` 即可回到不含该模块的默认管线，示例用这一点做开关对比：

<div class="showcase" case="tut-70"></div>

## 在自定义 pass 里渲染场景几何体

如果自定义 pass 需要渲染场景中的物体（而不只是做全屏处理），用 `createSceneRenderer()`
而不是自己遍历场景图——它会正确处理裁剪、渲染队列、材质与光照绑定。

它在**执行阶段**创建，同时需要帧的 `DrawContext` 和当前 pass 的执行上下文：

```javascript
builder.setExecute((rgCtx) => {
  const sr = createSceneRenderer(ctx, rgCtx);
  const fb = rgCtx.getFramebuffer(myFramebufferHandle);

  // 裁剪出一个 pass 作用域内的渲染队列，可选地过滤 drawable
  const queue = sr.cull(ctx.camera, (drawable) => drawable !== someExcludedMesh);

  // 渲染整个队列，或只渲染其中一部分
  sr.renderScene(fb, queue);
});
```

可用的渲染方法：`renderScene()`（不透明 + 透明）、`renderOpaque()`、`renderTransparent()`、
`renderDepth()`（线性深度）。

`cull()` 产出的队列绑定在当前 pass 上，pass 结束即释放。如果队列需要跨帧复用（例如内容不变
的静态几何体），用 `createPersistentQueue()` 自行管理生命周期；也可以用 `createQueue()`
手工构建队列。

## 时序效果的历史资源

需要访问上一帧结果的效果（TAA、SSR、SSGI 都属于此类）不能用普通的瞬时纹理，因为那些纹理在
帧结束后就回到池里了。跨帧保留的资源由 `HistoryResourceManager` 管理，模块通过上下文的
`history` 字段取到：

```javascript
setup(fg) {
  const history = fg.history;   // 可能为 null
  if (!history) {
    return;                      // 该相机没有启用历史资源
  }
  // 导入上一帧的纹理，尺寸/格式不兼容时返回 null（例如窗口刚刚 resize）
  const prevHandle = history.importPreviousIfCompatible(
    fg.graph,
    'myEffectHistory',
    desc,
    { width: fg.ctx.renderWidth, height: fg.ctx.renderHeight }
  );
  // prevHandle 为 null 时要走「没有历史」的分支，不能假定它一定存在
}
```

`history` 为 `null`、以及 `importPreviousIfCompatible()` 返回 `null` 这两种情况都必须处理——
**分辨率变化、相机切换、首帧都会让历史失效**，这是时序效果最容易出 bug 的地方。

内置的历史资源名定义在 `RGHistoryResources` 里（`taaColor`、`ssrReflect`、`ssgiSceneColor` 等），
自定义效果应当用自己的名字，避免和它们冲突。

## 相关

- [后处理](zh-cn/posteffect-intro.md) —— 内置效果，多数情况下够用
- [自定义材质](zh-cn/user-material.md) —— 只改材质着色而不动管线
- [多视口渲染](zh-cn/multi-views.md) —— 一个相机多次渲染
