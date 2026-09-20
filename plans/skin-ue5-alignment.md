# SkinMaterial + SkinSSS 从零重写 —— 100% 复刻 UE5

## 核心原则

- **完全照搬 UE5 算法流程**，逐 pass 对齐截帧逆向结果
- **不受现有 SkinMaterial / SkinSSS 实现影响**，推倒重来
- **WebGPU only**，compute shader 用于 Burley 扩散和 BVar
- **不动现有 SSS 路径**（`posteffect/sss.ts` 及其配套模块不改）
- 依据：`E:\UEScene\UEDigitalHuman.rdc` + `plans/ue5-sss-reverse-engineering.md`

---

## 模块总览

```
┌──────────────────────────────────────────────────────────┐
│ Forward Lighting Pass                                    │
│  SkinMaterial.fragmentShader                             │
│    ├─ 预积分皮肤漫射 BRDF (曲率+Fresnel+wrap)           │
│    ├─ 双 Lobe GGX 高光 (profile LUT 驱动粗糙度修正)     │
│    ├─ SceneColor.rgb = diffuse + specular                │
│    ├─ SceneColor.a = specular luminance (供后续分离)      │
│    └─ SkinSSS MRT = diffusible (albedo × diffuseIrrad)   │
└───────────────────────┬──────────────────────────────────┘
                        ▼
┌──────────────────────────────────────────────────────────┐
│ SkinSSS Post Effect (全部 WebGPU compute)                │
│                                                          │
│  Pass 1: Setup (compute 64 threads/tile)                 │
│    ├─ 读 shading model，识别 SSS 像素                    │
│    ├─ specFrac = saturate(sceneColor.a / lum(rgb))       │
│    ├─ 写 setupColor = specular-only 部分                 │
│    ├─ 写 profileSlot UAV                                 │
│    └─ (无 indirect dispatch：全屏 dispatch + early-out)   │
│                                                          │
│  Pass 2: Burley Diffusion (compute 64 threads/8×8 tile)  │
│    ├─ 10×10 groupshared 缓存 (SceneColor + Normal + Slot)│
│    ├─ Halton 序列 + 逆 CDF 重要性采样                    │
│    ├─ Burley 核: (e^(-r/d) + e^(-r/3d)) / (8πd)         │
│    ├─ 法线权重: sqrt(0.5 * NdotN + 0.5)                 │
│    ├─ 3D 距离: sqrt(screenR² + depthR²)                  │
│    ├─ 跨 profile 边界降级: boundaryColor                  │
│    ├─ 重要性采样比: kernelWeight / PDF                    │
│    └─ 写 diffusedColor UAV                               │
│                                                          │
│  Pass 3: BVar (compute 64 threads/tile)                  │
│    ├─ 亮度方差 → 屏幕空间厚度估计                        │
│    ├─ 阴影图采样增强 transmission                        │
│    └─ 写 transmissionData UAV                            │
│                                                          │
│  Pass 4: Recombine (fragment fullscreen)                 │
│    ├─ specFrac = saturate(sceneColor.a / lum(rgb))       │
│    ├─ specular 不动                                      │
│    ├─ blurredDiff = blurredNorm - specular               │
│    ├─ output = (boundary * blurredDiff + spec) * nw + diff│
│    └─ 写回 SceneColor                                   │
└──────────────────────────────────────────────────────────┘
```

---

## 文件计划

| 文件 | 动作 | 说明 |
|------|------|------|
| `libs/scene/src/material/skin.ts` | **重写** | 预积分皮肤 BRDF，SceneColor.a 写 specular luminance |
| `libs/scene/src/posteffect/skinsss.ts` | **重写** | 4-pass compute 管线 |
| `libs/scene/src/shaders/skin_brdf.ts` | **新建** | 预积分皮肤漫射 + 双 lobe 高光的 shader 函数 |
| `libs/scene/src/utility/textures/skinlut.ts` | **新建** | 预积分皮肤 BRDF LUT 烘焙 |
| `libs/scene/src/material/subsurfaceprofile.ts` | **扩展** | 新增 `buildProfileTexture()` 生成 UE5 格式的 profile 纹理 |
| `libs/scene/src/shaders/diffusion.ts` | 保留不动 | 旧的 1D Burley 仍供 SSS 路径使用 |
| `libs/scene/src/utility/serialization/scene/material.ts` | **更新** | 适配新属性 |
| `test/src/scene/skin_sss_shader_generation.test.ts` | **重写** | 验证新 compute shader 生成 |
| `test/src/scene/skin_material_serialization.test.ts` | **更新** | 适配新属性 |

### 不改动的文件
- `libs/scene/src/posteffect/sss.ts` — 高级 SSS 路径
- `libs/scene/src/render/rendergraph/forward_plus_builder.ts` — MRT 分配逻辑（SkinSSSTexture 复用）
- `libs/scene/src/material/meshmaterial.ts` — outputFragmentColor 的 skinSSS 参数通道
- `libs/scene/src/camera/camera.ts` — skinSSS 属性

---

## Phase 1: 预积分皮肤 BRDF LUT + shader 函数

### 1.1 新建 `shaders/skin_brdf.ts`

从 UE5 deferred lighting case 5 逆向的精确算法：

**预积分漫射：**
```
curvatureFactor = rsqrt(VdotL * 2 + 2)
wrappedDiffuse = saturate(curvatureFactor * VdotL + curvatureFactor)
absNdotL = min(abs(NdotL) + 1e-5, 1.0)
wrapFactor = wrappedDiffuse² · roughnessParam - 0.5

// Schlick 双端衰减
diffuseFresnel1 = wrapFactor * pow5(1 - absNdotL) + 1.0
diffuseFresnel2 = wrapFactor * pow5(1 - NdotV) + 1.0
diffuseBRDF = diffuseFresnel1 * diffuseFresnel2 / PI
```

**双 Lobe 高光：**
```
// Profile 驱动的双粗糙度
roughness1 = saturate((sssMask * (profileParam.x*2-1) + 1) * baseRoughness)
roughness2 = saturate((sssMask * (profileParam.y*2-1) + 1) * baseRoughness)

// 预积分 LUT 查表
lutUV = (roughness * 0.984375 + 0.007813, sqrt(1-NdotL) * 0.984375 + 0.007813)
skinLUT = sample(preIntSkinLUT, lutUV)

// 每个 lobe 独立评估，用 profile.z 混合
finalSpec = lerp(lobe1, lobe2, profileParam.z)
```

**SceneColor.a 写 specular luminance：**
这是 UE5 分离 specular/diffuse 的核心机制。forward 路径中需要额外输出。
方案：`outputFragmentColor` 的 color 参数改为 `vec4(litColor.rgb, specularLuminance)`。
在 `meshmaterial.ts` 的 `outputFragmentColor` 中，SceneColor 的 `.a` 通道当前写的是 `albedo.a`（不透明度）。对于不透明皮肤，alpha 始终为 1，可以复用为 specular luminance。
需要在 SkinMaterial 中：`pb.vec4(litColor, dot(specularLighting, vec3(0.2126, 0.7152, 0.0722)))`

### 1.2 新建 `utility/textures/skinlut.ts`

烘焙 256×256 R16G16B16A16_FLOAT 预积分 LUT：
- U 轴 = roughness [0, 1]
- V 轴 = sqrt(1 - NdotL) [0, 1]
- 存储: specular amplitude (xy), lobe direction offsets (zw)

烘焙通过 compute shader 做蒙特卡洛积分，类似现有 `ggxlut.ts` 的模式。

### 1.3 扩展 `subsurfaceprofile.ts`

新增 `buildProfileTexture()` 方法，生成 UE5 格式的 profile 参数纹理：
- 格式: R16G16B16A16_FLOAT, 宽度 = maxSlots+2, 高度 = 8
- Row 0: transmission color + alpha
- Row 1: scatter color + radius
- Row 2: shaping distance d (直接存储，不×500)
- Row 3: 保留
- Row 4: boundary color + Burley flag
- Row 5: 双 lobe 参数 (.x=narrow mod, .y=wide mod, .z=blend)
- Row 6-7: 保留

当 `SubsurfaceProfile.version` 变化时重建。

---

## Phase 2: SkinMaterial 重写

### 2.1 属性

**保留：**
- `roughness: number` (默认 0.35)
- `specularStrength: number` (默认 1)
- `specularF0: number` (默认 0.028)
- `transmissionStrength / transmissionPower`
- `subsurfaceTexture` (R=mask, G=curvature, B=thickness)

**新增：**
- `dualLobeBlend: number` (默认 0.5) — 双 lobe 混合因子（对应 profile row 5.z）
- `narrowLobeRoughnessMod: number` (默认 0) — 窄 lobe 粗糙度修正
- `wideLobeRoughnessMod: number` (默认 0) — 宽 lobe 粗糙度修正

这三个值也可以从 SubsurfaceProfile 读取（如果 SkinSSS 设置了 profile），材质上的值作为覆盖。

**向后兼容保留 deprecated no-op：**
shininess, diffuseWrap, diffuseSoftness, shadowTint, brightening, scatterWrap, scatterStrength, scatterColor

### 2.2 Fragment Shader

```typescript
fragmentShader(scope) {
  // ... setup, albedo, normal, view ...
  
  // 环境光
  envDiffuse = getEnvLightIrradiance(normal)
  envSpec = getEnvLightRadiance(reflectVec, roughness) * envFresnel
  
  // 逐光源循环
  forEachLight(function(type, posRange, dirCutoff, color, extra, shadow) {
    // 预积分皮肤漫射 BRDF
    diffuse = skinDiffuseBRDF(NdotL, NdotV, VdotL, roughness) // 从 skin_brdf.ts

    // 双 Lobe GGX 高光 (简化版，不做 UE5 的面光源积分)
    // 用标准 GGX 但分两个粗糙度 lobe
    r1 = max(roughness * narrowMod, 0.02)
    r2 = max(roughness * wideMod, 0.02)
    spec1 = D_GGX(NoH, r1²) * V_GGX(NoV, NoL, r1²) * F_Schlick(LoH, F0)
    spec2 = D_GGX(NoH, r2²) * V_GGX(NoV, NoL, r2²) * F_Schlick(LoH, F0)
    spec = lerp(spec1, spec2, dualLobeBlend) * lightColor * shadow
    
    diffuseLighting += diffuse * lightColor * shadow / PI
    specularLighting += spec * specStrength
  })
  
  diffusible = albedo * (diffuseLighting + transmissionLighting)
  litColor = diffusible + specularLighting
  
  // 关键：SceneColor.a = specular luminance
  specLum = dot(specularLighting, vec3(0.2126, 0.7152, 0.0722))
  outputColor = vec4(litColor, specLum)
  
  // SkinSSS side buffer
  skinSSS = vec4(diffusible * encodeScale, skinMask)
}
```

**与 UE5 的差异（可接受）：**
- UE5 用 deferred 的面光源代表点积分做高光，forward 路径用标准 GGX 做近似（dual lobe 保留相同的风格化效果）
- UE5 用预积分 LUT 查表做漫射，这里内联计算（预积分公式是解析的，不需要 LUT）
- forward 路径每光源只 evaluate 一次 BRDF，UE5 deferred 也是如此

---

## Phase 3: SkinSSS 后处理重写 (4-pass compute)

### 3.1 Pass 1: Setup (compute)

```
workgroupSize: [64, 1, 1]  — 8×8 tile = 64 threads

输入: SceneColor, SceneDepth, SkinSSSTexture (side buffer)
输出: SetupColor UAV (specular-only), ProfileSlot UAV

每线程:
  pixelCoord = tileOrigin + ivec2(threadID & 7, threadID >> 3)
  uv = (pixelCoord + 0.5) * texelSize
  
  skinData = textureLoad(SkinSSSTex, pixelCoord)
  isSkin = skinData.a > 0.001
  
  if isSkin:
    sceneColor = textureLoad(SceneColor, pixelCoord)
    lum = dot(sceneColor.rgb, (0.2126, 0.7152, 0.0722))
    specFrac = saturate(sceneColor.a / max(lum, 1e-4))
    setupColor = vec4(sceneColor.rgb * specFrac, linearDepth)
  else:
    setupColor = vec4(0)
  
  textureStore(SetupUAV, pixelCoord, setupColor)
```

由于没有 indirect dispatch，Setup 改为全屏 dispatch：
`device.compute(ceil(width/8), ceil(height/8), 1)`
每个 workgroup 处理 8×8 像素，非皮肤像素直接 early-out。

### 3.2 Pass 2: Burley Diffusion (compute, 核心 pass)

```
workgroupSize: [64, 1, 1]  — 8×8 tile

groupshared:
  g_color: vec4[100]   // 10×10 neighborhood SceneColor
  g_normal: vec3[100]  // 10×10 neighborhood normals  
  g_slot: uint[100]    // 10×10 neighborhood profile slots

Phase 1 (线程 0..49 各加载 2 像素):
  10×10 区域 = 8×8 tile + 1px border on each side
  idx = threadID * 2
  for each of 2 pixels:
    uv = (tileOrigin - 1 + offset(idx)) * texelSize
    g_color[idx] = sample(SceneColor, uv)
    g_normal[idx] = decode(SceneNormal or depth-derived normal)
    g_slot[idx] = isSkin ? profileSlot : 255
  workgroupBarrier()

Phase 2 (中心像素设置):
  pixelCoord = tileOrigin + ivec2(threadID & 7, threadID >> 3)
  centerColor = g_color[cacheIndex] or textureLoad
  centerNormal = g_normal[cacheIndex]
  centerDepth = linearDepth
  centerSlot = g_slot[cacheIndex]
  
  if centerSlot == 255: early-out (write original)
  
  // 从 Profile 纹理加载参数
  d = profileTex[2, centerSlot] // shaping distance
  scatterColor = profileTex[1, centerSlot]
  boundaryColor = profileTex[4, centerSlot]
  
  shapeBounds = 3.5 + 100 * (scatterColor - 0.33)^4
  d_eff = d / shapeBounds
  
  screenRadius = projScale * scatterRadius / depth * d.w * 0.3
  pixelRadius = screenRadius * texelSize * viewportSize
  
  CDF_at_avg = 1 - 0.25*exp(-avgR/d_eff) - 0.75*exp(-avgR/(3*d_eff))
  sampleRange = 1 - CDF_at_avg
  sampleCount = clamp(round(worldRadius * 10000), 8, 64)

Phase 3 (采样循环):
  for i in 0..sampleCount:
    xi_r = frac((i+jitter) * 0.754878)
    xi_θ = frac((i+jitter) * 0.569840)
    xi_mapped = xi_r * sampleRange + CDF_at_avg
    
    // UE5 逆 CDF:
    shape = (-0.6 * xi_mapped - 2.0) / d_eff
    r = ln(1 - xi_mapped) * shape * ln(2)
    r = max(r, 1e-5)
    angle = xi_θ * 2π
    
    // PDF
    pdf = (exp(-r/d_eff) + exp(-r/(3*d_eff))) * 0.25 / d_eff
    
    offset = vec2(cos(angle)*r, sin(angle)*r) * pixelRadius
    mip = clamp(ceil(0.5 * log(pdf / (N * d²))), 0, 5)
    
    // 从 groupshared 或纹理采样
    if inCacheBounds and mip == 0:
      sampleColor = g_color[cacheIdx]
      sampleNormal = g_normal[cacheIdx]
      sampleSlot = g_slot[cacheIdx]
    else:
      sampleColor = textureSampleLevel(SceneColor, sampleUV, mip)
      sampleNormal = decode(...)
      sampleSlot = textureLoad(ProfileSlotUAV, ...)
    
    normalWeight = sqrt(0.5 * dot(sampleN, centerN) + 0.5)
    depthDist = (sampleDepth - centerDepth) * 10 / d.w
    combinedDist = sqrt(r² + depthDist²)
    
    // 跨 profile
    boundary = (sameSlot or slot==255) ? vec3(1) : boundaryColor
    
    // 逐通道 Burley 权重
    w.r = (exp(-dist/(d.r*bounds.r)) + exp(-dist/(3*d.r*bounds.r))) / (8π * d.r/bounds.r)
    w.g = ... w.b = ...
    importanceWeight = w / pdf
    
    colorSum += sampleColor * importanceWeight * normalWeight * isSSS
    weightSum += importanceWeight * normalWeight
    boundarySum += boundary

Phase 4 (归一化):
  result = colorSum / max(weightSum, 1e-6)
  boundary = boundarySum / sampleCount
  result = result * boundary
  result = CDF * (original - result*boundary) + result*boundary
  opacity = saturate((skinMask - 0.1) * 10)
  final = lerp(original, result, opacity)
  
  textureStore(DiffusedUAV, pixelCoord, final)
```

### 3.3 Pass 3: BVar Transmission (compute)

```
workgroupSize: [64, 1, 1]

对每个皮肤像素:
  // 亮度方差 → 厚度
  blurredColor = textureLoad(DiffusedUAV, pixelCoord)
  offsetColor = textureSampleLevel(DiffusedUAV, uv + offset, 0)
  
  blurredLum = dot(pow(blurredColor, 1/2.2), (0.2126, 0.7152, 0.0722))
  offsetLum = dot(pow(offsetColor, 1/2.2), (0.2126, 0.7152, 0.0722))
  lumVariance = blurredLum - offsetLum  // 局部厚度
  
  // 阴影采样（如果有 shadow mask）
  shadowTerm = sampleShadowMask(pixelCoord) if available
  
  transmission.w = lumVariance * blend + shadowTerm * (1-blend)
  transmission.xyz = additional variance data
  
  textureStore(TransmissionUAV, pixelCoord, transmission)
```

简化说明：BVar 在 UE5 中做了时序重投影，zephyr3d 的 forward 路径中速度缓冲不一定可用。初版可简化为纯空间方差（去掉时序部分），后续迭代加入。

### 3.4 Pass 4: Recombine (fragment fullscreen)

```
fragment shader:
  sceneColor = sample(SceneColor, uv)
  skinData = sample(SkinSSSTexture, uv)
  
  if skinData.a < 0.001:
    output = sceneColor  // passthrough
    return
  
  blurred = sample(DiffusedUAV, uv)
  blurredNorm = blurred.rgb / max(blurred.a, 1e-5)
  // 注：如果 Burley pass 已经做了归一化，这里 .a = 1，直接用 .rgb
  
  // UE5 Recombine 精确公式
  lum = dot(sceneColor.rgb, (0.2126, 0.7152, 0.0722))
  specFrac = saturate(sceneColor.a / max(lum, 1e-4))
  specular = sceneColor.rgb * specFrac
  diffuse = sceneColor.rgb * (1 - specFrac)
  
  // Profile boundary color
  boundaryColor = profileTex[0, profileSlot].rgb
  
  blurredDiff = blurredNorm - specular
  result = (boundaryColor * blurredDiff + specular) + diffuse
  
  // Transmission (from BVar)
  transmission = sample(TransmissionUAV, uv)
  result += transmission.w * scatterTint * transmissionStrength
  
  output = vec4(result, 0)
```

---

## Phase 4: Render Graph 集成

### 4.1 新增资源

SkinSSS 后处理需要的中间纹理（在 `apply()` 中用 `device.pool.fetchTemporalTexture` 临时分配）：
- `SetupColor`: RGBA16F, 全屏 — specular-only 颜色 + depth
- `ProfileSlotUAV`: R8_UINT, 全屏 — 逐像素 profile slot
- `DiffusedColor`: RGBA16F, 全屏 — Burley 扩散结果
- `TransmissionData`: RGBA16F, 全屏 — BVar transmission

这些都是 storage texture，在 `apply()` 开始时分配，结束时释放。

### 4.2 Dispatch 策略

没有 indirect dispatch，用全屏 dispatch：
```
tileCountX = ceil(width / 8)
tileCountY = ceil(height / 8)
totalTiles = tileCountX * tileCountY

Pass 1 (Setup):    device.compute(tileCountX, tileCountY, 1)
Pass 2 (Burley):   device.compute(tileCountX, tileCountY, 1)
Pass 3 (BVar):     device.compute(tileCountX, tileCountY, 1)
Pass 4 (Recombine): fragment fullscreen quad
```

非皮肤像素在 compute pass 中通过 `if (skinMask < 0.001) return;` early-out。
在 UE5 中这些像素由 tile classification 直接跳过，性能差异在于空 tile 仍被 dispatch。对于典型场景（皮肤只占屏幕一小部分），workgroup 级 early-out 通过首线程检查 + 全组 return 也能达到类似效果。

### 4.3 SceneColor.a 写 specular luminance

需要确认 SkinMaterial 输出 SceneColor.a 时不会被 meshmaterial 的 OIT / fog / alpha 逻辑覆盖。

当前 `outputFragmentColor` 中，不透明 pass 的 color.a 在输出时只被 alphaTest 和 OIT 触碰。对于不透明皮肤（无 alpha blend），alpha 通道可安全复用。

需要改的：SkinMaterial 传给 `outputFragmentColor` 的 color 参数从 `vec4(litColor, albedo.a)` 改为 `vec4(litColor, specLum)`。

---

## Phase 5: 向后兼容和序列化

- `shininess` 和所有 NPR 属性保持 deprecated no-op（已经是这样）
- `Roughness`, `SpecularF0`, `SpecularStrength` 保持现有序列化
- 新增 `DualLobeBlend`, `NarrowLobeRoughnessMod`, `WideLobeRoughnessMod` 的序列化
- deprecated 属性用 `isValid() { return false }` 跳过写入

---

## Phase 6: 测试

- `skin_sss_shader_generation.test.ts` — 验证 4 个 shader（setup compute, burley compute, bvar compute, recombine fragment）都能生成
- `skin_material_serialization.test.ts` — 新属性序列化
- 验证 WebGL2 下 SkinMaterial 仍然能正常渲染（没有 SSS 后处理，只有基础光照）

---

## 实施顺序

1. `shaders/skin_brdf.ts` — 预积分漫射 + 双 lobe 高光 shader 函数
2. `material/skin.ts` — 重写 fragment shader，用 skin_brdf，输出 specLum 到 alpha
3. `material/subsurfaceprofile.ts` — `buildProfileTexture()` 方法
4. `posteffect/skinsss.ts` — 4-pass compute 管线
5. 序列化和测试更新
6. build + test

---

## 与 UE5 的已知差异

| 点 | UE5 | zephyr3d 实现 | 影响 |
|---|---|---|---|
| 渲染管线 | Deferred | Forward+ | 光照在材质中逐光评估，效果等价 |
| 面光源高光 | 代表点立体角积分 | 标准 GGX 双 lobe | 面光源 highlight 形状略有差异，点光源/方向光完全等价 |
| Indirect dispatch | tile list indirect | 全屏 dispatch + early-out | 空 tile 有微量开销，workgroup early-out 抵消大部分 |
| BVar 时序重投影 | 用速度场重投影 | 初版用纯空间方差 | transmission 的时序稳定性略差，后续迭代加入 |
| Profile 纹理宽度 | 66 (64 slots + 2 special) | maxSlots+2 | 完全对齐 |
