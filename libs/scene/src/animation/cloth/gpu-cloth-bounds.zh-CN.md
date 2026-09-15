# GPU Cloth 包围盒计算说明

## 问题与场景证据

`ling-yao/assets/Levels/BaseLight2.zscn` 中的 `Source` 引用未配置 GPU Cloth 的原始服装 prefab；
`outfit_Little_female_MHWhole_A` 引用配置后的 prefab。两者的三个 mesh 使用相同的网格资源、节点 ID
和 `SkinnedBoundingInfo`。后者新增了一个 `GPUClothComponent`，模拟网格为 `dress_simulation`
（558 个顶点），被包裹的目标网格为 `outfit_Little_female_MH_A.001`（42,639 个顶点）。

绑定缓存的 `maxOffsetDistance` 为 28.172461936893434。这个最大偏移对应目标顶点 2184，
但该顶点的 wrap 权重为 0：它使用原有的蒙皮位置，不会随模拟网格移动。旧实现把整个缓存的最大偏移
直接加到模拟网格转换后的包围盒六个方向，因此零权重顶点也会使衣服的包围盒异常膨胀。

## 新的保守计算

GPU 上每个目标顶点的位置是 `P = (1 - w) * P_skin + w * P_wrap`，其中 `w` 是该顶点的
wrap 权重。CPU 无法在每帧无代价地读取 GPU 模拟后的每个顶点，因此用模拟网格已有的包围盒
`B_source`，转换到目标 mesh 的局部空间，再结合绑定缓存中的每顶点局部偏移半径 `r` 推导目标范围：

```text
min_i = (1 - w_i) * P_skin_i + w_i * (B_source.min - r_i) - 0.001
max_i = (1 - w_i) * P_skin_i + w_i * (B_source.max + r_i) + 0.001
B_target = 所有目标顶点的 min_i / max_i 的逐轴最小值 / 最大值
```

`r_i` 是绑定缓存内局部偏移向量的长度。偏移会随三角形局部坐标架旋转，长度作为各轴的
保守余量；`0.001` 为数值余量。权重为 0 时只保留蒙皮位置，权重为 1 时只保留包裹范围，
部分权重按 GPU 实际的线性混合计算。目标网格存在未包裹部分时，蒙皮位置仍每帧更新，
不会因为收缩包围盒而误剔除这些部分。变换先应用在模拟网格包围盒上，确保两个 mesh 的
局部坐标系不同时仍在目标空间计算。

## 状态更新与边界

GPU Cloth 会暂停模拟 mesh 和被包裹 mesh 的常规蒙皮，把更新后的包围盒写入
`Mesh.setAnimatedBoundingBox`。`suspendSkinning` 从关闭切换为开启时应清掉原蒙皮包围盒；
暂停期间的普通 mesh 更新不能再次清空 GPU Cloth 写入的包围盒，否则下一帧可能退回静态
primitive 的范围。恢复蒙皮时 GPU Cloth 原有的释放路径仍清理该包围盒。

本计算依赖模拟网格提供的 CPU 包围盒，未读取 GPU 实时位移；极端运动超出模拟网格现有
范围时，仍可能需要为模拟网格单独扩大动态余量。回归测试覆盖零权重、部分权重、跨 mesh
坐标变换和暂停蒙皮后的盒子保留；实际渲染剔除效果仍需在 WebGPU 场景中检查。
