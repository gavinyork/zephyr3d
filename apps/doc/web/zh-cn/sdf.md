# 网格 SDF 与全局 SDF

符号距离场（SDF）把网格表面表示成到最近表面的带符号距离。它为探针 GI（DDGI）、近岸浪与水体交互、调试可视化（`SDFDebugMaterial`），以及自定义材质中的空间查询（`ShaderHelper.declareSceneSDF`）提供统一的几何表示。直接光照的阴影不使用 SDF，仍由阴影贴图负责。SDF 系统默认关闭，且全局 SDF 的 GPU 构建仅支持 WebGPU。

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

网格字段的精度按世界尺寸计算：默认每个世界单位 20 个体素（经 SDF Unit Scale 换算），每个轴最多 128 个体素（分辨率倍率大于 1 时为 256）。很大的网格会因此被降低精度，必要时可拆成几块再烘焙。

## 网格参与模式

```ts
mesh.sdfMode = 'static';  // 适合不移动的建筑和地形道具
mesh.sdfMode = 'dynamic'; // 每帧按当前变换查询
mesh.sdfMode = 'none';    // 排除
mesh.sdfMode = 'auto';    // 默认：按节点和动画状态推断
```

`auto` 会把蒙皮、Morph、动态刚体和角色控制器判定为 `dynamic`，其余网格判定为 `static`。静态实例会进入全局字段；动态实例保留在网格字段中并按当前变换查询。

注意：由脚本、关键帧动画或代码直接移动的网格不在上述判断范围内，`auto` 会把它们判为 `static`。这类网格要手动设为 `'dynamic'`。

## 全局 SDF

`scene.sdf.global` 是围绕摄像机移动的多级 clipmap。它只合成静态字段和地形，按砖块预算渐进更新。全局字段固定为 4 级、每级 128³ 体素，最细一级的体素为 0.25 单位，覆盖相机周围约 ±128 单位；所有尺寸按场景单位计算，不随 `scene.metersPerUnit` 换算。

```ts
const globalSdf = scene.sdf.global;
if (globalSdf) {
  globalSdf.brickBudget = 512;
}
```

提高 `streamRadius` 会减少缺字段，但增加 atlas 压力；提高 `uploadBudget` 或 `brickBudget` 会缩短镜头移动后的收敛时间，同时增加 GPU/上传开销。通过 `scene.sdf.getStats()` 可查看驻留资产、atlas 占用、缺失字段和待上传字节。

驻留的网格字段放在一张共享的半精度 atlas 中，默认 512×256×256 体素（约 64 MB），由 `scene.sdf.atlasSize` 设置。放不下的字段会被丢弃并打印警告；修改 `atlasSize` 会清空 atlas 并重新上传。

## 限制

- 网格字段需要预烘焙 `.zsdf`；材质透明区域不等于几何孔洞。
- 全局字段和基于它的 DDGI 仅 WebGPU。WebGL2 可以加载场景，但不会构建全局字段。
- 动态网格不应标记为 `static`；移动后静态 clipmap 需要重建，且会产生错误遮挡。
