# 骨骼动画网格实例化

骨骼动画网格也可以参与几何体实例化。WebGPU 路径把每个实例的骨骼矩阵写入共享的 skin palette atlas，批次中的实例在一次间接绘制中读取各自的 palette，因此同一角色模型可以同时播放不同动作。

## 最小用法

沿用普通实例化的规则：实例必须共享同一个 `Primitive` 和材质，骨骼结构与 skin space 也应相同。模型加载后创建多个节点，并为每个节点绑定自己的动画控制器：

```ts
const model = await getEngine().resourceManager.fetchModel('/characters/worker.glb', scene);

for (let i = 0; i < 100; i++) {
  const actor = await model.clone();
  actor.position.setXYZ((i % 10) * 2, 0, Math.floor(i / 10) * 2);
  actor.animationSet.playAnimation(i % 2 ? 'walk' : 'idle');
}
```

引擎会把拥有相同图元、材质和 skin space 的网格放进同一个骨骼实例批次。每个实例仍使用自己的骨骼矩阵；动画更新不会修改共享图元。

## 适用条件

- 仅 WebGPU 的 GPU 批处理路径支持骨骼实例的间接绘制；WebGL2 仍可渲染骨骼网格，但会走普通实例列表。
- 同一批次的网格必须具有相同的骨骼布局和可兼容的 skin space。不同骨架、不同材质或不同 skin space 会拆成多个批次。
- 带 Morph Target 的网格，以及每个顶点超过 4 个骨骼影响的网格，不参与合批。
- `BatchGroup.gpuInstanceCulling` 默认开启。批次很大且只看到局部区域时保持开启；调试批次时可暂时关闭。
- 骨骼实例化减少 draw call，不会减少每个实例的骨骼矩阵更新成本。动画数量很多时应降低更新频率或减少骨骼数。

## GPU 动画

上面的做法减少了 draw call，但每个实例仍在 CPU 上逐帧求值骨骼动画。角色很多时，可以打开 `AnimationSet.gpuAnimation`（默认关闭）：

```ts
actor.animationSet.gpuAnimation = true;
```

播放接口和动画事件都不变。某个实例**只有一个片段在播放、且这个片段只驱动关节**时，引擎改用烘焙好的姿态：每个模型的片段只烘焙一次，由它的所有实例共享；在 WebGPU 上姿态由 compute pass 求值，网格保持可合批。

不满足条件的帧会无缝回退到常规路径，包括：片段之间的交叉淡化和其他混合、IK 和 JointDynamics 等骨骼修改器、GPU 布料、挂在关节下的节点（它们需要跟随关节节点）。在编辑器中、非播放模式下，动画总是走常规路径。

烘焙姿态播放期间关节节点不会移动，代码读到的关节变换停留在切换到烘焙姿态的那一刻。可以用 `animationSet.isPlayingOnGpu` 查询当前是否在使用烘焙姿态。

**需要控制骨骼的角色不适合用 GPU 动画。**

- 骨骼上挂了 IK、JointDynamics（骨骼物理）等骨骼修改器的实例，会一直走常规路径，在 CPU 上逐帧求值骨骼。它们仍会和其他兼容的实例合并绘制，draw call 不会增加，但骨骼计算省不掉，对它们开 `gpuAnimation` 没有收益。
- 直接在代码里修改关节节点的变换（不经过骨骼修改器）不会被引擎检测到。烘焙姿态播放期间网格不读关节节点，这些修改会**静默失效**。需要在代码里控制关节时，要么对这个实例关闭 `gpuAnimation`，要么把控制逻辑写成 `SkeletonModifier`，用 `rig.modifiers.push()` 挂到骨骼上（见 [IK](zh-cn/animation-ik.md)），引擎会因此自动改走常规路径。

## 与 LOD、SDF 的关系

骨骼网格可以同时使用 Mesh LOD；各 LOD 共享顶点缓冲，但每个实例仍读取自己的 palette。带 skin 或 morph 的网格在 `Mesh.sdfMode = 'auto'` 时会被视为动态 SDF 实例，不能当作静态几何缓存到全局 SDF。

## 排查

若 draw call 没有下降，先确认图元和材质确实共享，再检查实例是否使用相同 skin space。不要在每帧替换 `primitive`、材质或骨骼布局；这些操作会重建批次。
