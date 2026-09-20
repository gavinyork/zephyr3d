# UE5 SSS 管线逆向分析（从 UEDigitalHuman.rdc）

## 整体流程

```
BasePass (GBuffer)
  → 皮肤材质写 shading model 5 到 GBufferB.a 低4位
  → GBufferD.x = subsurface opacity, GBufferD.a = profile slot
  
Deferred Lighting (case 5: SubsurfaceProfile)
  → 预积分皮肤 BRDF + 双 lobe 面光源高光
  → SceneColor.a = specular luminance（供后续分离用）

SSS::Setup (compute, 64 threads/tile)
  → 提取 specular-only 颜色: specFrac = saturate(sceneColor.a / lum(sceneColor.rgb))
  → 写 setupColor.rgb = sceneColor.rgb * specFrac
  → 写 profile slot 到 UAV 纹理
  → Tile 分类: Burley / Separable / Passthrough

SSS::TileCategorisation
  → 构建 tile 列表（哪些 tile 有 SSS 像素）

SSS::PassOne_Burley (compute, 64 threads/tile, 10×10 groupshared cache)
  → Halton 序列盘采样，逆 CDF 重要性采样
  → Burley 双指数核: (exp(-r/d) + exp(-r/3d)) / (8πd)
  → 法线权重: sqrt(0.5 * NdotN + 0.5)
  → 深度: sqrt(screenDist² + (depthDiff*10/radius)²) 3D距离
  → 自适应 mip，跨 profile 边界降级

SSS::PassFour_BVar (compute)
  → 时序重投影 + 亮度方差 → transmission 估计
  → 阴影图采样增强 transmission

SSS::Recombine (pixel shader)
  → specFrac = saturate(sceneColor.a / lum(sceneColor.rgb))
  → specular = sceneColor * specFrac (不动)
  → diffuse  = sceneColor * (1 - specFrac)
  → blurredDiff = blurredNorm - specular
  → output = (profileBoundary * blurredDiff + specular) * normalWeight + diffuse
```

---

## 1. Setup Pass 算法

```
输入: SceneColor(t4), SceneDepth(t1), GBufferB(t2), GBufferD(t3), ProfileTex(t0)
输出: SetupColor UAV(u4), ProfileSlot UAV(u0), TileLists(u1,u2)

每线程处理 8×8 tile 中一个像素:
  shadingModel = (GBufferB.a * 255 + 0.5) & 0xF
  if shadingModel == 5 or 9:
    lum = dot(sceneColor.rgb, (0.2126, 0.7152, 0.0722))
    specFrac = saturate(sceneColor.a / lum)
    setupColor.rgb = sceneColor.rgb * specFrac
    setupColor.a = linearDepth + dither * depth * 0.000977
  
  profileSlot = (GBufferD.x * sssEligible) * 255
  
  profileRow4 = ProfileTex[4, profileSlot]
  isBurley = abs(profileRow4) < 0.01
  tileFlags |= isBurley ? 2 : 1
  
  atomicOr(sharedFlags, tileFlags)
  barrier()
  → 按 flags 写入对应 tile 列表
```

**核心洞察**: SceneColor.a 存 specular luminance，Setup 用 `alpha/luminance` 精确分离。

---

## 2. PassOne_Burley 算法

```
输入: SceneColor(t5), GBufferA(t2), GBufferB(t3), GBufferD(t4), 
      SceneDepth(t1), ProfileTex(t0), TileList(t9)
输出: DiffusedColor UAV(u1), ProfileSlot UAV(u0)
Groupshared: g0[100]=vec4(SceneColor), g1[100]=vec3(Normal), g2[100]=uint(ProfileSlot)

Phase 1: 加载 10×10 邻域到 groupshared (前50线程各加载2像素)
  对每个像素:
    g0[idx] = SceneColor
    g1[idx] = decode(GBufferA) 法线
    g2[idx] = profileSlot (或 255 如果非SSS)
  barrier()

Phase 2: 中心像素设置
  从 ProfileTex 加载 profile 参数:
    Row 1: scatterColor + transmissionParams  
    Row 2: shapingDistance d (×500 编码)
    Row 4: boundaryColor
  
  shapeBounds = 3.5 + 100 * (scatterColor - 0.33)^4
  d_effective = d / shapeBounds
  
  screenScatterRadius = projScale * scatterRadius / depth * transmission_d * 0.3
  pixelRadius = screenScatterRadius * texelSize * viewportSize
  
  CDF_at_avg = 1 - 0.25*exp(-avgR/d_eff) - 0.75*exp(-avgR/(3*d_eff))
  sampleRange = 1 - CDF_at_avg
  
  sampleCount = clamp(worldScatterRadius * 10000, 8, 64)

Phase 3: 采样循环 (i = 0..sampleCount)
  // Halton 低差异序列
  xi_r = frac(i * 0.754878)
  xi_θ = frac(i * 0.569840)
  
  // 映射到 CDF 范围 [CDF_0, 1]
  xi_mapped = xi_r * sampleRange + CDF_at_avg
  
  // UE5 的逆 CDF 近似（关键！）:
  shape = (-0.6 * xi_mapped - 2.0) / d_effective
  r = ln(1 - xi_mapped) * shape * ln(2)
  r = max(r, 0.00001)
  angle = xi_θ * 2π
  
  // 采样 PDF
  pdf = (exp(-r/d_eff) + exp(-r/(3*d_eff))) * 0.25 / d_eff
  
  // 屏幕空间偏移
  offset = (cos(angle)*r*pixelRadiusX, sin(angle)*r*pixelRadiusY)
  
  // 自适应 mip = ceil(0.5 * log(pdf/(N*d²)))，clamp [0,5]
  
  // 采样邻居（共享内存或纹理）
  sampleColor = g0 或 textureSampleLevel(SceneColor, mip)
  sampleNormal = g1 或 decode(GBufferA)
  sampleProfileSlot = g2 或 UAV读取
  
  // 法线权重
  normalWeight = sqrt(0.5 * dot(sampleN, centerN) + 0.5)
  
  // 深度距离
  depthDist = (sampleDepth - centerDepth) * 10 / transmission_d
  combinedDist = sqrt(r² + depthDist²)  // 3D距离！
  
  // 跨 profile 边界处理
  if sameProfile or nonSSS: boundaryWeight = (1,1,1)
  else: boundaryWeight = profileBoundaryColor
  
  // 逐通道 Burley 核权重
  per_channel_weight = (exp(-dist/(d*bounds)) + exp(-dist/(3d*bounds))) / (8π * d/bounds)
  importance_weight = per_channel_weight / pdf  // 重要性采样比
  
  // 累加
  colorSum += sampleColor.rgb * importance_weight * normalWeight * isSSS
  weightSum += importance_weight * normalWeight
  boundarySum += boundaryWeight

Phase 4: 归一化和混合
  result = colorSum / weightSum (逐通道)
  // 边界颜色加权
  boundary = normalize(boundarySum)
  result = result * boundary
  // CDF 保留原始项
  result = CDF * (original - result*boundary) + result*boundary  
  // 不透明度混合
  opacity = saturate((GBufferD.x - 0.1) * 10)
  final = lerp(original, result, opacity)
  
  store(u1, pixelCoord, final)
```

---

## 3. PassFour_BVar 算法

```
输入: BurleyResult(t4), SceneDepth(t1), GBufferB(t2), GBufferD(t3),
      ProfileTex(t0), ShadowMap(t5), VelocityTex(t6), OffsetColor(t7)
输出: VarianceData UAV(u0), TransmissionData UAV(u1)

只处理 Burley profile 像素 (profileRow4 ≈ 0):
  
  // 时序重投影
  prevClip = invViewProj * float4(ndcXY, depth, 1)
  reprojOffset = currentNDC - prevClip.xy/prevClip.z
  
  // 速度场覆盖
  velocity = decode(VelocityTex)  // 二次编码: v*|v|*0.5
  offset = hasVelocity ? velocity : reprojOffset
  
  // 阴影图采样
  if |offset| < 1: shadowData = sample(ShadowMap, remap(offset))
  
  // 亮度方差计算
  blurredLum = dot(pow(blurredColor, 1/2.2), (0.2126, 0.7152, 0.0722))
  offsetLum  = dot(pow(offsetColor, 1/2.2), (0.2126, 0.7152, 0.0722))
  lumDiff = blurredLum - offsetLum  // 局部厚度估计
  
  // Transmission 输出
  output.x = blurredDepth * blendA * 0.015625 + shadow.y * blendB
  output.y = blurredDepth * shadow.y
  output.z = variance cross term
  output.w = blendA * lumDiff + blendB * shadow.w
```

---

## 4. Recombine 算法

```
输入: ProfileTex(t0), GBufferB(t1), GBufferA(t2), GBufferD(t3),
      SceneColor(t4), BurleyResult(t5)
输出: Subsurface.Recombines (R16G16B16A16_FLOAT)

if shadingModel != 5 and != 9:
  output = SceneColor  // passthrough
  return

// Profile 边界颜色
profileBoundary = ProfileTex[0, profileSlot].rgb

// 归一化模糊结果
blurredNorm = BurleyResult.rgb / max(BurleyResult.a, 1e-5)

// Specular/Diffuse 分离
specFrac = saturate(SceneColor.a / dot(SceneColor.rgb, (0.2126, 0.7152, 0.0722)))
specular = SceneColor.rgb * specFrac
diffuse  = SceneColor.rgb * (1 - specFrac)

// SSS 重分配
blurredDiff = blurredNorm - specular
output.rgb = (profileBoundary * blurredDiff + specular) * normalWeight + diffuse
output.a = 0
```

---

## 5. Deferred Lighting Case 5 (SubsurfaceProfile BRDF)

**不是标准 GGX！** 是预积分皮肤专用 BRDF。

### 漫射: 预积分曲率相关 Burley Diffuse
```
curvatureFactor = rsqrt(VdotL * 2 + 2)
wrappedDiffuse = saturate(curvatureFactor * VdotL + curvatureFactor)
absNdotL = min(abs(NdotL) + 1e-5, 1.0)

wrapFactor = dot(wrappedDiffuse², roughnessParam) - 0.5

// Schlick 衰减
oneMinusNdotL = 1 - absNdotL
diffuseFresnel1 = wrapFactor * pow5(oneMinusNdotL) + 1.0
diffuseFresnel2 = wrapFactor * pow5(oneMinusNoV) + 1.0
diffuseBRDF = diffuseFresnel1 * diffuseFresnel2 / PI
```

### 高光: 双 Lobe 面光源预积分高光
```
// Profile Row 5: .x=窄lobe粗糙度修正, .y=宽lobe粗糙度修正, .z=混合因子

// Lobe 1 (窄高光)
roughness1 = saturate((sssMask * (skinBRDF.x*2-1) + 1) * baseRoughness)
roughness1 = max(roughness1, 0.02)
lutUV = (roughness1 * 0.984375 + 0.007813, sqrt(1-NdotL) * 0.984375 + 0.007813)
skinLUT = sample(PreIntSkinLUT, lutUV)  // 预积分 LUT

// 面光源代表点积分（Padé acos 近似）
// 4个角点评估，交叉积求立体角
R = reflect(V, N)
构建 TBN，用 LUT 方向变形 lobe
areaSpec1 = solidAngleIntegral(corners)

// Lobe 2 (宽高光) — 相同结构，不同粗糙度
roughness2 = saturate((sssMask * (skinBRDF.y*2-1) + 1) * baseRoughness)
areaSpec2 = solidAngleIntegral(corners)

// 混合
finalSpec = skinBRDF.z * (lobe2 - lobe1) + lobe1

// SceneColor.a = specular luminance（关键！）
// 所有光照输出到漫射通道供 SSS 重分配
```

---

## 6. SSS Profile 纹理布局 (66×64, R16G16B16A16_UNORM)

```
Row 0: transmission color RGB + alpha
Row 1: scatter color RGB + scatter radius (×500)  
Row 2: shaping distance d_RGB + d_transmission (×500 编码)
Row 3: (unused or additional params)
Row 4: mean free path / boundary color RGB + Burley flag (≈0 = Burley)
Row 5: dual-lobe params: .x=narrow roughness mod, .y=wide roughness mod, .z=blend, .w=additional
```

每列 = 一个 profile slot (0-63)
前 2 列可能是特殊用途（总宽度 66 而非 64）
