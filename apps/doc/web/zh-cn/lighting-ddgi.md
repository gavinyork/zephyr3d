# 基于 SDF 的 DDGI

DDGI（动态漫反射全局光照）使用场景 SDF 发射探针射线，再把探针的辐照度和可见性插值到表面。Zephyr3D 的实现由体素材质场和多级 probe clipmap 组成，适合动态摄像机和中等规模的室外/室内场景。

## 启用

```ts
scene.sdf.enabled = true; // 先提供网格字段
scene.gi.enabled = true;

scene.gi.probeSpacing = 1;
scene.gi.probeGrid = [32, 16, 32];
scene.gi.probeLevels = 4;
scene.gi.probeRays = 128;
scene.gi.probeBudget = 4096;
```

`scene.gi.enabled` 会自动保持 `scene.sdf` 开启。只有带烘焙字段的静态网格会进入体素材质场；地形可通过 `scene.gi.terrainAlbedo` 提供默认反照率。

## 收敛与画质

`probeSpacing` 决定近处探针间距，`probeLevels` 扩大覆盖范围，`probeRays` 提高单探针的采样质量，`probeBudget` 决定每帧更新多少探针。提高 `probeHysteresis` 能减少闪烁，但会让光照变化更慢。漏光时先增大 `probeNormalBias` 或 `probeViewBias`，再检查 SDF 是否闭合和尺度是否正确。

动态场景保持默认的 `updateMode = 'continuous'`。场景稳定后可导出并冻结探针状态：

```ts
const state = await scene.gi.exportProbeState();
scene.gi.importProbeState(state); // 导入后自动切换为 frozen
scene.gi.updateMode = 'frozen';
```

## 限制与诊断

- DDGI、全局 SDF 和体素光照仅 WebGPU；WebGL2 上 `scene.gi.enabled` 不会构建光照。
- 首次启用需要等待 SDF 流式加载、体素化和探针收敛，不能把第一帧当作最终画质。
- 用 `scene.gi.getStats()` 检查 `supported`、体素和 probe 的更新计数；用 `scene.sdf.getStats()` 检查缺失或未驻留的字段。
- `atlasSize`、`voxelizeBudget` 和 `lightingSlicesPerFrame` 是显存与更新开销的主要旋钮。
