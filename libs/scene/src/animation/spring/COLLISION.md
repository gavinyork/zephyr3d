# Spring Collision Detection

碰撞检测系统可以防止头发、布料等spring chain穿透身体或其他物体。

## 碰撞器类型

### 1. 球体碰撞器 (Sphere Collider)
最常用的碰撞器，性能好，适合头部、关节等。

### 2. 胶囊碰撞器 (Capsule Collider)
适合四肢、躯干等细长物体。

### 3. 平面碰撞器 (Plane Collider)
适合地面、墙壁等平面。

## 基本用法

### 添加球体碰撞器

```typescript
import { SpringSystem, createSphereCollider } from '@zephyr3d/scene';

const springSystem = new SpringSystem(hairChain);

// 方式1: 创建静态碰撞器（世界坐标）
const staticCollider = createSphereCollider(
  new Vector3(0, 1.6, 0),  // 世界坐标位置
  0.12                      // 半径（米）
);
springSystem.addCollider(staticCollider);

// 方式2: 创建动态碰撞器（绑定到节点，使用局部坐标）
const headNode = skeleton.findNodeByName('Head');
const dynamicCollider = createSphereCollider(
  new Vector3(0, 0.05, 0),  // 局部偏移（相对于头部节点）
  0.12,                      // 半径
  headNode                   // 绑定节点
);
springSystem.addCollider(dynamicCollider);
```

**重要**：
- **无节点**：位置参数是**世界坐标**
- **有节点**：位置参数是**局部坐标**（相对于节点的偏移）

### 添加胶囊碰撞器

```typescript
import { createCapsuleCollider } from '@zephyr3d/scene';

// 方式1: 静态胶囊（世界坐标）
const staticCapsule = createCapsuleCollider(
  new Vector3(0, 1.2, 0),  // 起点（世界坐标）
  new Vector3(0, 0.6, 0),  // 终点（世界坐标）
  0.15                      // 半径
);
springSystem.addCollider(staticCapsule);

// 方式2: 动态胶囊（绑定到节点，使用局部坐标）
const spineNode = skeleton.findNodeByName('Spine');
const dynamicCapsule = createCapsuleCollider(
  new Vector3(0, 0.3, 0),   // 起点局部偏移
  new Vector3(0, -0.3, 0),  // 终点局部偏移
  0.15,                      // 半径
  spineNode                  // 绑定节点
);
springSystem.addCollider(dynamicCapsule);
```

### 添加平面碰撞器

```typescript
import { createPlaneCollider } from '@zephyr3d/scene';

// 创建地面碰撞器
const groundCollider = createPlaneCollider(
  new Vector3(0, 0, 0),      // 平面上的点
  new Vector3(0, 1, 0)       // 法线（向上）
);

springSystem.addCollider(groundCollider);
```

## 动态碰撞器

碰撞器可以绑定到场景节点，自动跟随节点移动。**当提供节点时，位置参数会被解释为局部坐标（相对于节点的偏移）**。

### 工作原理

```typescript
// 绑定到头部骨骼
const headNode = skeleton.findNodeByName('Head');

// 创建碰撞器，偏移量为局部坐标
const headCollider = createSphereCollider(
  new Vector3(0, 0.05, 0),  // 局部偏移：头部节点上方5cm
  0.12,
  headNode                   // 绑定节点
);

springSystem.addCollider(headCollider);

// 每帧自动更新：
// worldPosition = nodeWorldPosition + localOffset
// 碰撞器会自动跟随headNode移动和旋转
```

### 坐标系说明

| 情况 | 位置参数含义 | 示例 |
|------|------------|------|
| **无节点** | 世界坐标 | `createSphereCollider(new Vector3(0, 1.6, 0), 0.12)` |
| **有节点** | 局部坐标（相对节点的偏移） | `createSphereCollider(new Vector3(0, 0.05, 0), 0.12, headNode)` |

## 完整示例

```typescript
import {
  SpringChain,
  SpringSystem,
  createSphereCollider,
  createCapsuleCollider,
  Vector3
} from '@zephyr3d/scene';

// 创建头发spring chain
const hairChain = SpringChain.fromBoneChain(hairRoot, hairTip);

// 创建spring系统
const springSystem = new SpringSystem(hairChain, {
  iterations: 5,
  gravity: new Vector3(0, -9.8, 0),
  enableInertialForces: true
});

// 添加头部碰撞器
const headNode = skeleton.findNodeByName('Head');
const headCollider = createSphereCollider(
  new Vector3(0, 0, 0),
  0.12,
  headNode
);
springSystem.addCollider(headCollider);

// 添加颈部碰撞器
const neckNode = skeleton.findNodeByName('Neck');
const neckCollider = createSphereCollider(
  new Vector3(0, 0, 0),
  0.08,
  neckNode
);
springSystem.addCollider(neckCollider);

// 添加躯干碰撞器
const spineNode = skeleton.findNodeByName('Spine');
const torsoCollider = createCapsuleCollider(
  new Vector3(0, 0.3, 0),   // 局部起点
  new Vector3(0, -0.3, 0),  // 局部终点
  0.15,
  spineNode
);
springSystem.addCollider(torsoCollider);

// 在更新循环中
scene.onUpdate = (deltaTime) => {
  springSystem.update(deltaTime);
  springSystem.applyToNodes(1.0);
};
```

## 碰撞器管理

### 移除碰撞器

```typescript
springSystem.removeCollider(headCollider);
```

### 清空所有碰撞器

```typescript
springSystem.clearColliders();
```

### 启用/禁用碰撞器

```typescript
headCollider.enabled = false;  // 禁用
headCollider.enabled = true;   // 启用
```

### 获取所有碰撞器

```typescript
const colliders = springSystem.colliders;
console.log(`Total colliders: ${colliders.length}`);
```

## 性能优化建议

### 1. 使用合适数量的碰撞器
- 头发：2-4个碰撞器（头、颈、肩）
- 裙子：4-8个碰撞器（腰、臀、腿）
- 尾巴：1-3个碰撞器（臀、腿）

### 2. 优先使用球体碰撞器
球体碰撞检测最快，尽量使用球体而不是胶囊。

### 3. 避免过多碰撞器
每个粒子都会检测所有碰撞器，碰撞器越多性能越差。

### 4. 使用enabled标志
不需要时禁用碰撞器，而不是移除它。

## 调试技巧

### 可视化碰撞器

```typescript
// 在渲染循环中绘制碰撞器（用于调试）
for (const collider of springSystem.colliders) {
  if (!collider.enabled) continue;

  switch (collider.type) {
    case 'sphere':
      debugDrawSphere(collider.center, collider.radius);
      break;
    case 'capsule':
      debugDrawCapsule(collider.start, collider.end, collider.radius);
      break;
    case 'plane':
      debugDrawPlane(collider.point, collider.normal);
      break;
  }
}
```

### 检查碰撞

在 `spring_system.ts` 的 `solveCollisions()` 方法中添加日志：

```typescript
if (resolveSphereCollision(particle.position, collider as any)) {
  console.log('Collision detected with sphere collider');
}
```

## 常见问题

### 头发仍然穿透身体
- 增加碰撞器半径
- 增加约束求解迭代次数（`iterations`）
- 检查碰撞器位置是否正确

### 头发被推得太远
- 减小碰撞器半径
- 检查碰撞器是否重叠

### 性能问题
- 减少碰撞器数量
- 减少粒子数量
- 使用球体而不是胶囊

## API参考

### SpringSystem

```typescript
class SpringSystem {
  addCollider(collider: SpringCollider): void;
  removeCollider(collider: SpringCollider): boolean;
  clearColliders(): void;
  get colliders(): SpringCollider[];
}
```

### 碰撞器创建函数

```typescript
function createSphereCollider(
  center: Vector3,
  radius: number,
  node?: SceneNode
): SphereCollider;

function createCapsuleCollider(
  start: Vector3,
  end: Vector3,
  radius: number,
  node?: SceneNode
): CapsuleCollider;

function createPlaneCollider(
  point: Vector3,
  normal: Vector3,
  node?: SceneNode
): PlaneCollider;
```

### 碰撞器接口

```typescript
interface SpringCollider {
  type: 'sphere' | 'capsule' | 'plane';
  node?: SceneNode;
  enabled: boolean;
}

interface SphereCollider extends SpringCollider {
  center: Vector3;
  radius: number;
}

interface CapsuleCollider extends SpringCollider {
  start: Vector3;
  end: Vector3;
  radius: number;
}

interface PlaneCollider extends SpringCollider {
  point: Vector3;
  normal: Vector3;
}
```
