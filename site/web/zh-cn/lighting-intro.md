# 光照

光照是使场景更具有真实感必不可少的部分。

## 直接光照

直接光照是指物体被具体的光源照亮。目前我们支持平行光，点光以及锥形光。

我们采用聚簇光照技术(Clustered Lighting)，支持视锥内最多255个光源，对于WebGL设备，每像素最多接受8盏灯照射，对于WebGL2和WebGPU设备，每像素最多接受16盏灯照射。

## 间接光照

物体不是被光源直接照亮，而是被场景中其他物体所反射光线照亮，这样的光照我们称之为间接光照。间接光照的光源我们称之为环境光。

间接光照目前我们支持IBL和半球形天光。