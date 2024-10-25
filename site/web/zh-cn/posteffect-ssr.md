# 屏幕空间反射

## 概述

屏幕空间反射(Screen Space Reflections, SSR)通过分析当前渲染帧中的深度缓冲区和法线信息来实现动态的、具有物理基础的反射效果。与传统的环境映射和平面反射相比，SSR能够提供更准确和动态的反射效果，特别适合表现光滑表面（如金属、玻璃、水面等）上的实时反射。

## 基础设置

- 启用/禁用屏幕空间反射 [Camera.SSR](/doc/markdown/./scene.camera.ssr)

  取值true开启屏幕空间反射，false禁用屏幕空间反射，默认值false。
  ```javascript
  // 开启SSR
  camera.SSR = true;
  ```

- HiZ加速 [Camera.HiZ](/doc/markdown/./scene.camera.hiz)

  取值true开启HiZ，false禁用HiZ，默认值false。
  开启HiZ可以显著提升屏幕空间追踪的效率，加速SSR或其他屏幕空间效果，目前仅支持WebGL2和WebGPU。
  ```javascript
  // 开启HiZ
  camera.HiZ = true;
  ```

## 表面属性

### 粗糙度控制

- 粗糙度阈值 [Camera.ssrMaxRoughness](/doc/markdown/./scene.camera.ssrmaxroughness)

  取值0到1，只有物体表面粗糙度小于粗糙度阈值时才会有SSR效果。默认值0.8。
  ```javascript
  // 对粗糙度0.9以下的物体应用屏幕空间反射
  camera.ssrMaxRoughness = 0.9;
  ```

- 粗糙度缩放系数 [Camera.ssrRoughnessFactor](/doc/markdown/./scene.camera.ssrroughnessfactor)

  非负数值，该数值会在场景范围对物体表面粗糙度进行全局缩放，通常用于调试。默认值为1。
  ```javascript
  // 粗糙度全局调整为原值的二分之一
  camera.ssrRoughnessFactor = 0.5;
  ```
  
### 射线追踪参数

- 单次步进距离 [Camera.ssrStride](/doc/markdown/./scene.camera.ssrstride)

  单次步进的像素数，默认为2。步进像素数越小追踪结果越准确，但是对于相同的追踪距离需要更多的追踪次数。
  当HiZ开启时，忽略此属性。
  ```javascript
  // 每次步进4个像素
  camera.ssrStride = 4;
  ```

- 步进次数 [Camera.ssrIterations](/doc/markdown/./scene.camera.ssriterations)

  步进次数，默认为120。步进次数乘以单次步进像素数就是在屏幕空间能够追踪的最远距离。过高的步进次数将会降低屏幕追踪性能。
  ```javascript
  // 每条射线最多步进200次
  camera.ssrIterations = 200;
  ```

- 最大追踪距离 [Camera.ssrMaxDistance](/doc/markdown/./scene.camera.ssrmaxdistance)

  摄像机空间中射线追踪的最大距离，默认值为100。较大的追踪距离允许从更远的物体产生反射。
  当HiZ开启时，忽略此属性。
  ```javascript
  // 最远反射距离表面500个单位远的物体
  camera.ssrMaxDistance = 500;
  ```

- 物体厚度 [Camera.ssrThickness](/doc/markdown/./scene.camera.ssrthickness)

  物体表面相交的厚度阈值，默认值为0.5。此属性影响射线的相交判断。
  ```javascript
  // 设置物体厚度为0.2
  camera.ssrThickness = 0.2;
  ```

- 自动计算厚度 [Camera.ssrCalcThickness](/doc/markdown/./scene.camera.ssrcalcthickness)

  开启后将会渲染双面深度缓冲用于计算物体厚度，默认值为false。目前，开启HiZ时无法自动计算厚度，此参数被忽略。
  ```javascript
  // 开启自动厚度计算
  camera.ssrCalcThickness = true;
  ```

## 模糊设置

粗糙度较高的表面反射后会产生很多噪点，需要进行模糊处理，以下参数用于控制模糊质量。

- 模糊程度 [Camera.ssrBlurScale](/doc/markdown/./scene.camera.ssrblurscale)

  模糊采样距离，值越大模糊程度越强，默认为0.05。
  ```javascript
  // 模糊采样距离0.03
  camera.ssrBlurScale = 0.03;
  ```

- 深度阈值 [Camera.ssrBlurDepthCutoff](/doc/markdown/./scene.camera.ssrblurdepthcutoff)

  双边滤波的深度差异阈值，值越小边缘越严格，默认为2。
  ```javascript
  // 模糊深度阈值
  camera.ssrBlurDepthCutoff = 4;
  ```

- 模糊核心大小 [Camera.ssrBlurKernelSize](/doc/markdown/./scene.camera.ssrblurkernelsize)

  模糊核心的大小，较大的值会产生更为柔和的模糊效果，但会降低性能，默认值为17。
  ```javascript
  // 模糊核心5
  camera.ssrBlurKernelSize = 5;
  ```


- 模糊标准差 [Camera.ssrBlurStdDev](/doc/markdown/./scene.camera.ssrblurstddev)

  用于控制高斯模糊的分布，较高的值产生更明显的模糊效果，默认值为10。
  ```javascript
  // 模糊标准差
  camera.ssrBlurStdDev = 4;
  ```

## 效果示例

<div class="showcase" case="tut-49"></div>

