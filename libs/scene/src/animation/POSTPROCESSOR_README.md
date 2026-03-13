# 骨骼动画后处理层系统

## 概述

为了解决骨骼动画系统中手动修改transform被bind pose覆盖的问题，我们实现了一个分层处理架构。这个系统允许在基础动画层（动画或bind pose）之上应用多个后处理层，每个层都可以独立控制和混合。

## 问题背景

在原有系统中：
- 当没有播放动画时，骨骼会默认设置为bind pose
- 如果通过IK或Spring系统修改了骨骼节点的transform，渲染时会被bind pose覆盖
- 无法实现手动控制与动画的平滑混合

## 解决方案

### 架构设计

```
┌─────────────────────────────────────────────────┐
│ Layer 0: Base Transform                         │
│ - Animation playing → animation transforms      │
│ - No animation → bind pose                      │
└─────────────────┬───────────────────────────────┘
                  ↓
┌─────────────────────────────────────────────────┐
│ Layer 1: Post-processor (priority 50)           │
│ - IK solver                                     │
│ - Weight: 1.0                                   │
└─────────────────┬───────────────────────────────┘
                  ↓
┌─────────────────────────────────────────────────┐
│ Layer 2: Post-processor (priority 60)           │
│ - Spring physics                                │
│ - Weight: 0.8                                   │
└─────────────────┬───────────────────────────────┘
                  ↓
┌─────────────────────────────────────────────────┐
│ Layer 3: Post-processor (priority 100)          │
│ - Manual transform overrides                    │
│ - Weight: 0.5                                   │
└─────────────────┬───────────────────────────────┘
                  ↓
          Final Joint Matrices
```

### 核心组件

#### 1. SkeletonPostProcessor (抽象基类)

所有后处理器的基类，定义了统一的接口：

```typescript
abstract class SkeletonPostProcessor {
  weight: number;      // 混合权重 [0-1]
  enabled: boolean;    // 是否启用
  priority: number;    // 优先级（数值越大越晚执行）

  abstract apply(skeleton: Skeleton, deltaTime: number): void;
  abstract reset(): void;
}
```

#### 2. ManualTransformProcessor

手动transform控制处理器，允许设置特定关节的位置、旋转和缩放：

```typescript
const processor = new ManualTransformProcessor(1.0, 100);
processor.setJointPosition(5, new Vector3(1, 2, 3));
processor.setJointRotation(5, Quaternion.fromEuler(0, Math.PI / 2, 0));
skeleton.addPostProcessor(processor);
```

#### 3. IKPostProcessor

IK求解器的包装器，将IK系统集成到后处理管线：

```typescript
const ikSolver = new FABRIKSolver(ikChain);
const targetPos = new Vector3(1, 2, 3);
const processor = new IKPostProcessor(ikSolver, targetPos, 1.0, 50);
skeleton.addPostProcessor(processor);
```

#### 4. SpringPostProcessor

弹簧物理系统的包装器：

```typescript
const springSystem = new SpringSystem(springChain);
const processor = new SpringPostProcessor(springSystem, 1.0, 60);
skeleton.addPostProcessor(processor);
```

### Skeleton类的扩展

添加了以下方法：

```typescript
class Skeleton {
  // 添加后处理器
  addPostProcessor(processor: SkeletonPostProcessor): void;

  // 移除后处理器
  removePostProcessor(processor: SkeletonPostProcessor): void;

  // 清除所有后处理器
  clearPostProcessors(): void;

  // 获取所有后处理器
  getPostProcessors(): readonly SkeletonPostProcessor[];

  // apply方法现在接受deltaTime参数
  apply(deltaTime: number = 0): void;
}
```

## 使用示例

### 基础用法

```typescript
// 1. 创建手动控制处理器
const manualProcessor = new ManualTransformProcessor(1.0, 100);
manualProcessor.setJointRotation(headJointIndex, lookAtRotation);
skeleton.addPostProcessor(manualProcessor);

// 2. 播放动画（可选）
animationSet.playAnimation('walk');

// 3. 手动修改的transform会在动画之上应用，不会被覆盖
```

### 多层组合

```typescript
// Layer 1: IK控制手臂
const armIK = new IKPostProcessor(armSolver, targetPos, 1.0, 50);
skeleton.addPostProcessor(armIK);

// Layer 2: 弹簧物理控制头发
const hairSpring = new SpringPostProcessor(hairSystem, 1.0, 60);
skeleton.addPostProcessor(hairSpring);

// Layer 3: 手动微调头部
const headControl = new ManualTransformProcessor(0.5, 100);
headControl.setJointRotation(headIndex, lookAtRotation);
skeleton.addPostProcessor(headControl);

// 执行顺序：Base Animation → IK → Spring → Manual
```

### 动态权重调整

```typescript
// 根据距离动态调整IK权重
function update(deltaTime) {
  const distance = handPos.distanceTo(targetPos);

  if (distance < 2.0) {
    ikProcessor.weight = 1.0;  // 近距离：完全IK
  } else {
    ikProcessor.weight = Math.max(0, 1.0 - (distance - 2.0) / 3.0);
  }
}
```

### 自定义后处理器

```typescript
class BreathingProcessor extends SkeletonPostProcessor {
  private time = 0;

  apply(skeleton, deltaTime) {
    if (!this.enabled || this.weight <= 0) return;

    this.time += deltaTime;
    const breathAmount = Math.sin(this.time * 2) * 0.05;

    const chestJoint = skeleton.joints[8];
    chestJoint.scale = new Vector3(
      chestJoint.scale.x,
      chestJoint.scale.y + breathAmount * this.weight,
      chestJoint.scale.z
    );
  }

  reset() {
    this.time = 0;
  }
}
```

## 技术细节

### 执行流程

1. **Base Layer更新**：
   - 如果有动画播放：应用动画transforms
   - 如果没有动画：应用bind pose

2. **后处理器排序**：
   - 按priority从小到大排序
   - 只处理enabled=true的处理器

3. **依次执行后处理器**：
   - 每个处理器修改joint transforms
   - 根据weight与前一层结果混合

4. **重新计算joint matrices**：
   - 从修改后的transforms计算最终的skinning matrices
   - 上传到GPU texture

### 性能考虑

- 后处理器在每帧执行，建议控制在5个以内
- 权重为0时会跳过执行
- 禁用的处理器不会参与排序和执行
- 后处理完成后会重新计算joint matrices（一次额外开销）

### 与现有系统的兼容性

- **AnimationSet**: 已更新，传递deltaTime给skeleton.apply()
- **IK系统**: 可以通过IKPostProcessor集成
- **Spring系统**: 可以通过SpringPostProcessor集成
- **现有代码**: 不使用后处理器的代码完全兼容，无需修改

## 文件清单

新增文件：
- `skeleton_postprocessor.ts` - 后处理器抽象基类
- `manual_transform_processor.ts` - 手动transform控制
- `ik_postprocessor.ts` - IK系统包装器
- `spring_postprocessor.ts` - Spring系统包装器
- `POSTPROCESSOR_GUIDE.md` - 详细使用指南
- `POSTPROCESSOR_EXAMPLE.ts` - 完整示例代码

修改文件：
- `skeleton.ts` - 添加后处理器管理
- `animationset.ts` - 传递deltaTime
- `index.ts` - 导出新类

## 未来扩展

可以轻松添加更多后处理器类型：
- **LookAt处理器**: 让头部或眼睛看向目标
- **Ragdoll处理器**: 物理布娃娃效果
- **Procedural处理器**: 程序化动画（呼吸、抖动等）
- **Constraint处理器**: 各种约束（距离、角度等）

## 总结

这个分层架构完美解决了原有问题：
- ✅ 手动修改的transform不会被bind pose覆盖
- ✅ 可以与动画系统完美共存和混合
- ✅ 支持多层叠加和优先级控制
- ✅ 灵活的权重控制实现平滑过渡
- ✅ 易于扩展和自定义
- ✅ 与现有代码完全兼容
