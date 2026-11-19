# 放入模型与材质

接着[第一个应用](zh-cn/first-app.md)的空场景，往里放东西。

## 网格 = 图元 + 材质

场景里可见的物体是 `Mesh`，由两部分组成：

- **图元（primitive）** —— 顶点数据，决定形状。
- **材质（material）** —— 决定表面如何响应光照。

内置了几种常用图元：`BoxShape`、`SphereShape`、`PlaneShape`、`CylinderShape`、`TorusShape`。

<<< @/../src/tut-5/main.js{22-36 js}

注意第 24–25 行加了一个方向光。**大多数材质在没有光源时是全黑的**，所以放物体的同时
要记得打光。

新建的网格默认在世界坐标原点，所以把相机放到 `(0, 0, 4)` 并 `lookAt()` 原点。
`lookAt(eye, target, up)` 定义在 `SceneNode` 上，相机和普通节点（包括这里的方向光）都能用。

<div class="showcase" case="tut-5"></div>

## 选择材质

引擎内置了多种材质，入门阶段先认这三个：

| 材质 | 用途 |
| --- | --- |
| `UnlitMaterial` | 不受光照，用于纯色标记、辅助显示、特效 |
| `LambertMaterial` | 简单漫反射，开销低，适合风格化或性能敏感场景 |
| `PBRMetallicRoughnessMaterial` | 基于物理的渲染，写实效果的默认选择 |

引擎还提供皮肤、头发、眼睛、卡通（MToon）等专用材质，以及用编辑器蓝图自定义的材质，
这些等熟悉基础之后再看。

## 加贴图

PBR 材质配上贴图才能出效果：

<<< @/../src/tut-6/main.js{27-45 js}

`metallic` 越高越像金属，`roughness` 越高高光越发散。

**注意法线贴图传了 `linearColorSpace: true`，而颜色贴图没有。** 这不是风格问题：颜色贴图存的是
sRGB 编码的颜色，需要转换到线性空间参与光照；而法线贴图、金属粗糙度贴图、遮罩、高度图存的是
**数据**而不是颜色，做 sRGB 转换会得到错误结果。漏掉这个选项通常表现为凹凸方向和强度不对。

贴图加载是异步的，`fetchTexture()` 返回 Promise。已加载过的资源会被缓存，同一路径不会重复请求。

<div class="showcase" case="tut-6"></div>

## 加载模型

实际项目里的物体大多来自模型文件，而不是内置图元。这里有两条路径：

1. **加载预制体（推荐）** —— 先在编辑器里导入模型并保存为 `.zprefab`，运行时用
   `instantiatePrefab()` 加载。
2. **直接加载源模型** —— 装 `@zephyr3d/loaders` 并注册导入器，用 `fetchModel()` 读
   glTF/GLB/FBX。

推荐第一条：`@zephyr3d/scene` 核心不含任何模型格式的解析代码，走预制体可以不把导入器
打进产品包；预制体保存的是序列化后的引擎对象图，你在编辑器里改过的材质、节点属性、脚本
都会一并恢复。需要在运行时加载用户上传的任意模型时才用第二条。详见
[资源加载与模型导入](zh-cn/asset-loading.md)。

<<< @/../src/tut-10/main.js{js}

`instantiatePrefab()` 的路径是 VFS 路径而不是 URL。VFS 由创建应用时的 `runtimeOptions.VFS`
指定，不传时默认是 `new HttpFS('./')`，也就是把 VFS 根目录映射到**当前页面所在的目录**：页面在
`https://example.com/game/index.html` 时，`/assets/Duck.zprefab` 会请求
`https://example.com/game/assets/Duck.zprefab`。资产和页面部署在一起（编辑器的 **Build Project**
就是这样输出的）时，用默认值即可，什么都不用配。

上例是另一种情况：示例页面在文档站点上，资产放在另一个域名的 CDN 上，所以第 16–19 行把 VFS 换成
指向 CDN 目录的 `HttpFS`。这里不能只把 URL 写进 `instantiatePrefab()`：预制体内部用
`/assets/Duck_mesh_0.zmsh` 这样的 VFS 路径引用网格和材质，这些路径总是相对于 VFS 根目录解析，
所以 VFS 根目录必须对应资产所在的项目根目录。跨域加载时，资产服务器还要允许跨域请求（CORS）。

<div class="showcase" case="tut-10"></div>

### 同时从多个域名加载

资源分布在几个服务器上时，以一个 `HttpFS` 为根，再把其他服务器**挂载**到根下的某个路径：

```javascript
const vfs = new HttpFS('./'); // 页面所在目录：脚本、配置等
// 编辑器产出的资产放在 CDN 上。挂载在 /assets，预制体内部的 /assets/... 引用也会走 CDN
await vfs.mount('/assets', new HttpFS('https://cdn.example.com/game/assets'));
// 另一个服务器上的贴图，用 /textures/... 访问
await vfs.mount('/textures', new HttpFS('https://images.example.com/textures'));
```

读取时按最长的挂载路径匹配，匹配到的部分换成被挂载文件系统里的路径，没有匹配的路径由根文件系统
处理。把这个 `vfs` 传给 `runtimeOptions.VFS`，或者在运行中对 `getEngine().VFS` 调用 `mount()`。

另外两种不经过挂载的方式：

- 贴图、GLB 模型、JSON 这类**自包含**的单个文件，可以直接把 `https://` 开头的完整 URL 传给
  资源接口，引擎会原样请求这个 URL，不经过 VFS 根目录。
- 加载接口的选项里有 `overrideVFS`，可以只让这一次加载使用另一个文件系统。

这两种方式都不适合预制体和场景：它们内部引用的其他资产仍按 VFS 路径从当前 VFS 加载。详见
[资源加载](zh-cn/asset-loading.md)和[虚拟文件系统](zh-cn/vfs.md#文件系统挂载与组合)。

## 组织场景层级

节点以树形结构组织，每个节点的变换都相对于父节点。移动父节点，所有后代跟着动：

```javascript
child.parent = parent;
child.position.setXYZ(0, 2, 0);   // 相对 parent 向上 2 个单位
```

这套机制以及遍历、查找、显示隐藏、包围盒等内容见[场景图及节点](zh-cn/scene-graph.md)。

## 下一步

- [加上阴影与后处理](zh-cn/first-polish.md) —— 让画面像样起来
