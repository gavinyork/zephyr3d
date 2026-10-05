# 性能优化

> 本页代码仅作示意，省略了 import 和应用初始化。

本页介绍 Zephyr3D 中用来提升渲染速度、缩短加载时间、降低内存占用的几种手段：**实例化渲染**、**BatchGroup 合批**、**纹理压缩**、**顶点压缩**和**网格 LOD**。对每一项，分别说明它能节省什么、有什么代价和局限，以及在编辑器和代码中怎么使用。

## 实例化渲染

### 作用

共用同一个图元、并使用同一材质的实例的网格，会合并成一次实例化绘制，而不是每个网格各发一次 draw call。每个网格仍然有自己的变换和材质实例参数（颜色、数值等），这些数据打包成逐实例数据。这样可以大幅降低 CPU 发出 draw call 的开销，而场景中有大量重复物体（植被、岩石、道具、模块化建筑）时，瓶颈通常就在这里。

合批是自动的：渲染队列每帧把可见的网格分组。网格要参与合批，需要满足：

- 材质是**材质实例**，即用 `material.createInstance()` 创建的；直接使用材质本身的网格会逐个绘制；
- 和其他网格使用**同一个图元**和**同一个核心材质**；
- 没有变形目标（Morph Target）；如果是骨骼网格，每个顶点最多 4 个骨骼影响；
- 设备是 WebGL2 或 WebGPU。

### 在编辑器中

选中网格，在属性中开启 **Geometry Instance**：网格会改用其材质的实例，和其他同样开启的网格合批。

### 在代码中

```ts
const shape = new BoxShape();
const material = new PBRMetallicRoughnessMaterial();
for (let i = 0; i < 1000; i++) {
  // 同一个图元、同一材质的实例：全部合成一次 draw call
  const mesh = new Mesh(scene, shape, material.createInstance());
  mesh.position.setXYZ(Math.random() * 100, 0, Math.random() * 100);
  // 逐实例的参数不影响合批
  mesh.material.albedoColor = new Vector4(Math.random(), Math.random(), Math.random(), 1);
}
```

加载的模型默认不使用实例化，可以在加载时开启：

```ts
const tree = await getEngine().resourceManager.fetchModel('/models/tree.glb', scene, {
  enableInstancing: true
});
```

### 局限

- CPU 仍然要每帧剔除和排序每一个网格。网格多到上万个时，这部分逐网格的开销会成为瓶颈，这时应改用 [BatchGroup](#batchgroup-合批)。
- 同一批实例在一次调用中绘制，透明实例无法按远近排序，需要配合[顺序无关透明（OIT）](zh-cn/oit.md)。
- 逐实例数据放在 64 KB 的 uniform 缓冲中，批次过大时会自动拆成多次 draw call。
- 带 LOD 的网格按当前所用级别分成多个批次，所以 LOD 会增加 draw call。

更多内容见[几何体实例化](zh-cn/instancing-intro.md)。

---

## BatchGroup 合批

### 作用

`BatchGroup` 会缓存其下网格的批次，而不是每帧重建。CPU 不再逐个剔除、排序、打包这些网格，而是把整个组当作一个对象处理。在 WebGPU 上，缓存的绘制还会录制成 render bundle，重放时几乎没有 CPU 开销。

在 WebGPU 上，组还会把部分工作交给 GPU（属性 `gpuInstanceCulling`，默认开启）：

- **GPU 实例剔除**：每个视图绘制前，由一个 compute pass 去掉该视图看不到的实例，主相机和每个阴影级联都会剔除。
- **GPU 选取 LOD**：设备支持 `indirect-first-instance` 时，同一个 pass 还会为每个实例选取 LOD 级别，网格换级不会导致缓存重建。

移动网格、修改材质实例参数，都会直接更新缓存的批次。只有组的内容变化时才会重建缓存：增加或移除网格、显示或隐藏网格、更换图元或材质。

### 在编辑器中

在场景层级视图中右键点击节点，选择 **Create Batch Group**，再把网格拖到它下面。网格最好开启 **Geometry Instance**，这样它们才能彼此合批。

### 在代码中

```ts
const group = new BatchGroup(scene);
for (let i = 0; i < 10000; i++) {
  const rock = new Mesh(scene, rockShape, rockMaterial.createInstance());
  rock.parent = group;
  rock.position.setXYZ(Math.random() * 500, 0, Math.random() * 500);
}
// WebGPU：逐实例的 GPU 剔除和 LOD 选取（默认开启）
group.gpuInstanceCulling = true;
```

### 局限

- 内容变化会重建整个组的缓存：不要每帧增删或隐藏组内的网格，频繁变化的物体应放在组外。
- 没有 GPU 剔除时（WebGL，或关闭了 `gpuInstanceCulling`），只要组可见，就会绘制组内全部网格，包括视野外的。很大的区域应拆成多个组，让整组可以被剔除。
- 在 WebGL 上，以及 GPU 路径不覆盖的网格，LOD 由 CPU 逐网格选取，网格换级会重建缓存；有滞回，这种情况很少发生。
- GPU 选级没有滞回：网格正好处在切换距离附近时，相机移动可能让它在两级之间来回切换。

---

## 纹理压缩

### 作用

纹理通常是下载量和显存占用中最大的部分。压缩纹理在 GPU 上保持压缩状态：块压缩纹理的显存只有 RGBA8 的四分之一到八分之一，采样时的带宽也相应减少，渲染也会更快。Zephyr3D 使用 **Basis Universal** 编码的 **KTX2** 文件：一个文件适用于所有设备，加载时转码为 GPU 支持的最佳格式（桌面端 BC7 或 BC1/BC3，移动端 ETC2 或 ASTC，最后退回 RGBA8）。

| 存储格式 | 用途 |
| --- | --- |
| ETC1S | 文件最小，用于颜色纹理 |
| UASTC | 质量最高，用于法线贴图、遮罩、打包通道 |

### 在编辑器中

- 导入模型时勾选 **Compress Textures**。
- 项目中已有的纹理，在资产视图中右键选择 **Texture Settings...**，设置用途、压缩方式（**Auto** 会给颜色纹理选 ETC1S，给法线和遮罩选 UASTC）、质量、最大尺寸和 mipmap。

编辑器在后台编码，视口中显示的就是压缩后的效果，构建时发布 KTX2 副本。详见[资产压缩](zh-cn/editor/asset-compression.md)。

### 在代码中

KTX2 文件和其他纹理一样加载；可以事先用 `basisu`、`toktx` 等工具编码：

```ts
const albedo = await getEngine().resourceManager.fetchTexture('/textures/rock-albedo.ktx2');
const normal = await getEngine().resourceManager.fetchTexture('/textures/rock-normal.ktx2', {
  linearColorSpace: true
});
```

带 `KHR_texture_basisu` 扩展的 glTF 模型会自动加载其 KTX2 纹理。编辑器构建的项目通过资产清单分发，代码里加载 `/assets/rock.png` 时会自动拿到压缩副本，不用改代码；见[资源加载](zh-cn/asset-loading.md)。

### 局限

- 压缩是有损的；ETC1S 在渐变和法线贴图上会出现块状瑕疵，需要按纹理选择用途和格式。
- 转码在加载时于 Web Worker 中进行；第一次加载 KTX2 纹理时需要下载转码器。
- 编辑器只压缩 PNG、JPEG、WebP；TGA、HDR、EXR 按原样发布。
- 暂不使用双通道法线贴图格式（BC5、EAC RG）。

---

## 顶点压缩

### 作用

顶点压缩可以缩小网格文件；顶点属性量化后，GPU 上的顶点缓冲也会变小：

- 编辑器把网格存为 **meshopt** 压缩的二进制 `.zmsh`：法线和切线用八面体编码成 8 或 16 位整数，顶点色和骨骼权重量化为 8 位。顶点越小，显存占用和绘制时的带宽都越少。
- 运行时，glTF 导入器支持 `EXT_meshopt_compression` / `KHR_meshopt_compression`、`KHR_draco_mesh_compression` 和 `KHR_mesh_quantization`。

### 在编辑器中

- 导入模型时勾选 **Compress Vertices**。
- 项目中已有的网格，右键 `.zmsh` 文件选择 **Mesh Settings...**，把 **Compression** 设为 **meshopt**，并选择 **Normal Precision**（默认 12 位，肉眼看不出差别）。

### 在代码中

用 `gltfpack`（meshopt 和量化）或 `gltf-transform`（Draco 或 meshopt）等工具压缩 glTF 文件，然后照常加载，解码器随引擎提供：

```ts
const model = await getEngine().resourceManager.fetchModel('/models/city.glb', scene);
```

### 局限

- 加载时解码要占用 CPU 时间，与网格大小成正比；meshopt 的解码速度远快于 Draco。
- Draco 只减少下载量：数据会被解码为全精度。只有量化的属性（`KHR_mesh_quantization`，或编辑器的 meshopt 编码）才能减少显存。
- 编辑器不量化顶点位置和纹理坐标。
- 8 位法线在平滑的低面数表面上能看出来；除非更在意显存，否则保持默认的 12 位。

---

## 网格 LOD

### 作用

带 LOD 的网格在屏幕上变小时会换用简化版本，所以远处物体的三角形和顶点开销更少，主视图和阴影贴图都受益。各级 LOD 是同一组顶点上的不同索引段，骨骼网格和变形目标在每一级都能正常工作。

### 在编辑器中

- 导入模型时勾选 **Generate LODs**，并设置 **Min Triangles**、**Triangles Per Level**、**Pixel Error**。
- 项目中已有的网格，打开 **Mesh Settings...** 开启 **Generate LODs**。LOD 在后台生成，构建时一起发布。
- 形状资产（球体、立方体等）的属性中有 **GenerateLODs**。
- 网格节点有 **ForcedLod** 和 **MinLod**，可以固定或限制所用的级别。

### 在代码中

```ts
// 加载模型时生成 LOD
const model = await getEngine().resourceManager.fetchModel('/models/tree.glb', scene, {
  generateLods: true // 或 { lodMinTriangles: 200, lodReduction: 0.5, lodPixelError: 8 }
});

// 形状随几何体一起生成 LOD
const sphere = new SphereShape({ radius: 1, verticalDetail: 32, horizonalDetail: 64, lod: {
  lodMinTriangles: 100, lodReduction: 0.5, lodPixelError: 8
} });

// 在低端设备上更早切换到简化版本
camera.lodDistanceScale = 2;
```

`SharedModel.generateLods`、手动设置 LOD 以及调试视图，见[细节层次（LOD）](zh-cn/mesh-lod.md)。

### 局限

- LOD 减少的是三角形，不是内存：所有级别都常驻，还额外增加了各级的索引。
- 级别直接切换，没有淡入淡出，切换时可能看到跳变；如果明显，可以降低 Pixel Error 或 `camera.lodDistanceScale`，让切换发生在更远处。
- 简化时不考虑骨骼权重，也不减少骨骼数量。
- 只有三角形列表网格能生成 LOD。加载时生成在主线程进行，大模型会比较耗时；优先在编辑器中生成，LOD 随构建发布，没有加载时的开销。
- 实例化网格按当前所用级别分成多个批次，draw call 会增加；在 WebGPU 的 BatchGroup 中，改为在 GPU 上逐实例选级。

