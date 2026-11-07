# 光照

光照是使场景更具有真实感必不可少的部分。

## 直接光照

直接光照是指物体被具体的光源照亮。目前支持平行光（`DirectionalLight`）、点光（`PointLight`）、锥形光（`SpotLight`）和矩形面光源（`RectLight`），见[直接光照](zh-cn/lighting-direct.md)。

我们采用聚簇光照技术(Clustered Lighting)。光源上限取决于后端：WebGPU 上场景中最多 65535 个光源，每个 cluster 的光源列表不限长度；WebGL2 上最多 255 个光源，每个 cluster 最多 16 个。平行光不占 cluster 槽位（最多 4 个平行光在 cluster 之外单独着色）。详见[后端支持](zh-cn/backend-support.md#容量差异)。

## 间接光照

物体不是被光源直接照亮，而是被场景中其他物体所反射光线照亮，这样的光照我们称之为间接光照。间接光照的光源我们称之为环境光。

环境光（`scene.env.light.type`）支持 IBL（`'ibl'`）、半球形天光（`'hemisphere'`）和纯色环境光（`'constant'`）。在 WebGPU 上还可以开启基于探针的全局光照（`scene.gi`），在探针覆盖的范围内用场景实际的反弹光替代环境光的漫反射部分。见[间接光照](zh-cn/lighting-indirect.md)。

## 光照单位

默认的 `legacy` 光照模式使用无单位强度。改用试验性的 `physical` 模式后，光源、环境光和自发光都按物理单位（勒克斯、坎德拉等）设置，并配合相机曝光，见[物理光照模式](zh-cn/lighting-physical.md)。
