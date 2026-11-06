# 网格 SDF 与全局 SDF

符号距离场（SDF）把网格表面表示成到最近表面的带符号距离。它为水体交互、软阴影、DDGI 和其他空间查询提供统一的几何表示。SDF 系统默认关闭，且全局 SDF 的 GPU 构建仅支持 WebGPU。

## 启用场景 SDF

```ts
scene.sdf.enabled = true;
scene.sdf.streamRadius = 256;
scene.sdf.uploadBudget = 4 * 1024 * 1024;
```

场景开启后，引擎按摄像机距离流式加载网格的 `.zsdf` 资产，并将近处字段放入共享 atlas。资产通常由编辑器的 **Mesh Settings > Bake SDF** 生成。没有烘焙字段的网格不会自动参与；代码创建的图元可以通过 `scene.sdf.bakeField()` 或 `scene.sdf.setField()` 提供运行时字段。

代码创建的 `Primitive` 可以在运行时烘焙；这是一次性的 CPU 工作，不要每帧调用：

```ts
await scene.sdf.bakeField(primitive, {
  resolutionScale: 1,
  unitScale: 1,
  twoSided: false
});
// 如果已在其他地方生成 MeshSDFData，也可直接绑定：
scene.sdf.setField(primitive, sdfData);
```

## 在编辑器中烘焙

导入模型时勾选 **Bake Distance Fields**，会为本次导入的每个网格使用默认参数生成 `.zsdf`，导入进度中显示 `Baking distance fields...`。该选项只应用于本次导入的新网格。

对已有 `.zmsh` 网格，在 Content Browser 中右键选择 **Mesh Settings...**。设置 **SDF Resolution**（分辨率倍率）、**SDF Unit Scale**（一个网格局部单位对应的世界单位）和 **SDF Two Sided**（树叶、布、地形裙边等开放薄片），然后点击 **Bake SDF**。状态显示 `Baked ...` 后，结果即可供运行时加载。网格或设置改变后需要重新烘焙；`Mesh.sdfMode` 只控制运行时参与方式，不会触发烘焙。

## 网格参与模式

```ts
mesh.sdfMode = 'static';  // 适合不移动的建筑和地形道具
mesh.sdfMode = 'dynamic'; // 每帧按当前变换查询
mesh.sdfMode = 'none';    // 排除
mesh.sdfMode = 'auto';    // 默认：按节点和动画状态推断
```

`auto` 会把蒙皮、Morph、动态刚体和角色控制器判定为 `dynamic`，其余网格判定为 `static`。静态实例会进入全局字段；动态实例保留在网格字段中并按当前变换查询。

## 全局 SDF

`scene.sdf.global` 是围绕摄像机移动的多级 clipmap。它只合成静态字段和地形，按砖块预算渐进更新：

```ts
const globalSdf = scene.sdf.global;
if (globalSdf) {
  globalSdf.brickBudget = 512;
}
```

提高 `streamRadius` 会减少缺字段，但增加 atlas 压力；提高 `uploadBudget` 或 `brickBudget` 会缩短镜头移动后的收敛时间，同时增加 GPU/上传开销。通过 `scene.sdf.getStats()` 可查看驻留资产、atlas 占用、缺失字段和待上传字节。

## 限制

- 网格字段需要预烘焙 `.zsdf`；材质透明区域不等于几何孔洞。
- 全局字段和基于它的 DDGI 仅 WebGPU。WebGL2 可以加载场景，但不会构建全局字段。
- 动态网格不应标记为 `static`；移动后静态 clipmap 需要重建，且会产生错误遮挡。
