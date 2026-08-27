# 深度约定（Reverse-Z）

引擎支持两种深度约定，在**加载时**选定一次，之后整个页面生命周期内不可更改：

- **Reverse-Z（默认）** —— 设备深度 1 在近平面，0 在远平面。
- **Standard-Z** —— 设备深度 0 在近平面，1 在远平面。

对同一个视空间位置，两者满足 `standardDepth + reverseDepth === 1`。

## 为什么默认用 Reverse-Z

浮点数在接近 0 的地方精度最高。标准约定把远平面映射到 1，而透视投影本身又让深度值在远处高度
密集，两个因素叠加使远景的深度精度极差，表现为远距离的 z-fighting 和闪烁。

Reverse-Z 把近平面映射到 1、远平面映射到 0，让浮点精度最高的区域正好落在深度分布最密集的
远处。**配合浮点深度缓冲**（`d32f` / `d32fs8`，在 WebGPU 和 WebGL2 上是默认格式）时，
深度误差分布接近均匀，远距离 z-fighting 大幅减少。

## 切换约定

引擎默认就是 Reverse-Z，只有需要退回标准约定时才要配置。

推荐用构建期 define，这样打包工具可以把不用的那条代码路径消除掉：

```js
// vite.config.js / esbuild
define: { __ZEPHYR3D_REVERSE_Z__: 'false' }

// rollup (@rollup/plugin-replace)
replace({ preventAssignment: true, values: { __ZEPHYR3D_REVERSE_Z__: 'false' } })
```

不使用构建工具时，可以在**导入任何 `@zephyr3d/*` 模块之前**设置全局变量：

```html
<script>globalThis.__ZEPHYR3D_REVERSE_Z__ = false;</script>
<script type="module" src="app.js"></script>
```

选择顺序是：构建期 define → `globalThis` 全局变量 → 默认（Reverse-Z）。

当前生效的约定可以从 `@zephyr3d/base` 读到：

```javascript
import { REVERSE_Z, Z_CONVENTION } from '@zephyr3d/base';

console.log(REVERSE_Z);      // true / false
console.log(Z_CONVENTION);   // 'reverse' / 'standard'
```

## 写代码时必须用常量

**这是本页最重要的一条。** 只要你的代码涉及深度值或深度比较，就不能硬编码 0、1、`'le'`、
`'lt'` 这些字面量——它们在两种约定下含义相反。`@zephyr3d/base` 导出了一组常量，
在两种约定下都正确：

| 常量 | 用途 |
| --- | --- |
| `DEPTH_CLEAR_VALUE` | 清除深度缓冲用的值 |
| `DEPTH_NEAREST` | 近平面对应的设备深度 |
| `DEPTH_FARTHEST` | 远平面对应的设备深度（背景/天空） |
| `DEPTH_COMPARE_DEFAULT` | 默认深度测试（更近或相等时通过） |
| `DEPTH_COMPARE_CLOSER` | 严格更近时通过 |
| `DEPTH_COMPARE_CLOSER_EQUAL` | 更近或相等时通过 |
| `DEPTH_COMPARE_FARTHER` | 严格更远时通过 |
| `DEPTH_COMPARE_FARTHER_EQUAL` | 更远或相等时通过 |
| `DEPTH_REDUCE_CLOSER` | 取两个深度里更近的那个（`'min'` 或 `'max'`） |
| `DEPTH_REDUCE_FARTHER` | 取更远的那个 |
| `closerDepth(a, b)` | 返回更近的深度值 |
| `fartherDepth(a, b)` | 返回更远的深度值 |

```javascript
import { DEPTH_CLEAR_VALUE, DEPTH_COMPARE_DEFAULT } from '@zephyr3d/base';

// 正确
device.clearFrameBuffer(clearColor, DEPTH_CLEAR_VALUE, 0);
depthState.setCompareFunc(DEPTH_COMPARE_DEFAULT);

// 错误：在 reverse-Z 下会把深度清成最近，导致所有物体被剔除
device.clearFrameBuffer(clearColor, 1, 0);
```

写自定义材质或自定义 pass 的 shader 时，用 `ShaderHelper` 的深度工具函数，
不要自己写深度比较和线性化。

### 容易藏字面量的地方

实践中出问题最多的不是显式的深度比较，而是**深度端点字面量藏在几何技巧里**。开发过程中
实际踩到过的几类：

- 临时 framebuffer 的 `clearDepth` 写了字面量 1；
- 手写的裁剪体不等式里假定了 NDC 深度方向；
- 重投影时构造 `vec4(ndc, -1, 1)` 这类近/远平面点；
- **阴影贴图的颜色附件清屏色**写 1——在 reverse-Z 下"1"表示最近，空白区域会变成幻影遮挡物。

最后一条尤其隐蔽：部分阴影模式（spot/point 的线性编码）采样的是**颜色附件**而不是深度附件，
所以是否需要翻转要按光源类型判断，不能一概而论。

## 各后端的表现

| 后端 | Reverse-Z 支持情况 |
| --- | --- |
| **WebGPU** | 完整收益，无额外要求 |
| **WebGL2** | 有 `EXT_clip_control`（Chromium 121+）时获得完整收益；没有时走 shader 端兜底，渲染正确但精度收益有限 |
| **WebGL** | 功能上支持，但 WebGL1 没有浮点深度格式，**得不到精度收益** |

引擎在设备创建时会自动检测 `EXT_clip_control` 并启用 `[0, 1]` 裁剪深度范围。
调试时可以在创建设备前设置 `globalThis.__ZEPHYR3D_NO_CLIP_CONTROL__ = true` 强制走 shader
兜底路径，用来验证兜底逻辑是否正确。

## 已知限制

**斜裁剪投影在 Reverse-Z 下不可用。** `Matrix4x4.obliqueProjection()` 和
`obliquePerspective()` 在 reverse-Z 下会抛出明确的错误。这两个函数用于平面水面反射，
所以**需要平面反射时目前必须切回 Standard-Z**。

## 相关

- [创建设备](zh-cn/device.md) —— 设备与后端
- [渲染状态](zh-cn/renderstate.md) —— 深度状态设置
- [自定义材质](zh-cn/user-material.md) —— 材质 shader 里的深度处理
