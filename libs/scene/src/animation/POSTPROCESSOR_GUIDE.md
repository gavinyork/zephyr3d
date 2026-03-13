# 骨骼动画后处理层系统使用指南

## 概述

骨骼动画系统现在支持分层处理架构：

```
Layer 0 (Base): 动画或Bind Pose
    ↓
Layer 1+: 后处理层（IK、弹簧、手动控制等）
    ↓
最终骨骼变换
```

每个后处理层都可以：
- 独立启用/禁用
- 设置混合权重 (0-1)
- 设置优先级（数值越大越晚执行）
- 与前一层的结果进行混合

## 基本用法

### 1. 手动Transform控制

```typescript
import { ManualTransformProcessor } from '@zephyr3d/scene';

// 创建手动控制处理器
const manualProcessor = new ManualTransformProcessor(1.0, 100);

// 设置特定关节的位置
manualProcessor.setJointPosition(5, new Vector3(1, 2, 3));

// 设置特定关节的旋转
manualProcessor.setJointRotation(5, Quaternion.fromEuler(0, Math.PI / 2, 0));

// 设置特定关节的缩放
manualProcessor.setJointScale(5, new Vector3(1.5, 1.5, 1.5));

// 或者一次性设置完整的transform
manualProcessor.setJointTransform(
  5,
  new Vector3(1, 2, 3),      // position
  Quaternion.identity(),      // rotation
  new Vector3(1, 1, 1)        // scale
);

// 添加到骨骼
skeleton.addPostProcessor(manualProcessor);

// 清除特定关节的覆盖
manualProcessor.clearJoint(5);

// 清除所有覆盖
manualProcessor.clearAll();
```

### 2. IK系统集成

```typescript
import { IKPostProcessor, FABRIKSolver, IKChain } from '@zephyr3d/scene';

// 创建IK链和求解器
const ikChain = new IKChain([joint1, joint2, joint3]);
const ikSolver = new FABRIKSolver(ikChain);
ikSolver.setTarget(targetPosition);

// 创建IK后处理器
const ikProcessor = new IKPostProcessor(ikSolver, 1.0, 50);

// 添加到骨骼
skeleton.addPostProcessor(ikProcessor);

// 运行时更新目标位置
ikSolver.setTarget(newTargetPosition);

// 调整混合权重
ikProcessor.weight = 0.5; // 50%混合
```

### 3. 弹簧物理系统集成

```typescript
import { SpringPostProcessor, SpringSystem, SpringChain } from '@zephyr3d/scene';

// 创建弹簧链和系统
const springChain = new SpringChain([joint1, joint2, joint3]);
const springSystem = new SpringSystem(springChain, {
  gravity: new Vector3(0, -9.8, 0),
  iterations: 5
});

// 创建弹簧后处理器
const springProcessor = new SpringPostProcessor(springSystem, 1.0, 50);

// 添加到骨骼
skeleton.addPostProcessor(springProcessor);

// 运行时调整参数
springSystem.setGravity(new Vector3(0, -5, 0));
springProcessor.weight = 0.8; // 80%混合
```

## 高级用法

### 多层组合

```typescript
// Layer 1: IK控制手臂 (优先级 50)
const armIK = new IKPostProcessor(armSolver, 1.0, 50);
skeleton.addPostProcessor(armIK);

// Layer 2: 弹簧物理控制头发 (优先级 60)
const hairSpring = new SpringPostProcessor(hairSystem, 1.0, 60);
skeleton.addPostProcessor(hairSpring);

// Layer 3: 手动微调特定关节 (优先级 100)
const manualTweak = new ManualTransformProcessor(0.5, 100);
manualTweak.setJointRotation(headJointIndex, lookAtRotation);
skeleton.addPostProcessor(manualTweak);
```

执行顺序：Base Animation → IK → Spring → Manual

### 动态启用/禁用

```typescript
// 临时禁用某个处理器
ikProcessor.enabled = false;

// 重新启用
ikProcessor.enabled = true;

// 移除处理器
skeleton.removePostProcessor(ikProcessor);

// 清除所有处理器
skeleton.clearPostProcessors();
```

### 权重动画

```typescript
// 平滑过渡IK权重
function updateIK(deltaTime: number) {
  // 根据距离调整IK权重
  const distance = targetPosition.distanceTo(handPosition);
  const targetWeight = distance < 2.0 ? 1.0 : 0.0;

  // 平滑插值
  ikProcessor.weight = lerp(ikProcessor.weight, targetWeight, deltaTime * 5);
}
```

### 自定义后处理器

```typescript
import { SkeletonPostProcessor } from '@zephyr3d/scene';

class CustomProcessor extends SkeletonPostProcessor {
  apply(skeleton: Skeleton, deltaTime: number): void {
    if (!this.enabled || this.weight <= 0) {
      return;
    }

    const joints = skeleton.joints;

    // 自定义处理逻辑
    for (let i = 0; i < joints.length; i++) {
      const joint = joints[i];

      // 例如：添加呼吸动画
      const breathOffset = Math.sin(Date.now() * 0.001) * 0.1;
      const newScale = joint.scale.clone();
      newScale.y += breathOffset * this.weight;
      joint.scale = newScale;
    }
  }

  reset(): void {
    // 重置状态
  }
}

// 使用自定义处理器
const breathProcessor = new CustomProcessor(0.5, 70);
skeleton.addPostProcessor(breathProcessor);
```

## 与动画系统的交互

### 场景1：动画播放时应用IK

```typescript
// 播放行走动画
animationSet.playAnimation('walk', { repeat: 0 });

// 同时应用IK到手部（例如抓取物体）
const handIK = new IKPostProcessor(handSolver, 1.0, 50);
skeleton.addPostProcessor(handIK);

// 结果：下半身播放行走动画，上半身通过IK抓取物体
```

### 场景2：无动画时的程序化控制

```typescript
// 不播放任何动画（使用bind pose）
// 完全通过后处理器控制

const manualControl = new ManualTransformProcessor(1.0, 100);

// 手动设置每个关节
for (let i = 0; i < skeleton.joints.length; i++) {
  manualControl.setJointRotation(i, customRotations[i]);
}

skeleton.addPostProcessor(manualControl);
```

### 场景3：动画混合 + 后处理

```typescript
// 播放两个动画并混合
animationSet.playAnimation('idle', { weight: 0.7 });
animationSet.playAnimation('wave', { weight: 0.3 });

// 在混合结果上应用弹簧物理
const clothSpring = new SpringPostProcessor(clothSystem, 1.0, 50);
skeleton.addPostProcessor(clothSpring);
```

## 性能考虑

1. **后处理器数量**：每个后处理器都会在每帧执行，建议控制在5个以内
2. **优先级排序**：系统会在每帧对启用的处理器排序，频繁修改优先级会有性能开销
3. **权重为0**：当权重为0时，处理器会跳过执行
4. **禁用处理器**：不需要时及时禁用或移除处理器

## 调试技巧

```typescript
// 查看所有后处理器
const processors = skeleton.getPostProcessors();
console.log('Active processors:', processors.length);

processors.forEach((p, i) => {
  console.log(`[${i}] Priority: ${p.priority}, Weight: ${p.weight}, Enabled: ${p.enabled}`);
});

// 临时禁用所有后处理器进行对比
skeleton.clearPostProcessors();
```

## 注意事项

1. 后处理器在 `skeleton.apply()` 时执行，确保动画系统正常更新
2. 手动修改的transform会在下一帧被base layer覆盖，必须通过后处理器持续应用
3. 后处理器按优先级顺序执行，后执行的会覆盖前面的结果（根据权重混合）
4. IK和Spring系统现在可以与动画完美共存，不会互相覆盖
