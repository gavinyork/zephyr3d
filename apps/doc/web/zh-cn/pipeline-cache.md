# 管线预编译与资源预加载

一次绘制第一次用到某种新的 shader 与渲染状态组合时，浏览器要先编译管线（PSO），这一帧会一直等它。材质和效果多的场景里，表现为新东西第一次出现在屏幕上时卡顿。加载场景还有第二个问题：资源没拉取完之前，谁也不知道还剩多少，进度条动不起来。

Zephyr3D 用提前录制的两份记录解决这两个问题：

| 记录 | 文件 | 用途 |
| --- | --- | --- |
| 管线缓存 | `/pipeline-cache.json` | 在需要它们的绘制之前预先编译录制下来的管线 |
| 预加载列表 | 每个场景旁的 `<场景>.zscn.zpreload` | 先拉取场景的资源，总量已知，进度条准确 |

编辑器负责录制，构建产物自动使用。直接基于 Scene API 编写的应用也可以通过 `getEngine().pipelineCache` 和 `getEngine().assetPreloader` 使用同样的文件。

> 本页代码为片段示意，省略了 import 与应用初始化。

## 在编辑器中录制

**录制管线。** 场景视图工具栏上的录制按钮（在播放按钮旁边）会在新标签页中运行项目，并把用到的每个管线录制到项目根目录的 `/pipeline-cache.json`。录制期间右上角显示红色标记。文件每隔几秒写入一次，标签页隐藏时也会写入，录完直接关闭标签页即可。

只有画出来的东西才会被录制，所以要把重要的内容都走一遍：到每个区域去，触发各种效果，切换应用会切换的材质和设置。每次录制都在已有记录上追加，多次短录制与一次长录制效果相同。

文件里每个后端各存一份记录。用 WebGPU 录制不会录下 WebGL2 需要的管线，构建产物可能回退到 WebGL2 时，要在两个后端各录一次。

**预热相机。** 玩家较晚才能到达的地方容易漏录。在场景层级中右键点击一台非当前激活的相机，勾选 `Pipeline Warmup Camera`。录制期间，场景第一次显示时，它的每台预热相机会在后台渲染几帧，把看到的内容也录下来，屏幕上显示的画面不受影响。

**预加载列表。** 录制期间，每个被加载的场景还会把它拉取的资源记录到自己的预加载列表里。构建项目时，编辑器会把每个场景再加载一遍，记录它启动时需要的资源，并在列表中写入每个文件的大小，使加载进度按字节加权。

**设置。** `Project Settings → Precompile Recorded Pipelines`（默认开启）决定构建产物是否带上管线缓存并在启动时编译。`Project → Clear Pipeline Cache...` 删除全部记录，例如在材质大改之后，让下一次录制从头开始。

## 构建产物的启动过程

编辑器构建的项目按以下顺序启动：

1. 并行编译录制的管线、预加载启动场景的资源。内置的启动画面把两者合成一个进度条显示。
2. 加载启动场景，此时它的资源已在缓存中；随后释放预加载持有的资源。
3. 渲染第一帧，期间编译没有被录制到的管线，然后隐藏启动画面。

缺少管线缓存或预加载列表都不算错误：此时构建产物按需编译管线，场景加载时没有已知的总量。

## 在代码中使用记录

在自己的启动代码里做同样的事，配合自己的加载界面：

```ts
const engine = getEngine();
const progress = new LoadingProgress(myLoadingScreen);

const loading: Promise<unknown>[] = [];
if (await engine.VFS.exists(PIPELINE_CACHE_FILE)) {
  const pipelines = engine.pipelineCache.createTask();
  progress.trackPipelines(pipelines, 1);
  loading.push(pipelines.run());
}
const assets = engine.assetPreloader.createTask(['/assets/main.zscn.zpreload']);
progress.trackPreload(assets, 2);
loading.push(assets.run());
await Promise.all(loading);

const scene = await engine.loadSceneFromFile('/assets/main.zscn');
assets.release();
// ... make the scene renderable and run the application
await progress.finish();
```

`LoadingProgress`、`PIPELINE_CACHE_FILE` 和各个任务类来自 `@zephyr3d/scene`。

- **`LoadingProgress`** 把带权重的多个阶段合成一个只进不退的进度条。`myLoadingScreen` 实现 `LoadingScreen` 接口：必须有 `setProgress(fraction)`，可选 `setMessage(text)`、`showError(message)` 和 `hide()`。加载界面应写在页面标记里，这样在任何脚本加载之前就能显示。`addStage()` 可以添加自己的阶段，例如加载场景。
- **`pipelineCache.createTask()`** 默认读取 `/pipeline-cache.json`；也可以传入其他路径或已经读出的记录。其他后端的记录会被跳过。`run({ priority: 'background' })` 每次只编译少量管线并分摊到多帧，适合在当前关卡运行时准备下一关；默认的 `'foreground'` 在加载界面后以最快速度编译。
- **`assetPreloader.createTask()`** 通过资源管理器拉取记录的每个资源，之后加载场景时直接命中缓存。任务会持有加载的资源直到调用 `release()`；场景加载完成后调用它，没有被其他地方引用的资源随即释放。

## 检查覆盖情况

`getEngine().pipelineCache.getStats()` 报告管线是如何产生的：

| 字段 | 含义 |
| --- | --- |
| `precompiled` | 预先编译的管线数 |
| `precompiledUsed` | 其中被绘制或计算调度用到的 |
| `onDemand` | 绘制时才编译、造成卡顿的管线数 |
| `onDemandPrograms` | 最近按需编译的管线所属的程序 |

运行中 `onDemand` 持续增长，说明录制有遗漏：把那一段重新录一遍，或在那里加一台预热相机。`precompiledUsed` 远小于 `precompiled`，说明缓存里有应用已不再使用的管线；清空后重新录制。

## 不用编辑器录制

录制由设备本身完成。`getDevice().getPipelineRecorder()` 返回录制器（设备没有可录制的管线时为 null）；在第一帧之前调用 `begin()`，渲染之后用 `export(tag)` 得到要保存的 `PipelineCacheData`。`pushTag()`/`popTag()` 用于分组，例如每个关卡一个标签。录制必须在第一帧之前开始：render bundle 重放绘制时不会再次请求管线，只在更早录好的 bundle 里用到的管线会被漏掉。

## 限制与坑

- 记录只对录制时的 shader 有效。升级引擎或修改材质后 shader 会变，旧记录不再匹配：它们会被跳过，或白白编译、只耗时间不起作用。发布前重新录制。
- WebGPU 记录会写明它依赖的设备特性。设备缺少其中某项时会打印警告，依赖该特性的管线可能编译失败；对应的绘制仍能工作，只是改为按需编译。
- WebGL2 下缓存编译的是 shader 程序；其余状态设置开销很小，不做缓存。
- 带有无法保存的选项（例如回调或自定义 VFS）的拉取不会被记录进预加载列表，这些资源在场景请求时才加载。
- 预加载的资源在 `release()` 之前一直占用内存。很久以前录制的列表可能包含场景已不再使用的资源，它们只浪费加载时间，在释放时被回收。
