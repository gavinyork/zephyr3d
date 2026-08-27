# 网格

网格(Mesh)是由顶点数据和材质构成的渲染对象。

我们使用Mesh对象来表示一个网格。构造一个mesh对象需要三个参数scene, primitive和material，其中scene是场景对象，网格构造后将会添加到该场景。
primitive为网格的顶点数据。可以使用内置的SphereShape,BoxShape,PlaneShape,CylinderShape来创建球体，盒子，平面和圆柱形顶点数据，也可手动填充。
material为该网格的材质。通用材质有 unlit(非光照)、Lambert/Blinn 和 PBR 几种，本页的示例都用它们。
除此之外还有若干专用材质：角色渲染用的[皮肤材质](zh-cn/material-skin.md)、头发、眼睛，
卡通渲染用的 MToon，地形和植被材质，以及用编辑器蓝图自定义的材质。

## 使用预定义网格

系统内置了几种常见的网格顶点数据，例如盒子，球体，圆柱，平面等。

以下代码创建了一个球体网格并且赋予一个Lambert材质.

在场景中我们添加了一个方向光以便照亮该网格。关于光源和光照我们将在后续章节详细介绍。

<<< @/../src/tut-5/main.js{js}

关键的三步在第 28–31 行：创建 `LambertMaterial`、设置 `albedoColor`、把图元和材质交给
`new Mesh(scene, primitive, material)`。

新建的网格默认位于世界坐标系原点，所以第 35 行把相机放在 `(0, 0, 4)` 并看向原点。
`lookAt(eye, target, up)` 定义在 `SceneNode` 上，相机和普通节点都能用——第 25 行给方向光
定朝向用的也是它。

<div class="showcase" case="tut-5"></div>

下面我们给球体一个PBR材质并添加贴图。

贴图通过 [ResourceManager.fetchTexture()](/doc/markdown/./scene.resourcemanager.fetchtexture)
加载，它接受一个 URL 和一个可选的
[选项对象](/doc/markdown/./scene.texturefetchoptions)，返回 Promise。加载过的资源会被缓存，
同一路径再次请求不会重复加载。

<<< @/../src/tut-6/main.js{27-47 js}

`PBRMetallicRoughnessMaterial` 用金属度/粗糙度工作流描述表面：`metallic` 越高越像金属，
`roughness` 越高高光越发散。

**注意第 40–42 行法线贴图传了 `linearColorSpace: true`，而颜色贴图没有。** 这不是可选的风格问题：
颜色贴图存的是 sRGB 编码的颜色，需要转换到线性空间参与光照计算；而法线贴图、金属粗糙度贴图、
遮罩、高度图存的是**数据**而不是颜色，做 sRGB 转换会得到错误结果。漏掉这个选项通常表现为
凹凸方向和强度不对。

<div class="showcase" case="tut-6"></div>

## 加载现有材质

如果使用编辑器工作流，可以在编辑器中创建自定义材质（`.zmtl`），然后调用
[ResourceManager.fetchMaterial()](/doc/markdown/./scene.resourcemanager.fetchmaterial) 加载。

<<< @/../src/tut-50/main.js{js}

和前面几个例子相比多了第 18–21 行的 `runtimeOptions.VFS`。**加载编辑器产出的资产必须先配好 VFS**，
因为 `fetchMaterial('/assets/earth.zmtl')` 里的路径是 VFS 路径而不是 URL——上例用 `HttpFS`
把它映射到一个 HTTP 根目录。VFS 的其他实现（内存、IndexedDB）见[虚拟文件系统](zh-cn/vfs.md)。

注意材质是异步加载的，所以 `new Mesh(...)` 写在 `then()` 里（第 34 行）。

<div class="showcase" case="tut-50"></div>

## 手动填充网格顶点

为了手动填充顶点数据，我们需要创建顶点缓冲区，索引缓冲区设备对象并提交顶点和索引数据。

下面我们通过手动填充顶点数据创建一个无光照的三角形网格：

<<< @/../src/tut-9/main.js{24-44 js}

要点：

- 顶点缓冲区的**用途由名字决定**，而不是靠额外参数指定。`'position_f32x3'` 表示位置、三个 float32；
  `'diffuse_u8normx4'` 表示顶点色、四个归一化 uint8。名字里编码了语义和数据格式，引擎据此
  自动生成顶点布局。
- 用顶点色需要显式打开 `material.vertexColor = true`（第 28 行），否则该属性不参与着色。
- 三角形只有一个面，绕序不对就会被背面剔除掉、看起来什么都没渲染。这里直接
  `material.cullMode = 'none'`（第 26 行）绕开这个问题。

<div class="showcase" case="tut-9"></div>

## 加载模型

实际项目里最常用的建网格方式是加载现有模型。这里有两条路径：

1. **加载预制体（推荐）**：先在编辑器里导入模型并保存为 zephyr3d 预制体（`.zprefab`），
   运行时用 `instantiatePrefab()` 加载。
2. **直接加载源模型**：安装 `@zephyr3d/loaders` 并注册对应导入器，用 `fetchModel()` 直接读
   glTF/GLB/FBX 等文件。

推荐第一条：`@zephyr3d/scene` 核心不含任何模型格式的解析代码，走预制体可以不把这些导入器打进
产品包；而且预制体保存的是序列化后的引擎对象图，你在编辑器里改过的材质、节点属性、脚本都会
一并恢复。需要在运行时加载用户提供的任意模型文件时才用第二条。两者的取舍详见
[资源加载与模型导入](zh-cn/asset-loading.md)。

下面是加载预制体的例子：

<<< @/../src/tut-10/main.js{js}

`instantiatePrefab(parent, path)` 把预制体实例化到指定父节点下，返回实例化出来的根节点，
可以像操作普通节点那样调整它的变换（第 32 行）。

<div class="showcase" case="tut-10"></div>
