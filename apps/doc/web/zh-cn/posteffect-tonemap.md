# Tonemap（色调映射）

**用途**：针对 HDR 渲染输出执行色调映射，使其匹配标准 LDR 显示设备。  

**属性接口：**
- `camera.toneMap`: `boolean` — 启用或禁用色调映射。  
- `camera.toneMapExposure`: `number` — 曝光控制，默认值 `1`。

**示例：**
```javascript  
camera.HDR = true;  
camera.toneMap = true;  
camera.toneMapExposure = 1.2;  
```

<div class="showcase" case="tut-27" style="width:600px;height:800px;"></div>

