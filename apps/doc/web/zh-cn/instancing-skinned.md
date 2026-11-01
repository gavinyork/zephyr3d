# 骨骼动画网格实例化

骨骼动画网格也可以参与几何体实例化。WebGPU 路径把每个实例的骨骼矩阵写入共享的 skin palette atlas，批次中的实例在一次间接绘制中读取各自的 palette，因此同一角色模型可以同时播放不同动作。

## 最小用法

沿用普通实例化的规则：实例必须共享同一个 `Primitive` 和材质，骨骼结构与 skin space 也应相同。模型加载后创建多个节点，并为每个节点绑定自己的动画控制器：

```ts
const model = await engine.resourceManager.fetchModel('/characters/worker.glb', scene);
const material = model.root.find((n) => n.isMesh())!.material;

for (let i = 0; i < 100; i++) {
  const actor = await model.clone();
  actor.position.setXYZ((i % 10) * 2, 0, Math.floor(i / 10) * 2);
  actor.animationSet.playAnimation(i % 2 ? 'walk' : 'idle');
}
```

引擎会把拥有相同图元、材质和 skin space 的网格放入 `skinInstanceItemList`。每个实例仍使用自己的骨骼矩阵；动画更新不会修改共享图元。

## 适用条件

- 仅 WebGPU 的 GPU 批处理路径支持骨骼实例的间接绘制；WebGL2 仍可渲染骨骼网格，但会走普通实例列表。
- 同一批次的网格必须具有相同的骨骼布局和可兼容的 skin space。不同骨架、不同材质或不同 skin space 会拆成多个批次。
- `BatchGroup.gpuInstanceCulling` 默认开启。批次很大且只看到局部区域时保持开启；调试批次时可暂时关闭。
- 骨骼实例化减少 draw call，不会减少每个实例的骨骼矩阵更新成本。动画数量很多时应降低更新频率或减少骨骼数。

## 与 LOD、SDF 的关系

骨骼网格可以同时使用 Mesh LOD；各 LOD 共享顶点缓冲，但每个实例仍读取自己的 palette。带 skin 或 morph 的网格在 `Mesh.sdfMode = 'auto'` 时会被视为动态 SDF 实例，不能当作静态几何缓存到全局 SDF。

## 排查

若 draw call 没有下降，先确认图元和材质确实共享，再检查实例是否使用相同 skin space。不要在每帧替换 `primitive`、材质或骨骼布局；这些操作会重建批次。
