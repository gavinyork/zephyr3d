# 环境光遮挡 (SSAO)

环境光遮挡是一种屏幕空间的AO算法，旨在提供间接光的阴影近似，提高渲染的真实感。

```javascript
// 为摄像机打开SSAO后处理
camera.SSAO = true;
// 设置SSAO强度
camera.SSAOIntensity = 0.03;
// 设置SSAO深度检测范围
camera.SSAORadius = 100;

```

<div class="showcase" case="tut-29" style="width:600px;height:800px;"></div>

